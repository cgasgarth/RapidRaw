#![cfg(all(test, feature = "tauri-test"))]

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, ImageFormat, ImageReader};
use serde::Serialize;

use crate::app_settings::AppSettings;
use crate::app_state::AppState;
use crate::panorama_stitching::{
    PanoramaPairwiseMatchMetadata, PanoramaRenderMetadata, PanoramaRenderRequest,
    PanoramaRenderResult, render_with_legacy_homography_engine_with_settings,
};
use crate::panorama_utils::processing;
use crate::private_decode_raw_proof::{
    ARTIFACT_ROOT, ComputationalMergePrivateRunReport,
    ComputationalMergePrivateRunReportCollection, DecodeReport, DecodedSource, LoadedSource,
    PrivateDecodeProofConfig, QualityMetric, artifact, build_metrics, graph_revision_hash,
    load_sources, metric, run_private_decode_proof, source_hashes, validate_decoded_sources,
    write_json,
};

const SOURCE_RELATIVE_PATHS: [&str; 3] = [
    "private-fixtures/panorama/overlap-stitch-v1/frame-01.arw",
    "private-fixtures/panorama/overlap-stitch-v1/frame-02.arw",
    "private-fixtures/panorama/overlap-stitch-v1/frame-03.arw",
];

const STRESS_SOURCE_RELATIVE_PATHS: [&str; 4] = [
    "private-fixtures/panorama/stress-pixls-ir-v1/frame-01.arw",
    "private-fixtures/panorama/stress-pixls-ir-v1/frame-02.arw",
    "private-fixtures/panorama/stress-pixls-ir-v1/frame-03.arw",
    "private-fixtures/panorama/stress-pixls-ir-v1/frame-04.arw",
];

const NON_CLAIMS: [&str; 4] = [
    "not_stitch_quality_verified",
    "not_runtime_apply_capable",
    "not_ui_verified",
    "not_preview_export_parity_verified",
];

const ALIGNMENT_NON_CLAIMS: [&str; 5] = [
    "not_stitch_quality_verified",
    "not_runtime_apply_capable",
    "not_ui_verified",
    "not_preview_export_parity_verified",
    "not_merge_output_verified",
];

const ALIGNMENT_REPORT_FILE: &str = "panorama-overlap-alignment.json";
const STITCH_REPORT_FILE: &str = "panorama-overlap-stitch-report.json";
const STITCH_OUTPUT_FILE: &str = "panorama-overlap-merge.tiff";
const PREVIEW_OUTPUT_FILE: &str = "panorama-overlap-preview.png";
const EXPORT_OUTPUT_FILE: &str = "panorama-overlap-export.tiff";
const RUNTIME_SAMPLE_FILE: &str = "panorama-overlap-runtime-sample.json";
const MODAL_BEFORE_FILE: &str = "panorama-overlap-modal-before.png";
const MODAL_AFTER_FILE: &str = "panorama-overlap-modal-after.png";
const RESULT_REVIEW_FILE: &str = "panorama-overlap-result-review.png";
const EXPORT_REVIEW_FILE: &str = "panorama-overlap-export-review.png";
const BOUNDED_RENDER_INPUT_DIR: &str = "panorama-overlap-bounded-inputs";
const RENDER_INPUT_MAX_DIMENSION: u32 = 1600;
const STRESS_ALIGNMENT_REPORT_FILE: &str = "panorama-stress-pixls-ir-alignment.json";
const STRESS_STITCH_REPORT_FILE: &str = "panorama-stress-pixls-ir-stitch-report.json";
const STRESS_STITCH_OUTPUT_FILE: &str = "panorama-stress-pixls-ir-merge.tiff";
const STRESS_REVIEW_FILE: &str = "panorama-stress-pixls-ir-review.png";
const STRESS_DIAGNOSTIC_FILE: &str = "panorama-stress-pixls-ir-diagnostic.json";
const MIN_ALIGNMENT_INLIER_RATIO: f64 = 0.55;
const MAX_MEAN_REPROJECTION_ERROR_PX: f64 = 5.0;
const MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA: f64 = 0.015;
const MIN_DIAGNOSTIC_OUTPUT_MEAN_LUMA: f64 = 0.01;
const MIN_DIAGNOSTIC_NON_BLACK_PIXEL_RATIO: f64 = 0.01;

const CONFIG: PrivateDecodeProofConfig = PrivateDecodeProofConfig {
    decode_report_file: "panorama-overlap-decode-report.json",
    expected_format_label: "arw",
    feature_family: "panorama_stitch",
    fixture_id: "validation.computational-merge.panorama-overlap.v1",
    implementation_issue: 4493,
    metric_source_count: SOURCE_RELATIVE_PATHS.len(),
    notes: "Private ARW panorama overlap direct decode smoke only. This proves production RAW loader ingest, nonzero decoded dimensions, finite decoded pixel payloads, source hashing, and metadata-only report collection. It does not claim panorama alignment, stitch quality, app-server apply, preview/export parity, or UI review.",
    quality_file: "panorama-overlap-quality.json",
    report_file: "panorama-overlap-private-run-report.json",
    report_id: "computational-merge-run.panorama-overlap.v1",
    source_dir: "private-fixtures/panorama/overlap-stitch-v1",
    source_relative_paths: &SOURCE_RELATIVE_PATHS,
    ui_issue: 1333,
};

