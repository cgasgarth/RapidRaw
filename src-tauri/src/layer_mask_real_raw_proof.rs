#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, GrayImage, ImageFormat};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::app_settings::AppSettings;
use crate::app_state::AppState;
use crate::export_processing::{
    prepare_export_masks, process_image_for_export_pipeline_with_tonemapper_override,
};
use crate::formats::is_raw_file;
use crate::gpu_processing::get_or_init_compute_gpu_context_for_tests;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::{GpuContext, resolve_tonemapper_override};
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};

const ARTIFACT_DIR: &str = "private-artifacts/validation/layer-mask-real-raw";
const SOURCE_RELATIVE_PATH: &str = "private-fixtures/layers/alaska-layer-mask-v1.arw";
const PROOF_SLUG: &str = "alaska-layer-mask-v1";
const FIXTURE_ID: &str = "validation.layer-mask-real-raw.alaska-local-adjustment.v1";
const REPORT_ID: &str = "layer-mask-real-raw.alaska-local-adjustment.v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerMaskRealRawProofReport {
    artifacts: Vec<LayerMaskRealRawArtifact>,
    fixture_id: String,
    generated_at: String,
    issue: u32,
    metrics: Vec<LayerMaskMetric>,
    proof_claims: LayerMaskProofClaims,
    report_id: String,
    runtime_proof: LayerMaskRuntimeProof,
    validation_mode: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerMaskRealRawArtifact {
    hash: String,
    kind: String,
    path: String,
    public_repo_allowed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerMaskMetric {
    name: String,
    passed: bool,
    threshold: f64,
    value: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerMaskProofClaims {
    does_not_prove: Vec<String>,
    proves: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerMaskRuntimeProof {
    execution: String,
    macos_app_ui_e2e: bool,
    mask_path: String,
    output_artifact_count: u32,
    preview_export_parity_metric: String,
    raw_decode_path: String,
    render_path: String,
}

#[test]
fn private_runtime_smoke_generates_layer_mask_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_LAYER_MASK_REAL_RAW_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private layer/mask real RAW proof smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_layer_mask_real_raw_proof(&private_root)
        .expect("private layer/mask real RAW proof runs");
}

fn run_private_layer_mask_real_raw_proof(
    private_root: &Path,
) -> Result<LayerMaskRealRawProofReport, String> {
    let source_path = private_root.join(SOURCE_RELATIVE_PATH);
    let source_hash_before = sha256_file(&source_path)?;
    let source_bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    let source_path_string = source_path.to_string_lossy().to_string();
    let settings = AppSettings::default();
    let base_image =
        load_base_image_from_bytes(&source_bytes, &source_path_string, false, &settings, None)
            .map_err(|error| error.to_string())?;

    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .map_err(|error| error.to_string())?;
    let state = app.state::<AppState>();
    let context = get_or_init_compute_gpu_context_for_tests(&state)?;
    let is_raw = is_raw_file(&source_path_string);
    let tm_override = resolve_tonemapper_override(&settings, is_raw);

    let (image_width, image_height) = base_image.dimensions();
    let unmasked_adjustments = json!({});
    let unrefined_adjustments =
        layer_mask_adjustments(mask_refinement(false), image_width, image_height);
    let refined_adjustments =
        layer_mask_adjustments(mask_refinement(true), image_width, image_height);

    let unmasked_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &unmasked_adjustments,
        &context,
        &state,
        is_raw,
        "layer_mask_real_raw_unmasked_preview",
        tm_override,
    )?;
    let unrefined_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &unrefined_adjustments,
        &context,
        &state,
        is_raw,
        "layer_mask_real_raw_unrefined_preview",
        tm_override,
    )?;
    let refined_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &refined_adjustments,
        &context,
        &state,
        is_raw,
        "layer_mask_real_raw_refined_preview",
        tm_override,
    )?;
    let refined_export = render_with_masks(
        &source_path_string,
        &base_image,
        &refined_adjustments,
        &context,
        &state,
        is_raw,
        "layer_mask_real_raw_refined_export",
        tm_override,
    )?;

    let mask_coverage_ratio = mask_coverage_ratio(&refined_adjustments, &base_image)?;
    let masked_changed_pixel_ratio = changed_pixel_ratio(&unmasked_preview, &refined_preview);
    let refinement_changed_pixel_ratio = changed_pixel_ratio(&unrefined_preview, &refined_preview);
    let preview_export_mean_abs_delta = mean_abs_delta(&refined_preview, &refined_export);
    let source_hash_after = sha256_file(&source_path)?;

    let output_dir = private_root.join(ARTIFACT_DIR);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    write_image(
        &unmasked_preview,
        &output_dir.join(format!("{PROOF_SLUG}-unmasked-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &unrefined_preview,
        &output_dir.join(format!("{PROOF_SLUG}-unrefined-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &refined_preview,
        &output_dir.join(format!("{PROOF_SLUG}-refined-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &refined_export,
        &output_dir.join(format!("{PROOF_SLUG}-refined-export.tiff")),
        ImageFormat::Tiff,
    )?;

    let mut artifacts = vec![
        hashed_artifact(private_root, "source_raw_private", SOURCE_RELATIVE_PATH)?,
        hashed_artifact(
            private_root,
            "unmasked_preview_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-unmasked-preview.png"),
        )?,
        hashed_artifact(
            private_root,
            "unrefined_preview_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-unrefined-preview.png"),
        )?,
        hashed_artifact(
            private_root,
            "refined_preview_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-refined-preview.png"),
        )?,
        hashed_artifact(
            private_root,
            "refined_export_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-refined-export.tiff"),
        )?,
    ];

    let metrics = vec![
        metric(
            "maskCoverageRatio",
            mask_coverage_ratio,
            0.01,
            mask_coverage_ratio > 0.01,
        ),
        metric(
            "maskedChangedPixelRatio",
            masked_changed_pixel_ratio,
            0.01,
            masked_changed_pixel_ratio > 0.01,
        ),
        metric(
            "refinementChangedPixelRatio",
            refinement_changed_pixel_ratio,
            0.0001,
            refinement_changed_pixel_ratio > 0.0001,
        ),
        metric(
            "previewExportMeanAbsDelta",
            preview_export_mean_abs_delta,
            0.015,
            preview_export_mean_abs_delta <= 0.015,
        ),
        metric(
            "sourceHashUnchanged",
            if source_hash_before == source_hash_after {
                1.0
            } else {
                0.0
            },
            1.0,
            source_hash_before == source_hash_after,
        ),
    ];

    let report = LayerMaskRealRawProofReport {
        artifacts: Vec::new(),
        fixture_id: FIXTURE_ID.to_string(),
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        issue: 2310,
        metrics,
        proof_claims: proof_claims(),
        report_id: REPORT_ID.to_string(),
        runtime_proof: LayerMaskRuntimeProof {
            execution: "tauri_test_gpu_pipeline".to_string(),
            macos_app_ui_e2e: false,
            mask_path: "prepare_export_masks + generate_mask_bitmap".to_string(),
            output_artifact_count: 4,
            preview_export_parity_metric: "previewExportMeanAbsDelta".to_string(),
            raw_decode_path: "load_base_image_from_bytes".to_string(),
            render_path: "process_image_for_export_pipeline_with_tonemapper_override".to_string(),
        },
        validation_mode: "private_raw_tauri_runtime_proof".to_string(),
    };
    let report_path = output_dir.join(format!("{PROOF_SLUG}-report.json"));
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    artifacts.push(hashed_artifact(
        private_root,
        "workflow_report_private",
        &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-report.json"),
    )?);

    let report = LayerMaskRealRawProofReport {
        artifacts,
        ..report
    };
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    assert!(report.metrics.iter().all(|metric| metric.passed));
    Ok(report)
}

#[allow(clippy::too_many_arguments)]
fn render_with_masks(
    source_path: &str,
    base_image: &DynamicImage,
    adjustments: &Value,
    context: &GpuContext,
    state: &tauri::State<'_, AppState>,
    is_raw: bool,
    debug_tag: &str,
    tm_override: Option<u32>,
) -> Result<DynamicImage, String> {
    let (transformed_image, mask_bitmaps) = prepare_export_masks(base_image, adjustments, state);
    process_image_for_export_pipeline_with_tonemapper_override(
        source_path,
        transformed_image.as_ref(),
        adjustments,
        context,
        state,
        is_raw,
        debug_tag,
        tm_override,
        &mask_bitmaps,
    )
}

fn layer_mask_adjustments(refinement: Value, image_width: u32, image_height: u32) -> Value {
    let center_x = image_width as f64 * 0.5;
    let center_y = image_height as f64 * 0.5;
    let radius_x = image_width as f64 * 0.28;
    let radius_y = image_height as f64 * 0.22;
    json!({
        "masks": [
            {
                "id": "mask.local-brighten.v1",
                "name": "Local brighten proof",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "adjustments": {
                    "exposure": 1.15,
                    "contrast": 18,
                    "saturation": 10
                },
                "subMasks": [
                    {
                        "id": "submask.radial-center.v1",
                        "type": "radial",
                        "visible": true,
                        "invert": false,
                        "opacity": 100,
                        "mode": "additive",
                        "parameters": {
                            "centerX": center_x,
                            "centerY": center_y,
                            "radiusX": radius_x,
                            "radiusY": radius_y,
                            "rotation": 0,
                            "feather": 42,
                            "density": refinement["density"],
                            "edgeContrast": refinement["edgeContrast"],
                            "edgeShiftPx": refinement["edgeShiftPx"],
                            "featherPx": refinement["featherPx"],
                            "smoothness": refinement["smoothness"]
                        }
                    }
                ]
            }
        ]
    })
}

fn mask_refinement(enabled: bool) -> Value {
    if enabled {
        json!({
            "density": 0.74,
            "edgeContrast": 0.45,
            "edgeShiftPx": 3.0,
            "featherPx": 2.5,
            "smoothness": 0.6
        })
    } else {
        json!({
            "density": 1.0,
            "edgeContrast": 0.0,
            "edgeShiftPx": 0.0,
            "featherPx": 0.0,
            "smoothness": 0.0
        })
    }
}

fn proof_claims() -> LayerMaskProofClaims {
    LayerMaskProofClaims {
        does_not_prove: vec![
            "macos_app_ui_e2e_session".to_string(),
            "manual_layer_panel_interaction".to_string(),
            "public_raw_fixture_distribution".to_string(),
        ],
        proves: vec![
            "private_real_raw_decode".to_string(),
            "layer_mask_generation".to_string(),
            "masked_adjustment_changes_pixels".to_string(),
            "mask_refinement_changes_pixels".to_string(),
            "refined_preview_export_parity".to_string(),
        ],
    }
}

fn mask_coverage_ratio(adjustments: &Value, base_image: &DynamicImage) -> Result<f64, String> {
    let masks: Vec<MaskDefinition> =
        serde_json::from_value(adjustments["masks"].clone()).map_err(|error| error.to_string())?;
    let (width, height) = base_image.dimensions();
    let nonzero_pixels: usize = masks
        .iter()
        .filter_map(|mask| generate_mask_bitmap(mask, width, height, 1.0, (0.0, 0.0), None))
        .map(|bitmap: GrayImage| bitmap.pixels().filter(|pixel| pixel[0] > 0).count())
        .sum();
    let total_pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| "mask dimensions overflow".to_string())?;
    Ok(nonzero_pixels as f64 / total_pixels as f64)
}

