use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use uuid::Uuid;

use crate::app_state::{PendingHdrMergePlan, PendingHdrSourceRef};
use crate::derived_output_provenance::{
    DerivedOutputProvenanceInput, DerivedOutputProvenanceSource,
    build_derived_output_provenance_sidecar, stable_hash,
};
use crate::formats::is_raw_file;
use crate::image_processing::{ImageMetadata, RawEngineArtifacts};

const HDR_ENGINE_ID: &str = "rapidraw_image_hdr_legacy_v1";
const HDR_ENGINE_BACKEND_TYPE: &str = "legacy_image_hdr";
const HDR_ENGINE_VERSION: &str = "0.1.0";
const HDR_GRAPH_REVISION: &str = "hdr_legacy_runtime_v1";
const HDR_MERGE_STRATEGY: &str = "exposure_fusion_preview";
const HDR_WORKING_COLOR_SPACE: &str = "srgb_display_referred_v1";
const HDR_WARNING_TONE_MAPPED_PREVIEW_ONLY: &str = "tone_mapped_preview_only";

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
    }
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
    let mut sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
    upsert_hdr_artifact_metadata(
        &mut sidecar,
        output_path,
        source_refs,
        runtime_plan,
        output_width,
        output_height,
    )?;
    let json = serde_json::to_string_pretty(&sidecar)
        .map_err(|e| format!("Failed to serialize HDR sidecar: {}", e))?;
    fs::write(&sidecar_path, json).map_err(|e| {
        format!(
            "Failed to write HDR sidecar {}: {}",
            sidecar_path.display(),
            e
        )
    })
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
    let source_metadata = source_refs
        .iter()
        .map(|source| {
            serde_json::json!({
                "exposureTimeSeconds": source.exposure_time_seconds,
                "height": source.height,
                "imagePath": source.image_path.clone(),
                "iso": source.iso,
                "rawBlackLevelKnown": false,
                "rawWhiteLevelKnown": false,
                "resolvedBracketRole": if source.source_index == reference_index {
                    "reference"
                } else if source.source_index < reference_index {
                    "under_exposed"
                } else {
                    "over_exposed"
                },
                "resolvedExposureEv": source.exposure_time_seconds.log2(),
                "sourceIndex": source.source_index,
                "whiteBalanceComparable": false,
                "width": source.width,
            })
        })
        .collect::<Vec<_>>();
    let transforms = source_refs
        .iter()
        .map(|source| {
            serde_json::json!({
                "confidence": if source.source_index == reference_index { 1.0 } else { 0.7 },
                "sourceIndex": source.source_index,
                "transformType": "identity",
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
        "deghosting": "off",
        "engineId": HDR_ENGINE_ID,
        "mergeStrategy": HDR_MERGE_STRATEGY,
        "outputEncoding": "display_referred_preview",
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
            warnings: vec![HDR_WARNING_TONE_MAPPED_PREVIEW_ONLY],
        });

    let artifact = serde_json::json!({
        "alignment": {
            "alignmentConfidence": 0.7,
            "referenceSourceIndex": reference_index,
            "rejectedSourceIndexes": [],
            "requestedAlignmentMode": "none",
            "resolvedAlignmentMode": "none",
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
            "warningCodes": [HDR_WARNING_TONE_MAPPED_PREVIEW_ONLY],
        },
        "createdAt": Utc::now().to_rfc3339(),
        "deghosting": {
            "masks": [],
            "motionCoverageRatio": 0.0,
            "motionRisk": "none",
            "referenceSourceIndex": reference_index,
            "requestedDeghosting": "off",
            "resolvedDeghosting": "off",
        },
        "displayPreviewColorState": "tone_mapped_srgb_preview",
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
        "exportColorState": "saved_display_referred_srgb_output",
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
        "outputEncoding": "display_referred_preview",
        "outputName": output_path.file_name().unwrap_or_default().to_string_lossy(),
        "previewArtifacts": [],
        "previewExportParity": {
            "comparedArtifacts": ["display_preview_buffer", "saved_output_file"],
            "meanAbsDelta": 0.0,
            "status": "matched_editor_display_path",
        },
        "previewToneMapped": true,
        "schemaVersion": 1,
        "sceneMergeColorState": "legacy_display_referred_merge_after_linear_to_srgb",
        "sourceImageRefs": source_image_refs,
        "sourceState": source_state,
        "staleState": {
            "checkedAt": Utc::now().to_rfc3339(),
            "invalidationReasons": [],
            "state": "current",
        },
        "warningCodes": [HDR_WARNING_TONE_MAPPED_PREVIEW_ONLY],
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
        assert_eq!(artifact["engine"]["backendType"], "legacy_image_hdr");
        assert_eq!(
            artifact["engine"]["capabilityLevel"],
            "runtime_apply_capable"
        );
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
        assert_eq!(artifact["warningCodes"][0], "tone_mapped_preview_only");
        assert_eq!(
            artifact["sceneMergeColorState"],
            "legacy_display_referred_merge_after_linear_to_srgb"
        );
        assert_eq!(
            artifact["displayPreviewColorState"],
            "tone_mapped_srgb_preview"
        );
        assert_eq!(
            artifact["exportColorState"],
            "saved_display_referred_srgb_output"
        );
        assert_eq!(
            artifact["previewExportParity"]["status"],
            "matched_editor_display_path"
        );
        assert_eq!(artifact["previewExportParity"]["meanAbsDelta"], 0.0);
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
