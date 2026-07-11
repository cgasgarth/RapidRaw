use std::fs;
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;

use crate::app_state::{PendingHdrMergePlan, PendingHdrSourceRef};
use crate::derived_output_provenance::{
    DerivedOutputProvenanceInput, DerivedOutputProvenanceSource,
    build_derived_output_provenance_sidecar, stable_hash,
};
use crate::formats::is_raw_file;
use crate::image_processing::{ImageMetadata, RawEngineArtifacts};

const HDR_ENGINE_ID: &str = crate::merge::hdr::runtime::ENGINE_ID;
const HDR_ENGINE_BACKEND_TYPE: &str = crate::merge::hdr::runtime::BACKEND_ID;
const HDR_ENGINE_VERSION: &str = "1.0.0";
const HDR_GRAPH_REVISION: &str = "hdr_scene_linear_runtime_v1";
const HDR_MERGE_METHOD: &str = "noise_saturation_weighted_radiance";
const HDR_MERGE_STRATEGY: &str = "scene_linear_radiance";
const HDR_MERGE_VERSION: &str = "1.0.0";
const HDR_WORKING_COLOR_SPACE: &str = "acescg_ap1_scene_linear_v1";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HdrDryRunDimensionReport {
    pub height: u32,
    pub width: u32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HdrDryRunExposureReport {
    pub exposure_ev: f32,
    pub exposure_time_seconds: f32,
    pub iso: f32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HdrDryRunSourceReport {
    pub content_hash: String,
    pub dimensions: HdrDryRunDimensionReport,
    pub exposure: HdrDryRunExposureReport,
    pub path: String,
    pub source_index: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HdrDryRunExposureSpacingReport {
    pub max_step_ev: f32,
    pub min_step_ev: f32,
    pub span_ev: f32,
    pub step_count: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HdrDryRunEstimatedMemoryReport {
    pub merge_buffer_mb: u64,
    pub preview_buffer_mb: u64,
    pub total_mb: u64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct HdrDryRunPlanResponse {
    pub accepted: bool,
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    pub block_codes: Vec<String>,
    pub bracket_count: usize,
    pub dimension_warnings: Vec<String>,
    pub estimated_memory: HdrDryRunEstimatedMemoryReport,
    pub exposure_spacing: Option<HdrDryRunExposureSpacingReport>,
    pub metadata_warnings: Vec<String>,
    pub preview_dimensions: HdrDryRunDimensionReport,
    pub source_paths: Vec<String>,
    pub sources: Vec<HdrDryRunSourceReport>,
    pub warning_codes: Vec<String>,
}

#[cfg(test)]
pub fn build_unique_hdr_output_path(parent_dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let first_candidate = parent_dir.join(format!("{}_Hdr.{}", stem, extension));
    if !first_candidate.exists() {
        return first_candidate;
    }

    for suffix in 2..10_000 {
        let candidate = parent_dir.join(format!("{}_Hdr_{}.{}", stem, suffix, extension));
        if !candidate.exists() {
            return candidate;
        }
    }

    parent_dir.join(format!(
        "{}_Hdr_{}.{}",
        stem,
        Uuid::new_v4().simple(),
        extension
    ))
}

pub fn build_hdr_runtime_plan(
    source_refs: &[PendingHdrSourceRef],
    output_width: u32,
    output_height: u32,
) -> PendingHdrMergePlan {
    let plan_source_state = source_refs
        .iter()
        .map(|source| {
            serde_json::json!({
                "exposureTimeSeconds": source.exposure_time_seconds,
                "height": source.height,
                "imagePath": source.image_path.clone(),
                "iso": source.iso,
                "sourceIndex": source.source_index,
                "width": source.width,
            })
        })
        .collect::<Vec<_>>();
    let plan_payload = serde_json::json!({
        "engineId": HDR_ENGINE_ID,
        "mergeStrategy": HDR_MERGE_STRATEGY,
        "outputDimensions": {
            "height": output_height,
            "width": output_width,
        },
        "schemaVersion": 1,
        "sourceState": plan_source_state,
        "workingColorSpace": HDR_WORKING_COLOR_SPACE,
    });
    let plan_bytes = serde_json::to_vec(&plan_payload).unwrap_or_default();
    let plan_hash_hex = blake3::hash(&plan_bytes).to_hex().to_string();
    let plan_id_suffix = &plan_hash_hex[..16];

    PendingHdrMergePlan {
        accepted_dry_run_plan_hash: format!("blake3:{}", plan_hash_hex),
        accepted_dry_run_plan_id: format!("hdr_runtime_plan_{}", plan_id_suffix),
        alignment_policy_id: "legacy_display_referred_v1".to_string(),
        source_content_hashes: source_refs
            .iter()
            .map(|source| source.content_hash.clone())
            .collect(),
        source_paths: source_refs
            .iter()
            .map(|source| source.image_path.clone())
            .collect(),
        static_radiance_hash: None,
        deghost_radiance_hash: None,
        motion_probability_hash: None,
        ownership_hash: None,
        feather_hash: None,
        unresolved_fraction: None,
        output_width: u64::from(output_width),
        output_height: u64::from(output_height),
        planned_sources: Vec::new(),
        motion_probability_bytes: Vec::new(),
        ownership_bytes: Vec::new(),
        feather_bytes: Vec::new(),
        scene_linear_artifact_hash: None,
        tone_mapped_preview_hash: None,
        motion_coverage: None,
        confidence_mean: None,
    }
}

#[allow(dead_code)]
pub fn build_hdr_dry_run_plan_response(
    source_refs: &[PendingHdrSourceRef],
    output_width: u32,
    output_height: u32,
) -> HdrDryRunPlanResponse {
    let runtime_plan = build_hdr_runtime_plan(source_refs, output_width, output_height);
    let block_codes = build_hdr_dry_run_block_codes(source_refs);
    let dimension_warnings = build_hdr_dry_run_dimension_warnings(source_refs);
    let metadata_warnings = build_hdr_dry_run_metadata_warnings(source_refs);
    let warning_codes = build_hdr_dry_run_warning_codes(&dimension_warnings, &metadata_warnings);
    let estimated_memory =
        build_hdr_dry_run_estimated_memory(source_refs, output_width, output_height);

    HdrDryRunPlanResponse {
        accepted: block_codes.is_empty(),
        accepted_dry_run_plan_hash: runtime_plan.accepted_dry_run_plan_hash,
        accepted_dry_run_plan_id: runtime_plan.accepted_dry_run_plan_id,
        block_codes,
        bracket_count: source_refs.len(),
        dimension_warnings,
        estimated_memory,
        exposure_spacing: build_hdr_dry_run_exposure_spacing(source_refs),
        metadata_warnings,
        preview_dimensions: HdrDryRunDimensionReport {
            height: output_height,
            width: output_width,
        },
        source_paths: source_refs
            .iter()
            .map(|source| source.image_path.clone())
            .collect(),
        sources: source_refs
            .iter()
            .map(|source| HdrDryRunSourceReport {
                content_hash: source.content_hash.clone(),
                dimensions: HdrDryRunDimensionReport {
                    height: source.height,
                    width: source.width,
                },
                exposure: HdrDryRunExposureReport {
                    exposure_ev: source.exposure_time_seconds.log2(),
                    exposure_time_seconds: source.exposure_time_seconds,
                    iso: source.iso,
                },
                path: source.image_path.clone(),
                source_index: source.source_index,
            })
            .collect(),
        warning_codes,
    }
}

fn build_hdr_dry_run_block_codes(source_refs: &[PendingHdrSourceRef]) -> Vec<String> {
    let mut blocks = Vec::new();
    if source_refs.len() < 2 {
        blocks.push("insufficient_bracket_count".to_string());
    }
    if source_refs.iter().any(|source| {
        source.width == 0
            || source.height == 0
            || source.exposure_time_seconds <= 0.0
            || source.iso <= 0.0
    }) {
        blocks.push("missing_required_exposure_metadata".to_string());
    }
    if has_hdr_dimension_mismatch(source_refs) {
        blocks.push("dimension_mismatch".to_string());
    }
    blocks
}

fn build_hdr_dry_run_dimension_warnings(source_refs: &[PendingHdrSourceRef]) -> Vec<String> {
    if has_hdr_dimension_mismatch(source_refs) {
        vec!["source_dimensions_do_not_match".to_string()]
    } else {
        Vec::new()
    }
}

fn build_hdr_dry_run_metadata_warnings(source_refs: &[PendingHdrSourceRef]) -> Vec<String> {
    let mut warnings = Vec::new();
    if source_refs
        .iter()
        .any(|source| source.exposure_time_seconds <= 0.0 || source.iso <= 0.0)
    {
        warnings.push("missing_exposure_metadata".to_string());
    }
    if build_hdr_dry_run_exposure_spacing(source_refs)
        .map(|spacing| spacing.span_ev < 0.5)
        .unwrap_or(false)
    {
        warnings.push("narrow_exposure_span".to_string());
    }
    warnings
}

fn build_hdr_dry_run_warning_codes(
    dimension_warnings: &[String],
    metadata_warnings: &[String],
) -> Vec<String> {
    dimension_warnings
        .iter()
        .chain(metadata_warnings.iter())
        .cloned()
        .collect()
}

fn build_hdr_dry_run_exposure_spacing(
    source_refs: &[PendingHdrSourceRef],
) -> Option<HdrDryRunExposureSpacingReport> {
    if source_refs.len() < 2 {
        return None;
    }

    let mut exposure_evs = source_refs
        .iter()
        .map(|source| source.exposure_time_seconds.log2())
        .filter(|exposure_ev| exposure_ev.is_finite())
        .collect::<Vec<_>>();
    if exposure_evs.len() < 2 {
        return None;
    }

    exposure_evs.sort_by(|left, right| left.total_cmp(right));
    let steps = exposure_evs
        .windows(2)
        .map(|window| window[1] - window[0])
        .collect::<Vec<_>>();
    let min_step_ev = steps.iter().copied().fold(f32::INFINITY, f32::min);
    let max_step_ev = steps.iter().copied().fold(f32::NEG_INFINITY, f32::max);

    Some(HdrDryRunExposureSpacingReport {
        max_step_ev,
        min_step_ev,
        span_ev: exposure_evs.last().copied().unwrap_or(0.0)
            - exposure_evs.first().copied().unwrap_or(0.0),
        step_count: steps.len(),
    })
}

fn build_hdr_dry_run_estimated_memory(
    source_refs: &[PendingHdrSourceRef],
    output_width: u32,
    output_height: u32,
) -> HdrDryRunEstimatedMemoryReport {
    let source_pixels = source_refs
        .iter()
        .map(|source| u64::from(source.width) * u64::from(source.height))
        .sum::<u64>();
    let output_pixels = u64::from(output_width) * u64::from(output_height);
    let merge_buffer_mb = bytes_to_mb(source_pixels * 16);
    let preview_buffer_mb = bytes_to_mb(output_pixels * 4);

    HdrDryRunEstimatedMemoryReport {
        merge_buffer_mb,
        preview_buffer_mb,
        total_mb: merge_buffer_mb + preview_buffer_mb,
    }
}

fn has_hdr_dimension_mismatch(source_refs: &[PendingHdrSourceRef]) -> bool {
    source_refs.first().is_some_and(|first| {
        source_refs
            .iter()
            .skip(1)
            .any(|source| source.width != first.width || source.height != first.height)
    })
}

fn bytes_to_mb(bytes: u64) -> u64 {
    bytes.div_ceil(1_048_576)
}

pub fn write_hdr_output_sidecar(
    output_path: &Path,
    source_refs: &[PendingHdrSourceRef],
    runtime_plan: &PendingHdrMergePlan,
    output_width: u32,
    output_height: u32,
) -> Result<(), String> {
    let sidecar_path = output_path.with_file_name(format!(
        "{}.rrdata",
        output_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ));
    let output_identity = output_path.to_string_lossy();
    let mut sidecar = crate::exif_processing::load_sidecar_recovering(
        &sidecar_path,
        Some(output_identity.as_ref()),
    )?
    .metadata;
    upsert_hdr_artifact_metadata(
        &mut sidecar,
        output_path,
        source_refs,
        runtime_plan,
        output_width,
        output_height,
    )?;
    crate::exif_processing::save_sidecar_metadata_atomic(&sidecar_path, &sidecar)
}

fn upsert_hdr_artifact_metadata(
    sidecar: &mut ImageMetadata,
    output_path: &Path,
    source_refs: &[PendingHdrSourceRef],
    runtime_plan: &PendingHdrMergePlan,
    output_width: u32,
    output_height: u32,
) -> Result<(), String> {
    let artifact_id = format!("artifact_hdr_{}", Uuid::new_v4().simple());
    let output_artifact_id = format!("{}_output", artifact_id);
    let output_hash = hash_hdr_output_file(output_path)?;
    let reference_index = source_refs.len() / 2;
    let source_image_refs = source_refs
        .iter()
        .map(|source| {
            serde_json::json!({
                "colorSpaceHint": if is_raw_file(&source.image_path) { "camera_rgb" } else { "linear_rgb" },
                "exposureEv": source.exposure_time_seconds.log2(),
                "imagePath": source.image_path.clone(),
                "rawDefaultsApplied": is_raw_file(&source.image_path),
                "role": "hdr_bracket",
                "sourceIndex": source.source_index,
            })
        })
        .collect::<Vec<_>>();
    let source_metadata = runtime_plan
        .planned_sources
        .iter()
        .map(|source| {
            serde_json::json!({
                "aperture": source.frame.exposure.aperture,
                "blackLevels": source.frame.calibration.black_levels,
                "cameraMake": source.frame.camera_make,
                "cameraModel": source.frame.camera_model,
                "cfaPattern": source.frame.cfa_pattern,
                "exposureScale": source.frame.exposure.exposure_scale,
                "exposureTimeSeconds": source.frame.exposure.exposure_time_seconds,
                "height": source.frame.height,
                "imagePath": source.frame.path,
                "iso": source.frame.exposure.iso,
                "rawBlackLevelKnown": true,
                "rawWhiteLevelKnown": true,
                "resolvedBracketRole": if source.frame.source_index == reference_index {
                    "reference"
                } else if source.frame.source_index < reference_index {
                    "under_exposed"
                } else {
                    "over_exposed"
                },
                "resolvedExposureEv": source.frame.exposure.exposure_scale.log2(),
                "sourceIndex": source.frame.source_index,
                "whiteBalanceComparable": true,
                "whiteBalance": source.frame.calibration.white_balance,
                "whiteLevels": source.frame.calibration.white_levels,
                "width": source.frame.width,
            })
        })
        .collect::<Vec<_>>();
    let transforms = runtime_plan
        .planned_sources
        .iter()
        .map(|source| {
            serde_json::json!({
                "confidence": source.alignment.confidence,
                "matrix": source.alignment.matrix,
                "overlapFraction": source.alignment.overlap_fraction,
                "residualP95": source.alignment.residual_p95,
                "residualRms": source.alignment.residual_rms,
                "sourceIndex": source.frame.source_index,
                "transformType": source.alignment.model,
            })
        })
        .collect::<Vec<_>>();
    let clipped_metrics = source_refs
        .iter()
        .map(|source| {
            serde_json::json!({
                "clippedHighRatio": 0.0,
                "nearClippedHighRatio": 0.0,
                "sourceIndex": source.source_index,
            })
        })
        .collect::<Vec<_>>();
    let source_state = source_refs
        .iter()
        .map(|source| {
            serde_json::json!({
                "contentHash": source.content_hash,
                "graphRevision": HDR_GRAPH_REVISION,
                "resolvedExposureEv": source.exposure_time_seconds.log2(),
                "sourceIndex": source.source_index,
            })
        })
        .collect::<Vec<_>>();

    let settings_hash = stable_hash(&serde_json::json!({
        "deghosting": "source_ownership_feather",
        "engineId": HDR_ENGINE_ID,
        "mergeStrategy": HDR_MERGE_STRATEGY,
        "outputEncoding": "scene_linear_half_float",
        "previewToneMapped": true,
        "workingColorSpace": HDR_WORKING_COLOR_SPACE,
    }));
    let provenance_sources = source_refs
        .iter()
        .map(|source| DerivedOutputProvenanceSource {
            content_hash: source.content_hash.clone(),
            graph_revision: HDR_GRAPH_REVISION,
            path: &source.image_path,
        })
        .collect::<Vec<_>>();
    let derived_output_provenance =
        build_derived_output_provenance_sidecar(DerivedOutputProvenanceInput {
            accepted_apply_id: Some(&artifact_id),
            accepted_dry_run_id: Some(&runtime_plan.accepted_dry_run_plan_id),
            family: "hdr",
            output_artifact_id: &output_artifact_id,
            output_content_hash: &output_hash,
            output_path,
            settings_hash,
            sources: provenance_sources,
            warnings: Vec::new(),
        });

    let artifact = serde_json::json!({
        "alignment": {
            "alignmentConfidence": runtime_plan.planned_sources.iter().map(|source| source.alignment.confidence).sum::<f32>() / runtime_plan.planned_sources.len().max(1) as f32,
            "referenceSourceIndex": reference_index,
            "rejectedSourceIndexes": [],
            "requestedAlignmentMode": "auto",
            "resolvedAlignmentMode": "bounded_translation",
            "transforms": transforms,
        },
        "artifactId": artifact_id,
        "blockCodes": [],
        "bracketDetection": {
            "accepted": true,
            "blockCodes": [],
            "bracketSpanEv": 0.0,
            "detectionConfidence": 0.7,
            "detectionMethod": "metadata_exposure_time_iso_aperture",
            "referenceSourceIndex": reference_index,
            "sourceMetadata": source_metadata,
            "warningCodes": [],
        },
        "createdAt": Utc::now().to_rfc3339(),
        "deghosting": {
            "masks": [
                {"contentHash": runtime_plan.motion_probability_hash, "kind": "motion_probability", "path": "maps/motion-probability.bin"},
                {"contentHash": runtime_plan.ownership_hash, "kind": "deghost_selection", "path": "maps/source-selection.bin"},
                {"contentHash": runtime_plan.feather_hash, "kind": "confidence_feather", "path": "maps/confidence-feather.bin"}
            ],
            "motionCoverageRatio": runtime_plan.motion_coverage.unwrap_or(0.0),
            "motionRisk": if runtime_plan.motion_coverage.unwrap_or(0.0) > 0.02 { "present" } else { "low" },
            "confidenceMean": runtime_plan.confidence_mean.unwrap_or(1.0),
            "referenceSourceIndex": reference_index,
            "requestedDeghosting": "medium",
            "resolvedDeghosting": "source_ownership_feather",
        },
        "displayPreviewColorState": "tone_mapped_srgb_preview",
        "mergeMethod": HDR_MERGE_METHOD,
        "mergeVersion": HDR_MERGE_VERSION,
        "dryRun": {
            "acceptedDryRunPlanHash": runtime_plan.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": runtime_plan.accepted_dry_run_plan_id,
        },
        "editableDerivedAssetId": artifact_id,
        "engine": {
            "backendType": HDR_ENGINE_BACKEND_TYPE,
            "capabilityLevel": "runtime_apply_capable",
            "engineId": HDR_ENGINE_ID,
            "engineVersion": HDR_ENGINE_VERSION,
        },
        "exportColorState": "scene_linear_editable_with_tone_map_recipe",
        "family": "hdr",
        "highlightRecovery": {
            "clippedInputPixelRatioBySource": clipped_metrics,
            "highlightDetailGainRatio": 1.0,
            "recoveredHighlightPixelRatio": 0.0,
            "shadowNoiseAmplificationRisk": "unknown",
            "unrecoveredClippedPixelRatio": 0.0,
        },
        "mergeStrategy": HDR_MERGE_STRATEGY,
        "outputArtifact": {
            "artifactId": output_artifact_id,
            "contentHash": output_hash,
            "dimensions": {
                "height": output_height,
                "width": output_width,
            },
            "kind": "merge_output",
            "storage": "sidecar_artifact",
        },
        "outputColorSpace": HDR_WORKING_COLOR_SPACE,
        "outputEncoding": "scene_linear_half_float",
        "outputName": output_path.file_name().unwrap_or_default().to_string_lossy(),
        "previewArtifacts": [],
        "previewExportParity": {
            "comparedArtifacts": ["tone_mapped_preview", "scene_linear_editable_payload"],
            "meanAbsDelta": null,
            "status": "recipe_separated_from_scene_linear_payload",
        },
        "previewToneMapped": true,
        "schemaVersion": 1,
        "sceneMergeColorState": "scene_linear",
        "sceneLinearArtifactHash": runtime_plan.scene_linear_artifact_hash,
        "previewToneMap": {"algorithmId": "global_reinhard_review_v1", "exposure": 1.0, "previewHash": runtime_plan.tone_mapped_preview_hash},
        "sourceImageRefs": source_image_refs,
        "sourceState": source_state,
        "staleState": {
            "checkedAt": Utc::now().to_rfc3339(),
            "invalidationReasons": [],
            "state": "current",
        },
        "warningCodes": [],
        "workingColorSpace": HDR_WORKING_COLOR_SPACE,
    });

    let artifacts = sidecar
        .raw_engine_artifacts
        .get_or_insert_with(RawEngineArtifacts::new_v1);
    artifacts.schema_version = 1;
    artifacts.hdr_merge_artifacts.push(artifact);
    artifacts
        .derived_output_provenance_sidecars
        .push(derived_output_provenance);
    artifacts.stale_artifact_ids.retain(|id| !id.is_empty());
    Ok(())
}

fn hash_hdr_output_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|e| format!("Failed to read HDR output for artifact hash: {}", e))?;
    Ok(format!("blake3:{}", blake3::hash(&bytes).to_hex()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hdr_source_ref(
        path: String,
        source_index: usize,
        exposure_time_seconds: f32,
    ) -> PendingHdrSourceRef {
        PendingHdrSourceRef {
            content_hash: format!("blake3:source-hash-{}", source_index),
            image_path: path,
            width: 64,
            height: 48,
            exposure_time_seconds,
            iso: 100.0,
            source_index,
        }
    }

    #[test]
    fn hdr_output_path_does_not_overwrite_existing_merge() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let first_output = temp_dir.path().join("IMG_0001_Hdr.png");
        fs::write(&first_output, b"existing hdr").expect("existing HDR output should be written");

        let output_path = build_unique_hdr_output_path(temp_dir.path(), "IMG_0001", "png");

        assert_eq!(output_path, temp_dir.path().join("IMG_0001_Hdr_2.png"));
        assert_ne!(output_path, first_output);
    }

    #[test]
    fn hdr_runtime_plan_is_deterministic_for_merge_sources() {
        let source_refs = vec![
            hdr_source_ref("/tmp/IMG_0001.CR3".to_string(), 0, 0.125),
            hdr_source_ref("/tmp/IMG_0002.CR3".to_string(), 1, 0.25),
        ];

        let first_plan = build_hdr_runtime_plan(&source_refs, 64, 48);
        let second_plan = build_hdr_runtime_plan(&source_refs, 64, 48);

        assert_eq!(
            first_plan.accepted_dry_run_plan_id,
            second_plan.accepted_dry_run_plan_id
        );
        assert_eq!(
            first_plan.accepted_dry_run_plan_hash,
            second_plan.accepted_dry_run_plan_hash
        );
        assert!(
            first_plan
                .accepted_dry_run_plan_id
                .starts_with("hdr_runtime_plan_")
        );
        assert!(first_plan.accepted_dry_run_plan_hash.starts_with("blake3:"));
    }

    #[test]
    fn hdr_dry_run_plan_reports_synthetic_bracket_warnings_and_blocks() {
        let mut source_refs = vec![
            hdr_source_ref("/tmp/IMG_0001_-1ev.tif".to_string(), 0, 0.125),
            hdr_source_ref("/tmp/IMG_0002_0ev.tif".to_string(), 1, 0.25),
            hdr_source_ref("/tmp/IMG_0003_+1ev.tif".to_string(), 2, 0.5),
        ];
        source_refs[2].height = 47;

        let dry_run = build_hdr_dry_run_plan_response(&source_refs, 64, 48);

        assert!(!dry_run.accepted);
        assert_eq!(dry_run.bracket_count, 3);
        assert!(
            dry_run
                .block_codes
                .contains(&"dimension_mismatch".to_string())
        );
        assert!(
            dry_run
                .dimension_warnings
                .contains(&"source_dimensions_do_not_match".to_string())
        );
        assert_eq!(dry_run.exposure_spacing.unwrap().span_ev, 2.0);
        assert!(dry_run.estimated_memory.total_mb > 0);
        assert!(dry_run.accepted_dry_run_plan_hash.starts_with("blake3:"));
        assert!(
            dry_run
                .accepted_dry_run_plan_id
                .starts_with("hdr_runtime_plan_")
        );
    }

    #[test]
    fn write_hdr_output_sidecar_records_editable_artifact_provenance() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let output_path = temp_dir.path().join("IMG_0001_Hdr.png");
        fs::write(&output_path, b"hdr-output").expect("output should be written");
        let source_refs = vec![
            hdr_source_ref(
                temp_dir
                    .path()
                    .join("IMG_0001.CR3")
                    .to_string_lossy()
                    .into_owned(),
                0,
                0.125,
            ),
            hdr_source_ref(
                temp_dir
                    .path()
                    .join("IMG_0002.CR3")
                    .to_string_lossy()
                    .into_owned(),
                1,
                0.25,
            ),
        ];
        let runtime_plan = build_hdr_runtime_plan(&source_refs, 64, 48);

        write_hdr_output_sidecar(&output_path, &source_refs, &runtime_plan, 64, 48)
            .expect("HDR sidecar should be written");

        let sidecar_path = output_path.with_file_name("IMG_0001_Hdr.png.rrdata");
        let serialized_sidecar: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&sidecar_path).expect("HDR sidecar JSON should be readable"),
        )
        .expect("HDR sidecar JSON should parse");
        let sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        let artifacts = sidecar
            .raw_engine_artifacts
            .expect("raw engine artifacts should be present");
        assert_eq!(artifacts.schema_version, 1);
        assert_eq!(artifacts.hdr_merge_artifacts.len(), 1);

        let artifact = &artifacts.hdr_merge_artifacts[0];
        assert_eq!(artifact["family"], "hdr");
        assert_eq!(
            artifact["engine"]["backendType"],
            "deterministic_cpu_tiles_v1"
        );
        assert_eq!(
            artifact["engine"]["capabilityLevel"],
            "runtime_apply_capable"
        );
        assert_eq!(artifact["mergeMethod"], HDR_MERGE_METHOD);
        assert_eq!(artifact["mergeVersion"], HDR_MERGE_VERSION);
        assert_eq!(
            artifact["dryRun"]["acceptedDryRunPlanId"],
            runtime_plan.accepted_dry_run_plan_id
        );
        assert_eq!(
            artifact["dryRun"]["acceptedDryRunPlanHash"],
            runtime_plan.accepted_dry_run_plan_hash
        );
        assert_eq!(artifact["outputName"], "IMG_0001_Hdr.png");
        assert_eq!(artifact["outputArtifact"]["storage"], "sidecar_artifact");
        assert_eq!(artifact["outputArtifact"]["dimensions"]["width"], 64);
        assert_eq!(artifact["outputArtifact"]["dimensions"]["height"], 48);
        assert!(
            artifact["outputArtifact"]["contentHash"]
                .as_str()
                .unwrap()
                .starts_with("blake3:")
        );
        assert_eq!(artifact["staleState"]["state"], "current");
        assert_eq!(artifact["warningCodes"], serde_json::json!([]));
        assert_eq!(artifact["sceneMergeColorState"], "scene_linear");
        assert_eq!(
            artifact["displayPreviewColorState"],
            "tone_mapped_srgb_preview"
        );
        assert_eq!(
            artifact["exportColorState"],
            "scene_linear_editable_with_tone_map_recipe"
        );
        assert_eq!(
            artifact["previewExportParity"]["status"],
            "recipe_separated_from_scene_linear_payload"
        );
        assert!(artifact["previewExportParity"]["meanAbsDelta"].is_null());
        assert_eq!(artifact["sourceImageRefs"].as_array().unwrap().len(), 2);
        assert_eq!(
            serialized_sidecar["rawEngineArtifacts"]["hdrMergeArtifacts"][0]["sourceState"][0]["contentHash"],
            "blake3:source-hash-0"
        );
        assert_eq!(
            serialized_sidecar["rawEngineArtifacts"]["derivedOutputProvenanceSidecars"][0]["sourceState"]
                [0]["contentHash"],
            "blake3:source-hash-0"
        );
        assert_ne!(
            serialized_sidecar["rawEngineArtifacts"]["hdrMergeArtifacts"][0]["sourceState"][0]["contentHash"],
            format!("path:{}", source_refs[0].image_path)
        );
    }
}
