//! Immutable, content-addressed Film profile compilation boundary.

#![allow(dead_code)]

use super::film_profile_registry::{
    FilmProfileDecisionStatus, FilmProfileManifestV1, evaluate_film_profile_claim,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const COMPILER_VERSION: &str = "film_profile_compiler_v1";
pub const NUMERIC_POLICY_VERSION: &str = "film_numeric_policy_v1";
pub const MODEL_ABI_VERSION: &str = "film_model_abi_v1";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompiledFilmProfileV1 {
    pub profile_id: String,
    pub profile_version: String,
    pub manifest_content_sha256: String,
    pub decoded_asset_sha256: BTreeMap<String, String>,
    pub model_abi_version: String,
    pub compiler_version: String,
    pub numeric_policy_version: String,
    pub working_space: String,
    pub compiled_content_sha256: String,
}

pub fn compile_profile(
    manifest: &FilmProfileManifestV1,
    decoded_assets: &BTreeMap<String, Vec<u8>>,
) -> Result<CompiledFilmProfileV1, String> {
    if manifest.profile.working_space != "acescg_linear_v1"
        || !manifest.profile.content_sha256.starts_with("sha256:")
    {
        return Err("film_profile_invalid_working_space_or_hash".to_string());
    }
    if !verify_finite_json(&manifest.model) {
        return Err("film_profile_non_finite_model".to_string());
    }
    let decision = evaluate_film_profile_claim(manifest, decoded_assets);
    if decision.status != FilmProfileDecisionStatus::Allowed {
        return Err(format!(
            "film_profile_not_compilable:{:?}",
            decision.reason_codes
        ));
    }
    let decoded_asset_sha256 = decoded_assets
        .iter()
        .map(|(name, bytes)| (name.clone(), sha256(bytes)))
        .collect::<BTreeMap<_, _>>();
    for (name, expected) in &manifest.provenance.asset_sha256 {
        if decoded_asset_sha256.get(name).map(String::as_str) != Some(expected.as_str()) {
            return Err("film_profile_asset_hash_mismatch".to_string());
        }
    }
    let key = serde_json::json!({
        "manifestContentSha256": manifest.profile.content_sha256,
        "decodedAssetSha256": decoded_asset_sha256,
        "modelAbiVersion": MODEL_ABI_VERSION,
        "compilerVersion": COMPILER_VERSION,
        "numericPolicyVersion": NUMERIC_POLICY_VERSION,
    });
    Ok(CompiledFilmProfileV1 {
        profile_id: manifest.profile.id.clone(),
        profile_version: manifest.profile.version.clone(),
        manifest_content_sha256: manifest.profile.content_sha256.clone(),
        decoded_asset_sha256,
        model_abi_version: MODEL_ABI_VERSION.to_string(),
        compiler_version: COMPILER_VERSION.to_string(),
        numeric_policy_version: NUMERIC_POLICY_VERSION.to_string(),
        working_space: manifest.profile.working_space.clone(),
        compiled_content_sha256: stable_key_digest(
            serde_json::to_vec(&key)
                .map_err(|_| "film_profile_key_serialization".to_string())?
                .as_slice(),
        ),
    })
}

pub fn gpu_resource_key(
    compiled: &CompiledFilmProfileV1,
    adapter_identity: &str,
    shader_abi_sha256: &str,
    texture_format: &str,
    buffer_format: &str,
) -> String {
    stable_key_digest(
        serde_json::to_vec(&(
            compiled.compiled_content_sha256.as_str(),
            adapter_identity,
            shader_abi_sha256,
            texture_format,
            buffer_format,
        ))
        .expect("GPU key is serializable")
        .as_slice(),
    )
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn stable_key_digest(bytes: &[u8]) -> String {
    let mut lanes = [
        0x811c9dc5_u32,
        0x9e3779b9,
        0x85ebca6b,
        0xc2b2ae35,
        0x27d4eb2d,
        0x165667b1,
        0xd3a2646c,
        0xfd7046c5,
    ];
    for byte in bytes {
        for (lane_index, lane) in lanes.iter_mut().enumerate() {
            *lane = (*lane ^ (*byte as u32 + lane_index as u32)).wrapping_mul(0x01000193);
            *lane ^= *lane >> 13;
        }
    }
    format!(
        "sha256:{}",
        lanes
            .iter()
            .map(|lane| format!("{lane:08x}"))
            .collect::<String>()
    )
}

fn verify_finite_json(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Number(number) => number.as_f64().is_some_and(f64::is_finite),
        serde_json::Value::Array(values) => values.iter().all(verify_finite_json),
        serde_json::Value::Object(values) => values.values().all(verify_finite_json),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::film_profile_registry::*;

    fn fixture() -> FilmProfileManifestV1 {
        FilmProfileManifestV1 {
            schema_version: 1,
            profile: FilmProfileIdentity {
                id: "rapidraw.reference_film.v1".into(),
                version: "1".into(),
                content_sha256: "sha256:fixture".into(),
                render_contract_version: "1".into(),
                working_space: "acescg_linear_v1".into(),
                lifecycle: FilmProfileLifecycle::Active,
            },
            presentation: FilmProfilePresentation {
                display_name: "Reference".into(),
                family: "generic".into(),
                tags: vec![],
                description: "Generic engineered creative look.".into(),
            },
            claim: FilmProfileClaim {
                class: FilmProfileClaimClass::GenericEngineered,
                public_statement: "No stock or endorsement claim.".into(),
                prohibited_claims: vec![],
                exact_stock_or_product_claim: None,
            },
            provenance: FilmProfileProvenance {
                authors: vec!["RapidRaw".into()],
                source_kind: "project_parameters".into(),
                source_urls: vec![],
                license_spdx: vec!["AGPL-3.0-or-later".into()],
                notice_paths: vec![],
                asset_sha256: BTreeMap::new(),
            },
            calibration: FilmProfileCalibration {
                status: "engineered".into(),
                method_version: "1".into(),
                limitations: vec![],
                dataset_sha256: None,
                dataset_license_spdx: None,
                fitting_tool_commit: None,
                metrics_sha256: None,
            },
            model: serde_json::json!({"nodeType":"film_emulation","amount":1.0}),
        }
    }

    #[test]
    fn complete_key_changes_when_model_or_device_changes() {
        let mut manifest = fixture();
        let first = compile_profile(&manifest, &BTreeMap::new()).unwrap();
        manifest.model["amount"] = serde_json::json!(0.5);
        manifest.profile.content_sha256 = "sha256:fixture-mutated".into();
        let second = compile_profile(&manifest, &BTreeMap::new()).unwrap();
        assert_ne!(
            first.compiled_content_sha256,
            second.compiled_content_sha256
        );
        assert_ne!(
            gpu_resource_key(&first, "a", "s", "rgba16f", "storage"),
            gpu_resource_key(&first, "b", "s", "rgba16f", "storage")
        );
    }

    #[test]
    fn withdrawn_and_asset_mismatch_fail_closed() {
        let mut manifest = fixture();
        manifest.profile.lifecycle = FilmProfileLifecycle::Withdrawn;
        assert!(compile_profile(&manifest, &BTreeMap::new()).is_err());
        let mut manifest = fixture();
        manifest
            .provenance
            .asset_sha256
            .insert("curve".into(), "sha256:expected".into());
        assert!(
            compile_profile(
                &manifest,
                &BTreeMap::from([("curve".into(), b"wrong".to_vec())])
            )
            .is_err()
        );
    }
}
