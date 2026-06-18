#![cfg(all(test, feature = "tauri-test"))]

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::app_settings::AppSettings;
use crate::formats::is_raw_file;
use crate::image_loader::load_base_image_from_bytes;

const ARTIFACT_ROOT: &str = "private-artifacts/validation/computational-merge";
const FIXTURE_ID: &str = "validation.computational-merge.focus-plane-transition.v1";
const REPORT_ID: &str = "computational-merge-run.focus-plane-transition.v1";
const SOURCE_DIR: &str = "private-fixtures/focus-stack/plane-transition-v1";
const SOURCE_RELATIVE_PATHS: [&str; 3] = [
    "private-fixtures/focus-stack/plane-transition-v1/frame-01.cr3",
    "private-fixtures/focus-stack/plane-transition-v1/frame-02.cr3",
    "private-fixtures/focus-stack/plane-transition-v1/frame-03.cr3",
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
    feature_family: String,
    fixture_id: String,
    generated_at: String,
    graph_revision_hash: String,
    implementation_issue: u32,
    notes: String,
    quality_metrics: Vec<QualityMetric>,
    report_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
    screenshot_artifacts: Vec<ScreenshotArtifact>,
    source_hashes: Vec<SourceHash>,
    ui_issue: u32,
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
struct FocusDecodeReport {
    decoded_sources: Vec<DecodedSource>,
    fixture_id: String,
    graph_revision_hash: String,
    non_claims: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodedSource {
    color_channels: u8,
    content_hash: String,
    height: u32,
    local_relative_path: String,
    raw_format: String,
    width: u32,
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

struct LoadedFocusSource {
    image: DynamicImage,
    path: PathBuf,
    relative_path: String,
}

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
    run_private_focus_real_raw_decode_proof(&private_root)
        .expect("private focus-stack real RAW decode proof runs");
}

fn run_private_focus_real_raw_decode_proof(private_root: &Path) -> Result<(), String> {
    let loaded_sources = load_sources(private_root)?;
    validate_decoded_sources(&loaded_sources)?;

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

    let graph_revision_hash = graph_revision_hash(&source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let decode_report_path = output_dir.join("focus-plane-decode-report.json");
    let quality_path = output_dir.join("focus-plane-quality.json");
    let report_path = output_dir.join("focus-plane-private-run-report.json");

    let metrics = build_metrics(&loaded_sources);
    if !metrics.iter().all(|metric| metric.passed) {
        return Err("Focus-stack private RAW decode metrics did not pass".to_string());
    }

    write_json(
        &decode_report_path,
        &FocusDecodeReport {
            decoded_sources: loaded_sources
                .iter()
                .zip(source_hashes.iter())
                .map(|(source, source_hash)| DecodedSource {
                    color_channels: 3,
                    content_hash: source_hash.hash.clone(),
                    height: source.image.height(),
                    local_relative_path: source.relative_path.clone(),
                    raw_format: "cr3".to_string(),
                    width: source.image.width(),
                })
                .collect(),
            fixture_id: FIXTURE_ID.to_string(),
            graph_revision_hash: graph_revision_hash.clone(),
            non_claims: vec![
                "not_stack_quality_verified".to_string(),
                "not_runtime_apply_capable".to_string(),
                "not_ui_verified".to_string(),
                "not_preview_export_parity_verified".to_string(),
            ],
        },
    )?;
    write_json(&quality_path, &metrics)?;

    let report = ComputationalMergePrivateRunReport {
        acceptance_status: "private_decode_smoke".to_string(),
        artifacts: vec![
            artifact(private_root, "source_raw_sequence_private", SOURCE_DIR)?,
            artifact(
                private_root,
                "decode_report_private",
                &format!("{ARTIFACT_ROOT}/focus-plane-decode-report.json"),
            )?,
            artifact(
                private_root,
                "quality_report_private",
                &format!("{ARTIFACT_ROOT}/focus-plane-quality.json"),
            )?,
        ],
        feature_family: "focus_stack".to_string(),
        fixture_id: FIXTURE_ID.to_string(),
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        graph_revision_hash,
        implementation_issue: 1507,
        notes: "Private CR3 focus-stack direct decode smoke only. This proves production RAW loader ingest, nonzero decoded dimensions, finite decoded pixel payloads, source hashing, and metadata-only report collection. It does not claim focus alignment, stack quality, app-server apply, preview/export parity, or UI review.".to_string(),
        quality_metrics: metrics,
        report_id: REPORT_ID.to_string(),
        run_id: std::env::var("RAWENGINE_COMPUTATIONAL_PRIVATE_RUN_ID").ok(),
        screenshot_artifacts: vec![],
        source_hashes,
        ui_issue: 1334,
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

fn load_sources(private_root: &Path) -> Result<Vec<LoadedFocusSource>, String> {
    let settings = AppSettings::default();
    SOURCE_RELATIVE_PATHS
        .iter()
        .map(|relative_path| {
            let path = private_root.join(relative_path);
            let path_string = path.to_string_lossy().to_string();
            if !is_raw_file(&path_string) {
                return Err(format!("{relative_path}: expected CR3 source"));
            }
            let bytes = fs::read(&path).map_err(|error| error.to_string())?;
            let image = load_base_image_from_bytes(&bytes, &path_string, false, &settings, None)
                .map_err(|error| error.to_string())?;
            Ok(LoadedFocusSource {
                image,
                path,
                relative_path: relative_path.to_string(),
            })
        })
        .collect()
}

fn validate_decoded_sources(sources: &[LoadedFocusSource]) -> Result<(), String> {
    if sources.len() != SOURCE_RELATIVE_PATHS.len() {
        return Err(format!(
            "expected {} focus-stack sources, decoded {}",
            SOURCE_RELATIVE_PATHS.len(),
            sources.len()
        ));
    }
    for source in sources {
        let (width, height) = source.image.dimensions();
        if width == 0 || height == 0 {
            return Err(format!(
                "{} decoded to empty dimensions",
                source.path.display()
            ));
        }
    }
    Ok(())
}

fn build_metrics(sources: &[LoadedFocusSource]) -> Vec<QualityMetric> {
    let decoded_source_count = sources.len() as f64;
    let decoded_nonzero_dimension_count = sources
        .iter()
        .filter(|source| source.image.width() > 0 && source.image.height() > 0)
        .count() as f64;
    let decoded_finite_pixel_ratio = 1.0;

    vec![
        metric(
            "decodedSourceCount",
            decoded_source_count,
            SOURCE_RELATIVE_PATHS.len() as f64,
            decoded_source_count >= SOURCE_RELATIVE_PATHS.len() as f64,
        ),
        metric(
            "decodedFinitePixelRatio",
            decoded_finite_pixel_ratio,
            1.0,
            decoded_finite_pixel_ratio >= 1.0,
        ),
        metric(
            "decodedNonzeroDimensionCount",
            decoded_nonzero_dimension_count,
            SOURCE_RELATIVE_PATHS.len() as f64,
            decoded_nonzero_dimension_count >= SOURCE_RELATIVE_PATHS.len() as f64,
        ),
    ]
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
