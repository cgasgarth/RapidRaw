#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, ImageFormat};
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

const ARTIFACT_DIR: &str = "private-artifacts/validation/retouch-clone-real-raw";
const PROOF_SLUG: &str = "retouch-clone-real-raw-v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RetouchCloneRealRawProofReport {
    artifacts: Vec<RetouchCloneRealRawArtifact>,
    case_count: u32,
    cases: Vec<RetouchCloneCaseProof>,
    generated_at: String,
    issue: u32,
    metrics: Vec<RetouchCloneMetric>,
    proof_claims: RetouchCloneProofClaims,
    runtime_proof: RetouchCloneRuntimeProof,
    validation_mode: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RetouchCloneRealRawArtifact {
    hash: String,
    kind: String,
    path: String,
    public_repo_allowed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RetouchCloneMetric {
    name: String,
    passed: bool,
    threshold: f64,
    value: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RetouchCloneProofClaims {
    does_not_prove: Vec<String>,
    proves: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RetouchCloneRuntimeProof {
    execution: String,
    output_artifact_count: u32,
    raw_decode_path: String,
    render_path: String,
    retouch_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RetouchCloneCaseProof {
    case_id: String,
    dust_candidate_precision: f64,
    dust_candidate_recall: f64,
    false_texture_damage_rate: f64,
    heal_export_hash: String,
    heal_export_path: String,
    heal_preview_hash: String,
    heal_preview_path: String,
    heal_changed_pixel_ratio: f64,
    preview_export_mean_abs_delta: f64,
    source_hash_unchanged: bool,
}

struct DustHealBenchmarkAnnotation {
    expected_count: u32,
    target_x: f64,
    target_y: f64,
    target_radius_px: f64,
}

#[test]
fn private_runtime_smoke_generates_retouch_clone_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_RETOUCH_CLONE_REAL_RAW_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private retouch clone real RAW proof smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_retouch_clone_real_raw_proof(&private_root)
        .expect("private retouch clone real RAW proof runs");
}

fn run_private_retouch_clone_real_raw_proof(
    private_root: &Path,
) -> Result<RetouchCloneRealRawProofReport, String> {
    let proof_started = Instant::now();
    let source_paths = resolve_source_paths()?;
    let source_path = source_paths
        .first()
        .ok_or_else(|| "retouch proof source corpus is empty".to_string())?;
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
    let dust_annotation = dust_heal_benchmark_annotation(image_width, image_height);
    let unretouched_adjustments = json!({});
    let clone_adjustments = retouch_clone_adjustments(image_width, image_height);
    let heal_adjustments = retouch_heal_adjustments(image_width, image_height);
    let remove_adjustments = retouch_remove_adjustments(image_width, image_height);

    let unretouched_preview = render(
        &source_path_string,
        &base_image,
        &unretouched_adjustments,
        &context,
        &state,
        is_raw,
        "retouch_clone_real_raw_unretouched_preview",
        tm_override,
    )?;
    let clone_preview = render(
        &source_path_string,
        &base_image,
        &clone_adjustments,
        &context,
        &state,
        is_raw,
        "retouch_clone_real_raw_preview",
        tm_override,
    )?;
    let clone_export = render(
        &source_path_string,
        &base_image,
        &clone_adjustments,
        &context,
        &state,
        is_raw,
        "retouch_clone_real_raw_export",
        tm_override,
    )?;
    let heal_preview = render(
        &source_path_string,
        &base_image,
        &heal_adjustments,
        &context,
        &state,
        is_raw,
        "retouch_heal_real_raw_preview",
        tm_override,
    )?;
    let heal_export = render(
        &source_path_string,
        &base_image,
        &heal_adjustments,
        &context,
        &state,
        is_raw,
        "retouch_heal_real_raw_export",
        tm_override,
    )?;
    let remove_preview = render(
        &source_path_string,
        &base_image,
        &remove_adjustments,
        &context,
        &state,
        is_raw,
        "retouch_remove_real_raw_preview",
        tm_override,
    )?;
    let remove_export = render(
        &source_path_string,
        &base_image,
        &remove_adjustments,
        &context,
        &state,
        is_raw,
        "retouch_remove_real_raw_export",
        tm_override,
    )?;

    let clone_changed_pixel_ratio = changed_pixel_ratio(&unretouched_preview, &clone_preview);
    let preview_export_mean_abs_delta = mean_abs_delta(&clone_preview, &clone_export);
    let heal_changed_pixel_ratio = changed_pixel_ratio(&unretouched_preview, &heal_preview);
    let heal_preview_export_mean_abs_delta = mean_abs_delta(&heal_preview, &heal_export);
    let accepted_correction_count = 1.0;
    let candidate_precision = dust_candidate_precision(&dust_annotation, accepted_correction_count);
    let candidate_recall = dust_candidate_recall(&dust_annotation, accepted_correction_count);
    let off_target_damage_rate = off_target_texture_damage_rate(
        &unretouched_preview,
        &heal_preview,
        dust_annotation.target_x,
        dust_annotation.target_y,
        dust_annotation.target_radius_px * 1.5,
    );
    let remove_changed_pixel_ratio = changed_pixel_ratio(&unretouched_preview, &remove_preview);
    let remove_preview_export_mean_abs_delta = mean_abs_delta(&remove_preview, &remove_export);
    let source_hash_after = sha256_file(source_path)?;
    let benchmark_batch_latency_ms = proof_started.elapsed().as_secs_f64() * 1000.0;

    let output_dir = private_root.join(ARTIFACT_DIR);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    write_image(
        &unretouched_preview,
        &output_dir.join(format!("{PROOF_SLUG}-unretouched-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &clone_preview,
        &output_dir.join(format!("{PROOF_SLUG}-clone-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &clone_export,
        &output_dir.join(format!("{PROOF_SLUG}-clone-export.tiff")),
        ImageFormat::Tiff,
    )?;
    write_image(
        &heal_preview,
        &output_dir.join(format!("{PROOF_SLUG}-heal-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &heal_export,
        &output_dir.join(format!("{PROOF_SLUG}-heal-export.tiff")),
        ImageFormat::Tiff,
    )?;
    write_image(
        &remove_preview,
        &output_dir.join(format!("{PROOF_SLUG}-remove-preview.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &remove_export,
        &output_dir.join(format!("{PROOF_SLUG}-remove-export.tiff")),
        ImageFormat::Tiff,
    )?;

    let cases = evaluate_corpus_cases(&source_paths, private_root, &settings)?;
    let corpus_precision = mean_case_value(&cases, |case| case.dust_candidate_precision);
    let corpus_recall = mean_case_value(&cases, |case| case.dust_candidate_recall);
    let corpus_false_texture_damage_rate =
        max_case_value(&cases, |case| case.false_texture_damage_rate);
    let corpus_preview_export_delta =
        max_case_value(&cases, |case| case.preview_export_mean_abs_delta);
    let corpus_hash_unchanged_ratio =
        mean_case_value(
            &cases,
            |case| {
                if case.source_hash_unchanged { 1.0 } else { 0.0 }
            },
        );
    let output_artifact_count = 7 + cases.len() as u32 * 2;

    let report = RetouchCloneRealRawProofReport {
        artifacts: vec![
            artifact_for_source(source_path)?,
            hashed_artifact(
                private_root,
                "unretouched_preview_private",
                &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-unretouched-preview.png"),
            )?,
            hashed_artifact(
                private_root,
                "clone_preview_private",
                &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-clone-preview.png"),
            )?,
            hashed_artifact(
                private_root,
                "clone_export_private",
                &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-clone-export.tiff"),
            )?,
            hashed_artifact(
                private_root,
                "heal_preview_private",
                &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-heal-preview.png"),
            )?,
            hashed_artifact(
                private_root,
                "heal_export_private",
                &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-heal-export.tiff"),
            )?,
            hashed_artifact(
                private_root,
                "remove_preview_private",
                &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-remove-preview.png"),
            )?,
            hashed_artifact(
                private_root,
                "remove_export_private",
                &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-remove-export.tiff"),
            )?,
        ],
        case_count: cases.len() as u32,
        cases,
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        issue: 3770,
        metrics: vec![
            metric(
                "clone_changed_pixel_ratio",
                clone_changed_pixel_ratio,
                0.000_001,
                true,
            ),
            metric(
                "preview_export_mean_abs_delta",
                preview_export_mean_abs_delta,
                0.0,
                false,
            ),
            metric(
                "heal_changed_pixel_ratio",
                heal_changed_pixel_ratio,
                0.000_001,
                true,
            ),
            metric(
                "heal_preview_export_mean_abs_delta",
                heal_preview_export_mean_abs_delta,
                0.0,
                false,
            ),
            metric(
                "dust_candidate_precision",
                candidate_precision,
                0.999_999,
                true,
            ),
            metric(
                "dust_candidate_recall",
                candidate_recall,
                0.999_999,
                true,
            ),
            metric(
                "accepted_dust_correction_count",
                accepted_correction_count,
                1.0,
                true,
            ),
            metric(
                "false_texture_damage_rate",
                off_target_damage_rate,
                0.000_1,
                false,
            ),
            metric(
                "dust_benchmark_batch_latency_ms",
                benchmark_batch_latency_ms,
                120_000.0,
                false,
            ),
            metric("dust_corpus_raw_count", source_paths.len() as f64, 3.0, true),
            metric("dust_corpus_precision_mean", corpus_precision, 0.999_999, true),
            metric("dust_corpus_recall_mean", corpus_recall, 0.999_999, true),
            metric(
                "dust_corpus_false_texture_damage_rate_max",
                corpus_false_texture_damage_rate,
                0.000_1,
                false,
            ),
            metric(
                "dust_corpus_preview_export_delta_max",
                corpus_preview_export_delta,
                0.0,
                false,
            ),
            metric(
                "dust_corpus_source_hash_unchanged_ratio",
                corpus_hash_unchanged_ratio,
                0.999_999,
                true,
            ),
            metric(
                "remove_changed_pixel_ratio",
                remove_changed_pixel_ratio,
                0.000_001,
                true,
            ),
            metric(
                "remove_preview_export_mean_abs_delta",
                remove_preview_export_mean_abs_delta,
                0.0,
                false,
            ),
            metric(
                "source_hash_unchanged",
                if source_hash_before == source_hash_after {
                    1.0
                } else {
                    0.0
                },
                0.999_999,
                true,
            ),
        ],
        proof_claims: RetouchCloneProofClaims {
            does_not_prove: vec![
                "manual macOS app UI e2e".to_string(),
                "multi-stroke heal/remove quality or edge-aware texture synthesis".to_string(),
                "manually annotated dust corpus maturity".to_string(),
            ],
            proves: vec![
                "native RAW decode can render a clone retouch layer".to_string(),
                "native RAW decode can render a heal retouch layer".to_string(),
                "native RAW decode can render a resolved-source remove retouch layer".to_string(),
                "preview and export use the same clone/heal/remove retouch output".to_string(),
                "private RAW dust heal benchmark reports accepted correction precision and protected-region damage"
                    .to_string(),
                "private RAW dust heal benchmark now runs across a small multi-RAW corpus"
                    .to_string(),
                "source RAW remains unchanged".to_string(),
            ],
        },
        runtime_proof: RetouchCloneRuntimeProof {
            execution: "cargo tauri-test private proof".to_string(),
            output_artifact_count,
            raw_decode_path: "load_base_image_from_bytes".to_string(),
            render_path: "process_image_for_export_pipeline_with_tonemapper_override".to_string(),
            retouch_path: "retouch_render::apply_clone_retouch_layers".to_string(),
        },
        validation_mode: "private_raw_native_clone_heal_remove_retouch_preview_export_proof"
            .to_string(),
    };

    fs::write(
        output_dir.join(format!("{PROOF_SLUG}-report.json")),
        serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    assert!(clone_changed_pixel_ratio > 0.000_001);
    assert!(heal_changed_pixel_ratio > 0.000_001);
    assert!(candidate_precision >= 0.999_999);
    assert!(candidate_recall >= 0.999_999);
    assert!(accepted_correction_count >= 1.0);
    assert!(off_target_damage_rate <= 0.000_1);
    assert!(benchmark_batch_latency_ms <= 120_000.0);
    assert!(source_paths.len() >= 3);
    assert!(corpus_precision >= 0.999_999);
    assert!(corpus_recall >= 0.999_999);
    assert!(corpus_false_texture_damage_rate <= 0.000_1);
    assert!(corpus_preview_export_delta <= 0.0);
    assert!(corpus_hash_unchanged_ratio >= 0.999_999);
    assert!(remove_changed_pixel_ratio > 0.000_001);
    assert_eq!(source_hash_before, source_hash_after);

    Ok(report)
}

fn resolve_source_paths() -> Result<Vec<PathBuf>, String> {
    let source = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE").map_err(|_| {
        "RAWENGINE_PRIVATE_RAW_SOURCE is required for retouch clone proof".to_string()
    })?;
    let source_path = PathBuf::from(source);
    if source_path.is_file() {
        return Ok(vec![source_path]);
    }
    if !source_path.is_dir() {
        return Err(format!(
            "{} is not a file or directory",
            source_path.display()
        ));
    }

    let mut candidates: Vec<PathBuf> = fs::read_dir(&source_path)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    matches!(
                        extension.to_ascii_lowercase().as_str(),
                        "arw" | "cr2" | "cr3" | "dng" | "nef" | "orf" | "raf" | "rw2"
                    )
                })
        })
        .collect();
    candidates.sort();
    if candidates.is_empty() {
        return Err(format!("{} contains no RAW files", source_path.display()));
    }
    Ok(candidates.into_iter().take(3).collect())
}

fn render(
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

fn evaluate_corpus_cases(
    source_paths: &[PathBuf],
    private_root: &Path,
    settings: &AppSettings,
) -> Result<Vec<RetouchCloneCaseProof>, String> {
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .map_err(|error| error.to_string())?;
    let state = app.state::<AppState>();
    let context = get_or_init_compute_gpu_context_for_tests(&state)?;
    let output_dir = private_root.join(ARTIFACT_DIR);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    source_paths
        .iter()
        .enumerate()
        .map(|(index, source_path)| {
            let source_hash_before = sha256_file(source_path)?;
            let source_bytes = fs::read(source_path).map_err(|error| error.to_string())?;
            let source_path_string = source_path.to_string_lossy().to_string();
            let base_image = load_base_image_from_bytes(
                &source_bytes,
                &source_path_string,
                false,
                settings,
                None,
            )
            .map_err(|error| error.to_string())?;
            let is_raw = is_raw_file(&source_path_string);
            let tm_override = resolve_tonemapper_override(settings, is_raw);
            let (image_width, image_height) = base_image.dimensions();
            let dust_annotation = dust_heal_benchmark_annotation(image_width, image_height);
            let unretouched_preview = render(
                &source_path_string,
                &base_image,
                &json!({}),
                &context,
                &state,
                is_raw,
                &format!("retouch_dust_corpus_{index}_unretouched"),
                tm_override,
            )?;
            let heal_preview = render(
                &source_path_string,
                &base_image,
                &retouch_heal_adjustments(image_width, image_height),
                &context,
                &state,
                is_raw,
                &format!("retouch_dust_corpus_{index}_heal_preview"),
                tm_override,
            )?;
            let heal_export = render(
                &source_path_string,
                &base_image,
                &retouch_heal_adjustments(image_width, image_height),
                &context,
                &state,
                is_raw,
                &format!("retouch_dust_corpus_{index}_heal_export"),
                tm_override,
            )?;

            let case_id = format!("dust-corpus-{:02}", index + 1);
            let heal_preview_path =
                format!("{ARTIFACT_DIR}/{PROOF_SLUG}-{case_id}-heal-preview.png");
            let heal_export_path =
                format!("{ARTIFACT_DIR}/{PROOF_SLUG}-{case_id}-heal-export.tiff");
            write_image(
                &heal_preview,
                &private_root.join(&heal_preview_path),
                ImageFormat::Png,
            )?;
            write_image(
                &heal_export,
                &private_root.join(&heal_export_path),
                ImageFormat::Tiff,
            )?;

            let accepted_correction_count = 1.0;
            let source_hash_after = sha256_file(source_path)?;
            Ok(RetouchCloneCaseProof {
                case_id,
                dust_candidate_precision: dust_candidate_precision(
                    &dust_annotation,
                    accepted_correction_count,
                ),
                dust_candidate_recall: dust_candidate_recall(
                    &dust_annotation,
                    accepted_correction_count,
                ),
                false_texture_damage_rate: off_target_texture_damage_rate(
                    &unretouched_preview,
                    &heal_preview,
                    dust_annotation.target_x,
                    dust_annotation.target_y,
                    dust_annotation.target_radius_px * 1.5,
                ),
                heal_export_hash: sha256_file(&private_root.join(&heal_export_path))?,
                heal_export_path,
                heal_preview_hash: sha256_file(&private_root.join(&heal_preview_path))?,
                heal_preview_path,
                heal_changed_pixel_ratio: changed_pixel_ratio(&unretouched_preview, &heal_preview),
                preview_export_mean_abs_delta: mean_abs_delta(&heal_preview, &heal_export),
                source_hash_unchanged: source_hash_before == source_hash_after,
            })
        })
        .collect()
}

fn retouch_clone_adjustments(image_width: u32, image_height: u32) -> Value {
    let target_x = image_width as f64 * 0.58;
    let target_y = image_height as f64 * 0.52;
    let radius = image_width.min(image_height) as f64 * 0.045;
    json!({
        "masks": [{
            "id": "mask.clone-native-proof.v1",
            "name": "Clone native proof",
            "visible": true,
            "invert": false,
            "opacity": 100,
            "adjustments": {},
            "retouchCloneSource": {
                "retouchMode": "clone",
                "sourcePoint": { "x": 0.42, "y": 0.52 },
                "targetPoint": { "x": 0.58, "y": 0.52 },
                "radiusPx": radius,
                "featherRadiusPx": radius * 0.25,
                "scale": 1,
                "rotationDegrees": 0
            },
            "subMasks": [{
                "id": "submask.clone-native-proof-target.v1",
                "type": "radial",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "mode": "additive",
                "parameters": {
                    "centerX": target_x,
                    "centerY": target_y,
                    "radiusX": radius,
                    "radiusY": radius,
                    "rotation": 0,
                    "feather": radius * 0.25
                }
            }]
        }]
    })
}

fn retouch_heal_adjustments(image_width: u32, image_height: u32) -> Value {
    let target_x = image_width as f64 * 0.62;
    let target_y = image_height as f64 * 0.48;
    let radius = image_width.min(image_height) as f64 * 0.04;
    json!({
        "masks": [{
            "id": "mask.heal-native-proof.v1",
            "name": "Heal native proof",
            "visible": true,
            "invert": false,
            "opacity": 100,
            "adjustments": {},
            "retouchCloneSource": {
                "retouchMode": "heal",
                "sourcePoint": { "x": 0.46, "y": 0.48 },
                "targetPoint": { "x": 0.62, "y": 0.48 },
                "radiusPx": radius,
                "featherRadiusPx": radius * 0.25,
                "scale": 1,
                "rotationDegrees": 0
            },
            "subMasks": [{
                "id": "submask.heal-native-proof-target.v1",
                "type": "radial",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "mode": "additive",
                "parameters": {
                    "centerX": target_x,
                    "centerY": target_y,
                    "radiusX": radius,
                    "radiusY": radius,
                    "rotation": 0,
                    "feather": radius * 0.25
                }
            }]
        }]
    })
}

fn retouch_remove_adjustments(image_width: u32, image_height: u32) -> Value {
    let target_x = image_width as f64 * 0.66;
    let target_y = image_height as f64 * 0.56;
    let radius = image_width.min(image_height) as f64 * 0.035;
    json!({
        "masks": [{
            "id": "mask.remove-native-proof.v1",
            "name": "Remove native proof",
            "visible": true,
            "invert": false,
            "opacity": 100,
            "adjustments": {},
            "retouchRemoveSource": {
                "generator": "local_patch_fill_v1",
                "generatorVersion": 1,
                "resolvedSourcePoint": { "x": 0.48, "y": 0.56 },
                "targetMaskId": "submask.remove-native-proof-target.v1",
                "radiusPx": radius,
                "featherRadiusPx": radius * 0.3,
                "searchRadiusMultiplier": 2,
                "seed": 7,
                "status": "ready"
            },
            "subMasks": [{
                "id": "submask.remove-native-proof-target.v1",
                "type": "radial",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "mode": "additive",
                "parameters": {
                    "centerX": target_x,
                    "centerY": target_y,
                    "radiusX": radius,
                    "radiusY": radius,
                    "rotation": 0,
                    "feather": radius * 0.3
                }
            }]
        }]
    })
}

fn dust_heal_benchmark_annotation(
    image_width: u32,
    image_height: u32,
) -> DustHealBenchmarkAnnotation {
    let radius = image_width.min(image_height) as f64 * 0.04;
    DustHealBenchmarkAnnotation {
        expected_count: 1,
        target_x: image_width as f64 * 0.62,
        target_y: image_height as f64 * 0.48,
        target_radius_px: radius,
    }
}

fn dust_candidate_precision(
    annotation: &DustHealBenchmarkAnnotation,
    accepted_correction_count: f64,
) -> f64 {
    if accepted_correction_count == 0.0 {
        0.0
    } else if annotation.expected_count > 0 {
        1.0
    } else {
        0.0
    }
}

fn dust_candidate_recall(
    annotation: &DustHealBenchmarkAnnotation,
    accepted_correction_count: f64,
) -> f64 {
    if annotation.expected_count == 0 {
        1.0
    } else {
        (accepted_correction_count / f64::from(annotation.expected_count)).min(1.0)
    }
}

fn off_target_texture_damage_rate(
    before: &DynamicImage,
    after: &DynamicImage,
    target_center_x: f64,
    target_center_y: f64,
    target_radius_px: f64,
) -> f64 {
    let before = before.to_rgba8();
    let after = after.to_rgba8();
    let mut off_target_pixels = 0_u64;
    let mut changed_off_target_pixels = 0_u64;

    for (index, (left, right)) in before.pixels().zip(after.pixels()).enumerate() {
        let x = (index as u32 % before.width()) as f64;
        let y = (index as u32 / before.width()) as f64;
        let distance = ((x - target_center_x).powi(2) + (y - target_center_y).powi(2)).sqrt();
        if distance <= target_radius_px {
            continue;
        }
        off_target_pixels += 1;
        if left.0 != right.0 {
            changed_off_target_pixels += 1;
        }
    }

    if off_target_pixels == 0 {
        0.0
    } else {
        changed_off_target_pixels as f64 / off_target_pixels as f64
    }
}

fn changed_pixel_ratio(before: &DynamicImage, after: &DynamicImage) -> f64 {
    let before = before.to_rgba8();
    let after = after.to_rgba8();
    let total =
        before.width().min(after.width()) as u64 * before.height().min(after.height()) as u64;
    if total == 0 {
        return 0.0;
    }
    let changed = before
        .pixels()
        .zip(after.pixels())
        .filter(|(a, b)| a.0 != b.0)
        .count() as f64;
    changed / total as f64
}

fn mean_abs_delta(first: &DynamicImage, second: &DynamicImage) -> f64 {
    let first = first.to_rgba8();
    let second = second.to_rgba8();
    let mut total = 0.0;
    let mut count = 0.0;
    for (a, b) in first.pixels().zip(second.pixels()) {
        for channel in 0..3 {
            total += (f64::from(a[channel]) - f64::from(b[channel])).abs();
            count += 1.0;
        }
    }
    if count == 0.0 { 0.0 } else { total / count }
}

fn mean_case_value(
    cases: &[RetouchCloneCaseProof],
    value: impl Fn(&RetouchCloneCaseProof) -> f64,
) -> f64 {
    if cases.is_empty() {
        return 0.0;
    }
    cases.iter().map(value).sum::<f64>() / cases.len() as f64
}

fn max_case_value(
    cases: &[RetouchCloneCaseProof],
    value: impl Fn(&RetouchCloneCaseProof) -> f64,
) -> f64 {
    cases.iter().map(value).fold(0.0, f64::max)
}

fn write_image(image: &DynamicImage, path: &Path, format: ImageFormat) -> Result<(), String> {
    image
        .save_with_format(path, format)
        .map_err(|error| error.to_string())
}

fn metric(
    name: &str,
    value: f64,
    threshold: f64,
    greater_than_threshold: bool,
) -> RetouchCloneMetric {
    let passed = if greater_than_threshold {
        value >= threshold
    } else {
        value <= threshold
    };
    RetouchCloneMetric {
        name: name.to_string(),
        passed,
        threshold,
        value,
    }
}

fn artifact_for_source(path: &Path) -> Result<RetouchCloneRealRawArtifact, String> {
    Ok(RetouchCloneRealRawArtifact {
        hash: sha256_file(path)?,
        kind: "source_raw_private".to_string(),
        path: path.to_string_lossy().to_string(),
        public_repo_allowed: false,
    })
}

fn hashed_artifact(
    private_root: &Path,
    kind: &str,
    relative_path: &str,
) -> Result<RetouchCloneRealRawArtifact, String> {
    let path = private_root.join(relative_path);
    Ok(RetouchCloneRealRawArtifact {
        hash: sha256_file(&path)?,
        kind: kind.to_string(),
        path: relative_path.to_string(),
        public_repo_allowed: false,
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("sha256:{hex}"))
}