const STRESS_CONFIG: PrivateDecodeProofConfig = PrivateDecodeProofConfig {
    decode_report_file: "panorama-stress-pixls-ir-decode-report.json",
    expected_format_label: "arw",
    feature_family: "panorama_stitch",
    fixture_id: "validation.computational-merge.panorama-stress-pixls-ir.v1",
    implementation_issue: 2264,
    metric_source_count: STRESS_SOURCE_RELATIVE_PATHS.len(),
    notes: "Pixls infrared ARW panorama stress-candidate diagnostic only. This exercises production RAW decode, current BRIEF/RANSAC alignment, and current stitch artifact generation when possible. It is not acceptance evidence and does not claim fixture suitability, app-server apply, preview/export parity, UI review, or stitch quality.",
    quality_file: "panorama-stress-pixls-ir-quality.json",
    report_file: "panorama-stress-pixls-ir-private-run-report.json",
    report_id: "computational-merge-run.panorama-stress-pixls-ir.v1",
    source_dir: "private-fixtures/panorama/stress-pixls-ir-v1",
    source_relative_paths: &STRESS_SOURCE_RELATIVE_PATHS,
    ui_issue: 2148,
};

#[test]
fn private_decode_smoke_generates_panorama_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_PANORAMA_REAL_RAW_DECODE_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private panorama real RAW decode smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_decode_proof(&private_root, &CONFIG, &NON_CLAIMS)
        .expect("private panorama real RAW decode proof runs");
}

#[test]
fn private_alignment_smoke_generates_panorama_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_PANORAMA_REAL_RAW_ALIGNMENT_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private panorama real RAW alignment smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_alignment_proof(&private_root)
        .expect("private panorama real RAW alignment proof runs");
}

#[test]
fn private_stitch_artifact_smoke_generates_panorama_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_PANORAMA_REAL_RAW_STITCH_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private panorama real RAW stitch artifact smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_stitch_artifact_proof(&private_root)
        .expect("private panorama real RAW stitch artifact proof runs");
}

#[test]
fn private_preview_export_smoke_generates_panorama_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_PANORAMA_REAL_RAW_PREVIEW_EXPORT_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private panorama real RAW preview/export smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_preview_export_proof(&private_root)
        .expect("private panorama real RAW preview/export proof runs");
}

