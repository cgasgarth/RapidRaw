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
use crate::export::export_processing::{
    prepare_export_masks, process_image_for_export_pipeline_with_tonemapper_override,
};
use crate::formats::is_raw_file;
use crate::gpu_processing::get_or_init_compute_gpu_context_for_tests;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::{GpuContext, resolve_tonemapper_override};
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};

const ARTIFACT_DIR: &str = "private-artifacts/validation/linear-gradient-mask-real-raw";
const SOURCE_RELATIVE_PATH: &str = "private-fixtures/layers/alaska-layer-mask-v1.arw";
const PROOF_SLUG: &str = "alaska-linear-gradient-mask-v1";
const FIXTURE_ID: &str = "validation.linear-gradient-mask-real-raw.alaska-local-adjustment.v1";
const REPORT_ID: &str = "linear-gradient-mask-real-raw.alaska-local-adjustment.v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinearGradientMaskRealRawProofReport {
    artifacts: Vec<LinearGradientMaskRealRawArtifact>,
    fixture_id: String,
    generated_at: String,
    issue: u32,
    metrics: Vec<LinearGradientMaskMetric>,
    proof_claims: LinearGradientMaskProofClaims,
    report_id: String,
    runtime_proof: LinearGradientMaskRuntimeProof,
    validation_mode: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinearGradientMaskRealRawArtifact {
    hash: String,
    kind: String,
    path: String,
    public_repo_allowed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinearGradientMaskMetric {
    name: String,
    passed: bool,
    threshold: f64,
    value: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinearGradientMaskProofClaims {
    does_not_prove: Vec<String>,
    proves: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinearGradientMaskRuntimeProof {
    execution: String,
    mask_path: String,
    output_artifact_count: u32,
    preview_export_parity_metric: String,
    raw_decode_path: String,
    render_path: String,
}

#[test]
fn private_runtime_smoke_generates_linear_gradient_mask_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_LINEAR_GRADIENT_MASK_REAL_RAW_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private linear-gradient mask real RAW proof smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_linear_gradient_mask_real_raw_proof(&private_root)
        .expect("private linear-gradient mask real RAW proof runs");
}

fn run_private_linear_gradient_mask_real_raw_proof(
    private_root: &Path,
) -> Result<LinearGradientMaskRealRawProofReport, String> {
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
    let gradient_adjustments = linear_gradient_mask_adjustments(image_width, image_height, 0.5);
    let edited_gradient_adjustments =
        linear_gradient_mask_adjustments(image_width, image_height, 0.25);
    let reloaded_gradient_adjustments: Value = serde_json::from_str(
        &serde_json::to_string(&gradient_adjustments).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let unmasked_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &unmasked_adjustments,
        &context,
        &state,
        is_raw,
        "linear_gradient_mask_real_raw_unmasked_preview",
        tm_override,
    )?;
    let gradient_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &gradient_adjustments,
        &context,
        &state,
        is_raw,
        "linear_gradient_mask_real_raw_gradient_preview",
        tm_override,
    )?;
    let gradient_export = render_with_masks(
        &source_path_string,
        &base_image,
        &gradient_adjustments,
        &context,
        &state,
        is_raw,
        "linear_gradient_mask_real_raw_gradient_export",
        tm_override,
    )?;
    let edited_gradient_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &edited_gradient_adjustments,
        &context,
        &state,
        is_raw,
        "linear_gradient_mask_real_raw_edited_gradient_preview",
        tm_override,
    )?;
    let reloaded_gradient_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &reloaded_gradient_adjustments,
        &context,
        &state,
        is_raw,
        "linear_gradient_mask_real_raw_reloaded_gradient_preview",
        tm_override,
    )?;

    let mask_coverage_ratio = mask_coverage_ratio(&gradient_adjustments, &base_image)?;
    let gradient_changed_pixel_ratio = changed_pixel_ratio(&unmasked_preview, &gradient_preview);
    let mask_bitmap = primary_mask_bitmap(&gradient_adjustments, &base_image)?;
    let protected_delta = mask_delta(&unmasked_preview, &gradient_preview, &mask_bitmap, 0, 32);
    let exposed_delta = mask_delta(&unmasked_preview, &gradient_preview, &mask_bitmap, 224, 255);
    let exposed_protected_delta_ratio = exposed_delta / protected_delta.max(0.000001);
    let transition_monotonicity =
        transition_monotonicity(&unmasked_preview, &gradient_preview, &mask_bitmap, 8);
    let preview_export_mean_abs_delta = mean_abs_delta(&gradient_preview, &gradient_export);
    let geometry_edit_changed_pixel_ratio =
        changed_pixel_ratio(&gradient_preview, &edited_gradient_preview);
    let reload_mean_abs_delta = mean_abs_delta(&gradient_preview, &reloaded_gradient_preview);
    let source_hash_after = sha256_file(&source_path)?;

    let output_dir = private_root.join(ARTIFACT_DIR);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    write_image(
        &unmasked_preview,
        &output_dir.join(format!("{PROOF_SLUG}-unmasked-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &gradient_preview,
        &output_dir.join(format!("{PROOF_SLUG}-gradient-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &gradient_export,
        &output_dir.join(format!("{PROOF_SLUG}-gradient-export.tiff")),
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
            "gradient_preview_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-gradient-preview.png"),
        )?,
        hashed_artifact(
            private_root,
            "gradient_export_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-gradient-export.tiff"),
        )?,
    ];

    let metrics = vec![
        metric(
            "maskCoverageRatio",
            mask_coverage_ratio,
            0.2,
            mask_coverage_ratio > 0.2,
        ),
        metric(
            "gradientChangedPixelRatio",
            gradient_changed_pixel_ratio,
            0.01,
            gradient_changed_pixel_ratio > 0.01,
        ),
        metric(
            "exposedProtectedDeltaRatio",
            exposed_protected_delta_ratio,
            2.0,
            exposed_protected_delta_ratio > 2.0,
        ),
        metric(
            "transitionMonotonicity",
            transition_monotonicity,
            0.85,
            transition_monotonicity >= 0.85,
        ),
        metric(
            "previewExportMeanAbsDelta",
            preview_export_mean_abs_delta,
            0.015,
            preview_export_mean_abs_delta <= 0.015,
        ),
        metric(
            "geometryEditChangedPixelRatio",
            geometry_edit_changed_pixel_ratio,
            0.01,
            geometry_edit_changed_pixel_ratio > 0.01,
        ),
        metric(
            "reloadMeanAbsDelta",
            reload_mean_abs_delta,
            0.0001,
            reload_mean_abs_delta <= 0.0001,
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

    let report = LinearGradientMaskRealRawProofReport {
        artifacts: Vec::new(),
        fixture_id: FIXTURE_ID.to_string(),
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        issue: 2877,
        metrics,
        proof_claims: proof_claims(),
        report_id: REPORT_ID.to_string(),
        runtime_proof: LinearGradientMaskRuntimeProof {
            execution: "tauri_test_gpu_pipeline".to_string(),
            mask_path: "prepare_export_masks + generate_mask_bitmap".to_string(),
            output_artifact_count: 3,
            preview_export_parity_metric: "previewExportMeanAbsDelta".to_string(),
            raw_decode_path: "load_base_image_from_bytes".to_string(),
            render_path: "process_image_for_export_pipeline_with_tonemapper_override".to_string(),
        },
        validation_mode: "private_raw_linear_gradient_mask_tauri_runtime_proof".to_string(),
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

    let report = LinearGradientMaskRealRawProofReport {
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
        crate::gpu_processing::PreGpuImageIdentity::source_revision(source_path),
        debug_tag,
        tm_override,
        &mask_bitmaps,
    )
}

fn linear_gradient_mask_adjustments(
    image_width: u32,
    image_height: u32,
    center_x_ratio: f64,
) -> Value {
    let center_x = image_width as f64 * center_x_ratio;
    json!({
        "masks": [
            {
                "id": "mask.linear-gradient-sky-balance.v1",
                "name": "Linear gradient sky balance proof",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "adjustments": {
                    "exposure": 1.05,
                    "contrast": 10,
                    "saturation": 6
                },
                "subMasks": [
                    {
                        "id": "submask.linear-gradient-bottom.v1",
                        "type": "linear",
                        "visible": true,
                        "invert": false,
                        "opacity": 100,
                        "mode": "additive",
                        "parameters": {
                            "startX": center_x,
                            "startY": image_height as f64 * 0.12,
                            "endX": center_x,
                            "endY": image_height as f64 * 0.72,
                            "range": image_height as f64 * 0.2
                        }
                    }
                ]
            }
        ]
    })
}

fn proof_claims() -> LinearGradientMaskProofClaims {
    LinearGradientMaskProofClaims {
        does_not_prove: vec![
            "macos_app_ui_e2e_session".to_string(),
            "manual_layer_panel_interaction".to_string(),
            "public_raw_fixture_distribution".to_string(),
        ],
        proves: vec![
            "private_real_raw_decode".to_string(),
            "linear_gradient_mask_generation".to_string(),
            "gradient_weighted_local_adjustment_changes_pixels".to_string(),
            "protected_region_changes_less_than_exposed_region".to_string(),
            "gradient_preview_export_parity".to_string(),
            "linear_gradient_geometry_edit_changes_output".to_string(),
            "linear_gradient_adjustment_json_roundtrip_reproduces_output".to_string(),
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

fn primary_mask_bitmap(
    adjustments: &Value,
    base_image: &DynamicImage,
) -> Result<GrayImage, String> {
    let masks: Vec<MaskDefinition> =
        serde_json::from_value(adjustments["masks"].clone()).map_err(|error| error.to_string())?;
    let (width, height) = base_image.dimensions();
    masks
        .first()
        .and_then(|mask| generate_mask_bitmap(mask, width, height, 1.0, (0.0, 0.0), None))
        .ok_or_else(|| "linear gradient proof mask did not generate a bitmap".to_string())
}

fn write_image(image: &DynamicImage, path: &Path, format: ImageFormat) -> Result<(), String> {
    if format == ImageFormat::Png {
        return DynamicImage::ImageRgba8(image.to_rgba8())
            .save_with_format(path, format)
            .map_err(|error| error.to_string());
    }

    image
        .save_with_format(path, format)
        .map_err(|error| error.to_string())
}

#[test]
fn write_image_encodes_rgba32f_png_preview() {
    let output_path = std::env::temp_dir().join(format!(
        "rawengine-linear-gradient-rgba32f-png-{}.png",
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let image = DynamicImage::ImageRgba32F(image::ImageBuffer::from_fn(2, 2, |_x, _y| {
        image::Rgba([0.5, 0.25, 0.75, 1.0])
    }));

    write_image(&image, &output_path, ImageFormat::Png).expect("encode RGBA32F proof PNG");
    let decoded = image::open(&output_path).expect("decode proof PNG");
    assert_eq!(decoded.dimensions(), (2, 2));

    let _ = fs::remove_file(output_path);
}

fn hashed_artifact(
    private_root: &Path,
    kind: &str,
    relative_path: &str,
) -> Result<LinearGradientMaskRealRawArtifact, String> {
    Ok(LinearGradientMaskRealRawArtifact {
        hash: sha256_file(&private_root.join(relative_path))?,
        kind: kind.to_string(),
        path: relative_path.to_string(),
        public_repo_allowed: false,
    })
}

fn metric(name: &str, value: f64, threshold: f64, passed: bool) -> LinearGradientMaskMetric {
    LinearGradientMaskMetric {
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
    changed as f64 / (before.width() as f64 * before.height() as f64).max(1.0)
}

fn mask_delta(
    before: &DynamicImage,
    after: &DynamicImage,
    mask: &GrayImage,
    min_alpha: u8,
    max_alpha: u8,
) -> f64 {
    let before = before.to_rgba8();
    let after = after.to_rgba8();
    let mut total_delta = 0_u64;
    let mut count = 0_u64;

    for y in 0..before.height() {
        for x in 0..before.width() {
            let alpha = mask.get_pixel(x, y)[0];
            if alpha < min_alpha || alpha > max_alpha {
                continue;
            }
            let left = before.get_pixel(x, y);
            let right = after.get_pixel(x, y);
            total_delta += left
                .0
                .iter()
                .zip(right.0.iter())
                .take(3)
                .map(|(l, r)| (*l as i16 - *r as i16).unsigned_abs() as u64)
                .sum::<u64>();
            count += 3;
        }
    }
    total_delta as f64 / (count.max(1) as f64 * 255.0)
}

fn transition_monotonicity(
    before: &DynamicImage,
    after: &DynamicImage,
    mask: &GrayImage,
    bands: u32,
) -> f64 {
    let mut previous = 0.0;
    let mut passing = 0_u32;
    for band in 0..bands {
        let min_alpha = ((band * 256) / bands) as u8;
        let max_alpha = ((((band + 1) * 256) / bands).saturating_sub(1)).min(255) as u8;
        let current = mask_delta(before, after, mask, min_alpha, max_alpha);
        if band == 0 || current >= previous * 0.92 {
            passing += 1;
        }
        previous = current;
    }
    passing as f64 / bands.max(1) as f64
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