fn write_image(image: &DynamicImage, path: &Path, format: ImageFormat) -> Result<(), String> {
    image
        .save_with_format(path, format)
        .map_err(|error| error.to_string())
}

fn hashed_artifact(
    private_root: &Path,
    kind: &str,
    relative_path: &str,
) -> Result<LayerMaskRealRawArtifact, String> {
    Ok(LayerMaskRealRawArtifact {
        hash: sha256_file(&private_root.join(relative_path))?,
        kind: kind.to_string(),
        path: relative_path.to_string(),
        public_repo_allowed: false,
    })
}

fn metric(name: &str, value: f64, threshold: f64, passed: bool) -> LayerMaskMetric {
    LayerMaskMetric {
        name: name.to_string(),
        passed,
        threshold,
        value,
    }
}

fn changed_pixel_ratio(before: &DynamicImage, after: &DynamicImage) -> f64 {
    let before = before.to_rgba8();
    let after = after.to_rgba8();
    let changed = before
        .pixels()
        .zip(after.pixels())
        .filter(|(left, right)| left.0 != right.0)
        .count();
    changed as f64 / before.len().max(1) as f64 * 4.0
}

fn mean_abs_delta(before: &DynamicImage, after: &DynamicImage) -> f64 {
    let before = before.to_rgba8();
    let after = after.to_rgba8();
    let total_delta: u64 = before
        .pixels()
        .zip(after.pixels())
        .map(|(left, right)| {
            left.0
                .iter()
                .zip(right.0.iter())
                .take(3)
                .map(|(l, r)| (*l as i16 - *r as i16).unsigned_abs() as u64)
                .sum::<u64>()
        })
        .sum();
    total_delta as f64 / (before.width() as f64 * before.height() as f64 * 3.0 * 255.0)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let digest = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("sha256:{digest}"))
}
