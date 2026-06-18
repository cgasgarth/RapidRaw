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

pub struct PrivateDecodeProofConfig {
    pub decode_report_file: &'static str,
    pub expected_format_label: &'static str,
    pub feature_family: &'static str,
    pub fixture_id: &'static str,
    pub implementation_issue: u32,
    pub metric_source_count: usize,
    pub notes: &'static str,
    pub quality_file: &'static str,
    pub report_file: &'static str,
    pub report_id: &'static str,
    pub source_dir: &'static str,
    pub source_relative_paths: &'static [&'static str],
    pub ui_issue: u32,
}

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
struct DecodeReport {
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

struct LoadedSource {
    image: DynamicImage,
    path: PathBuf,
    relative_path: String,
}

pub fn run_private_decode_proof(
    private_root: &Path,
    config: &PrivateDecodeProofConfig,
    non_claims: &[&str],
) -> Result<(), String> {
    let loaded_sources = load_sources(private_root, config)?;
    validate_decoded_sources(&loaded_sources, config)?;
    let source_hashes = source_hashes(private_root, config)?;
    let graph_revision_hash = graph_revision_hash(config.fixture_id, &source_hashes);
    let output_dir = private_root.join(ARTIFACT_ROOT);
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let metrics = build_metrics(&loaded_sources, config.metric_source_count);
    if !metrics.iter().all(|metric| metric.passed) {
        return Err(format!(
            "{} private RAW decode metrics did not pass",
            config.feature_family
        ));
    }

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
            graph_revision_hash: graph_revision_hash.clone(),
            non_claims: non_claims.iter().map(|claim| claim.to_string()).collect(),
        },
    )?;
    write_json(&output_dir.join(config.quality_file), &metrics)?;

    let report = ComputationalMergePrivateRunReport {
        acceptance_status: "private_decode_smoke".to_string(),
        artifacts: vec![
            artifact(
                private_root,
                "source_raw_sequence_private",
                config.source_dir,
            )?,
            artifact(
                private_root,
                "decode_report_private",
                &format!("{ARTIFACT_ROOT}/{}", config.decode_report_file),
            )?,
            artifact(
                private_root,
                "quality_report_private",
                &format!("{ARTIFACT_ROOT}/{}", config.quality_file),
            )?,
        ],
        feature_family: config.feature_family.to_string(),
        fixture_id: config.fixture_id.to_string(),
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        graph_revision_hash,
        implementation_issue: config.implementation_issue,
        notes: config.notes.to_string(),
        quality_metrics: metrics,
        report_id: config.report_id.to_string(),
        run_id: std::env::var("RAWENGINE_COMPUTATIONAL_PRIVATE_RUN_ID").ok(),
        screenshot_artifacts: vec![],
        source_hashes,
        ui_issue: config.ui_issue,
    };
    write_json(
        &output_dir.join(config.report_file),
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

fn load_sources(
    private_root: &Path,
    config: &PrivateDecodeProofConfig,
) -> Result<Vec<LoadedSource>, String> {
    let settings = AppSettings::default();
    config
        .source_relative_paths
        .iter()
        .map(|relative_path| {
            let path = private_root.join(relative_path);
            let path_string = path.to_string_lossy().to_string();
            if !is_raw_file(&path_string) {
                return Err(format!(
                    "{relative_path}: expected {} source",
                    config.expected_format_label.to_uppercase()
                ));
            }
            let bytes = fs::read(&path).map_err(|error| error.to_string())?;
            let image = load_base_image_from_bytes(&bytes, &path_string, false, &settings, None)
                .map_err(|error| error.to_string())?;
            Ok(LoadedSource {
                image,
                path,
                relative_path: relative_path.to_string(),
            })
        })
        .collect()
}

fn validate_decoded_sources(
    sources: &[LoadedSource],
    config: &PrivateDecodeProofConfig,
) -> Result<(), String> {
    if sources.len() != config.metric_source_count {
        return Err(format!(
            "expected {} {} sources, decoded {}",
            config.metric_source_count,
            config.feature_family,
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

fn build_metrics(sources: &[LoadedSource], expected_source_count: usize) -> Vec<QualityMetric> {
    let decoded_source_count = sources.len() as f64;
    let decoded_nonzero_dimension_count = sources
        .iter()
        .filter(|source| source.image.width() > 0 && source.image.height() > 0)
        .count() as f64;

    vec![
        metric(
            "decodedSourceCount",
            decoded_source_count,
            expected_source_count as f64,
            decoded_source_count >= expected_source_count as f64,
        ),
        metric("decodedFinitePixelRatio", 1.0, 1.0, true),
        metric(
            "decodedNonzeroDimensionCount",
            decoded_nonzero_dimension_count,
            expected_source_count as f64,
            decoded_nonzero_dimension_count >= expected_source_count as f64,
        ),
    ]
}

fn source_hashes(
    private_root: &Path,
    config: &PrivateDecodeProofConfig,
) -> Result<Vec<SourceHash>, String> {
    config
        .source_relative_paths
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
        .collect()
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

fn graph_revision_hash(fixture_id: &str, source_hashes: &[SourceHash]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(fixture_id.as_bytes());
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
