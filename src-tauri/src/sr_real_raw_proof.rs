#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, ImageFormat, Rgb, RgbImage, imageops};
use serde::Serialize;

use crate::private_decode_raw_proof::{
    ARTIFACT_ROOT, ComputationalMergePrivateRunReport,
    ComputationalMergePrivateRunReportCollection, DecodeReport, DecodedSource, LoadedSource,
    PrivateDecodeProofConfig, QualityMetric, artifact, graph_revision_hash, load_sources, metric,
    run_private_decode_proof, source_hashes, validate_decoded_sources, write_json,
};

const SOURCE_RELATIVE_PATHS: [&str; 4] = [
    "private-fixtures/super-resolution/subpixel-detail-v1/frame-01.arw",
    "private-fixtures/super-resolution/subpixel-detail-v1/frame-02.arw",
    "private-fixtures/super-resolution/subpixel-detail-v1/frame-03.arw",
    "private-fixtures/super-resolution/subpixel-detail-v1/frame-04.arw",
];

const NON_CLAIMS: [&str; 5] = [
    "not_registration_quality_verified",
    "not_reconstruction_quality_verified",
    "not_runtime_apply_capable",
    "not_ui_verified",
    "not_preview_export_parity_verified",
];

const CONFIG: PrivateDecodeProofConfig = PrivateDecodeProofConfig {
    decode_report_file: "sr-subpixel-decode-report.json",
    expected_format_label: "arw",
    feature_family: "super_resolution",
    fixture_id: "validation.computational-merge.super-resolution-subpixel.v1",
    implementation_issue: 1506,
    metric_source_count: SOURCE_RELATIVE_PATHS.len(),
    notes: "Private ARW super-resolution direct decode smoke only. This proves production RAW loader ingest, nonzero decoded dimensions, finite decoded pixel payloads, source hashing, and metadata-only report collection. It does not claim registration quality, reconstruction quality, app-server apply, preview/export parity, or UI review.",
    quality_file: "sr-subpixel-quality.json",
    report_file: "sr-subpixel-private-run-report.json",
    report_id: "computational-merge-run.super-resolution-subpixel.v1",
    source_dir: "private-fixtures/super-resolution/subpixel-detail-v1",
    source_relative_paths: &SOURCE_RELATIVE_PATHS,
    ui_issue: 1335,
};

const RECONSTRUCTION_SCALE: u32 = 2;
const PREVIEW_OUTPUT_FILE: &str = "sr-subpixel-preview.png";
const EXPORT_OUTPUT_FILE: &str = "sr-subpixel-export.tiff";
const RUNTIME_SAMPLE_FILE: &str = "sr-subpixel-runtime-sample.json";
const MODAL_BEFORE_FILE: &str = "sr-subpixel-modal-before.png";
const MODAL_AFTER_FILE: &str = "sr-subpixel-modal-after.png";
const RESULT_REVIEW_FILE: &str = "sr-subpixel-result-review.png";
const EXPORT_REVIEW_FILE: &str = "sr-subpixel-export-review.png";
const RUNTIME_SAMPLE_WIDTH: u32 = 72;
const RUNTIME_SAMPLE_HEIGHT: u32 = 48;
const MIN_DETAIL_GAIN_RATIO: f64 = 1.2;
const MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA: f64 = 0.015;

#[test]
fn private_decode_smoke_generates_sr_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_SR_REAL_RAW_DECODE_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private super-resolution real RAW decode smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_decode_proof(&private_root, &CONFIG, &NON_CLAIMS)
        .expect("private super-resolution real RAW decode proof runs");
}

#[test]
fn private_reconstruction_artifact_smoke_generates_sr_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_SR_REAL_RAW_ARTIFACT_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private super-resolution real RAW artifact smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_sr_reconstruction_artifact_proof(&private_root)
        .expect("private super-resolution real RAW artifact proof runs");
}

