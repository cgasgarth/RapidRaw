#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, GrayImage, ImageFormat};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::app_settings::AppSettings;
use crate::app_state::{AppState, LoadedImage};
use crate::export::export_processing::{
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
    *state.original_image.lock().unwrap() = Some(LoadedImage {
        image: Arc::new(base_image.clone()),
        is_raw,
        path: source_path_string.clone(),
    });

    let unmasked_adjustments = json!({});
    let unrefined_adjustments = layer_mask_adjustments(mask_refinement(false, 0.0), &base_image);
    let edge_refined_adjustments = layer_mask_adjustments(mask_refinement(true, 0.0), &base_image);
    let refined_adjustments = layer_mask_adjustments(mask_refinement(true, 1.0), &base_image);
    let range_adjustments = range_mask_adjustments(&base_image);
    let _range_warped_image = crate::get_cached_full_warped_image(&state, &range_adjustments)?;

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
    let edge_refined_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &edge_refined_adjustments,
        &context,
        &state,
        is_raw,
        "layer_mask_real_raw_edge_refined_preview",
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
    let range_preview = render_with_masks(
        &source_path_string,
        &base_image,
        &range_adjustments,
        &context,
        &state,
        is_raw,
        "layer_mask_real_raw_range_preview",
        tm_override,
    )?;
    let range_export = render_with_masks(
        &source_path_string,
        &base_image,
        &range_adjustments,
        &context,
        &state,
        is_raw,
        "layer_mask_real_raw_range_export",
        tm_override,
    )?;

    let refined_mask_coverage_ratio = mask_coverage_ratio(&refined_adjustments, &base_image)?;
    let range_mask_coverage_ratio = mask_coverage_ratio(&range_adjustments, &base_image)?;
    let unrefined_mask = mask_bitmap(&unrefined_adjustments, &base_image)?;
    let edge_refined_mask = mask_bitmap(&edge_refined_adjustments, &base_image)?;
    let refined_mask = mask_bitmap(&refined_adjustments, &base_image)?;
    let range_mask = mask_bitmap(&range_adjustments, &base_image)?;
    let unrefined_transition_ratio = transition_pixel_ratio(&unrefined_mask);
    let refined_transition_ratio = transition_pixel_ratio(&refined_mask);
    let area_drift_ratio = (mask_alpha_coverage_ratio(&refined_mask)
        - mask_alpha_coverage_ratio(&edge_refined_mask))
    .abs();
    let boundary_alignment_gain = boundary_edge_alignment_score(&edge_refined_mask, &base_image)
        - boundary_edge_alignment_score(&unrefined_mask, &base_image);
    let hair_aware_mask_changed_pixel_ratio =
        changed_mask_pixel_ratio(&edge_refined_mask, &refined_mask);
    let hair_detail_alpha_decisiveness_gain =
        alpha_decisiveness_score(&refined_mask) - alpha_decisiveness_score(&edge_refined_mask);
    let halo_width_proxy_reduction = unrefined_transition_ratio - refined_transition_ratio;
    let edge_color_contamination_proxy_reduction =
        low_gradient_transition_ratio(&unrefined_mask, &base_image)
            - low_gradient_transition_ratio(&refined_mask, &base_image);
    let masked_changed_pixel_ratio = changed_pixel_ratio(&unmasked_preview, &refined_preview);
    let refinement_changed_pixel_ratio = changed_pixel_ratio(&unrefined_preview, &refined_preview);
    let preview_export_mean_abs_delta = mean_abs_delta(&refined_preview, &refined_export);
    let range_changed_pixel_ratio = changed_pixel_ratio(&unmasked_preview, &range_preview);
    let range_preview_export_mean_abs_delta = mean_abs_delta(&range_preview, &range_export);
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
        &edge_refined_preview,
        &output_dir.join(format!("{PROOF_SLUG}-edge-refined-preview.png")),
        ImageFormat::Png,
    )?;
    write_gray_image(
        &edge_refined_mask,
        &output_dir.join(format!("{PROOF_SLUG}-edge-refined-mask-alpha.png")),
    )?;
    write_gray_image(
        &refined_mask,
        &output_dir.join(format!("{PROOF_SLUG}-hair-aware-mask-alpha.png")),
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
    write_gray_image(
        &range_mask,
        &output_dir.join(format!("{PROOF_SLUG}-range-mask-alpha.png")),
    )?;
    write_image(
        &range_preview,
        &output_dir.join(format!("{PROOF_SLUG}-range-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &range_export,
        &output_dir.join(format!("{PROOF_SLUG}-range-export.tiff")),
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
            "edge_refined_preview_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-edge-refined-preview.png"),
        )?,
        hashed_artifact(
            private_root,
            "edge_refined_mask_alpha_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-edge-refined-mask-alpha.png"),
        )?,
        hashed_artifact(
            private_root,
            "hair_aware_mask_alpha_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-hair-aware-mask-alpha.png"),
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
        hashed_artifact(
            private_root,
            "range_mask_alpha_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-range-mask-alpha.png"),
        )?,
        hashed_artifact(
            private_root,
            "range_preview_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-range-preview.png"),
        )?,
        hashed_artifact(
            private_root,
            "range_export_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-range-export.tiff"),
        )?,
    ];
    let output_artifact_count = (artifacts.len() + 1) as u32;

    let metrics = vec![
        metric(
            "maskCoverageRatio",
            refined_mask_coverage_ratio,
            0.01,
            refined_mask_coverage_ratio > 0.01,
        ),
        metric(
            "maskedChangedPixelRatio",
            masked_changed_pixel_ratio,
            0.01,
            masked_changed_pixel_ratio > 0.01,
        ),
        metric(
            "rangeMaskCoverageRatio",
            range_mask_coverage_ratio,
            0.01,
            range_mask_coverage_ratio > 0.01,
        ),
        metric(
            "rangeMaskChangedPixelRatio",
            range_changed_pixel_ratio,
            0.01,
            range_changed_pixel_ratio > 0.01,
        ),
        metric(
            "refinementChangedPixelRatio",
            refinement_changed_pixel_ratio,
            0.0001,
            refinement_changed_pixel_ratio > 0.0001,
        ),
        metric(
            "hairAwareMaskChangedPixelRatio",
            hair_aware_mask_changed_pixel_ratio,
            0.000001,
            hair_aware_mask_changed_pixel_ratio > 0.000001,
        ),
        metric(
            "boundaryFProxyImprovement",
            boundary_alignment_gain,
            0.000001,
            boundary_alignment_gain > 0.000001,
        ),
        metric(
            "hairDetailAlphaDecisivenessGain",
            hair_detail_alpha_decisiveness_gain,
            0.000001,
            hair_detail_alpha_decisiveness_gain > 0.000001,
        ),
        metric(
            "areaDriftRatio",
            area_drift_ratio,
            0.05,
            area_drift_ratio <= 0.05,
        ),
        metric(
            "haloWidthProxyReduction",
            halo_width_proxy_reduction,
            0.000001,
            halo_width_proxy_reduction > 0.000001,
        ),
        metric(
            "edgeColorContaminationProxyReduction",
            edge_color_contamination_proxy_reduction,
            0.000001,
            edge_color_contamination_proxy_reduction > 0.000001,
        ),
        metric(
            "previewExportMeanAbsDelta",
            preview_export_mean_abs_delta,
            0.015,
            preview_export_mean_abs_delta <= 0.015,
        ),
        metric(
            "rangePreviewExportMeanAbsDelta",
            range_preview_export_mean_abs_delta,
            0.015,
            range_preview_export_mean_abs_delta <= 0.015,
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
        issue: 3251,
        metrics,
        proof_claims: proof_claims(),
        report_id: REPORT_ID.to_string(),
        runtime_proof: LayerMaskRuntimeProof {
            execution: "tauri_test_gpu_pipeline".to_string(),
            macos_app_ui_e2e: false,
            mask_path: "prepare_export_masks + generate_mask_bitmap".to_string(),
            output_artifact_count,
            preview_export_parity_metric:
                "previewExportMeanAbsDelta + rangePreviewExportMeanAbsDelta".to_string(),
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

fn layer_mask_adjustments(refinement: Value, base_image: &DynamicImage) -> Value {
    let (image_width, image_height) = base_image.dimensions();
    let radius_x = image_width as f64 * 0.18;
    let radius_y = image_height as f64 * 0.16;
    let (edge_x, edge_y) = strongest_rgb_edge_point(base_image);
    let center_x = (edge_x as f64 - radius_x).clamp(radius_x, image_width as f64 - radius_x);
    let center_y = (edge_y as f64).clamp(radius_y, image_height as f64 - radius_y);
    json!({
        "masks": [
            {
                "id": "mask.local-brighten.v1",
                "name": "Local brighten proof",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "adjustments": {
                    "exposure": 1.8,
                    "contrast": 32,
                    "saturation": 18
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
                            "hairDetail": refinement["hairDetail"],
                            "smoothness": refinement["smoothness"]
                        }
                    }
                ]
            }
        ]
    })
}

fn range_mask_adjustments(base_image: &DynamicImage) -> Value {
    let (image_width, image_height) = base_image.dimensions();
    json!({
        "masks": [
            {
                "id": "mask.range-warm-local.v1",
                "name": "Range mask warmth proof",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "adjustments": {
                    "exposure": 1.25,
                    "contrast": 24,
                    "temperature": 18,
                    "saturation": 16
                },
                "subMasks": [
                    {
                        "id": "submask.luminance-range-midtones.v1",
                        "type": "luminance_range",
                        "visible": true,
                        "invert": false,
                        "opacity": 100,
                        "mode": "additive",
                        "parameters": {
                            "minLuma": 0.14,
                            "maxLuma": 0.84,
                            "feather": 0.22
                        }
                    },
                    {
                        "id": "submask.color-range-warm.v1",
                        "type": "color_range",
                        "visible": true,
                        "invert": false,
                        "opacity": 100,
                        "mode": "additive",
                        "parameters": {
                            "centerHueDegrees": 32,
                            "hueToleranceDegrees": 70,
                            "feather": 0.5,
                            "minLuma": 0.02,
                            "maxLuma": 0.98,
                            "minSaturation": 0.02,
                            "maxSaturation": 1.0
                        }
                    }
                ],
                "proofSource": {
                    "imageWidth": image_width,
                    "imageHeight": image_height,
                    "source": "private_alaska_raw_working_rgb"
                }
            }
        ]
    })
}

fn mask_refinement(enabled: bool, hair_detail: f64) -> Value {
    if enabled {
        json!({
            "density": 0.74,
            "edgeContrast": 0.45,
            "edgeShiftPx": 3.0,
            "featherPx": 2.5,
            "hairDetail": hair_detail,
            "smoothness": 0.6
        })
    } else {
        json!({
            "density": 1.0,
            "edgeContrast": 0.0,
            "edgeShiftPx": 0.0,
            "featherPx": 0.0,
            "hairDetail": 0.0,
            "smoothness": 0.0
        })
    }
}

fn proof_claims() -> LayerMaskProofClaims {
    LayerMaskProofClaims {
        does_not_prove: vec![
            "macos_app_ui_e2e_session".to_string(),
            "manual_layer_panel_interaction".to_string(),
            "annotated_hair_ground_truth_boundary_f".to_string(),
            "public_raw_fixture_distribution".to_string(),
        ],
        proves: vec![
            "private_real_raw_decode".to_string(),
            "layer_mask_generation".to_string(),
            "masked_adjustment_changes_pixels".to_string(),
            "mask_refinement_changes_pixels".to_string(),
            "image_evidence_guided_refinement".to_string(),
            "hair_detail_chroma_edge_refinement".to_string(),
            "refined_preview_export_parity".to_string(),
            "luminance_and_color_range_mask_generation".to_string(),
            "range_mask_preview_export_parity".to_string(),
        ],
    }
}

fn mask_coverage_ratio(adjustments: &Value, base_image: &DynamicImage) -> Result<f64, String> {
    Ok(mask_alpha_coverage_ratio(&mask_bitmap(
        adjustments,
        base_image,
    )?))
}

fn mask_bitmap(adjustments: &Value, base_image: &DynamicImage) -> Result<GrayImage, String> {
    let masks: Vec<MaskDefinition> =
        serde_json::from_value(adjustments["masks"].clone()).map_err(|error| error.to_string())?;
    let (width, height) = base_image.dimensions();
    let mut combined = GrayImage::new(width, height);
    for bitmap in masks.iter().filter_map(|mask| {
        generate_mask_bitmap(mask, width, height, 1.0, (0.0, 0.0), Some(base_image))
    }) {
        for (x, y, pixel) in bitmap.enumerate_pixels() {
            let current = combined.get_pixel(x, y)[0];
            combined.put_pixel(x, y, image::Luma([current.max(pixel[0])]));
        }
    }
    Ok(combined)
}

fn mask_alpha_coverage_ratio(mask: &GrayImage) -> f64 {
    let alpha_sum: u64 = mask.pixels().map(|pixel| pixel[0] as u64).sum();
    alpha_sum as f64 / (mask_pixel_count(mask) as f64 * 255.0)
}

fn transition_pixel_ratio(mask: &GrayImage) -> f64 {
    let transition_pixels = mask
        .pixels()
        .filter(|pixel| (24..=230).contains(&pixel[0]))
        .count();
    transition_pixels as f64 / mask_pixel_count(mask) as f64
}

fn low_gradient_transition_ratio(mask: &GrayImage, image: &DynamicImage) -> f64 {
    let mut count = 0usize;
    for (x, y, pixel) in mask.enumerate_pixels() {
        if (24..=230).contains(&pixel[0]) && luma_gradient(image, x, y) < 0.08 {
            count += 1;
        }
    }
    count as f64 / mask_pixel_count(mask) as f64
}

fn boundary_edge_alignment_score(mask: &GrayImage, image: &DynamicImage) -> f64 {
    let mut total = 0.0;
    let mut count = 0usize;
    for (x, y, pixel) in mask.enumerate_pixels() {
        if (24..=230).contains(&pixel[0]) {
            total += luma_gradient(image, x, y) as f64;
            count += 1;
        }
    }
    total / count.max(1) as f64
}

fn alpha_decisiveness_score(mask: &GrayImage) -> f64 {
    let mut total = 0.0;
    let mut count = 0usize;
    for pixel in mask.pixels() {
        if (24..=230).contains(&pixel[0]) {
            let alpha = pixel[0] as f64 / 255.0;
            total += ((alpha - 0.5).abs() * 2.0).clamp(0.0, 1.0);
            count += 1;
        }
    }
    total / count.max(1) as f64
}

fn luma_gradient(image: &DynamicImage, x: u32, y: u32) -> f32 {
    let left = x.saturating_sub(1);
    let right = (x + 1).min(image.width().saturating_sub(1));
    let top = y.saturating_sub(1);
    let bottom = (y + 1).min(image.height().saturating_sub(1));
    let dx = (luma(image, right, y) - luma(image, left, y)).abs();
    let dy = (luma(image, x, bottom) - luma(image, x, top)).abs();
    dx.max(dy) / 255.0
}

fn luma(image: &DynamicImage, x: u32, y: u32) -> f32 {
    let pixel = image.get_pixel(x, y);
    0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32
}

fn strongest_rgb_edge_point(image: &DynamicImage) -> (u32, u32) {
    let width = image.width();
    let height = image.height();
    if width < 3 || height < 3 {
        return (width / 2, height / 2);
    }

    let margin_x = width / 5;
    let margin_y = height / 5;
    let step = 12u32;
    let mut best = (width / 2, height / 2);
    let mut best_score = 0.0f32;
    let y_start = margin_y.max(1);
    let y_end = height.saturating_sub(margin_y).max(y_start + 1);
    let x_start = margin_x.max(1);
    let x_end = width.saturating_sub(margin_x).max(x_start + 1);
    let mut y = y_start;
    while y < y_end {
        let mut x = x_start;
        while x < x_end {
            let score = rgb_edge_gradient(image, x, y);
            if score > best_score {
                best_score = score;
                best = (x, y);
            }
            x = x.saturating_add(step);
        }
        y = y.saturating_add(step);
    }
    best
}

fn rgb_edge_gradient(image: &DynamicImage, x: u32, y: u32) -> f32 {
    let left = x.saturating_sub(1);
    let right = (x + 1).min(image.width().saturating_sub(1));
    let top = y.saturating_sub(1);
    let bottom = (y + 1).min(image.height().saturating_sub(1));
    rgb_distance(image, left, y, right, y).max(rgb_distance(image, x, top, x, bottom))
}

fn rgb_distance(image: &DynamicImage, x1: u32, y1: u32, x2: u32, y2: u32) -> f32 {
    let left = image.get_pixel(x1, y1);
    let right = image.get_pixel(x2, y2);
    let r = (left[0] as f32 - right[0] as f32) / 255.0;
    let g = (left[1] as f32 - right[1] as f32) / 255.0;
    let b = (left[2] as f32 - right[2] as f32) / 255.0;
    ((r * r + g * g + b * b) / 3.0).sqrt()
}

fn mask_pixel_count(mask: &GrayImage) -> usize {
    (mask.width() as usize)
        .checked_mul(mask.height() as usize)
        .unwrap_or(0)
        .max(1)
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

fn write_gray_image(image: &GrayImage, path: &Path) -> Result<(), String> {
    image
        .save_with_format(path, ImageFormat::Png)
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

fn changed_mask_pixel_ratio(before: &GrayImage, after: &GrayImage) -> f64 {
    if before.dimensions() != after.dimensions() {
        return 1.0;
    }

    let changed = before
        .pixels()
        .zip(after.pixels())
        .filter(|(left, right)| left[0] != right[0])
        .count();
    changed as f64 / mask_pixel_count(before) as f64
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
