//! Native trust boundary for a private RAW Film runtime receipt.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use super::film_emulation::FilmEmulationProfileRef;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmRuntimeProofMetricsV1 {
    pub changed_pixel_ratio: f32,
    pub preview_export_mean_abs_delta: f32,
    pub post_film_pre_view_hash_equal: bool,
    pub source_hash_unchanged: bool,
    pub save_reopen_film_node_hash_equal: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmRuntimeProofReceiptV1 {
    pub contract: String,
    pub proof_level: String,
    pub source_content_sha256: String,
    pub raw_decode_receipt_sha256: String,
    pub input_profile_id: String,
    pub input_profile_sha256: String,
    pub working_space: String,
    pub film_profile_ref: FilmEmulationProfileRef,
    pub film_profile_content_sha256: String,
    pub film_node_sha256: String,
    pub compiled_profile_sha256: String,
    pub execution_plan_sha256: String,
    pub backend: String,
    pub quality: String,
    pub post_film_pre_view_sha256: String,
    pub view_transform_id: String,
    pub gamut_mapper_id: String,
    pub display_or_output_profile_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_sync_display_profile_sha256: Option<String>,
    pub preview_artifact_sha256: String,
    pub export_artifact_sha256: String,
    pub preview_export_metrics: FilmRuntimeProofMetricsV1,
    pub limitation_codes: Vec<String>,
}

pub(crate) fn validate_metrics(metrics: &FilmRuntimeProofMetricsV1) -> Result<(), &'static str> {
    if !metrics.changed_pixel_ratio.is_finite()
        || !metrics.preview_export_mean_abs_delta.is_finite()
        || !(0.0..=1.0).contains(&metrics.changed_pixel_ratio)
        || metrics.changed_pixel_ratio == 0.0
        || metrics.preview_export_mean_abs_delta > 0.015
    {
        return Err("film_runtime_proof_metrics_invalid");
    }
    if !metrics.post_film_pre_view_hash_equal
        || !metrics.source_hash_unchanged
        || !metrics.save_reopen_film_node_hash_equal
    {
        return Err("film_runtime_proof_identity_mismatch");
    }
    Ok(())
}

pub(crate) fn validate_receipt(receipt: &FilmRuntimeProofReceiptV1) -> Result<(), &'static str> {
    let hashes = [
        receipt.source_content_sha256.as_str(),
        receipt.raw_decode_receipt_sha256.as_str(),
        receipt.input_profile_sha256.as_str(),
        receipt.film_profile_content_sha256.as_str(),
        receipt.film_node_sha256.as_str(),
        receipt.compiled_profile_sha256.as_str(),
        receipt.execution_plan_sha256.as_str(),
        receipt.post_film_pre_view_sha256.as_str(),
        receipt.display_or_output_profile_sha256.as_str(),
        receipt.preview_artifact_sha256.as_str(),
        receipt.export_artifact_sha256.as_str(),
    ];
    if receipt.contract != "rapidraw.film_runtime_proof.v1"
        || receipt.proof_level != "native_private_raw_preview_export"
        || receipt.working_space != "acescg_linear_v1"
        || !matches!(receipt.backend.as_str(), "gpu" | "cpu_fallback")
        || !matches!(
            receipt.quality.as_str(),
            "settled_preview_v1" | "export_full_v1"
        )
        || receipt.input_profile_id.trim().is_empty()
        || receipt.view_transform_id.trim().is_empty()
        || receipt.gamut_mapper_id.trim().is_empty()
        || receipt.film_profile_ref.content_sha256 != receipt.film_profile_content_sha256
        || hashes.iter().any(|value| !is_sha256(value))
        || receipt
            .color_sync_display_profile_sha256
            .as_deref()
            .is_some_and(|value| !is_sha256(value))
        || receipt
            .limitation_codes
            .iter()
            .any(|value| value.trim().is_empty())
        || (receipt.color_sync_display_profile_sha256.is_none()
            && !receipt
                .limitation_codes
                .iter()
                .any(|value| value == "display_transform_unverified"))
    {
        return Err("film_runtime_proof_receipt_invalid");
    }
    validate_metrics(&receipt.preview_export_metrics)
}

fn is_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> FilmRuntimeProofMetricsV1 {
        FilmRuntimeProofMetricsV1 {
            changed_pixel_ratio: 0.42,
            preview_export_mean_abs_delta: 0.001,
            post_film_pre_view_hash_equal: true,
            source_hash_unchanged: true,
            save_reopen_film_node_hash_equal: true,
        }
    }

    #[test]
    fn accepts_private_runtime_parity_metrics() {
        assert_eq!(validate_metrics(&valid()), Ok(()));
    }

    #[test]
    fn rejects_identity_or_tolerance_failure() {
        let mut metrics = valid();
        metrics.post_film_pre_view_hash_equal = false;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_runtime_proof_identity_mismatch")
        );
        let mut metrics = valid();
        metrics.preview_export_mean_abs_delta = 0.02;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_runtime_proof_metrics_invalid")
        );
        let mut metrics = valid();
        metrics.save_reopen_film_node_hash_equal = false;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_runtime_proof_identity_mismatch")
        );
    }

    #[test]
    fn receipt_requires_current_identity_and_truthful_colorsync_limitation() {
        let hash = format!("sha256:{}", "a".repeat(64));
        let receipt = FilmRuntimeProofReceiptV1 {
            contract: "rapidraw.film_runtime_proof.v1".into(),
            proof_level: "native_private_raw_preview_export".into(),
            source_content_sha256: hash.clone(),
            raw_decode_receipt_sha256: hash.clone(),
            input_profile_id: "camera.input.reference.v1".into(),
            input_profile_sha256: hash.clone(),
            working_space: "acescg_linear_v1".into(),
            film_profile_ref: FilmEmulationProfileRef {
                id: "rapidraw.reference_film.v1".into(),
                version: "1".into(),
                content_sha256: hash.clone(),
            },
            film_profile_content_sha256: hash.clone(),
            film_node_sha256: hash.clone(),
            compiled_profile_sha256: hash.clone(),
            execution_plan_sha256: hash.clone(),
            backend: "gpu".into(),
            quality: "export_full_v1".into(),
            post_film_pre_view_sha256: hash.clone(),
            view_transform_id: "rawengine_agx_v1".into(),
            gamut_mapper_id: "rawengine.gamut.srgb-oklab-chroma-reduce.v4".into(),
            display_or_output_profile_sha256: hash.clone(),
            color_sync_display_profile_sha256: None,
            preview_artifact_sha256: hash.clone(),
            export_artifact_sha256: hash,
            preview_export_metrics: valid(),
            limitation_codes: vec!["display_transform_unverified".into()],
        };
        assert_eq!(validate_receipt(&receipt), Ok(()));
        let mut missing_limitation = receipt;
        missing_limitation.limitation_codes.clear();
        assert_eq!(
            validate_receipt(&missing_limitation),
            Err("film_runtime_proof_receipt_invalid")
        );
    }
}
