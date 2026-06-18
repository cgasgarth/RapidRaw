#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::ImageFormat;
use nalgebra::Point2;
use serde::Serialize;

use crate::app_settings::AppSettings;
use crate::app_state::AppState;
use crate::panorama_stitching::{
    KeyPoint, PanoramaRenderRequest, PanoramaRenderResult,
    render_with_legacy_homography_engine_with_settings,
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
    "private-fixtures/panorama/overlap-stitch-v1/frame-01.raf",
    "private-fixtures/panorama/overlap-stitch-v1/frame-02.raf",
    "private-fixtures/panorama/overlap-stitch-v1/frame-03.raf",
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
const MIN_ALIGNMENT_INLIER_RATIO: f64 = 0.55;
const MAX_MEAN_REPROJECTION_ERROR_PX: f64 = 5.0;

const CONFIG: PrivateDecodeProofConfig = PrivateDecodeProofConfig {
    decode_report_file: "panorama-overlap-decode-report.json",
    expected_format_label: "raf",
    feature_family: "panorama_stitch",
    fixture_id: "validation.computational-merge.panorama-overlap.v1",
    implementation_issue: 1508,
    metric_source_count: SOURCE_RELATIVE_PATHS.len(),
    notes: "Private RAF panorama overlap direct decode smoke only. This proves production RAW loader ingest, nonzero decoded dimensions, finite decoded pixel payloads, source hashing, and metadata-only report collection. It does not claim panorama alignment, stitch quality, app-server apply, preview/export parity, or UI review.",
    quality_file: "panorama-overlap-quality.json",
    report_file: "panorama-overlap-private-run-report.json",
    report_id: "computational-merge-run.panorama-overlap.v1",
    source_dir: "private-fixtures/panorama/overlap-stitch-v1",
    source_relative_paths: &SOURCE_RELATIVE_PATHS,
    ui_issue: 1333,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentReport {
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
    seam_diagnostics: StitchSeamDiagnostics,
    stitch_engine: String,
    warning_count: usize,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StitchExposureDiagnostics {
    mode: String,
    support: String,
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
    finite_transform: bool,
    inlier_count: usize,
    inlier_ratio: f64,
    match_count: usize,
    mean_reprojection_error_px: f64,
    source_index_a: usize,
    source_index_b: usize,
    transform_3x3_row_major: [f64; 9],
}

struct PreparedSource {
    features: Vec<crate::panorama_stitching::Feature>,
    keypoints: Vec<KeyPoint>,
}

fn run_private_alignment_proof(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root, &CONFIG)?;
    validate_decoded_sources(&loaded_sources, &CONFIG)?;
    let source_hashes = source_hashes(private_root, &CONFIG)?;
    let graph_revision_hash = graph_revision_hash(CONFIG.fixture_id, &source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let decode_metrics = build_metrics(&loaded_sources, CONFIG.metric_source_count);
    let alignment_report = build_alignment_report(&loaded_sources, &graph_revision_hash)?;
    let alignment_metrics = build_alignment_metrics(&alignment_report, loaded_sources.len());
    let metrics = [decode_metrics, alignment_metrics].concat();
    if !metrics.iter().all(|metric| metric.passed) {
        return Err("panorama private RAW alignment metrics did not pass".to_string());
    }

    write_decode_report(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
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
                notes: "Private RAF panorama alignment smoke. This proves production RAW decode plus the existing BRIEF/RANSAC homography alignment path on the private overlap sequence. It does not claim stitched output, app-server apply, preview/export parity, or UI review.".to_string(),
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

    let alignment_report = build_alignment_report(&loaded_sources, &graph_revision_hash)?;
    let render_result = render_private_panorama(private_root)?;
    let stitch_output_path = output_dir.join(STITCH_OUTPUT_FILE);
    render_result
        .image
        .save_with_format(&stitch_output_path, ImageFormat::Tiff)
        .map_err(|error| error.to_string())?;

    let stitch_report = build_stitch_report(&render_result, &graph_revision_hash);
    let metrics = [
        build_metrics(&loaded_sources, CONFIG.metric_source_count),
        build_alignment_metrics(&alignment_report, loaded_sources.len()),
        build_stitch_metrics(&render_result, loaded_sources.len()),
    ]
    .concat();
    if !metrics.iter().all(|metric| metric.passed) {
        return Err("panorama private RAW stitch artifact metrics did not pass".to_string());
    }

    write_decode_report(
        &output_dir,
        &loaded_sources,
        &source_hashes,
        &graph_revision_hash,
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
                notes: "Private RAF panorama stitch artifact smoke. This proves production RAW decode plus the legacy RapidRaw homography/seam stitch engine can emit a private panorama artifact with source coverage and diagnostics. It does not claim app-server apply, preview/export parity, or UI review.".to_string(),
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

fn render_private_panorama(private_root: &Path) -> Result<PanoramaRenderResult, String> {
    let app = tauri::test::mock_builder()
        .manage(AppState::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .map_err(|error| error.to_string())?;
    let image_paths = CONFIG
        .source_relative_paths
        .iter()
        .map(|relative_path| {
            private_root
                .join(relative_path)
                .to_string_lossy()
                .to_string()
        })
        .collect();
    render_with_legacy_homography_engine_with_settings(
        PanoramaRenderRequest { image_paths },
        app.handle().clone(),
        AppSettings::default(),
    )
}

fn build_stitch_report(
    render_result: &PanoramaRenderResult,
    graph_revision_hash: &str,
) -> StitchReport {
    StitchReport {
        boundary_mode: "auto_crop".to_string(),
        connected_source_indices: render_result.metadata.connected_source_indices.clone(),
        excluded_source_indices: render_result.metadata.excluded_source_indices.clone(),
        exposure_diagnostics: StitchExposureDiagnostics {
            mode: "planned_not_applied".to_string(),
            support: "diagnostic_only_current_engine".to_string(),
        },
        fixture_id: CONFIG.fixture_id.to_string(),
        graph_revision_hash: graph_revision_hash.to_string(),
        non_claims: ALIGNMENT_NON_CLAIMS
            .iter()
            .map(|claim| claim.to_string())
            .collect(),
        output_height: render_result.metadata.output_height,
        output_width: render_result.metadata.output_width,
        pairwise_match_count: render_result.metadata.pairwise_matches.len(),
        seam_diagnostics: StitchSeamDiagnostics {
            feather_width_px: 100,
            mode: "adaptive_dp_feather_v1".to_string(),
            support: "implemented_current_engine".to_string(),
        },
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
            non_claims: ALIGNMENT_NON_CLAIMS
                .iter()
                .map(|claim| claim.to_string())
                .collect(),
        },
    )
}

fn build_alignment_report(
    loaded_sources: &[LoadedSource],
    graph_revision_hash: &str,
) -> Result<AlignmentReport, String> {
    let brief_pairs = processing::generate_brief_pairs();
    let prepared_sources: Vec<PreparedSource> = loaded_sources
        .iter()
        .map(|source| {
            let gray_full = image::imageops::colorops::grayscale(&source.image.to_rgb8());
            let (width, height) = gray_full.dimensions();
            let (new_width, new_height, _scale_factor) =
                processing::calculate_downscale_dimensions(width, height);
            let gray_small = image::imageops::resize(
                &gray_full,
                new_width,
                new_height,
                image::imageops::FilterType::Triangle,
            );
            let features = processing::find_features(&gray_small, &brief_pairs);
            let keypoints = features.iter().map(|feature| feature.keypoint).collect();
            PreparedSource {
                features,
                keypoints,
            }
        })
        .collect();

    let mut pair_reports = Vec::new();
    for (source_index, pair) in prepared_sources.windows(2).enumerate() {
        let left = &pair[0];
        let right = &pair[1];
        let matches = processing::match_features(&left.features, &right.features);
        let Some((homography, inliers)) =
            processing::find_homography_ransac(&matches, &left.keypoints, &right.keypoints)
        else {
            pair_reports.push(PairAlignmentReport {
                accepted: false,
                finite_transform: false,
                inlier_count: 0,
                inlier_ratio: 0.0,
                match_count: matches.len(),
                mean_reprojection_error_px: f64::INFINITY,
                source_index_a: source_index,
                source_index_b: source_index + 1,
                transform_3x3_row_major: [f64::NAN; 9],
            });
            continue;
        };

        let finite_transform = homography.iter().all(|value| value.is_finite());
        let mean_reprojection_error_px =
            mean_reprojection_error(&homography, &inliers, &left.keypoints, &right.keypoints);
        let inlier_ratio = if matches.is_empty() {
            0.0
        } else {
            inliers.len() as f64 / matches.len() as f64
        };
        pair_reports.push(PairAlignmentReport {
            accepted: finite_transform
                && inliers.len() >= processing::MIN_INLIERS_FOR_CONNECTION
                && inlier_ratio >= MIN_ALIGNMENT_INLIER_RATIO
                && mean_reprojection_error_px <= MAX_MEAN_REPROJECTION_ERROR_PX,
            finite_transform,
            inlier_count: inliers.len(),
            inlier_ratio: round_metric(inlier_ratio),
            match_count: matches.len(),
            mean_reprojection_error_px: round_metric(mean_reprojection_error_px),
            source_index_a: source_index,
            source_index_b: source_index + 1,
            transform_3x3_row_major: [
                homography[(0, 0)],
                homography[(0, 1)],
                homography[(0, 2)],
                homography[(1, 0)],
                homography[(1, 1)],
                homography[(1, 2)],
                homography[(2, 0)],
                homography[(2, 1)],
                homography[(2, 2)],
            ],
        });
    }

    Ok(AlignmentReport {
        fixture_id: CONFIG.fixture_id.to_string(),
        graph_revision_hash: graph_revision_hash.to_string(),
        non_claims: ALIGNMENT_NON_CLAIMS
            .iter()
            .map(|claim| claim.to_string())
            .collect(),
        pair_reports,
    })
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
    let mean_error = mean_finite(
        report
            .pair_reports
            .iter()
            .map(|pair| pair.mean_reprojection_error_px),
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
            mean_error,
            MAX_MEAN_REPROJECTION_ERROR_PX,
            mean_error <= MAX_MEAN_REPROJECTION_ERROR_PX,
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
    ]
}

fn mean_reprojection_error(
    homography: &nalgebra::Matrix3<f64>,
    inliers: &[crate::panorama_stitching::Match],
    keypoints1: &[KeyPoint],
    keypoints2: &[KeyPoint],
) -> f64 {
    if inliers.is_empty() {
        return f64::INFINITY;
    }
    let sum = inliers
        .iter()
        .map(|matched| {
            let p1 = keypoints1[matched.index1];
            let p2 = keypoints2[matched.index2];
            let transformed = homography * nalgebra::Point3::new(p1.x as f64, p1.y as f64, 1.0);
            if transformed.z.abs() < 1e-8 {
                return f64::INFINITY;
            }
            let projected =
                Point2::new(transformed.x / transformed.z, transformed.y / transformed.z);
            ((p2.x as f64 - projected.x).powi(2) + (p2.y as f64 - projected.y).powi(2)).sqrt()
        })
        .sum::<f64>();
    sum / inliers.len() as f64
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
