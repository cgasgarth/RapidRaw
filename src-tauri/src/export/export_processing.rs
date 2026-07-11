use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use chrono::{SecondsFormat, Utc};
use image::{
    DynamicImage, GenericImageView, GrayImage, ImageBuffer, ImageDecoder, ImageFormat, Luma,
    codecs::{jpeg::JpegDecoder, tiff::TiffDecoder},
    imageops,
};
use lcms2::Profile as LcmsProfile;
use moxcms::ColorProfile;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tauri::Manager;

use crate::color::working_to_output_transform::WorkingColorState;
use crate::exif_processing;
pub(crate) use crate::export::export_encoders::{
    EmbeddedSourceIccProfile, encode_image_to_bytes, encode_image_with_working_color_state,
    validate_export_file_readback_color_policy,
};
use crate::export::export_output_targets::{
    ExportOutputTargetRequest, resolve_export_output_target,
};
pub use crate::export::export_postprocess::{
    OutputSharpeningSettings, ResizeOptions, WatermarkSettings,
};
use crate::export::export_postprocess::{apply_export_postprocess, calculate_resize_target};
use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::formats::is_raw_file;
use crate::image_loader::{
    composite_patches_on_image, load_and_composite_with_report, load_base_image_from_bytes,
    raw_processing_settings_for_adjustments,
};
use crate::image_processing::{
    AllAdjustments, Crop, GpuContext, ImageMetadata, RenderRequest, downscale_f32_image,
    get_all_adjustments_from_json, get_or_init_gpu_context, process_and_get_dynamic_image,
    process_and_get_unclamped_dynamic_image, resolve_tonemapper_override_from_handle,
};

fn adjustments_with_raw_engine_artifacts(metadata: ImageMetadata) -> Value {
    let mut adjustments = metadata.adjustments;
    if let Some(artifacts) = metadata.raw_engine_artifacts {
        if !adjustments.is_object() {
            adjustments = serde_json::json!({});
        }
        adjustments["rawEngineArtifacts"] =
            serde_json::to_value(artifacts).expect("RawEngine artifacts must serialize");
    }
    adjustments
}
use crate::lut_processing::{convert_image_to_cube_lut, generate_identity_lut_image};
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};
use crate::raw_processing::RawDevelopmentReport;
use crate::{AppState, ExportJob};

