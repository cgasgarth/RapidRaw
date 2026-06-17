use std::fs;
use std::path::{Component, Path, PathBuf};

use chrono::Utc;
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::app_settings::load_settings_or_default;
use crate::app_state::AppState;
use crate::export_processing::process_image_for_export_pipeline;
use crate::formats::is_raw_file;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::{ImageMetadata, get_or_init_gpu_context};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofRequest {
    pub artifact_dir_relative: String,
    pub edit_command_id: String,
    pub edit_graph_revision: String,
    pub fixture_id: String,
    pub private_root_path: String,
    pub source_relative_path: String,
    pub adjustments: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofArtifact {
    pub hash: String,
    pub kind: String,
    pub path: String,
    pub public_repo_allowed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofMetric {
    pub name: String,
    pub passed: bool,
    pub source: String,
    pub threshold: f64,
    pub value: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofReport {
    pub artifacts: Vec<RawOpenEditExportProofArtifact>,
    pub edit_command_id: String,
    pub edit_graph_revision: String,
    pub fixture_id: String,
    pub generated_at: String,
    pub metrics: Vec<RawOpenEditExportProofMetric>,
    pub report_id: String,
    pub source_hash_unchanged: bool,
    pub tracking_issue: u32,
}

#[tauri::command]
pub async fn run_raw_open_edit_export_proof(
    request: RawOpenEditExportProofRequest,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<RawOpenEditExportProofReport, String> {
    let private_root = PathBuf::from(&request.private_root_path);
    if !private_root.is_absolute() {
        return Err("privateRootPath must be absolute.".to_string());
    }

    let source_path = resolve_private_relative(&private_root, &request.source_relative_path)?;
    let artifact_dir = resolve_private_relative(&private_root, &request.artifact_dir_relative)?;
    fs::create_dir_all(&artifact_dir).map_err(|error| error.to_string())?;

    let source_hash_before = sha256_file(&source_path)?;
    let source_bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    let settings = load_settings_or_default(&app_handle);
    let source_path_string = source_path.to_string_lossy().to_string();
    let base_image =
        load_base_image_from_bytes(&source_bytes, &source_path_string, false, &settings, None)
            .map_err(|error| error.to_string())?;

    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let empty_adjustments = json!({});
    let is_raw = is_raw_file(&source_path_string);
    let preview_before = process_image_for_export_pipeline(
        &source_path_string,
        &base_image,
        &empty_adjustments,
        &context,
        &state,
        is_raw,
        "raw_open_edit_export_preview_before",
        &app_handle,
    )?;
    let preview_after = process_image_for_export_pipeline(
        &source_path_string,
        &base_image,
        &request.adjustments,
        &context,
        &state,
        is_raw,
        "raw_open_edit_export_preview_after",
        &app_handle,
    )?;
    let export_after = process_image_for_export_pipeline(
        &source_path_string,
        &base_image,
        &request.adjustments,
        &context,
        &state,
        is_raw,
        "raw_open_edit_export_export_after",
        &app_handle,
    )?;

    let slug = slug_from_fixture_id(&request.fixture_id);
    let preview_before_relative = format!(
        "{}/{}-preview-before.png",
        request.artifact_dir_relative, slug
    );
    let preview_after_relative = format!(
        "{}/{}-preview-after.png",
        request.artifact_dir_relative, slug
    );
    let export_after_relative = format!(
        "{}/{}-export-after.tiff",
        request.artifact_dir_relative, slug
    );
    let sidecar_after_relative = format!("{}/{}-after.rrdata", request.artifact_dir_relative, slug);
    let workflow_report_relative = format!(
        "{}/{}-workflow-report.json",
        request.artifact_dir_relative, slug
    );

    write_image(
        &private_root,
        &preview_before_relative,
        &preview_before,
        ImageFormat::Png,
    )?;
    write_image(
        &private_root,
        &preview_after_relative,
        &preview_after,
        ImageFormat::Png,
    )?;
    write_image(
        &private_root,
        &export_after_relative,
        &export_after,
        ImageFormat::Tiff,
    )?;

    let sidecar_path = resolve_private_relative(&private_root, &sidecar_after_relative)?;
    let sidecar_json = build_sidecar_json(&request);
    fs::write(
        &sidecar_path,
        serde_json::to_vec_pretty(&sidecar_json).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let changed_pixel_ratio = changed_pixel_ratio(&preview_before, &preview_after);
    let preview_export_mean_abs_delta = mean_abs_delta(&preview_after, &export_after);
    let reloaded_sidecar = fs::read_to_string(&sidecar_path).map_err(|error| error.to_string())?;
    let reloaded_sidecar_json: Value =
        serde_json::from_str(&reloaded_sidecar).map_err(|error| error.to_string())?;
    let sidecar_reload_revision_match = reloaded_sidecar_json
        .pointer("/rawOpenEditExportProof/editGraphRevision")
        .and_then(Value::as_str)
        == Some(request.edit_graph_revision.as_str());
    let source_hash_after = sha256_file(&source_path)?;
    let source_hash_unchanged = source_hash_before == source_hash_after;

    let mut artifacts = vec![
        artifact(
            "source_raw_private",
            request.source_relative_path.clone(),
            source_hash_before,
        ),
        hashed_artifact(
            &private_root,
            "preview_before_private",
            &preview_before_relative,
        )?,
        hashed_artifact(
            &private_root,
            "preview_after_private",
            &preview_after_relative,
        )?,
        hashed_artifact(
            &private_root,
            "export_after_private",
            &export_after_relative,
        )?,
        hashed_artifact(
            &private_root,
            "sidecar_after_private",
            &sidecar_after_relative,
        )?,
    ];

    let mut report = RawOpenEditExportProofReport {
        artifacts: Vec::new(),
        edit_command_id: request.edit_command_id,
        edit_graph_revision: request.edit_graph_revision,
        fixture_id: request.fixture_id.clone(),
        generated_at: Utc::now().to_rfc3339(),
        metrics: vec![
            metric(
                "changedPixelRatio",
                changed_pixel_ratio,
                0.0,
                changed_pixel_ratio > 0.0,
            ),
            metric(
                "previewExportMeanAbsDelta",
                preview_export_mean_abs_delta,
                0.015,
                preview_export_mean_abs_delta <= 0.015,
            ),
            metric(
                "sidecarReloadRevisionMatch",
                if sidecar_reload_revision_match {
                    1.0
                } else {
                    0.0
                },
                1.0,
                sidecar_reload_revision_match,
            ),
            metric(
                "sourceHashUnchanged",
                if source_hash_unchanged { 1.0 } else { 0.0 },
                1.0,
                source_hash_unchanged,
            ),
        ],
        report_id: format!("raw-open-edit-export-run.{}", slug),
        source_hash_unchanged,
        tracking_issue: 1376,
    };

    let workflow_report_path = resolve_private_relative(&private_root, &workflow_report_relative)?;
    report.artifacts = artifacts.clone();
    fs::write(
        &workflow_report_path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    artifacts.push(hashed_artifact(
        &private_root,
        "workflow_report_private",
        &workflow_report_relative,
    )?);
    report.artifacts = artifacts;

    Ok(report)
}

fn build_sidecar_json(request: &RawOpenEditExportProofRequest) -> Value {
    let metadata = ImageMetadata {
        adjustments: request.adjustments.clone(),
        ..Default::default()
    };
    let mut value = serde_json::to_value(metadata).unwrap_or_else(|_| json!({}));
    value["rawOpenEditExportProof"] = json!({
        "editCommandId": request.edit_command_id,
        "editGraphRevision": request.edit_graph_revision,
        "fixtureId": request.fixture_id,
        "trackingIssue": 1376
    });
    value
}

fn write_image(
    private_root: &Path,
    relative_path: &str,
    image: &DynamicImage,
    format: ImageFormat,
) -> Result<(), String> {
    let path = resolve_private_relative(private_root, relative_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    image
        .save_with_format(path, format)
        .map_err(|error| error.to_string())
}

fn resolve_private_relative(private_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err(format!("{relative_path} must be private-root relative."));
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("{relative_path} must not contain path traversal."));
    }
    Ok(private_root.join(path))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

fn hashed_artifact(
    private_root: &Path,
    kind: &str,
    relative_path: &str,
) -> Result<RawOpenEditExportProofArtifact, String> {
    let path = resolve_private_relative(private_root, relative_path)?;
    Ok(artifact(
        kind,
        relative_path.to_string(),
        sha256_file(&path)?,
    ))
}

fn artifact(kind: &str, path: String, hash: String) -> RawOpenEditExportProofArtifact {
    RawOpenEditExportProofArtifact {
        hash,
        kind: kind.to_string(),
        path,
        public_repo_allowed: false,
    }
}

fn metric(name: &str, value: f64, threshold: f64, passed: bool) -> RawOpenEditExportProofMetric {
    RawOpenEditExportProofMetric {
        name: name.to_string(),
        passed,
        source: "private_raw_report".to_string(),
        threshold,
        value,
    }
}

fn changed_pixel_ratio(before: &DynamicImage, after: &DynamicImage) -> f64 {
    let before = before.to_rgba8();
    let after = after.to_rgba8();
    let width = before.width().min(after.width());
    let height = before.height().min(after.height());
    if width == 0 || height == 0 {
        return 0.0;
    }

    let mut changed_pixels = 0_u64;
    for y in 0..height {
        for x in 0..width {
            if before.get_pixel(x, y).0 != after.get_pixel(x, y).0 {
                changed_pixels += 1;
            }
        }
    }
    changed_pixels as f64 / f64::from(width * height)
}

fn mean_abs_delta(first: &DynamicImage, second: &DynamicImage) -> f64 {
    let first = first.to_rgba8();
    let second = second.to_rgba8();
    let width = first.width().min(second.width());
    let height = first.height().min(second.height());
    if width == 0 || height == 0 {
        return 0.0;
    }

    let mut total = 0_f64;
    for y in 0..height {
        for x in 0..width {
            let first_pixel = first.get_pixel(x, y).0;
            let second_pixel = second.get_pixel(x, y).0;
            for channel in 0..4 {
                total += f64::from(first_pixel[channel].abs_diff(second_pixel[channel])) / 255.0;
            }
        }
    }
    total / f64::from(width * height * 4)
}

fn slug_from_fixture_id(fixture_id: &str) -> String {
    fixture_id
        .strip_prefix("validation.raw-open-edit-export.")
        .unwrap_or(fixture_id)
        .replace('.', "-")
}
