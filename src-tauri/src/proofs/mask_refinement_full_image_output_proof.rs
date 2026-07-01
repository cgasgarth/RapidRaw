#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, GrayImage, ImageFormat, Rgba, RgbaImage};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::Manager;
use walkdir::WalkDir;

use crate::app_settings::AppSettings;
use crate::app_state::{AppState, LoadedImage};
use crate::export::export_processing::{
    prepare_export_masks, process_image_for_export_pipeline_with_tonemapper_override,
};
use crate::gpu_processing::get_or_init_compute_gpu_context_for_tests;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::{GpuContext, resolve_tonemapper_override};
use crate::mask_generation::{MaskDefinition, MaskRefinementParameters, generate_mask_bitmap};

const SYNTHETIC_FIXTURE_ID: &str = "validation.mask-refinement.full-image.synthetic.v1";
const SYNTHETIC_REPORT_ID: &str = "mask-refinement.full-image.synthetic.v1";
const SYNTHETIC_SOURCE_PATH: &str = "synthetic://mask-refinement/full-image/v1";
const PRIVATE_FIXTURE_ID: &str = "validation.mask-refinement.full-image.private-alaska.v1";
const PRIVATE_REPORT_ID: &str = "mask-refinement.full-image.private-alaska.v1";
const PRIVATE_ARTIFACT_DIR: &str = "private-artifacts/validation/mask-refinement-full-image-output";
const PRIVATE_PROOF_SLUG: &str = "alaska-mask-refinement-full-image-v1";
const DEFAULT_SYNTHETIC_REPORT_PATH: &str =
    "target/rawengine-mask-refinement-full-image-output-report.json";

#[derive(Clone, Copy)]
enum ProofSourceKind {
    Synthetic,
    PrivateRaw,
}

#[derive(Clone, Copy)]
enum ProofMaskKind {
    Brush,
    Radial,
}

impl ProofMaskKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Brush => "brush",
            Self::Radial => "radial",
        }
    }
}

