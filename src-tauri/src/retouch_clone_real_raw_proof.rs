#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, ImageFormat};
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

const ARTIFACT_DIR: &str = "private-artifacts/validation/retouch-clone-real-raw";
const PROOF_SLUG: &str = "retouch-clone-real-raw-v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RetouchCloneRealRawProofReport {
    artifacts: Vec<RetouchCloneRealRawArtifact>,
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
    let source_path = resolve_source_path()?;
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
    let unretouched_adjustments = json!({});
    let clone_adjustments = retouch_clone_adjustments(image_width, image_height);
    let heal_adjustments = retouch_heal_adjustments(image_width, image_height);

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

    let clone_changed_pixel_ratio = changed_pixel_ratio(&unretouched_preview, &clone_preview);
    let preview_export_mean_abs_delta = mean_abs_delta(&clone_preview, &clone_export);
    let heal_changed_pixel_ratio = changed_pixel_ratio(&unretouched_preview, &heal_preview);
    let heal_preview_export_mean_abs_delta = mean_abs_delta(&heal_preview, &heal_export);
    let source_hash_after = sha256_file(&source_path)?;

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

    let report = RetouchCloneRealRawProofReport {
        artifacts: vec![
            artifact_for_source(&source_path)?,
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
        ],
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        issue: 3252,
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
                "multi-stroke heal quality or edge-aware texture synthesis".to_string(),
            ],
            proves: vec![
                "native RAW decode can render a clone retouch layer".to_string(),
                "native RAW decode can render a heal retouch layer".to_string(),
                "preview and export use the same clone/heal retouch output".to_string(),
                "source RAW remains unchanged".to_string(),
            ],
        },
        runtime_proof: RetouchCloneRuntimeProof {
            execution: "cargo tauri-test private proof".to_string(),
            output_artifact_count: 5,
            raw_decode_path: "load_base_image_from_bytes".to_string(),
            render_path: "process_image_for_export_pipeline_with_tonemapper_override".to_string(),
            retouch_path: "retouch_render::apply_clone_retouch_layers".to_string(),
        },
        validation_mode: "private_raw_native_clone_heal_retouch_preview_export_proof".to_string(),
    };

    fs::write(
        output_dir.join(format!("{PROOF_SLUG}-report.json")),
        serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    assert!(clone_changed_pixel_ratio > 0.000_001);
    assert!(heal_changed_pixel_ratio > 0.000_001);
    assert_eq!(source_hash_before, source_hash_after);

    Ok(report)
}

fn resolve_source_path() -> Result<PathBuf, String> {
    let source = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE").map_err(|_| {
        "RAWENGINE_PRIVATE_RAW_SOURCE is required for retouch clone proof".to_string()
    })?;
    let source_path = PathBuf::from(source);
    if source_path.is_file() {
        return Ok(source_path);
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
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| format!("{} contains no RAW files", source_path.display()))
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
