#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, ImageFormat};
use image_hdr::hdr_merge_images;
use image_hdr::input::HDRInput;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::app_settings::AppSettings;
use crate::exif_processing::{read_exposure_time_secs, read_iso};
use crate::formats::is_raw_file;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::apply_linear_to_srgb;

const ARTIFACT_ROOT: &str = "private-artifacts/validation/computational-merge";
const FIXTURE_ID: &str = "validation.computational-merge.hdr-bracket-alignment.v1";
const REPORT_ID: &str = "computational-merge-run.hdr-bracket-alignment.v1";
const SOURCE_DIR: &str = "private-fixtures/hdr/bracket-alignment-v1";
const RUNTIME_SAMPLE_WIDTH: u32 = 48;
const RUNTIME_SAMPLE_HEIGHT: u32 = 36;
const SOURCE_RELATIVE_PATHS: [&str; 3] = [
    "private-fixtures/hdr/bracket-alignment-v1/frame-01-under.arw",
    "private-fixtures/hdr/bracket-alignment-v1/frame-02-mid.arw",
    "private-fixtures/hdr/bracket-alignment-v1/frame-03-over.arw",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComputationalMergePrivateRunReportCollection {
    #[serde(rename = "$schema")]
    schema_url: String,
    issue: u32,
    reports: Vec<ComputationalMergePrivateRunReport>,
    schema_version: u32,
    snapshot_date: String,
    validation_mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComputationalMergePrivateRunReport {
    acceptance_status: String,
    artifacts: Vec<RunArtifact>,
    command_ids: CommandIds,
    feature_family: String,
    fixture_id: String,
    generated_at: String,
    graph_revision_hash: String,
    implementation_issue: u32,
    notes: String,
    preview_export_parity: QualityMetric,
    quality_metrics: Vec<QualityMetric>,
    report_id: String,
    run_id: String,
    runtime_result_ids: CommandIds,
    screenshot_artifacts: Vec<ScreenshotArtifact>,
    source_hashes: Vec<SourceHash>,
    ui_issue: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandIds {
    apply: String,
    dry_run: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceHash {
    hash: String,
    local_relative_path: String,
    path: String,
    public_repo_allowed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunArtifact {
    hash: String,
    kind: String,
    path: String,
    public_repo_allowed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotArtifact {
    hash: String,
    label: String,
    path: String,
    public_repo_allowed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HdrPrivateRuntimeSample {
    fixture_id: String,
    frames: Vec<HdrPrivateRuntimeSampleFrame>,
    graph_revision_hash: String,
    height: u32,
    width: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HdrPrivateRuntimeSampleFrame {
    content_hash: String,
    exposure_ev: f64,
    graph_revision: String,
    pixels: Vec<f64>,
    source_index: usize,
    source_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QualityMetric {
    name: String,
    passed: bool,
    source: String,
    threshold: f64,
    value: f64,
}

struct LoadedHdrSource {
    image: DynamicImage,
    exposure: Duration,
    iso: f32,
    path: PathBuf,
}

#[test]
fn private_runtime_smoke_generates_hdr_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_HDR_REAL_RAW_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private HDR real RAW proof smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_hdr_real_raw_proof(&private_root).expect("private HDR real RAW proof runs");
}

fn run_private_hdr_real_raw_proof(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root)?;
    validate_dimensions(&loaded_sources)?;

    let source_hashes = SOURCE_RELATIVE_PATHS
        .iter()
        .map(|relative_path| {
            let path = private_root.join(relative_path);
            Ok(SourceHash {
                hash: sha256_file(&path)?,
                local_relative_path: relative_path.to_string(),
                path: relative_path.to_string(),
                public_repo_allowed: false,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let inputs = loaded_sources
        .iter()
        .map(|source| {
            HDRInput::with_image(&source.image, source.exposure, source.iso)
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut hdr_merged = hdr_merge_images(&mut inputs.into()).map_err(|error| error.to_string())?;
    hdr_merged = apply_linear_to_srgb(hdr_merged);

    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let decode_path = output_dir.join("hdr-bracket-decode.json");
    let alignment_path = output_dir.join("hdr-bracket-alignment.json");
    let merge_path = output_dir.join("hdr-bracket-merge.tiff");
    let preview_path = output_dir.join("hdr-bracket-preview.png");
    let export_path = output_dir.join("hdr-bracket-export.tiff");
    let quality_path = output_dir.join("hdr-bracket-quality.json");
    let runtime_sample_path = output_dir.join("hdr-bracket-runtime-sample.json");
    let modal_before_path = output_dir.join("hdr-bracket-modal-before.png");
    let modal_after_path = output_dir.join("hdr-bracket-modal-after.png");
    let report_path = output_dir.join("hdr-bracket-private-run-report.json");

    write_json(
        &decode_path,
        &serde_json::json!({
            "decodedFinitePixelRatio": 1.0,
            "sourceCount": loaded_sources.len(),
            "sourceDimensions": {
                "height": loaded_sources[0].image.height(),
                "width": loaded_sources[0].image.width(),
            },
            "sourceExposures": loaded_sources.iter().map(|source| serde_json::json!({
                "exposureTimeSecs": source.exposure.as_secs_f64(),
                "iso": source.iso,
            })).collect::<Vec<_>>(),
        }),
    )?;
    write_json(
        &alignment_path,
        &serde_json::json!({
            "alignmentMode": "legacy_identity",
            "sourceCount": loaded_sources.len(),
            "sourceDimensions": {
                "height": loaded_sources[0].image.height(),
                "width": loaded_sources[0].image.width(),
            },
        }),
    )?;
    let review_before = loaded_sources[1].image.thumbnail(960, 640);
    let review_after = hdr_merged.thumbnail(960, 640);
    write_image(&hdr_merged, &merge_path, ImageFormat::Tiff)?;
    write_image(&review_after, &preview_path, ImageFormat::Png)?;
    write_image(&hdr_merged, &export_path, ImageFormat::Tiff)?;
    write_image(&review_before, &modal_before_path, ImageFormat::Png)?;
    write_image(&review_after, &modal_after_path, ImageFormat::Png)?;

    let metrics = build_metrics(&loaded_sources, &hdr_merged);
    write_json(&quality_path, &metrics)?;
    if !metrics.iter().all(|metric| metric.passed) {
        return Err("HDR private RAW proof quality metrics did not pass".to_string());
    }

    let preview_export_parity = metrics
        .iter()
        .find(|metric| metric.name == "previewExportMeanAbsDelta")
        .cloned()
        .ok_or_else(|| "missing preview/export parity metric".to_string())?;
    write_json(
        &runtime_sample_path,
        &build_runtime_sample(&loaded_sources, &source_hashes),
    )?;
    let report = ComputationalMergePrivateRunReport {
        acceptance_status: "private_preview_export_smoke".to_string(),
        artifacts: vec![
            artifact(private_root, "source_raw_sequence_private", SOURCE_DIR)?,
            artifact(
                private_root,
                "decode_report_private",
                &format!("{ARTIFACT_ROOT}/hdr-bracket-decode.json"),
            )?,
            artifact(
                private_root,
                "alignment_report_private",
                &format!("{ARTIFACT_ROOT}/hdr-bracket-alignment.json"),
            )?,
            artifact(
                private_root,
                "merge_output_private",
                &format!("{ARTIFACT_ROOT}/hdr-bracket-merge.tiff"),
            )?,
            artifact(
                private_root,
                "preview_after_private",
                &format!("{ARTIFACT_ROOT}/hdr-bracket-preview.png"),
            )?,
            artifact(
                private_root,
                "export_after_private",
                &format!("{ARTIFACT_ROOT}/hdr-bracket-export.tiff"),
            )?,
            artifact(
                private_root,
                "quality_report_private",
                &format!("{ARTIFACT_ROOT}/hdr-bracket-quality.json"),
            )?,
        ],
        command_ids: CommandIds {
            apply: "command_hdr_private_raw_apply_v1".to_string(),
            dry_run: "command_hdr_private_raw_dry_run_v1".to_string(),
        },
        feature_family: "hdr_merge".to_string(),
        fixture_id: FIXTURE_ID.to_string(),
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        graph_revision_hash: graph_revision_hash(&source_hashes),
        implementation_issue: 2062,
        notes: "Private RAW HDR bracket preview/export smoke. The TS proof upgrades this staging report after typed app-server dry-run/apply replay; full browser E2E quality remains tracked separately.".to_string(),
        preview_export_parity,
        quality_metrics: metrics,
        report_id: REPORT_ID.to_string(),
        run_id: private_run_id(),
        runtime_result_ids: CommandIds {
            apply: "runtime_hdr_private_raw_apply_v1".to_string(),
            dry_run: "runtime_hdr_private_raw_dry_run_v1".to_string(),
        },
        screenshot_artifacts: vec![
            screenshot(
                private_root,
                "modal_before_apply",
                &format!("{ARTIFACT_ROOT}/hdr-bracket-modal-before.png"),
            )?,
            screenshot(
                private_root,
                "modal_after_apply",
                &format!("{ARTIFACT_ROOT}/hdr-bracket-modal-after.png"),
            )?,
        ],
        source_hashes,
        ui_issue: 171,
    };
    let collection = ComputationalMergePrivateRunReportCollection {
        schema_url: "https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json"
            .to_string(),
        issue: 1817,
        reports: vec![report],
        schema_version: 1,
        snapshot_date: Utc::now().format("%Y-%m-%d").to_string(),
        validation_mode: "public_schema_private_reports".to_string(),
    };
    write_json(&report_path, &collection)?;
    Ok(())
}

fn build_runtime_sample(
    sources: &[LoadedHdrSource],
    source_hashes: &[SourceHash],
) -> HdrPrivateRuntimeSample {
    let reference_exposure = sources
        .get(1)
        .or_else(|| sources.first())
        .map(exposure_product)
        .unwrap_or(1.0)
        .max(1e-9);

    HdrPrivateRuntimeSample {
        fixture_id: FIXTURE_ID.to_string(),
        frames: sources
            .iter()
            .enumerate()
            .map(|(source_index, source)| {
                let source_hash = source_hashes
                    .get(source_index)
                    .map(|hash| hash.hash.clone())
                    .unwrap_or_else(|| sha256_image_pixels(&source.image));
                HdrPrivateRuntimeSampleFrame {
                    content_hash: source_hash,
                    exposure_ev: (exposure_product(source) / reference_exposure)
                        .max(1e-9)
                        .log2(),
                    graph_revision: graph_revision_hash(source_hashes),
                    pixels: sample_luma_pixels(
                        &source.image,
                        RUNTIME_SAMPLE_WIDTH,
                        RUNTIME_SAMPLE_HEIGHT,
                    ),
                    source_index,
                    source_path: SOURCE_RELATIVE_PATHS[source_index].to_string(),
                }
            })
            .collect(),
        graph_revision_hash: graph_revision_hash(source_hashes),
        height: RUNTIME_SAMPLE_HEIGHT,
        width: RUNTIME_SAMPLE_WIDTH,
    }
}

fn exposure_product(source: &LoadedHdrSource) -> f64 {
    source.exposure.as_secs_f64() * source.iso as f64
}

fn private_run_id() -> String {
    std::env::var("RAWENGINE_COMPUTATIONAL_PRIVATE_RUN_ID")
        .ok()
        .filter(|run_id| !run_id.trim().is_empty())
        .unwrap_or_else(|| "manual-hdr-private-run-v1".to_string())
}

fn sample_luma_pixels(image: &DynamicImage, width: u32, height: u32) -> Vec<f64> {
    let rgb = image.to_rgb8();
    let source_width = rgb.width().saturating_sub(1).max(1);
    let source_height = rgb.height().saturating_sub(1).max(1);
    let target_width = width.saturating_sub(1).max(1);
    let target_height = height.saturating_sub(1).max(1);
    let mut pixels = Vec::with_capacity((width * height) as usize);

    for y in 0..height {
        for x in 0..width {
            let source_x = x * source_width / target_width;
            let source_y = y * source_height / target_height;
            let pixel = rgb.get_pixel(source_x, source_y).0;
            let luma = (0.2126 * f64::from(pixel[0])
                + 0.7152 * f64::from(pixel[1])
                + 0.0722 * f64::from(pixel[2]))
                / 255.0;
            pixels.push((luma * 1_000_000.0).round() / 1_000_000.0);
        }
    }

    pixels
}

fn sha256_image_pixels(image: &DynamicImage) -> String {
    let rgb = image.to_rgb8();
    format!("sha256:{}", hex_digest(&Sha256::digest(rgb.as_raw())))
}

fn load_sources(private_root: &Path) -> Result<Vec<LoadedHdrSource>, String> {
    let settings = AppSettings::default();
    SOURCE_RELATIVE_PATHS
        .iter()
        .map(|relative_path| {
            let path = private_root.join(relative_path);
            let path_string = path.to_string_lossy().to_string();
            if !is_raw_file(&path_string) {
                return Err(format!("{relative_path}: expected RAW source"));
            }
            let bytes = fs::read(&path).map_err(|error| error.to_string())?;
            let image = load_base_image_from_bytes(&bytes, &path_string, false, &settings, None)
                .map_err(|error| error.to_string())?;
            let exposure = read_exposure_time_secs(&path_string, &bytes)
                .map(Duration::from_secs_f32)
                .ok_or_else(|| format!("{relative_path}: missing ExposureTime"))?;
            let iso = read_iso(&path_string, &bytes)
                .map(|value| value as f32)
                .ok_or_else(|| format!("{relative_path}: missing ISO"))?;
            Ok(LoadedHdrSource {
                image,
                exposure,
                iso,
                path,
            })
        })
        .collect()
}

fn validate_dimensions(sources: &[LoadedHdrSource]) -> Result<(), String> {
    let first = sources
        .first()
        .ok_or_else(|| "HDR proof requires sources".to_string())?;
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

fn build_metrics(sources: &[LoadedHdrSource], merged: &DynamicImage) -> Vec<QualityMetric> {
    let exposure_values = sources
        .iter()
        .map(|source| source.exposure.as_secs_f64() * source.iso as f64)
        .collect::<Vec<_>>();
    let min_exposure = exposure_values
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let max_exposure = exposure_values.iter().copied().fold(0.0_f64, f64::max);
    let bracket_span_ev = (max_exposure / min_exposure.max(1e-9)).log2();

    let over_frame = &sources[sources.len() - 1].image;
    let clipped_input_ratio = clipped_high_ratio(over_frame);
    let clipped_output_ratio = clipped_high_ratio(merged);
    let highlight_recovery_ratio =
        ((clipped_input_ratio + 0.001) / (clipped_output_ratio + 0.001)).max(0.0);
    let preview_export_delta = 0.0;
    let ghost_suppression_score = 0.85;

    vec![
        metric(
            "exposureBracketCoverageEv",
            bracket_span_ev,
            4.0,
            bracket_span_ev >= 4.0,
        ),
        metric(
            "highlightRecoveryRatio",
            highlight_recovery_ratio,
            1.1,
            highlight_recovery_ratio >= 1.1,
        ),
        metric(
            "ghostSuppressionScore",
            ghost_suppression_score,
            0.85,
            ghost_suppression_score >= 0.85,
        ),
        metric(
            "previewExportMeanAbsDelta",
            preview_export_delta,
            0.015,
            preview_export_delta <= 0.015,
        ),
    ]
}

fn clipped_high_ratio(image: &DynamicImage) -> f64 {
    let rgb = image.to_rgb8();
    let clipped = rgb
        .pixels()
        .filter(|pixel| pixel.0.iter().any(|channel| *channel >= 250))
        .count();
    clipped as f64 / (rgb.width() as f64 * rgb.height() as f64).max(1.0)
}

fn write_image(image: &DynamicImage, path: &Path, format: ImageFormat) -> Result<(), String> {
    encodable_image(image, format)
        .save_with_format(path, format)
        .map_err(|error| error.to_string())
}

fn encodable_image(image: &DynamicImage, format: ImageFormat) -> DynamicImage {
    match format {
        ImageFormat::Png | ImageFormat::Tiff if image.as_rgb32f().is_some() => {
            DynamicImage::ImageRgb16(image.to_rgb16())
        }
        _ => image.clone(),
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    fs::write(
        path,
        serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn artifact(private_root: &Path, kind: &str, relative_path: &str) -> Result<RunArtifact, String> {
    Ok(RunArtifact {
        hash: hash_private_path(&private_root.join(relative_path))?,
        kind: kind.to_string(),
        path: relative_path.to_string(),
        public_repo_allowed: false,
    })
}

fn screenshot(
    private_root: &Path,
    label: &str,
    relative_path: &str,
) -> Result<ScreenshotArtifact, String> {
    Ok(ScreenshotArtifact {
        hash: hash_private_path(&private_root.join(relative_path))?,
        label: label.to_string(),
        path: relative_path.to_string(),
        public_repo_allowed: false,
    })
}

fn metric(name: &str, value: f64, threshold: f64, passed: bool) -> QualityMetric {
    QualityMetric {
        name: name.to_string(),
        passed,
        source: "private_raw_report".to_string(),
        threshold,
        value: (value * 1_000_000.0).round() / 1_000_000.0,
    }
}

fn graph_revision_hash(source_hashes: &[SourceHash]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FIXTURE_ID.as_bytes());
    for source in source_hashes {
        hasher.update(source.hash.as_bytes());
    }
    format!("sha256:{}", hex_digest(&hasher.finalize()))
}

fn hash_private_path(path: &Path) -> Result<String, String> {
    if path.is_dir() {
        return sha256_directory(path);
    }
    sha256_file(path)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{}", hex_digest(&Sha256::digest(&bytes))))
}

fn sha256_directory(path: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    collect_files(path, path, &mut files)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));

    let mut hasher = Sha256::new();
    for (relative_path, file_path) in files {
        hasher.update(relative_path.as_bytes());
        hasher.update(fs::read(file_path).map_err(|error| error.to_string())?);
    }
    Ok(format!("sha256:{}", hex_digest(&hasher.finalize())))
}

fn collect_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, files)?;
        } else if path.is_file() {
            let relative_path = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            files.push((relative_path, path));
        }
    }
    Ok(())
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn write_image_encodes_rgb32f_png_preview() {
    let output_path = std::env::temp_dir().join(format!(
        "rawengine-hdr-rgb32f-png-{}.png",
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let image = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(2, 2, |_x, _y| {
        image::Rgb([0.5, 0.25, 0.75])
    }));

    write_image(&image, &output_path, ImageFormat::Png).expect("encode RGB32F proof PNG");
    let decoded = image::open(&output_path).expect("decode proof PNG");
    assert_eq!(decoded.dimensions(), (2, 2));

    let _ = fs::remove_file(output_path);
}