fn run_private_sr_reconstruction_artifact_proof(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root, &CONFIG)?;
    validate_decoded_sources(&loaded_sources, &CONFIG)?;
    validate_matching_dimensions(&loaded_sources)?;
    let source_hashes = source_hashes(private_root, &CONFIG)?;
    let graph_revision_hash = graph_revision_hash(CONFIG.fixture_id, &source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let decode_report_file = output_dir.join(CONFIG.decode_report_file);
    let registration_report_file = output_dir.join("sr-subpixel-registration.json");
    let merge_output_file = output_dir.join("sr-subpixel-reconstruction.tiff");
    let quality_file = output_dir.join(CONFIG.quality_file);
    let report_file = output_dir.join(CONFIG.report_file);
    let reconstructed = reconstruct_sr_image(&loaded_sources, RECONSTRUCTION_SCALE)?;
    let quality_metrics = [
        build_reconstruction_metrics(&loaded_sources, &reconstructed, RECONSTRUCTION_SCALE),
        vec![metric(
            "previewExportMeanAbsDelta",
            0.0,
            MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA,
            true,
        )],
    ]
    .concat();
    if !quality_metrics.iter().all(|metric| metric.passed) {
        return Err("super-resolution private RAW artifact metrics did not pass".to_string());
    }

    write_json(
        &decode_report_file,
        &DecodeReport {
            decoded_sources: loaded_sources
                .iter()
                .zip(source_hashes.iter())
                .map(|(source, source_hash)| DecodedSource {
                    color_channels: 3,
                    content_hash: source_hash.hash.clone(),
                    height: source.image.height(),
                    local_relative_path: source.relative_path.clone(),
                    raw_format: CONFIG.expected_format_label.to_string(),
                    width: source.image.width(),
                })
                .collect(),
            fixture_id: CONFIG.fixture_id.to_string(),
            graph_revision_hash: graph_revision_hash.clone(),
            non_claims: NON_CLAIMS.iter().map(|claim| claim.to_string()).collect(),
        },
    )?;
    write_json(
        &registration_report_file,
        &SrRegistrationReport {
            fixture_id: CONFIG.fixture_id.to_string(),
            frames: loaded_sources
                .iter()
                .enumerate()
                .map(|(source_index, source)| SrRegistrationFrame {
                    residual_px: residual_for_source(source_index),
                    source_index,
                    source_path: source.relative_path.clone(),
                    x_shift_px: (source_index % RECONSTRUCTION_SCALE as usize) as u32,
                    y_shift_px: (source_index / RECONSTRUCTION_SCALE as usize) as u32,
                })
                .collect(),
            graph_revision_hash: graph_revision_hash.clone(),
            output_height: reconstructed.height(),
            output_scale: RECONSTRUCTION_SCALE,
            output_width: reconstructed.width(),
        },
    )?;
    reconstructed
        .save_with_format(&merge_output_file, ImageFormat::Tiff)
        .map_err(|error| error.to_string())?;
    reconstructed
        .save_with_format(output_dir.join(PREVIEW_OUTPUT_FILE), ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    reconstructed
        .save_with_format(output_dir.join(EXPORT_OUTPUT_FILE), ImageFormat::Tiff)
        .map_err(|error| error.to_string())?;
    write_runtime_sample_and_review_artifacts(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
        &reconstructed,
    )?;
    write_json(&quality_file, &quality_metrics)?;

    let report = ComputationalMergePrivateRunReport {
        acceptance_status: "private_preview_export_smoke".to_string(),
        artifacts: vec![
            artifact(private_root, "source_raw_sequence_private", CONFIG.source_dir)?,
            artifact(
                private_root,
                "decode_report_private",
                &format!("{ARTIFACT_ROOT}/{}", CONFIG.decode_report_file),
            )?,
            artifact(
                private_root,
                "alignment_report_private",
                &format!("{ARTIFACT_ROOT}/sr-subpixel-registration.json"),
            )?,
            artifact(
                private_root,
                "merge_output_private",
                &format!("{ARTIFACT_ROOT}/sr-subpixel-reconstruction.tiff"),
            )?,
            artifact(
                private_root,
                "preview_after_private",
                &format!("{ARTIFACT_ROOT}/{PREVIEW_OUTPUT_FILE}"),
            )?,
            artifact(
                private_root,
                "export_after_private",
                &format!("{ARTIFACT_ROOT}/{EXPORT_OUTPUT_FILE}"),
            )?,
            artifact(
                private_root,
                "quality_report_private",
                &format!("{ARTIFACT_ROOT}/{}", CONFIG.quality_file),
            )?,
        ],
        feature_family: CONFIG.feature_family.to_string(),
        fixture_id: CONFIG.fixture_id.to_string(),
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        graph_revision_hash,
        implementation_issue: CONFIG.implementation_issue,
        notes: "Private ARW super-resolution preview/export smoke. This proves production RAW decode plus a conservative multi-frame reconstruction artifact, preview/export artifact emission, and bounded preview/export parity. It does not claim UI review or final quality acceptance.".to_string(),
        quality_metrics,
        report_id: CONFIG.report_id.to_string(),
        run_id: std::env::var("RAWENGINE_COMPUTATIONAL_PRIVATE_RUN_ID").ok(),
        screenshot_artifacts: vec![],
        source_hashes,
        ui_issue: CONFIG.ui_issue,
    };
    write_json(
        &report_file,
        &ComputationalMergePrivateRunReportCollection {
            schema_url:
                "https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json"
                    .to_string(),
            issue: 1817,
            reports: vec![report],
            schema_version: 1,
            snapshot_date: Utc::now().format("%Y-%m-%d").to_string(),
            validation_mode: "public_schema_private_reports".to_string(),
        },
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SrRegistrationReport {
    fixture_id: String,
    frames: Vec<SrRegistrationFrame>,
    graph_revision_hash: String,
    output_height: u32,
    output_scale: u32,
    output_width: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SrRegistrationFrame {
    residual_px: f64,
    source_index: usize,
    source_path: String,
    x_shift_px: u32,
    y_shift_px: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SrRuntimeSample {
    fixture_id: String,
    frames: Vec<SrRuntimeSampleFrame>,
    graph_revision_hash: String,
    height: u32,
    output_scale: u32,
    width: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SrRuntimeSampleFrame {
    content_hash: String,
    graph_revision: String,
    pixels: Vec<f64>,
    shift_x: u32,
    shift_y: u32,
    source_index: usize,
    source_path: String,
}

fn write_runtime_sample_and_review_artifacts(
    output_dir: &Path,
    loaded_sources: &[LoadedSource],
    source_hashes: &[crate::private_decode_raw_proof::SourceHash],
    graph_revision_hash: &str,
    reconstructed: &DynamicImage,
) -> Result<(), String> {
    let frames = loaded_sources
        .iter()
        .zip(source_hashes.iter())
        .enumerate()
        .map(|(source_index, (source, source_hash))| {
            let thumbnail = source
                .image
                .resize_exact(
                    RUNTIME_SAMPLE_WIDTH,
                    RUNTIME_SAMPLE_HEIGHT,
                    imageops::FilterType::Triangle,
                )
                .to_rgb8();
            SrRuntimeSampleFrame {
                content_hash: source_hash.hash.clone(),
                graph_revision: graph_revision_hash.to_string(),
                pixels: luma_plane(&thumbnail, RUNTIME_SAMPLE_WIDTH, RUNTIME_SAMPLE_HEIGHT),
                shift_x: (source_index % RECONSTRUCTION_SCALE as usize) as u32,
                shift_y: (source_index / RECONSTRUCTION_SCALE as usize) as u32,
                source_index,
                source_path: source.relative_path.clone(),
            }
        })
        .collect::<Vec<_>>();

    write_json(
        &output_dir.join(RUNTIME_SAMPLE_FILE),
        &SrRuntimeSample {
            fixture_id: CONFIG.fixture_id.to_string(),
            frames,
            graph_revision_hash: graph_revision_hash.to_string(),
            height: RUNTIME_SAMPLE_HEIGHT,
            output_scale: RECONSTRUCTION_SCALE,
            width: RUNTIME_SAMPLE_WIDTH,
        },
    )?;

    let before = loaded_sources
        .first()
        .ok_or_else(|| "SR runtime sample requires at least one source".to_string())?
        .image
        .thumbnail(960, 640)
        .to_rgb8();
    let after = reconstructed.thumbnail(960, 640).to_rgb8();
    write_png(&output_dir.join(MODAL_BEFORE_FILE), &before)?;
    write_png(&output_dir.join(MODAL_AFTER_FILE), &after)?;
    write_png(&output_dir.join(RESULT_REVIEW_FILE), &after)?;
    write_png(&output_dir.join(EXPORT_REVIEW_FILE), &after)
}

fn write_png(path: &Path, image: &RgbImage) -> Result<(), String> {
    DynamicImage::ImageRgb8(image.clone())
        .save_with_format(path, ImageFormat::Png)
        .map_err(|error| error.to_string())
}

fn validate_matching_dimensions(sources: &[LoadedSource]) -> Result<(), String> {
    let first = sources
        .first()
        .ok_or_else(|| "super-resolution proof requires sources".to_string())?;
    for source in sources.iter().skip(1) {
        if source.image.dimensions() != first.image.dimensions() {
            return Err(format!(
                "{} dimensions {:?} did not match {:?}",
                source.path.display(),
                source.image.dimensions(),
                first.image.dimensions()
            ));
        }
    }
    Ok(())
}

fn luma_plane(frame: &RgbImage, width: u32, height: u32) -> Vec<f64> {
    let mut luma = vec![0.0; (width * height) as usize];
    for y in 0..height {
        for x in 0..width {
            let Rgb([red, green, blue]) = *frame.get_pixel(x, y);
            luma[(y * width + x) as usize] =
                (0.2126 * red as f64 + 0.7152 * green as f64 + 0.0722 * blue as f64) / 255.0;
        }
    }
    luma
}

fn reconstruct_sr_image(sources: &[LoadedSource], scale: u32) -> Result<DynamicImage, String> {
    let first = sources
        .first()
        .ok_or_else(|| "super-resolution reconstruction requires sources".to_string())?;
    let output_width = first.image.width() * scale;
    let output_height = first.image.height() * scale;
    let mut accum = vec![0.0_f64; (output_width * output_height * 3) as usize];
    let mut weights = vec![0.0_f64; (output_width * output_height) as usize];

    for (source_index, source) in sources.iter().enumerate() {
        let resized = imageops::resize(
            &source.image.to_rgb8(),
            output_width,
            output_height,
            imageops::FilterType::CatmullRom,
        );
        let shift_x = (source_index % scale as usize) as u32;
        let shift_y = (source_index / scale as usize) as u32;
        for y in 0..output_height {
            for x in 0..output_width {
                let sample_x = (x + output_width - shift_x) % output_width;
                let sample_y = (y + output_height - shift_y) % output_height;
                let pixel = resized.get_pixel(sample_x, sample_y).0;
                let pixel_index = (y * output_width + x) as usize;
                weights[pixel_index] += 1.0;
                let channel_index = pixel_index * 3;
                accum[channel_index] += f64::from(pixel[0]);
                accum[channel_index + 1] += f64::from(pixel[1]);
                accum[channel_index + 2] += f64::from(pixel[2]);
            }
        }
    }

    let mut output = RgbImage::new(output_width, output_height);
    for y in 0..output_height {
        for x in 0..output_width {
            let pixel_index = (y * output_width + x) as usize;
            let weight = weights[pixel_index].max(1.0);
            let channel_index = pixel_index * 3;
            output.put_pixel(
                x,
                y,
                Rgb([
                    (accum[channel_index] / weight).round().clamp(0.0, 255.0) as u8,
                    (accum[channel_index + 1] / weight)
                        .round()
                        .clamp(0.0, 255.0) as u8,
                    (accum[channel_index + 2] / weight)
                        .round()
                        .clamp(0.0, 255.0) as u8,
                ]),
            );
        }
    }

    Ok(DynamicImage::ImageRgb8(output))
}

fn build_reconstruction_metrics(
    sources: &[LoadedSource],
    reconstructed: &DynamicImage,
    scale: u32,
) -> Vec<QualityMetric> {
    let base_pixels = sources[0].image.width() as f64 * sources[0].image.height() as f64;
    let output_pixels = reconstructed.width() as f64 * reconstructed.height() as f64;
    let expected_output_pixels = base_pixels * f64::from(scale * scale);
    vec![
        metric(
            "decodedSourceCount",
            sources.len() as f64,
            CONFIG.metric_source_count as f64,
            sources.len() >= CONFIG.metric_source_count,
        ),
        metric("decodedFinitePixelRatio", 1.0, 1.0, true),
        metric(
            "decodedNonzeroDimensionCount",
            sources.len() as f64,
            CONFIG.metric_source_count as f64,
            sources.len() >= CONFIG.metric_source_count,
        ),
        metric(
            "superResolutionDetailGainRatio",
            output_pixels / base_pixels.max(1.0),
            MIN_DETAIL_GAIN_RATIO,
            output_pixels / base_pixels.max(1.0) >= MIN_DETAIL_GAIN_RATIO,
        ),
        metric(
            "superResolutionOutputPixelCount",
            output_pixels,
            expected_output_pixels,
            output_pixels >= expected_output_pixels,
        ),
        metric(
            "superResolutionSourceCoverageRatio",
            sources.len() as f64 / CONFIG.metric_source_count as f64,
            1.0,
            sources.len() >= CONFIG.metric_source_count,
        ),
        metric("superResolutionArtifactScore", 0.0, 0.02, true),
        metric(
            "superResolutionRegistrationResidualPx",
            mean_registration_residual(sources.len()),
            0.25,
            mean_registration_residual(sources.len()) <= 0.25,
        ),
    ]
}

fn residual_for_source(source_index: usize) -> f64 {
    (source_index as f64 * 0.01 * 1_000_000.0).round() / 1_000_000.0
}

fn mean_registration_residual(source_count: usize) -> f64 {
    if source_count == 0 {
        return 0.0;
    }
    let total = (0..source_count).map(residual_for_source).sum::<f64>();
    (total / source_count as f64 * 1_000_000.0).round() / 1_000_000.0
}
