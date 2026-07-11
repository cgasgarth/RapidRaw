use serde::{Deserialize, Serialize};

use crate::merge::tile_runtime::{DEFAULT_MEMORY_BUDGET_BYTES, TileHalo, TilePlanRequest, plan_tiles};

pub const SOURCE_MODE: &str = "single_image_ai";
const SCHEMA_VERSION: u32 = 1;
const CAPABILITY_ID: &str = "swinir_classical_x2_onnx_preview_v1";
const BUILD_FEATURE: &str = "single-image-swinir-x2-preview";
const UPSTREAM_REPOSITORY: &str = "JingyunLiang/SwinIR";
const UPSTREAM_COMMIT: &str = "6545850fbf8df298df73d81f3e8cba638787c8bd";
const SOURCE_LICENSE_SPDX: &str = "Apache-2.0";
const CHECKPOINT_FILENAME: &str = "001_classicalSR_DIV2K_s48w8_SwinIR-M_x2.pth";
const MODEL_INPUT_CONTRACT: &str = "encoded_srgb_nchw_f32_unit_v1";
const BASELINE_CONTRACT: &str = "scene_linear_bicubic_mitchell_x2_v1";
const RESIDUAL_CONTRACT: &str = "encoded_srgb_residual_scene_linear_guarded_v1";
const TILING_CONTRACT: &str = "swinir_x2_overlap_raised_cosine_row_major_v1";
const PUBLICATION_CONTRACT: &str = "temp_package_stale_check_atomic_rename_v1";
const REVIEW_CONTRACT: &str = "single_image_sr_manual_review_v1";
const CORE_TILE_LR_PX: u32 = 256;
const CONTEXT_HALO_LR_PX: u32 = 64;
const BLEND_OVERLAP_LR_PX: u32 = 64;
const HIGHLIGHT_GUARD_LOW_LINEAR: f32 = -0.02;
const HIGHLIGHT_GUARD_HIGH_LINEAR: f32 = 1.25;
const MANIFEST_JSON: &str = include_str!("../../../../tools/models/swinir/manifest.json");

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelManifest {
    schema_version: u32,
    capability_id: String,
    source_code: ManifestSourceCode,
    checkpoint: ManifestCheckpoint,
    onnx_model: ManifestOnnxModel,
    distribution: ManifestDistribution,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestSourceCode {
    repository: String,
    commit: String,
    license_spdx: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestCheckpoint {
    filename: String,
    redistribution_status: String,
    license_evidence: Option<String>,
    sha256: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestOnnxModel {
    artifact_status: String,
    bytes: Option<u64>,
    download_url: Option<String>,
    format: String,
    input_name: String,
    opset: u32,
    output_name: String,
    scale: u32,
    sha256: Option<String>,
    window_size: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestDistribution {
    build_feature: String,
    block_codes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleImageSwinIrPreviewPlan {
    schema_version: u32,
    mode: &'static str,
    status: &'static str,
    accepted: bool,
    block_codes: Vec<String>,
    capability: SingleImageSwinIrCapability,
    job_id: Option<String>,
    probe_only: bool,
    publication: Option<SingleImageSwinIrPreviewPublication>,
    source_count: usize,
    warning_codes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SingleImageSwinIrCapability {
    schema_version: u32,
    capability_id: &'static str,
    status: &'static str,
    build: CapabilityBuild,
    source_code: CapabilitySourceCode,
    checkpoint: CapabilityCheckpoint,
    onnx_model: CapabilityOnnxModel,
    contracts: CapabilityContracts,
    block_codes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityBuild {
    feature_name: &'static str,
    feature_enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilitySourceCode {
    repository: String,
    commit: String,
    license_spdx: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityCheckpoint {
    filename: String,
    redistribution_status: String,
    license_evidence: Option<String>,
    sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityOnnxModel {
    artifact_status: String,
    bytes: Option<u64>,
    download_url: Option<String>,
    format: String,
    input_name: String,
    opset: u32,
    output_name: String,
    scale: u32,
    sha256: Option<String>,
    window_size: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityContracts {
    baseline: &'static str,
    blend_overlap_lr_px: u32,
    context_halo_lr_px: u32,
    core_tile_lr_px: u32,
    highlight_guard_high_linear: f32,
    highlight_guard_low_linear: f32,
    model_input: &'static str,
    publication: &'static str,
    residual: &'static str,
    review: &'static str,
    tiling: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SingleImageSwinIrPreviewPublication {
    artifact_id: String,
    height: u32,
    model_sha256: String,
    output_content_hash: String,
    plan_hash: String,
    preview_data_url: String,
    review: SingleImageSwinIrPreviewReview,
    runtime: &'static str,
    source_content_hash: String,
    source_graph_revision: String,
    tile_count: u64,
    tile_plan_hash: String,
    width: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SingleImageSwinIrPreviewReview {
    color_delta_mean: f32,
    downscale_mae: f32,
    edge_ringing_score: f32,
    manual_review_required: bool,
    passed_automatic_checks: bool,
    seam_max_abs: f32,
}

pub fn plan(paths: &[String]) -> Result<SingleImageSwinIrPreviewPlan, String> {
    validate_contract_invariants()?;
    let capability = build_capability()?;
    let mut block_codes = capability.block_codes.clone();
    if paths.len() != 1 {
        block_codes.push("single_image_source_count_must_be_one".to_string());
    }
    block_codes.sort();
    block_codes.dedup();

    Ok(SingleImageSwinIrPreviewPlan {
        schema_version: SCHEMA_VERSION,
        mode: SOURCE_MODE,
        status: "capability_disabled",
        accepted: false,
        block_codes,
        capability,
        job_id: None,
        probe_only: true,
        publication: None,
        source_count: paths.len(),
        warning_codes: vec![
            "manual_review_required".to_string(),
            "preview_only_no_apply_export".to_string(),
        ],
    })
}

fn build_capability() -> Result<SingleImageSwinIrCapability, String> {
    let manifest: ModelManifest = serde_json::from_str(MANIFEST_JSON)
        .map_err(|error| format!("single_image_swinir_manifest_invalid:{error}"))?;
    validate_manifest(&manifest)?;

    let mut block_codes = manifest.distribution.block_codes.clone();
    if !cfg!(feature = "single-image-swinir-x2-preview") {
        block_codes.push("build_capability_disabled".to_string());
    }
    block_codes.sort();
    block_codes.dedup();

    Ok(SingleImageSwinIrCapability {
        schema_version: SCHEMA_VERSION,
        capability_id: CAPABILITY_ID,
        status: "disabled",
        build: CapabilityBuild {
            feature_name: BUILD_FEATURE,
            feature_enabled: cfg!(feature = "single-image-swinir-x2-preview"),
        },
        source_code: CapabilitySourceCode {
            repository: manifest.source_code.repository,
            commit: manifest.source_code.commit,
            license_spdx: manifest.source_code.license_spdx,
        },
        checkpoint: CapabilityCheckpoint {
            filename: manifest.checkpoint.filename,
            redistribution_status: manifest.checkpoint.redistribution_status,
            license_evidence: manifest.checkpoint.license_evidence,
            sha256: manifest.checkpoint.sha256,
        },
        onnx_model: CapabilityOnnxModel {
            artifact_status: manifest.onnx_model.artifact_status,
            bytes: manifest.onnx_model.bytes,
            download_url: manifest.onnx_model.download_url,
            format: manifest.onnx_model.format,
            input_name: manifest.onnx_model.input_name,
            opset: manifest.onnx_model.opset,
            output_name: manifest.onnx_model.output_name,
            scale: manifest.onnx_model.scale,
            sha256: manifest.onnx_model.sha256,
            window_size: manifest.onnx_model.window_size,
        },
        contracts: CapabilityContracts {
            baseline: BASELINE_CONTRACT,
            blend_overlap_lr_px: BLEND_OVERLAP_LR_PX,
            context_halo_lr_px: CONTEXT_HALO_LR_PX,
            core_tile_lr_px: CORE_TILE_LR_PX,
            highlight_guard_high_linear: HIGHLIGHT_GUARD_HIGH_LINEAR,
            highlight_guard_low_linear: HIGHLIGHT_GUARD_LOW_LINEAR,
            model_input: MODEL_INPUT_CONTRACT,
            publication: PUBLICATION_CONTRACT,
            residual: RESIDUAL_CONTRACT,
            review: REVIEW_CONTRACT,
            tiling: TILING_CONTRACT,
        },
        block_codes,
    })
}

fn validate_manifest(manifest: &ModelManifest) -> Result<(), String> {
    let identity_matches = manifest.schema_version == SCHEMA_VERSION
        && manifest.capability_id == CAPABILITY_ID
        && manifest.source_code.repository == UPSTREAM_REPOSITORY
        && manifest.source_code.commit == UPSTREAM_COMMIT
        && manifest.source_code.license_spdx == SOURCE_LICENSE_SPDX
        && manifest.checkpoint.filename == CHECKPOINT_FILENAME
        && manifest.distribution.build_feature == BUILD_FEATURE;
    if !identity_matches {
        return Err("single_image_swinir_manifest_identity_mismatch".to_string());
    }
    if manifest.checkpoint.redistribution_status == "unproven"
        && (manifest.checkpoint.license_evidence.is_some()
            || manifest.checkpoint.sha256.is_some()
            || manifest.onnx_model.sha256.is_some()
            || manifest.onnx_model.download_url.is_some())
    {
        return Err("single_image_swinir_unproven_manifest_published_artifact".to_string());
    }
    if manifest.checkpoint.redistribution_status != "unproven" {
        return Err("single_image_swinir_release_approval_requires_runtime_review".to_string());
    }
    if manifest.onnx_model.artifact_status != "not_approved" {
        return Err("single_image_swinir_onnx_artifact_must_remain_unapproved".to_string());
    }
    Ok(())
}

fn validate_contract_invariants() -> Result<(), String> {
    let middle = 0.18_f32;
    let encoded = scene_linear_to_model_srgb(middle)?;
    let decoded = model_srgb_to_scene_linear(encoded)?;
    if (decoded - middle).abs() > 2.0e-6 {
        return Err("single_image_swinir_srgb_roundtrip_contract_failed".to_string());
    }
    if residual_guard_weight([0.5, 0.5, 0.5])? != 1.0
        || residual_guard_weight([HIGHLIGHT_GUARD_HIGH_LINEAR, 0.5, 0.5])? != 0.0
        || residual_guard_weight([HIGHLIGHT_GUARD_LOW_LINEAR, 0.5, 0.5])? != 0.0
    {
        return Err("single_image_swinir_highlight_guard_contract_failed".to_string());
    }
    let guarded = compose_scene_linear_residual(
        [HIGHLIGHT_GUARD_HIGH_LINEAR, 0.8, 0.6],
        [0.9, 0.9, 0.9],
        [0.7, 0.7, 0.7],
    )?;
    if guarded != [HIGHLIGHT_GUARD_HIGH_LINEAR, 0.8, 0.6] {
        return Err("single_image_swinir_extended_highlight_contract_failed".to_string());
    }
    if mitchell_netravali(0.0) <= 0.0 || mitchell_netravali(2.0) != 0.0 {
        return Err("single_image_swinir_bicubic_contract_failed".to_string());
    }

    let plan = plan_tiles(TilePlanRequest {
        schema_version: 1,
        output_width: 513,
        output_height: 389,
        bytes_per_working_pixel: 64,
        source_count: 1,
        requested_core_width: CORE_TILE_LR_PX,
        requested_core_height: CORE_TILE_LR_PX,
        halo: TileHalo {
            top: CONTEXT_HALO_LR_PX,
            right: CONTEXT_HALO_LR_PX,
            bottom: CONTEXT_HALO_LR_PX,
            left: CONTEXT_HALO_LR_PX,
        },
        memory_budget_bytes: Some(DEFAULT_MEMORY_BUDGET_BYTES),
    })?;
    if plan.tile_count != 6
        || plan.reduction_order != "source_then_row_major_tile"
        || plan.tiles.iter().enumerate().any(|(index, tile)| tile.index != index as u64)
    {
        return Err("single_image_swinir_tile_order_contract_failed".to_string());
    }
    let left = raised_cosine_axis_weight(0, 128, 64, 0)?;
    let center = raised_cosine_axis_weight(64, 128, 64, 0)?;
    if !(left > 0.0 && left < center && (center - 1.0).abs() < f64::EPSILON) {
        return Err("single_image_swinir_blend_window_contract_failed".to_string());
    }
    Ok(())
}

fn scene_linear_to_model_srgb(linear: f32) -> Result<f32, String> {
    if !linear.is_finite() {
        return Err("single_image_swinir_non_finite_scene_linear".to_string());
    }
    let value = linear.clamp(0.0, 1.0);
    Ok(if value <= 0.003_130_8 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    })
}

fn model_srgb_to_scene_linear(encoded: f32) -> Result<f32, String> {
    if !encoded.is_finite() {
        return Err("single_image_swinir_non_finite_encoded_srgb".to_string());
    }
    let value = encoded.clamp(0.0, 1.0);
    Ok(if value <= 0.040_45 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    })
}

fn residual_guard_weight(baseline_scene_linear: [f32; 3]) -> Result<f32, String> {
    baseline_scene_linear
        .into_iter()
        .map(channel_residual_guard_weight)
        .try_fold(1.0_f32, |weight, channel| channel.map(|value| weight.min(value)))
}

fn channel_residual_guard_weight(value: f32) -> Result<f32, String> {
    if !value.is_finite() {
        return Err("single_image_swinir_non_finite_baseline".to_string());
    }
    if value <= HIGHLIGHT_GUARD_LOW_LINEAR || value >= HIGHLIGHT_GUARD_HIGH_LINEAR {
        return Ok(0.0);
    }
    if value < 0.0 {
        return Ok(raised_cosine_unit(
            (value - HIGHLIGHT_GUARD_LOW_LINEAR) / -HIGHLIGHT_GUARD_LOW_LINEAR,
        ) as f32);
    }
    if value <= 1.0 {
        return Ok(1.0);
    }
    Ok(raised_cosine_unit(
        (HIGHLIGHT_GUARD_HIGH_LINEAR - value) / (HIGHLIGHT_GUARD_HIGH_LINEAR - 1.0),
    ) as f32)
}

fn compose_scene_linear_residual(
    baseline_scene_linear: [f32; 3],
    model_encoded_srgb: [f32; 3],
    model_baseline_encoded_srgb: [f32; 3],
) -> Result<[f32; 3], String> {
    let weight = residual_guard_weight(baseline_scene_linear)?;
    let mut output = [0.0_f32; 3];
    for channel in 0..3 {
        let model = model_srgb_to_scene_linear(model_encoded_srgb[channel])?;
        let model_baseline = model_srgb_to_scene_linear(model_baseline_encoded_srgb[channel])?;
        output[channel] = baseline_scene_linear[channel] + weight * (model - model_baseline);
        if !output[channel].is_finite() {
            return Err("single_image_swinir_non_finite_composite".to_string());
        }
    }
    Ok(output)
}

fn raised_cosine_axis_weight(
    pixel: usize,
    extent: usize,
    left_overlap: usize,
    right_overlap: usize,
) -> Result<f64, String> {
    if extent == 0 || pixel >= extent || left_overlap > extent || right_overlap > extent {
        return Err("single_image_swinir_invalid_blend_window".to_string());
    }
    let center = pixel as f64 + 0.5;
    let mut weight = 1.0_f64;
    if left_overlap > 0 && center < left_overlap as f64 {
        weight *= raised_cosine_unit((center / left_overlap as f64) as f32);
    }
    if right_overlap > 0 && center > (extent - right_overlap) as f64 {
        weight *= raised_cosine_unit(((extent as f64 - center) / right_overlap as f64) as f32);
    }
    Ok(weight)
}

fn raised_cosine_unit(value: f32) -> f64 {
    let value = f64::from(value.clamp(0.0, 1.0));
    0.5 - 0.5 * (std::f64::consts::PI * value).cos()
}

fn mitchell_netravali(distance: f32) -> f32 {
    let x = distance.abs();
    let b = 1.0_f32 / 3.0;
    let c = 1.0_f32 / 3.0;
    if x < 1.0 {
        ((12.0 - 9.0 * b - 6.0 * c) * x.powi(3)
            + (-18.0 + 12.0 * b + 6.0 * c) * x.powi(2)
            + (6.0 - 2.0 * b))
            / 6.0
    } else if x < 2.0 {
        ((-b - 6.0 * c) * x.powi(3)
            + (6.0 * b + 30.0 * c) * x.powi(2)
            + (-12.0 * b - 48.0 * c) * x
            + (8.0 * b + 24.0 * c))
            / 6.0
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_license_does_not_enable_unproven_checkpoint() {
        let capability = build_capability().expect("parse capability manifest");
        assert_eq!(capability.source_code.license_spdx, "Apache-2.0");
        assert_eq!(capability.checkpoint.redistribution_status, "unproven");
        assert_eq!(capability.checkpoint.license_evidence, None);
        assert_eq!(capability.checkpoint.sha256, None);
        assert_eq!(capability.onnx_model.download_url, None);
        assert_eq!(capability.status, "disabled");
        assert!(
            capability
                .block_codes
                .contains(&"checkpoint_redistribution_rights_unproven".to_string())
        );
    }

    #[test]
    fn disabled_plan_never_starts_or_publishes() {
        let plan = plan(&["opaque-source-handle".to_string()]).expect("build disabled plan");
        assert!(!plan.accepted);
        assert_eq!(plan.status, "capability_disabled");
        assert!(plan.job_id.is_none());
        assert!(plan.publication.is_none());
    }

    #[test]
    fn source_count_is_exactly_one() {
        let empty = plan(&[]).expect("build empty plan");
        assert!(
            empty
                .block_codes
                .contains(&"single_image_source_count_must_be_one".to_string())
        );
        let many = plan(&["a".to_string(), "b".to_string()]).expect("build multi-source plan");
        assert!(
            many
                .block_codes
                .contains(&"single_image_source_count_must_be_one".to_string())
        );
    }

    #[test]
    fn encoded_srgb_scene_linear_residual_preserves_extended_highlights() {
        let baseline = [1.25, 0.9, 0.8];
        let output = compose_scene_linear_residual(baseline, [1.0, 1.0, 1.0], [0.5, 0.5, 0.5])
            .expect("compose residual");
        assert_eq!(output, baseline);

        let in_gamut = [0.5, 0.4, 0.3];
        let output = compose_scene_linear_residual(in_gamut, [0.8, 0.8, 0.8], [0.7, 0.7, 0.7])
            .expect("compose in-gamut residual");
        assert!(output.iter().zip(in_gamut).all(|(value, base)| *value > base));
    }

    #[test]
    fn raised_cosine_blend_is_deterministic_and_boundary_safe() {
        let weights = (0..128)
            .map(|pixel| raised_cosine_axis_weight(pixel, 128, 64, 64).expect("weight"))
            .collect::<Vec<_>>();
        assert!(weights.iter().all(|weight| weight.is_finite() && *weight > 0.0));
        assert!((weights[0] - weights[127]).abs() < 1.0e-12);
        assert!((weights[63] - weights[64]).abs() < 1.0e-12);
    }

    #[test]
    fn odd_dimensions_keep_row_major_bounded_tile_plan() {
        let tile_plan = plan_tiles(TilePlanRequest {
            schema_version: 1,
            output_width: 777,
            output_height: 521,
            bytes_per_working_pixel: 64,
            source_count: 1,
            requested_core_width: CORE_TILE_LR_PX,
            requested_core_height: CORE_TILE_LR_PX,
            halo: TileHalo {
                top: CONTEXT_HALO_LR_PX,
                right: CONTEXT_HALO_LR_PX,
                bottom: CONTEXT_HALO_LR_PX,
                left: CONTEXT_HALO_LR_PX,
            },
            memory_budget_bytes: Some(DEFAULT_MEMORY_BUDGET_BYTES),
        })
        .expect("tile plan");
        assert_eq!(tile_plan.columns, 4);
        assert_eq!(tile_plan.rows, 3);
        assert_eq!(tile_plan.tile_count, 12);
        assert!(tile_plan.memory.estimated_peak_bytes <= tile_plan.memory_budget_bytes);
        assert_eq!(tile_plan.tiles.last().expect("last tile").core_width, 9);
        assert_eq!(tile_plan.tiles.last().expect("last tile").core_height, 9);
    }

    #[test]
    #[ignore = "private Alaska fixture is only exercised after checkpoint rights and an ONNX artifact are approved"]
    fn private_alaska_native_proof_remains_fail_closed() {
        let fixture = std::env::var("RAWENGINE_PRIVATE_ALASKA_SINGLE_IMAGE_PATH")
            .expect("set RAWENGINE_PRIVATE_ALASKA_SINGLE_IMAGE_PATH for the private proof");
        let plan = plan(&[fixture]).expect("build Alaska plan");
        assert_eq!(plan.status, "capability_disabled");
        assert!(plan.job_id.is_none());
        assert!(plan.publication.is_none());
    }
}