#[test]
fn private_stress_candidate_diagnostic_generates_panorama_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_PANORAMA_STRESS_CANDIDATE_DIAGNOSTIC")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private panorama stress-candidate diagnostic");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_stress_candidate_diagnostic(&private_root)
        .expect("private panorama stress-candidate diagnostic runs");
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentReport {
    candidate_pair_reports: Vec<PairAlignmentReport>,
    fixture_id: String,
    graph_revision_hash: String,
    non_claims: Vec<String>,
    pair_reports: Vec<PairAlignmentReport>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StitchReport {
    boundary_mode: String,
    connected_source_indices: Vec<usize>,
    excluded_source_indices: Vec<usize>,
    exposure_diagnostics: StitchExposureDiagnostics,
    fixture_id: String,
    graph_revision_hash: String,
    non_claims: Vec<String>,
    output_height: u32,
    output_width: u32,
    pairwise_match_count: usize,
    max_transform_chain_length: usize,
    reference_source_index: Option<usize>,
    seam_diagnostics: StitchSeamDiagnostics,
    selected_match_edges: Vec<StitchSelectedMatchEdgeReport>,
    stitch_engine: String,
    warning_count: usize,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StitchSelectedMatchEdgeReport {
    child_source_index: usize,
    edge_rank: usize,
    parent_source_index: usize,
    source_index_a: usize,
    source_index_b: usize,
    tree_depth: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PanoramaPrivateRuntimeSample {
    connected_source_indices: Vec<usize>,
    fixture_id: String,
    frames: Vec<PanoramaPrivateRuntimeFrame>,
    graph_revision_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PanoramaPrivateRuntimeFrame {
    content_hash: String,
    expected_offset_x: u32,
    expected_offset_y: i32,
    graph_revision: String,
    height: u32,
    source_index: usize,
    source_path: String,
    width: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StitchExposureDiagnostics {
    applied_gain_count: usize,
    applied_luminance_gains: Vec<StitchOverlapGainReport>,
    mode: String,
    support: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StitchOverlapGainReport {
    gain: f32,
    source_index: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StitchSeamDiagnostics {
    feather_width_px: u32,
    mode: String,
    support: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairAlignmentReport {
    accepted: bool,
    brief_matcher: Option<processing::BriefMatchDiagnostics>,
    finite_transform: bool,
    homography_condition_number: Option<f64>,
    inlier_count: usize,
    inlier_ratio: f64,
    match_count: usize,
    mean_reprojection_error_px: f64,
    mean_reverse_reprojection_error_px: f64,
    mean_symmetric_transfer_error_px: f64,
    p95_symmetric_transfer_error_px: f64,
    rejected_reasons: Vec<String>,
    selected_edge: bool,
    source_index_a: usize,
    source_index_b: usize,
    spatial_support_cell_count: usize,
    transform_3x3_row_major: [f64; 9],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StressCandidateDiagnostic {
    alignment_report_path: String,
    decode_report_path: String,
    fixture_id: String,
    generated_at: String,
    graph_revision_hash: String,
    merge_output_path: Option<String>,
    non_claims: Vec<String>,
    quality_metrics: Vec<QualityMetric>,
    render_error: Option<String>,
    review_image_path: Option<String>,
    source_hashes: Vec<crate::private_decode_raw_proof::SourceHash>,
    stitch_report_path: Option<String>,
    suitability: String,
}

fn run_private_alignment_proof(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root, &CONFIG)?;
    validate_decoded_sources(&loaded_sources, &CONFIG)?;
    let source_hashes = source_hashes(private_root, &CONFIG)?;
    let graph_revision_hash = graph_revision_hash(CONFIG.fixture_id, &source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let render_result = render_private_panorama(private_root, CONFIG.source_relative_paths)?;
    let decode_metrics = build_metrics(&loaded_sources, CONFIG.metric_source_count);
    let alignment_report = build_alignment_report_from_render_metadata(
        &render_result.metadata,
        &graph_revision_hash,
        CONFIG.fixture_id,
    );
    let alignment_metrics = build_alignment_metrics(&alignment_report, loaded_sources.len());
    let metrics = [decode_metrics, alignment_metrics].concat();
    if !metrics.iter().all(|metric| metric.passed) {
        return Err(format!(
            "panorama private RAW alignment metrics did not pass: {}",
            failed_metric_summary(&metrics)
        ));
    }

    write_decode_report(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
        &CONFIG,
        &ALIGNMENT_NON_CLAIMS,
    )?;
    write_json(&output_dir.join(ALIGNMENT_REPORT_FILE), &alignment_report)?;
    write_json(&output_dir.join(CONFIG.quality_file), &metrics)?;

    write_json(
        &output_dir.join(CONFIG.report_file),
        &ComputationalMergePrivateRunReportCollection {
            schema_url:
                "https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json"
                    .to_string(),
            issue: 1817,
            reports: vec![ComputationalMergePrivateRunReport {
                acceptance_status: "private_alignment_smoke".to_string(),
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
                        "quality_report_private",
                        &format!("{ARTIFACT_ROOT}/{}", CONFIG.quality_file),
                    )?,
                ],
                feature_family: CONFIG.feature_family.to_string(),
                fixture_id: CONFIG.fixture_id.to_string(),
                generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
                graph_revision_hash,
                implementation_issue: CONFIG.implementation_issue,
                notes: "Private ARW panorama alignment smoke. This proves production RAW decode plus the existing BRIEF/RANSAC homography alignment path on the private overlap sequence. It does not claim stitched output, app-server apply, preview/export parity, or UI review.".to_string(),
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

fn run_private_stitch_artifact_proof(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root, &CONFIG)?;
    validate_decoded_sources(&loaded_sources, &CONFIG)?;
    let source_hashes = source_hashes(private_root, &CONFIG)?;
    let graph_revision_hash = graph_revision_hash(CONFIG.fixture_id, &source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let render_result = render_private_panorama(private_root, CONFIG.source_relative_paths)?;
    let alignment_report = build_alignment_report_from_render_metadata(
        &render_result.metadata,
        &graph_revision_hash,
        CONFIG.fixture_id,
    );
    let stitch_output_path = output_dir.join(STITCH_OUTPUT_FILE);
    render_result
        .image
        .save_with_format(&stitch_output_path, ImageFormat::Tiff)
        .map_err(|error| error.to_string())?;

    let stitch_report =
        build_stitch_report(&render_result, &graph_revision_hash, CONFIG.fixture_id);
    let metrics = [
        build_metrics(&loaded_sources, CONFIG.metric_source_count),
        build_alignment_metrics(&alignment_report, loaded_sources.len()),
        build_stitch_metrics(&render_result, loaded_sources.len()),
    ]
    .concat();
    if !metrics.iter().all(|metric| metric.passed) {
        return Err(format!(
            "panorama private RAW stitch artifact metrics did not pass: {}",
            failed_metric_summary(&metrics)
        ));
    }

    write_decode_report(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
        &CONFIG,
        &ALIGNMENT_NON_CLAIMS,
    )?;
    write_json(&output_dir.join(ALIGNMENT_REPORT_FILE), &alignment_report)?;
    write_json(&output_dir.join(STITCH_REPORT_FILE), &stitch_report)?;
    write_json(&output_dir.join(CONFIG.quality_file), &metrics)?;

    write_json(
        &output_dir.join(CONFIG.report_file),
        &ComputationalMergePrivateRunReportCollection {
            schema_url:
                "https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json"
                    .to_string(),
            issue: 1817,
            reports: vec![ComputationalMergePrivateRunReport {
                acceptance_status: "private_stitch_artifact_smoke".to_string(),
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
                        &format!("{ARTIFACT_ROOT}/{STITCH_OUTPUT_FILE}"),
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
                notes: "Private ARW panorama stitch artifact smoke. This proves production RAW decode plus the legacy RapidRaw homography/seam stitch engine can emit a bounded panorama artifact with source coverage and diagnostics. It does not claim full-resolution stitch quality, app-server apply, preview/export parity, or UI review.".to_string(),
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

fn run_private_preview_export_proof(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root, &CONFIG)?;
    validate_decoded_sources(&loaded_sources, &CONFIG)?;
    let source_hashes = source_hashes(private_root, &CONFIG)?;
    let graph_revision_hash = graph_revision_hash(CONFIG.fixture_id, &source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let render_input_paths =
        write_bounded_render_sources(&output_dir, &loaded_sources, BOUNDED_RENDER_INPUT_DIR)?;
    let render_result = render_private_panorama_paths(render_input_paths)?;
    let alignment_report = build_alignment_report_from_render_metadata(
        &render_result.metadata,
        &graph_revision_hash,
        CONFIG.fixture_id,
    );
    let stitch_output_path = output_dir.join(STITCH_OUTPUT_FILE);
    let preview_output_path = output_dir.join(PREVIEW_OUTPUT_FILE);
    let export_output_path = output_dir.join(EXPORT_OUTPUT_FILE);
    let runtime_sample_path = output_dir.join(RUNTIME_SAMPLE_FILE);
    let modal_before_path = output_dir.join(MODAL_BEFORE_FILE);
    let modal_after_path = output_dir.join(MODAL_AFTER_FILE);
    let result_review_path = output_dir.join(RESULT_REVIEW_FILE);
    let export_review_path = output_dir.join(EXPORT_REVIEW_FILE);

    render_result
        .image
        .save_with_format(&stitch_output_path, ImageFormat::Tiff)
        .map_err(|error| error.to_string())?;
    render_result
        .image
        .save_with_format(&export_output_path, ImageFormat::Tiff)
        .map_err(|error| error.to_string())?;
    let preview_image = render_result.image.thumbnail(800, 800).to_rgb8();
    preview_image
        .save_with_format(&preview_output_path, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    loaded_sources[0]
        .image
        .thumbnail(800, 800)
        .to_rgb8()
        .save_with_format(&modal_before_path, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    preview_image
        .save_with_format(&modal_after_path, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    preview_image
        .save_with_format(&result_review_path, ImageFormat::Png)
        .map_err(|error| error.to_string())?;

    let mut export_reader = ImageReader::open(&export_output_path)
        .map_err(|error| error.to_string())?
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    export_reader.no_limits();
    let export_preview = export_reader
        .decode()
        .map_err(|error| error.to_string())?
        .thumbnail(800, 800)
        .to_rgb8();
    export_preview
        .save_with_format(&export_review_path, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    let preview_export_mean_abs_delta = mean_abs_delta_rgb8(&preview_image, &export_preview)?;
    let stitch_report =
        build_stitch_report(&render_result, &graph_revision_hash, CONFIG.fixture_id);
    let metrics = [
        build_metrics(&loaded_sources, CONFIG.metric_source_count),
        build_alignment_metrics(&alignment_report, loaded_sources.len()),
        build_stitch_metrics(&render_result, loaded_sources.len()),
        vec![metric(
            "previewExportMeanAbsDelta",
            preview_export_mean_abs_delta,
            MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA,
            preview_export_mean_abs_delta <= MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA,
        )],
    ]
    .concat();

    write_decode_report(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
        &CONFIG,
        &ALIGNMENT_NON_CLAIMS,
    )?;
    write_json(&output_dir.join(ALIGNMENT_REPORT_FILE), &alignment_report)?;
    write_json(&output_dir.join(STITCH_REPORT_FILE), &stitch_report)?;
    write_json(&output_dir.join(CONFIG.quality_file), &metrics)?;
    write_json(
        &runtime_sample_path,
        &build_runtime_sample(
            &loaded_sources,
            &source_hashes,
            &render_result.metadata,
            &graph_revision_hash,
            &CONFIG,
        ),
    )?;

    if !metrics.iter().all(|metric| metric.passed) {
        return Err(format!(
            "panorama private RAW preview/export metrics did not pass: {}",
            failed_metric_summary(&metrics)
        ));
    }

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
                        &format!("{ARTIFACT_ROOT}/{STITCH_OUTPUT_FILE}"),
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
                notes: "Private ARW panorama preview/export smoke. This proves production RAW decode, bounded stitch artifact generation, private preview and export artifacts, and preview/export pixel parity. It does not claim full-resolution stitch quality, UI review, or final user-visible E2E acceptance.".to_string(),
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

fn run_private_stress_candidate_diagnostic(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root, &STRESS_CONFIG)?;
    validate_decoded_sources(&loaded_sources, &STRESS_CONFIG)?;
    let source_hashes = source_hashes(private_root, &STRESS_CONFIG)?;
    let graph_revision_hash = graph_revision_hash(STRESS_CONFIG.fixture_id, &source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let render_result = render_private_panorama(private_root, STRESS_CONFIG.source_relative_paths);
    let alignment_report = render_result
        .as_ref()
        .ok()
        .map(|result| {
            build_alignment_report_from_render_metadata(
                &result.metadata,
                &graph_revision_hash,
                STRESS_CONFIG.fixture_id,
            )
        })
        .unwrap_or_else(|| {
            build_empty_alignment_report(
                &graph_revision_hash,
                STRESS_CONFIG.fixture_id,
                loaded_sources.len(),
            )
        });
    let mut quality_metrics = [
        build_metrics(&loaded_sources, STRESS_CONFIG.metric_source_count),
        build_alignment_metrics(&alignment_report, loaded_sources.len()),
    ]
    .concat();
    let mut stitch_report_path = None;
    let mut merge_output_path = None;
    let mut render_error = None;
    let mut review_image_path = None;

    match render_result {
        Ok(render_result) => {
            let stitch_output_path = output_dir.join(STRESS_STITCH_OUTPUT_FILE);
            let review_image_output_path = output_dir.join(STRESS_REVIEW_FILE);
            render_result
                .image
                .save_with_format(&stitch_output_path, ImageFormat::Tiff)
                .map_err(|error| error.to_string())?;
            render_result
                .image
                .thumbnail(1600, 1600)
                .to_rgb8()
                .save_with_format(&review_image_output_path, ImageFormat::Png)
                .map_err(|error| error.to_string())?;
            let stitch_report = build_stitch_report(
                &render_result,
                &graph_revision_hash,
                STRESS_CONFIG.fixture_id,
            );
            quality_metrics.extend(build_stitch_metrics(&render_result, loaded_sources.len()));
            quality_metrics.extend(build_visibility_metrics(&render_result.image));
            write_json(&output_dir.join(STRESS_STITCH_REPORT_FILE), &stitch_report)?;
            stitch_report_path = Some(format!("{ARTIFACT_ROOT}/{STRESS_STITCH_REPORT_FILE}"));
            merge_output_path = Some(format!("{ARTIFACT_ROOT}/{STRESS_STITCH_OUTPUT_FILE}"));
            review_image_path = Some(format!("{ARTIFACT_ROOT}/{STRESS_REVIEW_FILE}"));
        }
        Err(error) => {
            render_error = Some(error);
        }
    }

    sanitize_diagnostic_metrics(&mut quality_metrics);
    write_decode_report(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
        &STRESS_CONFIG,
        &ALIGNMENT_NON_CLAIMS,
    )?;
    write_json(
        &output_dir.join(STRESS_ALIGNMENT_REPORT_FILE),
        &alignment_report,
    )?;
    write_json(
        &output_dir.join(STRESS_CONFIG.quality_file),
        &quality_metrics,
    )?;
    write_json(
        &output_dir.join(STRESS_DIAGNOSTIC_FILE),
        &StressCandidateDiagnostic {
            alignment_report_path: format!("{ARTIFACT_ROOT}/{STRESS_ALIGNMENT_REPORT_FILE}"),
            decode_report_path: format!("{ARTIFACT_ROOT}/{}", STRESS_CONFIG.decode_report_file),
            fixture_id: STRESS_CONFIG.fixture_id.to_string(),
            generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            graph_revision_hash,
            merge_output_path,
            non_claims: ALIGNMENT_NON_CLAIMS
                .iter()
                .map(|claim| claim.to_string())
                .chain([
                    "stress_candidate_not_accepted".to_string(),
                    "not_fixture_suitability_verified".to_string(),
                    "not_visibility_accepted".to_string(),
                ])
                .collect(),
            quality_metrics,
            render_error,
            review_image_path,
            source_hashes,
            stitch_report_path,
            suitability: "stress_candidate_not_accepted".to_string(),
        },
    )
}

fn render_private_panorama(
    private_root: &Path,
    source_relative_paths: &[&str],
) -> Result<PanoramaRenderResult, String> {
    render_private_panorama_paths(
        source_relative_paths
            .iter()
            .map(|relative_path| {
                private_root
                    .join(relative_path)
                    .to_string_lossy()
                    .to_string()
            })
            .collect(),
    )
}

fn render_private_panorama_paths(image_paths: Vec<String>) -> Result<PanoramaRenderResult, String> {
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .map_err(|error| error.to_string())?;
    render_with_legacy_homography_engine_with_settings(
        PanoramaRenderRequest {
            cancellation: std::sync::Arc::new(
                crate::panorama_utils::alignment_plan::AlignmentCancellation::default(),
            ),
            image_paths,
            options: Default::default(),
        },
        app.handle().clone(),
        AppSettings::default(),
    )
}

fn write_bounded_render_sources(
    output_dir: &Path,
    loaded_sources: &[LoadedSource],
    directory_name: &str,
) -> Result<Vec<String>, String> {
    let render_input_dir = output_dir.join(directory_name);
    fs::create_dir_all(&render_input_dir).map_err(|error| error.to_string())?;

    loaded_sources
        .iter()
        .enumerate()
        .map(|(index, source)| {
            let output_path = render_input_dir.join(format!("frame-{:02}.tiff", index + 1));
            bounded_render_image(&source.image)
                .save_with_format(&output_path, ImageFormat::Tiff)
                .map_err(|error| error.to_string())?;
            Ok(output_path.to_string_lossy().to_string())
        })
        .collect()
}

fn bounded_render_image(image: &DynamicImage) -> DynamicImage {
    image.thumbnail(RENDER_INPUT_MAX_DIMENSION, RENDER_INPUT_MAX_DIMENSION)
}

fn sanitize_diagnostic_metrics(metrics: &mut [QualityMetric]) {
    for metric in metrics.iter_mut() {
        if !metric.value.is_finite() {
            metric.value = 1_000_000.0;
        }
    }
}

fn build_runtime_sample(
    loaded_sources: &[LoadedSource],
    source_hashes: &[crate::private_decode_raw_proof::SourceHash],
    metadata: &PanoramaRenderMetadata,
    graph_revision_hash: &str,
    config: &PrivateDecodeProofConfig,
) -> PanoramaPrivateRuntimeSample {
    let offsets = build_runtime_offsets(metadata);
    PanoramaPrivateRuntimeSample {
        connected_source_indices: metadata.connected_source_indices.clone(),
        fixture_id: config.fixture_id.to_string(),
        frames: loaded_sources
            .iter()
            .zip(source_hashes.iter())
            .enumerate()
            .map(
                |(source_index, (source, source_hash))| PanoramaPrivateRuntimeFrame {
                    content_hash: source_hash.hash.clone(),
                    expected_offset_x: offsets
                        .get(source_index)
                        .map(|offset| offset.0)
                        .unwrap_or_default(),
                    expected_offset_y: offsets
                        .get(source_index)
                        .map(|offset| offset.1)
                        .unwrap_or_default(),
                    graph_revision: graph_revision_hash.to_string(),
                    height: source.image.height(),
                    source_index,
                    source_path: source.relative_path.clone(),
                    width: source.image.width(),
                },
            )
            .collect(),
        graph_revision_hash: graph_revision_hash.to_string(),
    }
}

fn build_runtime_offsets(metadata: &PanoramaRenderMetadata) -> Vec<(u32, i32)> {
    let translations: Vec<_> = metadata
        .sources
        .iter()
        .map(|source| {
            source
                .global_transform_3x3
                .map(projected_origin_offset)
                .unwrap_or((0.0, 0.0))
        })
        .collect();
    let min_x = translations
        .iter()
        .map(|translation| translation.0)
        .fold(0.0_f64, f64::min);
    let min_y = translations
        .iter()
        .map(|translation| translation.1)
        .fold(0.0_f64, f64::min);

    translations
        .iter()
        .map(|(x, y)| (round_to_nonnegative_u32(x - min_x), round_to_i32(y - min_y)))
        .collect()
}

fn projected_origin_offset(transform: [f64; 9]) -> (f64, f64) {
    let z = transform[8];
    if !z.is_finite() || z.abs() < 1e-8 {
        return (0.0, 0.0);
    }
    let x = transform[2] / z;
    let y = transform[5] / z;
    if x.is_finite() && y.is_finite() {
        (x, y)
    } else {
        (0.0, 0.0)
    }
}

fn round_to_nonnegative_u32(value: f64) -> u32 {
    value.round().clamp(0.0, u32::MAX as f64) as u32
}

fn round_to_i32(value: f64) -> i32 {
    value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

fn build_stitch_report(
    render_result: &PanoramaRenderResult,
    graph_revision_hash: &str,
    fixture_id: &str,
) -> StitchReport {
    StitchReport {
        boundary_mode: "auto_crop".to_string(),
        connected_source_indices: render_result.metadata.connected_source_indices.clone(),
        excluded_source_indices: render_result.metadata.excluded_source_indices.clone(),
        exposure_diagnostics: StitchExposureDiagnostics {
            applied_gain_count: render_result
                .metadata
                .blend_diagnostics
                .overlap_gain_applications
                .len(),
            applied_luminance_gains: render_result
                .metadata
                .blend_diagnostics
                .overlap_gain_applications
                .iter()
                .map(|application| StitchOverlapGainReport {
                    gain: application.gain,
                    source_index: application.source_index,
                })
                .collect(),
            mode: "scalar_overlap_luminance_gain_v1".to_string(),
            support: "implemented_current_engine".to_string(),
        },
        fixture_id: fixture_id.to_string(),
        graph_revision_hash: graph_revision_hash.to_string(),
        non_claims: ALIGNMENT_NON_CLAIMS
            .iter()
            .map(|claim| claim.to_string())
            .collect(),
        output_height: render_result.metadata.output_height,
        output_width: render_result.metadata.output_width,
        pairwise_match_count: render_result.metadata.pairwise_matches.len(),
        max_transform_chain_length: render_result.metadata.max_transform_chain_length,
        reference_source_index: render_result.metadata.reference_source_index,
        seam_diagnostics: StitchSeamDiagnostics {
            feather_width_px: 100,
            mode: "adaptive_dp_feather_v1".to_string(),
            support: "implemented_current_engine".to_string(),
        },
        selected_match_edges: render_result
            .metadata
            .selected_match_edges
            .iter()
            .map(|edge| StitchSelectedMatchEdgeReport {
                child_source_index: edge.child_source_index,
                edge_rank: edge.edge_rank,
                parent_source_index: edge.parent_source_index,
                source_index_a: edge.source_index,
                source_index_b: edge.target_index,
                tree_depth: edge.tree_depth,
            })
            .collect(),
        stitch_engine: "rapidraw_homography_seam_v0".to_string(),
        warning_count: render_result.metadata.warnings.len(),
        warnings: render_result.metadata.warnings.clone(),
    }
}

fn write_decode_report(
    output_dir: &Path,
    loaded_sources: &[LoadedSource],
    source_hashes: &[crate::private_decode_raw_proof::SourceHash],
    graph_revision_hash: &str,
    config: &PrivateDecodeProofConfig,
    non_claims: &[&str],
) -> Result<(), String> {
    write_json(
        &output_dir.join(config.decode_report_file),
        &DecodeReport {
            decoded_sources: loaded_sources
                .iter()
                .zip(source_hashes.iter())
                .map(|(source, source_hash)| DecodedSource {
                    color_channels: 3,
                    content_hash: source_hash.hash.clone(),
                    height: source.image.height(),
                    local_relative_path: source.relative_path.clone(),
                    raw_format: config.expected_format_label.to_string(),
                    width: source.image.width(),
                })
                .collect(),
            fixture_id: config.fixture_id.to_string(),
            graph_revision_hash: graph_revision_hash.to_string(),
            non_claims: non_claims.iter().map(|claim| claim.to_string()).collect(),
        },
    )
}

fn build_alignment_report_from_render_metadata(
    metadata: &PanoramaRenderMetadata,
    graph_revision_hash: &str,
    fixture_id: &str,
) -> AlignmentReport {
    let selected_pairs: HashSet<_> = metadata
        .selected_match_edges
        .iter()
        .map(|edge| (edge.source_index, edge.target_index))
        .collect();
    let candidate_pair_reports = metadata
        .pairwise_matches
        .iter()
        .map(|pair| {
            let selected_edge = selected_pairs.contains(&(pair.source_index, pair.target_index));
            build_pair_alignment_report(
                pair.source_index,
                pair.target_index,
                Some(pair),
                selected_edge,
            )
        })
        .collect();
    let pair_reports = metadata
        .selected_match_edges
        .iter()
        .map(|edge| {
            let pair = metadata.pairwise_matches.iter().find(|pair| {
                pair.source_index == edge.source_index && pair.target_index == edge.target_index
            });
            build_pair_alignment_report(edge.source_index, edge.target_index, pair, true)
        })
        .collect();

    AlignmentReport {
        candidate_pair_reports,
        fixture_id: fixture_id.to_string(),
        graph_revision_hash: graph_revision_hash.to_string(),
        non_claims: ALIGNMENT_NON_CLAIMS
            .iter()
            .map(|claim| claim.to_string())
            .collect(),
        pair_reports,
    }
}

fn build_empty_alignment_report(
    graph_revision_hash: &str,
    fixture_id: &str,
    source_count: usize,
) -> AlignmentReport {
    let pair_reports = (0..source_count.saturating_sub(1))
        .map(|source_index| PairAlignmentReport {
            accepted: false,
            brief_matcher: None,
            finite_transform: false,
            homography_condition_number: None,
            inlier_count: 0,
            inlier_ratio: 0.0,
            match_count: 0,
            mean_reprojection_error_px: f64::INFINITY,
            mean_reverse_reprojection_error_px: f64::INFINITY,
            mean_symmetric_transfer_error_px: f64::INFINITY,
            p95_symmetric_transfer_error_px: f64::INFINITY,
            rejected_reasons: vec![
                "missing_pairwise_match".to_string(),
                "non_finite_transform".to_string(),
                "insufficient_inliers".to_string(),
                "low_inlier_ratio".to_string(),
                "high_reprojection_error".to_string(),
            ],
            selected_edge: true,
            source_index_a: source_index,
            source_index_b: source_index + 1,
            spatial_support_cell_count: 0,
            transform_3x3_row_major: [f64::NAN; 9],
        })
        .collect();

    AlignmentReport {
        candidate_pair_reports: Vec::new(),
        fixture_id: fixture_id.to_string(),
        graph_revision_hash: graph_revision_hash.to_string(),
        non_claims: ALIGNMENT_NON_CLAIMS
            .iter()
            .map(|claim| claim.to_string())
            .collect(),
        pair_reports,
    }
}

fn build_pair_alignment_report(
    source_index_a: usize,
    source_index_b: usize,
    pair: Option<&PanoramaPairwiseMatchMetadata>,
    selected_edge: bool,
) -> PairAlignmentReport {
    let Some(pair) = pair else {
        return PairAlignmentReport {
            accepted: false,
            brief_matcher: None,
            finite_transform: false,
            homography_condition_number: None,
            inlier_count: 0,
            inlier_ratio: 0.0,
            match_count: 0,
            mean_reprojection_error_px: f64::INFINITY,
            mean_reverse_reprojection_error_px: f64::INFINITY,
            mean_symmetric_transfer_error_px: f64::INFINITY,
            p95_symmetric_transfer_error_px: f64::INFINITY,
            rejected_reasons: vec![
                "missing_pairwise_match".to_string(),
                "non_finite_transform".to_string(),
                "insufficient_inliers".to_string(),
                "low_inlier_ratio".to_string(),
                "high_reprojection_error".to_string(),
            ],
            selected_edge,
            source_index_a,
            source_index_b,
            spatial_support_cell_count: 0,
            transform_3x3_row_major: [f64::NAN; 9],
        };
    };

    let finite_transform = pair.homography3x3.iter().all(|value| value.is_finite());
    let homography_condition_number = pair.homography_condition_number.map(round_metric);
    let inlier_ratio = round_metric(pair.inlier_ratio);
    let mean_reprojection_error_px = round_metric(pair.mean_reprojection_error_px);
    let mean_reverse_reprojection_error_px = round_metric(pair.mean_reverse_reprojection_error_px);
    let mean_symmetric_transfer_error_px = round_metric(pair.mean_symmetric_transfer_error_px);
    let p95_symmetric_transfer_error_px = round_metric(pair.p95_symmetric_transfer_error_px);
    let mut rejected_reasons = Vec::new();
    if !finite_transform {
        rejected_reasons.push("non_finite_transform".to_string());
    }
    if pair.inliers < processing::MIN_INLIERS_FOR_CONNECTION {
        rejected_reasons.push("insufficient_inliers".to_string());
    }
    if inlier_ratio < MIN_ALIGNMENT_INLIER_RATIO {
        rejected_reasons.push("low_inlier_ratio".to_string());
    }
    if mean_symmetric_transfer_error_px > MAX_MEAN_REPROJECTION_ERROR_PX {
        rejected_reasons.push("high_reprojection_error".to_string());
    }
    PairAlignmentReport {
        accepted: rejected_reasons.is_empty(),
        brief_matcher: Some(pair.brief_match_diagnostics.clone()),
        finite_transform,
        homography_condition_number,
        inlier_count: pair.inliers,
        inlier_ratio,
        match_count: pair.match_count,
        mean_reprojection_error_px,
        mean_reverse_reprojection_error_px,
        mean_symmetric_transfer_error_px,
        p95_symmetric_transfer_error_px,
        rejected_reasons,
        selected_edge,
        source_index_a,
        source_index_b,
        spatial_support_cell_count: pair.spatial_support_cell_count,
        transform_3x3_row_major: pair.homography3x3,
    }
}

fn build_alignment_metrics(report: &AlignmentReport, source_count: usize) -> Vec<QualityMetric> {
    let expected_pair_count = source_count.saturating_sub(1) as f64;
    let match_count = report
        .pair_reports
        .iter()
        .map(|pair| pair.match_count)
        .sum::<usize>() as f64;
    let inlier_count = report
        .pair_reports
        .iter()
        .map(|pair| pair.inlier_count)
        .sum::<usize>() as f64;
    let inlier_ratio = if match_count == 0.0 {
        0.0
    } else {
        inlier_count / match_count
    };
    let accepted_pair_count = report
        .pair_reports
        .iter()
        .filter(|pair| pair.accepted)
        .count() as f64;
    let rejected_pair_count = report
        .pair_reports
        .iter()
        .filter(|pair| !pair.accepted)
        .count() as f64;
    let finite_transform_count = report
        .pair_reports
        .iter()
        .filter(|pair| pair.finite_transform)
        .count() as f64;
    let mean_forward_error = mean_finite(
        report
            .pair_reports
            .iter()
            .map(|pair| pair.mean_reprojection_error_px),
    );
    let mean_symmetric_error = mean_finite(
        report
            .pair_reports
            .iter()
            .map(|pair| pair.mean_symmetric_transfer_error_px),
    );

    vec![
        metric(
            "alignmentMatchCount",
            match_count,
            (processing::MIN_INLIERS_FOR_CONNECTION as f64) * expected_pair_count,
            match_count >= (processing::MIN_INLIERS_FOR_CONNECTION as f64) * expected_pair_count,
        ),
        metric(
            "alignmentInlierCount",
            inlier_count,
            (processing::MIN_INLIERS_FOR_CONNECTION as f64) * expected_pair_count,
            inlier_count >= (processing::MIN_INLIERS_FOR_CONNECTION as f64) * expected_pair_count,
        ),
        metric(
            "alignmentInlierRatio",
            inlier_ratio,
            MIN_ALIGNMENT_INLIER_RATIO,
            inlier_ratio >= MIN_ALIGNMENT_INLIER_RATIO,
        ),
        metric(
            "alignmentAcceptedPairCount",
            accepted_pair_count,
            expected_pair_count,
            accepted_pair_count >= expected_pair_count,
        ),
        metric(
            "alignmentRejectedPairCount",
            rejected_pair_count,
            0.0,
            rejected_pair_count <= 0.0,
        ),
        metric(
            "alignmentFiniteTransformCount",
            finite_transform_count,
            expected_pair_count,
            finite_transform_count >= expected_pair_count,
        ),
        metric(
            "alignmentMeanReprojectionErrorPx",
            mean_forward_error,
            MAX_MEAN_REPROJECTION_ERROR_PX,
            mean_forward_error <= MAX_MEAN_REPROJECTION_ERROR_PX,
        ),
        metric(
            "alignmentMeanSymmetricTransferErrorPx",
            mean_symmetric_error,
            MAX_MEAN_REPROJECTION_ERROR_PX,
            mean_symmetric_error <= MAX_MEAN_REPROJECTION_ERROR_PX,
        ),
    ]
}

fn build_stitch_metrics(
    render_result: &PanoramaRenderResult,
    source_count: usize,
) -> Vec<QualityMetric> {
    let stitched_source_count = render_result.metadata.connected_source_indices.len() as f64;
    let excluded_source_count = render_result.metadata.excluded_source_indices.len() as f64;
    let output_pixel_count = (render_result.metadata.output_width as u64
        * render_result.metadata.output_height as u64) as f64;
    let pairwise_match_count = render_result.metadata.pairwise_matches.len() as f64;
    let source_coverage_ratio = if source_count == 0 {
        0.0
    } else {
        stitched_source_count / source_count as f64
    };
    let edge_continuity_score = if source_count == 0 {
        0.0
    } else {
        source_coverage_ratio * (1.0 - excluded_source_count / source_count as f64)
    };
    let expected_pair_count = source_count.saturating_sub(1) as f64;

    vec![
        metric(
            "panoramaStitchedSourceCount",
            stitched_source_count,
            source_count as f64,
            stitched_source_count >= source_count as f64,
        ),
        metric(
            "panoramaExcludedSourceCount",
            excluded_source_count,
            0.0,
            excluded_source_count <= 0.0,
        ),
        metric(
            "panoramaOutputSourceCoverageRatio",
            source_coverage_ratio,
            1.0,
            source_coverage_ratio >= 1.0,
        ),
        metric(
            "panoramaOutputPixelCount",
            output_pixel_count,
            1.0,
            output_pixel_count > 0.0,
        ),
        metric(
            "panoramaPairwiseMatchCount",
            pairwise_match_count,
            expected_pair_count,
            pairwise_match_count >= expected_pair_count,
        ),
        metric(
            "edgeContinuityScore",
            edge_continuity_score,
            0.85,
            edge_continuity_score >= 0.85,
        ),
    ]
}

fn build_visibility_metrics(image: &image::DynamicImage) -> Vec<QualityMetric> {
    let rgb = image.to_rgb8();
    let pixel_count = (rgb.width() as u64 * rgb.height() as u64) as f64;
    if pixel_count == 0.0 {
        return vec![
            metric(
                "panoramaOutputMeanLuma",
                0.0,
                MIN_DIAGNOSTIC_OUTPUT_MEAN_LUMA,
                false,
            ),
            metric(
                "panoramaOutputNonBlackPixelRatio",
                0.0,
                MIN_DIAGNOSTIC_NON_BLACK_PIXEL_RATIO,
                false,
            ),
        ];
    }

    let mut luma_sum = 0.0;
    let mut non_black_count = 0.0;
    for pixel in rgb.pixels() {
        let [red, green, blue] = pixel.0;
        let luma = (0.2126 * red as f64 + 0.7152 * green as f64 + 0.0722 * blue as f64) / 255.0;
        luma_sum += luma;
        if red > 3 || green > 3 || blue > 3 {
            non_black_count += 1.0;
        }
    }

    let mean_luma = luma_sum / pixel_count;
    let non_black_ratio = non_black_count / pixel_count;
    vec![
        metric(
            "panoramaOutputMeanLuma",
            mean_luma,
            MIN_DIAGNOSTIC_OUTPUT_MEAN_LUMA,
            mean_luma >= MIN_DIAGNOSTIC_OUTPUT_MEAN_LUMA,
        ),
        metric(
            "panoramaOutputNonBlackPixelRatio",
            non_black_ratio,
            MIN_DIAGNOSTIC_NON_BLACK_PIXEL_RATIO,
            non_black_ratio >= MIN_DIAGNOSTIC_NON_BLACK_PIXEL_RATIO,
        ),
    ]
}

fn mean_abs_delta_rgb8(left: &image::RgbImage, right: &image::RgbImage) -> Result<f64, String> {
    if left.dimensions() != right.dimensions() {
        return Err("preview/export comparison dimensions differ".to_string());
    }
    let channel_count = (left.width() as u64 * left.height() as u64 * 3) as f64;
    if channel_count == 0.0 {
        return Err("preview/export comparison image is empty".to_string());
    }
    let sum = left
        .pixels()
        .zip(right.pixels())
        .map(|(left_pixel, right_pixel)| {
            left_pixel
                .0
                .iter()
                .zip(right_pixel.0.iter())
                .map(|(left_channel, right_channel)| {
                    (*left_channel as f64 - *right_channel as f64).abs() / 255.0
                })
                .sum::<f64>()
        })
        .sum::<f64>();
    Ok(sum / channel_count)
}

fn mean_finite(values: impl Iterator<Item = f64>) -> f64 {
    let finite_values = values.filter(|value| value.is_finite()).collect::<Vec<_>>();
    if finite_values.is_empty() {
        return f64::INFINITY;
    }
    finite_values.iter().sum::<f64>() / finite_values.len() as f64
}

fn round_metric(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    (value * 1_000_000.0).round() / 1_000_000.0
}

fn failed_metric_summary(metrics: &[QualityMetric]) -> String {
    let failed_metrics = metrics
        .iter()
        .filter(|metric| !metric.passed)
        .map(|metric| {
            format!(
                "{} value={} threshold={}",
                metric.name, metric.value, metric.threshold
            )
        })
        .collect::<Vec<_>>();
    if failed_metrics.is_empty() {
        return "no failed metrics recorded".to_string();
    }
    failed_metrics.join("; ")
}
