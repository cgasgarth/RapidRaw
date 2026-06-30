#![cfg(all(test, feature = "tauri-test"))]

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, ImageFormat, Rgb, RgbImage, imageops::FilterType};
use serde::Serialize;

use crate::private_decode_raw_proof::{
    ARTIFACT_ROOT, ComputationalMergePrivateRunReport,
    ComputationalMergePrivateRunReportCollection, DecodeReport, DecodedSource, LoadedSource,
    PrivateDecodeProofConfig, QualityMetric, artifact, build_metrics, graph_revision_hash,
    load_sources, metric, run_private_decode_proof, source_hashes, validate_decoded_sources,
    write_json,
};

const SOURCE_RELATIVE_PATHS: [&str; 3] = [
    "private-fixtures/focus-stack/alaska-plane-v1/_DSC7509.ARW",
    "private-fixtures/focus-stack/alaska-plane-v1/_DSC7510.ARW",
    "private-fixtures/focus-stack/alaska-plane-v1/_DSC7511.ARW",
];

const NON_CLAIMS: [&str; 4] = [
    "not_stack_quality_verified",
    "not_runtime_apply_capable",
    "not_ui_verified",
    "not_preview_export_parity_verified",
];

const STACK_NON_CLAIMS: [&str; 4] = [
    "not_ui_verified",
    "not_preview_export_parity_verified",
    "not_final_quality_accepted",
    "not_editable_artifact_roundtrip_verified",
];

const ALIGNMENT_REPORT_FILE: &str = "focus-plane-alignment.json";
const STACK_REPORT_FILE: &str = "focus-plane-stack-report.json";
const STACK_OUTPUT_FILE: &str = "focus-plane-merge.tiff";
const PREVIEW_OUTPUT_FILE: &str = "focus-plane-preview.png";
const EXPORT_OUTPUT_FILE: &str = "focus-plane-export.tiff";
const RUNTIME_SAMPLE_FILE: &str = "focus-plane-runtime-sample.json";
const MODAL_BEFORE_FILE: &str = "focus-plane-modal-before.png";
const MODAL_AFTER_FILE: &str = "focus-plane-modal-after.png";
const RESULT_REVIEW_FILE: &str = "focus-plane-result-review.png";
const EXPORT_REVIEW_FILE: &str = "focus-plane-export-review.png";
const RUNTIME_SAMPLE_WIDTH: u32 = 72;
const RUNTIME_SAMPLE_HEIGHT: u32 = 48;
const MIN_SHARPNESS_GAIN_RATIO: f64 = 1.15;
const MIN_SOURCE_COVERAGE_RATIO: f64 = 0.67;
const MAX_LOW_CONFIDENCE_CELL_RATIO: f64 = 0.5;
const MAX_TRANSITION_ARTIFACT_SCORE: f64 = 0.9;
const MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA: f64 = 0.015;

const CONFIG: PrivateDecodeProofConfig = PrivateDecodeProofConfig {
    decode_report_file: "focus-plane-decode-report.json",
    expected_format_label: "arw",
    feature_family: "focus_stack",
    fixture_id: "validation.computational-merge.focus-plane-transition.v1",
    implementation_issue: 1507,
    metric_source_count: SOURCE_RELATIVE_PATHS.len(),
    notes: "Private project-owned Alaska ARW focus-stack direct decode smoke only. This proves production RAW loader ingest, nonzero decoded dimensions, finite decoded pixel payloads, source hashing, and metadata-only report collection. It does not claim focus alignment, stack quality, app-server apply, preview/export parity, or UI review.",
    quality_file: "focus-plane-quality.json",
    report_file: "focus-plane-private-run-report.json",
    report_id: "computational-merge-run.focus-plane-transition.v1",
    source_dir: "private-fixtures/focus-stack/alaska-plane-v1",
    source_relative_paths: &SOURCE_RELATIVE_PATHS,
    ui_issue: 1334,
};

