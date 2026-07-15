use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{Map, Value};

use super::adjustment_fields;

enum PayloadOperation {
    Publish {
        id: String,
        payload: Arc<Value>,
    },
    Resolve {
        id: String,
        payload: Option<Arc<Value>>,
    },
}

#[derive(Default)]
pub(crate) struct PayloadResidencyService {
    payloads: Mutex<HashMap<String, Arc<Value>>>,
}

impl PayloadResidencyService {
    pub(crate) fn hydrate_adjustments(&self, adjustments: &mut Value) {
        let mut operations = collect_adjustment_operations(adjustments);
        self.resolve(&mut operations);
        apply_adjustment_resolutions(adjustments, operations.into_iter());
    }

    pub(crate) fn hydrate_sub_masks(&self, sub_masks: &mut [Value]) {
        let mut operations = Vec::new();
        collect_sub_mask_operations(sub_masks, &mut operations);
        self.resolve(&mut operations);
        let mut operations = operations.into_iter();
        apply_sub_mask_resolutions(sub_masks, &mut operations);
        debug_assert!(operations.next().is_none());
    }

    pub(crate) fn clear(&self) {
        self.payloads
            .lock()
            .expect("payload residency service poisoned")
            .clear();
    }

    fn resolve(&self, operations: &mut [PayloadOperation]) {
        let mut payloads = self
            .payloads
            .lock()
            .expect("payload residency service poisoned");
        for operation in operations {
            match operation {
                PayloadOperation::Publish { id, payload } => {
                    payloads.insert(id.clone(), Arc::clone(payload));
                }
                PayloadOperation::Resolve { id, payload } => {
                    *payload = payloads.get(id).cloned();
                }
            }
        }
    }
}

fn collect_adjustment_operations(adjustments: &Value) -> Vec<PayloadOperation> {
    let mut operations = Vec::new();
    if let Some(patches) = adjustments
        .get(adjustment_fields::AI_PATCHES)
        .and_then(Value::as_array)
    {
        for patch in patches {
            let id = payload_id(patch);
            if !id.is_empty() {
                collect_payload_operation(
                    id,
                    patch.get(adjustment_fields::PATCH_DATA),
                    &mut operations,
                );
            }
            if let Some(sub_masks) = patch
                .get(adjustment_fields::SUB_MASKS)
                .and_then(Value::as_array)
            {
                collect_sub_mask_operations(sub_masks, &mut operations);
            }
        }
    }
    if let Some(masks) = adjustments
        .get(adjustment_fields::MASKS)
        .and_then(Value::as_array)
    {
        for mask in masks {
            if let Some(sub_masks) = mask
                .get(adjustment_fields::SUB_MASKS)
                .and_then(Value::as_array)
            {
                collect_sub_mask_operations(sub_masks, &mut operations);
            }
        }
    }
    operations
}

fn collect_sub_mask_operations(sub_masks: &[Value], operations: &mut Vec<PayloadOperation>) {
    for sub_mask in sub_masks {
        let id = payload_id(sub_mask);
        if id.is_empty() {
            continue;
        }
        let Some(parameters) = sub_mask.get("parameters").and_then(Value::as_object) else {
            continue;
        };
        for key in [
            adjustment_fields::MASK_DATA_BASE64_SNAKE,
            adjustment_fields::MASK_DATA_BASE64_CAMEL,
        ] {
            if let Some(payload) = parameters.get(key) {
                collect_payload_operation(id.clone(), Some(payload), operations);
            }
        }
    }
}

fn collect_payload_operation(
    id: String,
    payload: Option<&Value>,
    operations: &mut Vec<PayloadOperation>,
) {
    if let Some(payload) = payload.filter(|payload| !payload.is_null()) {
        operations.push(PayloadOperation::Publish {
            id,
            payload: Arc::new(payload.clone()),
        });
    } else {
        operations.push(PayloadOperation::Resolve { id, payload: None });
    }
}

fn apply_adjustment_resolutions(
    adjustments: &mut Value,
    mut operations: impl Iterator<Item = PayloadOperation>,
) {
    if let Some(patches) = adjustments
        .get_mut(adjustment_fields::AI_PATCHES)
        .and_then(Value::as_array_mut)
    {
        for patch in patches {
            let id = payload_id(patch);
            if !id.is_empty() {
                apply_value_resolution(patch, adjustment_fields::PATCH_DATA, &mut operations);
            }
            if let Some(sub_masks) = patch
                .get_mut(adjustment_fields::SUB_MASKS)
                .and_then(Value::as_array_mut)
            {
                apply_sub_mask_resolutions(sub_masks, &mut operations);
            }
        }
    }
    if let Some(masks) = adjustments
        .get_mut(adjustment_fields::MASKS)
        .and_then(Value::as_array_mut)
    {
        for mask in masks {
            if let Some(sub_masks) = mask
                .get_mut(adjustment_fields::SUB_MASKS)
                .and_then(Value::as_array_mut)
            {
                apply_sub_mask_resolutions(sub_masks, &mut operations);
            }
        }
    }
    debug_assert!(operations.next().is_none());
}

