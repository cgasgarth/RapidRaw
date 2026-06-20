use std::fs;
use std::path::{Component, Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::app_settings::{AppSettings, load_settings_or_default};
use crate::app_state::AppState;
use crate::export_processing::process_image_for_export_pipeline_with_tonemapper_override;
use crate::formats::is_raw_file;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::{
    GpuContext, ImageMetadata, get_or_init_gpu_context, resolve_tonemapper_override,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofRequest {
    pub artifact_dir_relative: String,
    pub edit_command: RawOpenEditExportBasicToneCommand,
    pub fixture_id: String,
    pub private_root_path: String,
    pub source_relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportBasicToneCommand {
    pub approval: RawOpenEditExportBasicToneApproval,
    pub color_pipeline: RawOpenEditExportColorPipeline,
    pub command_id: String,
    pub command_type: String,
    pub dry_run: bool,
    pub expected_graph_revision: String,
    pub parameters: RawOpenEditExportBasicToneParameters,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportBasicToneApproval {
    pub approval_class: String,
    pub state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportColorPipeline {
    pub chromatic_adaptation: RawOpenEditExportChromaticAdaptation,
    pub input_domain: String,
    pub operation_domain: String,
    pub render_target: RawOpenEditExportRenderTarget,
    pub scene_to_display_transform: String,
    pub working_space: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportChromaticAdaptation {
    pub method: String,
    pub source_white_point: RawOpenEditExportWhitePoint,
    pub status: String,
    pub target_white_point: RawOpenEditExportWhitePoint,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportWhitePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportRenderTarget {
    pub bit_depth: u32,
    pub embed_icc: bool,
    pub intent: String,
    pub output_profile: String,
    pub view_transform: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportBasicToneParameters {
    pub black_point: f64,
    pub clarity: f64,
    pub contrast: f64,
    pub exposure_ev: f64,
    pub highlights: f64,
    pub saturation: f64,
    pub shadows: f64,
    pub white_point: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofArtifact {
    pub hash: String,
    pub kind: String,
    pub path: String,
    pub public_repo_allowed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofHashedPath {
    pub hash: String,
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
pub struct RawOpenEditExportColorManagementProof {
    pub chromatic_adaptation: RawOpenEditExportChromaticAdaptation,
    pub display_transform: RawOpenEditExportDisplayTransform,
    pub does_not_prove: Vec<String>,
    pub input_domain: String,
    pub operation_domain: String,
    pub proof_level: String,
    pub tracking_issue: u32,
    pub working_space: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportDisplayTransform {
    pub bit_depth: u32,
    pub embed_icc: bool,
    pub intent: String,
    pub output_profile: String,
    pub scene_to_display_transform: String,
    pub view_transform: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofReport {
    pub artifacts: Vec<RawOpenEditExportProofArtifact>,
    pub color_management: RawOpenEditExportColorManagementProof,
    pub edit_command_id: String,
    pub edit_graph_revision: String,
    pub fixture_id: String,
    pub generated_at: String,
    pub metrics: Vec<RawOpenEditExportProofMetric>,
    pub preview_after: RawOpenEditExportProofHashedPath,
    pub preview_before: RawOpenEditExportProofHashedPath,
    pub report_id: String,
    pub sidecar_after: RawOpenEditExportProofHashedPath,
    pub source_raw: RawOpenEditExportProofHashedPath,
    pub tracking_issue: u32,
}

#[tauri::command]
pub async fn run_raw_open_edit_export_proof(
    request: RawOpenEditExportProofRequest,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<RawOpenEditExportProofReport, String> {
    let settings = load_settings_or_default(&app_handle);
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    run_raw_open_edit_export_proof_with_context(request, &state, &settings, &context)
}

fn run_raw_open_edit_export_proof_with_context(
    request: RawOpenEditExportProofRequest,
    state: &tauri::State<'_, AppState>,
    settings: &AppSettings,
    context: &GpuContext,
) -> Result<RawOpenEditExportProofReport, String> {
    let private_root = PathBuf::from(&request.private_root_path);
    if !private_root.is_absolute() {
        return Err("privateRootPath must be absolute.".to_string());
    }

    let source_path = resolve_private_relative(&private_root, &request.source_relative_path)?;
    let artifact_dir = resolve_private_relative(&private_root, &request.artifact_dir_relative)?;
    fs::create_dir_all(&artifact_dir).map_err(|error| error.to_string())?;
    let adjustments = basic_tone_adjustments(&request.edit_command)?;

    let source_hash_before = sha256_file(&source_path)?;
    let source_bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    let source_path_string = source_path.to_string_lossy().to_string();
    let base_image =
        load_base_image_from_bytes(&source_bytes, &source_path_string, false, settings, None)
            .map_err(|error| error.to_string())?;

    let empty_adjustments = json!({});
    let is_raw = is_raw_file(&source_path_string);
    let tm_override = resolve_tonemapper_override(settings, is_raw);
    let preview_before = process_image_for_export_pipeline_with_tonemapper_override(
        &source_path_string,
        &base_image,
        &empty_adjustments,
        context,
        state,
        is_raw,
        "raw_open_edit_export_preview_before",
        tm_override,
        &[],
    )?;
    let preview_after = process_image_for_export_pipeline_with_tonemapper_override(
        &source_path_string,
        &base_image,
        &adjustments,
        context,
        state,
        is_raw,
        "raw_open_edit_export_preview_after",
        tm_override,
        &[],
    )?;
    let export_after = process_image_for_export_pipeline_with_tonemapper_override(
        &source_path_string,
        &base_image,
        &adjustments,
        context,
        state,
        is_raw,
        "raw_open_edit_export_export_after",
        tm_override,
        &[],
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
    let sidecar_json = build_sidecar_json(&request, &adjustments);
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
        == Some(request.edit_command.expected_graph_revision.as_str());
    let source_hash_after = sha256_file(&source_path)?;
    let source_hash_unchanged = source_hash_before == source_hash_after;

    let source_raw = hashed_path(request.source_relative_path.clone(), source_hash_before);
    let preview_before_path = hash_relative_path(&private_root, &preview_before_relative)?;
    let preview_after_path = hash_relative_path(&private_root, &preview_after_relative)?;
    let sidecar_after_path = hash_relative_path(&private_root, &sidecar_after_relative)?;
    let mut artifacts = vec![
        artifact("source_raw_private", &source_raw),
        artifact("preview_before_private", &preview_before_path),
        artifact("preview_after_private", &preview_after_path),
        hashed_artifact(
            &private_root,
            "export_after_private",
            &export_after_relative,
        )?,
        artifact("sidecar_after_private", &sidecar_after_path),
    ];

    let report_id = raw_open_edit_export_report_id(&request.fixture_id);
    let mut report = RawOpenEditExportProofReport {
        artifacts: Vec::new(),
        color_management: color_management_proof(&request.edit_command.color_pipeline),
        edit_command_id: request.edit_command.command_id,
        edit_graph_revision: request.edit_command.expected_graph_revision,
        fixture_id: request.fixture_id,
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
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
        preview_after: preview_after_path,
        preview_before: preview_before_path,
        report_id,
        sidecar_after: sidecar_after_path,
        source_raw,
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

fn basic_tone_adjustments(command: &RawOpenEditExportBasicToneCommand) -> Result<Value, String> {
    if command.command_type != "toneColor.setBasicTone" {
        return Err("editCommand.commandType must be toneColor.setBasicTone.".to_string());
    }
    if command.dry_run {
        return Err("editCommand must be an apply command, not a dry-run command.".to_string());
    }
    if command.approval.approval_class != "edit_apply" || command.approval.state != "approved" {
        return Err("editCommand requires approved edit_apply approval.".to_string());
    }

    Ok(json!({
        "blacks": command.parameters.black_point,
        "clarity": command.parameters.clarity,
        "contrast": command.parameters.contrast,
        "exposure": command.parameters.exposure_ev,
        "highlights": command.parameters.highlights,
        "saturation": command.parameters.saturation,
        "shadows": command.parameters.shadows,
        "whites": command.parameters.white_point,
    }))
}

fn build_sidecar_json(request: &RawOpenEditExportProofRequest, adjustments: &Value) -> Value {
    let metadata = ImageMetadata {
        adjustments: adjustments.clone(),
        ..Default::default()
    };
    let mut value = serde_json::to_value(metadata).unwrap_or_else(|_| json!({}));
    value["rawOpenEditExportProof"] = json!({
        "colorManagement": color_management_proof(&request.edit_command.color_pipeline),
        "editCommandId": request.edit_command.command_id,
        "editGraphRevision": request.edit_command.expected_graph_revision,
        "fixtureId": request.fixture_id,
        "trackingIssue": 1376
    });
    value
}

fn color_management_proof(
    pipeline: &RawOpenEditExportColorPipeline,
) -> RawOpenEditExportColorManagementProof {
    RawOpenEditExportColorManagementProof {
        chromatic_adaptation: pipeline.chromatic_adaptation.clone(),
        display_transform: RawOpenEditExportDisplayTransform {
            bit_depth: pipeline.render_target.bit_depth,
            embed_icc: pipeline.render_target.embed_icc,
            intent: pipeline.render_target.intent.clone(),
            output_profile: pipeline.render_target.output_profile.clone(),
            scene_to_display_transform: pipeline.scene_to_display_transform.clone(),
            view_transform: pipeline.render_target.view_transform.clone(),
        },
        does_not_prove: vec![
            "camera_profile_quality".to_string(),
            "capture_one_class_quality".to_string(),
            "display_device_visual_match".to_string(),
            "gpu_color_parity".to_string(),
            "icc_colorimetric_accuracy".to_string(),
        ],
        input_domain: pipeline.input_domain.clone(),
        operation_domain: pipeline.operation_domain.clone(),
        proof_level: "private_raw_runtime_color_management_metadata".to_string(),
        tracking_issue: 2308,
        working_space: pipeline.working_space.clone(),
    }
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
    Ok(artifact(
        kind,
        &hash_relative_path(private_root, relative_path)?,
    ))
}

fn hash_relative_path(
    private_root: &Path,
    relative_path: &str,
) -> Result<RawOpenEditExportProofHashedPath, String> {
    let path = resolve_private_relative(private_root, relative_path)?;
    Ok(hashed_path(relative_path.to_string(), sha256_file(&path)?))
}

fn hashed_path(path: String, hash: String) -> RawOpenEditExportProofHashedPath {
    RawOpenEditExportProofHashedPath {
        hash,
        path,
        public_repo_allowed: false,
    }
}

fn artifact(
    kind: &str,
    hashed_path: &RawOpenEditExportProofHashedPath,
) -> RawOpenEditExportProofArtifact {
    RawOpenEditExportProofArtifact {
        hash: hashed_path.hash.clone(),
        kind: kind.to_string(),
        path: hashed_path.path.clone(),
        public_repo_allowed: hashed_path.public_repo_allowed,
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

fn raw_open_edit_export_report_id(fixture_id: &str) -> String {
    format!(
        "raw-open-edit-export-run.{}",
        fixture_id
            .strip_prefix("validation.raw-open-edit-export.")
            .unwrap_or(fixture_id)
    )
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "tauri-test")]
    use std::fs;

    use image::{DynamicImage, Rgba, RgbaImage};
    use serde_json::json;
    #[cfg(feature = "tauri-test")]
    use tauri::Manager;

    #[cfg(feature = "tauri-test")]
    use crate::app_settings::AppSettings;
    #[cfg(feature = "tauri-test")]
    use crate::gpu_processing::get_or_init_compute_gpu_context_for_tests;

    use super::*;

    fn sample_basic_tone_command() -> RawOpenEditExportBasicToneCommand {
        RawOpenEditExportBasicToneCommand {
            approval: RawOpenEditExportBasicToneApproval {
                approval_class: "edit_apply".to_string(),
                state: "approved".to_string(),
            },
            color_pipeline: sample_color_pipeline(),
            command_id: "command.raw-open-edit-export.basic-tone.v1".to_string(),
            command_type: "toneColor.setBasicTone".to_string(),
            dry_run: false,
            expected_graph_revision: "graph-rev.open-edit-export.edge-ringing.v1".to_string(),
            parameters: RawOpenEditExportBasicToneParameters {
                black_point: -2.0,
                clarity: 4.0,
                contrast: 8.0,
                exposure_ev: 0.35,
                highlights: -12.0,
                saturation: 5.0,
                shadows: 9.0,
                white_point: 3.0,
            },
        }
    }

    fn sample_color_pipeline() -> RawOpenEditExportColorPipeline {
        RawOpenEditExportColorPipeline {
            chromatic_adaptation: RawOpenEditExportChromaticAdaptation {
                method: "bradford_v1".to_string(),
                source_white_point: RawOpenEditExportWhitePoint {
                    x: 0.3457,
                    y: 0.3585,
                },
                status: "math_validated".to_string(),
                target_white_point: RawOpenEditExportWhitePoint {
                    x: 0.32168,
                    y: 0.33767,
                },
            },
            input_domain: "camera_linear_rgb".to_string(),
            operation_domain: "acescg_linear_v1".to_string(),
            render_target: RawOpenEditExportRenderTarget {
                bit_depth: 16,
                embed_icc: true,
                intent: "relative_colorimetric".to_string(),
                output_profile: "display_p3".to_string(),
                view_transform: "rawengine_agx_v1".to_string(),
            },
            scene_to_display_transform: "rawengine_agx_v1".to_string(),
            working_space: "acescg_linear_v1".to_string(),
        }
    }

    #[test]
    fn private_paths_reject_absolute_and_traversal() {
        let root = Path::new("/tmp/rawengine-private-root");

        assert!(resolve_private_relative(root, "private-fixtures/sample.cr3").is_ok());
        assert!(resolve_private_relative(root, "/tmp/private-fixtures/sample.cr3").is_err());
        assert!(resolve_private_relative(root, "../private-fixtures/sample.cr3").is_err());
        assert!(resolve_private_relative(root, "private-fixtures/../sample.cr3").is_err());
    }

    #[test]
    fn pixel_metrics_detect_changed_pixels_and_mean_delta() {
        let before = RgbaImage::from_pixel(2, 1, Rgba([0, 0, 0, 255]));
        let mut after = before.clone();
        after.put_pixel(1, 0, Rgba([255, 0, 0, 255]));

        let before = DynamicImage::ImageRgba8(before);
        let after = DynamicImage::ImageRgba8(after);

        assert_eq!(changed_pixel_ratio(&before, &after), 0.5);
        assert_eq!(mean_abs_delta(&before, &after), 0.125);
    }

    #[test]
    fn sidecar_json_preserves_edit_graph_revision() {
        let request = RawOpenEditExportProofRequest {
            artifact_dir_relative: "private-artifacts/validation/open-edit-export".to_string(),
            edit_command: sample_basic_tone_command(),
            fixture_id: "validation.raw-open-edit-export.edge-ringing.v1".to_string(),
            private_root_path: "/tmp/rawengine-private-root".to_string(),
            source_relative_path: "private-fixtures/detail/edge-ringing-v1.cr3".to_string(),
        };
        let adjustments = basic_tone_adjustments(&request.edit_command).expect("basic tone maps");

        let sidecar = build_sidecar_json(&request, &adjustments);

        assert_eq!(sidecar["adjustments"]["exposure"], json!(0.35));
        assert_eq!(sidecar["adjustments"]["contrast"], json!(8.0));
        assert_eq!(
            sidecar["rawOpenEditExportProof"]["editGraphRevision"],
            json!("graph-rev.open-edit-export.edge-ringing.v1")
        );
        assert_eq!(
            sidecar["rawOpenEditExportProof"]["trackingIssue"],
            json!(1376)
        );
    }

    #[test]
    fn basic_tone_adjustments_require_approved_apply_command() {
        let valid = sample_basic_tone_command();
        assert_eq!(
            basic_tone_adjustments(&valid).expect("valid command maps")["whites"],
            json!(3.0)
        );

        let mut dry_run = sample_basic_tone_command();
        dry_run.dry_run = true;
        assert!(basic_tone_adjustments(&dry_run).is_err());

        let mut pending = sample_basic_tone_command();
        pending.approval.state = "pending".to_string();
        assert!(basic_tone_adjustments(&pending).is_err());
    }

    #[test]
    fn proof_report_serializes_run_report_schema_fields() {
        let asset = hashed_path(
            "private-artifacts/validation/open-edit-export/sample.png".to_string(),
            "sha256:0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        );
        let report = RawOpenEditExportProofReport {
            artifacts: vec![artifact("preview_before_private", &asset)],
            color_management: color_management_proof(&sample_color_pipeline()),
            edit_command_id: "command.raw-open-edit-export.basic-tone.v1".to_string(),
            edit_graph_revision: "graph-rev.raw-open-edit-export.sample.v1".to_string(),
            fixture_id: "validation.raw-open-edit-export.sample.v1".to_string(),
            generated_at: "2026-06-17T00:00:00Z".to_string(),
            metrics: Vec::new(),
            preview_after: asset.clone(),
            preview_before: asset.clone(),
            report_id: "raw-open-edit-export-run.sample.v1".to_string(),
            sidecar_after: asset.clone(),
            source_raw: asset,
            tracking_issue: 1376,
        };

        let value = serde_json::to_value(report).expect("report serializes");

        assert!(value.get("previewAfter").is_some());
        assert!(value.get("previewBefore").is_some());
        assert!(value.get("sidecarAfter").is_some());
        assert!(value.get("sourceRaw").is_some());
        assert!(value.get("sourceHashUnchanged").is_none());
    }

    #[test]
    fn fixture_ids_create_stable_run_report_slugs() {
        assert_eq!(
            slug_from_fixture_id("validation.raw-open-edit-export.edge-ringing.v1"),
            "edge-ringing-v1"
        );
        assert_eq!(
            raw_open_edit_export_report_id("validation.raw-open-edit-export.edge-ringing.v1"),
            "raw-open-edit-export-run.edge-ringing.v1"
        );
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn private_runtime_smoke_generates_raw_open_edit_export_report_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_RAW_OPEN_EDIT_EXPORT_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping private RAW open/edit/export proof smoke");
            return;
        }

        let mut request: RawOpenEditExportProofRequest = serde_json::from_str(
            &fs::read_to_string("../fixtures/validation/raw-open-edit-export-proof-request.json")
                .expect("proof request fixture reads"),
        )
        .expect("proof request fixture parses");
        if let Ok(private_root) = std::env::var("RAWENGINE_PRIVATE_RAW_ROOT") {
            request.private_root_path = private_root;
        }

        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");
        let settings = AppSettings::default();
        let report =
            run_raw_open_edit_export_proof_with_context(request, &state, &settings, &context)
                .expect("private RAW open/edit/export proof command runs");

        assert_eq!(report.tracking_issue, 1376);
        assert!(
            report
                .artifacts
                .iter()
                .any(|artifact| artifact.kind == "workflow_report_private")
        );
        assert!(
            report
                .metrics
                .iter()
                .any(|metric| metric.name == "changedPixelRatio"
                    && metric.passed
                    && metric.value > 0.0)
        );
        assert!(
            report
                .metrics
                .iter()
                .any(|metric| metric.name == "sourceHashUnchanged" && metric.passed)
        );
    }
}
