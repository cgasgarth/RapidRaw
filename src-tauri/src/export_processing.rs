use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{SecondsFormat, Utc};
use image::{
    DynamicImage, ExtendedColorType, GenericImageView, GrayImage, ImageBuffer, ImageDecoder,
    ImageEncoder, ImageFormat, Luma,
    codecs::{jpeg::JpegDecoder, tiff::TiffDecoder, tiff::TiffEncoder},
    imageops,
};
use jxl_encoder::{LosslessConfig, LossyConfig, PixelLayout};
use lcms2::{
    Flags as LcmsFlags, Intent as LcmsIntent, PixelFormat as LcmsPixelFormat,
    Profile as LcmsProfile, Transform as LcmsTransform,
};
use moxcms::{ColorProfile, Layout, RenderingIntent as MoxRenderingIntent, TransformOptions};
use mozjpeg_rs::{Encoder as MozJpegEncoder, Preset};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tauri::Manager;

use crate::AppState;
use crate::exif_processing;
use crate::file_management::{
    generate_filename_from_template, parse_virtual_path, read_file_mapped,
};
use crate::formats::is_raw_file;
use crate::gamut_mapping::{
    SRGB_OKLAB_CHROMA_REDUCE_V1, map_srgb_oklab_chroma_reduce_rgb16_pixels,
};
use crate::image_loader::{
    composite_patches_on_image, load_and_composite, load_base_image_from_bytes,
    raw_processing_settings_for_adjustments,
};
use crate::image_processing::{
    AllAdjustments, Crop, GpuContext, RenderRequest, downscale_f32_image,
    get_all_adjustments_from_json, get_or_init_gpu_context, process_and_get_dynamic_image,
    process_and_get_unclamped_dynamic_image, resolve_tonemapper_override_from_handle,
};
use crate::lut_processing::{convert_image_to_cube_lut, generate_identity_lut_image};
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};

