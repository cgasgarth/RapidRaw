use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PresetPreviewIdentity {
    image_session_id: u64,
    preset_id: String,
    request_id: u64,
    source_image_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PresetPreviewRequest {
    pub(super) expected_image_path: String,
    pub(super) js_adjustments: serde_json::Value,
    preview_identity: PresetPreviewIdentity,
}

pub(super) fn validate_preset_preview_request(
    request: &PresetPreviewRequest,
) -> Result<(), String> {
    let identity = &request.preview_identity;
    if request.expected_image_path.trim().is_empty()
        || identity.source_image_path != request.expected_image_path
        || identity.preset_id.trim().is_empty()
        || identity.image_session_id == 0
        || identity.request_id == 0
    {
        return Err("invalid_preset_preview_identity".to_string());
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct PresetPreviewSession {
    pub(super) generation: u64,
    pub(super) source_fingerprint: u64,
    pub(super) source_identity: String,
}

impl PresetPreviewSession {
    pub(super) fn new(generation: u64, source_fingerprint: u64, source_identity: String) -> Self {
        Self {
            generation,
            source_fingerprint,
            source_identity,
        }
    }
}

pub(super) fn validate_current_preset_preview_source(
    session: &PresetPreviewSession,
    current_generation: u64,
    current_source_identity: Option<&str>,
    current_source_fingerprint: Option<u64>,
) -> Result<(), String> {
    if session.generation == current_generation
        && current_source_identity == Some(session.source_identity.as_str())
        && current_source_fingerprint == Some(session.source_fingerprint)
    {
        Ok(())
    } else {
        Err("preset_preview_superseded".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PresetPreviewRequest, PresetPreviewSession, validate_current_preset_preview_source,
        validate_preset_preview_request,
    };

    #[test]
    fn frontend_request_envelope_deserializes_through_the_exact_tauri_argument() {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct InvokeArgs {
            request: PresetPreviewRequest,
        }

        let args: InvokeArgs = serde_json::from_value(serde_json::json!({
            "request": {
                "expectedImagePath": "/fixtures/current.ARW",
                "jsAdjustments": { "exposure": 0.9 },
                "previewIdentity": {
                    "imageSessionId": 7,
                    "presetId": "alaska-proof-look",
                    "requestId": 1,
                    "sourceImagePath": "/fixtures/current.ARW"
                }
            }
        }))
        .expect("frontend invoke args must match the native command contract");

        assert!(validate_preset_preview_request(&args.request).is_ok());
        assert_eq!(args.request.js_adjustments["exposure"], 0.9);
        assert!(
            serde_json::from_value::<InvokeArgs>(serde_json::json!({
                "jsAdjustments": { "exposure": 0.9 }
            }))
            .is_err()
        );
    }

    #[test]
    fn request_identity_rejects_a_different_source_or_zero_revision() {
        let request: PresetPreviewRequest = serde_json::from_value(serde_json::json!({
            "expectedImagePath": "/fixtures/current.ARW",
            "jsAdjustments": {},
            "previewIdentity": {
                "imageSessionId": 0,
                "presetId": "alaska-proof-look",
                "requestId": 1,
                "sourceImagePath": "/fixtures/other.ARW"
            }
        }))
        .unwrap();

        assert_eq!(
            validate_preset_preview_request(&request).unwrap_err(),
            "invalid_preset_preview_identity"
        );
    }

    #[test]
    fn same_path_reopen_cannot_publish_the_previous_native_result() {
        let session = PresetPreviewSession::new(7, 11, "/fixtures/current.ARW".to_string());

        assert_eq!(
            validate_current_preset_preview_source(
                &session,
                8,
                Some("/fixtures/current.ARW"),
                Some(11),
            )
            .unwrap_err(),
            "preset_preview_superseded"
        );
        assert!(
            validate_current_preset_preview_source(
                &session,
                7,
                Some("/fixtures/current.ARW"),
                Some(11),
            )
            .is_ok()
        );
    }
}
