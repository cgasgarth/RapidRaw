#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, ImageFormat, Pixel};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::app_settings::AppSettings;
use crate::deblur_render::{DeblurRenderStatus, apply_deblur_stage, calculate_deblur_render_hash};
use crate::formats::is_raw_file;
use crate::image_loader::load_base_image_from_bytes;

const ARTIFACT_DIR: &str = "private-artifacts/validation/detail-deblur-real-raw";
const SOURCE_RELATIVE_PATH: &str = "private-fixtures/detail/alaska-deblur-v1.arw";
const PROOF_SLUG: &str = "alaska-deblur-v1";
const FIXTURE_ID: &str = "validation.detail.deblur-real-raw.alaska.v1";
const REPORT_ID: &str = "detail-deblur-real-raw.alaska.v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeblurRealRawProofReport {
    artifacts: Vec<DeblurRealRawArtifact>,
    fixture_id: String,
    generated_at: String,
    issue: u32,
    metrics: Vec<DeblurRealRawMetric>,
    proof_claims: DeblurRealRawProofClaims,
    report_id: String,
    runtime_proof: DeblurRealRawRuntimeProof,
    validation_mode: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeblurRealRawArtifact {
    hash: String,
    kind: String,
    path: String,
    public_repo_allowed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeblurRealRawMetric {
    name: String,
    passed: bool,
    threshold: f64,
    value: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeblurRealRawProofClaims {
    does_not_prove: Vec<String>,
    proves: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeblurRealRawRuntimeProof {
    decode_path: String,
    execution: String,
    macos_app_ui_e2e: bool,
    preview_export_parity_metric: String,
    render_stage: String,
    source_is_raw: bool,
}

#[test]
fn private_runtime_smoke_generates_deblur_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_DEBLUR_REAL_RAW_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private deblur real RAW proof smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_deblur_real_raw_proof(&private_root).expect("private deblur real RAW proof runs");
}

fn run_private_deblur_real_raw_proof(
    private_root: &Path,
) -> Result<DeblurRealRawProofReport, String> {
    let source_path = private_root.join(SOURCE_RELATIVE_PATH);
    let source_hash_before = sha256_file(&source_path)?;
    let source_bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    let source_path_string = source_path.to_string_lossy().to_string();
    let settings = AppSettings::default();
    let base_image =
        load_base_image_from_bytes(&source_bytes, &source_path_string, false, &settings, None)
            .map_err(|error| error.to_string())?;

    let enabled = json!({
        "deblurEnabled": true,
        "deblurSigmaPx": 0.8,
        "deblurStrength": 32
    });
    let disabled = json!({
        "deblurEnabled": false,
        "deblurSigmaPx": 0.8,
        "deblurStrength": 32
    });

    let preview_result = apply_deblur_stage(&base_image, &enabled);
    let export_result = apply_deblur_stage(&base_image, &enabled);
    let disabled_result = apply_deblur_stage(&base_image, &disabled);
    let preview = preview_result.image.into_owned();
    let export = export_result.image.into_owned();
    let input_to_preview_mean_abs_delta = mean_abs_delta(&base_image, &preview);
    let input_to_preview_max_delta = max_delta(&base_image, &preview);
    let disabled_preview_max_delta = max_delta(&base_image, disabled_result.image.as_ref());
    let preview_export_mean_abs_delta = mean_abs_delta(&preview, &export);
    let preview_export_max_delta = max_delta(&preview, &export);
    let preview_export_p99_abs_delta = p99_abs_delta(&preview, &export);
    let edge_energy_ratio = edge_energy(&preview) / edge_energy(&base_image).max(f64::EPSILON);
    let source_hash_after = sha256_file(&source_path)?;

    let output_dir = private_root.join(ARTIFACT_DIR);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    write_image(
        &base_image,
        &output_dir.join(format!("{PROOF_SLUG}-preview-before.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &preview,
        &output_dir.join(format!("{PROOF_SLUG}-preview-after.png")),
        ImageFormat::Png,
    )?;
    write_image(
        &export,
        &output_dir.join(format!("{PROOF_SLUG}-export-after.tiff")),
        ImageFormat::Tiff,
    )?;
    write_image(
        &amplified_diff_image(&preview, &export, 24.0),
        &output_dir.join(format!("{PROOF_SLUG}-preview-export-diff.png")),
        ImageFormat::Png,
    )?;

    let enabled_render_hash = calculate_deblur_render_hash(42, &enabled);
    let disabled_render_hash = calculate_deblur_render_hash(42, &disabled);
    let mut artifacts = vec![
        hashed_artifact(private_root, "source_raw_private", SOURCE_RELATIVE_PATH)?,
        hashed_artifact(
            private_root,
            "preview_before_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-preview-before.png"),
        )?,
        hashed_artifact(
            private_root,
            "preview_after_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-preview-after.png"),
        )?,
        hashed_artifact(
            private_root,
            "export_after_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-export-after.tiff"),
        )?,
        hashed_artifact(
            private_root,
            "preview_export_diff_private",
            &format!("{ARTIFACT_DIR}/{PROOF_SLUG}-preview-export-diff.png"),
        )?,
    ];

    let metrics = vec![
        metric(
            "inputToPreviewMeanAbsDelta",
            input_to_preview_mean_abs_delta,
            0.00005,
            input_to_preview_mean_abs_delta > 0.00005,
        ),
        metric(
            "inputToPreviewMaxDelta",
            input_to_preview_max_delta,
            0.0001,
            input_to_preview_max_delta > 0.0001,
        ),
        metric(
            "previewExportMeanAbsDelta",
            preview_export_mean_abs_delta,
            0.000001,
            preview_export_mean_abs_delta <= 0.000001,
        ),
        metric(
            "previewExportMaxDelta",
            preview_export_max_delta,
            0.000001,
            preview_export_max_delta <= 0.000001,
        ),
        metric(
            "previewExportP99AbsDelta",
            preview_export_p99_abs_delta,
            0.000001,
            preview_export_p99_abs_delta <= 0.000001,
        ),
        metric(
            "disabledPreviewMaxDelta",
            disabled_preview_max_delta,
            0.0,
            disabled_preview_max_delta == 0.0,
        ),
        metric(
            "edgeEnergyRatio",
            edge_energy_ratio,
            1.0,
            edge_energy_ratio >= 1.0,
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

    let report = DeblurRealRawProofReport {
        artifacts: Vec::new(),
        fixture_id: FIXTURE_ID.to_string(),
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        issue: 2891,
        metrics,
        proof_claims: proof_claims(),
        report_id: REPORT_ID.to_string(),
        runtime_proof: DeblurRealRawRuntimeProof {
            decode_path: "load_base_image_from_bytes".to_string(),
            execution: "tauri_test_real_raw_deblur_stage".to_string(),
            macos_app_ui_e2e: false,
            preview_export_parity_metric: "previewExportMeanAbsDelta".to_string(),
            render_stage: "apply_deblur_stage".to_string(),
            source_is_raw: is_raw_file(&source_path_string),
        },
        validation_mode: "private_raw_deblur_preview_export_parity".to_string(),
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

    let report = DeblurRealRawProofReport {
        artifacts,
        ..report
    };
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    assert_eq!(preview_result.status, DeblurRenderStatus::Applied);
    assert_eq!(export_result.status, DeblurRenderStatus::Applied);
    assert!(report.metrics.iter().all(|metric| metric.passed));
    assert_ne!(enabled_render_hash, disabled_render_hash);
    Ok(report)
}

fn proof_claims() -> DeblurRealRawProofClaims {
    DeblurRealRawProofClaims {
        does_not_prove: vec![
            "capture_one_class_deblur_quality".to_string(),
            "gpu_deblur_parity".to_string(),
            "macos_app_ui_e2e_session".to_string(),
            "public_raw_fixture_distribution".to_string(),
        ],
        proves: vec![
            "private_real_raw_decode".to_string(),
            "deblur_stage_changes_real_raw_pixels".to_string(),
            "disabled_deblur_noop".to_string(),
            "shared_stage_preview_export_parity".to_string(),
            "preview_export_diff_artifact_generated".to_string(),
            "source_raw_not_mutated".to_string(),
        ],
    }
}

fn write_image(image: &DynamicImage, path: &Path, format: ImageFormat) -> Result<(), String> {
    image
        .to_rgb8()
        .save_with_format(path, format)
        .map_err(|error| error.to_string())
}

fn hashed_artifact(
    private_root: &Path,
    kind: &str,
    relative_path: &str,
) -> Result<DeblurRealRawArtifact, String> {
    Ok(DeblurRealRawArtifact {
        hash: sha256_file(&private_root.join(relative_path))?,
        kind: kind.to_string(),
        path: relative_path.to_string(),
        public_repo_allowed: false,
    })
}

fn metric(name: &str, value: f64, threshold: f64, passed: bool) -> DeblurRealRawMetric {
    DeblurRealRawMetric {
        name: name.to_string(),
        passed,
        threshold,
        value,
    }
}

fn mean_abs_delta(before: &DynamicImage, after: &DynamicImage) -> f64 {
    let before = before.to_rgb32f();
    let after = after.to_rgb32f();
    let mut total = 0.0;
    let mut count = 0_u64;
    for (left, right) in before.pixels().zip(after.pixels()) {
        for (left_channel, right_channel) in left.channels().iter().zip(right.channels().iter()) {
            total += (*left_channel as f64 - *right_channel as f64).abs();
            count += 1;
        }
    }
    if count == 0 {
        0.0
    } else {
        total / count as f64
    }
}

fn max_delta(before: &DynamicImage, after: &DynamicImage) -> f64 {
    before
        .to_rgb32f()
        .pixels()
        .zip(after.to_rgb32f().pixels())
        .map(|(left, right)| {
            left.channels()
                .iter()
                .zip(right.channels().iter())
                .map(|(left_channel, right_channel)| {
                    (*left_channel as f64 - *right_channel as f64).abs()
                })
                .fold(0.0_f64, f64::max)
        })
        .fold(0.0_f64, f64::max)
}

fn p99_abs_delta(before: &DynamicImage, after: &DynamicImage) -> f64 {
    let before = before.to_rgb32f();
    let after = after.to_rgb32f();
    let mut deltas = before
        .pixels()
        .zip(after.pixels())
        .flat_map(|(left, right)| {
            left.channels()
                .iter()
                .zip(right.channels().iter())
                .map(|(left_channel, right_channel)| {
                    (*left_channel as f64 - *right_channel as f64).abs()
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    if deltas.is_empty() {
        return 0.0;
    }
    deltas.sort_by(f64::total_cmp);
    let index = ((deltas.len() - 1) as f64 * 0.99).round() as usize;
    deltas[index]
}

fn edge_energy(image: &DynamicImage) -> f64 {
    let gray = image.to_luma32f();
    let width = gray.width();
    let height = gray.height();
    if width < 3 || height < 3 {
        return 0.0;
    }
    let mut total = 0.0;
    let mut count = 0_u64;
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let dx = gray.get_pixel(x + 1, y)[0] as f64 - gray.get_pixel(x - 1, y)[0] as f64;
            let dy = gray.get_pixel(x, y + 1)[0] as f64 - gray.get_pixel(x, y - 1)[0] as f64;
            total += (dx * dx + dy * dy).sqrt();
            count += 1;
        }
    }
    total / count.max(1) as f64
}

fn amplified_diff_image(preview: &DynamicImage, export: &DynamicImage, gain: f32) -> DynamicImage {
    let preview = preview.to_rgb32f();
    let export = export.to_rgb32f();
    let mut diff = image::RgbImage::new(preview.width(), preview.height());
    for (x, y, pixel) in diff.enumerate_pixels_mut() {
        let left = preview.get_pixel(x, y).channels();
        let right = export.get_pixel(x, y).channels();
        *pixel = image::Rgb([
            ((left[0] - right[0]).abs() * gain * 255.0).clamp(0.0, 255.0) as u8,
            ((left[1] - right[1]).abs() * gain * 255.0).clamp(0.0, 255.0) as u8,
            ((left[2] - right[2]).abs() * gain * 255.0).clamp(0.0, 255.0) as u8,
        ]);
    }
    DynamicImage::ImageRgb8(diff)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}