fn apply_sub_mask_resolutions(
    sub_masks: &mut [Value],
    operations: &mut impl Iterator<Item = PayloadOperation>,
) {
    for sub_mask in sub_masks {
        if payload_id(sub_mask).is_empty() {
            continue;
        }
        let Some(parameters) = sub_mask
            .get_mut("parameters")
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        for key in [
            adjustment_fields::MASK_DATA_BASE64_SNAKE,
            adjustment_fields::MASK_DATA_BASE64_CAMEL,
        ] {
            if parameters.contains_key(key) {
                apply_map_resolution(parameters, key, operations);
            }
        }
    }
}

fn apply_value_resolution(
    container: &mut Value,
    key: &str,
    operations: &mut impl Iterator<Item = PayloadOperation>,
) {
    if let PayloadOperation::Resolve {
        payload: Some(payload),
        ..
    } = operations.next().expect("payload operation parity")
    {
        container[key] = (*payload).clone();
    }
}

fn apply_map_resolution(
    container: &mut Map<String, Value>,
    key: &str,
    operations: &mut impl Iterator<Item = PayloadOperation>,
) {
    if let PayloadOperation::Resolve {
        payload: Some(payload),
        ..
    } = operations.next().expect("payload operation parity")
    {
        container.insert(key.to_string(), (*payload).clone());
    }
}

fn payload_id(value: &Value) -> String {
    value
        .get(adjustment_fields::ID)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn sequential_publication_semantics_are_preserved_without_locking_json_walks() {
        let service = PayloadResidencyService::default();
        let mut adjustments = json!({
            "aiPatches": [
                { "id": "patch", "patchData": null },
                { "id": "patch", "patchData": "resident" }
            ]
        });

        service.hydrate_adjustments(&mut adjustments);
        assert!(adjustments["aiPatches"][0]["patchData"].is_null());
        service.hydrate_adjustments(&mut adjustments);
        assert_eq!(adjustments["aiPatches"][0]["patchData"], "resident");

        adjustments["aiPatches"][0]
            .as_object_mut()
            .unwrap()
            .remove("patchData");
        service.hydrate_adjustments(&mut adjustments);
        assert_eq!(adjustments["aiPatches"][0]["patchData"], "resident");
    }

    #[test]
    fn sub_mask_aliases_share_resident_payload_by_identity() {
        let service = PayloadResidencyService::default();
        let mut published = vec![json!({
            "id": "mask",
            "parameters": { "mask_data_base64": "encoded" }
        })];
        service.hydrate_sub_masks(&mut published);
        let mut referenced = vec![json!({
            "id": "mask",
            "parameters": { "maskDataBase64": null }
        })];

        service.hydrate_sub_masks(&mut referenced);
        assert_eq!(referenced[0]["parameters"]["maskDataBase64"], "encoded");
        service.clear();
        referenced[0]["parameters"]["maskDataBase64"] = Value::Null;
        service.hydrate_sub_masks(&mut referenced);
        assert!(referenced[0]["parameters"]["maskDataBase64"].is_null());
    }

    #[test]
    fn concurrent_documents_resolve_their_own_atomic_publication() {
        const WORKERS: usize = 12;
        let service = Arc::new(PayloadResidencyService::default());
        let release = Arc::new(Barrier::new(WORKERS));
        let workers = (0..WORKERS)
            .map(|index| {
                let release = Arc::clone(&release);
                let service = Arc::clone(&service);
                thread::spawn(move || {
                    let payload = format!("payload-{index}");
                    let mut adjustments = json!({
                        "aiPatches": [
                            { "id": "shared", "patchData": payload },
                            { "id": "shared", "patchData": null }
                        ]
                    });
                    release.wait();
                    service.hydrate_adjustments(&mut adjustments);
                    assert_eq!(
                        adjustments["aiPatches"][0]["patchData"],
                        adjustments["aiPatches"][1]["patchData"]
                    );
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }
    }
}