#[derive(Clone, Copy)]
struct VariantSpec {
    id: &'static str,
    mask_kind: ProofMaskKind,
    parameter_focus: &'static str,
    refinement: MaskRefinementParameters,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofSource {
    hash: String,
    is_raw: bool,
    kind: String,
    path: String,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofArtifact {
    hash: String,
    kind: String,
    path: String,
    public_repo_allowed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VariantReport {
    affected_pixel_ratio: f64,
    alpha_decisiveness: f64,
    edge_spread: f64,
    finite_metrics: bool,
    id: String,
    mask_coverage_ratio: f64,
    mask_hash: String,
    mask_kind: String,
    output_hash: String,
    output_mean_abs_delta: f64,
    output_path: Option<String>,
    parameter_focus: String,
    refinement: MaskRefinementParameters,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScalarResponse {
    passed: bool,
    threshold: f64,
    value: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EdgeShiftDirectionResponse {
    erode_coverage_delta: f64,
    erode_passed: bool,
    expand_coverage_delta: f64,
    expand_passed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofSummary {
    baseline_brush_output_hash: String,
    baseline_radial_output_hash: String,
    baseline_unmasked_output_hash: String,
    density_response_ratio: ScalarResponse,
    edge_contrast_response: ScalarResponse,
    edge_shift_direction: EdgeShiftDirectionResponse,
    feather_edge_spread_gain: ScalarResponse,
    no_nan_or_inf_invariant: bool,
    source_hash_unchanged: bool,
    static_fallback_changed_pixel_ratio: ScalarResponse,
    smoothness_response: ScalarResponse,
    unique_output_hash_count: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofClaims {
    does_not_prove: Vec<String>,
    proves: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProof {
    execution: String,
    mask_path: String,
    output_artifact_count: u32,
    raw_decode_path: String,
    render_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MaskRefinementFullImageOutputReport {
    artifacts: Vec<ProofArtifact>,
    fixture_id: String,
    generated_at: String,
    issue: u32,
    proof_claims: ProofClaims,
    report_id: String,
    runtime_proof: RuntimeProof,
    source: ProofSource,
    summary: ProofSummary,
    validation_mode: String,
    variants: Vec<VariantReport>,
}

#[test]
fn synthetic_runtime_generates_mask_refinement_full_image_output_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_MASK_REFINEMENT_FULL_IMAGE_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping synthetic mask refinement full-image output proof");
        return;
    }

    let report_path = PathBuf::from(
        std::env::var("RAWENGINE_MASK_REFINEMENT_FULL_IMAGE_REPORT")
            .unwrap_or_else(|_| DEFAULT_SYNTHETIC_REPORT_PATH.to_string()),
    );
    let report = run_synthetic_mask_refinement_full_image_output_proof()
        .expect("synthetic mask refinement full-image output proof runs");
    if let Some(parent) = report_path.parent() {
        fs::create_dir_all(parent).expect("create synthetic proof directory");
    }
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report).expect("serialize synthetic mask refinement proof"),
    )
    .expect("write synthetic mask refinement proof");
}

#[test]
fn private_runtime_generates_mask_refinement_full_image_output_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_MASK_REFINEMENT_FULL_IMAGE_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private mask refinement full-image output proof");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_mask_refinement_full_image_output_proof(&private_root)
        .expect("private mask refinement full-image output proof runs");
}

fn run_synthetic_mask_refinement_full_image_output_proof(
) -> Result<MaskRefinementFullImageOutputReport, String> {
    let base_image = build_synthetic_fixture();
    let source_hash = sha256_dynamic_image(&base_image);
    let report = run_mask_refinement_full_image_output_proof(
        ProofSourceKind::Synthetic,
        &base_image,
        SYNTHETIC_SOURCE_PATH,
        source_hash.clone(),
        false,
        None,
        None,
    )?;
    if !report.summary.source_hash_unchanged {
        return Err("synthetic source hash changed unexpectedly".to_string());
    }
    Ok(report)
}

fn run_private_mask_refinement_full_image_output_proof(
    private_root: &Path,
) -> Result<MaskRefinementFullImageOutputReport, String> {
    let source_path = resolve_private_raw_source_path(private_root)?;
    let source_hash_before = sha256_file(&source_path)?;
    let source_bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    let source_path_string = source_path.to_string_lossy().to_string();
    let settings = AppSettings::default();
    let base_image =
        load_base_image_from_bytes(&source_bytes, &source_path_string, false, &settings, None)
            .map_err(|error| error.to_string())?;

    let output_dir = private_root.join(PRIVATE_ARTIFACT_DIR);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let report = run_mask_refinement_full_image_output_proof(
        ProofSourceKind::PrivateRaw,
        &base_image,
        &source_path_string,
        source_hash_before.clone(),
        true,
        Some(private_root),
        Some(&output_dir),
    )?;
    let source_hash_after = sha256_file(&source_path)?;
    if source_hash_before != source_hash_after {
        return Err("private source RAW hash changed during proof".to_string());
    }
    Ok(report)
}

fn run_mask_refinement_full_image_output_proof(
    source_kind: ProofSourceKind,
    base_image: &DynamicImage,
    source_path: &str,
    source_hash_before: String,
    is_raw: bool,
    private_root: Option<&Path>,
    output_dir: Option<&Path>,
) -> Result<MaskRefinementFullImageOutputReport, String> {
    let settings = AppSettings::default();
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .map_err(|error| error.to_string())?;
    let state = app.state::<AppState>();
    let context = get_or_init_compute_gpu_context_for_tests(&state)?;
    let tm_override = resolve_tonemapper_override(&settings, is_raw);
    *state.original_image.lock().unwrap() = Some(LoadedImage {
        image: Arc::new(base_image.clone()),
        is_raw,
        path: source_path.to_string(),
    });

    let unmasked_adjustments = json!({});
    let unmasked_output = render_with_masks(
        source_path,
        base_image,
        &unmasked_adjustments,
        &context,
        &state,
        is_raw,
        "mask_refinement_full_image_output_unmasked",
        tm_override,
    )?;
    let baseline_unmasked_output_hash = sha256_dynamic_image(&unmasked_output);

    let mut variants = Vec::new();
    let mut private_artifacts = Vec::new();

    if let (Some(root), Some(dir)) = (private_root, output_dir) {
        let unmasked_relative = format!(
            "{PRIVATE_ARTIFACT_DIR}/{PRIVATE_PROOF_SLUG}-unmasked-preview.png"
        );
        write_image(
            &unmasked_output,
            &dir.join(format!("{PRIVATE_PROOF_SLUG}-unmasked-preview.png")),
            ImageFormat::Png,
        )?;
        private_artifacts.push(hashed_artifact(root, "unmasked_preview_private", &unmasked_relative)?);
    }

    let variant_specs = variant_specs(base_image);
    for variant_spec in variant_specs.iter() {
        let adjustments = build_mask_adjustments(variant_spec.mask_kind, variant_spec.refinement, base_image);
        let rendered_output = render_with_masks(
            source_path,
            base_image,
            &adjustments,
            &context,
            &state,
            is_raw,
            variant_spec.id,
            tm_override,
        )?;
        let mask = mask_bitmap(&adjustments, base_image)?;
        let variant = VariantReport {
            affected_pixel_ratio: changed_pixel_ratio(&unmasked_output, &rendered_output),
            alpha_decisiveness: alpha_decisiveness_score(&mask),
            edge_spread: transition_pixel_ratio(&mask),
            finite_metrics: variant_metrics_are_finite(&rendered_output, &mask),
            id: variant_spec.id.to_string(),
            mask_coverage_ratio: mask_alpha_coverage_ratio(&mask),
            mask_hash: sha256_gray_image(&mask),
            mask_kind: variant_spec.mask_kind.as_str().to_string(),
            output_hash: sha256_dynamic_image(&rendered_output),
            output_mean_abs_delta: mean_abs_delta(&unmasked_output, &rendered_output),
            output_path: None,
            parameter_focus: variant_spec.parameter_focus.to_string(),
            refinement: variant_spec.refinement,
        };

        if let (Some(root), Some(dir)) = (private_root, output_dir) {
            let output_file_name = format!("{PRIVATE_PROOF_SLUG}-{}.png", variant_spec.id);
            let relative_path = format!("{PRIVATE_ARTIFACT_DIR}/{output_file_name}");
            write_image(&rendered_output, &dir.join(&output_file_name), ImageFormat::Png)?;
            private_artifacts.push(hashed_artifact(
                root,
                &format!("{}_preview_private", variant_spec.id),
                &relative_path,
            )?);
            variants.push(VariantReport {
                output_path: Some(relative_path),
                ..variant
            });
        } else {
            variants.push(variant);
        }
    }

    let source_hash_after = match source_kind {
        ProofSourceKind::Synthetic => source_hash_before.clone(),
        ProofSourceKind::PrivateRaw => {
            let root = private_root.ok_or_else(|| "missing private root".to_string())?;
            let source = resolve_private_raw_source_path(root)?;
            sha256_file(&source)?
        }
    };

    let summary = build_summary(&baseline_unmasked_output_hash, &variants, source_hash_before == source_hash_after)?;
    let source = ProofSource {
        hash: source_hash_before,
        is_raw,
        kind: match source_kind {
            ProofSourceKind::Synthetic => "synthetic_composite_fixture_v1".to_string(),
            ProofSourceKind::PrivateRaw => "private_local_raw_fixture".to_string(),
        },
        path: source_path.to_string(),
        width: base_image.width(),
        height: base_image.height(),
    };

    let fixture_id = match source_kind {
        ProofSourceKind::Synthetic => SYNTHETIC_FIXTURE_ID.to_string(),
        ProofSourceKind::PrivateRaw => PRIVATE_FIXTURE_ID.to_string(),
    };
    let report_id = match source_kind {
        ProofSourceKind::Synthetic => SYNTHETIC_REPORT_ID.to_string(),
        ProofSourceKind::PrivateRaw => PRIVATE_REPORT_ID.to_string(),
    };
    let validation_mode = match source_kind {
        ProofSourceKind::Synthetic => "synthetic_mask_refinement_full_image_output_runtime_proof".to_string(),
        ProofSourceKind::PrivateRaw => "private_raw_mask_refinement_full_image_output_runtime_proof".to_string(),
    };
    let proof_claims = match source_kind {
        ProofSourceKind::Synthetic => ProofClaims {
            does_not_prove: vec![
                "private_real_raw_decode".to_string(),
                "manual_macos_app_ui_session".to_string(),
                "capture_one_class_quality_match".to_string(),
            ],
            proves: vec![
                "synthetic_full_image_runtime_output".to_string(),
                "brush_mask_refinement_changes_pixels".to_string(),
                "static_mask_refinement_fallback_changes_pixels".to_string(),
                "refinement_control_directionality".to_string(),
            ],
        },
        ProofSourceKind::PrivateRaw => ProofClaims {
            does_not_prove: vec![
                "manual_macos_app_ui_session".to_string(),
                "capture_one_class_quality_match".to_string(),
                "annotated_ground_truth_edge_labels".to_string(),
            ],
            proves: vec![
                "private_real_raw_decode".to_string(),
                "full_image_runtime_output".to_string(),
                "brush_mask_refinement_changes_pixels".to_string(),
                "static_mask_refinement_fallback_changes_pixels".to_string(),
                "refinement_control_directionality".to_string(),
            ],
        },
    };

    let mut report = MaskRefinementFullImageOutputReport {
        artifacts: Vec::new(),
        fixture_id,
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        issue: 4661,
        proof_claims,
        report_id,
        runtime_proof: RuntimeProof {
            execution: "tauri_test_gpu_pipeline".to_string(),
            mask_path: "prepare_export_masks + generate_mask_bitmap".to_string(),
            output_artifact_count: private_artifacts.len() as u32 + 1,
            raw_decode_path: if is_raw {
                "load_base_image_from_bytes".to_string()
            } else {
                "synthetic_fixture_builder".to_string()
            },
            render_path: "process_image_for_export_pipeline_with_tonemapper_override".to_string(),
        },
        source,
        summary,
        validation_mode,
        variants,
    };

    if let (Some(root), Some(dir)) = (private_root, output_dir) {
        let report_path = dir.join(format!("{PRIVATE_PROOF_SLUG}-report.json"));
        fs::write(
            &report_path,
            serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        private_artifacts.push(hashed_artifact(
            root,
            "workflow_report_private",
            &format!("{PRIVATE_ARTIFACT_DIR}/{PRIVATE_PROOF_SLUG}-report.json"),
        )?);
        report.artifacts = private_artifacts;
        fs::write(
            &report_path,
            serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(report)
}

fn build_summary(
    baseline_unmasked_output_hash: &str,
    variants: &[VariantReport],
    source_hash_unchanged: bool,
) -> Result<ProofSummary, String> {
    let baseline_brush = variant_by_id(variants, "brush-baseline")?;
    let baseline_radial = variant_by_id(variants, "radial-baseline")?;
    let feather = variant_by_id(variants, "brush-feather")?;
    let density = variant_by_id(variants, "brush-density")?;
    let expand = variant_by_id(variants, "brush-edge-shift-expand")?;
    let erode = variant_by_id(variants, "brush-edge-shift-erode")?;
    let smooth = variant_by_id(variants, "brush-smoothness")?;
    let contrast = variant_by_id(variants, "brush-edge-contrast")?;

    let feather_gain = feather.edge_spread - baseline_brush.edge_spread;
    let density_ratio = density.output_mean_abs_delta / baseline_brush.output_mean_abs_delta.max(0.000001);
    let smoothness_gain = smooth.alpha_decisiveness - baseline_brush.alpha_decisiveness;
    let edge_contrast_gain = baseline_brush.edge_spread - contrast.edge_spread;
    let expand_delta = expand.mask_coverage_ratio - baseline_brush.mask_coverage_ratio;
    let erode_delta = erode.mask_coverage_ratio - baseline_brush.mask_coverage_ratio;
    let no_nan_or_inf = variants.iter().all(|variant| {
        variant.finite_metrics
            && variant.affected_pixel_ratio.is_finite()
            && variant.alpha_decisiveness.is_finite()
            && variant.edge_spread.is_finite()
            && variant.mask_coverage_ratio.is_finite()
            && variant.output_mean_abs_delta.is_finite()
    });
    let unique_output_hash_count = variants
        .iter()
        .map(|variant| variant.output_hash.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .len() as u32;

    Ok(ProofSummary {
        baseline_brush_output_hash: baseline_brush.output_hash.clone(),
        baseline_radial_output_hash: baseline_radial.output_hash.clone(),
        baseline_unmasked_output_hash: baseline_unmasked_output_hash.to_string(),
        density_response_ratio: ScalarResponse {
            passed: density_ratio < 0.92,
            threshold: 0.92,
            value: density_ratio,
        },
        edge_contrast_response: ScalarResponse {
            passed: edge_contrast_gain > 0.005,
            threshold: 0.005,
            value: edge_contrast_gain,
        },
        edge_shift_direction: EdgeShiftDirectionResponse {
            erode_coverage_delta: erode_delta,
            erode_passed: erode_delta < -0.003,
            expand_coverage_delta: expand_delta,
            expand_passed: expand_delta > 0.003,
        },
        feather_edge_spread_gain: ScalarResponse {
            passed: feather_gain > 0.005,
            threshold: 0.005,
            value: feather_gain,
        },
        no_nan_or_inf_invariant: no_nan_or_inf,
        source_hash_unchanged,
        static_fallback_changed_pixel_ratio: ScalarResponse {
            passed: baseline_radial.affected_pixel_ratio > 0.01,
            threshold: 0.01,
            value: baseline_radial.affected_pixel_ratio,
        },
        smoothness_response: ScalarResponse {
            passed: smoothness_gain > 0.005,
            threshold: 0.005,
            value: smoothness_gain,
        },
        unique_output_hash_count,
    })
}

fn variant_by_id<'a>(variants: &'a [VariantReport], id: &str) -> Result<&'a VariantReport, String> {
    variants
        .iter()
        .find(|variant| variant.id == id)
        .ok_or_else(|| format!("missing proof variant {id}"))
}

fn variant_specs(base_image: &DynamicImage) -> Vec<VariantSpec> {
    let scale = ((base_image.width().max(base_image.height()) as f32) / 448.0)
        .sqrt()
        .clamp(1.0, 5.0);
    let feather_px = 12.0 * scale;
    let edge_shift_px = 6.0 * scale;
    vec![
        VariantSpec {
            id: "brush-baseline",
            mask_kind: ProofMaskKind::Brush,
            parameter_focus: "baseline",
            refinement: baseline_refinement(),
        },
        VariantSpec {
            id: "brush-feather",
            mask_kind: ProofMaskKind::Brush,
            parameter_focus: "featherPx",
            refinement: MaskRefinementParameters {
                feather_px,
                ..baseline_refinement()
            },
        },
        VariantSpec {
            id: "brush-density",
            mask_kind: ProofMaskKind::Brush,
            parameter_focus: "density",
            refinement: MaskRefinementParameters {
                density: 0.52,
                ..baseline_refinement()
            },
        },
        VariantSpec {
            id: "brush-edge-shift-expand",
            mask_kind: ProofMaskKind::Brush,
            parameter_focus: "edgeShiftPx",
            refinement: MaskRefinementParameters {
                edge_shift_px,
                ..baseline_refinement()
            },
        },
        VariantSpec {
            id: "brush-edge-shift-erode",
            mask_kind: ProofMaskKind::Brush,
            parameter_focus: "edgeShiftPx",
            refinement: MaskRefinementParameters {
                edge_shift_px: -edge_shift_px,
                ..baseline_refinement()
            },
        },
        VariantSpec {
            id: "brush-smoothness",
            mask_kind: ProofMaskKind::Brush,
            parameter_focus: "smoothness",
            refinement: MaskRefinementParameters {
                smoothness: 0.85,
                ..baseline_refinement()
            },
        },
        VariantSpec {
            id: "brush-edge-contrast",
            mask_kind: ProofMaskKind::Brush,
            parameter_focus: "edgeContrast",
            refinement: MaskRefinementParameters {
                edge_contrast: 0.75,
                ..baseline_refinement()
            },
        },
        VariantSpec {
            id: "radial-baseline",
            mask_kind: ProofMaskKind::Radial,
            parameter_focus: "static-fallback",
            refinement: baseline_refinement(),
        },
        VariantSpec {
            id: "radial-feather",
            mask_kind: ProofMaskKind::Radial,
            parameter_focus: "featherPx",
            refinement: MaskRefinementParameters {
                feather_px: feather_px * 1.5,
                ..baseline_refinement()
            },
        },
    ]
}

fn baseline_refinement() -> MaskRefinementParameters {
    MaskRefinementParameters {
        density: 1.0,
        edge_contrast: 0.0,
        edge_shift_px: 0.0,
        feather_px: 0.0,
        hair_detail: 0.0,
        smoothness: 0.0,
    }
}

fn build_synthetic_fixture() -> DynamicImage {
    let width = 448u32;
    let height = 320u32;
    let mut image = RgbaImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let fx = x as f32 / width as f32;
            let fy = y as f32 / height as f32;
            let background_r = (28.0 + 42.0 * fx + 18.0 * fy) as u8;
            let background_g = (34.0 + 58.0 * fx + 24.0 * (1.0 - fy)) as u8;
            let background_b = (44.0 + 68.0 * (1.0 - fx) + 14.0 * fy) as u8;
            image.put_pixel(x, y, Rgba([background_r, background_g, background_b, 255]));
        }
    }

    let subject_center = (246.0f32, 162.0f32);
    let subject_radius_x = 118.0f32;
    let subject_radius_y = 92.0f32;
    for y in 0..height {
        for x in 0..width {
            let dx = (x as f32 - subject_center.0) / subject_radius_x;
            let dy = (y as f32 - subject_center.1) / subject_radius_y;
            let distance = dx * dx + dy * dy;
            if distance <= 1.0 {
                let texture = (((x * 17 + y * 31) % 29) as f32 / 28.0) * 18.0;
                let edge_band = ((1.0 - distance).max(0.0).sqrt() * 28.0) as u8;
                image.put_pixel(
                    x,
                    y,
                    Rgba([
                        (148.0 + texture + edge_band as f32 * 0.7).clamp(0.0, 255.0) as u8,
                        (118.0 + texture * 0.5 + edge_band as f32 * 0.5).clamp(0.0, 255.0) as u8,
                        (84.0 + texture * 0.25).clamp(0.0, 255.0) as u8,
                        255,
                    ]),
                );
            }
        }
    }

    for offset in 0..18u32 {
        let x = 168 + offset * 7;
        let height_variation = 16 + (offset % 5) * 6;
        for y in (88u32.saturating_sub(height_variation))..(88 + height_variation) {
            if x < width && y < height {
                image.put_pixel(x, y, Rgba([214, 210, 194, 255]));
            }
        }
    }

    for x in 58..132u32 {
        for y in 196..278u32 {
            if (x + y) % 9 < 4 {
                image.put_pixel(x, y, Rgba([32, 126, 168, 255]));
            }
        }
    }

    DynamicImage::ImageRgba8(image)
}

fn build_mask_adjustments(mask_kind: ProofMaskKind, refinement: MaskRefinementParameters, base_image: &DynamicImage) -> Value {
    let refinement_value =
        serde_json::to_value(refinement).expect("serialize mask refinement parameters");
    match mask_kind {
        ProofMaskKind::Brush => brush_mask_adjustments(refinement_value, base_image),
        ProofMaskKind::Radial => radial_mask_adjustments(refinement_value, base_image),
    }
}

fn brush_mask_adjustments(refinement: Value, base_image: &DynamicImage) -> Value {
    let width = base_image.width() as f64;
    let height = base_image.height() as f64;
    let brush_size_a = (width.min(height) * 0.06) as i64;
    let brush_size_b = (width.min(height) * 0.045) as i64;
    json!({
        "masks": [
            {
                "id": "mask.synthetic-brush-refinement.v1",
                "name": "Synthetic brush refine proof",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "adjustments": {
                    "contrast": 22,
                    "exposure": 1.35,
                    "saturation": 14,
                    "temperature": 9
                },
                "subMasks": [
                    {
                        "id": "submask.synthetic-brush.v1",
                        "type": "brush",
                        "visible": true,
                        "invert": false,
                        "opacity": 100,
                        "mode": "additive",
                        "parameters": {
                            "lines": [
                                {
                                    "brushSize": brush_size_a,
                                    "feather": 0.42,
                                    "points": [
                                        { "x": width * 0.27, "y": height * 0.37 },
                                        { "x": width * 0.40, "y": height * 0.41 },
                                        { "x": width * 0.52, "y": height * 0.46 },
                                        { "x": width * 0.67, "y": height * 0.51 }
                                    ],
                                    "tool": "brush"
                                },
                                {
                                    "brushSize": brush_size_b,
                                    "feather": 0.36,
                                    "points": [
                                        { "x": width * 0.33, "y": height * 0.62 },
                                        { "x": width * 0.47, "y": height * 0.68 },
                                        { "x": width * 0.60, "y": height * 0.70 }
                                    ],
                                    "tool": "brush"
                                }
                            ],
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

fn radial_mask_adjustments(refinement: Value, base_image: &DynamicImage) -> Value {
    let (image_width, image_height) = base_image.dimensions();
    json!({
        "masks": [
            {
                "id": "mask.synthetic-radial-refinement.v1",
                "name": "Synthetic radial refine fallback",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "adjustments": {
                    "contrast": 18,
                    "exposure": 1.1,
                    "saturation": -8,
                    "temperature": -12
                },
                "subMasks": [
                    {
                        "id": "submask.synthetic-radial.v1",
                        "type": "radial",
                        "visible": true,
                        "invert": false,
                        "opacity": 100,
                        "mode": "additive",
                        "parameters": {
                            "centerX": image_width as f64 * 0.63,
                            "centerY": image_height as f64 * 0.44,
                            "radiusX": image_width as f64 * 0.18,
                            "radiusY": image_height as f64 * 0.23,
                            "rotation": 0,
                            "feather": 38,
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

fn variant_metrics_are_finite(output: &DynamicImage, mask: &GrayImage) -> bool {
    output
        .to_rgba8()
        .pixels()
        .all(|pixel| pixel.0.iter().all(|channel| (*channel as f64).is_finite()))
        && mask
            .pixels()
            .all(|pixel| pixel.0.iter().all(|channel| (*channel as f64).is_finite()))
}

fn resolve_private_raw_source_path(private_root: &Path) -> Result<PathBuf, String> {
    if let Ok(explicit_path) = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE_PATH") {
        return Ok(PathBuf::from(explicit_path));
    }

    let mut candidates = WalkDir::new(private_root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .filter(|path| is_private_raw_candidate(path))
        .collect::<Vec<_>>();
    candidates.sort();

    candidates
        .into_iter()
        .find(|path| !path.components().any(|component| component.as_os_str() == "Trash"))
        .or_else(|| {
            WalkDir::new(private_root)
                .into_iter()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_file())
                .map(|entry| entry.into_path())
                .filter(|path| is_private_raw_candidate(path))
                .min()
        })
        .ok_or_else(|| format!("no supported RAW files found under {}", private_root.display()))
}

fn is_private_raw_candidate(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "arw" | "cr2" | "cr3" | "dng" | "nef" | "orf" | "raf" | "rw2"
            )
        })
        .unwrap_or(false)
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

fn hashed_artifact(
    private_root: &Path,
    kind: &str,
    relative_path: &str,
) -> Result<ProofArtifact, String> {
    Ok(ProofArtifact {
        hash: sha256_file(&private_root.join(relative_path))?,
        kind: kind.to_string(),
        path: relative_path.to_string(),
        public_repo_allowed: false,
    })
}

fn sha256_dynamic_image(image: &DynamicImage) -> String {
    let rgba = image.to_rgba8();
    let mut hasher = Sha256::new();
    hasher.update(rgba.as_raw());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn sha256_gray_image(image: &GrayImage) -> String {
    let mut hasher = Sha256::new();
    hasher.update(image.as_raw());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let digest = Sha256::digest(&bytes);
    Ok(format!("sha256:{}", hex::encode(digest)))
}

fn mask_pixel_count(mask: &GrayImage) -> usize {
    (mask.width() as usize)
        .checked_mul(mask.height() as usize)
        .unwrap_or(0)
        .max(1)
}