use crate::cache_utils::{calculate_full_job_hash, calculate_transform_hash};
use crate::deblur_render::apply_deblur_stage;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportReceiptOutput {
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
    total: usize,
}
use crate::denoise_render::apply_denoise_stage;
use crate::wavelet_render::apply_wavelet_detail_stage;
use crate::{
    apply_all_transformations, generate_transformed_preview, get_cached_or_generate_mask,
    get_full_image_for_processing, get_or_load_lut, hydrate_adjustments, load_settings_or_default,
    resolve_warped_image_for_masks,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum ResizeMode {
    LongEdge,
    ShortEdge,
    Width,
    Height,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResizeOptions {
    pub mode: ResizeMode,
    pub value: u32,
    pub dont_enlarge: bool,
}

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

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportColorProfile {
    #[default]
    Srgb,
    DisplayP3,
    AdobeRgb1998,
    ProPhotoRgb,
    SourceEmbedded,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportRenderingIntent {
    AbsoluteColorimetric,
    Perceptual,
    #[default]
    RelativeColorimetric,
    Saturation,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportColorEngineId {
    Lcms2,
    Moxcms,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportBlackPointCompensationStatus {
    Supported,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RequestedColorPolicy {
    black_point_compensation_requested: bool,
    color_profile: ExportColorProfile,
    output_format: String,
    rendering_intent: ExportRenderingIntent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedColorTransformPlan {
    black_point_compensation: ExportBlackPointCompensationStatus,
    disabled_reason: Option<String>,
    effective_color_profile: ExportColorProfile,
    effective_rendering_intent: ExportRenderingIntent,
    engine: ExportColorEngineId,
    icc_embedded: bool,
    requested: RequestedColorPolicy,
    status: String,
    transform_applied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AppliedColorPolicy {
    bit_depth: u8,
    color_managed_transform: String,
    plan: ResolvedColorTransformPlan,
    policy_version: String,
    source_precision_path: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportColorCapability {
    pub black_point_compensation: ExportBlackPointCompensationStatus,
    pub color_profile: ExportColorProfile,
    pub engine: ExportColorEngineId,
    pub rendering_intents: Vec<ExportRenderingIntent>,
    pub runtime_support_notes: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportColorCapabilityCatalog {
    pub capabilities: Vec<ExportColorCapability>,
    pub engine: ExportColorEngineId,
    pub schema_version: u8,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum OutputSharpeningTarget {
    Screen,
    Print,
    Custom,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutputSharpeningSettings {
    pub target: OutputSharpeningTarget,
    pub amount: f32,
    pub radius_px: f32,
    pub threshold: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum WatermarkAnchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkSettings {
    pub path: String,
    pub anchor: WatermarkAnchor,
    pub scale: f32,
    pub spacing: f32,
    pub opacity: f32,
}

fn apply_watermark(
    base_image: &mut DynamicImage,
    watermark_settings: &WatermarkSettings,
) -> Result<(), String> {
    let watermark_img = image::open(&watermark_settings.path)
        .map_err(|e| format!("Failed to open watermark image: {}", e))?;

    let (base_w, base_h) = base_image.dimensions();
    let base_min_dim = base_w.min(base_h) as f32;

    let watermark_scale_factor =
        (base_min_dim * (watermark_settings.scale / 100.0)) / watermark_img.width().max(1) as f32;
    let new_wm_w = (watermark_img.width() as f32 * watermark_scale_factor).round() as u32;
    let new_wm_h = (watermark_img.height() as f32 * watermark_scale_factor).round() as u32;

    if new_wm_w == 0 || new_wm_h == 0 {
        return Ok(());
    }

    let scaled_watermark =
        watermark_img.resize_exact(new_wm_w, new_wm_h, image::imageops::FilterType::Lanczos3);
    let mut scaled_watermark_rgba = scaled_watermark.to_rgba8();

    let opacity_factor = (watermark_settings.opacity / 100.0).clamp(0.0, 1.0);
    for pixel in scaled_watermark_rgba.pixels_mut() {
        pixel[3] = (pixel[3] as f32 * opacity_factor) as u8;
    }
    let final_watermark = DynamicImage::ImageRgba8(scaled_watermark_rgba);

    let spacing_pixels = (base_min_dim * (watermark_settings.spacing / 100.0)) as i64;
    let (wm_w, wm_h) = final_watermark.dimensions();

    let x = match watermark_settings.anchor {
        WatermarkAnchor::TopLeft | WatermarkAnchor::CenterLeft | WatermarkAnchor::BottomLeft => {
            spacing_pixels
        }
        WatermarkAnchor::TopCenter | WatermarkAnchor::Center | WatermarkAnchor::BottomCenter => {
            (base_w as i64 - wm_w as i64) / 2
        }
        WatermarkAnchor::TopRight | WatermarkAnchor::CenterRight | WatermarkAnchor::BottomRight => {
            base_w as i64 - wm_w as i64 - spacing_pixels
        }
    };

    let y = match watermark_settings.anchor {
        WatermarkAnchor::TopLeft | WatermarkAnchor::TopCenter | WatermarkAnchor::TopRight => {
            spacing_pixels
        }
        WatermarkAnchor::CenterLeft | WatermarkAnchor::Center | WatermarkAnchor::CenterRight => {
            (base_h as i64 - wm_h as i64) / 2
        }
        WatermarkAnchor::BottomLeft
        | WatermarkAnchor::BottomCenter
        | WatermarkAnchor::BottomRight => base_h as i64 - wm_h as i64 - spacing_pixels,
    };

    image::imageops::overlay(base_image, &final_watermark, x, y);

    Ok(())
}

fn calculate_resize_target(
    current_w: u32,
    current_h: u32,
    resize_opts: &ResizeOptions,
) -> (u32, u32) {
    if resize_opts.dont_enlarge {
        let exceeds = match resize_opts.mode {
            ResizeMode::LongEdge => current_w.max(current_h) > resize_opts.value,
            ResizeMode::ShortEdge => current_w.min(current_h) > resize_opts.value,
            ResizeMode::Width => current_w > resize_opts.value,
            ResizeMode::Height => current_h > resize_opts.value,
        };
        if !exceeds {
            return (current_w, current_h);
        }
    }

    let fix_width = match resize_opts.mode {
        ResizeMode::LongEdge => current_w >= current_h,
        ResizeMode::ShortEdge => current_w <= current_h,
        ResizeMode::Width => true,
        ResizeMode::Height => false,
    };

    let value = resize_opts.value;
    if fix_width {
        let h = (value as f32 * (current_h as f32 / current_w as f32)).round() as u32;
        (value, h)
    } else {
        let w = (value as f32 * (current_w as f32 / current_h as f32)).round() as u32;
        (w, value)
    }
}

fn apply_export_resize_and_watermark(
    mut image: DynamicImage,
    export_settings: &ExportSettings,
) -> Result<DynamicImage, String> {
    if let Some(resize_opts) = &export_settings.resize {
        let (current_w, current_h) = image.dimensions();
        let (target_w, target_h) = calculate_resize_target(current_w, current_h, resize_opts);

        if target_w != current_w || target_h != current_h {
            image = image.resize(target_w, target_h, imageops::FilterType::Lanczos3);
        }
    }

    if let Some(output_sharpening) = &export_settings.output_sharpening {
        image = apply_output_sharpening(image, output_sharpening);
    }

    if let Some(watermark_settings) = &export_settings.watermark {
        apply_watermark(&mut image, watermark_settings)?;
    }
    Ok(image)
}

fn apply_output_sharpening(
    image: DynamicImage,
    settings: &OutputSharpeningSettings,
) -> DynamicImage {
    let amount = (settings.amount / 100.0).clamp(0.0, 1.0);
    if amount <= 0.0 {
        return image;
    }

    let target_multiplier = match settings.target {
        OutputSharpeningTarget::Screen => 0.8,
        OutputSharpeningTarget::Print => 1.15,
        OutputSharpeningTarget::Custom => 1.0,
    };
    let effective_amount = amount * target_multiplier;
    let threshold = settings.threshold.clamp(0.0, 1.0);
    let radius = settings.radius_px.clamp(0.3, 3.0);

    let mut output = image.to_rgb32f();
    let blurred = DynamicImage::ImageRgb32F(output.clone())
        .blur(radius)
        .to_rgb32f();
    let output_pixels = output.as_mut();
    let blurred_pixels = blurred.as_raw();

    for (out, blurred) in output_pixels.chunks_mut(3).zip(blurred_pixels.chunks(3)) {
        let detail_r = out[0] - blurred[0];
        let detail_g = out[1] - blurred[1];
        let detail_b = out[2] - blurred[2];
        let detail_luma = (0.299 * detail_r + 0.587 * detail_g + 0.114 * detail_b).abs();

        if detail_luma >= threshold {
            out[0] = (out[0] + detail_r * effective_amount).clamp(0.0, 1.0);
            out[1] = (out[1] + detail_g * effective_amount).clamp(0.0, 1.0);
            out[2] = (out[2] + detail_b * effective_amount).clamp(0.0, 1.0);
        }
    }

    DynamicImage::ImageRgb32F(output)
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
    let (transformed_image, mask_bitmaps) = prepare_export_masks(base_image, js_adjustments, state);
    let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
    process_image_for_export_pipeline_with_tonemapper_override(
        path,
        transformed_image.as_ref(),
        js_adjustments,
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
    let mut all_adjustments = get_all_adjustments_from_json(js_adjustments, is_raw, tm_override);
    all_adjustments.global.show_clipping = 0;

    let lut_path = js_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());

    let unique_hash = calculate_full_job_hash(path, js_adjustments);

    let denoised_image = apply_denoise_stage(transformed_image, js_adjustments);
    let deblurred_image = apply_deblur_stage(denoised_image.as_ref(), js_adjustments);
    let wavelet_image = apply_wavelet_detail_stage(deblurred_image.image.as_ref(), js_adjustments);
    let retouched_image = crate::retouch_render::apply_clone_retouch_layers(
        wavelet_image.as_ref(),
        js_adjustments,
        mask_bitmaps,
    );

    process_and_get_unclamped_dynamic_image(
        context,
        state,
        retouched_image.as_ref(),
        unique_hash,
        RenderRequest {
            adjustments: all_adjustments,
            mask_bitmaps,
            lut,
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

    let encoded_image = encode_image_with_applied_policy_and_source_profile(
        image,
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

#[derive(Debug)]
struct EncodedExportImage {
    bytes: Vec<u8>,
    color_policy: Option<ExportReceiptMetadata>,
}

#[derive(Debug)]
struct EmbeddedSourceIccProfile {
    bytes: Vec<u8>,
    sha256: String,
}

fn encode_image_to_bytes(
    image: &DynamicImage,
    output_format: &str,
    jpeg_quality: u8,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> Result<Vec<u8>, String> {
    encode_image_with_applied_policy(
        image,
        output_format,
        jpeg_quality,
        color_profile,
        rendering_intent,
        false,
    )
    .map(|encoded| encoded.bytes)
}

fn encode_image_with_applied_policy(
    image: &DynamicImage,
    output_format: &str,
    jpeg_quality: u8,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<EncodedExportImage, String> {
    encode_image_with_applied_policy_and_source_profile(
        image,
        output_format,
        jpeg_quality,
        color_profile,
        rendering_intent,
        black_point_compensation,
        None,
    )
}

fn encode_image_with_applied_policy_and_source_profile(
    image: &DynamicImage,
    output_format: &str,
    jpeg_quality: u8,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_embedded_icc: Option<&EmbeddedSourceIccProfile>,
) -> Result<EncodedExportImage, String> {
    validate_export_color_policy(output_format, color_profile)?;
    let normalized_format = output_format.to_lowercase();

    let mut image_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut image_bytes);

    match normalized_format.as_str() {
        "jxl" => {
            let (width, height) = image.dimensions();
            let has_alpha = image.color().has_alpha();

            let jxl_data = if jpeg_quality == 100 {
                if has_alpha {
                    let rgba = image.to_rgba8();
                    LosslessConfig::new()
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    LosslessConfig::new()
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                }
            } else {
                let distance = (100.0 - jpeg_quality as f32) / 10.0;
                let distance = distance.max(0.01);

                if has_alpha {
                    let rgba = image.to_rgba8();
                    LossyConfig::new(distance)
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    LossyConfig::new(distance)
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                }
            };

            return Ok(EncodedExportImage {
                bytes: jxl_data,
                color_policy: None,
            });
        }
        "webp" => {
            let encoder = webp::Encoder::from_image(image)
                .map_err(|_| "Failed to create WebP encoder".to_string())?;
            let webp_mem = encoder.encode(jpeg_quality as f32);
            return Ok(EncodedExportImage {
                bytes: webp_mem.to_vec(),
                color_policy: None,
            });
        }
        "jpg" | "jpeg" => {
            return Ok(EncodedExportImage {
                bytes: encode_jpeg_to_bytes(
                    image,
                    jpeg_quality,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                    source_embedded_icc,
                )?,
                color_policy: export_receipt_metadata(
                    &normalized_format,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                    &export_source_precision_receipt_label(image),
                    source_embedded_icc.map(|profile| profile.sha256.clone()),
                ),
            });
        }
        "png" => {
            let image_to_encode = if image.as_rgb32f().is_some() {
                DynamicImage::ImageRgb16(image.to_rgb16())
            } else {
                image.clone()
            };

            image_to_encode
                .write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        }
        "tiff" => {
            return Ok(EncodedExportImage {
                bytes: encode_tiff16_to_bytes(
                    image,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                    source_embedded_icc,
                )?,
                color_policy: export_receipt_metadata(
                    &normalized_format,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                    &export_source_precision_receipt_label(image),
                    source_embedded_icc.map(|profile| profile.sha256.clone()),
                ),
            });
        }
        "avif" => {
            image
                .write_to(&mut cursor, image::ImageFormat::Avif)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unsupported file format: {}", output_format)),
    };
    Ok(EncodedExportImage {
        bytes: image_bytes,
        color_policy: None,
    })
}

fn encode_tiff16_to_bytes(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_embedded_icc: Option<&EmbeddedSourceIccProfile>,
) -> Result<Vec<u8>, String> {
    let (pixels, width, height, icc_profile) =
        if matches!(color_profile, ExportColorProfile::SourceEmbedded) {
            let (pixels, width, height) =
                export_source_rgb16_pixels(image, color_profile, rendering_intent);
            let source_icc = source_embedded_icc.ok_or_else(|| {
                "Source embedded export profile requires a source ICC profile.".to_string()
            })?;
            (pixels, width, height, source_icc.bytes.clone())
        } else {
            let (pixels, width, height, output_profile) = export_rgb16_pixels_and_profile(
                image,
                color_profile,
                rendering_intent,
                black_point_compensation,
            )?;
            (pixels, width, height, encode_icc_profile(&output_profile)?)
        };
    let mut image_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut image_bytes);
    let mut encoder = TiffEncoder::new(&mut cursor);

    encoder
        .set_icc_profile(icc_profile)
        .map_err(|e| format!("Failed to attach TIFF ICC profile: {}", e))?;
    encoder
        .write_image(
            bytemuck::cast_slice(&pixels),
            width,
            height,
            ExtendedColorType::Rgb16,
        )
        .map_err(|e| format!("Failed to encode 16-bit TIFF: {}", e))?;

    Ok(image_bytes)
}

fn export_rgb16_pixels_and_profile(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u16>, u32, u32, ColorProfile), String> {
    export_rgb16_pixels_with_shared_conversion_core(
        image,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )
}

fn export_rgb16_pixels_with_shared_conversion_core(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u16>, u32, u32, ColorProfile), String> {
    let (pixels, width, height) =
        export_source_rgb16_pixels(image, color_profile, rendering_intent);
    let output_profile = output_color_profile(color_profile)?;

    if export_color_profile_requires_transform(color_profile) {
        if black_point_compensation
            && is_lcms_relative_bpc_supported("tiff", color_profile, rendering_intent)
        {
            let transformed = transform_rgb16_with_lcms(
                &pixels,
                &output_profile,
                color_profile,
                rendering_intent,
                true,
            )?;
            return Ok((transformed, width, height, output_profile));
        }

        let src_profile = ColorProfile::new_srgb();
        let profile_label = export_color_profile_receipt_label(color_profile);
        let transform = src_profile
            .create_transform_16bit(
                Layout::Rgb,
                &output_profile,
                Layout::Rgb,
                export_transform_options(rendering_intent),
            )
            .map_err(|e| format!("Failed to build {profile_label} export transform: {e}"))?;
        let row_len = (width as usize)
            .checked_mul(3)
            .ok_or_else(|| "Export row is too wide".to_string())?;
        let mut transformed = vec![0u16; pixels.len()];

        for (src_row, dst_row) in pixels
            .chunks_exact(row_len)
            .zip(transformed.chunks_exact_mut(row_len))
        {
            transform
                .transform(src_row, dst_row)
                .map_err(|e| format!("Failed to convert export to {profile_label}: {e}"))?;
        }

        Ok((transformed, width, height, output_profile))
    } else {
        Ok((pixels, width, height, output_profile))
    }
}

fn export_source_rgb16_pixels(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> (Vec<u16>, u32, u32) {
    if should_apply_srgb_perceptual_gamut_mapping(color_profile, rendering_intent) {
        if let Some(rgb32f) = image.as_rgb32f() {
            return (
                map_srgb_oklab_chroma_reduce_rgb16_pixels(rgb32f.as_raw()),
                rgb32f.width(),
                rgb32f.height(),
            );
        }

        if let Some(rgba32f) = image.as_rgba32f() {
            let rgb: Vec<f32> = rgba32f
                .as_raw()
                .chunks_exact(4)
                .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
                .collect();

            return (
                map_srgb_oklab_chroma_reduce_rgb16_pixels(&rgb),
                rgba32f.width(),
                rgba32f.height(),
            );
        }
    }

    let rgb_image = image.to_rgb16();
    let (width, height) = rgb_image.dimensions();
    (rgb_image.into_raw(), width, height)
}

fn should_apply_srgb_perceptual_gamut_mapping(
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> bool {
    matches!(color_profile, ExportColorProfile::Srgb)
        && matches!(rendering_intent, ExportRenderingIntent::Perceptual)
}

fn encode_jpeg_to_bytes(
    image: &DynamicImage,
    jpeg_quality: u8,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_embedded_icc: Option<&EmbeddedSourceIccProfile>,
) -> Result<Vec<u8>, String> {
    let (rgb_pixels, width, height, icc_profile) =
        if matches!(color_profile, ExportColorProfile::SourceEmbedded) {
            let (rgb16_pixels, width, height) =
                export_source_rgb16_pixels(image, color_profile, rendering_intent);
            let source_icc = source_embedded_icc.ok_or_else(|| {
                "Source embedded export profile requires a source ICC profile.".to_string()
            })?;
            (
                quantize_rgb16_to_rgb8(&rgb16_pixels),
                width,
                height,
                source_icc.bytes.clone(),
            )
        } else {
            let (rgb_pixels, width, height, output_profile) = export_jpeg_rgb_pixels_and_profile(
                image,
                color_profile,
                rendering_intent,
                black_point_compensation,
            )?;
            (
                rgb_pixels,
                width,
                height,
                encode_icc_profile(&output_profile)?,
            )
        };

    MozJpegEncoder::new(Preset::BaselineBalanced)
        .quality(jpeg_quality.clamp(1, 100))
        .icc_profile(icc_profile)
        .encode_rgb(&rgb_pixels, width, height)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))
}

pub(crate) fn export_jpeg_rgb_pixels_and_profile(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u8>, u32, u32, ColorProfile), String> {
    export_rgb_pixels_and_profile(
        image,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )
}

pub(crate) fn export_soft_proof_rgb_pixels_and_profile_with_policy(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u8>, u32, u32, ColorProfile), String> {
    export_rgb_pixels_and_profile(
        image,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )
}

pub(crate) fn export_soft_proof_transform_metadata(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<ExportReceiptMetadata, String> {
    export_receipt_metadata(
        "jpg",
        color_profile,
        rendering_intent,
        black_point_compensation,
        &export_source_precision_receipt_label(image),
        None,
    )
    .ok_or_else(|| "Failed to resolve export soft-proof transform metadata.".to_string())
}

fn export_rgb_pixels_and_profile(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u8>, u32, u32, ColorProfile), String> {
    let (pixels, width, height, output_profile) = export_rgb16_pixels_with_shared_conversion_core(
        image,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )?;
    Ok((
        quantize_rgb16_to_rgb8(&pixels),
        width,
        height,
        output_profile,
    ))
}

fn quantize_rgb16_to_rgb8(pixels: &[u16]) -> Vec<u8> {
    pixels
        .iter()
        .map(|value| (((*value as u32) + 128) / 257) as u8)
        .collect()
}

fn transform_rgb16_with_lcms(
    pixels: &[u16],
    output_profile: &ColorProfile,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<Vec<u16>, String> {
    if !pixels.len().is_multiple_of(3) {
        return Err("RGB16 export pixel buffer is not divisible by three channels.".to_string());
    }

    let src_profile = LcmsProfile::new_srgb();
    let output_icc = encode_icc_profile(output_profile)?;
    let dst_profile = LcmsProfile::new_icc(&output_icc).map_err(|error| {
        format!(
            "Failed to open {} output ICC for LittleCMS: {error}",
            export_color_profile_receipt_label(color_profile)
        )
    })?;
    let flags = if black_point_compensation {
        LcmsFlags::BLACKPOINT_COMPENSATION | LcmsFlags::NO_CACHE
    } else {
        LcmsFlags::NO_CACHE
    };
    let transform = LcmsTransform::<[u16; 3], [u16; 3], _, _>::new_flags(
        &src_profile,
        LcmsPixelFormat::RGB_16,
        &dst_profile,
        LcmsPixelFormat::RGB_16,
        lcms_rendering_intent(rendering_intent),
        flags,
    )
    .map_err(|error| {
        format!(
            "Failed to build LittleCMS {} export transform: {error}",
            export_color_profile_receipt_label(color_profile)
        )
    })?;
    let source_pixels: Vec<[u16; 3]> = pixels
        .chunks_exact(3)
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    let mut transformed = vec![[0u16; 3]; source_pixels.len()];
    transform.transform_pixels(&source_pixels, &mut transformed);

    Ok(transformed.into_iter().flatten().collect())
}

fn output_color_profile(color_profile: &ExportColorProfile) -> Result<ColorProfile, String> {
    match color_profile {
        ExportColorProfile::AdobeRgb1998 => Ok(ColorProfile::new_adobe_rgb()),
        ExportColorProfile::DisplayP3 => Ok(ColorProfile::new_display_p3()),
        ExportColorProfile::ProPhotoRgb => Ok(ColorProfile::new_pro_photo_rgb()),
        ExportColorProfile::SourceEmbedded => {
            Err("Source embedded export profile is not implemented yet.".to_string())
        }
        ExportColorProfile::Srgb => Ok(ColorProfile::new_srgb()),
    }
}

fn validate_export_color_policy(
    output_format: &str,
    color_profile: &ExportColorProfile,
) -> Result<(), String> {
    resolve_export_color_transform_plan(
        output_format,
        color_profile,
        &ExportRenderingIntent::RelativeColorimetric,
        false,
    )
    .map(|_| ())
}

fn export_color_profile_requires_transform(color_profile: &ExportColorProfile) -> bool {
    matches!(
        color_profile,
        ExportColorProfile::AdobeRgb1998
            | ExportColorProfile::DisplayP3
            | ExportColorProfile::ProPhotoRgb
    )
}

fn proven_export_rendering_intents(
    color_profile: &ExportColorProfile,
) -> Vec<ExportRenderingIntent> {
    match color_profile {
        ExportColorProfile::Srgb => vec![
            ExportRenderingIntent::RelativeColorimetric,
            ExportRenderingIntent::Perceptual,
        ],
        ExportColorProfile::AdobeRgb1998
        | ExportColorProfile::DisplayP3
        | ExportColorProfile::ProPhotoRgb
        | ExportColorProfile::SourceEmbedded => vec![ExportRenderingIntent::RelativeColorimetric],
    }
}

fn resolve_export_color_transform_plan(
    output_format: &str,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<ResolvedColorTransformPlan, String> {
    let requested = RequestedColorPolicy {
        black_point_compensation_requested: black_point_compensation,
        color_profile: color_profile.clone(),
        output_format: output_format.to_lowercase(),
        rendering_intent: rendering_intent.clone(),
    };
    let supports_color_managed_profile =
        supports_color_managed_receipt_metadata(&requested.output_format);
    let supported_intents = proven_export_rendering_intents(color_profile);

    if !supported_intents.contains(rendering_intent) {
        return Err(format!(
            "{} export does not have proven {} rendering-intent support yet.",
            export_color_profile_receipt_label(color_profile),
            export_rendering_intent_receipt_label(rendering_intent)
        ));
    }

    if matches!(color_profile, ExportColorProfile::SourceEmbedded)
        && !supports_color_managed_profile
    {
        return Err(format!(
            "Source embedded export profile is only supported for JPEG and TIFF, not {}.",
            output_format
        ));
    }

    if export_color_profile_requires_transform(color_profile) && !supports_color_managed_profile {
        return Err(format!(
            "{} export is only supported for JPEG and TIFF, not {}.",
            export_color_profile_receipt_label(color_profile),
            output_format
        ));
    }

    let transform_applied = export_color_profile_requires_transform(color_profile)
        || should_apply_srgb_perceptual_gamut_mapping(color_profile, rendering_intent);
    let supports_black_point_compensation =
        is_lcms_relative_bpc_supported(&requested.output_format, color_profile, rendering_intent);
    let black_point_compensation_status = if supports_black_point_compensation {
        ExportBlackPointCompensationStatus::Supported
    } else {
        ExportBlackPointCompensationStatus::Unsupported
    };
    let disabled_reason = if black_point_compensation && !supports_black_point_compensation {
        Some(
            "Black-point compensation is only available for JPEG/TIFF wide-gamut relative colorimetric LittleCMS exports."
                .to_string(),
        )
    } else {
        None
    };
    let engine = if black_point_compensation && supports_black_point_compensation {
        ExportColorEngineId::Lcms2
    } else {
        ExportColorEngineId::Moxcms
    };
    let status = if supports_color_managed_profile {
        "applied"
    } else {
        "not_applicable_unmanaged_srgb"
    };

    Ok(ResolvedColorTransformPlan {
        black_point_compensation: black_point_compensation_status,
        disabled_reason,
        effective_color_profile: color_profile.clone(),
        effective_rendering_intent: rendering_intent.clone(),
        engine,
        icc_embedded: supports_color_managed_profile,
        requested,
        status: status.to_string(),
        transform_applied,
    })
}

fn applied_export_color_policy(
    plan: ResolvedColorTransformPlan,
    source_precision_path: &str,
) -> AppliedColorPolicy {
    let bit_depth = if matches!(plan.requested.output_format.as_str(), "tif" | "tiff") {
        16
    } else {
        8
    };
    let color_managed_transform = export_color_transform_receipt_label(
        &plan.effective_color_profile,
        &plan.effective_rendering_intent,
    );

    AppliedColorPolicy {
        bit_depth,
        color_managed_transform,
        plan,
        policy_version: "rawengine-export-color-policy-v2".to_string(),
        source_precision_path: source_precision_path.to_string(),
    }
}

pub(crate) fn resolve_export_color_capabilities() -> ExportColorCapabilityCatalog {
    let runtime_support_notes = vec![
        "Rendering intent is passed to moxcms transform options.".to_string(),
        "LittleCMS enables black-point compensation for JPEG/TIFF relative colorimetric wide-gamut exports."
            .to_string(),
    ];
    let capabilities = vec![
        ExportColorProfile::Srgb,
        ExportColorProfile::DisplayP3,
        ExportColorProfile::AdobeRgb1998,
        ExportColorProfile::ProPhotoRgb,
        ExportColorProfile::SourceEmbedded,
    ]
    .into_iter()
    .map(|color_profile| ExportColorCapability {
        black_point_compensation: if export_color_profile_requires_transform(&color_profile) {
            ExportBlackPointCompensationStatus::Supported
        } else {
            ExportBlackPointCompensationStatus::Unsupported
        },
        rendering_intents: proven_export_rendering_intents(&color_profile),
        color_profile,
        engine: ExportColorEngineId::Moxcms,
        runtime_support_notes: runtime_support_notes.clone(),
    })
    .collect();

    ExportColorCapabilityCatalog {
        capabilities,
        engine: ExportColorEngineId::Moxcms,
        schema_version: 1,
    }
}

#[tauri::command]
pub fn get_export_color_capabilities() -> ExportColorCapabilityCatalog {
    resolve_export_color_capabilities()
}

fn export_transform_options(rendering_intent: &ExportRenderingIntent) -> TransformOptions {
    TransformOptions {
        rendering_intent: mox_rendering_intent(rendering_intent),
        ..TransformOptions::default()
    }
}

fn mox_rendering_intent(rendering_intent: &ExportRenderingIntent) -> MoxRenderingIntent {
    match rendering_intent {
        ExportRenderingIntent::AbsoluteColorimetric => MoxRenderingIntent::AbsoluteColorimetric,
        ExportRenderingIntent::Perceptual => MoxRenderingIntent::Perceptual,
        ExportRenderingIntent::RelativeColorimetric => MoxRenderingIntent::RelativeColorimetric,
        ExportRenderingIntent::Saturation => MoxRenderingIntent::Saturation,
    }
}

fn lcms_rendering_intent(rendering_intent: &ExportRenderingIntent) -> LcmsIntent {
    match rendering_intent {
        ExportRenderingIntent::AbsoluteColorimetric => LcmsIntent::AbsoluteColorimetric,
        ExportRenderingIntent::Perceptual => LcmsIntent::Perceptual,
        ExportRenderingIntent::RelativeColorimetric => LcmsIntent::RelativeColorimetric,
        ExportRenderingIntent::Saturation => LcmsIntent::Saturation,
    }
}

fn is_lcms_relative_bpc_supported(
    output_format: &str,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> bool {
    matches!(output_format, "jpg" | "jpeg" | "tif" | "tiff")
        && export_color_profile_requires_transform(color_profile)
        && matches!(
            rendering_intent,
            ExportRenderingIntent::RelativeColorimetric
        )
}

fn encode_icc_profile(profile: &ColorProfile) -> Result<Vec<u8>, String> {
    profile
        .encode()
        .map_err(|e| format!("Failed to encode export ICC profile: {}", e))
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
) -> Result<(), String> {
    let (transformed_image, mask_bitmaps) = prepare_export_masks(base_image, js_adjustments, state);
    let (img_w, img_h) = transformed_image.dimensions();

    if !mask_bitmaps.is_empty() {
        let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
        let all_adjustments = get_all_adjustments_from_json(js_adjustments, is_raw, tm_override);
        let lut_path = js_adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
        let unique_hash = calculate_full_job_hash(source_path_str, js_adjustments);
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

            save_image_with_metadata(
                &with_options,
                &mask_image_path,
                source_path_str,
                export_settings,
            )?;

            if export_settings.preserve_timestamps {
                set_timestamps_from_exif(Path::new(source_path_str), &mask_image_path);
            }

            let alpha_bytes = encode_grayscale_to_png(&alpha_resized)?;
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
            fs::write(&mask_alpha_path, alpha_bytes).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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
    let mut all_adjustments = get_all_adjustments_from_json(js_adjustments, false, tm_override);

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

    let lut_path = js_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
    let unique_hash = calculate_full_job_hash(source_path_str, js_adjustments);

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
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    if state.export_task_handle.lock().unwrap().is_some() {
        return Err("An export is already in progress.".to_string());
    }

    let context = get_or_init_gpu_context(&state, &app_handle)?;
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

    let task = tokio::spawn(async move {
        let output_folder_path = std::path::Path::new(&output_folder_or_file);
        let total_paths = paths.len();
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
            let permit = semaphore.clone().acquire_owned().await.unwrap();

            let app_handle_clone = app_handle.clone();
            let context_clone = Arc::clone(&context);
            let progress_counter_clone = Arc::clone(&progress_counter);
            let output_folder_path = output_folder_path.to_path_buf();
            let base_origin_folders = base_origin_folders.clone();
            let export_settings = export_settings.clone();
            let output_format = output_format.clone();
            let current_edit_path = current_edit_path.clone();
            let current_edit_adjustments = current_edit_adjustments.clone();
            let settings = settings.clone();

            let handle = tokio::task::spawn_blocking(move || {
                if app_handle_clone
                    .state::<AppState>()
                    .export_task_handle
                    .lock()
                    .unwrap()
                    .is_none()
                {
                    return Err("Export cancelled".to_string());
                }

                let state = app_handle_clone.state::<AppState>();
                let (source_path, sidecar_path) = parse_virtual_path(&image_path_str);
                let source_path_str = source_path.to_string_lossy().to_string();
                let is_current_edit = Some(&source_path_str) == current_edit_path.as_ref();

                let mut js_adjustments = match (is_current_edit, current_edit_adjustments) {
                    (true, Some(adjustments)) => adjustments,
                    _ => {
                        let metadata = crate::exif_processing::load_sidecar(&sidecar_path);
                        metadata.adjustments
                    }
                };

                hydrate_adjustments(&state, &mut js_adjustments);
                let effective_settings =
                    raw_processing_settings_for_adjustments(&settings, &js_adjustments);
                let is_raw = is_raw_file(&source_path_str);
                let original_path = std::path::Path::new(&source_path_str);
                let file_date = exif_processing::get_creation_date_from_path(original_path);

                let filename_template = export_settings
                    .filename_template
                    .as_deref()
                    .unwrap_or("{original_filename}_edited");

                let mut new_stem = generate_filename_from_template(
                    filename_template,
                    original_path,
                    global_index + 1,
                    total_paths,
                    &file_date,
                );

                if let Some(vc_id) = explicit_vc {
                    new_stem = format!("{}_VC{:02}", new_stem, vc_id);
                } else if appearance_count > 1 {
                    new_stem = format!("{}_VC{:02}", new_stem, appearance_count - 1);
                }

                let new_filename = format!("{}.{}", new_stem, output_format);
                let output_path = if is_explicit_file_path && total_paths == 1 {
                    output_folder_path
                } else if export_settings.preserve_folders {
                    let matched_base = base_origin_folders
                        .iter()
                        .map(std::path::Path::new)
                        .find(|b| source_path.starts_with(b));
                    if let Some(base_origin) = matched_base {
                        if let Ok(rel_path) = source_path.strip_prefix(base_origin) {
                            let rel_dir = rel_path
                                .parent()
                                .unwrap_or_else(|| std::path::Path::new(""));
                            let rel_dir_is_safe = rel_dir.components().all(|component| {
                                matches!(
                                    component,
                                    std::path::Component::Normal(_) | std::path::Component::CurDir
                                )
                            });
                            if rel_dir_is_safe {
                                let full_dir = output_folder_path.join(rel_dir);
                                if let Err(e) = std::fs::create_dir_all(&full_dir) {
                                    log::warn!("Failed to create export subdirectory: {}", e);
                                }
                                full_dir.join(&new_filename)
                            } else {
                                output_folder_path.join(&new_filename)
                            }
                        } else {
                            output_folder_path.join(&new_filename)
                        }
                    } else {
                        output_folder_path.join(&new_filename)
                    }
                } else {
                    output_folder_path.join(&new_filename)
                };

                let extension = output_format.to_lowercase();

                let result: Result<ExportReceiptOutput, String> = (|| {
                    if extension == "cube" {
                        let cube_bytes = export_adjustments_as_lut(
                            &js_adjustments,
                            &source_path_str,
                            &context_clone,
                            &state,
                            &app_handle_clone,
                        )?;
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
                        fs::write(&output_path, cube_bytes).map_err(|e| e.to_string())?;
                        return export_receipt_output(
                            &output_path,
                            &source_path_str,
                            &extension,
                            None,
                        );
                    }

                    let base_image = if is_current_edit {
                        match get_full_image_for_processing(&state) {
                            Ok((orig_data, _)) => {
                                composite_patches_on_image(&orig_data, &js_adjustments)
                                    .map_err(|e| format!("Failed to composite AI patches: {}", e))?
                            }
                            Err(_) => {
                                let bytes =
                                    fs::read(&source_path_str).map_err(|e| e.to_string())?;
                                load_and_composite(
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
                            Ok(mmap) => load_and_composite(
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
                                load_and_composite(
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
                    let export_color_policy = save_image_with_metadata(
                        &final_image,
                        &output_path,
                        &source_path_str,
                        &export_settings,
                    )?;

                    if export_settings.preserve_timestamps {
                        set_timestamps_from_exif(Path::new(&source_path_str), &output_path);
                    }

                    if export_settings.export_masks {
                        export_masks_for_image(
                            &base_image,
                            &js_adjustments,
                            &export_settings,
                            &output_path,
                            &source_path_str,
                            &context_clone,
                            &state,
                            is_raw,
                            &app_handle_clone,
                        )?;
                    }

                    export_receipt_output(
                        &output_path,
                        &source_path_str,
                        &extension,
                        export_color_policy,
                    )
                })();

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
                Err(e) => results.push(Err(format!("Thread crashed: {}", e))),
            }
        }

        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let mut error_count = 0;
        let mut outputs = Vec::new();
        for result in results {
            match result {
                Ok(output) => outputs.push(output),
                Err(e) => {
                    error_count += 1;
                    log::error!("Export error: {}", e);
                    if total_paths == 1 {
                        let _ = app_handle.emit(crate::events::EXPORT_ERROR, e);
                    }
                }
            }
        }

        if error_count > 0 && total_paths > 1 {
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
                ExportReceipt {
                    completed_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
                    outputs,
                    total: total_paths,
                },
            );
        }

        *app_handle
            .state::<AppState>()
            .export_task_handle
            .lock()
            .unwrap() = None;
    });

    *state.export_task_handle.lock().unwrap() = Some(task);
    Ok(())
}

fn export_receipt_output(
    output_path: &Path,
    source_path: &str,
    format: &str,
    metadata: Option<ExportReceiptMetadata>,
) -> Result<ExportReceiptOutput, String> {
    let byte_size = fs::metadata(output_path)
        .map_err(|error| error.to_string())?
        .len();

    Ok(ExportReceiptOutput {
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

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportReceiptMetadata {
    pub bit_depth: u8,
    pub black_point_compensation: String,
    pub cmm: String,
    pub color_managed_transform: String,
    pub color_profile: String,
    pub effective_color_profile: String,
    pub icc_embedded: bool,
    pub policy_version: String,
    pub policy_status: String,
    pub rendering_intent: String,
    pub requested_color_profile: String,
    pub requested_rendering_intent: String,
    pub resolved_disabled_reason: Option<String>,
    pub effective_rendering_intent: String,
    pub source_icc_profile_hash: Option<String>,
    pub source_precision_path: String,
    pub transform_policy_fingerprint: String,
    pub transform_applied: bool,
}

fn export_receipt_metadata(
    format: &str,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_precision_path: &str,
    source_icc_profile_hash: Option<String>,
) -> Option<ExportReceiptMetadata> {
    if !supports_color_managed_receipt_metadata(format) {
        return None;
    }

    let plan = resolve_export_color_transform_plan(
        format,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )
    .ok()?;
    let applied = applied_export_color_policy(plan, source_precision_path);
    let color_profile_label =
        export_color_profile_receipt_label(&applied.plan.effective_color_profile);
    let rendering_intent_label =
        export_rendering_intent_receipt_label(&applied.plan.effective_rendering_intent);
    let transform_policy_fingerprint =
        export_color_transform_fingerprint(&applied, source_icc_profile_hash.as_deref());

    Some(ExportReceiptMetadata {
        bit_depth: applied.bit_depth,
        black_point_compensation: export_black_point_compensation_receipt_label(&applied.plan),
        cmm: export_color_engine_receipt_label(&applied.plan.engine),
        color_managed_transform: applied.color_managed_transform,
        color_profile: color_profile_label.clone(),
        effective_color_profile: color_profile_label,
        icc_embedded: applied.plan.icc_embedded,
        policy_version: applied.policy_version,
        policy_status: applied.plan.status,
        rendering_intent: rendering_intent_label.clone(),
        requested_color_profile: export_color_profile_receipt_label(
            &applied.plan.requested.color_profile,
        ),
        requested_rendering_intent: export_rendering_intent_receipt_label(
            &applied.plan.requested.rendering_intent,
        ),
        resolved_disabled_reason: applied.plan.disabled_reason,
        effective_rendering_intent: rendering_intent_label,
        source_icc_profile_hash,
        source_precision_path: applied.source_precision_path,
        transform_policy_fingerprint,
        transform_applied: applied.plan.transform_applied,
    })
}

fn export_color_transform_fingerprint(
    applied: &AppliedColorPolicy,
    source_icc_profile_hash: Option<&str>,
) -> String {
    let plan = &applied.plan;
    let mut hasher = Sha256::new();

    let parts = vec![
        applied.policy_version.clone(),
        applied.source_precision_path.clone(),
        plan.requested.output_format.clone(),
        export_color_profile_receipt_label(&plan.requested.color_profile),
        export_rendering_intent_receipt_label(&plan.requested.rendering_intent),
        export_color_profile_receipt_label(&plan.effective_color_profile),
        export_rendering_intent_receipt_label(&plan.effective_rendering_intent),
        export_color_engine_receipt_label(&plan.engine),
        export_black_point_compensation_receipt_label(plan),
        plan.status.clone(),
        if plan.icc_embedded {
            "icc_embedded".to_string()
        } else {
            "icc_not_embedded".to_string()
        },
        if plan.transform_applied {
            "transform_applied".to_string()
        } else {
            "transform_not_applied".to_string()
        },
        source_icc_profile_hash
            .unwrap_or("source_icc:none")
            .to_string(),
    ];

    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }

    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn export_source_precision_receipt_label(image: &DynamicImage) -> String {
    match image {
        DynamicImage::ImageRgb32F(_) => {
            "rgb32f source; quantized only at color-managed encoder boundary".to_string()
        }
        DynamicImage::ImageRgba32F(_) => {
            "rgba32f source; alpha dropped and quantized only at color-managed encoder boundary"
                .to_string()
        }
        DynamicImage::ImageRgb16(_) => "rgb16 source; shared RGB16 export/proof core".to_string(),
        DynamicImage::ImageRgba16(_) => {
            "rgba16 source; high-precision shared RGB16 export/proof core; alpha dropped for RGB output"
                .to_string()
        }
        DynamicImage::ImageRgb8(_) | DynamicImage::ImageRgba8(_) => {
            "rgba8/rgb8 source; GPU readback-limited before color-managed export/proof".to_string()
        }
        _ => {
            "image crate RGB16 conversion source; high-precision color path not proven".to_string()
        }
    }
}

fn supports_color_managed_receipt_metadata(format: &str) -> bool {
    matches!(format, "jpg" | "jpeg" | "tif" | "tiff")
}

fn export_color_transform_receipt_label(
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> String {
    if should_apply_srgb_perceptual_gamut_mapping(color_profile, rendering_intent) {
        return format!("{SRGB_OKLAB_CHROMA_REDUCE_V1}; ICC embedded");
    }

    if !export_color_profile_requires_transform(color_profile) {
        if matches!(color_profile, ExportColorProfile::SourceEmbedded) {
            return "Source embedded profile passthrough; ICC embedded".to_string();
        }
        return "sRGB identity output; ICC embedded".to_string();
    }

    format!(
        "sRGB to {} conversion applied",
        export_color_profile_receipt_label(color_profile)
    )
}

fn export_black_point_compensation_receipt_label(plan: &ResolvedColorTransformPlan) -> String {
    if plan.requested.black_point_compensation_requested
        && plan.black_point_compensation == ExportBlackPointCompensationStatus::Supported
    {
        return "Enabled via LittleCMS relative colorimetric transform".to_string();
    }

    if plan.requested.black_point_compensation_requested {
        return "Requested but disabled for this export path".to_string();
    }

    match plan.black_point_compensation {
        ExportBlackPointCompensationStatus::Supported => "Available but disabled".to_string(),
        ExportBlackPointCompensationStatus::Unsupported => {
            "Unavailable for this export path".to_string()
        }
    }
}

fn export_rendering_intent_receipt_label(rendering_intent: &ExportRenderingIntent) -> String {
    match rendering_intent {
        ExportRenderingIntent::AbsoluteColorimetric => "Absolute colorimetric".to_string(),
        ExportRenderingIntent::Perceptual => "Perceptual".to_string(),
        ExportRenderingIntent::RelativeColorimetric => "Relative colorimetric".to_string(),
        ExportRenderingIntent::Saturation => "Saturation".to_string(),
    }
}

fn export_color_engine_receipt_label(engine: &ExportColorEngineId) -> String {
    match engine {
        ExportColorEngineId::Lcms2 => "lcms2".to_string(),
        ExportColorEngineId::Moxcms => "moxcms".to_string(),
    }
}

fn export_color_profile_receipt_label(color_profile: &ExportColorProfile) -> String {
    match color_profile {
        ExportColorProfile::DisplayP3 => "Display P3".to_string(),
        ExportColorProfile::Srgb => "sRGB".to_string(),
        ExportColorProfile::AdobeRgb1998 => "Adobe RGB (1998)".to_string(),
        ExportColorProfile::ProPhotoRgb => "ProPhoto RGB".to_string(),
        ExportColorProfile::SourceEmbedded => "Source embedded".to_string(),
    }
}

#[tauri::command]
pub fn cancel_export(state: tauri::State<AppState>) -> Result<(), String> {
    match state.export_task_handle.lock().unwrap().take() {
        Some(handle) => {
            handle.abort();
            println!("Export task cancellation requested.");
        }
        _ => {
            return Err("No export task is currently running.".to_string());
        }
    }
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

        let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
        let mut all_adjustments =
            get_all_adjustments_from_json(&adjustments_clone, is_raw, tm_override);
        all_adjustments.global.show_clipping = 0;

        let lut = adjustments_clone["lutPath"]
            .as_str()
            .and_then(|p| get_or_load_lut(&state, p).ok());
        let unique_hash =
            calculate_full_job_hash(&loaded_image.path, &adjustments_clone).wrapping_add(1);

        let processed_preview = process_and_get_dynamic_image(
            &context,
            &state,
            &preview_image,
            unique_hash,
            RenderRequest {
                adjustments: all_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
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
        let mut js_adjustments = metadata.adjustments;

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

        let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
        let mut all_adjustments =
            get_all_adjustments_from_json(&js_adjustments, is_raw, tm_override);
        all_adjustments.global.show_clipping = 0;

        let lut = js_adjustments["lutPath"]
            .as_str()
            .and_then(|p| get_or_load_lut(&state, p).ok());
        let unique_hash =
            calculate_full_job_hash(&source_path_str, &js_adjustments).wrapping_add(1);

        let processed_preview = process_and_get_dynamic_image(
            &context,
            &state,
            &preview_base,
            unique_hash,
            RenderRequest {
                adjustments: all_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
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
        OutputSharpeningTarget, applied_export_color_policy, apply_export_resize_and_watermark,
        encode_icc_profile, encode_image_to_bytes, encode_image_with_applied_policy,
        encode_image_with_applied_policy_and_source_profile, export_color_profile_receipt_label,
        export_jpeg_rgb_pixels_and_profile, export_receipt_metadata, export_rgb_pixels_and_profile,
        export_rgb16_pixels_and_profile, export_rgb16_pixels_with_shared_conversion_core,
        export_soft_proof_rgb_pixels_and_profile_with_policy,
        export_source_precision_receipt_label, export_transform_options, mox_rendering_intent,
        quantize_rgb16_to_rgb8, resolve_export_color_capabilities,
        resolve_export_color_transform_plan, should_apply_srgb_perceptual_gamut_mapping,
    };
    use crate::gamut_mapping::SRGB_OKLAB_CHROMA_REDUCE_V1;
    use moxcms::ColorProfile;
    use sha2::{Digest, Sha256};
    use std::io::Cursor;

    use image::{
        ColorType, DynamicImage, ImageBuffer, ImageDecoder, Rgb, Rgba, codecs::tiff::TiffDecoder,
    };

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
            format!("{SRGB_OKLAB_CHROMA_REDUCE_V1}; ICC embedded")
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
        assert_eq!(
            &single_icc_payload(&encoded.bytes)[b"ICC_PROFILE\0\x01\x01".len()..],
            encode_icc_profile(&jpeg_profile)
                .expect("Display P3 JPEG output ICC should encode")
                .as_slice()
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
}
