use serde_json::{Value, json};
use std::path::Path;

pub const DERIVED_OUTPUT_PROVENANCE_SCHEMA_VERSION: u32 = 1;

pub struct DerivedOutputProvenanceSource<'a> {
    pub content_hash: String,
    pub graph_revision: &'a str,
    pub path: &'a str,
}

pub struct DerivedOutputProvenanceInput<'a> {
    pub accepted_apply_id: Option<&'a str>,
    pub accepted_dry_run_id: Option<&'a str>,
    pub family: &'a str,
    pub output_artifact_id: &'a str,
    pub output_content_hash: &'a str,
    pub output_path: &'a Path,
    pub settings_hash: String,
    pub sources: Vec<DerivedOutputProvenanceSource<'a>>,
    pub warnings: Vec<&'a str>,
}

pub fn build_derived_output_provenance_sidecar(input: DerivedOutputProvenanceInput<'_>) -> Value {
    let output_path = input.output_path.to_string_lossy().to_string();
    let sidecar_path = format!("{}.rrdata", output_path);
    let receipt_id = format!(
        "derived_output_{}_{}",
        input.family,
        stable_hash(&json!({
            "family": input.family,
            "outputArtifactId": input.output_artifact_id,
            "outputContentHash": input.output_content_hash,
            "settingsHash": input.settings_hash,
        }))
        .replace(':', "_")
    );

    let mut sidecar = json!({
        "app": {
            "buildVersion": "1.5.8",
            "id": "io.github.CyberTimon.RapidRAW",
            "name": "RapidRAW",
        },
        "output": {
            "contentHash": input.output_content_hash,
            "path": output_path,
        },
        "receipt": {
            "family": input.family,
            "receiptId": receipt_id,
        },
        "schemaVersion": DERIVED_OUTPUT_PROVENANCE_SCHEMA_VERSION,
        "settingsHash": input.settings_hash,
        "sidecarPath": sidecar_path,
        "sourceState": input
            .sources
            .iter()
            .enumerate()
            .map(|(order, source)| {
                json!({
                    "contentHash": source.content_hash,
                    "graphRevision": source.graph_revision,
                    "order": order,
                    "path": source.path,
                })
            })
            .collect::<Vec<_>>(),
        "warnings": normalized_warnings(input.warnings),
    });

    if let Some(accepted_apply_id) = input.accepted_apply_id {
        sidecar["acceptedApplyId"] = json!(accepted_apply_id);
    }
    if let Some(accepted_dry_run_id) = input.accepted_dry_run_id {
        sidecar["acceptedDryRunId"] = json!(accepted_dry_run_id);
    }

    sidecar
}

pub fn stable_hash(value: &Value) -> String {
    let json = stable_json(value);
    format!("blake3:{}", blake3::hash(json.as_bytes()).to_hex())
}

fn normalized_warnings(warnings: Vec<&str>) -> Vec<String> {
    let mut values = warnings
        .into_iter()
        .filter(|warning| !warning.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

fn stable_json(value: &Value) -> String {
    match value {
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(stable_json).collect::<Vec<_>>().join(",")
        ),
        Value::Object(map) => {
            let mut entries = map.iter().collect::<Vec<_>>();
            entries.sort_by_key(|(left, _)| *left);
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, item)| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        stable_json(item)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        _ => serde_json::to_string(value).unwrap(),
    }
}
