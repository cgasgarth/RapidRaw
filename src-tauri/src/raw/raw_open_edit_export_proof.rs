use std::fs;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use image::{
    ColorType, DynamicImage, ImageDecoder, ImageFormat, RgbImage, codecs::tiff::TiffDecoder,
};
use moxcms::ColorProfile;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::app_settings::{AppSettings, load_settings_or_default};
use crate::app_state::AppState;
use crate::color::view_transform::{
    ViewTransformPlanV1, ViewTransformReceiptV1, ViewTransformSettingsV1,
};
use crate::export::export_processing::{
    ExportColorProfile, ExportReceiptMetadata, ExportRenderingIntent, ExportSettings,
    export_jpeg_rgb_pixels_and_profile, export_soft_proof_rgb_pixels_and_profile_with_policy,
    process_image_for_export_pipeline_with_tonemapper_override, save_image_with_metadata,
};
use crate::formats::is_raw_file;
use crate::gamut_mapping::{ACTIVE_SRGB_OKLAB_CHROMA_REDUCE, map_srgb_oklab_chroma_reduce_v4};
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::{
    GpuContext, ImageMetadata, get_or_init_gpu_context, resolve_tonemapper_override,
};

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofRequest {
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    pub artifact_dir_relative: String,
    pub edit_command: RawOpenEditExportCommand,
    pub fixture_id: String,
    pub private_root_path: String,
    pub source_metadata: RawOpenEditExportSourceMetadata,
    pub source_relative_path: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportCommand {
    pub actor: Value,
    pub approval: RawOpenEditExportBasicToneApproval,
    pub color_pipeline: RawOpenEditExportColorPipeline,
    pub command_id: String,
    pub command_type: String,
    pub correlation_id: String,
    pub dry_run: bool,
    pub expected_graph_revision: String,
    pub idempotency_key: Option<String>,
    pub parameters: Value,
    pub schema_version: u32,
    pub target: Value,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportBasicToneApproval {
    pub approval_class: String,
    pub reason: String,
    pub state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportChromaticAdaptation {
    pub method: String,
    pub source_white_point: RawOpenEditExportWhitePoint,
    pub status: String,
    pub target_white_point: RawOpenEditExportWhitePoint,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportWhitePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportRenderTarget {
    pub bit_depth: u32,
    pub embed_icc: bool,
    pub intent: String,
    pub output_profile: String,
    pub view_transform: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportSourceMetadata {
    pub camera_make: String,
    pub camera_model: String,
    pub privacy_safe_camera_id: String,
    pub raw_format: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportBasicToneParameters {
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    pub black_point: f64,
    pub clarity: f64,
    pub contrast: f64,
    pub exposure_ev: f64,
    pub highlights: f64,
    pub saturation: f64,
    pub shadows: f64,
    pub white_point: f64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportWhiteBalanceParameters {
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    pub creative_temperature: f64,
    pub creative_tint: f64,
    pub duv: f64,
    pub exposure_ev: f64,
    pub kelvin: f64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportSelectiveColorParameters {
    pub band: String,
    pub hue_shift_degrees: f64,
    pub luminance: f64,
    pub saturation: f64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportSkinToneUniformityParameters {
    pub experimental: bool,
    pub hue_uniformity: f64,
    pub luminance_uniformity: f64,
    pub max_hue_shift_degrees: f64,
    pub saturation_uniformity: f64,
    pub target_hue_degrees: f64,
    pub target_luminance: f64,
    pub target_saturation: f64,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportColorManagementProof {
    pub conformance: String,
    pub decoder_trace: RawOpenEditExportDecoderTrace,
    pub does_not_prove: Vec<String>,
    pub observed_color_pipeline: RawOpenEditExportObservedColorPipeline,
    pub proof_level: String,
    pub requested_color_pipeline: RawOpenEditExportColorPipeline,
    pub runtime_environment: RawOpenEditExportRuntimeEnvironment,
    pub tracking_issue: u32,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportObservedColorPipeline {
    pub bit_depth: u32,
    pub cmm_used: bool,
    pub display_profile_correctness: String,
    pub export_color_encoding: String,
    pub export_format: String,
    pub gamut_mapping: String,
    pub icc_profile_embedded: bool,
    pub input_domain: String,
    pub operation_domain: String,
    pub output_profile: String,
    pub rendering_intent_applied: bool,
    pub scene_to_display_transform: String,
    pub transfer_status: String,
    pub view_transform: String,
    pub view_transform_receipt: Option<ViewTransformReceiptV1>,
    pub working_buffer: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportDecoderTrace {
    pub camera_calibration: RawOpenEditExportTraceStatus,
    pub camera_make: String,
    pub camera_model: String,
    pub decoded_dimensions: RawOpenEditExportDimensions,
    pub privacy_safe_camera_id: String,
    pub raw_format: String,
    pub source_hash: String,
    pub white_balance: RawOpenEditExportTraceStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportTraceStatus {
    pub applied: String,
    pub presence: String,
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportDimensions {
    pub height: u32,
    pub width: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportRuntimeEnvironment {
    pub wgpu_adapter: String,
    pub wgpu_backend: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportRenderPathProof {
    pub export_after_format: String,
    pub export_after_writer_id: String,
    pub soft_proof_after_format: String,
    pub soft_proof_after_writer_id: String,
    pub preview_after_format: String,
    pub preview_after_writer_id: String,
    pub preview_before_writer_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportFinalFileProof {
    pub bit_depth: u32,
    pub black_point_compensation: String,
    pub cmm: String,
    pub embedded_icc_profile_hash: String,
    pub expected_output_profile_hash: String,
    pub final_file_format: String,
    pub gps_stripped: bool,
    pub metadata_retained: bool,
    pub output_profile: String,
    pub pixel_max_abs_delta: f64,
    pub pixel_mean_abs_delta: f64,
    pub timestamps_preserved: bool,
    pub reopened_dimensions: RawOpenEditExportDimensions,
    pub transform_applied: bool,
    pub transform_policy_fingerprint: String,
    pub writer_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOpenEditExportProofReport {
    pub artifacts: Vec<RawOpenEditExportProofArtifact>,
    pub color_management: RawOpenEditExportColorManagementProof,
    pub edit_command_id: String,
    pub edit_graph_revision: String,
    pub fixture_id: String,
    pub final_file: RawOpenEditExportFinalFileProof,
    pub generated_at: String,
    pub metrics: Vec<RawOpenEditExportProofMetric>,
    pub preview_after: RawOpenEditExportProofHashedPath,
    pub preview_before: RawOpenEditExportProofHashedPath,
    pub render_paths: RawOpenEditExportRenderPathProof,
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
    let adjustments = edit_command_adjustments(&request.edit_command)?;

    let source_hash_before = sha256_file(&source_path)?;
    let source_bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    let source_path_string = source_path.to_string_lossy().to_string();
    let base_image =
        load_base_image_from_bytes(&source_bytes, &source_path_string, false, settings, None)
            .map_err(|error| error.to_string())?;

    let empty_adjustments = json!({});
    let is_raw = is_raw_file(&source_path_string);
    let tm_override = tonemapper_override_for_proof(&request.edit_command.color_pipeline)
        .or_else(|| resolve_tonemapper_override(settings, is_raw));
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
    let export_color_profile =
        export_color_profile_for_proof(&request.edit_command.color_pipeline.render_target)?;
    let export_rendering_intent =
        export_rendering_intent_for_proof(&request.edit_command.color_pipeline.render_target)?;
    let (soft_proof_after_pixels, soft_proof_after_width, soft_proof_after_height, _) =
        export_soft_proof_rgb_pixels_and_profile_with_policy(
            &preview_after,
            &export_color_profile,
            &export_rendering_intent,
            true,
        )?;
    let (export_rgb8_pixels, export_rgb8_width, export_rgb8_height, _) =
        export_jpeg_rgb_pixels_and_profile(
            &preview_after,
            &export_color_profile,
            &export_rendering_intent,
            true,
        )?;
    if (soft_proof_after_width, soft_proof_after_height) != (export_rgb8_width, export_rgb8_height)
    {
        return Err("soft proof and export transform dimensions diverged.".to_string());
    }
    let soft_proof_export_rgb8_mean_abs_delta =
        mean_abs_delta_rgb8(&soft_proof_after_pixels, &export_rgb8_pixels)?;

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
    let soft_proof_after_relative = format!(
        "{}/{}-soft-proof-after.png",
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
    let export_settings = ExportSettings {
        black_point_compensation: true,
        color_profile: export_color_profile.clone(),
        rendering_intent: export_rendering_intent.clone(),
        jpeg_quality: 95,
        resize: None,
        keep_metadata: true,
        preserve_timestamps: true,
        strip_gps: true,
        filename_template: None,
        watermark: None,
        export_masks: false,
        output_sharpening: None,
        preserve_folders: false,
    };
    let export_after_path = resolve_private_relative(&private_root, &export_after_relative)?;
    let export_receipt = save_image_with_metadata(
        &export_after,
        &export_after_path,
        &source_path_string,
        &export_settings,
    )?
    .ok_or_else(|| "final TIFF export must include color policy receipt metadata.".to_string())?;
    write_rgb8_image(
        &private_root,
        &soft_proof_after_relative,
        soft_proof_after_pixels.clone(),
        soft_proof_after_width,
        soft_proof_after_height,
        ImageFormat::Png,
    )?;

    let sidecar_path = resolve_private_relative(&private_root, &sidecar_after_relative)?;
    let color_management =
        color_management_proof(&request, &source_hash_before, &base_image, &export_receipt);
    let sidecar_json = build_sidecar_json(&request, &adjustments, &color_management);
    fs::write(
        &sidecar_path,
        serde_json::to_vec_pretty(&sidecar_json).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let changed_pixel_ratio = changed_pixel_ratio(&preview_before, &preview_after);
    let preview_export_mean_abs_delta = mean_abs_delta(&preview_after, &export_after);
    let gamut_coverage = gamut_mapping_coverage_metrics(
        &export_after,
        &export_color_profile,
        &export_rendering_intent,
    );
    let final_file = inspect_final_tiff_export(
        &export_after_path,
        &export_color_profile,
        &export_settings,
        &export_receipt,
        &soft_proof_after_pixels,
        soft_proof_after_width,
        soft_proof_after_height,
    )?;
    let black_point_policy_handled = final_file.black_point_compensation
        == "Enabled via LittleCMS relative colorimetric transform"
        || final_file.black_point_compensation == "Requested but disabled for this export path";
    let color_engine_handled = final_file.cmm == "lcms2" || final_file.cmm == "moxcms";
    let final_file_transform_expected = final_file_transform_expected_for_proof(
        &export_color_profile,
        &export_rendering_intent,
        final_file.transform_applied,
    );
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
        hashed_artifact(
            &private_root,
            "soft_proof_after_private",
            &soft_proof_after_relative,
        )?,
        artifact("sidecar_after_private", &sidecar_after_path),
    ];

    let report_id = raw_open_edit_export_report_id(&request.fixture_id);
    let mut report = RawOpenEditExportProofReport {
        artifacts: Vec::new(),
        color_management,
        edit_command_id: request.edit_command.command_id,
        edit_graph_revision: request.edit_command.expected_graph_revision,
        fixture_id: request.fixture_id,
        final_file: final_file.clone(),
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
                "softProofExportRgb8MeanAbsDelta",
                soft_proof_export_rgb8_mean_abs_delta,
                0.0,
                soft_proof_export_rgb8_mean_abs_delta == 0.0,
            ),
            metric(
                "gamutMapperInputPixelRatio",
                gamut_coverage.input_pixel_ratio,
                0.0,
                !gamut_coverage.mapper_expected || gamut_coverage.input_pixel_ratio > 0.0,
            ),
            metric(
                "gamutMapperChangedPixelRatio",
                gamut_coverage.changed_pixel_ratio,
                0.0,
                !gamut_coverage.mapper_expected || gamut_coverage.changed_pixel_ratio > 0.0,
            ),
            metric(
                "gamutPreMapOutOfGamutPixelRatio",
                gamut_coverage.pre_map_out_of_gamut_pixel_ratio,
                0.0,
                !gamut_coverage.mapper_expected
                    || gamut_coverage.pre_map_out_of_gamut_pixel_ratio > 0.0,
            ),
            metric(
                "gamutPreMapOutOfGamutChannelRatio",
                gamut_coverage.pre_map_out_of_gamut_channel_ratio,
                0.0,
                !gamut_coverage.mapper_expected
                    || gamut_coverage.pre_map_out_of_gamut_channel_ratio > 0.0,
            ),
            metric(
                "gamutPostMapOutOfGamutPixelRatio",
                gamut_coverage.post_map_out_of_gamut_pixel_ratio,
                0.0,
                gamut_coverage.post_map_out_of_gamut_pixel_ratio == 0.0,
            ),
            metric(
                "gamutPreMapMinLinearRgb",
                gamut_coverage.pre_map_min_linear_rgb,
                0.0,
                true,
            ),
            metric(
                "gamutPreMapMaxLinearRgb",
                gamut_coverage.pre_map_max_linear_rgb,
                1.0,
                true,
            ),
            metric("finalFileReopenSucceeded", 1.0, 1.0, true),
            metric(
                "finalFileBitDepth",
                final_file.bit_depth as f64,
                16.0,
                final_file.bit_depth == 16,
            ),
            metric("finalFileIccProfileEmbedded", 1.0, 1.0, true),
            metric(
                "finalFileMetadataRetained",
                if final_file.metadata_retained {
                    1.0
                } else {
                    0.0
                },
                1.0,
                final_file.metadata_retained,
            ),
            metric(
                "finalFileTimestampsPreserved",
                if final_file.timestamps_preserved {
                    1.0
                } else {
                    0.0
                },
                1.0,
                final_file.timestamps_preserved,
            ),
            metric(
                "finalFileGpsStripped",
                if final_file.gps_stripped { 1.0 } else { 0.0 },
                1.0,
                final_file.gps_stripped,
            ),
            metric(
                "finalFileBlackPointCompensationApplied",
                if black_point_policy_handled { 1.0 } else { 0.0 },
                1.0,
                black_point_policy_handled,
            ),
            metric(
                "finalFileColorEngineLcms2",
                if color_engine_handled { 1.0 } else { 0.0 },
                1.0,
                color_engine_handled,
            ),
            metric(
                "finalFileTransformApplied",
                if final_file.transform_applied {
                    1.0
                } else {
                    0.0
                },
                final_file_transform_expected.threshold,
                final_file_transform_expected.passed,
            ),
            metric(
                "finalFileSoftProofRgb8MeanAbsDelta",
                final_file.pixel_mean_abs_delta,
                0.0,
                final_file.pixel_mean_abs_delta == 0.0,
            ),
            metric(
                "finalFileSoftProofRgb8MaxAbsDelta",
                final_file.pixel_max_abs_delta,
                0.0,
                final_file.pixel_max_abs_delta == 0.0,
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
        render_paths: RawOpenEditExportRenderPathProof {
            export_after_format: "tiff".to_string(),
            export_after_writer_id: "export_processing::save_image_with_metadata".to_string(),
            soft_proof_after_format: "png".to_string(),
            soft_proof_after_writer_id: "raw_open_edit_export_soft_proof_after".to_string(),
            preview_after_format: "png".to_string(),
            preview_after_writer_id: "raw_open_edit_export_preview_after".to_string(),
            preview_before_writer_id: "raw_open_edit_export_preview_before".to_string(),
        },
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

fn inspect_final_tiff_export(
    output_path: &Path,
    color_profile: &ExportColorProfile,
    export_settings: &ExportSettings,
    color_receipt: &crate::export::export_processing::ExportReceiptMetadata,
    expected_rgb8: &[u8],
    expected_width: u32,
    expected_height: u32,
) -> Result<RawOpenEditExportFinalFileProof, String> {
    let bytes = fs::read(output_path).map_err(|error| error.to_string())?;
    let mut decoder =
        TiffDecoder::new(Cursor::new(bytes.as_slice())).map_err(|error| error.to_string())?;
    let bit_depth = match decoder.color_type() {
        ColorType::Rgb16 => 16,
        other => return Err(format!("final TIFF must reopen as RGB16, got {other:?}")),
    };
    let embedded_icc = decoder
        .icc_profile()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "final TIFF export must embed an ICC profile".to_string())?;
    let expected_icc = expected_output_profile_bytes(color_profile)?;
    let reopened = image::load_from_memory_with_format(&bytes, ImageFormat::Tiff)
        .map_err(|error| error.to_string())?
        .to_rgb16();
    let (width, height) = reopened.dimensions();
    if (width, height) != (expected_width, expected_height) {
        return Err(format!(
            "final TIFF dimensions {width}x{height} diverged from soft proof {expected_width}x{expected_height}"
        ));
    }
    let reopened_rgb8 = quantize_rgb16_to_rgb8(reopened.as_raw());
    let pixel_mean_abs_delta = mean_abs_delta_rgb8(&reopened_rgb8, expected_rgb8)?;
    let pixel_max_abs_delta = max_abs_delta_rgb8(&reopened_rgb8, expected_rgb8)?;

    Ok(RawOpenEditExportFinalFileProof {
        bit_depth,
        black_point_compensation: color_receipt.black_point_compensation.clone(),
        cmm: color_receipt.cmm.clone(),
        embedded_icc_profile_hash: sha256_bytes(&embedded_icc),
        expected_output_profile_hash: sha256_bytes(&expected_icc),
        final_file_format: "tiff".to_string(),
        gps_stripped: export_settings.strip_gps,
        metadata_retained: export_settings.keep_metadata,
        output_profile: export_color_profile_label(color_profile).to_string(),
        pixel_max_abs_delta,
        pixel_mean_abs_delta,
        timestamps_preserved: export_settings.preserve_timestamps,
        reopened_dimensions: RawOpenEditExportDimensions { height, width },
        transform_applied: color_receipt.transform_applied,
        transform_policy_fingerprint: color_receipt.transform_policy_fingerprint.clone(),
        writer_id: "export_processing::save_image_with_metadata".to_string(),
    })
}

fn expected_output_profile_bytes(color_profile: &ExportColorProfile) -> Result<Vec<u8>, String> {
    let profile = match color_profile {
        ExportColorProfile::DisplayP3 => ColorProfile::new_display_p3(),
        ExportColorProfile::Srgb => ColorProfile::new_srgb(),
        ExportColorProfile::AdobeRgb1998
        | ExportColorProfile::ProPhotoRgb
        | ExportColorProfile::SourceEmbedded => {
            return Err("unsupported profile cannot be used for final-file proof".to_string());
        }
    };

    profile
        .encode()
        .map_err(|error| format!("failed to encode expected output ICC profile: {error}"))
}

fn export_color_profile_label(color_profile: &ExportColorProfile) -> &'static str {
    match color_profile {
        ExportColorProfile::DisplayP3 => "display_p3",
        ExportColorProfile::Srgb => "srgb",
        ExportColorProfile::AdobeRgb1998 => "adobe_rgb_1998",
        ExportColorProfile::ProPhotoRgb => "prophoto_rgb",
        ExportColorProfile::SourceEmbedded => "source_embedded",
    }
}

fn edit_command_adjustments(command: &RawOpenEditExportCommand) -> Result<Value, String> {
    if command.dry_run {
        return Err("editCommand must be an apply command, not a dry-run command.".to_string());
    }
    if command.approval.approval_class != "edit_apply" || command.approval.state != "approved" {
        return Err("editCommand requires approved edit_apply approval.".to_string());
    }

    match command.command_type.as_str() {
        "toneColor.setBasicTone" => basic_tone_adjustments(&command.parameters),
        "toneColor.setWhiteBalance" => white_balance_adjustments(&command.parameters),
        "toneColor.adjustHsl" => selective_color_adjustments(&command.parameters),
        "toneColor.adjustSkinToneUniformity" => {
            skin_tone_uniformity_adjustments(&command.parameters)
        }
        _ => Err(
            "editCommand.commandType must be toneColor.setBasicTone, toneColor.setWhiteBalance, toneColor.adjustHsl, or toneColor.adjustSkinToneUniformity.".to_string(),
        ),
    }
}

fn white_balance_adjustments(parameters: &Value) -> Result<Value, String> {
    let parameters: RawOpenEditExportWhiteBalanceParameters =
        serde_json::from_value(parameters.clone()).map_err(|error| error.to_string())?;
    if parameters.accepted_dry_run_plan_hash.trim().is_empty()
        || parameters.accepted_dry_run_plan_id.trim().is_empty()
    {
        return Err(
            "editCommand.parameters accepted dry-run plan identity is required.".to_string(),
        );
    }
    let coordinates =
        crate::color::white_balance::cct_duv_to_coordinates(parameters.kelvin, parameters.duv)
            .map_err(|error| error.to_string())?;
    Ok(json!({
        "creativeTemperature": parameters.creative_temperature,
        "creativeTint": parameters.creative_tint,
        "exposure": parameters.exposure_ev,
        "temperature": 0.0,
        "tint": 0.0,
        "whiteBalanceMigration": "native_v1",
        "whiteBalanceTechnical": {
            "contract": crate::color::white_balance::WHITE_BALANCE_CONTRACT,
            "mode": "kelvin_tint",
            "kelvin": coordinates.cct_kelvin,
            "duv": coordinates.duv,
            "x": coordinates.xy[0],
            "y": coordinates.xy[1],
            "adaptation": "cat16_v1",
            "source": "user",
            "confidence": null,
            "sampleCount": null
        }
    }))
}

fn basic_tone_adjustments(parameters: &Value) -> Result<Value, String> {
    let parameters: RawOpenEditExportBasicToneParameters =
        serde_json::from_value(parameters.clone()).map_err(|error| error.to_string())?;

    if parameters.accepted_dry_run_plan_hash.trim().is_empty()
        || parameters.accepted_dry_run_plan_id.trim().is_empty()
    {
        return Err(
            "editCommand.parameters accepted dry-run plan identity is required.".to_string(),
        );
    }

    Ok(json!({
        "blacks": parameters.black_point,
        "clarity": parameters.clarity,
        "contrast": parameters.contrast,
        "exposure": parameters.exposure_ev,
        "highlights": parameters.highlights,
        "saturation": parameters.saturation,
        "shadows": parameters.shadows,
        "whites": parameters.white_point,
    }))
}

fn selective_color_adjustments(parameters: &Value) -> Result<Value, String> {
    let parameters: RawOpenEditExportSelectiveColorParameters =
        serde_json::from_value(parameters.clone()).map_err(|error| error.to_string())?;
    let range_key = match parameters.band.as_str() {
        "red" => "reds",
        "orange" => "oranges",
        "yellow" => "yellows",
        "green" => "greens",
        "aqua" => "aquas",
        "blue" => "blues",
        "purple" => "purples",
        "magenta" => "magentas",
        _ => return Err("editCommand.parameters.band is not a supported HSL band.".to_string()),
    };

    Ok(json!({
        "hsl": {
            range_key: {
                "hue": parameters.hue_shift_degrees,
                "luminance": parameters.luminance,
                "saturation": parameters.saturation,
            }
        }
    }))
}

fn skin_tone_uniformity_adjustments(parameters: &Value) -> Result<Value, String> {
    let parameters: RawOpenEditExportSkinToneUniformityParameters =
        serde_json::from_value(parameters.clone()).map_err(|error| error.to_string())?;
    if !parameters.experimental {
        return Err("skinToneUniformity.experimental must be true.".to_string());
    }
    let preview_hue_shift = (parameters.target_hue_degrees - 18.0).clamp(
        -parameters.max_hue_shift_degrees,
        parameters.max_hue_shift_degrees,
    ) * parameters.hue_uniformity;
    let preview_saturation =
        (parameters.target_saturation - 0.45) * 100.0 * parameters.saturation_uniformity;
    let preview_luminance =
        (parameters.target_luminance - 0.5) * 100.0 * parameters.luminance_uniformity;

    Ok(json!({
        "hsl": {
            "oranges": {
                "hue": preview_hue_shift,
                "luminance": preview_luminance,
                "saturation": preview_saturation,
            }
        },
        "skinToneUniformity": {
            "experimental": parameters.experimental,
            "hueUniformity": parameters.hue_uniformity,
            "luminanceUniformity": parameters.luminance_uniformity,
            "maxHueShiftDegrees": parameters.max_hue_shift_degrees,
            "saturationUniformity": parameters.saturation_uniformity,
            "targetHueDegrees": parameters.target_hue_degrees,
            "targetLuminance": parameters.target_luminance,
            "targetSaturation": parameters.target_saturation,
        }
    }))
}

fn build_sidecar_json(
    request: &RawOpenEditExportProofRequest,
    adjustments: &Value,
    color_management: &RawOpenEditExportColorManagementProof,
) -> Value {
    let metadata = ImageMetadata {
        adjustments: adjustments.clone(),
        ..Default::default()
    };
    let mut value = serde_json::to_value(metadata).unwrap_or_else(|_| json!({}));
    value["rawOpenEditExportProof"] = json!({
        "colorManagement": color_management,
        "editCommandId": request.edit_command.command_id,
        "editGraphRevision": request.edit_command.expected_graph_revision,
        "fixtureId": request.fixture_id,
        "trackingIssue": 1376
    });
    value
}

fn color_management_proof(
    request: &RawOpenEditExportProofRequest,
    source_hash: &str,
    decoded_image: &DynamicImage,
    color_receipt: &ExportReceiptMetadata,
) -> RawOpenEditExportColorManagementProof {
    let pipeline = &request.edit_command.color_pipeline;
    let display_profile_correctness = display_preview_profile_correctness();
    let output_profile = export_color_profile_label_for_render_target(&pipeline.render_target);
    let output_encoding = format!("{output_profile}_rgb16_tiff");
    let gamut_mapping = if color_receipt
        .color_managed_transform
        .contains(ACTIVE_SRGB_OKLAB_CHROMA_REDUCE)
    {
        ACTIVE_SRGB_OKLAB_CHROMA_REDUCE.to_string()
    } else {
        "not_proven".to_string()
    };
    let view_transform_receipt = (tonemapper_override_for_proof(pipeline) == Some(2))
        .then(|| ViewTransformPlanV1::compile(ViewTransformSettingsV1::default()))
        .transpose()
        .ok()
        .flatten()
        .map(ViewTransformPlanV1::receipt);
    RawOpenEditExportColorManagementProof {
        conformance: "partial".to_string(),
        decoder_trace: RawOpenEditExportDecoderTrace {
            camera_calibration: trace_status_not_surfaced(),
            camera_make: request.source_metadata.camera_make.clone(),
            camera_model: request.source_metadata.camera_model.clone(),
            decoded_dimensions: RawOpenEditExportDimensions {
                height: decoded_image.height(),
                width: decoded_image.width(),
            },
            privacy_safe_camera_id: request.source_metadata.privacy_safe_camera_id.clone(),
            raw_format: request.source_metadata.raw_format.clone(),
            source_hash: source_hash.to_string(),
            white_balance: trace_status_not_surfaced(),
        },
        does_not_prove: vec![
            "acescg_working_space".to_string(),
            "bradford_chromatic_adaptation".to_string(),
            "camera_profile_quality".to_string(),
            "capture_one_class_quality".to_string(),
            "display_device_visual_match".to_string(),
            "gpu_color_parity".to_string(),
            "icc_colorimetric_accuracy".to_string(),
        ],
        observed_color_pipeline: RawOpenEditExportObservedColorPipeline {
            bit_depth: 16,
            cmm_used: true,
            display_profile_correctness,
            export_color_encoding: output_encoding,
            export_format: "tiff".to_string(),
            gamut_mapping,
            icc_profile_embedded: true,
            input_domain: "decoder_camera_rgb_observed".to_string(),
            operation_domain: "linear_srgb_d65_observed".to_string(),
            output_profile,
            rendering_intent_applied: true,
            scene_to_display_transform: pipeline.scene_to_display_transform.clone(),
            transfer_status: color_receipt.color_managed_transform.clone(),
            view_transform: pipeline.render_target.view_transform.clone(),
            view_transform_receipt,
            working_buffer: "linear_srgb_d65_observed".to_string(),
        },
        proof_level: "private_raw_runtime_color_management_metadata".to_string(),
        requested_color_pipeline: pipeline.clone(),
        runtime_environment: RawOpenEditExportRuntimeEnvironment {
            wgpu_adapter: "not_surfaced_by_current_proof".to_string(),
            wgpu_backend: "not_surfaced_by_current_proof".to_string(),
        },
        tracking_issue: 2308,
        warnings: vec![
            "Final TIFF proof verifies Display P3 ICC embedding and RGB16 file reopen, but not full chart-based colorimetric accuracy.".to_string(),
            "Black-point compensation is proven as an applied LittleCMS export policy, not as a full print-match or chart-based colorimetric result.".to_string(),
            "Decoder calibration and white-balance metadata are not surfaced by this proof trace yet.".to_string(),
            "WGPU adapter/backend are not surfaced by this proof trace yet.".to_string(),
        ],
    }
}

fn export_color_profile_label_for_render_target(
    render_target: &RawOpenEditExportRenderTarget,
) -> String {
    match render_target.output_profile.as_str() {
        "adobe_rgb_1998" => "adobe_rgb_1998",
        "display_p3" => "display_p3",
        "prophoto_rgb" => "prophoto_rgb",
        "source_embedded" => "source_embedded",
        "srgb" => "srgb",
        other => other,
    }
    .to_string()
}

fn display_preview_profile_correctness() -> String {
    let Ok(lut) = crate::display_profile::display_preview_lut_status() else {
        return "not_proven".to_string();
    };
    let status = serde_json::to_value(lut.status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string));
    if status.as_deref() == Some("active_display_transform")
        && lut.sample_count > 0
        && lut.profile.icc_sha256.is_some()
    {
        return "active_display_lut_profile_loaded".to_string();
    }
    "not_proven".to_string()
}

fn trace_status_not_surfaced() -> RawOpenEditExportTraceStatus {
    RawOpenEditExportTraceStatus {
        applied: "not_surfaced_by_current_decoder_trace".to_string(),
        presence: "not_surfaced_by_current_decoder_trace".to_string(),
        source: "raw_open_edit_export_validation_spine".to_string(),
    }
}

fn tonemapper_override_for_proof(pipeline: &RawOpenEditExportColorPipeline) -> Option<u32> {
    match (
        pipeline.scene_to_display_transform.as_str(),
        pipeline.render_target.view_transform.as_str(),
    ) {
        ("rawengine_agx_v1", "rawengine_agx_v1") => Some(1),
        ("rawengine_rapid_view_v1", "rawengine_rapid_view_v1") => Some(2),
        _ => None,
    }
}

fn export_color_profile_for_proof(
    render_target: &RawOpenEditExportRenderTarget,
) -> Result<ExportColorProfile, String> {
    match render_target.output_profile.as_str() {
        "adobe_rgb_1998" => Ok(ExportColorProfile::AdobeRgb1998),
        "display_p3" => Ok(ExportColorProfile::DisplayP3),
        "prophoto_rgb" => Ok(ExportColorProfile::ProPhotoRgb),
        "source_embedded" => Ok(ExportColorProfile::SourceEmbedded),
        "srgb" => Ok(ExportColorProfile::Srgb),
        _ => Err(format!(
            "Unsupported soft-proof output profile {}.",
            render_target.output_profile
        )),
    }
}

fn export_rendering_intent_for_proof(
    render_target: &RawOpenEditExportRenderTarget,
) -> Result<ExportRenderingIntent, String> {
    match render_target.intent.as_str() {
        "absolute_colorimetric" => Ok(ExportRenderingIntent::AbsoluteColorimetric),
        "perceptual" => Ok(ExportRenderingIntent::Perceptual),
        "relative_colorimetric" => Ok(ExportRenderingIntent::RelativeColorimetric),
        "saturation" => Ok(ExportRenderingIntent::Saturation),
        _ => Err(format!(
            "Unsupported soft-proof rendering intent {}.",
            render_target.intent
        )),
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
    let encodable_image = if matches!(format, ImageFormat::Png)
        && matches!(
            image,
            DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_)
        ) {
        DynamicImage::ImageRgba16(image.to_rgba16())
    } else {
        image.clone()
    };
    encodable_image
        .save_with_format(path, format)
        .map_err(|error| error.to_string())
}

fn write_rgb8_image(
    private_root: &Path,
    relative_path: &str,
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    format: ImageFormat,
) -> Result<(), String> {
    let image = RgbImage::from_raw(width, height, pixels)
        .map(DynamicImage::ImageRgb8)
        .ok_or_else(|| "soft-proof RGB8 buffer dimensions are invalid.".to_string())?;
    write_image(private_root, relative_path, &image, format)
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
    Ok(sha256_bytes(&bytes))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
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

struct ProofMetricExpectation {
    passed: bool,
    threshold: f64,
}

fn final_file_transform_expected_for_proof(
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    transform_applied: bool,
) -> ProofMetricExpectation {
    let expected_value = if matches!(color_profile, ExportColorProfile::Srgb)
        && matches!(
            rendering_intent,
            ExportRenderingIntent::RelativeColorimetric
        ) {
        0.0
    } else {
        1.0
    };
    let actual_value = if transform_applied { 1.0 } else { 0.0 };
    ProofMetricExpectation {
        passed: actual_value == expected_value,
        threshold: expected_value,
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

struct GamutMappingCoverageMetrics {
    changed_pixel_ratio: f64,
    input_pixel_ratio: f64,
    mapper_expected: bool,
    post_map_out_of_gamut_pixel_ratio: f64,
    pre_map_max_linear_rgb: f64,
    pre_map_min_linear_rgb: f64,
    pre_map_out_of_gamut_channel_ratio: f64,
    pre_map_out_of_gamut_pixel_ratio: f64,
}

fn gamut_mapping_coverage_metrics(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> GamutMappingCoverageMetrics {
    let mapper_expected = matches!(color_profile, ExportColorProfile::Srgb)
        && matches!(rendering_intent, ExportRenderingIntent::Perceptual);
    let mut total_pixels = 0_u64;
    let mut pre_map_out_of_gamut_pixels = 0_u64;
    let mut pre_map_out_of_gamut_channels = 0_u64;
    let mut changed_pixels = 0_u64;
    let mut post_map_out_of_gamut_pixels = 0_u64;
    let mut pre_map_min_linear_rgb = f64::INFINITY;
    let mut pre_map_max_linear_rgb = f64::NEG_INFINITY;

    for rgb in dynamic_image_rgb32f_pixels(image) {
        total_pixels += 1;
        let mut pre_pixel_out_of_gamut = false;
        for component in rgb {
            let value = f64::from(component);
            pre_map_min_linear_rgb = pre_map_min_linear_rgb.min(value);
            pre_map_max_linear_rgb = pre_map_max_linear_rgb.max(value);
            if !component.is_finite() || !(0.0..=1.0).contains(&component) {
                pre_pixel_out_of_gamut = true;
                pre_map_out_of_gamut_channels += 1;
            }
        }
        if pre_pixel_out_of_gamut {
            pre_map_out_of_gamut_pixels += 1;
        }

        let mapped = if mapper_expected {
            map_srgb_oklab_chroma_reduce_v4(rgb)
        } else {
            rgb.map(|component| component.clamp(0.0, 1.0))
        };
        if rgb
            .iter()
            .zip(mapped.iter())
            .any(|(before, after)| (*before - *after).abs() > 1.0e-6)
        {
            changed_pixels += 1;
        }
        if mapped
            .iter()
            .any(|component| !component.is_finite() || !(0.0..=1.0).contains(component))
        {
            post_map_out_of_gamut_pixels += 1;
        }
    }

    if total_pixels == 0 {
        return GamutMappingCoverageMetrics {
            changed_pixel_ratio: 0.0,
            input_pixel_ratio: 0.0,
            mapper_expected,
            post_map_out_of_gamut_pixel_ratio: 0.0,
            pre_map_max_linear_rgb: 0.0,
            pre_map_min_linear_rgb: 0.0,
            pre_map_out_of_gamut_channel_ratio: 0.0,
            pre_map_out_of_gamut_pixel_ratio: 0.0,
        };
    }

    GamutMappingCoverageMetrics {
        changed_pixel_ratio: changed_pixels as f64 / total_pixels as f64,
        input_pixel_ratio: if mapper_expected { 1.0 } else { 0.0 },
        mapper_expected,
        post_map_out_of_gamut_pixel_ratio: post_map_out_of_gamut_pixels as f64
            / total_pixels as f64,
        pre_map_max_linear_rgb,
        pre_map_min_linear_rgb,
        pre_map_out_of_gamut_channel_ratio: pre_map_out_of_gamut_channels as f64
            / (total_pixels * 3) as f64,
        pre_map_out_of_gamut_pixel_ratio: pre_map_out_of_gamut_pixels as f64 / total_pixels as f64,
    }
}

fn dynamic_image_rgb32f_pixels(image: &DynamicImage) -> Vec<[f32; 3]> {
    match image {
        DynamicImage::ImageRgb32F(buffer) => buffer
            .as_raw()
            .chunks_exact(3)
            .map(|pixel| [pixel[0], pixel[1], pixel[2]])
            .collect(),
        DynamicImage::ImageRgba32F(buffer) => buffer
            .as_raw()
            .chunks_exact(4)
            .map(|pixel| [pixel[0], pixel[1], pixel[2]])
            .collect(),
        _ => {
            let buffer = image.to_rgb32f();
            buffer
                .as_raw()
                .chunks_exact(3)
                .map(|pixel| [pixel[0], pixel[1], pixel[2]])
                .collect()
        }
    }
}

fn mean_abs_delta_rgb8(first: &[u8], second: &[u8]) -> Result<f64, String> {
    if first.len() != second.len() {
        return Err("soft proof and export transform byte lengths diverged.".to_string());
    }
    if first.is_empty() {
        return Ok(0.0);
    }

    let total = first
        .iter()
        .zip(second.iter())
        .map(|(first_byte, second_byte)| f64::from(first_byte.abs_diff(*second_byte)) / 255.0)
        .sum::<f64>();

    Ok(total / first.len() as f64)
}

fn max_abs_delta_rgb8(first: &[u8], second: &[u8]) -> Result<f64, String> {
    if first.len() != second.len() {
        return Err("soft proof and final export byte lengths diverged.".to_string());
    }

    Ok(first
        .iter()
        .zip(second.iter())
        .map(|(first_byte, second_byte)| f64::from(first_byte.abs_diff(*second_byte)) / 255.0)
        .fold(0.0, f64::max))
}

fn quantize_rgb16_to_rgb8(pixels: &[u16]) -> Vec<u8> {
    pixels
        .iter()
        .map(|value| (((*value as u32) + 128) / 257) as u8)
        .collect()
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

    fn sample_basic_tone_command() -> RawOpenEditExportCommand {
        RawOpenEditExportCommand {
            actor: json!({
                "id": "agent.raw-proof-command-wrapper",
                "kind": "agent",
                "sessionId": "raw-proof-command-wrapper"
            }),
            approval: RawOpenEditExportBasicToneApproval {
                approval_class: "edit_apply".to_string(),
                reason: "Apply accepted basic tone command for RAW open/edit/export runtime proof."
                    .to_string(),
                state: "approved".to_string(),
            },
            color_pipeline: sample_color_pipeline(),
            command_id: "command.raw-open-edit-export.basic-tone.v1".to_string(),
            command_type: "toneColor.setBasicTone".to_string(),
            correlation_id: "corr.raw-open-edit-export.basic-tone.v1".to_string(),
            dry_run: false,
            expected_graph_revision: "graph-rev.open-edit-export.edge-ringing.v1".to_string(),
            idempotency_key: Some("idem.raw-open-edit-export.edge-ringing.v1".to_string()),
            parameters: json!({
                "acceptedDryRunPlanHash": "sha256:raw-open-edit-export-basic-tone-accepted-plan-v1",
                "acceptedDryRunPlanId": "dryrun_raw_open_edit_export_basic_tone_v1",
                "blackPoint": -2.0,
                "clarity": 4.0,
                "contrast": 8.0,
                "exposureEv": 0.35,
                "highlights": -12.0,
                "saturation": 5.0,
                "shadows": 9.0,
                "whitePoint": 3.0,
            }),
            schema_version: 1,
            target: json!({
                "imagePath": "private-fixtures/detail/edge-ringing-v1.cr3",
                "kind": "image"
            }),
        }
    }

    fn sample_selective_color_command() -> RawOpenEditExportCommand {
        RawOpenEditExportCommand {
            actor: json!({
                "id": "agent.selective-color-proof-wrapper",
                "kind": "agent",
                "sessionId": "selective-color-proof-wrapper"
            }),
            approval: RawOpenEditExportBasicToneApproval {
                approval_class: "edit_apply".to_string(),
                reason: "Apply accepted orange selective color command for RAW preview/export parity proof."
                    .to_string(),
                state: "approved".to_string(),
            },
            color_pipeline: sample_color_pipeline(),
            command_id: "command.raw-open-edit-export.selective-color-orange.v1".to_string(),
            command_type: "toneColor.adjustHsl".to_string(),
            correlation_id: "corr.raw-open-edit-export.selective-color-orange.v1".to_string(),
            dry_run: false,
            expected_graph_revision: "graph-rev.open-edit-export.selective-color-orange.v1"
                .to_string(),
            idempotency_key: Some(
                "idem.raw-open-edit-export.selective-color-orange.v1".to_string(),
            ),
            parameters: json!({
                "band": "orange",
                "hueShiftDegrees": 12.0,
                "luminance": -8.0,
                "saturation": 28.0,
            }),
            schema_version: 1,
            target: json!({
                "imagePath": "private-fixtures/detail/edge-ringing-v1.cr3",
                "kind": "image"
            }),
        }
    }

    fn sample_skin_tone_uniformity_command() -> RawOpenEditExportCommand {
        RawOpenEditExportCommand {
            actor: json!({
                "id": "agent.skin-tone-proof-wrapper",
                "kind": "agent",
                "sessionId": "skin-tone-proof-wrapper"
            }),
            approval: RawOpenEditExportBasicToneApproval {
                approval_class: "edit_apply".to_string(),
                reason: "Apply accepted skin-tone uniformity command for RAW preview/export proof."
                    .to_string(),
                state: "approved".to_string(),
            },
            color_pipeline: sample_color_pipeline(),
            command_id: "command.raw-open-edit-export.skin-tone-uniformity.v1".to_string(),
            command_type: "toneColor.adjustSkinToneUniformity".to_string(),
            correlation_id: "corr.raw-open-edit-export.skin-tone-uniformity.v1".to_string(),
            dry_run: false,
            expected_graph_revision: "graph-rev.raw-open-edit-export.skin-tone-uniformity.v1"
                .to_string(),
            idempotency_key: Some("idem.raw-open-edit-export.skin-tone-uniformity.v1".to_string()),
            parameters: json!({
                "experimental": true,
                "hueUniformity": 0.42,
                "luminanceUniformity": 0.18,
                "maxHueShiftDegrees": 16.0,
                "saturationUniformity": 0.31,
                "targetHueDegrees": 24.0,
                "targetLuminance": 0.56,
                "targetSaturation": 0.38,
            }),
            schema_version: 1,
            target: json!({
                "imagePath": "private-fixtures/color/skin-tone-uniformity-v1/alaska-dsc7853.arw",
                "kind": "image"
            }),
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
                warnings: Vec::new(),
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

    fn sample_source_metadata() -> RawOpenEditExportSourceMetadata {
        RawOpenEditExportSourceMetadata {
            camera_make: "Canon".to_string(),
            camera_model: "EOS R5".to_string(),
            privacy_safe_camera_id: "camera.raw-open-edit-export.edge-ringing.v1".to_string(),
            raw_format: "cr3".to_string(),
        }
    }

    fn sample_request() -> RawOpenEditExportProofRequest {
        RawOpenEditExportProofRequest {
            schema: None,
            artifact_dir_relative: "private-artifacts/validation/open-edit-export".to_string(),
            edit_command: sample_basic_tone_command(),
            fixture_id: "validation.raw-open-edit-export.edge-ringing.v1".to_string(),
            private_root_path: "/tmp/rawengine-private-root".to_string(),
            source_metadata: sample_source_metadata(),
            source_relative_path: "private-fixtures/detail/edge-ringing-v1.cr3".to_string(),
        }
    }

    #[test]
    fn rapid_view_pipeline_resolves_versioned_runtime_mode_without_reinterpreting_legacy() {
        let mut pipeline = sample_color_pipeline();
        assert_eq!(tonemapper_override_for_proof(&pipeline), Some(1));
        pipeline.scene_to_display_transform = "rawengine_rapid_view_v1".to_string();
        pipeline.render_target.view_transform = "rawengine_rapid_view_v1".to_string();
        assert_eq!(tonemapper_override_for_proof(&pipeline), Some(2));
        pipeline.render_target.view_transform = "rawengine_basic_v1".to_string();
        assert_eq!(tonemapper_override_for_proof(&pipeline), None);
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
        let mut request = sample_request();
        request
            .edit_command
            .color_pipeline
            .scene_to_display_transform = "rawengine_rapid_view_v1".to_string();
        request
            .edit_command
            .color_pipeline
            .render_target
            .view_transform = "rawengine_rapid_view_v1".to_string();
        let adjustments = edit_command_adjustments(&request.edit_command).expect("basic tone maps");
        let decoded_image = DynamicImage::new_rgba8(2, 3);
        let color_management = color_management_proof(
            &request,
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            &decoded_image,
            &ExportReceiptMetadata {
                bit_depth: 16,
                black_point_compensation: "Enabled via LittleCMS relative colorimetric transform"
                    .to_string(),
                cmm: "lcms2".to_string(),
                color_managed_transform: "sRGB to display_p3 conversion applied".to_string(),
                color_profile: "display_p3".to_string(),
                effective_color_profile: "display_p3".to_string(),
                icc_embedded: true,
                policy_version: "rawengine-export-color-policy-v2".to_string(),
                policy_status: "applied".to_string(),
                rendering_intent: "Relative colorimetric".to_string(),
                requested_color_profile: "display_p3".to_string(),
                requested_rendering_intent: "Relative colorimetric".to_string(),
                resolved_disabled_reason: None,
                effective_rendering_intent: "Relative colorimetric".to_string(),
                source_icc_profile_hash: None,
                source_precision_path: "rgb16 source; shared RGB16 export/proof core".to_string(),
                transform_policy_fingerprint:
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                        .to_string(),
                transform_applied: true,
            },
        );

        let sidecar = build_sidecar_json(&request, &adjustments, &color_management);

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
        assert_eq!(
            sidecar["rawOpenEditExportProof"]["colorManagement"]["observedColorPipeline"]["bitDepth"],
            json!(16)
        );
        assert_eq!(
            sidecar["rawOpenEditExportProof"]["colorManagement"]["observedColorPipeline"]["viewTransformReceipt"]
                ["contract"],
            json!("rapidraw.view-transform-receipt.v1")
        );
        assert_eq!(
            sidecar["rawOpenEditExportProof"]["colorManagement"]["observedColorPipeline"]["viewTransformReceipt"]
                ["implementationVersion"],
            json!(1)
        );
    }

    #[test]
    fn final_tiff_inspection_verifies_icc_bit_depth_and_soft_proof_pixels() {
        let directory = tempfile::tempdir().expect("tempdir");
        let output_path = directory.path().join("final.tiff");
        let image = DynamicImage::ImageRgb8(image::ImageBuffer::from_pixel(
            2,
            2,
            image::Rgb([128, 64, 32]),
        ));
        let settings = ExportSettings {
            black_point_compensation: true,
            color_profile: ExportColorProfile::DisplayP3,
            rendering_intent: ExportRenderingIntent::RelativeColorimetric,
            jpeg_quality: 95,
            resize: None,
            keep_metadata: false,
            preserve_timestamps: false,
            strip_gps: true,
            filename_template: None,
            watermark: None,
            export_masks: false,
            output_sharpening: None,
            preserve_folders: false,
        };
        let receipt = save_image_with_metadata(
            &image,
            &output_path,
            "private-fixtures/detail/sample.cr3",
            &settings,
        )
        .expect("final TIFF export writes through production encoder")
        .expect("final TIFF export returns color receipt");
        let (soft_proof, width, height, _) = export_soft_proof_rgb_pixels_and_profile_with_policy(
            &image,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            true,
        )
        .expect("soft proof pixels");

        let proof = inspect_final_tiff_export(
            &output_path,
            &ExportColorProfile::DisplayP3,
            &settings,
            &receipt,
            &soft_proof,
            width,
            height,
        )
        .expect("final TIFF proof");

        assert_eq!(proof.bit_depth, 16);
        assert_eq!(
            proof.embedded_icc_profile_hash,
            proof.expected_output_profile_hash
        );
        assert_eq!(proof.pixel_mean_abs_delta, 0.0);
        assert_eq!(proof.pixel_max_abs_delta, 0.0);
        assert_eq!(
            proof.black_point_compensation,
            "Enabled via LittleCMS relative colorimetric transform"
        );
        assert_eq!(proof.cmm, "lcms2");
        assert!(!proof.metadata_retained);
        assert!(!proof.timestamps_preserved);
        assert!(proof.gps_stripped);
        assert!(proof.transform_applied);
    }

    #[test]
    fn edit_command_adjustments_require_approved_apply_command() {
        let valid = sample_basic_tone_command();
        assert_eq!(
            edit_command_adjustments(&valid).expect("valid command maps")["whites"],
            json!(3.0)
        );

        let mut dry_run = sample_basic_tone_command();
        dry_run.dry_run = true;
        assert!(edit_command_adjustments(&dry_run).is_err());

        let mut pending = sample_basic_tone_command();
        pending.approval.state = "pending".to_string();
        assert!(edit_command_adjustments(&pending).is_err());
    }

    #[test]
    fn selective_color_command_maps_to_hsl_adjustment() {
        let valid = sample_selective_color_command();
        let adjustments = edit_command_adjustments(&valid).expect("selective color maps");

        assert_eq!(adjustments["hsl"]["oranges"]["hue"], json!(12.0));
        assert_eq!(adjustments["hsl"]["oranges"]["saturation"], json!(28.0));
        assert_eq!(adjustments["hsl"]["oranges"]["luminance"], json!(-8.0));

        let mut invalid = sample_selective_color_command();
        invalid.parameters["band"] = json!("teal");
        assert!(edit_command_adjustments(&invalid).is_err());
    }

    #[test]
    fn skin_tone_uniformity_command_maps_to_adjustment_state() {
        let valid = sample_skin_tone_uniformity_command();
        let adjustments = edit_command_adjustments(&valid).expect("skin-tone uniformity maps");

        assert_eq!(
            adjustments["skinToneUniformity"]["targetHueDegrees"],
            json!(24.0)
        );
        assert_eq!(
            adjustments["skinToneUniformity"]["hueUniformity"],
            json!(0.42)
        );
        assert_eq!(
            adjustments["skinToneUniformity"]["maxHueShiftDegrees"],
            json!(16.0)
        );
        assert!(adjustments["hsl"]["oranges"]["hue"].as_f64().unwrap_or(0.0) > 0.0);

        let mut invalid = sample_skin_tone_uniformity_command();
        invalid.parameters["unexpected"] = json!(true);
        assert!(edit_command_adjustments(&invalid).is_err());
    }

    #[test]
    fn proof_report_serializes_run_report_schema_fields() {
        let asset = hashed_path(
            "private-artifacts/validation/open-edit-export/sample.png".to_string(),
            "sha256:0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        );
        let report = RawOpenEditExportProofReport {
            artifacts: vec![artifact("preview_before_private", &asset)],
            color_management: color_management_proof(
                &sample_request(),
                "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                &DynamicImage::new_rgba8(2, 3),
                &ExportReceiptMetadata {
                    bit_depth: 16,
                    black_point_compensation:
                        "Enabled via LittleCMS relative colorimetric transform".to_string(),
                    cmm: "lcms2".to_string(),
                    color_managed_transform: "sRGB to display_p3 conversion applied".to_string(),
                    color_profile: "display_p3".to_string(),
                    effective_color_profile: "display_p3".to_string(),
                    icc_embedded: true,
                    policy_version: "rawengine-export-color-policy-v2".to_string(),
                    policy_status: "applied".to_string(),
                    rendering_intent: "Relative colorimetric".to_string(),
                    requested_color_profile: "display_p3".to_string(),
                    requested_rendering_intent: "Relative colorimetric".to_string(),
                    resolved_disabled_reason: None,
                    effective_rendering_intent: "Relative colorimetric".to_string(),
                    source_icc_profile_hash: None,
                    source_precision_path: "rgb16 source; shared RGB16 export/proof core"
                        .to_string(),
                    transform_policy_fingerprint:
                        "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                            .to_string(),
                    transform_applied: true,
                },
            ),
            edit_command_id: "command.raw-open-edit-export.basic-tone.v1".to_string(),
            edit_graph_revision: "graph-rev.raw-open-edit-export.sample.v1".to_string(),
            fixture_id: "validation.raw-open-edit-export.sample.v1".to_string(),
            final_file: RawOpenEditExportFinalFileProof {
                bit_depth: 16,
                black_point_compensation: "Enabled via LittleCMS relative colorimetric transform"
                    .to_string(),
                cmm: "lcms2".to_string(),
                embedded_icc_profile_hash:
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                        .to_string(),
                expected_output_profile_hash:
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                        .to_string(),
                final_file_format: "tiff".to_string(),
                output_profile: "display_p3".to_string(),
                gps_stripped: true,
                metadata_retained: true,
                pixel_max_abs_delta: 0.0,
                pixel_mean_abs_delta: 0.0,
                timestamps_preserved: true,
                reopened_dimensions: RawOpenEditExportDimensions {
                    height: 2,
                    width: 2,
                },
                transform_applied: true,
                transform_policy_fingerprint:
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                        .to_string(),
                writer_id: "export_processing::save_image_with_metadata".to_string(),
            },
            generated_at: "2026-06-17T00:00:00Z".to_string(),
            metrics: Vec::new(),
            preview_after: asset.clone(),
            preview_before: asset.clone(),
            render_paths: RawOpenEditExportRenderPathProof {
                export_after_format: "tiff".to_string(),
                export_after_writer_id: "export_processing::save_image_with_metadata".to_string(),
                preview_after_format: "png".to_string(),
                preview_after_writer_id: "raw_open_edit_export_preview_after".to_string(),
                preview_before_writer_id: "raw_open_edit_export_preview_before".to_string(),
                soft_proof_after_format: "png".to_string(),
                soft_proof_after_writer_id: "raw_open_edit_export_soft_proof_after".to_string(),
            },
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
        assert!(value.get("finalFile").is_some());
        assert!(value.get("sourceHashUnchanged").is_none());
        assert!(
            value["colorManagement"]
                .get("requestedColorPipeline")
                .is_some()
        );
        assert!(
            value["colorManagement"]
                .get("observedColorPipeline")
                .is_some()
        );
        assert!(value["colorManagement"].get("displayTransform").is_none());
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

    #[test]
    fn srgb_relative_baseline_accepts_no_final_transform() {
        let expectation = final_file_transform_expected_for_proof(
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        );

        assert!(expectation.passed);
        assert_eq!(expectation.threshold, 0.0);
    }

    #[test]
    fn perceptual_final_export_still_requires_transform() {
        let expectation = final_file_transform_expected_for_proof(
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::Perceptual,
            false,
        );

        assert!(!expectation.passed);
        assert_eq!(expectation.threshold, 1.0);
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

        let request_path = std::env::var("RAWENGINE_RAW_OPEN_EDIT_EXPORT_PROOF_REQUEST")
            .unwrap_or_else(|_| {
                "../fixtures/validation/raw-open-edit-export/raw-open-edit-export-proof-request.json".to_string()
            });
        let mut request: RawOpenEditExportProofRequest = serde_json::from_str(
            &fs::read_to_string(request_path).expect("proof request fixture reads"),
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

    #[test]
    fn white_balance_command_compiles_physical_and_creative_gpu_parameters() {
        let adjustments = white_balance_adjustments(&json!({
            "acceptedDryRunPlanHash": "sha256:test",
            "acceptedDryRunPlanId": "dryrun_test",
            "creativeTemperature": 40.0,
            "creativeTint": -20.0,
            "duv": 0.018,
            "exposureEv": -8.0,
            "kelvin": 2856.0
        }))
        .unwrap();
        let parsed =
            crate::adjustments::parse::get_all_adjustments_from_json(&adjustments, true, None);
        assert_eq!(parsed.global.exposure, -8.0);
        assert_eq!(parsed.global.temperature, 1.6);
        assert_eq!(parsed.global.tint, -0.2);
        assert_ne!(
            parsed.global.technical_white_balance.col0,
            [1.0, 0.0, 0.0, 0.0]
        );
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn private_runtime_smoke_generates_selective_color_report_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_RAW_SELECTIVE_COLOR_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping private RAW selective color proof smoke");
            return;
        }

        let mut request: RawOpenEditExportProofRequest = serde_json::from_str(
            &fs::read_to_string("../fixtures/validation/professional-color-workflow/selective-color-raw-proof-request.json")
                .expect("selective color proof request fixture reads"),
        )
        .expect("selective color proof request fixture parses");
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
                .expect("private RAW selective color proof command runs");

        assert_eq!(
            report.edit_command_id,
            "command.raw-open-edit-export.selective-color-orange.v1"
        );
        assert_eq!(
            report.fixture_id,
            "validation.raw-open-edit-export.selective-color-orange.v1"
        );
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
                .any(|metric| metric.name == "previewExportMeanAbsDelta" && metric.passed)
        );
        assert!(
            report
                .artifacts
                .iter()
                .any(|artifact| artifact.kind == "soft_proof_after_private")
        );
        assert!(
            report
                .metrics
                .iter()
                .any(|metric| metric.name == "softProofExportRgb8MeanAbsDelta"
                    && metric.passed
                    && metric.value == 0.0)
        );
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn private_runtime_smoke_generates_professional_color_report_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_RAW_PROFESSIONAL_COLOR_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping private RAW professional color proof smoke");
            return;
        }

        let mut request: RawOpenEditExportProofRequest = serde_json::from_str(
            &fs::read_to_string(
                "../fixtures/validation/professional-color-workflow/professional-color-workflow-proof-request.json",
            )
            .expect("professional color proof request fixture reads"),
        )
        .expect("professional color proof request fixture parses");
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
                .expect("private RAW professional color proof command runs");

        assert_eq!(
            report.edit_command_id,
            "command.raw-open-edit-export.professional-color.v1"
        );
        assert_eq!(
            report.fixture_id,
            "validation.raw-open-edit-export.professional-color.v1"
        );
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
                .any(|metric| metric.name == "previewExportMeanAbsDelta" && metric.passed)
        );
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn private_runtime_smoke_generates_skin_tone_uniformity_report_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_RAW_SKIN_TONE_UNIFORMITY_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping private RAW skin-tone uniformity proof smoke");
            return;
        }

        let mut request: RawOpenEditExportProofRequest = serde_json::from_str(
            &fs::read_to_string(
                "../fixtures/validation/professional-color-workflow/skin-tone-uniformity-raw-proof-request.json",
            )
            .expect("skin-tone uniformity proof request fixture reads"),
        )
        .expect("skin-tone uniformity proof request fixture parses");
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
                .expect("private RAW skin-tone uniformity proof command runs");

        assert_eq!(
            report.edit_command_id,
            "command.raw-open-edit-export.skin-tone-uniformity.v1"
        );
        assert_eq!(
            report.fixture_id,
            "validation.raw-open-edit-export.skin-tone-uniformity.v1"
        );
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
                .any(|metric| metric.name == "previewExportMeanAbsDelta" && metric.passed)
        );
    }
}