use crate::cache_utils::{calculate_full_job_hash, calculate_transform_hash};
#[cfg(test)]
pub(crate) use crate::export::export_color_policy::{
    ExportBlackPointCompensationStatus, ExportColorEngineId, applied_export_color_policy,
    export_color_profile_receipt_label, export_jpeg_rgb_pixels_and_profile,
    export_rgb_pixels_and_profile, export_rgb16_pixels_and_profile,
    export_rgb16_pixels_with_shared_conversion_core,
    export_soft_proof_rgb_pixels_and_profile_with_policy, export_transform_options,
    mox_rendering_intent, resolve_export_color_transform_plan,
    should_apply_srgb_perceptual_gamut_mapping,
};
pub use crate::export::export_color_policy::{
    ExportColorCapabilityCatalog, ExportColorProfile, ExportRenderingIntent,
};
pub(crate) use crate::export::export_color_policy::{
    ExportReceiptMetadata, encode_icc_profile, export_receipt_metadata,
    export_soft_proof_rgb_pixels_with_working_color_state, export_soft_proof_transform_metadata,
    export_source_precision_receipt_label, export_source_rgb16_pixels, quantize_rgb16_to_rgb8,
    resolve_export_color_capabilities, validate_export_color_policy,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportReceiptOutput {
    auxiliary_output_paths: Vec<String>,
    bit_depth: Option<u8>,
    black_point_compensation: Option<String>,
    byte_size: u64,
    cmm: Option<String>,
    color_managed_transform: Option<String>,
    color_profile: Option<String>,
    effective_color_profile: Option<String>,
    format: String,
    icc_embedded: Option<bool>,
    output_path: String,
    policy_version: Option<String>,
    raw_provenance_sidecar_path: Option<String>,
    raw_development_report: Option<RawDevelopmentReport>,
    policy_status: Option<String>,
    rendering_intent: Option<String>,
    requested_color_profile: Option<String>,
    requested_rendering_intent: Option<String>,
    resolved_disabled_reason: Option<String>,
    effective_rendering_intent: Option<String>,
    source_path: String,
    source_icc_profile_hash: Option<String>,
    source_precision_path: Option<String>,
    transform_policy_fingerprint: Option<String>,
    transform_applied: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportReceipt {
    completed_at: String,
    outputs: Vec<ExportReceiptOutput>,
    terminal_status: ExportTerminalStatus,
    total: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ExportTerminalStatus {
    Cancelled,
    Completed,
}

enum ExportItemResult {
    Cancelled(Option<ExportReceiptOutput>),
    Completed(ExportReceiptOutput),
    Failed(String),
}

enum ExportMasksResult {
    Cancelled(Vec<String>),
    Completed(Vec<String>),
}

fn claim_export_job(registry: &Mutex<Option<ExportJob>>) -> Result<Arc<AtomicBool>, String> {
    let mut job = registry.lock().unwrap();
    if job.is_some() {
        return Err("An export is already in progress.".to_string());
    }

    let cancellation_token = Arc::new(AtomicBool::new(false));
    *job = Some(ExportJob {
        cancellation_token: Arc::clone(&cancellation_token),
        task_handle: None,
    });
    Ok(cancellation_token)
}

fn request_export_cancellation(registry: &Mutex<Option<ExportJob>>) -> Result<(), String> {
    let job = registry.lock().unwrap();
    let Some(job) = job.as_ref() else {
        return Err("No export task is currently running.".to_string());
    };

    if job.cancellation_token.swap(true, Ordering::SeqCst) {
        return Err("Export cancellation is already in progress.".to_string());
    }
    Ok(())
}

fn attach_export_task(
    registry: &Mutex<Option<ExportJob>>,
    cancellation_token: &Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
) {
    let mut job = registry.lock().unwrap();
    if let Some(job) = job.as_mut()
        && Arc::ptr_eq(&job.cancellation_token, cancellation_token)
    {
        job.task_handle = Some(task);
    }
}

fn finish_export_job(registry: &Mutex<Option<ExportJob>>, cancellation_token: &Arc<AtomicBool>) {
    let mut job = registry.lock().unwrap();
    if job
        .as_ref()
        .is_some_and(|job| Arc::ptr_eq(&job.cancellation_token, cancellation_token))
    {
        *job = None;
    }
}

fn export_terminal_receipt(
    terminal_status: ExportTerminalStatus,
    outputs: Vec<ExportReceiptOutput>,
    total: usize,
) -> ExportReceipt {
    ExportReceipt {
        completed_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        outputs,
        terminal_status,
        total,
    }
}

fn commit_export_output<T>(
    cancellation_token: &AtomicBool,
    write: impl FnOnce() -> Result<T, String>,
) -> Result<Option<T>, String> {
    if cancellation_token.load(Ordering::SeqCst) {
        return Ok(None);
    }
    write().map(Some)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RawExportProvenanceSidecar {
    byte_size: u64,
    completed_at: String,
    edit_graph_revision: String,
    format: String,
    output_hash: String,
    output_path: String,
    raw_development_report: RawDevelopmentReport,
    schema_version: u8,
    source_hash: String,
    source_path: String,
}
use crate::render_pipeline::apply_pre_gpu_detail_stages;
use crate::{
    apply_all_transformations, generate_transformed_preview, get_cached_or_generate_mask,
    get_full_image_for_processing, get_or_load_lut, hydrate_adjustments, load_settings_or_default,
    resolve_warped_image_for_masks,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    #[serde(default)]
    pub black_point_compensation: bool,
    #[serde(default)]
    pub color_profile: ExportColorProfile,
    #[serde(default)]
    pub rendering_intent: ExportRenderingIntent,
    pub jpeg_quality: u8,
    pub resize: Option<ResizeOptions>,
    pub keep_metadata: bool,
    #[serde(default)]
    pub preserve_timestamps: bool,
    pub strip_gps: bool,
    pub filename_template: Option<String>,
    pub watermark: Option<WatermarkSettings>,
    #[serde(default)]
    pub export_masks: bool,
    pub output_sharpening: Option<OutputSharpeningSettings>,
    #[serde(default)]
    pub preserve_folders: bool,
}

#[tauri::command]
pub fn get_export_color_capabilities() -> ExportColorCapabilityCatalog {
    resolve_export_color_capabilities()
}

fn apply_export_resize_and_watermark(
    image: DynamicImage,
    export_settings: &ExportSettings,
) -> Result<DynamicImage, String> {
    apply_export_postprocess(
        image,
        export_settings.resize.as_ref(),
        export_settings.output_sharpening.as_ref(),
        export_settings.watermark.as_ref(),
    )
}

pub(crate) fn prepare_export_masks<'a>(
    base_image: &'a DynamicImage,
    js_adjustments: &Value,
    state: &tauri::State<AppState>,
) -> (Cow<'a, DynamicImage>, Vec<GrayImage>) {
    let (transformed_image, unscaled_crop_offset) =
        apply_all_transformations(Cow::Borrowed(base_image), js_adjustments);
    let (img_w, img_h) = transformed_image.dimensions();
    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();
    let warped_image = resolve_warped_image_for_masks(state, js_adjustments, &mask_definitions);
    let mask_bitmaps = mask_definitions
        .iter()
        .filter_map(|def| {
            generate_mask_bitmap(
                def,
                img_w,
                img_h,
                1.0,
                unscaled_crop_offset,
                warped_image.as_deref(),
            )
        })
        .collect();

    (transformed_image, mask_bitmaps)
}

struct ExportRenderInputs {
    adjustments: AllAdjustments,
    lut: Option<Arc<crate::lut_processing::Lut>>,
    unique_hash: u64,
}

fn prepare_export_render_inputs(
    path: &str,
    js_adjustments: &Value,
    state: &tauri::State<AppState>,
    is_raw: bool,
    tm_override: Option<u32>,
    hash_salt: u64,
) -> ExportRenderInputs {
    let render_adjustments = normalize_film_look_adjustments_for_render(js_adjustments);
    let mut adjustments =
        get_all_adjustments_from_json(render_adjustments.as_ref(), is_raw, tm_override);
    adjustments.global.show_clipping = 0;
    let lut = render_adjustments["lutPath"]
        .as_str()
        .and_then(|p| get_or_load_lut(state, p).ok());
    let unique_hash =
        calculate_full_job_hash(path, render_adjustments.as_ref()).wrapping_add(hash_salt);

    ExportRenderInputs {
        adjustments,
        lut,
        unique_hash,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn process_image_for_export_pipeline(
    path: &str,
    base_image: &DynamicImage,
    js_adjustments: &Value,
    context: &GpuContext,
    state: &tauri::State<AppState>,
    is_raw: bool,
    debug_tag: &str,
    app_handle: &tauri::AppHandle,
) -> Result<DynamicImage, String> {
    let mut authoritative_adjustments = js_adjustments.clone();
    if let Some(plan) =
        crate::layers::apply_authoritative_layer_stack(&mut authoritative_adjustments, path)?
    {
        log::debug!(
            "native layer export plan revision={} layer={:?} hash={}",
            plan.graph_revision,
            plan.layer_id,
            plan.plan_hash
        );
    }
    let (transformed_image, mask_bitmaps) =
        prepare_export_masks(base_image, &authoritative_adjustments, state);
    let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
    process_image_for_export_pipeline_with_tonemapper_override(
        path,
        transformed_image.as_ref(),
        &authoritative_adjustments,
        context,
        state,
        is_raw,
        debug_tag,
        tm_override,
        &mask_bitmaps,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn process_image_for_export_pipeline_with_tonemapper_override(
    path: &str,
    transformed_image: &DynamicImage,
    js_adjustments: &Value,
    context: &GpuContext,
    state: &tauri::State<AppState>,
    is_raw: bool,
    debug_tag: &str,
    tm_override: Option<u32>,
    mask_bitmaps: &[GrayImage],
) -> Result<DynamicImage, String> {
    let render_inputs =
        prepare_export_render_inputs(path, js_adjustments, state, is_raw, tm_override, 0);

    let detail_stage =
        apply_pre_gpu_detail_stages(transformed_image, render_inputs.unique_hash, js_adjustments);
    let retouched_image = crate::retouch_render::apply_clone_retouch_layers(
        detail_stage.image.as_ref(),
        js_adjustments,
        mask_bitmaps,
    );

    process_and_get_unclamped_dynamic_image(
        context,
        state,
        retouched_image.as_ref(),
        render_inputs.unique_hash,
        RenderRequest {
            adjustments: render_inputs.adjustments,
            mask_bitmaps,
            lut: render_inputs.lut,
            roi: None,
        },
        debug_tag,
    )
}

fn set_timestamps_from_exif(src: &Path, dst: &Path) {
    let capture_dt = exif_processing::get_creation_date_from_path(src);
    let ft = filetime::FileTime::from_unix_time(
        capture_dt.timestamp(),
        capture_dt.timestamp_subsec_nanos(),
    );
    if let Err(e) = filetime::set_file_times(dst, ft, ft) {
        log::warn!("Could not set timestamps on '{}': {}", dst.display(), e);
    }
}

pub(crate) fn save_image_with_metadata(
    image: &DynamicImage,
    output_path: &std::path::Path,
    source_path_str: &str,
    export_settings: &ExportSettings,
) -> Result<Option<ExportReceiptMetadata>, String> {
    save_image_with_metadata_and_color_state(
        image,
        WorkingColorState::EncodedSrgbV1,
        output_path,
        source_path_str,
        export_settings,
    )
}

pub(crate) fn save_image_with_metadata_and_color_state(
    image: &DynamicImage,
    source_color_state: WorkingColorState,
    output_path: &std::path::Path,
    source_path_str: &str,
    export_settings: &ExportSettings,
) -> Result<Option<ExportReceiptMetadata>, String> {
    let extension = output_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let source_embedded_icc = if matches!(
        export_settings.color_profile,
        ExportColorProfile::SourceEmbedded
    ) {
        Some(read_embedded_source_icc_profile(
            Path::new(source_path_str),
            &extension,
        )?)
    } else {
        None
    };

    let encoded_image = encode_image_with_working_color_state(
        image,
        source_color_state,
        &extension,
        export_settings.jpeg_quality,
        &export_settings.color_profile,
        &export_settings.rendering_intent,
        export_settings.black_point_compensation,
        source_embedded_icc.as_ref(),
    )?;
    let mut image_bytes = encoded_image.bytes;

    exif_processing::write_image_with_metadata(
        &mut image_bytes,
        source_path_str,
        &extension,
        export_settings.keep_metadata,
        export_settings.strip_gps,
    )?;
    validate_export_file_readback_color_policy(
        &image_bytes,
        &extension,
        encoded_image.color_policy.as_ref(),
        &export_settings.color_profile,
        &export_settings.rendering_intent,
        export_settings.black_point_compensation,
        source_embedded_icc.as_ref(),
    )?;

    #[cfg(target_os = "android")]
    {
        let file_name = output_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Missing Android export file name".to_string())?;
        crate::android_integration::save_image_bytes_to_android_gallery(
            file_name,
            crate::formats::export_mime_type_for_extension(&extension),
            &image_bytes,
        )?;
    }

    #[cfg(not(target_os = "android"))]
    fs::write(output_path, image_bytes).map_err(|e| e.to_string())?;

    Ok(encoded_image.color_policy)
}

fn read_embedded_source_icc_profile(
    source_path: &Path,
    output_format: &str,
) -> Result<EmbeddedSourceIccProfile, String> {
    if !matches!(output_format, "jpg" | "jpeg" | "tif" | "tiff") {
        return Err(format!(
            "Source embedded export profile is only supported for JPEG and TIFF, not {output_format}."
        ));
    }

    let source_extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(source_extension.as_str(), "jpg" | "jpeg" | "tif" | "tiff") {
        return Err(
            "Source embedded export profile requires a tagged JPEG or TIFF source.".to_string(),
        );
    }

    let bytes = fs::read(source_path)
        .map_err(|error| format!("Failed to read source image ICC profile: {error}"))?;
    let icc_profile = match source_extension.as_str() {
        "jpg" | "jpeg" => {
            let mut decoder = JpegDecoder::new(Cursor::new(bytes.as_slice()))
                .map_err(|error| format!("Failed to inspect source JPEG ICC profile: {error}"))?;
            decoder
                .icc_profile()
                .map_err(|error| format!("Failed to read source JPEG ICC profile: {error}"))?
        }
        "tif" | "tiff" => {
            let mut decoder = TiffDecoder::new(Cursor::new(bytes.as_slice()))
                .map_err(|error| format!("Failed to inspect source TIFF ICC profile: {error}"))?;
            decoder
                .icc_profile()
                .map_err(|error| format!("Failed to read source TIFF ICC profile: {error}"))?
        }
        _ => None,
    }
    .ok_or_else(|| {
        "Source embedded export profile requires an embedded ICC profile.".to_string()
    })?;

    ColorProfile::new_from_slice(&icc_profile).map_err(|error| {
        format!("Source embedded ICC profile is not a supported RGB profile: {error}")
    })?;
    LcmsProfile::new_icc(&icc_profile).map_err(|error| {
        format!("Source embedded ICC profile could not be opened by LittleCMS: {error}")
    })?;

    Ok(EmbeddedSourceIccProfile {
        sha256: format!("sha256:{}", hex::encode(Sha256::digest(&icc_profile))),
        bytes: icc_profile,
    })
}

#[allow(clippy::too_many_arguments)]
fn process_image_for_export(
    path: &str,
    base_image: &DynamicImage,
    js_adjustments: &Value,
    export_settings: &ExportSettings,
    context: &GpuContext,
    state: &tauri::State<AppState>,
    is_raw: bool,
    app_handle: &tauri::AppHandle,
) -> Result<DynamicImage, String> {
    let processed_image = process_image_for_export_pipeline(
        path,
        base_image,
        js_adjustments,
        context,
        state,
        is_raw,
        "process_image_for_export",
        app_handle,
    )?;

    apply_export_resize_and_watermark(processed_image, export_settings)
}

fn build_single_mask_adjustments(all: &AllAdjustments, mask_index: usize) -> AllAdjustments {
    let mut single = AllAdjustments {
        global: all.global,
        mask_adjustments: all.mask_adjustments,
        mask_count: 1,
        tile_offset_x: all.tile_offset_x,
        tile_offset_y: all.tile_offset_y,
        mask_atlas_cols: all.mask_atlas_cols,
        blur_pass_flags: all.blur_pass_flags,
        _pad_blur_flags1: 0,
        _pad_blur_flags2: 0,
        _pad_blur_flags3: 0,
    };
    single.mask_adjustments[0] = all.mask_adjustments[mask_index];
    for i in 1..single.mask_adjustments.len() {
        single.mask_adjustments[i] = Default::default();
    }
    single
}

fn encode_grayscale_to_png(bitmap: &GrayImage) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    bitmap
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

#[allow(clippy::too_many_arguments)]
fn export_masks_for_image(
    base_image: &DynamicImage,
    js_adjustments: &Value,
    export_settings: &ExportSettings,
    output_path_obj: &std::path::Path,
    source_path_str: &str,
    context: &Arc<GpuContext>,
    state: &tauri::State<AppState>,
    is_raw: bool,
    app_handle: &tauri::AppHandle,
    cancellation_token: &AtomicBool,
) -> Result<ExportMasksResult, String> {
    let mut committed_paths = Vec::new();
    if cancellation_token.load(Ordering::SeqCst) {
        return Ok(ExportMasksResult::Cancelled(committed_paths));
    }

    let (transformed_image, mask_bitmaps) = prepare_export_masks(base_image, js_adjustments, state);
    let (img_w, img_h) = transformed_image.dimensions();

    if !mask_bitmaps.is_empty() {
        let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
        let render_adjustments = normalize_film_look_adjustments_for_render(js_adjustments);
        let all_adjustments =
            get_all_adjustments_from_json(render_adjustments.as_ref(), is_raw, tm_override);
        let lut_path = render_adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
        let unique_hash = calculate_full_job_hash(source_path_str, render_adjustments.as_ref());
        let output_dir = output_path_obj.parent().unwrap_or(output_path_obj);
        let stem = output_path_obj
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("export");
        let extension = output_path_obj
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("jpg");

        for (i, _) in mask_bitmaps.iter().enumerate() {
            if cancellation_token.load(Ordering::SeqCst) {
                return Ok(ExportMasksResult::Cancelled(committed_paths));
            }

            let single_adjustments = build_single_mask_adjustments(&all_adjustments, i);
            let full_white_mask = ImageBuffer::from_fn(img_w, img_h, |_, _| Luma([255u8]));
            let single_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = vec![full_white_mask];

            let processed = process_and_get_dynamic_image(
                context,
                state,
                transformed_image.as_ref(),
                unique_hash,
                RenderRequest {
                    adjustments: single_adjustments,
                    mask_bitmaps: &single_bitmaps,
                    lut: lut.clone(),
                    roi: None,
                },
                "export_mask_image",
            )?;

            let with_options = apply_export_resize_and_watermark(processed, export_settings)?;
            let (out_w, out_h) = with_options.dimensions();

            let alpha_resized = imageops::resize(
                &mask_bitmaps[i],
                out_w,
                out_h,
                imageops::FilterType::Lanczos3,
            );

            let mask_image_path =
                output_dir.join(format!("{}_mask_{}_image.{}", stem, i, extension));
            let mask_alpha_path = output_dir.join(format!("{}_mask_{}_alpha.png", stem, i));

            if cancellation_token.load(Ordering::SeqCst) {
                return Ok(ExportMasksResult::Cancelled(committed_paths));
            }
            if commit_export_output(cancellation_token, || {
                save_image_with_metadata(
                    &with_options,
                    &mask_image_path,
                    source_path_str,
                    export_settings,
                )
            })?
            .is_none()
            {
                return Ok(ExportMasksResult::Cancelled(committed_paths));
            }
            committed_paths.push(mask_image_path.to_string_lossy().to_string());

            if cancellation_token.load(Ordering::SeqCst) {
                return Ok(ExportMasksResult::Cancelled(committed_paths));
            }

            if export_settings.preserve_timestamps {
                set_timestamps_from_exif(Path::new(source_path_str), &mask_image_path);
            }

            let alpha_bytes = encode_grayscale_to_png(&alpha_resized)?;
            if cancellation_token.load(Ordering::SeqCst) {
                return Ok(ExportMasksResult::Cancelled(committed_paths));
            }
            if commit_export_output(cancellation_token, || {
                #[cfg(target_os = "android")]
                {
                    let file_name = mask_alpha_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .ok_or_else(|| "Missing Android mask export file name".to_string())?;
                    crate::android_integration::save_image_bytes_to_android_gallery(
                        file_name,
                        crate::formats::IMAGE_MIME_PNG,
                        &alpha_bytes,
                    )?;
                }

                #[cfg(not(target_os = "android"))]
                fs::write(&mask_alpha_path, &alpha_bytes).map_err(|e| e.to_string())?;
                Ok(())
            })?
            .is_none()
            {
                return Ok(ExportMasksResult::Cancelled(committed_paths));
            }
            committed_paths.push(mask_alpha_path.to_string_lossy().to_string());

            if cancellation_token.load(Ordering::SeqCst) {
                return Ok(ExportMasksResult::Cancelled(committed_paths));
            }
        }
    }
    Ok(ExportMasksResult::Completed(committed_paths))
}

fn export_adjustments_as_lut(
    js_adjustments: &Value,
    source_path_str: &str,
    context: &Arc<GpuContext>,
    state: &tauri::State<AppState>,
    app_handle: &tauri::AppHandle,
) -> Result<Vec<u8>, String> {
    let lut_size = 33;
    let identity_image = generate_identity_lut_image(lut_size);

    let tm_override = resolve_tonemapper_override_from_handle(app_handle, false);
    let render_adjustments = normalize_film_look_adjustments_for_render(js_adjustments);
    let mut all_adjustments =
        get_all_adjustments_from_json(render_adjustments.as_ref(), false, tm_override);

    all_adjustments.global.show_clipping = 0;
    all_adjustments.global.vignette_amount = 0.0;
    all_adjustments.global.grain_amount = 0.0;
    all_adjustments.global.sharpness = 0.0;
    all_adjustments.global.clarity = 0.0;
    all_adjustments.global.dehaze = 0.0;
    all_adjustments.global.structure = 0.0;
    all_adjustments.global.centré = 0.0;
    all_adjustments.global.glow_amount = 0.0;
    all_adjustments.global.halation_amount = 0.0;
    all_adjustments.global.flare_amount = 0.0;
    all_adjustments.global.luma_noise_reduction = 0.0;
    all_adjustments.global.color_noise_reduction = 0.0;
    all_adjustments.global.chromatic_aberration_red_cyan = 0.0;
    all_adjustments.global.chromatic_aberration_blue_yellow = 0.0;

    let lut_path = render_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
    let unique_hash = calculate_full_job_hash(source_path_str, render_adjustments.as_ref());

    let processed_lut = process_and_get_dynamic_image(
        context,
        state,
        &identity_image,
        unique_hash,
        RenderRequest {
            adjustments: all_adjustments,
            mask_bitmaps: &[],
            lut,
            roi: None,
        },
        "export_lut",
    )?;

    convert_image_to_cube_lut(&processed_lut, lut_size)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_images(
    paths: Vec<String>,
    output_folder_or_file: String,
    is_explicit_file_path: bool,
    base_origin_folders: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let total_paths = paths.len();
    let cancellation_token = claim_export_job(&state.export_job)?;
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    if cancellation_token.load(Ordering::SeqCst) {
        let _ = app_handle.emit(
            crate::events::EXPORT_CANCELLED,
            export_terminal_receipt(ExportTerminalStatus::Cancelled, Vec::new(), total_paths),
        );
        finish_export_job(&state.export_job, &cancellation_token);
        return Ok(());
    }

    let context = match get_or_init_gpu_context(&state, &app_handle) {
        Ok(context) => context,
        Err(error) => {
            if cancellation_token.load(Ordering::SeqCst) {
                let _ = app_handle.emit(
                    crate::events::EXPORT_CANCELLED,
                    export_terminal_receipt(
                        ExportTerminalStatus::Cancelled,
                        Vec::new(),
                        total_paths,
                    ),
                );
                finish_export_job(&state.export_job, &cancellation_token);
                return Ok(());
            }
            finish_export_job(&state.export_job, &cancellation_token);
            return Err(error);
        }
    };
    if cancellation_token.load(Ordering::SeqCst) {
        let _ = app_handle.emit(
            crate::events::EXPORT_CANCELLED,
            export_terminal_receipt(ExportTerminalStatus::Cancelled, Vec::new(), total_paths),
        );
        finish_export_job(&state.export_job, &cancellation_token);
        return Ok(());
    }
    let context = Arc::new(context);
    let progress_counter = Arc::new(AtomicUsize::new(0));

    let available_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let mut sys = sysinfo::System::new();
    sys.refresh_memory();

    let available_ram_gb = sys.available_memory() as f64 / 1024.0 / 1024.0 / 1024.0;

    let ram_based_limit = (available_ram_gb / 2.5).floor() as usize;

    let num_threads = if paths.len() == 1 {
        1
    } else {
        available_cores.min(ram_based_limit).clamp(1, 16)
    };

    log::info!(
        "Batch Export: {} cores, {:.1} GB free RAM -> {} threads",
        available_cores,
        available_ram_gb,
        num_threads
    );

    let task_cancellation_token = Arc::clone(&cancellation_token);
    let task = tokio::spawn(async move {
        let cancellation_token = task_cancellation_token;
        let output_folder_path = std::path::Path::new(&output_folder_or_file);
        let total_paths = total_paths;
        let settings = load_settings_or_default(&app_handle);

        let mut base_path_counts: HashMap<String, usize> = HashMap::new();
        let mut export_items = Vec::with_capacity(total_paths);

        for (i, path_str) in paths.into_iter().enumerate() {
            let (source_path, _) = parse_virtual_path(&path_str);
            let source_str = source_path.to_string_lossy().to_string();
            let count = base_path_counts.entry(source_str.clone()).or_insert(0);
            *count += 1;

            let mut explicit_vc = None;
            if let Some(idx) = path_str.rfind("vc=") {
                let id_str = path_str[idx + 3..].split('&').next().unwrap_or("");
                if let Ok(id) = id_str.parse::<u32>() {
                    explicit_vc = Some(id);
                }
            }
            if explicit_vc.is_none() {
                let lower = path_str.to_lowercase();
                if let Some(idx) = lower.rfind("_vc") {
                    let id_str: String = lower[idx + 3..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    if let Ok(id) = id_str.parse::<u32>() {
                        explicit_vc = Some(id);
                    }
                }
            }
            export_items.push((i, path_str, *count, explicit_vc));
        }

        let semaphore = Arc::new(tokio::sync::Semaphore::new(num_threads));
        let mut join_handles = Vec::new();

        for (global_index, image_path_str, appearance_count, explicit_vc) in export_items {
            if cancellation_token.load(Ordering::SeqCst) {
                break;
            }

            let permit = semaphore.clone().acquire_owned().await.unwrap();

            if cancellation_token.load(Ordering::SeqCst) {
                break;
            }

            let app_handle_clone = app_handle.clone();
            let context_clone = Arc::clone(&context);
            let cancellation_token = Arc::clone(&cancellation_token);
            let progress_counter_clone = Arc::clone(&progress_counter);
            let output_folder_path = output_folder_path.to_path_buf();
            let base_origin_folders = base_origin_folders.clone();
            let export_settings = export_settings.clone();
            let output_format = output_format.clone();
            let current_edit_path = current_edit_path.clone();
            let current_edit_adjustments = current_edit_adjustments.clone();
            let settings = settings.clone();

            let handle = tokio::task::spawn_blocking(move || {
                if cancellation_token.load(Ordering::SeqCst) {
                    return ExportItemResult::Cancelled(None);
                }

                let state = app_handle_clone.state::<AppState>();
                let filename_template = export_settings
                    .filename_template
                    .as_deref()
                    .unwrap_or("{original_filename}_edited");
                let target = resolve_export_output_target(ExportOutputTargetRequest {
                    image_path: &image_path_str,
                    output_folder_path: &output_folder_path,
                    is_explicit_file_path,
                    base_origin_folders: &base_origin_folders,
                    filename_template,
                    preserve_folders: export_settings.preserve_folders,
                    output_format: &output_format,
                    total_paths,
                    global_index,
                    appearance_count,
                    explicit_virtual_copy: explicit_vc,
                });
                let sidecar_path = target.sidecar_path;
                let source_path_str = target.source_path_str;
                let output_path = target.output_path;
                let is_current_edit = Some(&source_path_str) == current_edit_path.as_ref();

                let mut js_adjustments = match (is_current_edit, current_edit_adjustments) {
                    (true, Some(adjustments)) => adjustments,
                    _ => {
                        let metadata = crate::exif_processing::load_sidecar(&sidecar_path);
                        adjustments_with_raw_engine_artifacts(metadata)
                    }
                };

                hydrate_adjustments(&state, &mut js_adjustments);
                let effective_settings =
                    raw_processing_settings_for_adjustments(&settings, &js_adjustments);
                let is_raw = is_raw_file(&source_path_str);

                let extension = output_format.to_lowercase();

                let mut committed_primary_output = None;
                let result: Result<ExportItemResult, String> = (|| {
                    if extension == "cube" {
                        let cube_bytes = export_adjustments_as_lut(
                            &js_adjustments,
                            &source_path_str,
                            &context_clone,
                            &state,
                            &app_handle_clone,
                        )?;
                        if cancellation_token.load(Ordering::SeqCst) {
                            return Ok(ExportItemResult::Cancelled(None));
                        }
                        let wrote_lut = commit_export_output(cancellation_token.as_ref(), || {
                            #[cfg(target_os = "android")]
                            {
                                let file_name = output_path
                                    .file_name()
                                    .and_then(|name| name.to_str())
                                    .ok_or_else(|| "Missing Android LUT file name".to_string())?;
                                crate::android_integration::save_file_bytes_to_android_downloads(
                                    file_name,
                                    "application/octet-stream",
                                    &cube_bytes,
                                )?;
                            }
                            #[cfg(not(target_os = "android"))]
                            fs::write(&output_path, &cube_bytes).map_err(|e| e.to_string())?;
                            Ok(())
                        })?;
                        if wrote_lut.is_none() {
                            return Ok(ExportItemResult::Cancelled(None));
                        }
                        return Ok(ExportItemResult::Completed(export_receipt_output(
                            &output_path,
                            &source_path_str,
                            &extension,
                            None,
                            None,
                            None,
                            None,
                        )?));
                    }

                    let export_started = Instant::now();
                    if cancellation_token.load(Ordering::SeqCst) {
                        return Ok(ExportItemResult::Cancelled(None));
                    }
                    let (base_image, raw_development_report) = if is_current_edit {
                        match get_full_image_for_processing(&state) {
                            Ok((orig_data, _)) => {
                                let image = composite_patches_on_image(&orig_data, &js_adjustments)
                                    .map_err(|e| format!("Failed to composite AI patches: {}", e))?
                                    .into_owned();
                                (image, None)
                            }
                            Err(_) => {
                                let bytes =
                                    fs::read(&source_path_str).map_err(|e| e.to_string())?;
                                load_and_composite_with_report(
                                    &bytes,
                                    &source_path_str,
                                    &js_adjustments,
                                    false,
                                    &effective_settings,
                                    None,
                                )
                                .map_err(|e| format!("Failed to load fallback image: {}", e))?
                            }
                        }
                    } else {
                        match read_file_mapped(Path::new(&source_path_str)) {
                            Ok(mmap) => load_and_composite_with_report(
                                &mmap,
                                &source_path_str,
                                &js_adjustments,
                                false,
                                &effective_settings,
                                None,
                            )
                            .map_err(|e| format!("Failed to load from mmap: {}", e))?,
                            Err(_) => {
                                let bytes =
                                    fs::read(&source_path_str).map_err(|e| e.to_string())?;
                                load_and_composite_with_report(
                                    &bytes,
                                    &source_path_str,
                                    &js_adjustments,
                                    false,
                                    &effective_settings,
                                    None,
                                )
                                .map_err(|e| format!("Failed to load from bytes: {}", e))?
                            }
                        }
                    };

                    let mut main_export_adjustments = js_adjustments.clone();
                    if export_settings.export_masks
                        && let Some(obj) = main_export_adjustments.as_object_mut()
                    {
                        obj.insert("masks".to_string(), serde_json::json!([]));
                    }

                    let final_image = process_image_for_export(
                        &source_path_str,
                        &base_image,
                        &main_export_adjustments,
                        &export_settings,
                        &context_clone,
                        &state,
                        is_raw,
                        &app_handle_clone,
                    )?;
                    if cancellation_token.load(Ordering::SeqCst) {
                        return Ok(ExportItemResult::Cancelled(None));
                    }
                    let Some(export_color_policy) =
                        commit_export_output(cancellation_token.as_ref(), || {
                            save_image_with_metadata_and_color_state(
                                &final_image,
                                if is_raw {
                                    WorkingColorState::AcesCgLinearV1
                                } else {
                                    WorkingColorState::EncodedSrgbV1
                                },
                                &output_path,
                                &source_path_str,
                                &export_settings,
                            )
                        })?
                    else {
                        return Ok(ExportItemResult::Cancelled(None));
                    };

                    if export_settings.preserve_timestamps {
                        set_timestamps_from_exif(Path::new(&source_path_str), &output_path);
                    }

                    let mut primary_output = export_receipt_output(
                        &output_path,
                        &source_path_str,
                        &extension,
                        export_color_policy,
                        raw_development_report,
                        Some(format!(
                            "export_job:{:016x}",
                            calculate_full_job_hash(&source_path_str, &js_adjustments)
                        )),
                        Some(export_started.elapsed().as_millis()),
                    )?;
                    committed_primary_output = Some(primary_output.clone());

                    if cancellation_token.load(Ordering::SeqCst) {
                        return Ok(ExportItemResult::Cancelled(
                            committed_primary_output.clone(),
                        ));
                    }

                    if export_settings.export_masks {
                        match export_masks_for_image(
                            &base_image,
                            &js_adjustments,
                            &export_settings,
                            &output_path,
                            &source_path_str,
                            &context_clone,
                            &state,
                            is_raw,
                            &app_handle_clone,
                            cancellation_token.as_ref(),
                        )? {
                            ExportMasksResult::Cancelled(committed_paths) => {
                                primary_output
                                    .auxiliary_output_paths
                                    .extend(committed_paths);
                                return Ok(ExportItemResult::Cancelled(Some(primary_output)));
                            }
                            ExportMasksResult::Completed(committed_paths) => {
                                primary_output
                                    .auxiliary_output_paths
                                    .extend(committed_paths);
                            }
                        }
                    }

                    committed_primary_output = Some(primary_output.clone());
                    if cancellation_token.load(Ordering::SeqCst) {
                        return Ok(ExportItemResult::Cancelled(
                            committed_primary_output.clone(),
                        ));
                    }

                    Ok(ExportItemResult::Completed(primary_output))
                })();

                let result = match result {
                    Ok(result) => result,
                    Err(_error) if cancellation_token.load(Ordering::SeqCst) => {
                        ExportItemResult::Cancelled(committed_primary_output)
                    }
                    Err(error) => ExportItemResult::Failed(error),
                };

                let current_progress = progress_counter_clone.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = app_handle_clone.emit(
                    crate::events::BATCH_EXPORT_PROGRESS,
                    serde_json::json!({
                        "current": current_progress,
                        "total": total_paths,
                        "path": &image_path_str
                    }),
                );

                drop(permit);
                result
            });

            join_handles.push(handle);
        }

        let mut results = Vec::new();
        for handle in join_handles {
            match handle.await {
                Ok(res) => results.push(res),
                Err(error) => {
                    results.push(ExportItemResult::Failed(format!("Thread crashed: {error}")))
                }
            }
        }

        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let mut error_count = 0;
        let mut outputs = Vec::new();
        for result in results {
            match result {
                ExportItemResult::Completed(output) => outputs.push(output),
                ExportItemResult::Cancelled(Some(output)) => outputs.push(output),
                ExportItemResult::Cancelled(None) => {}
                ExportItemResult::Failed(error) => {
                    error_count += 1;
                    log::error!("Export error: {error}");
                    if total_paths == 1 {
                        let _ = app_handle.emit(crate::events::EXPORT_ERROR, error);
                    }
                }
            }
        }

        if cancellation_token.load(Ordering::SeqCst) {
            let _ = app_handle.emit(
                crate::events::EXPORT_CANCELLED,
                export_terminal_receipt(ExportTerminalStatus::Cancelled, outputs, total_paths),
            );
        } else if error_count > 0 && total_paths > 1 {
            let _ = app_handle.emit(
                crate::events::EXPORT_COMPLETE_WITH_ERRORS,
                serde_json::json!({ "errors": error_count, "total": total_paths }),
            );
        } else if error_count == 0 {
            let _ = app_handle.emit(
                crate::events::BATCH_EXPORT_PROGRESS,
                serde_json::json!({ "current": total_paths, "total": total_paths, "path": "" }),
            );
            let _ = app_handle.emit(
                crate::events::EXPORT_COMPLETE,
                export_terminal_receipt(ExportTerminalStatus::Completed, outputs, total_paths),
            );
        }

        finish_export_job(
            &app_handle.state::<AppState>().export_job,
            &cancellation_token,
        );
    });

    attach_export_task(&state.export_job, &cancellation_token, task);
    Ok(())
}

fn export_receipt_output(
    output_path: &Path,
    source_path: &str,
    format: &str,
    metadata: Option<ExportReceiptMetadata>,
    mut raw_development_report: Option<RawDevelopmentReport>,
    edit_graph_revision: Option<String>,
    export_elapsed_ms: Option<u128>,
) -> Result<ExportReceiptOutput, String> {
    let byte_size = fs::metadata(output_path)
        .map_err(|error| error.to_string())?
        .len();
    if let (Some(report), Some(export_elapsed_ms)) =
        (raw_development_report.as_mut(), export_elapsed_ms)
        && let Some(runtime) = report.runtime.as_mut()
    {
        runtime.export_elapsed_ms = Some(export_elapsed_ms);
    }
    let raw_provenance_sidecar_path = match raw_development_report.as_ref() {
        Some(report) => Some(write_raw_export_provenance_sidecar(
            output_path,
            source_path,
            format,
            byte_size,
            edit_graph_revision
                .as_deref()
                .unwrap_or("export_job:unknown"),
            report,
        )?),
        None => None,
    };

    Ok(ExportReceiptOutput {
        auxiliary_output_paths: Vec::new(),
        bit_depth: metadata.as_ref().map(|metadata| metadata.bit_depth),
        black_point_compensation: metadata
            .as_ref()
            .map(|metadata| metadata.black_point_compensation.clone()),
        byte_size,
        cmm: metadata.as_ref().map(|metadata| metadata.cmm.clone()),
        color_managed_transform: metadata
            .as_ref()
            .map(|metadata| metadata.color_managed_transform.clone()),
        color_profile: metadata
            .as_ref()
            .map(|metadata| metadata.color_profile.clone()),
        effective_color_profile: metadata
            .as_ref()
            .map(|metadata| metadata.effective_color_profile.clone()),
        format: format.to_string(),
        icc_embedded: metadata.as_ref().map(|metadata| metadata.icc_embedded),
        output_path: output_path.to_string_lossy().to_string(),
        policy_version: metadata
            .as_ref()
            .map(|metadata| metadata.policy_version.clone()),
        raw_provenance_sidecar_path,
        raw_development_report,
        policy_status: metadata
            .as_ref()
            .map(|metadata| metadata.policy_status.clone()),
        rendering_intent: metadata
            .as_ref()
            .map(|metadata| metadata.rendering_intent.clone()),
        requested_color_profile: metadata
            .as_ref()
            .map(|metadata| metadata.requested_color_profile.clone()),
        requested_rendering_intent: metadata
            .as_ref()
            .map(|metadata| metadata.requested_rendering_intent.clone()),
        resolved_disabled_reason: metadata
            .as_ref()
            .and_then(|metadata| metadata.resolved_disabled_reason.clone()),
        effective_rendering_intent: metadata
            .as_ref()
            .map(|metadata| metadata.effective_rendering_intent.clone()),
        source_path: source_path.to_string(),
        source_icc_profile_hash: metadata
            .as_ref()
            .and_then(|metadata| metadata.source_icc_profile_hash.clone()),
        source_precision_path: metadata
            .as_ref()
            .map(|metadata| metadata.source_precision_path.clone()),
        transform_policy_fingerprint: metadata
            .as_ref()
            .map(|metadata| metadata.transform_policy_fingerprint.clone()),
        transform_applied: metadata.map(|metadata| metadata.transform_applied),
    })
}

fn raw_export_provenance_sidecar_path(output_path: &Path) -> PathBuf {
    PathBuf::from(format!(
        "{}.rawengine-provenance.json",
        output_path.to_string_lossy()
    ))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(&bytes))))
}

fn write_raw_export_provenance_sidecar(
    output_path: &Path,
    source_path: &str,
    format: &str,
    byte_size: u64,
    edit_graph_revision: &str,
    raw_development_report: &RawDevelopmentReport,
) -> Result<String, String> {
    let sidecar_path = raw_export_provenance_sidecar_path(output_path);
    let sidecar = RawExportProvenanceSidecar {
        byte_size,
        completed_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        edit_graph_revision: edit_graph_revision.to_string(),
        format: format.to_string(),
        output_hash: sha256_file(output_path)?,
        output_path: output_path.to_string_lossy().to_string(),
        raw_development_report: raw_development_report.clone(),
        schema_version: 1,
        source_hash: sha256_file(Path::new(source_path))?,
        source_path: source_path.to_string(),
    };
    let json = serde_json::to_vec_pretty(&sidecar).map_err(|error| error.to_string())?;
    fs::write(&sidecar_path, json).map_err(|error| error.to_string())?;
    Ok(sidecar_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cancel_export(state: tauri::State<AppState>) -> Result<(), String> {
    request_export_cancellation(&state.export_job)?;
    println!("Export task cancellation requested.");
    Ok(())
}

#[tauri::command]
pub async fn estimate_export_sizes(
    paths: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    if output_format.to_lowercase() == "cube" {
        return Ok(1_050_000 * paths.len());
    }

    if paths.is_empty() {
        return Ok(0);
    }

    let first_path = &paths[0];
    let (source_path, sidecar_path) = parse_virtual_path(first_path);
    let source_path_str = source_path.to_string_lossy().to_string();

    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let is_current_edit = Some(&source_path_str) == current_edit_path.as_ref();
    let is_raw = is_raw_file(&source_path_str);
    let settings = load_settings_or_default(&app_handle);

    let single_image_extrapolated_size: usize = if let (true, Some(mut adjustments_clone)) =
        (is_current_edit, current_edit_adjustments)
    {
        let loaded_image = state
            .original_image
            .lock()
            .unwrap()
            .clone()
            .ok_or("No original image loaded")?;
        hydrate_adjustments(&state, &mut adjustments_clone);

        let new_transform_hash = calculate_transform_hash(&adjustments_clone);
        let cached_preview_lock = state.cached_preview.lock().unwrap();
        let preview_dim = settings.editor_preview_resolution.unwrap_or(1920);

        let (preview_image, scale, unscaled_crop_offset) = if let Some(cached) =
            &*cached_preview_lock
        {
            if cached.transform_hash == new_transform_hash && cached.preview_dim == preview_dim {
                let img = Arc::clone(&cached.image);
                let s = cached.scale;
                let offset = cached.unscaled_crop_offset;
                drop(cached_preview_lock);
                let owned_img = Arc::try_unwrap(img).unwrap_or_else(|arc| (*arc).clone());
                (owned_img, s, offset)
            } else {
                drop(cached_preview_lock);
                generate_transformed_preview(
                    &state,
                    &loaded_image,
                    &adjustments_clone,
                    preview_dim,
                )?
            }
        } else {
            drop(cached_preview_lock);
            generate_transformed_preview(&state, &loaded_image, &adjustments_clone, preview_dim)?
        };

        let (img_w, img_h) = preview_image.dimensions();
        let mask_definitions: Vec<MaskDefinition> = adjustments_clone
            .get("masks")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_default();

        let scaled_crop_offset = (
            unscaled_crop_offset.0 * scale,
            unscaled_crop_offset.1 * scale,
        );

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                get_cached_or_generate_mask(
                    &state,
                    def,
                    img_w,
                    img_h,
                    scale,
                    scaled_crop_offset,
                    &adjustments_clone,
                )
            })
            .collect();

        let render_inputs = prepare_export_render_inputs(
            &loaded_image.path,
            &adjustments_clone,
            &state,
            is_raw,
            resolve_tonemapper_override_from_handle(&app_handle, is_raw),
            1,
        );

        let processed_preview = process_and_get_dynamic_image(
            &context,
            &state,
            &preview_image,
            render_inputs.unique_hash,
            RenderRequest {
                adjustments: render_inputs.adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut: render_inputs.lut,
                roi: None,
            },
            "estimate_export_size",
        )?;

        let preview_bytes = encode_image_to_bytes(
            &processed_preview,
            &output_format,
            export_settings.jpeg_quality,
            &export_settings.color_profile,
            &export_settings.rendering_intent,
        )?;
        let preview_byte_size = preview_bytes.len();

        let (transformed_full_res, _) =
            apply_all_transformations(&loaded_image.image, &adjustments_clone);
        let (full_w, full_h) = transformed_full_res.dimensions();

        let (final_full_w, final_full_h) = if let Some(resize_opts) = &export_settings.resize {
            calculate_resize_target(full_w, full_h, resize_opts)
        } else {
            (full_w, full_h)
        };

        let (processed_preview_w, processed_preview_h) = processed_preview.dimensions();
        let pixel_ratio = if processed_preview_w > 0 && processed_preview_h > 0 {
            (final_full_w as f64 * final_full_h as f64)
                / (processed_preview_w as f64 * processed_preview_h as f64)
        } else {
            1.0
        };

        (preview_byte_size as f64 * pixel_ratio) as usize
    } else {
        let metadata = crate::exif_processing::load_sidecar(&sidecar_path);
        let mut js_adjustments = adjustments_with_raw_engine_artifacts(metadata);

        const ESTIMATE_DIM: u32 = 1280;

        let file_slice: Vec<u8>;
        let mmap_guard;
        let file_data: &[u8] = match read_file_mapped(Path::new(&source_path_str)) {
            Ok(mmap) => {
                mmap_guard = Some(mmap);
                mmap_guard.as_ref().unwrap()
            }
            Err(_) => {
                file_slice = fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                &file_slice
            }
        };

        let effective_settings =
            raw_processing_settings_for_adjustments(&settings, &js_adjustments);
        let original_image = load_base_image_from_bytes(
            file_data,
            &source_path_str,
            true,
            &effective_settings,
            None,
        )
        .map_err(|e| e.to_string())?;

        let raw_scale_factor = if is_raw {
            crate::raw_processing::get_fast_demosaic_scale_factor(
                file_data,
                original_image.width(),
                original_image.height(),
            )
        } else {
            1.0
        };

        if let Some(crop_val) = js_adjustments.get_mut("crop")
            && let Ok(c) = serde_json::from_value::<Crop>(crop_val.clone())
        {
            *crop_val = serde_json::to_value(Crop {
                x: c.x * raw_scale_factor as f64,
                y: c.y * raw_scale_factor as f64,
                width: c.width * raw_scale_factor as f64,
                height: c.height * raw_scale_factor as f64,
            })
            .unwrap_or(serde_json::Value::Null);
        }

        let (transformed_shrunk_res, unscaled_crop_offset) =
            apply_all_transformations(Cow::Borrowed(&original_image), &js_adjustments);
        let (shrunk_w, shrunk_h) = transformed_shrunk_res.dimensions();

        let preview_base = if shrunk_w > ESTIMATE_DIM || shrunk_h > ESTIMATE_DIM {
            downscale_f32_image(transformed_shrunk_res.as_ref(), ESTIMATE_DIM, ESTIMATE_DIM)
        } else {
            transformed_shrunk_res.into_owned()
        };

        let (preview_w, preview_h) = preview_base.dimensions();
        let gpu_scale = if shrunk_w > 0 {
            preview_w as f32 / shrunk_w as f32
        } else {
            1.0
        };
        let total_scale = gpu_scale * raw_scale_factor;

        let mask_definitions: Vec<MaskDefinition> = js_adjustments
            .get("masks")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_default();
        let scaled_crop_offset = (
            unscaled_crop_offset.0 * gpu_scale,
            unscaled_crop_offset.1 * gpu_scale,
        );

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                get_cached_or_generate_mask(
                    &state,
                    def,
                    preview_w,
                    preview_h,
                    total_scale,
                    scaled_crop_offset,
                    &js_adjustments,
                )
            })
            .collect();

        let render_inputs = prepare_export_render_inputs(
            &source_path_str,
            &js_adjustments,
            &state,
            is_raw,
            resolve_tonemapper_override_from_handle(&app_handle, is_raw),
            1,
        );

        let processed_preview = process_and_get_dynamic_image(
            &context,
            &state,
            &preview_base,
            render_inputs.unique_hash,
            RenderRequest {
                adjustments: render_inputs.adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut: render_inputs.lut,
                roi: None,
            },
            "estimate_batch_export_size",
        )?;

        let preview_bytes = encode_image_to_bytes(
            &processed_preview,
            &output_format,
            export_settings.jpeg_quality,
            &export_settings.color_profile,
            &export_settings.rendering_intent,
        )?;
        let single_image_estimated_size = preview_bytes.len();

        let full_w = (shrunk_w as f32 / raw_scale_factor).round() as u32;
        let full_h = (shrunk_h as f32 / raw_scale_factor).round() as u32;

        let (final_full_w, final_full_h) = if let Some(resize_opts) = &export_settings.resize {
            calculate_resize_target(full_w, full_h, resize_opts)
        } else {
            (full_w, full_h)
        };

        let (processed_preview_w, processed_preview_h) = processed_preview.dimensions();
        let pixel_ratio = if processed_preview_w > 0 && processed_preview_h > 0 {
            (final_full_w as f64 * final_full_h as f64)
                / (processed_preview_w as f64 * processed_preview_h as f64)
        } else {
            1.0
        };

        (single_image_estimated_size as f64 * pixel_ratio) as usize
    };

    Ok(single_image_extrapolated_size * paths.len())
}

#[cfg(test)]
mod tests {
    use super::{
        EmbeddedSourceIccProfile, ExportBlackPointCompensationStatus, ExportColorEngineId,
        ExportColorProfile, ExportRenderingIntent, ExportSettings, OutputSharpeningSettings,
        applied_export_color_policy, apply_export_resize_and_watermark, claim_export_job,
        commit_export_output, encode_icc_profile, encode_image_to_bytes,
        encode_image_with_working_color_state, export_color_profile_receipt_label,
        export_jpeg_rgb_pixels_and_profile, export_receipt_metadata, export_receipt_output,
        export_rgb_pixels_and_profile, export_rgb16_pixels_and_profile,
        export_rgb16_pixels_with_shared_conversion_core,
        export_soft_proof_rgb_pixels_and_profile_with_policy,
        export_soft_proof_rgb_pixels_with_working_color_state,
        export_source_precision_receipt_label, export_transform_options, finish_export_job,
        mox_rendering_intent, quantize_rgb16_to_rgb8, request_export_cancellation,
        resolve_export_color_capabilities, resolve_export_color_transform_plan,
        should_apply_srgb_perceptual_gamut_mapping,
    };
    use crate::color::working_to_output_transform::WorkingColorState;
    use crate::export::export_encoders::{
        encode_image_with_applied_policy, encode_image_with_applied_policy_and_source_profile,
        validate_export_file_readback_color_policy,
    };
    use crate::export::export_postprocess::OutputSharpeningTarget;
    use crate::export::export_processing::save_image_with_metadata;
    use crate::gamut_mapping::ACTIVE_SRGB_OKLAB_CHROMA_REDUCE;
    use crate::raw_processing::{RawCameraProfileReport, RawDemosaicPath, RawDevelopmentReport};
    use moxcms::ColorProfile;
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex};
    use std::{fs, io::Cursor, thread};

    use image::{
        ColorType, DynamicImage, ImageBuffer, ImageDecoder, Rgb, Rgba,
        codecs::{jpeg::JpegDecoder, tiff::TiffDecoder},
    };

    const SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE: &[u8] =
        include_bytes!("../../tests/fixtures/export/source-embedded-display-p3.jpg");
    const SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE_SHA256: &str =
        "b4f03738f6bdd7be65bd5b8afbd1448b0e57b207776c2fc016bd81d9c49986d6";
    const SOURCE_EMBEDDED_DISPLAY_P3_ICC_SHA256: &str =
        "sha256:d2ff5597fd937a24f90548f5e85803545334fcfd480601d19c3bc225d7355733";

    #[test]
    fn cancellation_claimed_before_gpu_initialization_prevents_runnable_export_work() {
        let registry = Arc::new(Mutex::new(None));
        let cancellation_token =
            claim_export_job(&registry).expect("export admission should claim job ownership");
        let initialization_started = Arc::new(Barrier::new(2));
        let release_initialization = Arc::new(Barrier::new(2));
        let runnable_work = Arc::new(AtomicUsize::new(0));
        let event_order = Arc::new(Mutex::new(Vec::new()));

        let initialization_thread = {
            let cancellation_token = Arc::clone(&cancellation_token);
            let initialization_started = Arc::clone(&initialization_started);
            let release_initialization = Arc::clone(&release_initialization);
            let runnable_work = Arc::clone(&runnable_work);
            let event_order = Arc::clone(&event_order);
            thread::spawn(move || {
                event_order.lock().unwrap().push("init-started");
                initialization_started.wait();
                release_initialization.wait();
                if cancellation_token.load(Ordering::SeqCst) {
                    event_order
                        .lock()
                        .unwrap()
                        .push("cancel-observed-before-schedule");
                    return;
                }
                runnable_work.fetch_add(1, Ordering::SeqCst);
                event_order.lock().unwrap().push("work-scheduled");
            })
        };

        initialization_started.wait();
        request_export_cancellation(&registry)
            .expect("cancel must be accepted while initialization is gated");
        event_order.lock().unwrap().push("cancel-accepted");
        release_initialization.wait();
        initialization_thread
            .join()
            .expect("initialization thread should finish");

        assert_eq!(
            runnable_work.load(Ordering::SeqCst),
            0,
            "cancelled jobs must schedule no work"
        );
        assert_eq!(
            event_order.lock().unwrap().as_slice(),
            [
                "init-started",
                "cancel-accepted",
                "cancel-observed-before-schedule"
            ],
            "cancellation must linearize before any runnable export work"
        );
        finish_export_job(&registry, &cancellation_token);
        assert!(
            registry.lock().unwrap().is_none(),
            "terminal cancellation must release job ownership"
        );
    }

    #[test]
    fn cancellation_after_committed_lut_image_and_mask_writes_keeps_each_output_receipt_eligible() {
        let directory = tempfile::tempdir().expect("temporary output directory should exist");

        for output_kind in ["lut", "image", "mask-image", "mask-alpha"] {
            let cancellation_token = AtomicBool::new(false);
            let output_path = directory.path().join(format!("{output_kind}.bin"));
            let events = Mutex::new(vec![format!("{output_kind}:rendered")]);

            let committed_path = commit_export_output(&cancellation_token, || {
                fs::write(&output_path, output_kind.as_bytes())
                    .map_err(|error| error.to_string())?;
                events
                    .lock()
                    .unwrap()
                    .push(format!("{output_kind}:write-committed"));
                cancellation_token.store(true, Ordering::SeqCst);
                events
                    .lock()
                    .unwrap()
                    .push(format!("{output_kind}:cancel-requested"));
                Ok(output_path.clone())
            })
            .expect("output write should succeed");

            let receipt_path = committed_path
                .expect("a write that completed before cancellation remains receiptable");
            events
                .lock()
                .unwrap()
                .push(format!("{output_kind}:receipt-recorded"));
            assert!(
                receipt_path.exists(),
                "{output_kind} write must be visible before its receipt is retained"
            );
            assert!(cancellation_token.load(Ordering::SeqCst));
            assert_eq!(
                events.lock().unwrap().as_slice(),
                [
                    format!("{output_kind}:rendered"),
                    format!("{output_kind}:write-committed"),
                    format!("{output_kind}:cancel-requested"),
                    format!("{output_kind}:receipt-recorded"),
                ],
                "{output_kind} receipt must follow its committed write even when cancellation wins the terminal state"
            );
        }
    }

    fn synthetic_export_edge() -> DynamicImage {
        let mut buffer = ImageBuffer::<Rgb<f32>, Vec<f32>>::new(11, 5);
        for y in 0..5 {
            for x in 0..11 {
                let value = if x < 5 { 0.3 } else { 0.7 };
                buffer.put_pixel(x, y, Rgb([value, value, value]));
            }
        }
        DynamicImage::ImageRgb32F(buffer)
    }

    fn base_export_settings(output_sharpening: Option<OutputSharpeningSettings>) -> ExportSettings {
        ExportSettings {
            black_point_compensation: false,
            color_profile: Default::default(),
            rendering_intent: Default::default(),
            jpeg_quality: 90,
            resize: None,
            keep_metadata: false,
            preserve_timestamps: false,
            strip_gps: true,
            filename_template: None,
            watermark: None,
            export_masks: false,
            output_sharpening,
            preserve_folders: false,
        }
    }

    fn red_channel(image: &DynamicImage, x: u32, y: u32) -> f32 {
        image.to_rgb32f().get_pixel(x, y).0[0]
    }

    fn synthetic_source_precision_path() -> String {
        export_source_precision_receipt_label(&synthetic_export_edge())
    }

    fn jpeg_icc_chunks(bytes: &[u8]) -> Vec<&[u8]> {
        let mut chunks = Vec::new();
        let mut index = 2usize;

        assert_eq!(&bytes[0..2], &[0xff, 0xd8], "expected JPEG SOI marker");

        while index + 4 <= bytes.len() {
            if bytes[index] != 0xff {
                break;
            }

            let marker = bytes[index + 1];
            index += 2;

            if marker == 0xda || marker == 0xd9 {
                break;
            }

            let length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
            let payload_start = index + 2;
            let payload_end = index + length;
            assert!(
                payload_end <= bytes.len(),
                "JPEG marker length exceeded buffer"
            );

            if marker == 0xe2 {
                let payload = &bytes[payload_start..payload_end];
                if payload.starts_with(b"ICC_PROFILE\0") {
                    chunks.push(payload);
                }
            }

            index = payload_end;
        }

        chunks
    }

    fn single_icc_payload(bytes: &[u8]) -> &[u8] {
        let chunks = jpeg_icc_chunks(bytes);
        assert_eq!(chunks.len(), 1, "expected one embedded ICC marker chunk");

        chunks[0]
    }

    fn normalize_icc_creation_time(mut profile: Vec<u8>) -> Vec<u8> {
        if profile.len() >= 36 {
            profile[24..36].fill(0);
        }
        profile
    }

    fn tiff_decoder(bytes: &[u8]) -> TiffDecoder<Cursor<&[u8]>> {
        TiffDecoder::new(Cursor::new(bytes)).expect("TIFF decoder should open exported bytes")
    }

    #[test]
    fn output_sharpening_increases_export_edge_contrast() {
        let before = synthetic_export_edge();
        let after = apply_export_resize_and_watermark(
            before.clone(),
            &base_export_settings(Some(OutputSharpeningSettings {
                target: OutputSharpeningTarget::Print,
                amount: 70.0,
                radius_px: 1.2,
                threshold: 0.0,
            })),
        )
        .expect("output sharpening should process");

        let before_contrast = red_channel(&before, 5, 2) - red_channel(&before, 4, 2);
        let after_contrast = red_channel(&after, 5, 2) - red_channel(&after, 4, 2);

        assert!(
            after_contrast > before_contrast,
            "output sharpening should increase final export edge contrast"
        );
    }

    #[test]
    fn disabled_output_sharpening_preserves_export_pixels() {
        let before = synthetic_export_edge();
        let after = apply_export_resize_and_watermark(before.clone(), &base_export_settings(None))
            .expect("disabled output sharpening should process");

        for y in 0..5 {
            for x in 0..11 {
                assert_eq!(red_channel(&after, x, y), red_channel(&before, x, y));
            }
        }
    }

    #[test]
    fn export_transform_options_use_requested_rendering_intent() {
        assert_eq!(
            export_transform_options(&ExportRenderingIntent::Perceptual).rendering_intent,
            mox_rendering_intent(&ExportRenderingIntent::Perceptual)
        );
        assert_eq!(
            export_transform_options(&ExportRenderingIntent::Saturation).rendering_intent,
            mox_rendering_intent(&ExportRenderingIntent::Saturation)
        );
        assert_eq!(
            export_transform_options(&ExportRenderingIntent::AbsoluteColorimetric).rendering_intent,
            mox_rendering_intent(&ExportRenderingIntent::AbsoluteColorimetric)
        );
    }

    #[test]
    fn export_color_capability_resolver_reports_color_engine_limits() {
        let catalog = resolve_export_color_capabilities();
        assert_eq!(catalog.schema_version, 1);
        assert_eq!(catalog.capabilities.len(), 5);

        for capability in &catalog.capabilities {
            assert!(matches!(capability.engine, ExportColorEngineId::Moxcms));
            if matches!(
                capability.color_profile,
                ExportColorProfile::AdobeRgb1998
                    | ExportColorProfile::DisplayP3
                    | ExportColorProfile::ProPhotoRgb
            ) {
                assert!(matches!(
                    capability.black_point_compensation,
                    ExportBlackPointCompensationStatus::Supported
                ));
            } else {
                assert!(matches!(
                    capability.black_point_compensation,
                    ExportBlackPointCompensationStatus::Unsupported
                ));
            }
            assert!(
                capability
                    .rendering_intents
                    .iter()
                    .any(|intent| matches!(intent, ExportRenderingIntent::RelativeColorimetric))
            );
            assert!(
                capability
                    .runtime_support_notes
                    .iter()
                    .any(|note| note.contains("LittleCMS enables black-point compensation"))
            );
        }

        assert!(
            catalog.capabilities.iter().any(|capability| matches!(
                capability.color_profile,
                ExportColorProfile::DisplayP3
            ))
        );
        let source_embedded = catalog
            .capabilities
            .iter()
            .find(|capability| {
                matches!(capability.color_profile, ExportColorProfile::SourceEmbedded)
            })
            .expect("source embedded capability should be advertised");
        assert_eq!(
            source_embedded.rendering_intents,
            vec![ExportRenderingIntent::RelativeColorimetric]
        );
        let srgb = catalog
            .capabilities
            .iter()
            .find(|capability| matches!(capability.color_profile, ExportColorProfile::Srgb))
            .expect("sRGB capability should be advertised");
        assert_eq!(
            srgb.rendering_intents,
            vec![
                ExportRenderingIntent::RelativeColorimetric,
                ExportRenderingIntent::Perceptual
            ]
        );
        for profile in [
            ExportColorProfile::AdobeRgb1998,
            ExportColorProfile::DisplayP3,
            ExportColorProfile::ProPhotoRgb,
        ] {
            let capability = catalog
                .capabilities
                .iter()
                .find(|capability| capability.color_profile == profile)
                .expect("wide-gamut capability should be advertised");
            assert_eq!(
                capability.rendering_intents,
                vec![ExportRenderingIntent::RelativeColorimetric]
            );
        }
    }

    #[test]
    fn export_receipt_reports_semantic_applied_policy() {
        let settings = base_export_settings(None);
        let metadata = export_receipt_metadata(
            "tiff",
            &settings.color_profile,
            &settings.rendering_intent,
            false,
            &synthetic_source_precision_path(),
            None,
        )
        .expect("TIFF receipt metadata should be available");

        assert_eq!(metadata.rendering_intent, "Relative colorimetric");
        assert_eq!(metadata.bit_depth, 16);
        assert_eq!(metadata.cmm, "moxcms");
        assert_eq!(
            metadata.color_managed_transform,
            "sRGB identity output; ICC embedded"
        );
        assert_eq!(metadata.effective_color_profile, "sRGB");
        assert!(metadata.icc_embedded);
        assert_eq!(metadata.policy_version, "rawengine-export-color-policy-v2");
        assert_eq!(metadata.policy_status, "applied");
        assert_eq!(metadata.requested_color_profile, "sRGB");
        assert_eq!(metadata.requested_rendering_intent, "Relative colorimetric");
        assert_eq!(metadata.effective_rendering_intent, "Relative colorimetric");
        assert!(metadata.resolved_disabled_reason.is_none());
        assert!(!metadata.transform_applied);
        assert_eq!(
            metadata.black_point_compensation,
            "Unavailable for this export path"
        );
        assert_eq!(
            metadata.source_precision_path,
            "rgb32f source; quantized only at color-managed encoder boundary"
        );
    }

    #[test]
    fn export_receipt_preserves_raw_development_report() {
        let output_path = std::env::temp_dir().join(format!(
            "rawengine-export-receipt-raw-report-{}.tiff",
            std::process::id()
        ));
        let source_path = std::env::temp_dir().join(format!(
            "rawengine-export-receipt-raw-source-{}.ARW",
            std::process::id()
        ));
        fs::write(&output_path, [0u8]).expect("write receipt output placeholder");
        fs::write(&source_path, [1u8, 2, 3, 4]).expect("write receipt source placeholder");
        let settings = base_export_settings(None);
        let metadata = export_receipt_metadata(
            "tiff",
            &settings.color_profile,
            &settings.rendering_intent,
            false,
            &synthetic_source_precision_path(),
            None,
        )
        .expect("TIFF receipt metadata should be available");
        let raw_development_report = RawDevelopmentReport {
            camera_profile: RawCameraProfileReport {
                algorithm_id: "dual_illuminant_mired_v1",
                candidate_count: 2,
                cct_clamped: Some(false),
                cool_illuminant: Some("D65".to_string()),
                cool_weight: Some(0.42),
                estimated_cct_kelvin: Some(5_100.0),
                fallback_reason: None,
                illuminant_estimate_confidence: "low",
                illuminant_estimate_method: "wb_coeff_ratio",
                matrix_hash: Some("blake3:abcdef0123456789".to_string()),
                status: "interpolated",
                warm_illuminant: Some("StandardLightA".to_string()),
                warning_codes: Vec::new(),
            },
            demosaic_algorithm_id: None,
            demosaic_path: RawDemosaicPath::BayerHq,
            processing_profile: crate::raw_processing::RawProcessingProfile::Maximum,
            input_transform: None,
            runtime: None,
            xtrans_hq: None,
        };

        let receipt = export_receipt_output(
            &output_path,
            &source_path.to_string_lossy(),
            "tiff",
            Some(metadata),
            Some(raw_development_report),
            Some("export_job:test".to_string()),
            Some(123),
        )
        .expect("receipt output should serialize RAW development report");
        let sidecar_path = receipt
            .raw_provenance_sidecar_path
            .as_ref()
            .expect("RAW export receipt includes provenance sidecar path");
        let sidecar_json =
            fs::read_to_string(sidecar_path).expect("read RAW export provenance sidecar");
        let sidecar: serde_json::Value =
            serde_json::from_str(&sidecar_json).expect("parse RAW export provenance sidecar");
        assert_eq!(sidecar["schemaVersion"], 1);
        assert_eq!(sidecar["editGraphRevision"], "export_job:test");
        assert_eq!(sidecar["rawDevelopmentReport"]["demosaicPath"], "bayer_hq");
        assert!(
            sidecar["sourceHash"]
                .as_str()
                .is_some_and(|value| value.starts_with("sha256:"))
        );
        assert!(
            sidecar["outputHash"]
                .as_str()
                .is_some_and(|value| value.starts_with("sha256:"))
        );
        fs::remove_file(sidecar_path).ok();
        fs::remove_file(source_path).ok();
        fs::remove_file(output_path).ok();

        let report = receipt
            .raw_development_report
            .expect("RAW export receipt includes development report");
        assert_eq!(report.camera_profile.status, "interpolated");
        assert_eq!(
            report.camera_profile.matrix_hash.as_deref(),
            Some("blake3:abcdef0123456789")
        );
        assert_eq!(report.demosaic_path, RawDemosaicPath::BayerHq);
    }

    #[test]
    fn export_receipt_preserves_rgba16_high_precision_source_provenance() {
        let image = DynamicImage::ImageRgba16(ImageBuffer::from_pixel(
            1,
            1,
            Rgba([u16::MAX, 32768, 0, u16::MAX]),
        ));
        let source_precision = export_source_precision_receipt_label(&image);
        let metadata = export_receipt_metadata(
            "tiff",
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            &source_precision,
            None,
        )
        .expect("TIFF receipt metadata should be available");

        assert_eq!(
            metadata.source_precision_path,
            "rgba16 source; high-precision shared RGB16 export/proof core; alpha dropped for RGB output"
        );
        assert!(metadata.transform_applied);
        assert_eq!(metadata.bit_depth, 16);
    }

    #[test]
    fn srgb_perceptual_export_receipt_reports_gamut_mapper() {
        let metadata = export_receipt_metadata(
            "tiff",
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::Perceptual,
            false,
            &synthetic_source_precision_path(),
            None,
        )
        .expect("TIFF receipt metadata should be available");

        assert_eq!(metadata.rendering_intent, "Perceptual");
        assert_eq!(
            metadata.color_managed_transform,
            format!("{ACTIVE_SRGB_OKLAB_CHROMA_REDUCE}; ICC embedded")
        );
        assert!(metadata.transform_applied);
    }

    #[test]
    fn display_p3_export_receipt_reports_transform_applied() {
        let mut settings = base_export_settings(None);
        settings.color_profile = ExportColorProfile::DisplayP3;
        let metadata = export_receipt_metadata(
            "jpg",
            &settings.color_profile,
            &settings.rendering_intent,
            false,
            &synthetic_source_precision_path(),
            None,
        )
        .expect("JPEG receipt metadata should be available");

        assert_eq!(
            metadata.color_managed_transform,
            "sRGB to Display P3 conversion applied"
        );
        assert_eq!(metadata.bit_depth, 8);
        assert_eq!(metadata.effective_color_profile, "Display P3");
        assert_eq!(metadata.requested_color_profile, "Display P3");
        assert_eq!(metadata.requested_rendering_intent, "Relative colorimetric");
        assert_eq!(metadata.effective_rendering_intent, "Relative colorimetric");
        assert!(metadata.transform_applied);
    }

    #[test]
    fn export_color_transform_plan_resolves_requested_and_effective_policy() {
        let plan = resolve_export_color_transform_plan(
            "tiff",
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::Perceptual,
            false,
        )
        .expect("sRGB perceptual TIFF policy should resolve");

        assert_eq!(plan.requested.color_profile, ExportColorProfile::Srgb);
        assert_eq!(
            plan.requested.rendering_intent,
            ExportRenderingIntent::Perceptual
        );
        assert_eq!(plan.effective_color_profile, ExportColorProfile::Srgb);
        assert_eq!(
            plan.effective_rendering_intent,
            ExportRenderingIntent::Perceptual
        );
        assert_eq!(plan.engine, ExportColorEngineId::Moxcms);
        assert_eq!(
            plan.black_point_compensation,
            ExportBlackPointCompensationStatus::Unsupported
        );
        assert_eq!(plan.status, "applied");
        assert!(plan.icc_embedded);
        assert!(plan.transform_applied);
        assert!(plan.disabled_reason.is_none());
    }

    #[test]
    fn export_receipt_fingerprint_tracks_resolved_transform_policy() {
        let source_precision = synthetic_source_precision_path();
        let relative = export_receipt_metadata(
            "jpg",
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            &source_precision,
            None,
        )
        .expect("Display P3 JPEG metadata should resolve");
        let relative_repeat = export_receipt_metadata(
            "jpg",
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            &source_precision,
            None,
        )
        .expect("Display P3 JPEG metadata should resolve repeatedly");
        let relative_bpc = export_receipt_metadata(
            "jpg",
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            true,
            &source_precision,
            None,
        )
        .expect("Display P3 JPEG BPC metadata should resolve");
        let srgb_perceptual = export_receipt_metadata(
            "jpg",
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::Perceptual,
            false,
            &source_precision,
            None,
        )
        .expect("sRGB perceptual metadata should resolve");

        assert_eq!(
            relative.transform_policy_fingerprint,
            relative_repeat.transform_policy_fingerprint
        );
        assert!(relative.transform_policy_fingerprint.starts_with("sha256:"));
        assert_ne!(
            relative.transform_policy_fingerprint, relative_bpc.transform_policy_fingerprint,
            "BPC changes must invalidate preview/export transform identity"
        );
        assert_ne!(
            relative.transform_policy_fingerprint, srgb_perceptual.transform_policy_fingerprint,
            "profile/intent changes must invalidate preview/export transform identity"
        );
    }

    #[test]
    fn tiff_relative_bpc_resolves_to_littlecms_policy() {
        let plan = resolve_export_color_transform_plan(
            "tiff",
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            true,
        )
        .expect("Display P3 TIFF BPC policy should resolve");

        assert_eq!(plan.engine, ExportColorEngineId::Lcms2);
        assert_eq!(
            plan.black_point_compensation,
            ExportBlackPointCompensationStatus::Supported
        );
        assert!(plan.requested.black_point_compensation_requested);
        assert!(plan.disabled_reason.is_none());
    }

    #[test]
    fn jpeg_relative_bpc_resolves_to_littlecms_policy() {
        let plan = resolve_export_color_transform_plan(
            "jpg",
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            true,
        )
        .expect("Display P3 JPEG BPC policy should resolve");

        assert_eq!(plan.engine, ExportColorEngineId::Lcms2);
        assert_eq!(
            plan.black_point_compensation,
            ExportBlackPointCompensationStatus::Supported
        );
        assert_eq!(applied_export_color_policy(plan, "synthetic").bit_depth, 8);
    }

    #[test]
    fn display_p3_tiff_bpc_encodes_with_littlecms_receipt() {
        let image = DynamicImage::ImageRgb16(ImageBuffer::from_fn(2, 1, |x, _| {
            if x == 0 {
                Rgb([1024, 2048, 4096])
            } else {
                Rgb([48_000, 36_000, 24_000])
            }
        }));
        let encoded = encode_image_with_applied_policy(
            &image,
            "tiff",
            90,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            true,
        )
        .expect("Display P3 TIFF BPC export should encode");
        let metadata = encoded
            .color_policy
            .expect("managed TIFF export should carry applied color policy");

        assert_eq!(metadata.cmm, "lcms2");
        assert_eq!(
            metadata.black_point_compensation,
            "Enabled via LittleCMS relative colorimetric transform"
        );
        assert!(!encoded.bytes.is_empty());
    }

    #[test]
    fn display_p3_jpeg_bpc_encodes_with_littlecms_receipt() {
        let image = DynamicImage::ImageRgb16(ImageBuffer::from_fn(2, 1, |x, _| {
            if x == 0 {
                Rgb([1024, 2048, 4096])
            } else {
                Rgb([48_000, 36_000, 24_000])
            }
        }));
        let encoded = encode_image_with_applied_policy(
            &image,
            "jpg",
            92,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            true,
        )
        .expect("Display P3 JPEG BPC export should encode");
        let metadata = encoded
            .color_policy
            .expect("managed JPEG export should carry applied color policy");
        let (jpeg_pixels, _, _, jpeg_profile) = export_jpeg_rgb_pixels_and_profile(
            &image,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            true,
        )
        .expect("Display P3 JPEG BPC RGB8 boundary should export");
        let (core_pixels, _, _, _) = export_rgb16_pixels_and_profile(
            &image,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            true,
        )
        .expect("Display P3 JPEG BPC shared RGB16 boundary should export");

        assert_eq!(metadata.cmm, "lcms2");
        assert_eq!(metadata.bit_depth, 8);
        assert_eq!(
            metadata.black_point_compensation,
            "Enabled via LittleCMS relative colorimetric transform"
        );
        assert_eq!(jpeg_pixels, quantize_rgb16_to_rgb8(&core_pixels));
        let embedded_profile =
            &single_icc_payload(&encoded.bytes)[b"ICC_PROFILE\0\x01\x01".len()..];
        let encoded_profile =
            encode_icc_profile(&jpeg_profile).expect("Display P3 JPEG output ICC should encode");
        assert_eq!(
            normalize_icc_creation_time(embedded_profile.to_vec()),
            normalize_icc_creation_time(encoded_profile),
            "Display P3 JPEG ICC should match the output profile apart from encoder timestamp"
        );
    }

    #[test]
    fn unsupported_bpc_request_is_reported_without_silent_enablement() {
        let metadata = export_receipt_metadata(
            "jpg",
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::Perceptual,
            true,
            &synthetic_source_precision_path(),
            None,
        )
        .expect("JPEG receipt metadata should be available");

        assert_eq!(metadata.cmm, "moxcms");
        assert_eq!(
            metadata.black_point_compensation,
            "Requested but disabled for this export path"
        );
        assert_eq!(
            metadata.resolved_disabled_reason.as_deref(),
            Some(
                "Black-point compensation is only available for JPEG/TIFF wide-gamut relative colorimetric LittleCMS exports."
            )
        );
    }

    #[test]
    fn unproven_wide_gamut_rendering_intents_are_rejected() {
        for profile in [
            ExportColorProfile::AdobeRgb1998,
            ExportColorProfile::DisplayP3,
            ExportColorProfile::ProPhotoRgb,
            ExportColorProfile::SourceEmbedded,
        ] {
            for intent in [
                ExportRenderingIntent::AbsoluteColorimetric,
                ExportRenderingIntent::Perceptual,
                ExportRenderingIntent::Saturation,
            ] {
                let error = resolve_export_color_transform_plan("jpg", &profile, &intent, false)
                    .expect_err("unproven non-relative intent should be rejected");

                assert!(
                    error.contains("does not have proven"),
                    "unexpected unproven intent error: {error}"
                );
            }
        }
    }

    #[test]
    fn unsupported_color_policy_rejects_before_encoding_output() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([128, 64, 32])));
        let error = encode_image_with_applied_policy(
            &image,
            "png",
            90,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect_err("wide-gamut PNG should fail before bytes are emitted");

        assert!(error.contains("Display P3 export is only supported for JPEG and TIFF"));
    }

    #[test]
    fn encoded_export_image_carries_applied_color_policy_only_for_managed_outputs() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([128, 64, 32])));
        let display_p3 = encode_image_with_applied_policy(
            &image,
            "jpg",
            90,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("Display P3 JPEG export should encode");
        let metadata = display_p3
            .color_policy
            .expect("managed JPEG export should carry applied color policy");

        assert!(display_p3.bytes.len() > b"ICC_PROFILE\0\x01\x01".len());
        assert_eq!(metadata.effective_color_profile, "Display P3");
        assert_eq!(metadata.requested_color_profile, "Display P3");
        assert_eq!(metadata.rendering_intent, "Relative colorimetric");
        assert!(metadata.transform_applied);

        let png = encode_image_with_applied_policy(
            &image,
            "png",
            90,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("PNG export should encode");

        assert!(png.color_policy.is_none());
    }

    #[test]
    fn jpeg_export_embeds_srgb_icc_profile() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([128, 64, 32])));
        let bytes = encode_image_to_bytes(
            &image,
            "jpg",
            90,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
        )
        .expect("JPEG encoding should include sRGB ICC profile");

        assert!(single_icc_payload(&bytes).len() > b"ICC_PROFILE\0\x01\x01".len());
    }

    #[test]
    fn tiff_export_writes_rgb16_pixels() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([128, 64, 32])));
        let bytes = encode_image_to_bytes(
            &image,
            "tiff",
            90,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
        )
        .expect("TIFF encoding should succeed");
        let decoder = tiff_decoder(&bytes);

        assert_eq!(decoder.color_type(), ColorType::Rgb16);
    }

    #[test]
    fn tiff_export_embeds_srgb_icc_profile() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([128, 64, 32])));
        let bytes = encode_image_to_bytes(
            &image,
            "tiff",
            90,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
        )
        .expect("TIFF encoding should include sRGB ICC profile");
        let mut decoder = tiff_decoder(&bytes);
        let icc_profile = decoder
            .icc_profile()
            .expect("TIFF ICC profile should be readable")
            .expect("TIFF export should include an embedded ICC profile");

        assert_eq!(
            icc_profile,
            encode_image_to_bytes(
                &image,
                "jpg",
                90,
                &ExportColorProfile::Srgb,
                &ExportRenderingIntent::RelativeColorimetric
            )
            .map(|jpeg| single_icc_payload(&jpeg)[b"ICC_PROFILE\0\x01\x01".len()..].to_vec())
            .expect("reference sRGB JPEG should encode")
        );
    }

    #[test]
    fn tiff_export_embeds_display_p3_icc_profile() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([128, 64, 32])));
        let srgb = encode_image_to_bytes(
            &image,
            "tiff",
            90,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
        )
        .expect("sRGB TIFF encoding should succeed");
        let display_p3 = encode_image_to_bytes(
            &image,
            "tiff",
            90,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
        )
        .expect("Display P3 TIFF encoding should succeed");
        let mut srgb_decoder = tiff_decoder(&srgb);
        let mut display_p3_decoder = tiff_decoder(&display_p3);

        assert_ne!(
            display_p3_decoder
                .icc_profile()
                .expect("Display P3 TIFF ICC should decode"),
            srgb_decoder
                .icc_profile()
                .expect("sRGB TIFF ICC should decode"),
            "Display P3 TIFF export should embed a distinct ICC profile"
        );
    }

    #[test]
    fn display_p3_tiff_export_transforms_rgb16_pixels() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([255, 0, 0])));
        let (srgb_pixels, _, _, _) = export_rgb16_pixels_and_profile(
            &image,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("sRGB TIFF export recipe should succeed");
        let (display_p3_pixels, _, _, _) = export_rgb16_pixels_and_profile(
            &image,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("Display P3 TIFF export recipe should succeed");

        assert_ne!(
            display_p3_pixels, srgb_pixels,
            "Display P3 TIFF export should transform 16-bit pixels before tagging them"
        );
    }

    #[test]
    fn jpeg_export_embeds_display_p3_icc_profile() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([128, 64, 32])));
        let srgb = encode_image_to_bytes(
            &image,
            "jpg",
            90,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
        )
        .expect("sRGB JPEG encoding should succeed");
        let display_p3 = encode_image_to_bytes(
            &image,
            "jpg",
            90,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
        )
        .expect("Display P3 JPEG encoding should succeed");

        assert_ne!(
            single_icc_payload(&display_p3),
            single_icc_payload(&srgb),
            "Display P3 export should embed a distinct ICC profile"
        );
    }

    #[test]
    fn display_p3_jpeg_export_transforms_rgb_pixels() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([255, 0, 0])));
        let (srgb_pixels, _, _, _) = export_rgb_pixels_and_profile(
            &image,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("sRGB export recipe should succeed");
        let (display_p3_pixels, _, _, _) = export_rgb_pixels_and_profile(
            &image,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("Display P3 export recipe should succeed");

        assert_ne!(
            display_p3_pixels, srgb_pixels,
            "Display P3 export should transform pixels before tagging them"
        );
    }

    #[test]
    fn jpeg_and_soft_proof_quantize_shared_16bit_conversion_core() {
        let pixels = [
            Rgb([0, 8, 32]),
            Rgb([64, 96, 128]),
            Rgb([160, 192, 224]),
            Rgb([255, 240, 208]),
        ];
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(2, 2, |x, y| {
            pixels[(y * 2 + x) as usize]
        }));

        let (core_pixels, width, height, _) = export_rgb16_pixels_with_shared_conversion_core(
            &image,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("Display P3 shared conversion core should run");
        let expected_rgb8 = quantize_rgb16_to_rgb8(&core_pixels);
        let (jpeg_pixels, jpeg_width, jpeg_height, _) = export_jpeg_rgb_pixels_and_profile(
            &image,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("Display P3 JPEG export should run");
        let (soft_proof_pixels, soft_proof_width, soft_proof_height, _) =
            export_soft_proof_rgb_pixels_and_profile_with_policy(
                &image,
                &ExportColorProfile::DisplayP3,
                &ExportRenderingIntent::RelativeColorimetric,
                false,
            )
            .expect("Display P3 soft proof should run");

        assert_eq!((jpeg_width, jpeg_height), (width, height));
        assert_eq!((soft_proof_width, soft_proof_height), (width, height));
        assert_eq!(jpeg_pixels, expected_rgb8);
        assert_eq!(soft_proof_pixels, expected_rgb8);
    }

    #[test]
    fn srgb_perceptual_export_maps_out_of_gamut_float_pixels() {
        let image = DynamicImage::ImageRgb32F(ImageBuffer::from_fn(2, 1, |x, _| {
            if x == 0 {
                Rgb([1.35, 0.05, 0.0])
            } else {
                Rgb([0.25, 0.5, 0.75])
            }
        }));
        let (relative_pixels, _, _, _) = export_rgb16_pixels_and_profile(
            &image,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("relative sRGB export should run");
        let (perceptual_pixels, _, _, _) = export_rgb16_pixels_and_profile(
            &image,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::Perceptual,
            false,
        )
        .expect("perceptual sRGB export should run");

        assert_ne!(
            perceptual_pixels[0..3],
            relative_pixels[0..3],
            "out-of-gamut pixel should use the perceptual sRGB mapper"
        );
        assert_eq!(
            perceptual_pixels[3..6],
            relative_pixels[3..6],
            "in-gamut pixel should remain identical"
        );
        assert!(should_apply_srgb_perceptual_gamut_mapping(
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::Perceptual
        ));
    }

    #[test]
    fn srgb_perceptual_soft_proof_matches_jpeg_export_rgb8_transform() {
        let image = DynamicImage::ImageRgb32F(ImageBuffer::from_fn(2, 1, |x, _| {
            if x == 0 {
                Rgb([1.35, 0.05, 0.0])
            } else {
                Rgb([0.25, 0.5, 0.75])
            }
        }));
        let (soft_proof_pixels, soft_proof_width, soft_proof_height, _) =
            export_soft_proof_rgb_pixels_and_profile_with_policy(
                &image,
                &ExportColorProfile::Srgb,
                &ExportRenderingIntent::Perceptual,
                false,
            )
            .expect("sRGB perceptual soft proof should run");
        let (jpeg_pixels, jpeg_width, jpeg_height, _) = export_jpeg_rgb_pixels_and_profile(
            &image,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::Perceptual,
            false,
        )
        .expect("sRGB perceptual JPEG export should run");

        assert_eq!(
            (soft_proof_width, soft_proof_height),
            (jpeg_width, jpeg_height)
        );
        assert_eq!(soft_proof_pixels, jpeg_pixels);
    }

    #[test]
    fn wide_gamut_export_profiles_transform_and_report_receipts() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([128, 64, 32])));

        for profile in [
            ExportColorProfile::AdobeRgb1998,
            ExportColorProfile::ProPhotoRgb,
            ExportColorProfile::DisplayP3,
        ] {
            let (_pixels, width, height, _output_profile) = export_jpeg_rgb_pixels_and_profile(
                &image,
                &profile,
                &ExportRenderingIntent::RelativeColorimetric,
                false,
            )
            .expect("wide-gamut profile should export through CMM");
            let metadata = export_receipt_metadata(
                "tiff",
                &profile,
                &ExportRenderingIntent::RelativeColorimetric,
                false,
                &export_source_precision_receipt_label(&image),
                None,
            )
            .expect("wide-gamut export should emit receipt metadata");

            assert_eq!((width, height), (1, 1));
            assert!(metadata.transform_applied);
            assert_eq!(metadata.bit_depth, 16);
            assert!(metadata.icc_embedded);
            assert_eq!(
                metadata.effective_color_profile,
                export_color_profile_receipt_label(&profile)
            );
            assert_eq!(
                metadata.color_managed_transform,
                format!(
                    "sRGB to {} conversion applied",
                    export_color_profile_receipt_label(&profile)
                )
            );
        }
    }

    #[test]
    fn export_icc_receipt_parity_reads_back_jpeg_and_tiff_profiles() {
        let image = DynamicImage::ImageRgb16(ImageBuffer::from_fn(3, 2, |x, y| {
            Rgb([((x + 1) * 10_000) as u16, ((y + 1) * 16_000) as u16, 42_000])
        }));

        for format in ["jpg", "tiff"] {
            for profile in [
                ExportColorProfile::Srgb,
                ExportColorProfile::DisplayP3,
                ExportColorProfile::ProPhotoRgb,
            ] {
                let encoded = encode_image_with_applied_policy(
                    &image,
                    format,
                    91,
                    &profile,
                    &ExportRenderingIntent::RelativeColorimetric,
                    false,
                )
                .expect("synthetic managed export should encode");
                let metadata = encoded
                    .color_policy
                    .as_ref()
                    .expect("JPEG/TIFF export should emit receipt metadata");

                assert!(metadata.icc_embedded);
                assert_eq!(
                    metadata.effective_color_profile,
                    export_color_profile_receipt_label(&profile)
                );
                assert_eq!(metadata.policy_status, "applied");
                assert_eq!(metadata.policy_version, "rawengine-export-color-policy-v2");
                assert!(metadata.transform_policy_fingerprint.starts_with("sha256:"));
                validate_export_file_readback_color_policy(
                    &encoded.bytes,
                    format,
                    Some(metadata),
                    &profile,
                    &ExportRenderingIntent::RelativeColorimetric,
                    false,
                    None,
                )
                .expect("file ICC readback should match receipt metadata");
            }
        }
    }

    #[test]
    fn export_icc_receipt_parity_fails_on_receipt_field_mismatch() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([128, 64, 32])));
        let encoded = encode_image_with_applied_policy(
            &image,
            "jpg",
            90,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("Display P3 JPEG should encode");
        let mut metadata = encoded
            .color_policy
            .clone()
            .expect("Display P3 JPEG should emit receipt metadata");
        metadata.effective_color_profile = "sRGB".to_string();

        let error = validate_export_file_readback_color_policy(
            &encoded.bytes,
            "jpg",
            Some(&metadata),
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            None,
        )
        .expect_err("receipt/file mismatch must fail the parity gate");

        assert!(
            error.contains("effectiveColorProfile"),
            "unexpected parity error: {error}"
        );
    }

    #[test]
    fn export_icc_receipt_parity_fails_on_source_embedded_hash_mismatch() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([128, 64, 32])));
        let source_icc =
            encode_icc_profile(&ColorProfile::new_adobe_rgb()).expect("source ICC should encode");
        let source_profile = EmbeddedSourceIccProfile {
            sha256: format!("sha256:{}", hex::encode(Sha256::digest(&source_icc))),
            bytes: source_icc,
        };
        let encoded = encode_image_with_applied_policy_and_source_profile(
            &image,
            "tiff",
            90,
            &ExportColorProfile::SourceEmbedded,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            Some(&source_profile),
        )
        .expect("SourceEmbedded TIFF should encode");
        let mut metadata = encoded
            .color_policy
            .clone()
            .expect("SourceEmbedded TIFF should emit receipt metadata");
        metadata.source_icc_profile_hash = Some(
            "sha256:0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        );

        let error = validate_export_file_readback_color_policy(
            &encoded.bytes,
            "tiff",
            Some(&metadata),
            &ExportColorProfile::SourceEmbedded,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            Some(&source_profile),
        )
        .expect_err("SourceEmbedded receipt hash mismatch must fail");

        assert!(
            error.contains("sourceIccProfileHash")
                || error.contains("transformPolicyFingerprint")
                || error.contains("SourceEmbedded receipt hash"),
            "unexpected parity error: {error}"
        );
    }

    #[test]
    fn export_icc_receipt_parity_validates_final_saved_file_bytes() {
        let image = DynamicImage::ImageRgb16(ImageBuffer::from_pixel(
            2,
            2,
            Rgb([u16::MAX, 24_000, 8_000]),
        ));
        let output_path = std::env::temp_dir().join(format!(
            "rawengine-export-icc-receipt-parity-{}.tiff",
            std::process::id()
        ));
        let source_path = std::env::temp_dir().join(format!(
            "rawengine-export-icc-receipt-parity-source-{}.jpg",
            std::process::id()
        ));
        fs::write(&source_path, [1u8, 2, 3, 4]).expect("write placeholder source");
        let mut settings = base_export_settings(None);
        settings.color_profile = ExportColorProfile::DisplayP3;
        settings.rendering_intent = ExportRenderingIntent::RelativeColorimetric;

        let metadata = save_image_with_metadata(
            &image,
            &output_path,
            &source_path.to_string_lossy(),
            &settings,
        )
        .expect("final export save should pass ICC/readback parity")
        .expect("TIFF export should return receipt metadata");
        let bytes = fs::read(&output_path).expect("read saved export bytes");

        validate_export_file_readback_color_policy(
            &bytes,
            "tiff",
            Some(&metadata),
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            None,
        )
        .expect("saved file readback should match receipt metadata");

        fs::remove_file(output_path).ok();
        fs::remove_file(source_path).ok();
    }

    #[test]
    fn source_embedded_export_profile_requires_embedded_icc_context() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([128, 64, 32])));
        let error = encode_image_with_applied_policy(
            &image,
            "jpg",
            90,
            &ExportColorProfile::SourceEmbedded,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect_err("source embedded profile should not silently export as sRGB");

        assert!(
            error.contains("requires a source ICC profile"),
            "unexpected source-embedded profile error: {error}"
        );
    }

    #[test]
    fn source_embedded_fixture_export_roundtrips_icc_and_truthful_receipt() {
        assert_eq!(
            hex::encode(Sha256::digest(SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE)),
            SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE_SHA256
        );
        let source_path = std::env::temp_dir().join(format!(
            "rawengine-source-embedded-fixture-source-{}.jpg",
            std::process::id()
        ));
        let output_path = std::env::temp_dir().join(format!(
            "rawengine-source-embedded-fixture-output-{}.jpg",
            std::process::id()
        ));
        fs::write(&source_path, SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE)
            .expect("write tagged JPEG source fixture");
        let image = image::load_from_memory(SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE)
            .expect("decode tagged JPEG source fixture");
        let mut settings = base_export_settings(None);
        settings.color_profile = ExportColorProfile::SourceEmbedded;
        settings.rendering_intent = ExportRenderingIntent::RelativeColorimetric;
        settings.black_point_compensation = false;

        let metadata = save_image_with_metadata(
            &image,
            &output_path,
            &source_path.to_string_lossy(),
            &settings,
        )
        .expect("source-embedded fixture export should save")
        .expect("source-embedded JPEG should emit color receipt metadata");
        let output_bytes = fs::read(&output_path).expect("read source-embedded export output");
        let mut source_decoder = JpegDecoder::new(Cursor::new(SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE))
            .expect("inspect source fixture JPEG");
        let source_icc = source_decoder
            .icc_profile()
            .expect("read source fixture ICC")
            .expect("source fixture should contain ICC");
        let expected_icc = normalize_icc_creation_time(
            encode_icc_profile(&ColorProfile::new_display_p3())
                .expect("encode expected moxcms Display P3 ICC"),
        );
        let mut output_decoder =
            JpegDecoder::new(Cursor::new(output_bytes.as_slice())).expect("inspect export JPEG");
        let output_icc = output_decoder
            .icc_profile()
            .expect("read export ICC")
            .expect("source-embedded export should contain ICC");

        assert_eq!(source_icc, expected_icc);
        assert_eq!(output_icc, source_icc);
        assert_eq!(
            format!("sha256:{}", hex::encode(Sha256::digest(&output_icc))),
            SOURCE_EMBEDDED_DISPLAY_P3_ICC_SHA256
        );
        assert_eq!(
            metadata.source_icc_profile_hash.as_deref(),
            Some(SOURCE_EMBEDDED_DISPLAY_P3_ICC_SHA256)
        );
        assert_eq!(metadata.color_profile, "Source embedded");
        assert_eq!(
            metadata.color_managed_transform,
            "Source embedded profile passthrough; ICC embedded"
        );
        assert_eq!(metadata.rendering_intent, "Relative colorimetric");
        assert!(metadata.icc_embedded);
        assert!(!metadata.transform_applied);
        assert!(metadata.transform_policy_fingerprint.starts_with("sha256:"));

        let receipt = export_receipt_output(
            &output_path,
            &source_path.to_string_lossy(),
            "jpg",
            Some(metadata),
            None,
            None,
            None,
        )
        .expect("build real output receipt");
        assert_eq!(receipt.color_profile.as_deref(), Some("Source embedded"));
        assert_eq!(receipt.icc_embedded, Some(true));
        assert_eq!(
            receipt.source_icc_profile_hash.as_deref(),
            Some(SOURCE_EMBEDDED_DISPLAY_P3_ICC_SHA256)
        );
        assert_eq!(receipt.transform_applied, Some(false));

        fs::remove_file(output_path).ok();
        fs::remove_file(source_path).ok();
    }

    #[test]
    fn raw_derived_source_embedded_export_is_explicitly_unavailable() {
        let source_path = std::env::temp_dir().join(format!(
            "rawengine-source-embedded-unavailable-{}.ARW",
            std::process::id()
        ));
        let output_path = std::env::temp_dir().join(format!(
            "rawengine-source-embedded-unavailable-{}.jpg",
            std::process::id()
        ));
        fs::write(&source_path, SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE)
            .expect("write RAW-derived source placeholder");
        let image = image::load_from_memory(SOURCE_EMBEDDED_DISPLAY_P3_FIXTURE)
            .expect("decode source pixels for unavailable proof");
        let mut settings = base_export_settings(None);
        settings.color_profile = ExportColorProfile::SourceEmbedded;

        let error = save_image_with_metadata(
            &image,
            &output_path,
            &source_path.to_string_lossy(),
            &settings,
        )
        .expect_err("RAW-derived source must not silently fall back to sRGB");

        assert_eq!(
            error,
            "Source embedded export profile requires a tagged JPEG or TIFF source."
        );
        assert!(!output_path.exists());
        fs::remove_file(source_path).ok();
    }

    #[test]
    fn source_embedded_jpeg_export_embeds_source_icc_and_receipt_hash() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([128, 64, 32])));
        let source_icc =
            encode_icc_profile(&ColorProfile::new_display_p3()).expect("source ICC should encode");
        let source_icc_hash = format!("sha256:{}", hex::encode(Sha256::digest(&source_icc)));
        let source_profile = EmbeddedSourceIccProfile {
            bytes: source_icc.clone(),
            sha256: source_icc_hash.clone(),
        };

        let encoded = encode_image_with_applied_policy_and_source_profile(
            &image,
            "jpg",
            90,
            &ExportColorProfile::SourceEmbedded,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            Some(&source_profile),
        )
        .expect("source embedded JPEG should encode with source ICC");
        let metadata = encoded
            .color_policy
            .expect("source embedded JPEG should emit receipt metadata");

        assert_eq!(
            &single_icc_payload(&encoded.bytes)[b"ICC_PROFILE\0\x01\x01".len()..],
            source_icc.as_slice()
        );
        assert_eq!(metadata.color_profile, "Source embedded");
        assert_eq!(
            metadata.color_managed_transform,
            "Source embedded profile passthrough; ICC embedded"
        );
        assert_eq!(
            metadata.source_icc_profile_hash.as_deref(),
            Some(source_icc_hash.as_str())
        );
        assert!(metadata.transform_policy_fingerprint.starts_with("sha256:"));
        assert!(!metadata.transform_applied);
    }

    #[test]
    fn source_embedded_tiff_export_embeds_source_icc() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([128, 64, 32])));
        let source_icc =
            encode_icc_profile(&ColorProfile::new_adobe_rgb()).expect("source ICC should encode");
        let source_profile = EmbeddedSourceIccProfile {
            sha256: format!("sha256:{}", hex::encode(Sha256::digest(&source_icc))),
            bytes: source_icc.clone(),
        };

        let encoded = encode_image_with_applied_policy_and_source_profile(
            &image,
            "tiff",
            90,
            &ExportColorProfile::SourceEmbedded,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            Some(&source_profile),
        )
        .expect("source embedded TIFF should encode with source ICC");
        let mut decoder = tiff_decoder(&encoded.bytes);
        let embedded_icc = decoder
            .icc_profile()
            .expect("TIFF ICC should read")
            .expect("TIFF ICC should be present");

        assert_eq!(embedded_icc, source_icc);
    }

    #[test]
    fn wide_gamut_profiles_are_rejected_for_formats_without_color_managed_output_path() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, Rgb([128, 64, 32])));

        for profile in [
            ExportColorProfile::AdobeRgb1998,
            ExportColorProfile::DisplayP3,
            ExportColorProfile::ProPhotoRgb,
        ] {
            for format in ["png", "webp", "jxl", "avif"] {
                let error = encode_image_to_bytes(
                    &image,
                    format,
                    90,
                    &profile,
                    &ExportRenderingIntent::RelativeColorimetric,
                )
                .expect_err("wide-gamut profile should require the color-managed JPEG/TIFF path");

                assert!(
                    error.contains("only supported for JPEG and TIFF"),
                    "unexpected wide-gamut format error: {error}"
                );
            }
        }
    }

    #[test]
    fn display_p3_soft_proof_matches_jpeg_export_rgb8_transform() {
        let pixels = [
            Rgb([255, 0, 0]),
            Rgb([32, 192, 64]),
            Rgb([8, 48, 224]),
            Rgb([240, 220, 32]),
            Rgb([16, 16, 16]),
            Rgb([250, 250, 250]),
        ];
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(3, 2, |x, y| {
            pixels[(y * 3 + x) as usize]
        }));

        let (soft_proof_pixels, soft_proof_width, soft_proof_height, _) =
            export_soft_proof_rgb_pixels_and_profile_with_policy(
                &image,
                &ExportColorProfile::DisplayP3,
                &ExportRenderingIntent::RelativeColorimetric,
                false,
            )
            .expect("Display P3 soft-proof RGB8 transform should succeed");
        let (jpeg_pixels, jpeg_width, jpeg_height, _) = export_jpeg_rgb_pixels_and_profile(
            &image,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("Display P3 JPEG export RGB8 transform should succeed");
        let (srgb_pixels, _, _, _) = export_jpeg_rgb_pixels_and_profile(
            &image,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .expect("sRGB JPEG export RGB8 transform should succeed");

        assert_eq!(
            (soft_proof_width, soft_proof_height),
            (jpeg_width, jpeg_height)
        );
        assert_eq!(
            soft_proof_pixels, jpeg_pixels,
            "soft proof must feed the same Display P3 RGB8 transform output as JPEG export"
        );
        assert_ne!(
            soft_proof_pixels, srgb_pixels,
            "fixture must exercise the Display P3 transform, not only dimension/identity plumbing"
        );
    }

    #[test]
    fn typed_ap1_soft_proof_and_real_outputs_share_pixels_and_embed_destination_profile() {
        let image = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(2, 1, |x, _| {
            if x == 0 {
                Rgba([0.9, 0.1, 0.05, 1.0])
            } else {
                Rgba([0.18, 0.18, 0.18, 1.0])
            }
        }));
        let (proof, width, height, profile) =
            export_soft_proof_rgb_pixels_with_working_color_state(
                &image,
                WorkingColorState::AcesCgLinearV1,
                &ExportColorProfile::DisplayP3,
                &ExportRenderingIntent::RelativeColorimetric,
                false,
            )
            .unwrap();
        let jpeg = encode_image_with_working_color_state(
            &image,
            WorkingColorState::AcesCgLinearV1,
            "jpg",
            95,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            None,
        )
        .unwrap();
        let tiff = encode_image_with_working_color_state(
            &image,
            WorkingColorState::AcesCgLinearV1,
            "tiff",
            95,
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            None,
        )
        .unwrap();

        assert_eq!((width, height), (2, 1));
        assert_eq!(proof.len(), 6);
        let expected_icc = encode_icc_profile(&profile).unwrap();
        let mut jpeg_decoder = JpegDecoder::new(Cursor::new(jpeg.bytes)).unwrap();
        assert_eq!(jpeg_decoder.icc_profile().unwrap().unwrap(), expected_icc);
        let mut tiff_decoder = TiffDecoder::new(Cursor::new(tiff.bytes)).unwrap();
        assert_eq!(tiff_decoder.icc_profile().unwrap().unwrap(), expected_icc);
        assert_eq!(tiff_decoder.dimensions(), (2, 1));
        assert_eq!(tiff_decoder.color_type(), ColorType::Rgb16);
    }
}