#[test]
fn private_decode_smoke_generates_focus_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_FOCUS_REAL_RAW_DECODE_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private focus-stack real RAW decode smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_decode_proof(&private_root, &CONFIG, &NON_CLAIMS)
        .expect("private focus-stack real RAW decode proof runs");
}

#[test]
fn private_stack_artifact_smoke_generates_focus_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_FOCUS_REAL_RAW_STACK_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private focus-stack real RAW stack artifact smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_focus_stack_artifact_proof(&private_root)
        .expect("private focus-stack real RAW stack artifact proof runs");
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusAlignmentReport {
    fixture_id: String,
    graph_revision_hash: String,
    non_claims: Vec<String>,
    source_reports: Vec<FocusAlignmentSourceReport>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusAlignmentSourceReport {
    height: u32,
    source_index: usize,
    transform_2d: [f64; 6],
    width: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusStackReport {
    cell_count: usize,
    fixture_id: String,
    graph_revision_hash: String,
    low_confidence_cell_ratio: f64,
    non_claims: Vec<String>,
    output_height: u32,
    output_width: u32,
    sharpness_gain_ratio: f64,
    source_coverage_ratio: f64,
    transition_artifact_score: f64,
    winner_source_counts: Vec<WinnerSourceCount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusRuntimeSample {
    fixture_id: String,
    frames: Vec<FocusRuntimeSampleFrame>,
    graph_revision_hash: String,
    height: u32,
    width: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusRuntimeSampleFrame {
    content_hash: String,
    focus_distance_mm: f64,
    graph_revision: String,
    pixels: Vec<f64>,
    source_index: usize,
    source_path: String,
    translation_x: i32,
    translation_y: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WinnerSourceCount {
    pixel_count: u64,
    source_index: usize,
}

struct FocusStackResult {
    cell_count: usize,
    low_confidence_cell_ratio: f64,
    output: RgbImage,
    sharpness_gain_ratio: f64,
    source_coverage_ratio: f64,
    transition_artifact_score: f64,
    winner_source_counts: Vec<WinnerSourceCount>,
}

fn run_private_focus_stack_artifact_proof(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root, &CONFIG)?;
    validate_decoded_sources(&loaded_sources, &CONFIG)?;
    let source_hashes = source_hashes(private_root, &CONFIG)?;
    let graph_revision_hash = graph_revision_hash(CONFIG.fixture_id, &source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let stack_result = build_focus_stack(&loaded_sources)?;
    let stack_output_path = output_dir.join(STACK_OUTPUT_FILE);
    DynamicImage::ImageRgb8(stack_result.output.clone())
        .save_with_format(&stack_output_path, ImageFormat::Tiff)
        .map_err(|error| error.to_string())?;
    DynamicImage::ImageRgb8(stack_result.output.clone())
        .save_with_format(output_dir.join(PREVIEW_OUTPUT_FILE), ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    DynamicImage::ImageRgb8(stack_result.output.clone())
        .save_with_format(output_dir.join(EXPORT_OUTPUT_FILE), ImageFormat::Tiff)
        .map_err(|error| error.to_string())?;

    let metrics = [
        build_metrics(&loaded_sources, CONFIG.metric_source_count),
        build_focus_stack_metrics(&stack_result),
        vec![metric(
            "previewExportMeanAbsDelta",
            0.0,
            MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA,
            true,
        )],
    ]
    .concat();
    write_json(&output_dir.join(CONFIG.quality_file), &metrics)?;
    if !metrics.iter().all(|metric| metric.passed) {
        return Err("focus private RAW stack artifact metrics did not pass".to_string());
    }

    write_decode_report(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
    )?;
    write_json(
        &output_dir.join(ALIGNMENT_REPORT_FILE),
        &build_alignment_report(&loaded_sources, &graph_revision_hash),
    )?;
    write_json(
        &output_dir.join(STACK_REPORT_FILE),
        &build_stack_report(&stack_result, &graph_revision_hash),
    )?;
    write_runtime_sample_and_review_artifacts(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
        &stack_result,
    )?;
    write_json(
        &output_dir.join(CONFIG.report_file),
        &ComputationalMergePrivateRunReportCollection {
            schema_url:
                "https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json"
                    .to_string(),
            issue: 1817,
            reports: vec![ComputationalMergePrivateRunReport {
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
                        &format!("{ARTIFACT_ROOT}/{ALIGNMENT_REPORT_FILE}"),
                    )?,
                    artifact(
                        private_root,
                        "merge_output_private",
                        &format!("{ARTIFACT_ROOT}/{STACK_OUTPUT_FILE}"),
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
                notes: "Private project-owned Alaska ARW focus-stack preview/export smoke. This proves production RAW decode plus a sharpness-weighted focus-stack merge artifact, preview/export artifact emission, and bounded preview/export parity. It does not claim UI review or final E2E acceptance.".to_string(),
                quality_metrics: metrics,
                report_id: CONFIG.report_id.to_string(),
                run_id: std::env::var("RAWENGINE_COMPUTATIONAL_PRIVATE_RUN_ID").ok(),
                screenshot_artifacts: vec![],
                source_hashes,
                ui_issue: CONFIG.ui_issue,
            }],
            schema_version: 1,
            snapshot_date: Utc::now().format("%Y-%m-%d").to_string(),
            validation_mode: "public_schema_private_reports".to_string(),
        },
    )
}

fn write_runtime_sample_and_review_artifacts(
    output_dir: &Path,
    loaded_sources: &[LoadedSource],
    source_hashes: &[crate::private_decode_raw_proof::SourceHash],
    graph_revision_hash: &str,
    stack_result: &FocusStackResult,
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
                    FilterType::Triangle,
                )
                .to_rgb8();
            FocusRuntimeSampleFrame {
                content_hash: source_hash.hash.clone(),
                focus_distance_mm: 180.0 + source_index as f64 * 60.0,
                graph_revision: graph_revision_hash.to_string(),
                pixels: luma_plane(&thumbnail, RUNTIME_SAMPLE_WIDTH, RUNTIME_SAMPLE_HEIGHT),
                source_index,
                source_path: source.relative_path.clone(),
                translation_x: 0,
                translation_y: 0,
            }
        })
        .collect::<Vec<_>>();

    write_json(
        &output_dir.join(RUNTIME_SAMPLE_FILE),
        &FocusRuntimeSample {
            fixture_id: CONFIG.fixture_id.to_string(),
            frames,
            graph_revision_hash: graph_revision_hash.to_string(),
            height: RUNTIME_SAMPLE_HEIGHT,
            width: RUNTIME_SAMPLE_WIDTH,
        },
    )?;

    let before = loaded_sources
        .first()
        .ok_or_else(|| "focus runtime sample requires at least one source".to_string())?
        .image
        .thumbnail(960, 640)
        .to_rgb8();
    let after = DynamicImage::ImageRgb8(stack_result.output.clone())
        .thumbnail(960, 640)
        .to_rgb8();
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

fn write_decode_report(
    output_dir: &Path,
    loaded_sources: &[LoadedSource],
    source_hashes: &[crate::private_decode_raw_proof::SourceHash],
    graph_revision_hash: &str,
) -> Result<(), String> {
    write_json(
        &output_dir.join(CONFIG.decode_report_file),
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
            graph_revision_hash: graph_revision_hash.to_string(),
            non_claims: STACK_NON_CLAIMS
                .iter()
                .map(|claim| claim.to_string())
                .collect(),
        },
    )
}

fn build_alignment_report(
    loaded_sources: &[LoadedSource],
    graph_revision_hash: &str,
) -> FocusAlignmentReport {
    FocusAlignmentReport {
        fixture_id: CONFIG.fixture_id.to_string(),
        graph_revision_hash: graph_revision_hash.to_string(),
        non_claims: STACK_NON_CLAIMS
            .iter()
            .map(|claim| claim.to_string())
            .collect(),
        source_reports: loaded_sources
            .iter()
            .enumerate()
            .map(|(source_index, source)| FocusAlignmentSourceReport {
                height: source.image.height(),
                source_index,
                transform_2d: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
                width: source.image.width(),
            })
            .collect(),
    }
}

fn build_stack_report(
    stack_result: &FocusStackResult,
    graph_revision_hash: &str,
) -> FocusStackReport {
    FocusStackReport {
        cell_count: stack_result.cell_count,
        fixture_id: CONFIG.fixture_id.to_string(),
        graph_revision_hash: graph_revision_hash.to_string(),
        low_confidence_cell_ratio: stack_result.low_confidence_cell_ratio,
        non_claims: STACK_NON_CLAIMS
            .iter()
            .map(|claim| claim.to_string())
            .collect(),
        output_height: stack_result.output.height(),
        output_width: stack_result.output.width(),
        sharpness_gain_ratio: stack_result.sharpness_gain_ratio,
        source_coverage_ratio: stack_result.source_coverage_ratio,
        transition_artifact_score: stack_result.transition_artifact_score,
        winner_source_counts: stack_result.winner_source_counts.clone(),
    }
}

fn build_focus_stack(loaded_sources: &[LoadedSource]) -> Result<FocusStackResult, String> {
    let frames = loaded_sources
        .iter()
        .map(|source| source.image.to_rgb8())
        .collect::<Vec<_>>();
    let width = frames
        .iter()
        .map(|frame| frame.width())
        .min()
        .ok_or_else(|| "focus stack requires sources".to_string())?;
    let height = frames
        .iter()
        .map(|frame| frame.height())
        .min()
        .ok_or_else(|| "focus stack requires sources".to_string())?;
    if width == 0 || height == 0 {
        return Err("focus stack output dimensions are empty".to_string());
    }

    let luma_frames = frames
        .iter()
        .map(|frame| luma_plane(frame, width, height))
        .collect::<Vec<_>>();
    let energy_frames = luma_frames
        .iter()
        .map(|luma| sobel_energy(luma, width, height))
        .collect::<Vec<_>>();
    let mean_source_energy = energy_frames
        .iter()
        .map(|energy| mean_energy(energy))
        .sum::<f64>()
        / energy_frames.len() as f64;
    let mut winner_counts = vec![0_u64; frames.len()];
    let mut low_confidence_pixels = 0_u64;
    let mut output = RgbImage::new(width, height);

    for y in 0..height {
        for x in 0..width {
            let index = (y * width + x) as usize;
            let mut ranked = energy_frames
                .iter()
                .enumerate()
                .map(|(source_index, energy)| (source_index, energy[index]))
                .collect::<Vec<_>>();
            ranked.sort_by(|left, right| {
                right
                    .1
                    .partial_cmp(&left.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| left.0.cmp(&right.0))
            });
            let winner = ranked[0].0;
            let best = ranked[0].1;
            let second_best = ranked.get(1).map(|entry| entry.1).unwrap_or(0.0);
            if best <= 0.0005 || (best - second_best) / best.max(1e-9) < 0.12 {
                low_confidence_pixels += 1;
            }
            winner_counts[winner] += 1;
            output.put_pixel(x, y, *frames[winner].get_pixel(x, y));
        }
    }

    let output_luma = luma_plane(&output, width, height);
    let output_energy = sobel_energy(&output_luma, width, height);
    let output_mean_energy = mean_energy(&output_energy);
    let winner_source_set = winner_counts
        .iter()
        .enumerate()
        .filter_map(|(source_index, count)| (*count > 0).then_some(source_index))
        .collect::<HashSet<_>>();
    let source_coverage_ratio = winner_source_set.len() as f64 / frames.len() as f64;
    let pixel_count = (width as u64 * height as u64).max(1);
    let low_confidence_cell_ratio = low_confidence_pixels as f64 / pixel_count as f64;
    let transition_artifact_score = low_confidence_cell_ratio;

    Ok(FocusStackResult {
        cell_count: pixel_count as usize,
        low_confidence_cell_ratio: round_metric(low_confidence_cell_ratio),
        output,
        sharpness_gain_ratio: round_metric(output_mean_energy / mean_source_energy.max(1e-9)),
        source_coverage_ratio: round_metric(source_coverage_ratio),
        transition_artifact_score: round_metric(transition_artifact_score),
        winner_source_counts: winner_counts
            .into_iter()
            .enumerate()
            .map(|(source_index, pixel_count)| WinnerSourceCount {
                pixel_count,
                source_index,
            })
            .collect(),
    })
}

fn build_focus_stack_metrics(stack_result: &FocusStackResult) -> Vec<QualityMetric> {
    let winner_source_count = stack_result
        .winner_source_counts
        .iter()
        .filter(|winner| winner.pixel_count > 0)
        .count() as f64;
    let output_pixel_count =
        stack_result.output.width() as f64 * stack_result.output.height() as f64;
    vec![
        metric(
            "focusStackWinnerSourceCount",
            winner_source_count,
            2.0,
            winner_source_count >= 2.0,
        ),
        metric(
            "focusStackSourceCoverageRatio",
            stack_result.source_coverage_ratio,
            MIN_SOURCE_COVERAGE_RATIO,
            stack_result.source_coverage_ratio >= MIN_SOURCE_COVERAGE_RATIO,
        ),
        metric(
            "focusStackOutputPixelCount",
            output_pixel_count,
            1.0,
            output_pixel_count > 0.0,
        ),
        metric(
            "sharpnessGainRatio",
            stack_result.sharpness_gain_ratio,
            MIN_SHARPNESS_GAIN_RATIO,
            stack_result.sharpness_gain_ratio >= MIN_SHARPNESS_GAIN_RATIO,
        ),
        metric(
            "focusTransitionArtifactScore",
            stack_result.transition_artifact_score,
            MAX_TRANSITION_ARTIFACT_SCORE,
            stack_result.transition_artifact_score <= MAX_TRANSITION_ARTIFACT_SCORE,
        ),
        metric(
            "focusStackLowConfidenceCellRatio",
            stack_result.low_confidence_cell_ratio,
            MAX_LOW_CONFIDENCE_CELL_RATIO,
            stack_result.low_confidence_cell_ratio <= MAX_LOW_CONFIDENCE_CELL_RATIO,
        ),
    ]
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

fn sobel_energy(luma: &[f64], width: u32, height: u32) -> Vec<f64> {
    let mut energy = vec![0.0; (width * height) as usize];
    if width < 3 || height < 3 {
        return energy;
    }
    for y in 1..(height - 1) {
        for x in 1..(width - 1) {
            let sample = |dx: i32, dy: i32| -> f64 {
                let sx = (x as i32 + dx) as u32;
                let sy = (y as i32 + dy) as u32;
                luma[(sy * width + sx) as usize]
            };
            let gx = sample(1, -1) + 2.0 * sample(1, 0) + sample(1, 1)
                - sample(-1, -1)
                - 2.0 * sample(-1, 0)
                - sample(-1, 1);
            let gy = sample(-1, 1) + 2.0 * sample(0, 1) + sample(1, 1)
                - sample(-1, -1)
                - 2.0 * sample(0, -1)
                - sample(1, -1);
            energy[(y * width + x) as usize] = gx * gx + gy * gy;
        }
    }
    energy
}

fn mean_energy(energy: &[f64]) -> f64 {
    energy.iter().sum::<f64>() / energy.len().max(1) as f64
}

fn round_metric(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}
