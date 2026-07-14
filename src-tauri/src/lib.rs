#![cfg_attr(not(feature = "ai"), allow(dead_code))]

#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
use mimalloc::MiMalloc;

#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

mod adjustments;
mod ai;
mod album_management;
mod android_integration;
mod app;
mod app_settings;
mod app_state;
mod color;
mod community_presets;
mod computational;
mod detail;
mod events;
mod export;
mod geometry;
mod gpu;
mod io;
mod layers;
mod library;
mod merge;
mod preset_converter;
mod presets;
mod proofs;
#[cfg(all(feature = "validation-harness", unix))]
mod qa_control;
mod raw;
mod render;
mod tagging;
pub mod tone;
mod window_customizer;

pub(crate) use color::*;
pub(crate) use computational::*;
pub use computational::{deblur_cpu_reference, denoise_cpu_reference};
pub(crate) use gpu::*;
pub(crate) use io::*;
pub(crate) use library::*;
pub(crate) use merge::*;
pub(crate) use raw::*;
pub use render::resample::{
    AxisPlan, AxisSpan, CancellationProbe, ResampleCacheMetrics, ResampleError, ResampleKey,
    ResamplePlan, ResampledImage, cache_metrics as resample_cache_metrics, downscale_f32_image_cow,
};
pub(crate) use render::*;

use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::io::Write;
use std::panic;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::thread;

use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{Engine as _, engine::general_purpose};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma, RgbImage, Rgba};
use imageproc::drawing::draw_line_segment_mut;
use imageproc::edges::canny;
use imageproc::hough::{LineDetectionOptions, detect_lines};
use rapidraw_codecs::JpegPreset;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager, ipc::Response};
use tempfile::NamedTempFile;

#[cfg(feature = "ai")]
use crate::ai::ai_commands as build_ai_commands;
#[cfg(not(feature = "ai"))]
use crate::app::disabled_commands as build_ai_commands;
use crate::formats::PNG_DATA_URL_PREFIX;
use crate::gpu_display::{DisplayTransformState, PresentationSchedulerReport};
use crate::hdr_artifact_sidecar::write_hdr_output_sidecar;
use crate::image_codecs::{encode_jpeg_data_url, encode_jpeg_response, encode_png_data_url};
use crate::merge::atomic_derived_output::{AtomicDerivedOutputTransaction, DerivedOutputManifest};
use crate::merge::focus_stack::{
    FocusStackInputPlan, FocusStackReadinessSettings, build_input_plan,
};
use crate::merge::hdr::{ALIGNMENT_POLICY_ID, HdrAlignmentPlanResponse, build_alignment_plan};

use crate::app::startup::{
    FrontendStartupPhase, NativeStartupPhase, frontend_ready_manages_native_window,
    record_frontend_phase_with_followup,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::app::startup::{
    InitializationPriority, request_gpu_initialization, request_lens_initialization,
};
use crate::cache_utils::{
    calculate_geometry_hash, calculate_transform_hash, calculate_visual_hash,
};
use crate::exif_processing::{read_exposure_time_secs, read_iso};
use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::formats::is_raw_file;
use crate::image_loader::{
    composite_patches_on_image, load_and_composite, load_base_image_from_bytes,
};
use crate::image_processing::{
    Crop, GeometryParams, RenderRequest, apply_coarse_rotation, apply_cpu_default_raw_processing,
    apply_flip, apply_geometry_warp, apply_srgb_to_linear, downscale_f32_image,
    get_or_init_gpu_context, process_and_get_dynamic_image, resolve_tonemapper_override,
    resolve_tonemapper_override_from_handle, warp_image_geometry,
};
use crate::lut_processing::Lut;
use crate::mask_generation::{
    MaskDefinition, generate_mask_bitmap, get_cached_or_generate_mask,
    resolve_warped_image_for_masks,
};
use crate::window_customizer::PinchZoomDisablePlugin;
pub use adjustment_utils::*;
pub use android_integration::*;
pub use app_settings::*;
pub use app_state::*;

#[cfg(target_os = "macos")]
extern "C" fn force_exit(_signal: libc::c_int) {
    unsafe {
        libc::_exit(0);
    }
}

#[cfg(target_os = "macos")]
pub fn register_exit_handler() {
    unsafe {
        libc::signal(libc::SIGABRT, force_exit as *const () as libc::sighandler_t);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn register_exit_handler() {}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CommunityPreset {
    pub name: String,
    pub creator: String,
    pub adjustments: Value,
    #[serde(rename = "includeMasks")]
    pub include_masks: Option<bool>,
    #[serde(rename = "includeCropTransform")]
    pub include_crop_transform: Option<bool>,
}

#[derive(Serialize)]
struct LutParseResult {
    size: u32,
}

#[derive(serde::Serialize)]
struct ImageDimensions {
    width: u32,
    height: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HdrApplyReceipt {
    accepted_dry_run_plan_hash: String,
    accepted_dry_run_plan_id: String,
    merge_method: String,
    merge_version: String,
    output_handle: String,
    output_content_hash: String,
    preview_dimensions: ImageDimensions,
    source_roles: Vec<HdrApplySourceRole>,
    source_paths: Vec<String>,
    warning_codes: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HdrApplySourceRole {
    exposure_ev: f32,
    role: String,
    source_index: usize,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WgpuTransformPayload {
    pub window_width: f32,
    pub window_height: f32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub clip_x: f32,
    pub clip_y: f32,
    pub clip_width: f32,
    pub clip_height: f32,
    pub bg_primary: [f32; 4],
    pub bg_secondary: [f32; 4],
    pub pixelated: bool,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PreviewGeometryQuality {
    Interactive,
    Settled,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PreviewGeometryTarget {
    EditorSetting {
        quality: PreviewGeometryQuality,
    },
    LongEdge {
        #[serde(rename = "longEdgePx")]
        long_edge_px: u32,
        quality: PreviewGeometryQuality,
    },
}

impl PreviewGeometryTarget {
    fn resolve_long_edge(self, editor_preview_resolution: u32) -> u32 {
        match self {
            Self::EditorSetting { quality } => match quality {
                PreviewGeometryQuality::Interactive => {
                    (editor_preview_resolution as f32 / 1.5).round() as u32
                }
                PreviewGeometryQuality::Settled => editor_preview_resolution,
            },
            Self::LongEdge {
                long_edge_px,
                quality,
            } => match quality {
                PreviewGeometryQuality::Interactive | PreviewGeometryQuality::Settled => {
                    long_edge_px
                }
            },
        }
        .clamp(64, 8192)
    }
}

pub fn generate_transformed_preview(
    state: &tauri::State<AppState>,
    loaded_image: &LoadedImage,
    adjustments: &serde_json::Value,
    preview_dim: u32,
) -> Result<(DynamicImage, f32, (f32, f32)), String> {
    generate_transformed_preview_cancellable(state, loaded_image, adjustments, preview_dim, None)
}

pub(crate) fn generate_transformed_preview_cancellable(
    state: &tauri::State<AppState>,
    loaded_image: &LoadedImage,
    adjustments: &serde_json::Value,
    preview_dim: u32,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<(DynamicImage, f32, (f32, f32)), String> {
    compute_preview_transformed_for_state(
        state,
        loaded_image.image.as_ref(),
        adjustments,
        preview_dim,
        cancellation,
    )
}

fn compute_preview_transformed_for_state(
    _state: &AppState,
    source: &DynamicImage,
    adjustments: &serde_json::Value,
    preview_dim: u32,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<(DynamicImage, f32, (f32, f32)), String> {
    compute_preview_transformed(source, adjustments, preview_dim, cancellation)
}

pub struct PreviewGeometryRequest<'a> {
    pub source: &'a DynamicImage,
    pub adjustments: &'a serde_json::Value,
    pub target_long_edge: u32,
    pub cancellation: Option<&'a dyn Fn() -> Result<(), String>>,
}

pub struct PreviewGeometryReceipt {
    pub source_pixel_count: u64,
    pub working_pixel_count: u64,
    pub output_pixel_count: u64,
    pub full_resolution_transform_allocations: u32,
    pub direct_crop: bool,
    pub tile_count: u32,
}

pub struct PreviewGeometryResult {
    pub image: DynamicImage,
    pub effective_scale: f32,
    pub unscaled_crop_offset: (f32, f32),
    pub receipt: PreviewGeometryReceipt,
}

pub struct PreviewGeometryPipeline;

impl PreviewGeometryPipeline {
    pub fn execute(request: PreviewGeometryRequest<'_>) -> Result<PreviewGeometryResult, String> {
        let source = request.source;
        let adjustments = request.adjustments;
        let preview_dim = request.target_long_edge.max(1);
        if let Some(check) = request.cancellation {
            check()?;
        }
        if let Some(result) =
            compute_direct_crop_preview(source, adjustments, preview_dim, request.cancellation)?
        {
            if let Some(check) = request.cancellation {
                check()?;
            }
            return Ok(result);
        }
        let source_scale = preview_geometry_source_scale(
            source.width(),
            source.height(),
            adjustments,
            preview_dim,
        );
        let working_source = if source_scale < 1.0 {
            let width = ((source.width() as f32 * source_scale).round() as u32).max(1);
            let height = ((source.height() as f32 * source_scale).round() as u32).max(1);
            Cow::Owned(downscale_f32_image(source, width, height))
        } else {
            Cow::Borrowed(source)
        };
        if let Some(check) = request.cancellation {
            check()?;
        }
        let working_pixel_count =
            u64::from(working_source.width()) * u64::from(working_source.height());
        let preview_adjustments = scale_preview_geometry_adjustments(adjustments, source_scale);
        let patched_source =
            composite_patches_on_image(working_source.as_ref(), &preview_adjustments)
                .map_err(|error| format!("Failed to composite preview patches: {error}"))?;
        if let Some(check) = request.cancellation {
            check()?;
        }
        let (transformed, scaled_crop_offset) =
            apply_all_transformations(patched_source, &preview_adjustments);
        if let Some(check) = request.cancellation {
            check()?;
        }
        let (working_w, working_h) = transformed.dimensions();
        let final_preview_base = if working_w > preview_dim || working_h > preview_dim {
            downscale_f32_image(&transformed, preview_dim, preview_dim)
        } else {
            transformed.into_owned()
        };

        let post_transform_scale = if working_w > 0 {
            final_preview_base.width() as f32 / working_w as f32
        } else {
            1.0
        };
        let effective_scale = source_scale * post_transform_scale;
        let unscaled_crop_offset = if source_scale > 0.0 {
            (
                scaled_crop_offset.0 / source_scale,
                scaled_crop_offset.1 / source_scale,
            )
        } else {
            scaled_crop_offset
        };
        let output_pixel_count =
            u64::from(final_preview_base.width()) * u64::from(final_preview_base.height());

        Ok(PreviewGeometryResult {
            image: final_preview_base,
            effective_scale,
            unscaled_crop_offset,
            receipt: PreviewGeometryReceipt {
                source_pixel_count: u64::from(source.width()) * u64::from(source.height()),
                working_pixel_count,
                output_pixel_count,
                full_resolution_transform_allocations: 0,
                direct_crop: false,
                tile_count: 1,
            },
        })
    }
}

fn compute_preview_transformed(
    source: &DynamicImage,
    adjustments: &serde_json::Value,
    preview_dim: u32,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<(DynamicImage, f32, (f32, f32)), String> {
    let result = PreviewGeometryPipeline::execute(PreviewGeometryRequest {
        source,
        adjustments,
        target_long_edge: preview_dim,
        cancellation,
    })?;
    Ok((
        result.image,
        result.effective_scale,
        result.unscaled_crop_offset,
    ))
}

fn compute_direct_crop_preview(
    source: &DynamicImage,
    adjustments: &serde_json::Value,
    preview_dim: u32,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<Option<PreviewGeometryResult>, String> {
    let Ok(crop) = serde_json::from_value::<Crop>(adjustments[adjustment_fields::CROP].clone())
    else {
        return Ok(None);
    };
    let rotation = adjustments[adjustment_fields::ROTATION]
        .as_f64()
        .unwrap_or(0.0);
    let orientation = adjustments[adjustment_fields::ORIENTATION_STEPS]
        .as_u64()
        .unwrap_or(0);
    let patch_sampler = crate::patch_assets::prepare_preview_patch_sampler(
        adjustments,
        source.width(),
        source.height(),
    )
    .map_err(|error| format!("Failed to prepare preview patches: {error}"))?;
    let geometry = crate::geometry::get_geometry_params_from_json(adjustments);
    let has_geometry = !crate::geometry::is_geometry_identity(&geometry);

    let (oriented_width, oriented_height) = if orientation % 2 == 1 {
        (source.height(), source.width())
    } else {
        source.dimensions()
    };
    let mut x = crop.x.round().max(0.0) as u32;
    let mut y = crop.y.round().max(0.0) as u32;
    if x >= oriented_width || y >= oriented_height {
        return Ok(None);
    }
    let mut width = (crop.width.round().max(1.0) as u32).min(oriented_width - x);
    let mut height = (crop.height.round().max(1.0) as u32).min(oriented_height - y);
    if rotation.rem_euclid(360.0).abs() > f64::EPSILON || has_geometry || patch_sampler.is_some() {
        return render_rotated_crop_preview(
            source,
            AffineCropPreviewPlan {
                crop,
                crop_bounds: (x, y, width, height),
                orientation: orientation as u8,
                flip_horizontal: adjustments[adjustment_fields::FLIP_HORIZONTAL]
                    .as_bool()
                    .unwrap_or(false),
                flip_vertical: adjustments[adjustment_fields::FLIP_VERTICAL]
                    .as_bool()
                    .unwrap_or(false),
                rotation_degrees: rotation as f32,
                preview_dim,
                geometry,
                cancellation,
                patch_sampler,
            },
        );
    }
    if adjustments[adjustment_fields::FLIP_HORIZONTAL]
        .as_bool()
        .unwrap_or(false)
    {
        x = oriented_width - x - width;
    }
    if adjustments[adjustment_fields::FLIP_VERTICAL]
        .as_bool()
        .unwrap_or(false)
    {
        y = oriented_height - y - height;
    }
    let (source_x, source_y, source_crop_width, source_crop_height) = match orientation % 4 {
        1 => (y, source.height() - x - width, height, width),
        2 => (
            source.width() - x - width,
            source.height() - y - height,
            width,
            height,
        ),
        3 => (source.width() - y - height, x, height, width),
        _ => (x, y, width, height),
    };
    let cropped = source.crop_imm(source_x, source_y, source_crop_width, source_crop_height);
    let oriented = apply_coarse_rotation(Cow::Owned(cropped), orientation as u8);
    let transformed_crop = apply_flip(
        oriented,
        adjustments[adjustment_fields::FLIP_HORIZONTAL]
            .as_bool()
            .unwrap_or(false),
        adjustments[adjustment_fields::FLIP_VERTICAL]
            .as_bool()
            .unwrap_or(false),
    )
    .into_owned();
    width = transformed_crop.width();
    height = transformed_crop.height();
    let preview = if width > preview_dim || height > preview_dim {
        downscale_f32_image(&transformed_crop, preview_dim, preview_dim)
    } else {
        transformed_crop
    };
    let effective_scale = preview.width() as f32 / width as f32;
    let output_pixel_count = u64::from(preview.width()) * u64::from(preview.height());
    Ok(Some(PreviewGeometryResult {
        image: preview,
        effective_scale,
        unscaled_crop_offset: (crop.x as f32, crop.y as f32),
        receipt: PreviewGeometryReceipt {
            source_pixel_count: u64::from(source.width()) * u64::from(source.height()),
            working_pixel_count: u64::from(source_crop_width) * u64::from(source_crop_height),
            output_pixel_count,
            full_resolution_transform_allocations: 0,
            direct_crop: true,
            tile_count: 1,
        },
    }))
}

struct AffineCropPreviewPlan<'a> {
    crop: Crop,
    crop_bounds: (u32, u32, u32, u32),
    orientation: u8,
    flip_horizontal: bool,
    flip_vertical: bool,
    rotation_degrees: f32,
    preview_dim: u32,
    geometry: GeometryParams,
    cancellation: Option<&'a dyn Fn() -> Result<(), String>>,
    patch_sampler: Option<crate::patch_assets::PreviewPatchSampler>,
}

fn render_rotated_crop_preview(
    source: &DynamicImage,
    plan: AffineCropPreviewPlan<'_>,
) -> Result<Option<PreviewGeometryResult>, String> {
    let (crop_x, crop_y, crop_width, crop_height) = plan.crop_bounds;
    let output_scale = (plan.preview_dim as f32 / crop_width.max(crop_height) as f32).min(1.0);
    let output_width = ((crop_width as f32 * output_scale).round() as u32).max(1);
    let output_height = ((crop_height as f32 * output_scale).round() as u32).max(1);
    let (coarse_width, coarse_height) = if plan.orientation % 2 == 1 {
        (source.height(), source.width())
    } else {
        source.dimensions()
    };
    let center_x = coarse_width as f32 / 2.0;
    let center_y = coarse_height as f32 / 2.0;
    let (sin, cos) = plan.rotation_degrees.to_radians().sin_cos();
    let orientation = plan.orientation;
    let flip_horizontal = plan.flip_horizontal;
    let flip_vertical = plan.flip_vertical;
    let crop_offset = (plan.crop.x as f32, plan.crop.y as f32);
    let patch_sampler = plan.patch_sampler;
    let decorate_source = |source_x, source_y, pixel: &mut [f32]| {
        if let Some(sampler) = patch_sampler.as_ref() {
            sampler.blend_at(source_x, source_y, pixel);
        }
    };
    let source_decorator = patch_sampler
        .as_ref()
        .map(|_| &decorate_source as &crate::geometry::SourceSampleDecorator<'_>);

    let output = crate::geometry::warp_image_geometry_mapped(
        source,
        plan.geometry,
        output_width,
        output_height,
        move |output_x, output_y| {
            let rotated_x = crop_x as f32 + output_x / output_scale;
            let rotated_y = crop_y as f32 + output_y / output_scale;
            let dx = rotated_x - center_x;
            let dy = rotated_y - center_y;
            let mut coarse_x = center_x + cos * dx + sin * dy;
            let mut coarse_y = center_y - sin * dx + cos * dy;
            if flip_horizontal {
                coarse_x = coarse_width as f32 - 1.0 - coarse_x;
            }
            if flip_vertical {
                coarse_y = coarse_height as f32 - 1.0 - coarse_y;
            }
            match orientation % 4 {
                1 => (coarse_y, source.height() as f32 - 1.0 - coarse_x),
                2 => (
                    source.width() as f32 - 1.0 - coarse_x,
                    source.height() as f32 - 1.0 - coarse_y,
                ),
                3 => (source.width() as f32 - 1.0 - coarse_y, coarse_x),
                _ => (coarse_x, coarse_y),
            }
        },
        source_decorator,
        plan.cancellation,
    )?;
    let output_pixel_count = u64::from(output_width) * u64::from(output_height);
    Ok(Some(PreviewGeometryResult {
        image: output,
        effective_scale: output_scale,
        unscaled_crop_offset: crop_offset,
        receipt: PreviewGeometryReceipt {
            source_pixel_count: u64::from(source.width()) * u64::from(source.height()),
            working_pixel_count: output_pixel_count,
            output_pixel_count,
            full_resolution_transform_allocations: 0,
            direct_crop: true,
            tile_count: output_height.div_ceil(crate::geometry::PREVIEW_GEOMETRY_BAND_ROWS),
        },
    }))
}

fn preview_geometry_source_scale(
    source_width: u32,
    source_height: u32,
    adjustments: &serde_json::Value,
    preview_dim: u32,
) -> f32 {
    let orientation_steps = adjustments[adjustment_fields::ORIENTATION_STEPS]
        .as_u64()
        .unwrap_or(0) as u8;
    let (oriented_width, oriented_height) = if orientation_steps % 2 == 1 {
        (source_height, source_width)
    } else {
        (source_width, source_height)
    };
    let target_long_edge =
        serde_json::from_value::<Crop>(adjustments[adjustment_fields::CROP].clone())
            .ok()
            .map(|crop| crop.width.max(crop.height) as f32)
            .filter(|dimension| dimension.is_finite() && *dimension > 0.0)
            .unwrap_or_else(|| oriented_width.max(oriented_height) as f32);

    if target_long_edge <= preview_dim.max(1) as f32 {
        1.0
    } else {
        preview_dim.max(1) as f32 / target_long_edge
    }
}

fn scale_preview_geometry_adjustments(
    adjustments: &serde_json::Value,
    source_scale: f32,
) -> serde_json::Value {
    if source_scale >= 1.0 {
        return adjustments.clone();
    }
    let mut scaled = adjustments.clone();
    if let Some(crop_value) = scaled.get_mut(adjustment_fields::CROP)
        && let Ok(mut crop) = serde_json::from_value::<Crop>(crop_value.clone())
    {
        let scale = f64::from(source_scale);
        crop.x *= scale;
        crop.y *= scale;
        crop.width *= scale;
        crop.height *= scale;
        *crop_value = serde_json::to_value(crop).unwrap_or(serde_json::Value::Null);
    }
    scaled
}

/// Authoritative full-resolution geometry/retouch path for export and pixel-critical operations.
/// Normal editor previews must use [`generate_transformed_preview`] instead.
#[cfg(test)]
static FULL_TRANSFORM_INVOCATIONS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub fn compute_full_transformed_res(
    loaded_image: &LoadedImage,
    adjustments: &serde_json::Value,
) -> Result<(Arc<DynamicImage>, (f32, f32)), String> {
    #[cfg(test)]
    FULL_TRANSFORM_INVOCATIONS.fetch_add(1, Ordering::Relaxed);
    let has_patches = adjustments
        .get("aiPatches")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    let patched_original_image = if has_patches {
        composite_patches_on_image(&loaded_image.image, adjustments)
            .map_err(|e| format!("Failed to composite AI patches: {}", e))?
    } else {
        Cow::Borrowed(loaded_image.image.as_ref())
    };

    let (transformed_img, offset) = apply_all_transformations(patched_original_image, adjustments);
    Ok((Arc::new(transformed_img.into_owned()), offset))
}

pub fn get_or_load_lut(state: &AppState, path: &str) -> Result<Arc<Lut>, String> {
    let fingerprint = lut_processing::source_fingerprint(path).map_err(|e| e.to_string())?;
    if let Some(entry) = state.lut_cache.get(&path.to_string())
        && entry.fingerprint == fingerprint
    {
        return Ok(Arc::clone(&entry.lut));
    }

    let parsed = lut_processing::parse_lut_file(path).map_err(|e| e.to_string())?;
    let content_hash = parsed.content_hash;
    let arc_lut = state
        .lut_content_cache
        .get(&content_hash)
        .unwrap_or_else(|| {
            let lut = Arc::new(parsed);
            state
                .lut_content_cache
                .insert(content_hash, Arc::clone(&lut), lut.retained_bytes());
            lut
        });
    state.lut_cache.insert(
        path.to_string(),
        Arc::new(crate::lut_processing::CachedLutPath {
            fingerprint,
            lut: Arc::clone(&arc_lut),
        }),
        256,
    );
    Ok(arc_lut)
}

#[tauri::command]
fn get_image_dimensions(path: String) -> Result<ImageDimensions, String> {
    let (source_path, _) = parse_virtual_path(&path);
    image::image_dimensions(&source_path)
        .map(|(width, height)| ImageDimensions { width, height })
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PerspectiveAnalysisResult {
    analysis: crate::geometry::perspective::PerspectiveAnalysisV1,
    receipt: crate::geometry::perspective::PerspectiveCorrectionReceiptV1,
}

#[tauri::command]
fn analyze_perspective_correction(
    adjustments: serde_json::Value,
    settings: crate::geometry::perspective::PerspectiveCorrectionSettingsV1,
    state: tauri::State<AppState>,
) -> Result<PerspectiveAnalysisResult, String> {
    let loaded = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "perspective.no_loaded_image".to_string())?;
    let orientation = adjustments
        .get("orientationSteps")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default();
    let lens_contract = serde_json::to_string(
        adjustments
            .get("lensDistortionParams")
            .unwrap_or(&serde_json::Value::Null),
    )
    .unwrap_or_default();
    let identity = crate::geometry::perspective::PerspectiveAnalysisIdentityV1 {
        source_revision: loaded.artifact_source.source_fingerprint(),
        orientation_fingerprint: crate::render::artifact_identity::stable_hash(&orientation),
        lens_geometry_fingerprint: crate::render::artifact_identity::stable_hash(&lens_contract),
        analysis_dimensions: [0, 0],
        implementation_version: crate::geometry::perspective::PERSPECTIVE_IMPLEMENTATION_VERSION_V1,
    };
    let analysis = crate::geometry::perspective::analyze_perspective(&loaded.image, identity);
    let receipt =
        crate::geometry::perspective::compile_perspective_plan_with_analysis(&settings, &analysis)?;
    Ok(PerspectiveAnalysisResult { analysis, receipt })
}

#[tauri::command]
fn is_original_file_available(path: String) -> bool {
    let (source_path, _) = parse_virtual_path(&path);
    source_path.exists()
}

#[tauri::command]
fn resolve_original_source_identity(
    path: String,
) -> Result<crate::io::reference_source_identity::ReferenceSourceIdentity, String> {
    let (source_path, _) = parse_virtual_path(&path);
    crate::io::reference_source_identity::resolve_reference_source_identity(&source_path)
}

#[tauri::command]
fn cancel_thumbnail_generation(
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    state
        .thumbnail_cancellation_token
        .store(true, Ordering::SeqCst);

    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.total = 0;
    tracker.completed = 0;
    drop(tracker);

    let _ = app_handle.emit(
        crate::events::THUMBNAIL_PROGRESS,
        serde_json::json!({ "current": 0, "total": 0 }),
    );
    Ok(())
}

pub fn get_cached_full_warped_image(
    state: &tauri::State<AppState>,
    js_adjustments: &serde_json::Value,
) -> Result<Arc<DynamicImage>, String> {
    let geo_hash = calculate_geometry_hash(js_adjustments);
    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded")?;
    let identity = crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
        &loaded_image.artifact_source,
        state.load_image_generation.load(Ordering::SeqCst) as u64,
        calculate_transform_hash(js_adjustments),
        loaded_image.artifact_source.source_fingerprint(),
        geo_hash,
        loaded_image.image.width(),
        loaded_image.image.height(),
    );

    {
        let cache_lock = state.full_warped_cache.lock().unwrap();
        if let Some(cached) = cache_lock.as_ref()
            && cached.identity == identity
        {
            return Ok(Arc::clone(&cached.image));
        }
    }

    let (mut full_image, is_raw) = get_full_image_for_processing(state)?;
    if is_raw {
        apply_cpu_default_raw_processing(&mut full_image);
    }
    let warped_image = apply_geometry_warp(Cow::Borrowed(&full_image), js_adjustments).into_owned();
    let warped_arc = Arc::new(warped_image);

    {
        let mut cache_lock = state.full_warped_cache.lock().unwrap();
        *cache_lock = Some(WarpedImageCache {
            identity,
            image: Arc::clone(&warped_arc),
        });
    }

    Ok(warped_arc)
}

#[tauri::command]
fn update_wgpu_transform(
    payload: WgpuTransformPayload,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<u64, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    context
        .presentation
        .submit_transform(DisplayTransformState {
            rect: [payload.x, payload.y, payload.width, payload.height],
            clip: [
                payload.clip_x,
                payload.clip_y,
                payload.clip_width,
                payload.clip_height,
            ],
            window: [payload.window_width, payload.window_height],
            bg_primary: payload.bg_primary,
            bg_secondary: payload.bg_secondary,
            pixelated: payload.pixelated,
        })
}

#[tauri::command]
async fn flush_wgpu_presentation(
    sequence: u64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let presentation = state
        .gpu_context
        .lock()
        .unwrap()
        .as_ref()
        .map(|context| Arc::clone(&context.presentation));
    match presentation {
        Some(presentation) => presentation.flush(sequence).await,
        None => Ok(()),
    }
}

#[tauri::command]
fn get_wgpu_presentation_report(
    state: tauri::State<'_, AppState>,
) -> Option<PresentationSchedulerReport> {
    state
        .gpu_context
        .lock()
        .unwrap()
        .as_ref()
        .map(|context| context.presentation.report())
}

#[tauri::command]
fn get_gpu_pipeline_report(
    state: tauri::State<'_, AppState>,
) -> Option<gpu::pipeline_registry::GpuPipelineReport> {
    state
        .gpu_context
        .lock()
        .unwrap()
        .as_ref()
        .map(|context| context.pipeline_registry.report())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToneEqualizerPlacementResponse {
    source_identity: String,
    source_fingerprint: String,
    pivot_ev: f32,
    range_ev: f32,
    scene_black_ev: f32,
    scene_white_ev: f32,
    confidence: f32,
    histogram: [u32; 32],
}

#[tauri::command]
fn analyze_tone_equalizer_placement(
    expected_source_identity: String,
    state: tauri::State<'_, AppState>,
) -> Result<ToneEqualizerPlacementResponse, String> {
    let (image, source_identity, source_fingerprint, is_raw) = {
        let loaded = state.original_image.lock().unwrap();
        let loaded = loaded.as_ref().ok_or("tone_equalizer.no_source")?;
        if loaded.path != expected_source_identity {
            return Err("tone_equalizer.stale_source".to_string());
        }
        (
            Arc::clone(&loaded.image),
            loaded.path.clone(),
            loaded.artifact_source.source_fingerprint(),
            loaded.is_raw,
        )
    };
    let sample = image.thumbnail(256, 256);
    let sample = if is_raw {
        sample
    } else {
        apply_srgb_to_linear(sample)
    }
    .to_rgba32f();
    let luminance = sample
        .pixels()
        .map(|pixel| crate::tone::tone_equalizer::scene_luminance([pixel[0], pixel[1], pixel[2]]))
        .collect::<Vec<_>>();
    let placement = crate::tone::tone_equalizer::auto_place_from_luminance(&luminance, 0.18)
        .ok_or("tone_equalizer.insufficient_scene_samples")?;
    let mut histogram = [0_u32; 32];
    for value in luminance {
        if !value.is_finite() || value <= 1.0e-8 {
            continue;
        }
        let ev = (value / 0.18).log2();
        let bin = (((ev + 12.0) / 24.0) * histogram.len() as f32)
            .floor()
            .clamp(0.0, (histogram.len() - 1) as f32) as usize;
        histogram[bin] += 1;
    }
    let current_source = state.original_image.lock().unwrap().as_ref().map(|loaded| {
        (
            loaded.path.clone(),
            loaded.artifact_source.source_fingerprint(),
        )
    });
    if current_source != Some((source_identity.clone(), source_fingerprint)) {
        return Err("tone_equalizer.stale_source".to_string());
    }
    Ok(ToneEqualizerPlacementResponse {
        source_identity,
        source_fingerprint: format!("{source_fingerprint:016x}"),
        pivot_ev: placement.pivot_ev,
        range_ev: placement.range_ev,
        scene_black_ev: placement.scene_black_ev,
        scene_white_ev: placement.scene_white_ev,
        confidence: placement.confidence,
        histogram,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToneEqualizerPickerRequest {
    graph_revision: String,
    source_identity: String,
    normalized_image_point: ViewerSamplePoint,
    js_adjustments: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToneEqualizerPickerResponse {
    source_identity: String,
    source_fingerprint: String,
    graph_fingerprint: String,
    graph_revision: String,
    exposure_ev: f32,
    contributing_weights: [f32; crate::tone::tone_equalizer::TONE_EQ_BANDS],
    primary_band: u32,
}

#[tauri::command]
fn sample_tone_equalizer_picker(
    request: ToneEqualizerPickerRequest,
    state: tauri::State<'_, AppState>,
) -> Result<ToneEqualizerPickerResponse, String> {
    if request.graph_revision.trim().is_empty() {
        return Err("tone_equalizer.picker_missing_graph_revision".to_string());
    }
    let loaded = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("tone_equalizer.no_source")?;
    if loaded.path != request.source_identity {
        return Err("tone_equalizer.stale_source".to_string());
    }
    let source_fingerprint = loaded.artifact_source.source_fingerprint();
    let mut adjustments = request.js_adjustments;
    hydrate_adjustments(&state, &mut adjustments);
    let render_plan =
        compile_consumer_render_plan(&adjustments, &loaded.path, loaded.is_raw, None, None)?;
    let sample = crate::render::cpu_edit_graph::sample_tone_equalizer_coordinate(
        loaded.image.as_ref(),
        &render_plan.edit_graph,
        request.normalized_image_point.x,
        request.normalized_image_point.y,
    )
    .map_err(str::to_string)?;
    let current_source = state
        .original_image
        .lock()
        .unwrap()
        .as_ref()
        .map(|current| {
            (
                current.path.clone(),
                current.artifact_source.source_fingerprint(),
            )
        });
    if current_source != Some((request.source_identity.clone(), source_fingerprint)) {
        return Err("tone_equalizer.stale_source".to_string());
    }
    Ok(ToneEqualizerPickerResponse {
        source_identity: request.source_identity,
        source_fingerprint: format!("{source_fingerprint:016x}"),
        graph_fingerprint: format!("{:016x}", render_plan.edit_graph.fingerprint),
        graph_revision: request.graph_revision,
        exposure_ev: sample.exposure_ev,
        contributing_weights: sample.contributing_weights,
        primary_band: sample.primary_band,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PointColorPickerRequest {
    graph_revision: String,
    source_identity: String,
    normalized_image_point: ViewerSamplePoint,
    js_adjustments: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PointColorPickerResponse {
    source_identity: String,
    source_fingerprint: String,
    graph_fingerprint: String,
    graph_revision: String,
    lightness: f32,
    chroma: f32,
    hue_degrees: f32,
    confidence: f32,
    sample_radius_px: u32,
}

#[tauri::command]
fn sample_point_color_picker(
    request: PointColorPickerRequest,
    state: tauri::State<'_, AppState>,
) -> Result<PointColorPickerResponse, String> {
    if request.graph_revision.trim().is_empty() {
        return Err("point_color.picker_missing_graph_revision".to_string());
    }
    let loaded = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("point_color.no_source")?;
    if loaded.path != request.source_identity {
        return Err("point_color.stale_source".to_string());
    }
    let source_fingerprint = loaded.artifact_source.source_fingerprint();
    let mut adjustments = request.js_adjustments;
    hydrate_adjustments(&state, &mut adjustments);
    let render_plan =
        compile_consumer_render_plan(&adjustments, &loaded.path, loaded.is_raw, None, None)?;
    let source = loaded.image.to_rgba32f();
    let width = source.width();
    let height = source.height();
    let center_x = (request.normalized_image_point.x.clamp(0.0, 1.0)
        * f64::from(width.saturating_sub(1)))
    .round() as i32;
    let center_y = (request.normalized_image_point.y.clamp(0.0, 1.0)
        * f64::from(height.saturating_sub(1)))
    .round() as i32;
    let sample_radius_px = 2_u32;
    let mut samples = Vec::with_capacity(25);
    for y in (center_y - 2)..=(center_y + 2) {
        for x in (center_x - 2)..=(center_x + 2) {
            if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
                continue;
            }
            let pixel = source.get_pixel(x as u32, y as u32).0;
            let color = crate::color::point_color::ap1_to_oklch([pixel[0], pixel[1], pixel[2]]);
            if color.lightness.is_finite() && color.chroma.is_finite() {
                samples.push(color);
            }
        }
    }
    if samples.is_empty() {
        return Err("point_color.invalid_sample".to_string());
    }
    samples.sort_by(|left, right| left.lightness.total_cmp(&right.lightness));
    let lightness = samples[samples.len() / 2].lightness;
    samples.sort_by(|left, right| left.chroma.total_cmp(&right.chroma));
    let chroma = samples[samples.len() / 2].chroma;
    let (hue_x, hue_y) = samples.iter().fold((0.0_f32, 0.0_f32), |(x, y), sample| {
        let weight = sample.chroma.max(0.001);
        (
            x + sample.hue_degrees.to_radians().cos() * weight,
            y + sample.hue_degrees.to_radians().sin() * weight,
        )
    });
    let hue_degrees = hue_y.atan2(hue_x).to_degrees().rem_euclid(360.0);
    let spread = samples
        .iter()
        .map(|sample| (sample.lightness - lightness).abs() + (sample.chroma - chroma).abs())
        .sum::<f32>()
        / samples.len() as f32;
    let confidence = (1.0 - spread * 4.0).clamp(0.0, 1.0)
        * if lightness < 0.01 || chroma < 0.003 {
            0.25
        } else {
            1.0
        };
    let current_source = state
        .original_image
        .lock()
        .unwrap()
        .as_ref()
        .map(|current| {
            (
                current.path.clone(),
                current.artifact_source.source_fingerprint(),
            )
        });
    if current_source != Some((request.source_identity.clone(), source_fingerprint)) {
        return Err("point_color.stale_source".to_string());
    }
    Ok(PointColorPickerResponse {
        source_identity: request.source_identity,
        source_fingerprint: format!("{source_fingerprint:016x}"),
        graph_fingerprint: format!("{:016x}", render_plan.edit_graph.fingerprint),
        graph_revision: request.graph_revision,
        lightness,
        chroma,
        hue_degrees,
        confidence,
        sample_radius_px,
    })
}

fn start_analytics_worker(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<AppState>();
    let scheduler = analytics_scheduler::AnalyticsScheduler::new();
    *state.analytics_scheduler.lock().unwrap() = Some(Arc::clone(&scheduler));

    std::thread::spawn(move || {
        while let Some(job) = scheduler.next() {
            let id = job.frame_id;
            let result = image_analytics::calculate(&job, || scheduler.is_current(id));
            let current = scheduler.is_current(id);
            if current && let Ok(result) = result {
                let _ = app_handle.emit(crate::events::ANALYTICS_RESULT, result);
                scheduler.finish(true);
            } else {
                scheduler.finish(false);
            }
        }
    });
}

pub(crate) fn validate_expected_preview_image(
    actual_path: &str,
    expected_path: &str,
) -> Result<(), String> {
    if actual_path == expected_path {
        return Ok(());
    }
    Err("Preview request rejected: expected image is no longer loaded".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyAdjustmentsRequest {
    js_adjustments: serde_json::Value,
    expected_image_path: String,
    is_interactive: bool,
    target_resolution: Option<u32>,
    roi: Option<(f32, f32, f32, f32)>,
    compute_waveform: bool,
    active_waveform_channel: Option<String>,
    viewer_sample_graph_revision: Option<String>,
}

#[tauri::command]
async fn apply_adjustments(
    request: ApplyAdjustmentsRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Response, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    let loaded_image_path = state
        .original_image
        .lock()
        .unwrap()
        .as_ref()
        .ok_or("No original image loaded")?
        .path
        .clone();
    validate_expected_preview_image(&loaded_image_path, &request.expected_image_path)?;

    {
        let scheduler_guard = state.preview_scheduler.lock().unwrap();
        if let Some(scheduler) = &*scheduler_guard {
            let job = PreviewJob {
                adjustments: Arc::new(request.js_adjustments),
                expected_image_path: request.expected_image_path,
                is_interactive: request.is_interactive,
                target_resolution: request.target_resolution,
                roi: request.roi,
                compute_waveform: request.compute_waveform,
                active_waveform_channel: request.active_waveform_channel,
                viewer_sample_graph_revision: request.viewer_sample_graph_revision,
                responder: tx,
            };
            scheduler
                .submit(job)
                .map_err(|_| "preview_worker_stopped".to_string())?;
        } else {
            return Err("Preview worker not running".to_string());
        }
    }

    match rx.await {
        Ok(preview_scheduler::PreviewCompletion::Rendered { bytes, .. }) => {
            Ok(Response::new(bytes))
        }
        Ok(preview_scheduler::PreviewCompletion::Superseded { .. }) => {
            Err("preview_superseded".to_string())
        }
        Ok(preview_scheduler::PreviewCompletion::Cancelled { .. }) => {
            Err("preview_cancelled".to_string())
        }
        Ok(preview_scheduler::PreviewCompletion::Failed { code, message }) => {
            Err(format!("{code}: {message}"))
        }
        Err(_) => Err("preview_worker_stopped".to_string()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportSoftProofPreviewRequest {
    active_waveform_channel: Option<String>,
    black_point_compensation: bool,
    compute_waveform: bool,
    color_profile: export::export_processing::ExportColorProfile,
    expected_image_path: Option<String>,
    export_soft_proof_recipe_id: Option<String>,
    js_adjustments: serde_json::Value,
    rendering_intent: export::export_processing::ExportRenderingIntent,
    target_resolution: Option<u32>,
    viewer_sample_graph_revision: Option<String>,
}

#[tauri::command]
fn generate_export_soft_proof_preview(
    request: ExportSoftProofPreviewRequest,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Response, String> {
    let mut adjustments_clone = request.js_adjustments;
    hydrate_adjustments(&state, &mut adjustments_clone);

    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded")?;
    if let Some(expected_image_path) = request.expected_image_path.as_deref() {
        validate_expected_preview_image(&loaded_image.path, expected_image_path)?;
    }

    let preview_dim = request.target_resolution.unwrap_or(1920).clamp(512, 8192);
    let preview_image = render_processed_export_soft_proof_preview(
        &state,
        &app_handle,
        &loaded_image,
        &adjustments_clone,
        preview_dim,
    )?;
    let (proof_pixels, width, height, _) =
        export::export_processing::export_soft_proof_rgb_pixels_with_working_color_state(
            &preview_image,
            if loaded_image.is_raw {
                color::working_to_output_transform::WorkingColorState::AcesCgLinearV1
            } else {
                color::working_to_output_transform::WorkingColorState::EncodedSrgbV1
            },
            &request.color_profile,
            &request.rendering_intent,
            request.black_point_compensation,
        )?;
    let proof_metadata = export::export_processing::export_soft_proof_transform_metadata(
        &preview_image,
        &request.color_profile,
        &request.rendering_intent,
        request.black_point_compensation,
    )?;

    if let Some(graph_revision) = request.viewer_sample_graph_revision.as_deref()
        && let Some(proof_image) = RgbImage::from_raw(width, height, proof_pixels.clone())
    {
        let graph_hash = crate::render::artifact_identity::stable_hash(&graph_revision);
        let mut artifact_identity =
            crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
                &loaded_image.artifact_source,
                state.load_image_generation.load(Ordering::SeqCst) as u64,
                graph_hash,
                loaded_image.artifact_source.source_fingerprint(),
                calculate_geometry_hash(&adjustments_clone),
                width,
                height,
            );
        artifact_identity.color_domain =
            crate::render::artifact_identity::ArtifactColorDomain::DisplayEncoded;
        artifact_identity.completed_stage = "soft-proof-output";
        artifact_identity.display_snapshot =
            Some(crate::render::artifact_identity::stable_hash(&format!(
                "{:?}:{:?}:{}",
                request.color_profile, request.rendering_intent, request.black_point_compensation
            )));
        let frame = CachedViewerSampleFrame {
            artifact_identity,
            graph_revision: graph_revision.to_string(),
            pixels: crate::app_state::SampleablePixels::native(Arc::new(DynamicImage::ImageRgb8(
                proof_image,
            ))),
            image_identity: loaded_image.path.clone(),
            space_label: format!("Soft proof · {}", proof_metadata.effective_color_profile),
        };
        let weight = frame.pixels.retained_bytes();
        state
            .viewer_sample_frames
            .insert("softProof".to_string(), Arc::new(frame), weight);
    }

    let proof_image =
        RgbImage::from_raw(width, height, proof_pixels.clone()).map(DynamicImage::ImageRgb8);

    if let Some(recipe_id) = request.export_soft_proof_recipe_id
        && let Some(proof_image) = proof_image.as_ref()
        && let Ok(gamut_warning_data) =
            image_analytics::calculate_gamut_warning_overlay_from_image(proof_image)
    {
        let source_image_path = &loaded_image.path;
        let _ = app_handle.emit(
            crate::events::GAMUT_WARNING_UPDATE,
            serde_json::json!({
                "path": source_image_path,
                "data": {
                    "black_point_compensation": proof_metadata.black_point_compensation,
                    "color_managed_transform": proof_metadata.color_managed_transform,
                    "coverage_ratio": gamut_warning_data.coverage_ratio,
                    "effective_color_profile": proof_metadata.effective_color_profile,
                    "effective_rendering_intent": proof_metadata.effective_rendering_intent,
                    "export_soft_proof_recipe_id": recipe_id,
                    "height": gamut_warning_data.height,
                    "mask_data_url": gamut_warning_data.mask_data_url,
                    "max_channel_value": gamut_warning_data.max_channel_value,
                    "min_channel_value": gamut_warning_data.min_channel_value,
                    "pixel_count": gamut_warning_data.pixel_count,
                    "policy_status": proof_metadata.policy_status,
                    "policy_version": proof_metadata.policy_version,
                    "preview_basis": "export_preview",
                    "source_image_path": source_image_path,
                    "source_precision_path": proof_metadata.source_precision_path,
                    "transform_applied": proof_metadata.transform_applied,
                    "transform_policy_fingerprint": proof_metadata.transform_policy_fingerprint,
                    "warning_pixel_count": gamut_warning_data.warning_pixel_count,
                    "width": gamut_warning_data.width,
                }
            }),
        );
    }

    if let Some(proof_image) = proof_image
        && let Some(scheduler) = state.analytics_scheduler.lock().unwrap().clone()
    {
        let _ = scheduler.submit(AnalyticsJob {
            path: loaded_image.path,
            frame_id: AnalyticsFrameId::default(),
            image: Arc::new(proof_image),
            products: AnalyticsProducts::HISTOGRAM
                | AnalyticsProducts::GAMUT_MASK
                | if request.compute_waveform {
                    AnalyticsProducts::all()
                } else {
                    AnalyticsProducts::empty()
                },
            active_waveform_channel: request.active_waveform_channel,
            policy: AnalyticsSamplingPolicy::default(),
        });
    }

    rapidraw_codecs::encode_jpeg_rgb(&proof_pixels, width, height, 86, JpegPreset::Fastest, None)
        .map(Response::new)
        .map_err(|e| format!("Failed to encode export soft proof preview: {}", e))
}

#[tauri::command]
fn resolve_export_soft_proof_transform_metadata(
    js_adjustments: serde_json::Value,
    color_profile: export::export_processing::ExportColorProfile,
    rendering_intent: export::export_processing::ExportRenderingIntent,
    black_point_compensation: bool,
    target_resolution: Option<u32>,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<export::export_processing::ExportReceiptMetadata, String> {
    let mut adjustments_clone = js_adjustments;
    hydrate_adjustments(&state, &mut adjustments_clone);

    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded")?;

    let preview_dim = target_resolution.unwrap_or(1920).clamp(512, 8192);
    let preview_image = render_processed_export_soft_proof_preview(
        &state,
        &app_handle,
        &loaded_image,
        &adjustments_clone,
        preview_dim,
    )?;

    export::export_processing::export_soft_proof_transform_metadata(
        &preview_image,
        &color_profile,
        &rendering_intent,
        black_point_compensation,
    )
}

fn render_processed_export_soft_proof_preview(
    state: &tauri::State<AppState>,
    app_handle: &tauri::AppHandle,
    loaded_image: &LoadedImage,
    adjustments: &serde_json::Value,
    preview_dim: u32,
) -> Result<DynamicImage, String> {
    let context = get_or_init_gpu_context(state, app_handle)?;
    let transform_hash = calculate_transform_hash(adjustments);
    let (preview_image, scale, unscaled_crop_offset) =
        generate_transformed_preview(state, loaded_image, adjustments, preview_dim)?;
    let detail_stage = render_pipeline::apply_pre_gpu_detail_stages(
        &preview_image,
        transform_hash,
        adjustments,
        loaded_image.is_raw,
    );
    let processing_image = detail_stage.image.as_ref();
    let (preview_width, preview_height) = processing_image.dimensions();
    let mask_definitions: Vec<MaskDefinition> = adjustments
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
                state,
                def,
                preview_width,
                preview_height,
                scale,
                scaled_crop_offset,
                adjustments,
            )
        })
        .collect();
    let retouched_image = crate::retouch_render::apply_clone_retouch_layers(
        processing_image,
        adjustments,
        &mask_bitmaps,
    );
    let tm_override = resolve_tonemapper_override_from_handle(app_handle, loaded_image.is_raw);
    let lut: Option<Arc<Lut>> = adjustments["lutPath"]
        .as_str()
        .and_then(|path| get_or_load_lut(state, path).ok());
    let render_plan = compile_consumer_render_plan(
        adjustments,
        &loaded_image.path,
        loaded_image.is_raw,
        tm_override,
        lut,
    )?;
    let mut gpu_adjustments = render_plan.adjustments;
    render_pipeline::suppress_legacy_global_denoise(&mut gpu_adjustments);
    render_pipeline::suppress_legacy_global_detail(
        &mut gpu_adjustments,
        detail_stage.owns_legacy_global_detail,
    );
    process_and_get_dynamic_image(
        &context,
        state,
        retouched_image.as_ref(),
        crate::gpu_processing::PreGpuImageIdentity::for_stage(
            retouched_image.as_ref(),
            loaded_image.artifact_source.source_fingerprint(),
            detail_stage.render_hash,
            crate::gpu_processing::PixelBufferRevision::combine_generations(&[
                detail_stage.render_hash,
                calculate_geometry_hash(adjustments),
            ]),
        ),
        RenderRequest {
            adjustments: gpu_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut: render_plan.lut.clone(),
            roi: None,
            edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(Arc::clone(
                &render_plan.edit_graph,
            )),
        },
        "export_soft_proof_preview",
    )
}

fn compile_consumer_render_plan(
    adjustments: &Value,
    source_identity: &str,
    is_raw: bool,
    tonemapper_override: Option<u32>,
    lut: Option<Arc<Lut>>,
) -> Result<Arc<render_plan::CompiledRenderPlan>, String> {
    let revision = render_plan::content_revision(
        adjustments,
        0,
        render::artifact_identity::source_fingerprint_for_path(source_identity),
        u64::from(tonemapper_override.unwrap_or(0)),
    );
    render_plan::compile_render_plan_cached(
        adjustments,
        render_plan::CompileRenderPlanContext {
            revision,
            is_raw,
            tonemapper_override,
        },
        lut,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn generate_uncropped_preview(
    js_adjustments: serde_json::Value,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let mut adjustments_clone = js_adjustments;
    hydrate_adjustments(&state, &mut adjustments_clone);

    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded")?;

    thread::spawn(move || {
        let state = app_handle.state::<AppState>();
        let is_raw = loaded_image.is_raw;
        let has_patches = adjustments_clone
            .get("aiPatches")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty());
        let patched_image = if has_patches {
            composite_patches_on_image(&loaded_image.image, &adjustments_clone).unwrap_or_else(
                |e| {
                    eprintln!("Failed to composite patches for uncropped preview: {}", e);
                    Cow::Borrowed(loaded_image.image.as_ref())
                },
            )
        } else {
            Cow::Borrowed(loaded_image.image.as_ref())
        };

        let warped_image = apply_geometry_warp(patched_image, &adjustments_clone);

        let orientation_steps = adjustments_clone[adjustment_fields::ORIENTATION_STEPS]
            .as_u64()
            .unwrap_or(0) as u8;
        let coarse_rotated_image = apply_coarse_rotation(warped_image, orientation_steps);

        let flip_horizontal = adjustments_clone[adjustment_fields::FLIP_HORIZONTAL]
            .as_bool()
            .unwrap_or(false);
        let flip_vertical = adjustments_clone[adjustment_fields::FLIP_VERTICAL]
            .as_bool()
            .unwrap_or(false);

        let flipped_image =
            apply_flip(coarse_rotated_image, flip_horizontal, flip_vertical).into_owned();

        let settings = load_settings_or_default(&app_handle);
        let preview_dim = settings.editor_preview_resolution.unwrap_or(1920);

        let (rotated_w, rotated_h) = flipped_image.dimensions();

        let (processing_base, scale_for_gpu) = if rotated_w > preview_dim || rotated_h > preview_dim
        {
            let base = downscale_f32_image(&flipped_image, preview_dim, preview_dim);
            let scale = if rotated_w > 0 {
                base.width() as f32 / rotated_w as f32
            } else {
                1.0
            };
            (base, scale)
        } else {
            (flipped_image, 1.0)
        };

        let (preview_width, preview_height) = processing_base.dimensions();

        let mask_definitions: Vec<MaskDefinition> = adjustments_clone
            .get("masks")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_default();

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                get_cached_or_generate_mask(
                    &state,
                    def,
                    preview_width,
                    preview_height,
                    scale_for_gpu,
                    (0.0, 0.0),
                    &adjustments_clone,
                )
            })
            .collect();

        let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
        let render_adjustments = normalize_film_look_adjustments_for_render(&adjustments_clone);
        let lut_path = render_adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
        let render_plan = match compile_consumer_render_plan(
            render_adjustments.as_ref(),
            &loaded_image.path,
            is_raw,
            tm_override,
            lut,
        ) {
            Ok(plan) => plan,
            Err(error) => {
                log::error!("uncropped preview edit graph compilation failed: {error}");
                return;
            }
        };
        let detail_stage = render_pipeline::apply_pre_gpu_detail_stages(
            &processing_base,
            calculate_transform_hash(render_adjustments.as_ref()),
            render_adjustments.as_ref(),
            is_raw,
        );
        let mut gpu_adjustments = render_plan.adjustments;
        render_pipeline::suppress_legacy_global_denoise(&mut gpu_adjustments);
        render_pipeline::suppress_legacy_global_detail(
            &mut gpu_adjustments,
            detail_stage.owns_legacy_global_detail,
        );
        if let Ok(processed_image) = process_and_get_dynamic_image(
            &context,
            &state,
            detail_stage.image.as_ref(),
            crate::gpu_processing::PreGpuImageIdentity::for_stage(
                detail_stage.image.as_ref(),
                loaded_image.artifact_source.source_fingerprint(),
                detail_stage.render_hash,
                detail_stage.render_hash,
            ),
            RenderRequest {
                adjustments: gpu_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut: render_plan.lut.clone(),
                roi: None,
                edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(
                    Arc::clone(&render_plan.edit_graph),
                ),
            },
            "generate_uncropped_preview",
        ) {
            match encode_jpeg_data_url(&processed_image, 80) {
                Ok(data_url) => {
                    let _ = app_handle.emit(crate::events::PREVIEW_UPDATE_UNCROPPED, data_url);
                }
                Err(e) => {
                    log::error!("Failed to encode uncropped preview: {}", e);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn generate_original_transformed_preview(
    js_adjustments: serde_json::Value,
    target_resolution: Option<u32>,
    viewer_sample_graph_revision: Option<String>,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded")?;

    let mut adjustments_clone = js_adjustments;
    hydrate_adjustments(&state, &mut adjustments_clone);

    let mut image_for_preview = loaded_image.image.as_ref().clone();
    if loaded_image.is_raw {
        apply_cpu_default_raw_processing(&mut image_for_preview);
    }

    let (transformed_full_res, _unscaled_crop_offset) =
        apply_all_transformations(Cow::Borrowed(&image_for_preview), &adjustments_clone);

    let settings = load_settings_or_default(&app_handle);
    let default_dim = settings.editor_preview_resolution.unwrap_or(1920);
    let preview_dim = target_resolution.unwrap_or(default_dim);

    let (w, h) = transformed_full_res.dimensions();
    let transformed_image = if w > preview_dim || h > preview_dim {
        downscale_f32_image(transformed_full_res.as_ref(), preview_dim, preview_dim)
    } else {
        transformed_full_res.into_owned()
    };

    if let Some(graph_revision) = viewer_sample_graph_revision {
        let graph_hash = crate::render::artifact_identity::stable_hash(&graph_revision);
        let mut artifact_identity =
            crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
                &loaded_image.artifact_source,
                state.load_image_generation.load(Ordering::SeqCst) as u64,
                graph_hash,
                loaded_image.artifact_source.source_fingerprint(),
                calculate_geometry_hash(&adjustments_clone),
                transformed_image.width(),
                transformed_image.height(),
            );
        artifact_identity.color_domain =
            crate::render::artifact_identity::ArtifactColorDomain::ViewEncoded;
        artifact_identity.completed_stage = "original-view";
        let frame = CachedViewerSampleFrame {
            artifact_identity,
            graph_revision,
            pixels: crate::app_state::SampleablePixels::native(Arc::new(transformed_image.clone())),
            image_identity: loaded_image.path,
            space_label: "Original · Display encoded sRGB".to_string(),
        };
        let weight = frame.pixels.retained_bytes();
        state
            .viewer_sample_frames
            .insert("original".to_string(), Arc::new(frame), weight);
    }

    encode_jpeg_data_url(&transformed_image, 80)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ViewerSamplePoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ViewerSampleImageSize {
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ViewerSampleTarget {
    Edited,
    Original,
    SoftProof,
}

impl ViewerSampleTarget {
    fn cache_key(self) -> &'static String {
        static EDITED: std::sync::LazyLock<String> =
            std::sync::LazyLock::new(|| "edited".to_string());
        static ORIGINAL: std::sync::LazyLock<String> =
            std::sync::LazyLock::new(|| "original".to_string());
        static SOFT_PROOF: std::sync::LazyLock<String> =
            std::sync::LazyLock::new(|| "softProof".to_string());
        match self {
            Self::Edited => &EDITED,
            Self::Original => &ORIGINAL,
            Self::SoftProof => &SOFT_PROOF,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ViewerSampleSpace {
    DisplayEncoded,
    WorkingLinear,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerSampleRequest {
    request_identity: String,
    image_identity: String,
    graph_revision: String,
    geometry_epoch: u64,
    normalized_image_point: ViewerSamplePoint,
    source_image_size: ViewerSampleImageSize,
    target: ViewerSampleTarget,
    sample_radius_image_px: u32,
    requested_space: ViewerSampleSpace,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ViewerSampleUnavailableReason {
    FrameUnavailable,
    StaleFrame,
    UnsupportedSpace,
    InvalidPoint,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ViewerClippedChannels(u8);

impl Serialize for ViewerClippedChannels {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeSeq;
        let mut sequence = serializer.serialize_seq(Some(self.0.count_ones() as usize))?;
        for (bit, label) in [(1, "r"), (2, "g"), (4, "b")] {
            if self.0 & bit != 0 {
                sequence.serialize_element(label)?;
            }
        }
        sequence.end()
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum ViewerSampleResponse {
    Available {
        #[serde(rename = "requestIdentity")]
        request_identity: String,
        #[serde(rename = "imagePointPx")]
        image_point_px: ViewerSamplePointPx,
        rgb: [f64; 3],
        luma: f64,
        #[serde(rename = "clippedChannels")]
        clipped_channels: ViewerClippedChannels,
        #[serde(rename = "spaceLabel")]
        space_label: String,
    },
    Unavailable {
        #[serde(rename = "requestIdentity")]
        request_identity: String,
        reason: ViewerSampleUnavailableReason,
        #[serde(rename = "spaceLabel")]
        space_label: String,
    },
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
struct ViewerSamplePointPx {
    x: u32,
    y: u32,
}

fn unavailable_viewer_sample(
    request: &ViewerSampleRequest,
    reason: ViewerSampleUnavailableReason,
    space_label: &str,
) -> ViewerSampleResponse {
    ViewerSampleResponse::Unavailable {
        request_identity: request.request_identity.clone(),
        reason,
        space_label: space_label.to_string(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ViewerSampleRect {
    min_x: u32,
    max_x: u32,
    min_y: u32,
    max_y: u32,
    image_point_px: ViewerSamplePointPx,
}

fn resolve_sample_rect(
    request: &ViewerSampleRequest,
    width: u32,
    height: u32,
) -> Option<ViewerSampleRect> {
    let point = request.normalized_image_point;
    if width == 0
        || height == 0
        || request.source_image_size.width == 0
        || request.source_image_size.height == 0
        || !point.x.is_finite()
        || !point.y.is_finite()
        || !(0.0..=1.0).contains(&point.x)
        || !(0.0..=1.0).contains(&point.y)
    {
        return None;
    }
    let center_x = (point.x * f64::from(width - 1)).round() as u32;
    let center_y = (point.y * f64::from(height - 1)).round() as u32;
    let source_max = request
        .source_image_size
        .width
        .max(request.source_image_size.height);
    let frame_max = width.max(height);
    let radius = ((request.sample_radius_image_px as f64 * f64::from(frame_max)
        / f64::from(source_max))
    .ceil() as u32)
        .min(16);
    Some(ViewerSampleRect {
        min_x: center_x.saturating_sub(radius),
        max_x: center_x.saturating_add(radius).min(width - 1),
        min_y: center_y.saturating_sub(radius),
        max_y: center_y.saturating_add(radius).min(height - 1),
        image_point_px: ViewerSamplePointPx {
            x: (point.x * f64::from(request.source_image_size.width - 1)).round() as u32,
            y: (point.y * f64::from(request.source_image_size.height - 1)).round() as u32,
        },
    })
}

static VIEWER_SAMPLE_PIXELS_VISITED: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

fn sum_native_pixels(image: &DynamicImage, rect: ViewerSampleRect) -> Option<([f64; 3], u64)> {
    macro_rules! sum_rows {
        ($buffer:expr, $channels:expr, $scale:expr) => {{
            let raw = $buffer.as_raw();
            let width = $buffer.width() as usize;
            let channels = $channels;
            let mut totals = [0.0_f64; 3];
            let mut count = 0_u64;
            for y in rect.min_y as usize..=rect.max_y as usize {
                let start = (y * width + rect.min_x as usize) * channels;
                let end = (y * width + rect.max_x as usize + 1) * channels;
                for pixel in raw.get(start..end)?.chunks_exact(channels) {
                    totals[0] += pixel[0] as f64 * $scale;
                    totals[1] += pixel[1] as f64 * $scale;
                    totals[2] += pixel[2] as f64 * $scale;
                    count += 1;
                }
            }
            Some((totals, count))
        }};
    }
    match image {
        DynamicImage::ImageRgb8(buffer) => sum_rows!(buffer, 3, 1.0 / 255.0),
        DynamicImage::ImageRgba8(buffer) => sum_rows!(buffer, 4, 1.0 / 255.0),
        DynamicImage::ImageRgb16(buffer) => sum_rows!(buffer, 3, 1.0 / 65535.0),
        DynamicImage::ImageRgba16(buffer) => sum_rows!(buffer, 4, 1.0 / 65535.0),
        DynamicImage::ImageRgb32F(buffer) => sum_rows!(buffer, 3, 1.0),
        DynamicImage::ImageRgba32F(buffer) => sum_rows!(buffer, 4, 1.0),
        _ => None,
    }
}

fn sample_viewer_frame(
    request: &ViewerSampleRequest,
    frame: &CachedViewerSampleFrame,
) -> ViewerSampleResponse {
    if request.requested_space != ViewerSampleSpace::DisplayEncoded {
        return unavailable_viewer_sample(
            request,
            ViewerSampleUnavailableReason::UnsupportedSpace,
            &frame.space_label,
        );
    }
    if !request.normalized_image_point.x.is_finite()
        || !request.normalized_image_point.y.is_finite()
        || !(0.0..=1.0).contains(&request.normalized_image_point.x)
        || !(0.0..=1.0).contains(&request.normalized_image_point.y)
        || request.source_image_size.width == 0
        || request.source_image_size.height == 0
    {
        return unavailable_viewer_sample(
            request,
            ViewerSampleUnavailableReason::InvalidPoint,
            &frame.space_label,
        );
    }
    let (width, height) = frame.pixels.dimensions();
    let Some(rect) = resolve_sample_rect(request, width, height) else {
        return unavailable_viewer_sample(
            request,
            if width == 0 || height == 0 {
                ViewerSampleUnavailableReason::FrameUnavailable
            } else {
                ViewerSampleUnavailableReason::InvalidPoint
            },
            &frame.space_label,
        );
    };
    let Some((totals, count)) = sum_native_pixels(frame.pixels.image(), rect) else {
        return unavailable_viewer_sample(
            request,
            ViewerSampleUnavailableReason::FrameUnavailable,
            &frame.space_label,
        );
    };
    VIEWER_SAMPLE_PIXELS_VISITED.fetch_add(count, std::sync::atomic::Ordering::Relaxed);
    let channels = totals.map(|value| (value / count as f64).clamp(0.0, 1.0));
    let clipped_channels =
        ViewerClippedChannels(channels.iter().enumerate().fold(0, |bits, (index, value)| {
            bits | (u8::from(*value >= 1.0 - f64::EPSILON) << index)
        }));
    ViewerSampleResponse::Available {
        request_identity: request.request_identity.clone(),
        image_point_px: rect.image_point_px,
        rgb: channels,
        luma: channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722,
        clipped_channels,
        space_label: frame.space_label.clone(),
    }
}

#[tauri::command]
fn sample_viewer_pixel(
    request: ViewerSampleRequest,
    state: tauri::State<AppState>,
) -> ViewerSampleResponse {
    let _geometry_epoch = request.geometry_epoch;
    let Some(frame) = state.viewer_sample_frames.get(request.target.cache_key()) else {
        return unavailable_viewer_sample(
            &request,
            ViewerSampleUnavailableReason::FrameUnavailable,
            "Unavailable",
        );
    };
    if frame.image_identity != request.image_identity
        || frame.graph_revision != request.graph_revision
    {
        return unavailable_viewer_sample(
            &request,
            ViewerSampleUnavailableReason::StaleFrame,
            &frame.space_label,
        );
    }
    sample_viewer_frame(&request, frame.as_ref())
}

#[cfg(test)]
mod viewer_sampler_tests {
    use super::*;
    use std::time::Instant;

    fn fixture_request(radius: u32) -> ViewerSampleRequest {
        ViewerSampleRequest {
            request_identity: "fixture-request".to_string(),
            image_identity: "/fixture/color-patches.tif".to_string(),
            graph_revision: "history_3".to_string(),
            geometry_epoch: 9,
            normalized_image_point: ViewerSamplePoint { x: 0.5, y: 0.5 },
            source_image_size: ViewerSampleImageSize {
                width: 3,
                height: 1,
            },
            target: ViewerSampleTarget::Edited,
            sample_radius_image_px: radius,
            requested_space: ViewerSampleSpace::DisplayEncoded,
        }
    }

    fn frame(image: DynamicImage) -> CachedViewerSampleFrame {
        let (width, height) = image.dimensions();
        CachedViewerSampleFrame {
            artifact_identity:
                crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
                    &crate::render::artifact_identity::tests_support::source(
                        "/fixture/color-patches.tif",
                    ),
                    1,
                    1,
                    1,
                    1,
                    width,
                    height,
                ),
            graph_revision: "history_3".to_string(),
            pixels: crate::app_state::SampleablePixels::native(Arc::new(image)),
            image_identity: "/fixture/color-patches.tif".to_string(),
            space_label: "Display encoded sRGB".to_string(),
        }
    }

    fn available(response: ViewerSampleResponse) -> ([f64; 3], f64, ViewerSamplePointPx) {
        match response {
            ViewerSampleResponse::Available {
                rgb,
                luma,
                image_point_px,
                ..
            } => (rgb, luma, image_point_px),
            response => panic!("expected available response, got {response:?}"),
        }
    }

    #[test]
    fn samples_known_display_encoded_patch_and_luma() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(3, 1, |x, _| match x {
            0 => image::Rgb([255, 0, 0]),
            1 => image::Rgb([0, 128, 0]),
            _ => image::Rgb([0, 0, 255]),
        }));
        let frame = frame(image);

        let (rgb, luma, point) = available(sample_viewer_frame(&fixture_request(0), &frame));
        assert!((rgb[1] - 128.0 / 255.0).abs() < 1e-6);
        assert!((luma - 0.7152 * 128.0 / 255.0).abs() < 1e-6);
        assert_eq!(point, ViewerSamplePointPx { x: 1, y: 0 });
    }

    #[test]
    fn radius_average_and_unsupported_domain_are_explicit() {
        let frame = frame(DynamicImage::ImageRgb8(ImageBuffer::from_fn(
            3,
            1,
            |x, _| image::Rgb(if x == 1 { [255, 255, 255] } else { [0, 0, 0] }),
        )));
        let (rgb, _, _) = available(sample_viewer_frame(&fixture_request(1), &frame));
        assert!((rgb[0] - 1.0 / 3.0).abs() < 1e-6);

        let mut linear_request = fixture_request(0);
        linear_request.requested_space = ViewerSampleSpace::WorkingLinear;
        let unavailable = sample_viewer_frame(&linear_request, &frame);
        assert!(matches!(
            unavailable,
            ViewerSampleResponse::Unavailable {
                reason: ViewerSampleUnavailableReason::UnsupportedSpace,
                ..
            }
        ));
    }

    #[test]
    fn typed_response_preserves_frontend_wire_schema() {
        let response = sample_viewer_frame(
            &fixture_request(0),
            &frame(DynamicImage::ImageRgb8(ImageBuffer::from_pixel(
                1,
                1,
                image::Rgb([255, 0, 255]),
            ))),
        );
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "status": "available",
                "requestIdentity": "fixture-request",
                "imagePointPx": { "x": 1, "y": 0 },
                "rgb": [1.0, 0.0, 1.0],
                "luma": 0.2848,
                "clippedChannels": ["r", "b"],
                "spaceLabel": "Display encoded sRGB",
            })
        );
    }

    #[test]
    fn direct_native_formats_match_rgb32f_reference() {
        let images = [
            DynamicImage::ImageRgb8(ImageBuffer::from_pixel(3, 1, image::Rgb([64, 128, 255]))),
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
                3,
                1,
                image::Rgba([64, 128, 255, 7]),
            )),
            DynamicImage::ImageRgb16(ImageBuffer::from_pixel(
                3,
                1,
                image::Rgb([16448, 32896, 65535]),
            )),
            DynamicImage::ImageRgba16(ImageBuffer::from_pixel(
                3,
                1,
                image::Rgba([16448, 32896, 65535, 12]),
            )),
            DynamicImage::ImageRgb32F(ImageBuffer::from_pixel(3, 1, image::Rgb([0.25, 0.5, 1.25]))),
            DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
                3,
                1,
                image::Rgba([0.25, 0.5, 1.25, -4.0]),
            )),
        ];
        for image in images {
            let reference = image.to_rgb32f().get_pixel(1, 0).0.map(f64::from);
            let (actual, _, _) = available(sample_viewer_frame(&fixture_request(0), &frame(image)));
            for channel in 0..3 {
                assert!((actual[channel] - reference[channel].clamp(0.0, 1.0)).abs() < 1e-5);
            }
        }
    }

    #[test]
    fn resolves_edges_radius_cap_and_invalid_dimensions() {
        let mut request = fixture_request(u32::MAX);
        request.normalized_image_point = ViewerSamplePoint { x: 0.0, y: 1.0 };
        request.source_image_size = ViewerSampleImageSize {
            width: 10,
            height: 10,
        };
        assert_eq!(
            resolve_sample_rect(&request, 100, 50),
            Some(ViewerSampleRect {
                min_x: 0,
                max_x: 16,
                min_y: 33,
                max_y: 49,
                image_point_px: ViewerSamplePointPx { x: 0, y: 9 },
            })
        );
        assert!(resolve_sample_rect(&request, 0, 50).is_none());
        request.normalized_image_point.x = f64::NAN;
        assert!(resolve_sample_rect(&request, 100, 50).is_none());
    }

    #[test]
    #[ignore = "manual 8K sampling benchmark"]
    fn benchmark_8k_10k_samples_are_radius_bounded() {
        let frame = frame(DynamicImage::ImageRgb8(ImageBuffer::from_pixel(
            7680,
            4320,
            image::Rgb([64, 128, 255]),
        )));
        let legacy_iterations = 3_u32;
        let legacy_started = Instant::now();
        for _ in 0..legacy_iterations {
            std::hint::black_box(frame.pixels.image().to_rgb32f());
        }
        let legacy_elapsed = legacy_started.elapsed();
        eprintln!(
            "8K legacy full-frame conversion: iterations={legacy_iterations} elapsed={legacy_elapsed:?} avg={:?} temporary_bytes_per_request={}",
            legacy_elapsed / legacy_iterations,
            7680_u64 * 4320 * 12,
        );
        for radius in [0, 4, 16] {
            let mut request = fixture_request(radius);
            request.source_image_size = ViewerSampleImageSize {
                width: 7680,
                height: 4320,
            };
            let before = VIEWER_SAMPLE_PIXELS_VISITED.load(std::sync::atomic::Ordering::Relaxed);
            let started = Instant::now();
            for _ in 0..10_000 {
                std::hint::black_box(sample_viewer_frame(&request, &frame));
            }
            let elapsed = started.elapsed();
            let visited =
                VIEWER_SAMPLE_PIXELS_VISITED.load(std::sync::atomic::Ordering::Relaxed) - before;
            eprintln!(
                "8K radius={radius}: elapsed={elapsed:?} visited={visited} old_rgb32f_temp_bytes_per_request={}",
                7680_u64 * 4320 * 12
            );
            assert!(visited <= 10_000 * u64::from((2 * radius.min(16) + 1).pow(2)));
        }
    }
}

#[tauri::command]
async fn preview_geometry_transform(
    params: GeometryParams,
    js_adjustments: serde_json::Value,
    show_lines: bool,
    target: Option<PreviewGeometryTarget>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let (loaded_image_path, loaded_source_revision, is_raw) = {
        let guard = state.original_image.lock().unwrap();
        let loaded = guard.as_ref().ok_or("No image loaded")?;
        (
            loaded.path.clone(),
            loaded.artifact_source.source_fingerprint(),
            loaded.is_raw,
        )
    };

    let settings = load_settings_or_default(&app_handle);
    let target = target.unwrap_or(PreviewGeometryTarget::EditorSetting {
        quality: PreviewGeometryQuality::Interactive,
    });
    let target_dim = target.resolve_long_edge(settings.editor_preview_resolution.unwrap_or(1920));
    let visual_hash = calculate_visual_hash(&loaded_image_path, &js_adjustments)
        .wrapping_mul(31)
        .wrapping_add(u64::from(target_dim));

    let base_image_to_warp = {
        let maybe_cached_image = state.geometry_cache.get(&visual_hash);

        if let Some(cached_image) = maybe_cached_image {
            cached_image.as_ref().clone()
        } else {
            let context = get_or_init_gpu_context(&state, &app_handle)?;

            let original_image = {
                let guard = state.original_image.lock().unwrap();
                let loaded = guard.as_ref().ok_or("No image loaded")?;
                loaded.image.clone()
            };

            let preview_base = tokio::task::spawn_blocking(move || -> DynamicImage {
                downscale_f32_image(&original_image, target_dim, target_dim)
            })
            .await
            .map_err(|e| e.to_string())?;

            let mut temp_adjustments = js_adjustments.clone();
            hydrate_adjustments(&state, &mut temp_adjustments);

            if let Some(obj) = temp_adjustments.as_object_mut() {
                obj.insert(adjustment_fields::CROP.to_string(), serde_json::Value::Null);
                obj.insert(
                    adjustment_fields::ROTATION.to_string(),
                    serde_json::json!(0.0),
                );
                obj.insert(
                    adjustment_fields::ORIENTATION_STEPS.to_string(),
                    serde_json::json!(0),
                );
                obj.insert(
                    adjustment_fields::FLIP_HORIZONTAL.to_string(),
                    serde_json::json!(false),
                );
                obj.insert(
                    adjustment_fields::FLIP_VERTICAL.to_string(),
                    serde_json::json!(false),
                );
                for key in adjustment_fields::GEOMETRY_KEYS {
                    match *key {
                        adjustment_fields::TRANSFORM_SCALE
                        | adjustment_fields::LENS_DISTORTION_AMOUNT
                        | adjustment_fields::LENS_VIGNETTE_AMOUNT
                        | adjustment_fields::LENS_TCA_AMOUNT => {
                            obj.insert(key.to_string(), serde_json::json!(100.0));
                        }
                        adjustment_fields::LENS_DISTORTION_PARAMS
                        | adjustment_fields::LENS_MAKER
                        | adjustment_fields::LENS_MODEL => {
                            obj.insert(key.to_string(), serde_json::Value::Null);
                        }
                        adjustment_fields::LENS_DISTORTION_ENABLED
                        | adjustment_fields::LENS_TCA_ENABLED
                        | adjustment_fields::LENS_VIGNETTE_ENABLED => {
                            obj.insert(key.to_string(), serde_json::json!(true));
                        }
                        _ => {
                            obj.insert(key.to_string(), serde_json::json!(0.0));
                        }
                    }
                }
            }

            let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
            let lut_path = temp_adjustments["lutPath"].as_str();
            let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
            let render_plan = compile_consumer_render_plan(
                &temp_adjustments,
                &loaded_image_path,
                is_raw,
                tm_override,
                lut,
            )?;
            let mask_bitmaps = Vec::new();
            let pre_gpu_revision = calculate_transform_hash(&temp_adjustments);

            let processed_base = process_and_get_dynamic_image(
                &context,
                &state,
                &preview_base,
                crate::gpu_processing::PreGpuImageIdentity::for_stage(
                    &preview_base,
                    loaded_source_revision,
                    pre_gpu_revision,
                    pre_gpu_revision,
                ),
                RenderRequest {
                    adjustments: render_plan.adjustments,
                    mask_bitmaps: &mask_bitmaps,
                    lut: render_plan.lut.clone(),
                    roi: None,
                    edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(
                        Arc::clone(&render_plan.edit_graph),
                    ),
                },
                "preview_geometry_transform_base_gen",
            )?;

            render_caches::RenderCaches::new(&state).insert_geometry_cache_entry(
                visual_hash,
                processed_base.clone(),
                5,
            );

            processed_base
        }
    };

    let final_image = tokio::task::spawn_blocking(move || -> DynamicImage {
        let mut adjusted_params = params;

        if is_raw {
            // approximate linear vignetting correction on gamma-baked & tonemapped geometry preview
            adjusted_params.lens_vignette_amount *= 0.4;
        } else {
            adjusted_params.lens_vignette_amount *= 0.8;
        }

        let warped_image = warp_image_geometry(&base_image_to_warp, adjusted_params);
        let orientation_steps = js_adjustments[adjustment_fields::ORIENTATION_STEPS]
            .as_u64()
            .unwrap_or(0) as u8;
        let flip_horizontal = js_adjustments[adjustment_fields::FLIP_HORIZONTAL]
            .as_bool()
            .unwrap_or(false);
        let flip_vertical = js_adjustments[adjustment_fields::FLIP_VERTICAL]
            .as_bool()
            .unwrap_or(false);

        let coarse_rotated_image =
            apply_coarse_rotation(Cow::Owned(warped_image), orientation_steps);
        let flipped_image =
            apply_flip(coarse_rotated_image, flip_horizontal, flip_vertical).into_owned();

        if show_lines {
            let gray_image = flipped_image.to_luma8();
            let mut visualization = flipped_image.to_rgba8();
            let edges = canny(&gray_image, 50.0, 100.0);

            let min_dim = gray_image.width().min(gray_image.height());

            let options = LineDetectionOptions {
                vote_threshold: (min_dim as f32 * 0.24) as u32,
                suppression_radius: 15,
            };

            let lines = detect_lines(&edges, options);

            for line in lines {
                let angle_deg = line.angle_in_degrees as f32;
                let angle_norm = angle_deg % 180.0;
                let alignment_threshold = 0.5;
                let is_vertical =
                    angle_norm < alignment_threshold || angle_norm > (180.0 - alignment_threshold);
                let is_horizontal = (angle_norm - 90.0).abs() < alignment_threshold;

                let color = if is_vertical || is_horizontal {
                    Rgba([0, 255, 0, 255])
                } else {
                    Rgba([255, 0, 0, 255])
                };

                let r = line.r;
                let theta_rad = angle_deg.to_radians();
                let a = theta_rad.cos();
                let b = theta_rad.sin();
                let x0 = a * r;
                let y0 = b * r;

                let dist = (visualization.width().max(visualization.height()) * 2) as f32;

                let x1 = x0 + dist * (-b);
                let y1 = y0 + dist * (a);
                let x2 = x0 - dist * (-b);
                let y2 = y0 - dist * (a);

                draw_line_segment_mut(&mut visualization, (x1, y1), (x2, y2), color);
                draw_line_segment_mut(
                    &mut visualization,
                    (x1 + a, y1 + b),
                    (x2 + a, y2 + b),
                    color,
                );
            }

            DynamicImage::ImageRgba8(visualization)
        } else {
            flipped_image
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    encode_jpeg_data_url(&final_image, 75)
}

pub fn get_full_image_for_processing(
    state: &tauri::State<AppState>,
) -> Result<(DynamicImage, bool), String> {
    let original_image_lock = state.original_image.lock().unwrap();
    let loaded_image = original_image_lock
        .as_ref()
        .ok_or("No original image loaded")?;
    Ok((
        loaded_image.image.clone().as_ref().clone(),
        loaded_image.is_raw,
    ))
}

#[tauri::command]
fn generate_preset_preview(
    js_adjustments: serde_json::Value,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Response, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;

    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded for preset preview")?;
    let is_raw = loaded_image.is_raw;

    const PRESET_PREVIEW_DIM: u32 = 400;

    let (preview_image, scale_for_gpu, unscaled_crop_offset) =
        generate_transformed_preview(&state, &loaded_image, &js_adjustments, PRESET_PREVIEW_DIM)?;

    let (img_w, img_h) = preview_image.dimensions();

    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();

    let scaled_crop_offset = (
        unscaled_crop_offset.0 * scale_for_gpu,
        unscaled_crop_offset.1 * scale_for_gpu,
    );

    let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
        .iter()
        .filter_map(|def| {
            get_cached_or_generate_mask(
                &state,
                def,
                img_w,
                img_h,
                scale_for_gpu,
                scaled_crop_offset,
                &js_adjustments,
            )
        })
        .collect();

    let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
    let render_adjustments = normalize_film_look_adjustments_for_render(&js_adjustments);
    let lut_path = render_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
    let render_plan = compile_consumer_render_plan(
        render_adjustments.as_ref(),
        &loaded_image.path,
        is_raw,
        tm_override,
        lut,
    )?;
    let detail_stage = render_pipeline::apply_pre_gpu_detail_stages(
        &preview_image,
        calculate_transform_hash(render_adjustments.as_ref()),
        render_adjustments.as_ref(),
        is_raw,
    );
    let mut gpu_adjustments = render_plan.adjustments;
    render_pipeline::suppress_legacy_global_denoise(&mut gpu_adjustments);
    render_pipeline::suppress_legacy_global_detail(
        &mut gpu_adjustments,
        detail_stage.owns_legacy_global_detail,
    );
    let processed_image = process_and_get_dynamic_image(
        &context,
        &state,
        detail_stage.image.as_ref(),
        crate::gpu_processing::PreGpuImageIdentity::for_stage(
            detail_stage.image.as_ref(),
            loaded_image.artifact_source.source_fingerprint(),
            detail_stage.render_hash,
            detail_stage.render_hash,
        ),
        RenderRequest {
            adjustments: gpu_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut: render_plan.lut.clone(),
            roi: None,
            edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(Arc::clone(
                &render_plan.edit_graph,
            )),
        },
        "generate_preset_preview",
    )?;

    encode_jpeg_response(&processed_image, 80)
}

#[tauri::command]
async fn fetch_community_presets() -> Result<Vec<CommunityPreset>, String> {
    let client = reqwest::Client::new();

    let response = client
        .get(community_presets::COMMUNITY_PRESET_MANIFEST_URL)
        .header("User-Agent", community_presets::COMMUNITY_PRESET_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest from GitHub: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub returned an error: {}", response.status()));
    }

    let presets: Vec<CommunityPreset> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;

    Ok(presets)
}

#[tauri::command]
async fn generate_all_community_previews(
    image_paths: Vec<String>,
    presets: Vec<CommunityPreset>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<HashMap<String, Vec<u8>>, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let mut results: HashMap<String, Vec<u8>> = HashMap::new();

    const TILE_DIM: u32 = 360;
    const PROCESSING_DIM: u32 = TILE_DIM * 2;

    let settings = load_settings_or_default(&app_handle);

    let mut base_thumbnails: Vec<(DynamicImage, bool, f32, u64)> = Vec::new();
    for image_path in image_paths.iter() {
        let (source_path, _) = parse_virtual_path(image_path);
        let source_path_str = source_path.to_string_lossy().to_string();
        let image_bytes = fs::read(&source_path).map_err(|e| e.to_string())?;
        let original_image = crate::image_loader::load_base_image_from_bytes(
            &image_bytes,
            &source_path_str,
            true,
            &settings,
            None,
        )
        .map_err(|e| e.to_string())?;

        let is_raw = is_raw_file(&source_path_str);
        let (orig_w, orig_h) = original_image.dimensions();
        let (base_image, base_scale) = if orig_w > PROCESSING_DIM || orig_h > PROCESSING_DIM {
            let downscaled = downscale_f32_image(&original_image, PROCESSING_DIM, PROCESSING_DIM);
            let scale = downscaled.width() as f32 / orig_w as f32;
            (downscaled, scale)
        } else {
            (original_image, 1.0)
        };

        base_thumbnails.push((
            base_image,
            is_raw,
            base_scale,
            crate::render::artifact_identity::stable_hash(&(
                crate::gpu_processing::PreGpuImageIdentity::source_revision(image_path),
                crate::image_loader::raw_processing_profile_key(&settings),
            )),
        ));
    }

    for preset in presets.iter() {
        let mut processed_tiles: Vec<RgbImage> = Vec::new();
        let js_adjustments = &preset.adjustments;

        for (base_image, is_raw, base_scale, source_revision) in &base_thumbnails {
            let mut scaled_adjustments = js_adjustments.clone();
            if let Some(crop_val) = scaled_adjustments.get_mut(adjustment_fields::CROP)
                && let Ok(c) = serde_json::from_value::<Crop>(crop_val.clone())
            {
                *crop_val = serde_json::to_value(Crop {
                    x: c.x * (*base_scale as f64),
                    y: c.y * (*base_scale as f64),
                    width: c.width * (*base_scale as f64),
                    height: c.height * (*base_scale as f64),
                })
                .unwrap_or(serde_json::Value::Null);
            }

            let (transformed_image, _scaled_crop_offset) =
                crate::apply_all_transformations(Cow::Borrowed(base_image), &scaled_adjustments);
            let (img_w, img_h) = transformed_image.dimensions();

            let mask_definitions: Vec<MaskDefinition> = scaled_adjustments
                .get("masks")
                .and_then(|m| serde_json::from_value(m.clone()).ok())
                .unwrap_or_else(Vec::new);

            let unscaled_crop_offset = js_adjustments
                .get(adjustment_fields::CROP)
                .and_then(|c| serde_json::from_value::<Crop>(c.clone()).ok())
                .map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32));
            let actual_scaled_crop_offset = (
                unscaled_crop_offset.0 * base_scale,
                unscaled_crop_offset.1 * base_scale,
            );

            let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
                .iter()
                .filter_map(|def| {
                    generate_mask_bitmap(
                        def,
                        img_w,
                        img_h,
                        *base_scale,
                        actual_scaled_crop_offset,
                        None,
                    )
                })
                .collect();

            let tm_override = resolve_tonemapper_override_from_handle(&app_handle, *is_raw);
            let render_adjustments =
                normalize_film_look_adjustments_for_render(&scaled_adjustments);
            let lut_path = render_adjustments["lutPath"].as_str();
            let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
            let render_plan = compile_consumer_render_plan(
                render_adjustments.as_ref(),
                &preset.name,
                *is_raw,
                tm_override,
                lut,
            )?;
            let pre_gpu_revision = calculate_transform_hash(&scaled_adjustments);

            let processed_image_dynamic = crate::image_processing::process_and_get_dynamic_image(
                &context,
                &state,
                transformed_image.as_ref(),
                crate::gpu_processing::PreGpuImageIdentity::for_stage(
                    transformed_image.as_ref(),
                    *source_revision,
                    pre_gpu_revision,
                    pre_gpu_revision,
                ),
                RenderRequest {
                    adjustments: render_plan.adjustments,
                    mask_bitmaps: &mask_bitmaps,
                    lut: render_plan.lut.clone(),
                    roi: None,
                    edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(
                        Arc::clone(&render_plan.edit_graph),
                    ),
                },
                "generate_all_community_previews",
            )?;

            let processed_image = processed_image_dynamic.to_rgb8();

            let (proc_w, proc_h) = processed_image.dimensions();
            let size = proc_w.min(proc_h);
            let cropped_processed_image = image::imageops::crop_imm(
                &processed_image,
                (proc_w - size) / 2,
                (proc_h - size) / 2,
                size,
                size,
            )
            .to_image();

            let final_tile = image::imageops::resize(
                &cropped_processed_image,
                TILE_DIM,
                TILE_DIM,
                image::imageops::FilterType::Lanczos3,
            );
            processed_tiles.push(final_tile);
        }

        let final_image_buffer = match processed_tiles.len() {
            1 => processed_tiles.remove(0),
            2 => {
                let mut canvas = RgbImage::new(TILE_DIM * 2, TILE_DIM);
                image::imageops::overlay(&mut canvas, &processed_tiles[0], 0, 0);
                image::imageops::overlay(&mut canvas, &processed_tiles[1], TILE_DIM as i64, 0);
                canvas
            }
            4 => {
                let mut canvas = RgbImage::new(TILE_DIM * 2, TILE_DIM * 2);
                image::imageops::overlay(&mut canvas, &processed_tiles[0], 0, 0);
                image::imageops::overlay(&mut canvas, &processed_tiles[1], TILE_DIM as i64, 0);
                image::imageops::overlay(&mut canvas, &processed_tiles[2], 0, TILE_DIM as i64);
                image::imageops::overlay(
                    &mut canvas,
                    &processed_tiles[3],
                    TILE_DIM as i64,
                    TILE_DIM as i64,
                );
                canvas
            }
            _ => continue,
        };

        let mut buf = Cursor::new(Vec::new());
        if final_image_buffer
            .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, 75))
            .is_ok()
        {
            results.insert(preset.name.clone(), buf.into_inner());
        }
    }

    Ok(results)
}

#[tauri::command]
async fn save_temp_file(bytes: Vec<u8>) -> Result<String, String> {
    let mut temp_file = NamedTempFile::new().map_err(|e| e.to_string())?;
    temp_file.write_all(&bytes).map_err(|e| e.to_string())?;
    let (_file, path) = temp_file.keep().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

type LoadedHdrMergeItem = (String, String, DynamicImage, Duration, f32);

fn validate_hdr_merge_dimensions(loaded_items: &[LoadedHdrMergeItem]) -> Result<(), String> {
    if let Some((first_path, _, first_img, _, _)) = loaded_items.first() {
        let (width, height) = (first_img.width(), first_img.height());

        for (path, _, img, _, _) in loaded_items.iter().skip(1) {
            if img.width() != width || img.height() != height {
                return Err(format!(
                    "Dimension mismatch detected.\n\nBase image ({}): {}x{}\nTarget image ({}): {}x{}\n\nHDR merge requires all images to be exactly the same size.",
                    Path::new(first_path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    width,
                    height,
                    Path::new(path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    img.width(),
                    img.height()
                ));
            }
        }
    }

    Ok(())
}

fn load_hdr_merge_items(
    paths: &[String],
    app_handle: &tauri::AppHandle,
    emit_progress: bool,
) -> Result<Vec<LoadedHdrMergeItem>, String> {
    let settings = load_settings_or_default(app_handle);

    paths
        .iter()
        .map(|path| {
            if emit_progress {
                let _ = app_handle.emit(
                    crate::events::HDR_PROGRESS,
                    format!(
                        "Processing '{}'",
                        Path::new(path)
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    ),
                );
            }

            let file_bytes =
                fs::read(path).map_err(|e| format!("Failed to read image {}: {}", path, e))?;
            let content_hash = format!("blake3:{}", blake3::hash(&file_bytes).to_hex());
            let mut dynamic_image =
                load_base_image_from_bytes(&file_bytes, path, false, &settings, None)
                    .map_err(|e| format!("Failed to load image {}: {}", path, e))?;

            if !crate::formats::is_raw_file(path) {
                dynamic_image = apply_srgb_to_linear(dynamic_image);
            }

            let gains = match read_iso(path, &file_bytes) {
                None => return Err(format!("Image {} is missing ISO/Sensitivity data", path)),
                Some(gains) => gains as f32,
            };

            let exposure = match read_exposure_time_secs(path, &file_bytes) {
                None => return Err(format!("Image {} is missing ExposureTime data", path)),
                Some(exp) => Duration::from_secs_f32(exp),
            };

            Ok((path.clone(), content_hash, dynamic_image, exposure, gains))
        })
        .collect::<Result<Vec<_>, String>>()
}

fn build_hdr_source_refs(
    loaded_items: &[LoadedHdrMergeItem],
) -> Vec<app_state::PendingHdrSourceRef> {
    loaded_items
        .iter()
        .enumerate()
        .map(|(source_index, (path, content_hash, img, exposure, iso))| {
            app_state::PendingHdrSourceRef {
                content_hash: content_hash.clone(),
                image_path: parse_virtual_path(path).0.to_string_lossy().into_owned(),
                width: img.width(),
                height: img.height(),
                exposure_time_seconds: exposure.as_secs_f32(),
                iso: *iso,
                source_index,
            }
        })
        .collect::<Vec<_>>()
}

#[tauri::command]
async fn plan_hdr(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<HdrAlignmentPlanResponse, String> {
    if paths.len() < 2 {
        return Err("Please select at least two images to merge.".to_string());
    }

    *state.hdr_runtime_plan.lock().unwrap() = None;
    state.hdr_source_refs.lock().unwrap().clear();
    let generation = state.hdr_plan_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let generation_handle = state.hdr_plan_generation.clone();
    let response = build_alignment_plan(&paths, || {
        generation_handle.load(Ordering::SeqCst) != generation
    })?;
    if state.hdr_plan_generation.load(Ordering::SeqCst) != generation {
        return Err("hdr_plan_cancelled:artifact_publication".to_string());
    }
    *state.hdr_runtime_plan.lock().unwrap() = Some(app_state::PendingHdrMergePlan {
        accepted_dry_run_plan_hash: response.accepted_dry_run_plan_hash.clone(),
        accepted_dry_run_plan_id: response.accepted_dry_run_plan_id.clone(),
        alignment_policy_id: ALIGNMENT_POLICY_ID.to_string(),
        source_content_hashes: response
            .sources
            .iter()
            .map(|source| source.frame.content_hash.clone())
            .collect(),
        source_paths: paths,
        static_radiance_hash: Some(response.static_radiance_preview.radiance_hash.clone()),
        deghost_radiance_hash: Some(response.deghost_preview.radiance_hash.clone()),
        motion_probability_hash: Some(response.deghost_preview.motion_probability_hash.clone()),
        ownership_hash: Some(response.deghost_preview.ownership_hash.clone()),
        feather_hash: Some(response.deghost_preview.feather_hash.clone()),
        unresolved_fraction: Some(response.deghost_preview.unresolved_fraction),
        output_width: response.sources[response.reference_source_index]
            .frame
            .width as u64,
        output_height: response.sources[response.reference_source_index]
            .frame
            .height as u64,
        planned_sources: response.sources.clone(),
        motion_probability_bytes: Vec::new(),
        ownership_bytes: Vec::new(),
        feather_bytes: Vec::new(),
        scene_linear_artifact_hash: None,
        tone_mapped_preview_hash: None,
        motion_coverage: None,
        confidence_mean: None,
    });
    Ok(response)
}

#[tauri::command]
async fn cancel_hdr_plan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.hdr_plan_generation.fetch_add(1, Ordering::SeqCst);
    let _ = state
        .computational_merge_jobs
        .cancel_active_family(crate::merge::computational_job::ComputationalMergeFamily::Hdr);
    *state.hdr_runtime_plan.lock().unwrap() = None;
    state.hdr_source_refs.lock().unwrap().clear();
    Ok(())
}

#[tauri::command]
async fn plan_focus_stack(
    paths: Vec<String>,
    ordered_source_ids: Vec<String>,
    graph_revisions: Vec<String>,
    settings: FocusStackReadinessSettings,
    state: tauri::State<'_, AppState>,
) -> Result<FocusStackInputPlan, String> {
    *state.focus_stack_runtime_plan.lock().unwrap() = None;
    *state.focus_stack_accepted_runtime.lock().unwrap() = None;
    let generation = state
        .focus_stack_plan_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let tracker = state.focus_stack_plan_generation.clone();
    let resolved_paths = paths
        .iter()
        .map(|path| parse_virtual_path(path).0.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let plan = build_input_plan(
        &resolved_paths,
        &ordered_source_ids,
        &graph_revisions,
        settings,
        || tracker.load(Ordering::SeqCst) != generation,
    )?;
    let mut published_plan = state.focus_stack_runtime_plan.lock().unwrap();
    if tracker.load(Ordering::SeqCst) != generation {
        return Err("focus_stack_plan_cancelled:plan_publication".to_string());
    }
    if plan.accepted {
        *published_plan = Some((
            plan.accepted_dry_run_plan_id.clone(),
            plan.accepted_dry_run_plan_hash.clone(),
        ));
        *state.focus_stack_accepted_runtime.lock().unwrap() =
            Some(crate::merge::focus_stack::job::AcceptedFocusRuntime {
                identity: plan.candidate_identity(),
                paths: resolved_paths,
            });
    }
    Ok(plan)
}

#[tauri::command]
async fn cancel_focus_stack_plan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .focus_stack_plan_generation
        .fetch_add(1, Ordering::SeqCst);
    *state.focus_stack_runtime_plan.lock().unwrap() = None;
    *state.focus_stack_accepted_runtime.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn merge_hdr(
    paths: Vec<String>,
    accepted_dry_run_plan_hash: Option<String>,
    accepted_dry_run_plan_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if paths.len() < 2 {
        return Err("Please select at least two images to merge.".to_string());
    }
    let mut accepted_plan = state
        .hdr_runtime_plan
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "hdr_apply_requires_accepted_native_plan".to_string())?;
    if accepted_plan.alignment_policy_id != ALIGNMENT_POLICY_ID
        || accepted_dry_run_plan_hash.as_ref() != Some(&accepted_plan.accepted_dry_run_plan_hash)
        || accepted_dry_run_plan_id.as_ref() != Some(&accepted_plan.accepted_dry_run_plan_id)
        || paths != accepted_plan.source_paths
    {
        return Err("hdr_apply_stale_accepted_artifacts".to_string());
    }
    if accepted_plan
        .unresolved_fraction
        .is_some_and(|value| value > 0.0)
    {
        return Err("hdr_apply_blocked_unresolved_deghost_ownership".to_string());
    }
    let job = state.computational_merge_jobs.begin(
        crate::merge::computational_job::ComputationalMergeFamily::Hdr,
        "decode",
        3,
        3,
    )?;
    job.cancellation_token.checkpoint()?;
    let _ = app_handle.emit(
        crate::events::HDR_PROGRESS,
        "Decoding calibrated RAW sources...",
    );

    let hdr_result_handle = state.hdr_result.clone();
    let hdr_runtime_plan_handle = state.hdr_runtime_plan.clone();
    let hdr_source_refs_handle = state.hdr_source_refs.clone();
    let loaded_items = load_hdr_merge_items(&paths, &app_handle, true)?;
    job.cancellation_token.checkpoint()?;
    state.computational_merge_jobs.publish_progress(
        &job.job_id,
        "merge",
        1,
        3,
        1,
        Some(&app_handle),
    )?;
    let _ = app_handle.emit(
        crate::events::HDR_PROGRESS,
        "Reconstructing full-resolution radiance...",
    );

    validate_hdr_merge_dimensions(&loaded_items)?;

    let source_refs = build_hdr_source_refs(&loaded_items);

    let developed_images = loaded_items
        .iter()
        .map(|(_, _, image, _, _)| image.clone())
        .collect::<Vec<_>>();
    log::info!(
        "Starting calibrated native HDR merge of {} images",
        developed_images.len()
    );
    let native = crate::merge::hdr::runtime::reconstruct(
        &developed_images,
        &accepted_plan.planned_sources,
        || job.cancellation_token.checkpoint().is_err(),
    )?;
    let hdr_merged = native.scene_linear;
    job.cancellation_token.checkpoint()?;
    state.computational_merge_jobs.publish_progress(
        &job.job_id,
        "preview",
        2,
        3,
        2,
        Some(&app_handle),
    )?;
    let _ = app_handle.emit(
        crate::events::HDR_PROGRESS,
        "Preparing atomic HDR package...",
    );
    log::info!("HDR merge completed");

    let final_base64 = encode_png_data_url(&native.preview)?;
    let output_content_hash = native.scene_linear_hash.clone();
    let current_hashes = source_refs
        .iter()
        .map(|source| source.content_hash.clone())
        .collect::<Vec<_>>();
    if current_hashes != accepted_plan.source_content_hashes {
        return Err("hdr_apply_stale_source_content".to_string());
    }
    accepted_plan.motion_probability_hash = Some(format!(
        "blake3:{}",
        blake3::hash(&native.motion_probability).to_hex()
    ));
    accepted_plan.ownership_hash = Some(format!(
        "blake3:{}",
        blake3::hash(&native.ownership).to_hex()
    ));
    accepted_plan.feather_hash = Some(format!("blake3:{}", blake3::hash(&native.feather).to_hex()));
    accepted_plan.motion_probability_bytes = native.motion_probability;
    accepted_plan.ownership_bytes = native.ownership;
    accepted_plan.feather_bytes = native.feather;
    accepted_plan.scene_linear_artifact_hash = Some(native.scene_linear_hash);
    accepted_plan.tone_mapped_preview_hash = Some(native.preview_hash);
    accepted_plan.motion_coverage = Some(native.motion_coverage);
    accepted_plan.confidence_mean = Some(native.confidence_mean);
    let runtime_plan = accepted_plan;
    let receipt = HdrApplyReceipt {
        accepted_dry_run_plan_hash: runtime_plan.accepted_dry_run_plan_hash.clone(),
        accepted_dry_run_plan_id: runtime_plan.accepted_dry_run_plan_id.clone(),
        merge_method: "exposure_weighted_radiance".to_string(),
        merge_version: "0.1.0".to_string(),
        output_content_hash,
        output_handle: "memory:hdr_result".to_string(),
        preview_dimensions: ImageDimensions {
            height: hdr_merged.height(),
            width: hdr_merged.width(),
        },
        source_roles: build_hdr_apply_source_roles(&source_refs),
        source_paths: source_refs
            .iter()
            .map(|source| source.image_path.clone())
            .collect(),
        warning_codes: Vec::new(),
    };

    let _ = app_handle.emit(crate::events::HDR_PROGRESS, "Creating preview...");

    *hdr_result_handle.lock().unwrap() = Some(hdr_merged);
    *hdr_runtime_plan_handle.lock().unwrap() = Some(runtime_plan);
    *hdr_source_refs_handle.lock().unwrap() = source_refs;
    state.computational_merge_jobs.publish_progress(
        &job.job_id,
        "ready_to_publish",
        3,
        3,
        3,
        Some(&app_handle),
    )?;
    state.computational_merge_jobs.finish(&job.job_id)?;

    let _ = app_handle.emit(
        crate::events::HDR_COMPLETE,
        serde_json::json!({
            "base64": final_base64,
            "receipt": receipt,
        }),
    );
    Ok(())
}

fn build_hdr_apply_source_roles(
    source_refs: &[app_state::PendingHdrSourceRef],
) -> Vec<HdrApplySourceRole> {
    let reference_index = source_refs.len() / 2;
    source_refs
        .iter()
        .map(|source| HdrApplySourceRole {
            exposure_ev: source.exposure_time_seconds.log2(),
            role: if source.source_index == reference_index {
                "reference".to_string()
            } else if source.source_index < reference_index {
                "under_exposed".to_string()
            } else {
                "over_exposed".to_string()
            },
            source_index: source.source_index,
        })
        .collect::<Vec<_>>()
}

#[tauri::command]
async fn save_hdr(
    first_path_str: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let hdr_image = state.hdr_result.lock().unwrap().take().ok_or_else(|| {
        "No hdr image found in memory to save. It might have already been saved.".to_string()
    })?;

    let (first_path, _) = parse_virtual_path(&first_path_str);
    let parent_dir = first_path
        .parent()
        .ok_or_else(|| "Could not determine parent directory of the first image.".to_string())?;
    let stem = first_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("hdr");

    let source_refs = state.hdr_source_refs.lock().unwrap().clone();
    let mut runtime_plan = state
        .hdr_runtime_plan
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "HDR merge plan missing; rerun HDR merge before saving.".to_string())?;
    if source_refs.len() < 2 || runtime_plan.alignment_policy_id != ALIGNMENT_POLICY_ID {
        return Err("hdr_apply_missing_calibrated_lineage".to_string());
    }
    let tile_plan = crate::merge::hdr::full_resolution::build_tile_plan(
        u64::from(hdr_image.width()),
        u64::from(hdr_image.height()),
        source_refs.len() as u64,
    )?;
    let payload_name = format!("{stem}_Hdr.tiff");
    let mut payload = std::io::Cursor::new(Vec::new());
    hdr_image
        .write_to(&mut payload, image::ImageFormat::Tiff)
        .map_err(|error| format!("hdr_payload_encode_failed:{error}"))?;
    let mut preview = std::io::Cursor::new(Vec::new());
    crate::merge::hdr::runtime::tone_map(&hdr_image, 1.0)?
        .write_to(&mut preview, image::ImageFormat::Png)
        .map_err(|error| format!("hdr_preview_encode_failed:{error}"))?;
    let scene_linear_f16 = hdr_image
        .to_rgb32f()
        .pixels()
        .flat_map(|pixel| {
            pixel
                .0
                .into_iter()
                .flat_map(|value| half::f16::from_f32(value).to_bits().to_le_bytes())
        })
        .collect::<Vec<_>>();
    runtime_plan.scene_linear_artifact_hash = Some(format!(
        "blake3:{}",
        blake3::hash(&scene_linear_f16).to_hex()
    ));
    let map_lineage = serde_json::to_vec(&serde_json::json!({
        "deghostRadianceHash": runtime_plan.deghost_radiance_hash,
        "featherHash": runtime_plan.feather_hash,
        "motionProbabilityHash": runtime_plan.motion_probability_hash,
        "ownershipHash": runtime_plan.ownership_hash,
        "staticRadianceHash": runtime_plan.static_radiance_hash,
        "unresolvedFraction": runtime_plan.unresolved_fraction,
    }))
    .map_err(|error| format!("hdr_map_lineage_encode_failed:{error}"))?;
    let manifest = DerivedOutputManifest {
        schema_version: 1,
        family: "hdr".to_string(),
        width: u64::from(hdr_image.width()),
        height: u64::from(hdr_image.height()),
        payload_path: payload_name.clone(),
        preview_paths: vec!["preview.png".to_string()],
        map_paths: vec![
            "maps/accepted-artifacts.json".to_string(),
            "maps/motion-probability.bin".to_string(),
            "maps/source-selection.bin".to_string(),
            "maps/confidence-feather.bin".to_string(),
            "scene-linear.rgb16f".to_string(),
        ],
        source_immutability_hashes: runtime_plan.source_content_hashes.clone(),
    };
    let mut transaction =
        AtomicDerivedOutputTransaction::begin(parent_dir, &format!("{stem}_Hdr.rrhdr"))?;
    transaction.write_file(&payload_name, payload.get_ref())?;
    transaction.write_file("preview.png", preview.get_ref())?;
    transaction.write_file("maps/accepted-artifacts.json", &map_lineage)?;
    transaction.write_file(
        "maps/motion-probability.bin",
        &runtime_plan.motion_probability_bytes,
    )?;
    transaction.write_file("maps/source-selection.bin", &runtime_plan.ownership_bytes)?;
    transaction.write_file("maps/confidence-feather.bin", &runtime_plan.feather_bytes)?;
    transaction.write_file("scene-linear.rgb16f", &scene_linear_f16)?;
    transaction.write_file(
        "lineage.json",
        &serde_json::to_vec(&serde_json::json!({
            "acceptedDryRunPlanHash": runtime_plan.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": runtime_plan.accepted_dry_run_plan_id,
            "alignmentPolicyId": runtime_plan.alignment_policy_id,
            "applyAlgorithmId": crate::merge::hdr::full_resolution::FULL_RESOLUTION_APPLY_ALGORITHM_ID,
            "graphRevision": "hdr_scene_linear_base_v1",
            "ownershipPolicy": "deterministic_source_index_then_exposure_distance_v1",
            "sourcePaths": runtime_plan.source_paths,
            "tileCount": tile_plan.tile_count,
            "tilePlanHash": tile_plan.plan_hash,
            "observedPeakMemoryBytes": tile_plan.memory.estimated_peak_bytes,
            "workingDomain": "acescg_ap1_scene_linear_v1",
            "internalArtifact": {
                "encoding": "rgb_half_float_little_endian",
                "hash": format!("blake3:{}", blake3::hash(&scene_linear_f16).to_hex()),
                "path": "scene-linear.rgb16f"
            },
        }))
        .map_err(|error| format!("hdr_lineage_encode_failed:{error}"))?,
    )?;
    transaction.stage_manifest(&manifest)?;
    let receipt = transaction.commit(&manifest, |package| {
        if package.join(&payload_name).is_file() {
            Ok(())
        } else {
            Err("hdr_registration_payload_missing".to_string())
        }
    })?;
    let output_path = PathBuf::from(&receipt.final_package_path).join(&payload_name);
    write_hdr_output_sidecar(
        &output_path,
        &source_refs,
        &runtime_plan,
        hdr_image.width(),
        hdr_image.height(),
    )?;
    state.hdr_source_refs.lock().unwrap().clear();
    *state.hdr_runtime_plan.lock().unwrap() = None;

    let (real_path, _) = crate::file_management::parse_virtual_path(&first_path_str);
    let _ =
        crate::exif_processing::write_rrexif_sidecar(&real_path.to_string_lossy(), &output_path);

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn save_collage(base64_data: String, first_path_str: String) -> Result<String, String> {
    if !base64_data.starts_with(PNG_DATA_URL_PREFIX) {
        return Err("Invalid base64 data format".to_string());
    }
    let encoded_data = &base64_data[PNG_DATA_URL_PREFIX.len()..];

    let decoded_bytes = general_purpose::STANDARD
        .decode(encoded_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    let (first_path, _) = parse_virtual_path(&first_path_str);
    let parent_dir = first_path
        .parent()
        .ok_or_else(|| "Could not determine parent directory of the first image.".to_string())?;
    let stem = first_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("collage");

    let output_filename = format!("{}_Collage.png", stem);
    let output_path = parent_dir.join(output_filename);

    fs::write(&output_path, &decoded_bytes)
        .map_err(|e| format!("Failed to save collage image: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
fn generate_preview_for_path(
    path: String,
    js_adjustments: Value,
    target_resolution: Option<u32>,
    jpeg_quality: Option<u8>,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Response, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let is_raw = is_raw_file(&source_path_str);
    let settings = load_settings_or_default(&app_handle);

    let base_image = match read_file_mapped(&source_path) {
        Ok(mmap) => load_and_composite(
            &mmap,
            &source_path_str,
            &js_adjustments,
            false,
            &settings,
            None,
        )
        .map_err(|e| e.to_string())?,
        Err(e) => {
            log::warn!(
                "Failed to memory-map file '{}': {}. Falling back to standard read.",
                source_path_str,
                e
            );
            let bytes = fs::read(&source_path).map_err(|io_err| io_err.to_string())?;
            load_and_composite(
                &bytes,
                &source_path_str,
                &js_adjustments,
                false,
                &settings,
                None,
            )
            .map_err(|e| e.to_string())?
        }
    };

    let (transformed_image, unscaled_crop_offset) =
        apply_all_transformations(Cow::Borrowed(&base_image), &js_adjustments);
    let (img_w, img_h) = transformed_image.dimensions();
    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();

    let warped_image = resolve_warped_image_for_masks(&state, &js_adjustments, &mask_definitions);
    let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
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

    let tm_override = resolve_tonemapper_override(&settings, is_raw);
    let render_adjustments = normalize_film_look_adjustments_for_render(&js_adjustments);
    let lut_path = render_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
    let render_plan = compile_consumer_render_plan(
        render_adjustments.as_ref(),
        &source_path_str,
        is_raw,
        tm_override,
        lut,
    )?;
    let pre_gpu_stage_hash = calculate_transform_hash(render_adjustments.as_ref());
    let source_revision = crate::render::artifact_identity::stable_hash(&(
        crate::gpu_processing::PreGpuImageIdentity::source_revision(&source_path_str),
        crate::image_loader::raw_processing_profile_key(&settings),
    ));
    let detail_stage = render_pipeline::apply_pre_gpu_detail_stages(
        transformed_image.as_ref(),
        pre_gpu_stage_hash,
        render_adjustments.as_ref(),
        is_raw,
    );
    let mut gpu_adjustments = render_plan.adjustments;
    render_pipeline::suppress_legacy_global_denoise(&mut gpu_adjustments);
    render_pipeline::suppress_legacy_global_detail(
        &mut gpu_adjustments,
        detail_stage.owns_legacy_global_detail,
    );
    let final_image = process_and_get_dynamic_image(
        &context,
        &state,
        detail_stage.image.as_ref(),
        crate::gpu_processing::PreGpuImageIdentity::for_stage(
            detail_stage.image.as_ref(),
            source_revision,
            detail_stage.render_hash,
            detail_stage.render_hash,
        ),
        RenderRequest {
            adjustments: gpu_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut: render_plan.lut.clone(),
            roi: None,
            edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(Arc::clone(
                &render_plan.edit_graph,
            )),
        },
        "generate_preview_for_path",
    )?;
    let preview_image = match target_resolution {
        Some(max_edge) => final_image.resize(
            max_edge.clamp(256, 4096),
            max_edge.clamp(256, 4096),
            image::imageops::FilterType::Lanczos3,
        ),
        None => final_image,
    };
    encode_jpeg_response(&preview_image, jpeg_quality.unwrap_or(92).clamp(50, 95))
}

#[tauri::command]
async fn load_and_parse_lut(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<LutParseResult, String> {
    let lut = get_or_load_lut(&state, &path)?;
    let lut_size = lut.size;

    Ok(LutParseResult { size: lut_size })
}

fn setup_logging(app_handle: &tauri::AppHandle) {
    let log_dir = match app_handle.path().app_log_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("Failed to get app log directory: {}", e);
            return;
        }
    };

    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!("Failed to create log directory at {:?}: {}", log_dir, e);
    }

    let log_file_path = log_dir.join("app.log");

    let log_file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&log_file_path)
        .ok();

    let var = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    let level: log::LevelFilter = var.parse().unwrap_or(log::LevelFilter::Info);

    let mut dispatch = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "{} [{}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                record.level(),
                message
            ))
        })
        .level(level)
        .chain(std::io::stderr());

    if let Some(file) = log_file {
        dispatch = dispatch.chain(file);
    } else {
        eprintln!(
            "Failed to open log file at {:?}. Logging to console only.",
            log_file_path
        );
    }

    if let Err(e) = dispatch.apply() {
        eprintln!("Failed to apply logger configuration: {}", e);
    }

    panic::set_hook(Box::new(|info| {
        let message = if let Some(s) = info.payload().downcast_ref::<&'static str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            format!("{:?}", info.payload())
        };
        let location = info.location().map_or_else(
            || "at an unknown location".to_string(),
            |loc| format!("at {}:{}:{}", loc.file(), loc.line(), loc.column()),
        );
        log::error!("PANIC! {} - {}", location, message.trim());
    }));

    log::info!(
        "Logger initialized successfully. Log file at: {:?}",
        log_file_path
    );
}

#[tauri::command]
fn get_log_file_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app_handle.path().app_log_dir().map_err(|e| e.to_string())?;
    let log_file_path = log_dir.join("app.log");
    Ok(log_file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn frontend_log(level: String, message: String) -> Result<(), String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let log_line = |line: &str| match level.to_lowercase().as_str() {
        "error" => log::error!("[frontend] {}", line),
        "warn" => log::warn!("[frontend] {}", line),
        "info" if line.starts_with("[app-event]") => log::warn!("[frontend] {}", line),
        "debug" => log::debug!("[frontend] {}", line),
        "trace" => log::trace!("[frontend] {}", line),
        _ => log::info!("[frontend] {}", line),
    };

    for line in trimmed
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        log_line(line);
    }

    Ok(())
}

fn handle_file_open(app_handle: &tauri::AppHandle, path: PathBuf) {
    if let Some(path_str) = path.to_str()
        && let Err(e) = app_handle.emit(crate::events::OPEN_WITH_FILE, path_str)
    {
        log::error!("Failed to emit open-with-file event: {}", e);
    }
}

#[cfg(not(target_os = "android"))]
fn restore_window_state(window: &tauri::WebviewWindow, state: &WindowState) {
    const MIN_WINDOW_WIDTH: u32 = 800;
    const MIN_WINDOW_HEIGHT: u32 = 600;
    const DEFAULT_WINDOW_WIDTH: u32 = 1280;
    const DEFAULT_WINDOW_HEIGHT: u32 = 720;
    let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        })
    else {
        let _ = window.center();
        return;
    };

    let work_area = monitor.work_area();
    let work_area_size = work_area.size;
    let work_area_position = work_area.position;
    let max_width = work_area_size.width.max(1);
    let max_height = work_area_size.height.max(1);

    let requested_width = if state.width >= MIN_WINDOW_WIDTH {
        state.width
    } else {
        DEFAULT_WINDOW_WIDTH
    };
    let requested_height = if state.height >= MIN_WINDOW_HEIGHT {
        state.height
    } else {
        DEFAULT_WINDOW_HEIGHT
    };

    let width = requested_width
        .min(max_width)
        .max(MIN_WINDOW_WIDTH.min(max_width));
    let height = requested_height
        .min(max_height)
        .max(MIN_WINDOW_HEIGHT.min(max_height));
    let max_x = work_area_position.x + work_area_size.width as i32 - width as i32;
    let max_y = work_area_position.y + work_area_size.height as i32 - height as i32;
    let x = state
        .x
        .clamp(work_area_position.x, max_x.max(work_area_position.x));
    let y = state
        .y
        .clamp(work_area_position.y, max_y.max(work_area_position.y));

    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
        width, height,
    )));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        x, y,
    )));
}

#[cfg(all(feature = "validation-harness", unix))]
#[tauri::command]
fn frontend_ready(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<AppState>,
    qa_control_state: tauri::State<qa_control::QaControlState>,
) -> Result<(), String> {
    qa_control_state.mark_ready();
    frontend_ready_impl(app_handle, window, state)
}

#[cfg(not(all(feature = "validation-harness", unix)))]
#[tauri::command]
fn frontend_ready(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    frontend_ready_impl(app_handle, window, state)
}

fn frontend_ready_impl(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let is_first_run = !state
        .window_setup_complete
        .swap(true, std::sync::atomic::Ordering::Relaxed);
    #[cfg(target_os = "android")]
    let _ = (is_first_run, &window);

    #[cfg(not(target_os = "android"))]
    {
        #[cfg(not(any(windows, target_os = "linux")))]
        let _ = is_first_run;

        #[cfg(any(windows, target_os = "linux"))]
        let mut should_maximize = false;
        #[cfg(any(windows, target_os = "linux"))]
        let mut should_fullscreen = false;

        #[cfg(any(windows, target_os = "linux"))]
        if is_first_run && let Ok(config_dir) = app_handle.path().app_config_dir() {
            let path = config_dir.join("window_state.json");

            if let Ok(contents) = std::fs::read_to_string(&path)
                && let Ok(saved_state) = serde_json::from_str::<WindowState>(&contents)
            {
                should_maximize = saved_state.maximized;
                should_fullscreen = saved_state.fullscreen;

                if (should_maximize || should_fullscreen)
                    && let Some(monitor) = window
                        .current_monitor()
                        .ok()
                        .flatten()
                        .or_else(|| window.primary_monitor().ok().flatten())
                        .or_else(|| {
                            window
                                .available_monitors()
                                .ok()
                                .and_then(|m| m.into_iter().next())
                        })
                {
                    let monitor_size = monitor.size();
                    let monitor_pos = monitor.position();
                    let default_width = 1280i32;
                    let default_height = 720i32;
                    let center_x = monitor_pos.x + (monitor_size.width as i32 - default_width) / 2;
                    let center_y =
                        monitor_pos.y + (monitor_size.height as i32 - default_height) / 2;

                    let _ = window.set_size(tauri::PhysicalSize::new(
                        default_width as u32,
                        default_height as u32,
                    ));
                    let _ = window.set_position(tauri::PhysicalPosition::new(center_x, center_y));
                }
            }
        }

        if frontend_ready_manages_native_window(std::env::consts::OS) {
            if let Err(e) = window.show() {
                log::error!("Failed to show window: {}", e);
            }
            if let Err(e) = window.set_focus() {
                log::error!("Failed to focus window: {}", e);
            }
        }
        #[cfg(any(windows, target_os = "linux"))]
        if is_first_run {
            if should_maximize {
                let _ = window.maximize();
            }
            if should_fullscreen {
                let _ = window.set_fullscreen(true);
            }
        }
    }

    if let Some(path) = state.initial_file_path.lock().unwrap().take() {
        log::info!(
            "Frontend is ready, emitting open-with-file for initial path: {}",
            &path
        );
        handle_file_open(&app_handle, PathBuf::from(path));
    }
    Ok(())
}

#[tauri::command]
fn get_startup_trace(
    state: tauri::State<'_, AppState>,
) -> crate::app::startup::StartupTraceSnapshot {
    state.startup_trace.snapshot()
}

#[tauri::command]
fn record_frontend_startup_phase(
    trace_id: String,
    phase: FrontendStartupPhase,
    status: String,
    detail: Option<String>,
    state: tauri::State<'_, AppState>,
    _app: tauri::AppHandle,
) -> Result<crate::app::startup::StartupTraceSnapshot, String> {
    record_frontend_phase_with_followup(
        &state.startup_trace,
        &trace_id,
        phase,
        &status,
        detail,
        |_snapshot| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if state.startup_trace.arm_idle_warm_after(phase) {
                let idle_services = _app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(1_500)).await;
                    request_lens_initialization(
                        idle_services.clone(),
                        InitializationPriority::IdleWarm,
                    );
                    request_gpu_initialization(idle_services, InitializationPriority::IdleWarm);
                });
            }
            #[cfg(feature = "validation-harness")]
            if phase == FrontendStartupPhase::Interactive
                && std::env::var("RAWENGINE_STARTUP_BENCHMARK_EDITOR_DEMAND").as_deref() == Ok("1")
            {
                image_open_session::promote_editor_initialization(&_app);
                request_lens_initialization(_app.clone(), InitializationPriority::IdleWarm);
                request_gpu_initialization(_app, InitializationPriority::IdleWarm);
            }
        },
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg_attr(feature = "validation-harness", allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    #[cfg(all(feature = "validation-harness", unix))]
    {
        builder = builder.manage(qa_control::QaControlState::from_environment());
    }

    #[cfg(all(
        not(any(target_os = "android", target_os = "ios")),
        not(feature = "validation-harness")
    ))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            log::info!(
                "New instance launched with args: {:?}. Focusing main window.",
                argv
            );
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.unminimize() {
                    log::error!("Failed to unminimize window: {}", e);
                }
                if let Err(e) = window.set_focus() {
                    log::error!("Failed to set focus on window: {}", e);
                }
            }

            if argv.len() > 1 {
                let path_str = &argv[1];
                if let Err(e) = app.emit(crate::events::OPEN_WITH_FILE, path_str) {
                    log::error!(
                        "Failed to emit open-with-file from single-instance handler: {}",
                        e
                    );
                }
            }
        }));
    }

    builder
        .register_uri_scheme_protocol(thumbnail_resources::THUMBNAIL_PROTOCOL, |context, request| {
            thumbnail_resources::protocol_response(context.app_handle(), request.uri())
        })
        .register_uri_scheme_protocol(analytics_resources::ANALYTICS_PROTOCOL, |_context, request| {
            analytics_resources::protocol_response(request.uri())
        })
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(PinchZoomDisablePlugin)
        .on_window_event(|window, event| if let tauri::WindowEvent::Resized(size) = event {
            let state = window.state::<AppState>();
            if let Some(ctx) = state.gpu_context.lock().unwrap().as_ref() {
                ctx.presentation.resize(size.width, size.height);
            }
            #[cfg(target_os = "macos")]
            crate::app::display_target::request_for_state(&state);
        } else if let tauri::WindowEvent::Moved(_) = event {
            #[cfg(target_os = "macos")]
            {
                let state = window.state::<AppState>();
                crate::app::display_target::request_for_state(&state);
            }
        } else if let tauri::WindowEvent::Focused(true) = event {
            #[cfg(target_os = "macos")]
            {
                let state = window.state::<AppState>();
                crate::app::display_target::request_for_state(&state);
            }
        })
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                if let Some(arg) = std::env::args().nth(1) {
                     let state = app.state::<AppState>();
                     log::info!("Windows/Linux initial open: Storing path {} for later.", &arg);
                     *state.initial_file_path.lock().unwrap() = Some(arg);
                }
            }

            let app_handle = app.handle().clone();
            if let Err(error) = color::camera_profile::registry::managed_profile_root(&app_handle) {
                log::warn!("camera_profile_registry_root_unavailable: {error}");
            }
            app.state::<AppState>()
                .startup_trace
                .mark(NativeStartupPhase::ProcessStarted, "ok", None);
            let config_dir = app_handle.path().app_config_dir().expect("Failed to get config dir");
            let crash_flag_path = config_dir.join(".gpu_init_crash_flag");

            {
                let state = app.state::<AppState>();
                *state.gpu_crash_flag_path.lock().unwrap() = Some(crash_flag_path.clone());
            }

            let mut settings: AppSettings = load_settings_or_default(&app_handle);
            app.state::<AppState>().startup_trace.mark(
                NativeStartupPhase::MinimalSettingsLoaded,
                "ok",
                None,
            );

            {
                let state = app.state::<AppState>();
                let cache_size = settings.image_cache_size.unwrap_or(5) as usize;
                render_caches::RenderCaches::new(&state).set_decoded_image_cache_capacity(cache_size);
            }

            if crash_flag_path.exists() {
                log::warn!("GPU Driver crash detected on last run! Falling back to OpenGL backend.");
                settings.processing_backend = Some("gl".to_string());
                let _ = crate::save_settings(settings.clone(), app_handle.clone());
                let _ = std::fs::remove_file(&crash_flag_path);
            }

            unsafe {
                if let Some(backend) = &settings.processing_backend
                    && backend != "auto" {
                        std::env::set_var("WGPU_BACKEND", backend);
                    }

                if settings.linux_gpu_optimization.unwrap_or(true) {
                    #[cfg(target_os = "linux")]
                    {
                        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
                        std::env::set_var("NODEVICE_SELECT", "1");
                    }
                }

                #[cfg(not(target_os = "android"))]
                {
                    let resource_path = app_handle
                        .path()
                        .resolve("resources", tauri::path::BaseDirectory::Resource)
                        .expect("failed to resolve resource directory");

                    let ort_library_name = {
                        #[cfg(target_os = "windows")]
                        { "onnxruntime.dll" }
                        #[cfg(target_os = "linux")]
                        { "libonnxruntime.so" }
                        #[cfg(target_os = "macos")]
                        { "libonnxruntime.dylib" }
                        #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
                        { "libonnxruntime.so" }
                    };
                    let ort_library_path = resource_path.join(ort_library_name);
                    std::env::set_var("ORT_DYLIB_PATH", &ort_library_path);
                    println!("Set ORT_DYLIB_PATH to: {}", ort_library_path.display());
                }
            }

            setup_logging(&app_handle);

            if let Some(backend) = &settings.processing_backend
                && backend != "auto" {
                    log::info!("Applied processing backend setting: {}", backend);
                }
            if settings.linux_gpu_optimization.unwrap_or(false) {
                #[cfg(target_os = "linux")]
                {
                    log::info!("Applied Linux GPU optimizations.");
                }
            }

            #[cfg(feature = "advanced-codecs")]
            rapidraw_codecs::register_jxl_decoding_hook();

            let window_cfg = app.config().app.windows.first().unwrap().clone();
            let decorations = settings.decorations.unwrap_or(window_cfg.decorations);
            #[cfg(target_os = "android")]
            let _ = decorations;

            let main_window_cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .expect("Main window config not found")
                .clone();

            let mut window_builder =
                tauri::WebviewWindowBuilder::from_config(app.handle(), &main_window_cfg)
                    .unwrap();

            #[cfg(not(target_os = "android"))]
            {
                window_builder = window_builder.decorations(decorations).visible(false);
            }

            let window = window_builder.build().expect("Failed to build window");
            app.state::<AppState>().startup_trace.mark(
                NativeStartupPhase::WindowCreated,
                "ok",
                None,
            );

            #[cfg(target_os = "macos")]
            {
                let resolver_app = app.handle().clone();
                let publisher_app = app.handle().clone();
                let coordinator =
                    crate::app::display_target::DisplayTargetCoordinator::new_with_publisher(
                        Duration::from_millis(120),
                        move |_| crate::app::display_target::resolve_for_app(&resolver_app),
                        move |change| {
                            if let Err(error) = publisher_app.emit("display-target-changed", change) {
                                log::warn!("failed to publish display target change: {error}");
                            }
                        },
                    );
                coordinator.request_refresh(0);
                *app.state::<AppState>()
                    .display_target_coordinator
                    .lock()
                    .unwrap() = Some(coordinator);
                #[cfg(feature = "validation-harness")]
                crate::app::display_target::start_validation_benchmark(app.handle().clone());
            }

            #[cfg(target_os = "android")]
            android_integration::initialize_android(&window);

            #[cfg(not(target_os = "android"))]
            {
                if let Ok(config_dir) = app.path().app_config_dir() {
                    let path = config_dir.join("window_state.json");
                    if let Ok(contents) = std::fs::read_to_string(&path) {
                        if let Ok(state) = serde_json::from_str::<WindowState>(&contents) {
                            restore_window_state(&window, &state);
                        } else {
                            let _ = window.center();
                        }
                    } else {
                        let _ = window.center();
                    }
                } else {
                    let _ = window.center();
                }

                if let Err(error) = window.show() {
                    log::error!("Failed to show startup shell: {}", error);
                }
                if let Err(error) = window.set_focus() {
                    log::error!("Failed to focus startup shell: {}", error);
                }
                app.state::<AppState>().startup_trace.mark(
                    NativeStartupPhase::WindowVisible,
                    "ok",
                    Some("webview-bootstrap-chrome".to_string()),
                );

                preview_worker::start_preview_worker(app.handle().clone());
                start_analytics_worker(app.handle().clone());
                file_management::start_thumbnail_workers(app.handle().clone());
                app.state::<AppState>().startup_trace.mark(
                    NativeStartupPhase::CoreCommandsReady,
                    "ok",
                    Some("background-services-scheduled".to_string()),
                );

                let window_failsafe = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                    if let Ok(false) = window_failsafe.is_visible() {
                        log::warn!(
                            "Frontend failed to report ready within timeout. Forcing window visibility."
                        );
                        let _ = window_failsafe.show();
                        let _ = window_failsafe.set_focus();
                    }
                });

                let pending_window_state = Arc::new(Mutex::new(None::<WindowState>));
                let pending_state_for_saver = pending_window_state.clone();
                let app_handle_for_saver = app.handle().clone();

                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(Duration::from_millis(500)).await;

                        let state_to_save = {
                            let mut lock = pending_state_for_saver.lock().unwrap();
                            lock.take()
                        };

                        if let Some(state) = state_to_save
                            && let Ok(config_dir) =
                                app_handle_for_saver.path().app_config_dir()
                        {
                            let path = config_dir.join("window_state.json");
                            let _ = std::fs::create_dir_all(&config_dir);
                            if let Ok(json) = serde_json::to_string(&state) {
                                let _ = std::fs::write(&path, json);
                            }
                        }
                    }
                });

                let window_for_handler = window.clone();
                let pending_state_for_handler = pending_window_state;

                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                        #[cfg(any(windows, target_os = "linux"))]
                        let maximized = window_for_handler.is_maximized().unwrap_or(false);
                        #[cfg(not(any(windows, target_os = "linux")))]
                        let maximized = false;

                        #[cfg(any(windows, target_os = "linux"))]
                        let fullscreen = window_for_handler.is_fullscreen().unwrap_or(false);
                        #[cfg(not(any(windows, target_os = "linux")))]
                        let fullscreen = false;

                        if window_for_handler.is_minimized().unwrap_or(false) {
                            return;
                        }

                        let mut state = WindowState {
                            width: 1280,
                            height: 720,
                            x: 0,
                            y: 0,
                            maximized,
                            fullscreen,
                        };

                        if let Ok(position) = window_for_handler.outer_position() {
                            state.x = position.x;
                            state.y = position.y;
                        }

                        if !maximized
                            && !fullscreen
                            && let Ok(size) = window_for_handler.outer_size()
                            && size.width >= 800
                            && size.height >= 600
                        {
                            state.width = size.width;
                            state.height = size.height;
                        }

                        *pending_state_for_handler.lock().unwrap() = Some(state);
                    }
                    _ => {}
                });
            }

            crate::register_exit_handler();
            #[cfg(all(feature = "validation-harness", unix))]
            qa_control::start(app.handle().clone()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .manage(AppState::new())
        .manage(library::changefeed::LibraryFilesystemChangefeed::default())
        .manage(library::catalog::LibraryCatalog::default())
        .invoke_handler(tauri::generate_handler![
            apply_adjustments,
            generate_export_soft_proof_preview,
            resolve_export_soft_proof_transform_metadata,
            generate_preview_for_path,
            generate_original_transformed_preview,
            sample_viewer_pixel,
            generate_preset_preview,
            generate_uncropped_preview,
            preview_geometry_transform,
            get_log_file_path,
            frontend_log,
            save_collage,
            merge_hdr,
            cancel_hdr_plan,
            plan_focus_stack,
            cancel_focus_stack_plan,
            merge::focus_stack::job::prepare_focus_stack_candidate,
            merge::focus_stack::job::read_focus_stack_job,
            merge::focus_stack::apply::apply_focus_stack_candidate,
            merge::focus_stack::retouch::apply_focus_stack_retouch,
            merge::focus_stack::retouch::open_focus_stack_retouch,
            merge::focus_stack::retouch::navigate_focus_stack_retouch,
            save_hdr,
            load_and_parse_lut,
            fetch_community_presets,
            generate_all_community_previews,
            save_temp_file,
            get_image_dimensions,
            analyze_perspective_correction,
            is_original_file_available,
            resolve_original_source_identity,
            frontend_ready,
            get_startup_trace,
            record_frontend_startup_phase,
            library::changefeed::configure_library_changefeed,
            library::changefeed::get_library_changefeed_report,
            library::file_management::get_library_change_rows,
            library::catalog::open_library_collection,
            library::catalog::next_library_collection_page,
            library::catalog::reconcile_library_catalog,
            library::catalog::apply_library_catalog_changes,
            library::catalog::get_library_catalog_report,
            library::catalog::get_library_folder_aggregates,
            cancel_thumbnail_generation,
            update_wgpu_transform,
            flush_wgpu_presentation,
            get_wgpu_presentation_report,
            analyze_tone_equalizer_placement,
            sample_tone_equalizer_picker,
            sample_point_color_picker,
            app::display_target::get_display_target_report,
            get_gpu_pipeline_report,
            android_integration::resolve_android_content_uri_name,
            cache_utils::clear_session_caches,
            cache_utils::clear_image_caches,
            app_settings::load_settings,
            app_settings::save_settings,
            app::capabilities::get_native_capabilities,
            build_ai_commands::generate_ai_subject_mask,
            build_ai_commands::generate_ai_object_mask_proposal,
            build_ai_commands::precompute_ai_subject_mask,
            build_ai_commands::generate_ai_foreground_mask,
            build_ai_commands::generate_ai_sky_mask,
            build_ai_commands::generate_ai_depth_mask,
            build_ai_commands::generate_ai_whole_person_mask,
            build_ai_commands::generate_ai_person_part_mask,
            build_ai_commands::get_ai_model_registry_report,
            build_ai_commands::cancel_ai_model_load,
            build_ai_commands::evict_ai_model_session,
            build_ai_commands::check_ai_connector_status,
            build_ai_commands::test_ai_connector_connection,
            build_ai_commands::invoke_generative_replace_with_mask_def,
            denoise_api::dry_run_denoise_controls,
            denoising::apply_denoising,
            denoising::batch_denoise_images,
            denoising::save_denoised_image,
            display_profile::get_active_display_profile,
            display_profile::get_display_preview_lut_status,
            color::camera_profile::registry::list_camera_profiles,
            color::camera_profile::registry::import_camera_profile,
            color::camera_profile::registry::remove_camera_profile,
            color::camera_profile::registry::reveal_camera_profile,
            color::calibration::fit_and_publish_chart_calibration,
            color::calibration::fit_chart_calibration_report,
            image_loader::compare_raw_reconstruction_modes,
            image_loader::load_image,
            image_open_session::begin_image_open,
            image_open_session::schedule_image_prefetch,
            image_open_session::get_image_open_diagnostics,
            image_loader::is_image_cached,
            plan_hdr,
            super_resolution::plan_super_resolution,
            super_resolution::cancel_super_resolution_registration,
            super_resolution::job::prepare_burst_sr_candidate,
            super_resolution::job::read_burst_sr_candidate_job,
            super_resolution::apply::apply_burst_sr_candidate,
            super_resolution::single_image::get_single_image_x2_capability,
            super_resolution::single_image::preview_single_image_x2,
            super_resolution::single_image::apply::apply_single_image_x2,
            super_resolution::single_image::batch::queue_single_image_x2_batch,
            super_resolution::single_image::cancel_single_image_x2_preview,
            merge::computational_job::cancel_computational_merge_job,
            panorama_stitching::plan_panorama,
            panorama_stitching::cancel_panorama_alignment,
            panorama_stitching::stitch_panorama,
            panorama_stitching::save_panorama,
            export::export_processing::get_export_color_capabilities,
            export::export_processing::export_images,
            export::export_processing::resume_export,
            export::export_processing::cancel_export,
            export::export_processing::estimate_export_sizes,
            auto_adjust::calculate_auto_adjustments,
            auto_adjust::calculate_legacy_auto_adjustments_v1,
            color::auto_edit::analyze_auto_edit,
            color::auto_edit::preview_auto_edit_proposal,
            color::auto_edit::apply_auto_edit_proposal,
            color::auto_edit::cancel_auto_edit_analysis,
            mask_generation::generate_mask_overlay,
            file_management::update_exif_fields,
            file_management::get_supported_file_types,
            file_management::read_exif_for_paths,
            file_management::check_xmp_metadata_conflicts,
            file_management::read_library_relink_identity,
            file_management::list_images_in_dir,
            file_management::list_images_recursive,
            file_management::get_folder_tree,
            file_management::get_folder_children,
            file_management::get_folder_refresh_snapshot,
            file_management::get_pinned_folder_trees,
            file_management::update_thumbnail_queue,
            thumbnail_resources::get_thumbnail_resource,
            thumbnail_resources::get_thumbnail_transport_metrics,
            file_management::create_folder,
            file_management::delete_folder,
            file_management::copy_files,
            file_management::move_files,
            file_management::rename_folder,
            file_management::rename_files,
            file_management::duplicate_file,
            file_management::show_in_finder,
            file_management::delete_files_from_disk,
            file_management::delete_files_with_associated,
            file_management::save_metadata_and_update_thumbnail,
            file_management::import_external_editor_variant,
            file_management::get_external_editor_file_watch_snapshot,
            file_management::launch_external_editor,
            file_management::apply_adjustments_to_paths,
            file_management::load_metadata,
            presets::load_presets,
            presets::save_presets,
            file_management::get_or_create_internal_library_root,
            file_management::reset_adjustments_for_paths,
            file_management::apply_auto_adjustments_to_paths,
            presets::handle_import_presets_from_file,
            presets::handle_import_legacy_presets_from_file,
            presets::handle_export_presets_to_file,
            presets::save_community_preset,
            file_management::clear_all_sidecars,
            #[cfg(feature = "validation-harness")]
            color_gpu_readback_probe::run_color_gpu_readback_probe,
            #[cfg(feature = "validation-harness")]
            raw_open_edit_export_proof::run_raw_open_edit_export_proof,
            file_management::clear_thumbnail_cache,
            file_management::set_color_label_for_paths,
            file_management::set_rating_for_paths,
            file_management::resolve_xmp_metadata_conflicts,
            file_management::import_files,
            file_management::cancel_import,
            file_management::get_import_job_receipt,
            file_management::validate_import_job_resume,
            file_management::resume_import_job,
            file_management::create_virtual_copy,
            album_management::get_albums,
            album_management::save_albums,
            album_management::add_to_album,
            file_management::get_album_images,
            tagging::start_background_indexing,
            tagging::clear_ai_tags,
            tagging::clear_all_tags,
            tagging::add_tag_for_paths,
            tagging::remove_tag_for_paths,
            culling::cull_images,
            tethering::discover_tethered_cameras,
            tethering::open_tether_session,
            tethering::get_tether_session,
            tethering::close_tether_session,
            tethering::set_tether_camera_control,
            tethering::trigger_tether_capture,
            deblur_api::dry_run_deblur_controls,
            lens_correction::get_lensfun_makers,
            lens_correction::get_lensfun_lenses_for_maker,
            lens_correction::autodetect_lens,
            lens_correction::get_lens_distortion_params,
            negative_conversion::preview_negative_conversion,
            negative_conversion::render_negative_lab_dry_run_preview_artifact,
            negative_conversion::estimate_negative_base_fog,
            negative_conversion::suggest_negative_lab_neutral_patch_rgb_balance,
            negative_conversion::suggest_negative_lab_highlight_patch_exposure,
            negative_conversion::suggest_negative_lab_shadow_patch_black_point,
            negative_conversion::convert_negatives,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(#[allow(unused_variables)] |app_handle, event| {
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    if let Some(url) = urls.first()
                        && let Ok(path) = url.to_file_path()
                        && let Some(path_str) = path.to_str()
                    {
                        let state = app_handle.state::<AppState>();
                        *state.initial_file_path.lock().unwrap() = Some(path_str.to_string());
                        log::info!("macOS initial open: Stored path {} for later.", path_str);
                    }
                }
                tauri::RunEvent::ExitRequested { api, .. } => {
                    api.prevent_exit();

                    #[cfg(target_os = "macos")]
                    unsafe { libc::_exit(0); }

                    #[cfg(not(target_os = "macos"))]
                    std::process::exit(0);
                }
                tauri::RunEvent::Exit => {
                    #[cfg(target_os = "macos")]
                    unsafe { libc::_exit(0); }

                    #[cfg(not(target_os = "macos"))]
                    std::process::exit(0);
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GrayImage, ImageFormat};
    use serde_json::json;

    fn encoded_preview_fixture(image: DynamicImage) -> String {
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, ImageFormat::Png).unwrap();
        general_purpose::STANDARD.encode(bytes.into_inner())
    }

    #[test]
    fn preview_geometry_scale_is_crop_aware_without_undersampling_narrow_crops() {
        assert_eq!(
            preview_geometry_source_scale(10_000, 8_000, &json!({}), 2_000),
            0.2
        );
        assert_eq!(
            preview_geometry_source_scale(
                10_000,
                8_000,
                &json!({"crop": {"x": 4_000.0, "y": 3_000.0, "width": 2_000.0, "height": 1_500.0}}),
                2_000,
            ),
            1.0
        );
        assert_eq!(
            preview_geometry_source_scale(
                10_000,
                8_000,
                &json!({"crop": {"x": 2_000.0, "y": 2_000.0, "width": 4_000.0, "height": 3_000.0}}),
                2_000,
            ),
            0.5
        );
        let hundred_mp_scale = preview_geometry_source_scale(12_500, 8_000, &json!({}), 1_920);
        let hundred_mp_working_pixels = (12_500.0 * hundred_mp_scale).round() as u64
            * (8_000.0 * hundred_mp_scale).round() as u64;
        assert!((hundred_mp_scale - 0.1536).abs() < 1e-6);
        assert!(hundred_mp_working_pixels < 2_400_000);
        assert!(hundred_mp_working_pixels * 40 < 100_000_000);
    }

    #[test]
    fn preview_geometry_target_resolves_interactive_and_explicit_long_edges() {
        assert_eq!(
            PreviewGeometryTarget::EditorSetting {
                quality: PreviewGeometryQuality::Interactive,
            }
            .resolve_long_edge(3000),
            2000
        );
        assert_eq!(
            PreviewGeometryTarget::LongEdge {
                long_edge_px: 4096,
                quality: PreviewGeometryQuality::Settled,
            }
            .resolve_long_edge(1920),
            4096
        );
    }

    #[test]
    fn preview_geometry_samples_plain_narrow_crop_without_transforming_full_source() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(1000, 800, |x, y| {
            image::Rgb([x as f32 / 999.0, y as f32 / 799.0, 0.25])
        }));
        let adjustments = json!({
            "crop": {"x": 400.0, "y": 300.0, "width": 200.0, "height": 100.0},
        });
        let result = compute_direct_crop_preview(&source, &adjustments, 100, None)
            .unwrap()
            .unwrap();
        let preview = result.image;

        assert_eq!(preview.dimensions(), (100, 50));
        assert!((result.effective_scale - 0.5).abs() < 1e-6);
        assert_eq!(result.unscaled_crop_offset, (400.0, 300.0));
        assert_eq!(result.receipt.source_pixel_count, 800_000);
        assert_eq!(result.receipt.working_pixel_count, 20_000);
        assert_eq!(result.receipt.output_pixel_count, 5_000);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        assert!(result.receipt.direct_crop);
        let center = preview.to_rgb32f().get_pixel(50, 25).0;
        assert!((center[0] - 0.5).abs() < 0.01);
        assert!((center[1] - 0.438).abs() < 0.01);
    }

    #[test]
    fn direct_crop_maps_orientation_and_flip_back_to_source_roi() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(300, 200, |x, y| {
            image::Rgb([x as f32 / 299.0, y as f32 / 199.0, 0.5])
        }));
        let adjustments = json!({
            "orientationSteps": 1,
            "flipHorizontal": true,
            "crop": {"x": 40.0, "y": 80.0, "width": 100.0, "height": 120.0},
        });
        let (full, _) = apply_all_transformations(&source, &adjustments);
        let reference = downscale_f32_image(&full, 50, 50).to_rgb32f();
        let result = compute_direct_crop_preview(&source, &adjustments, 50, None)
            .unwrap()
            .unwrap();
        let preview = result.image.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert_eq!(result.receipt.working_pixel_count, 12_000);
        let max_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0_f32, f32::max);
        assert!(max_error < 1e-5, "orientation/flip max error {max_error}");
    }

    #[test]
    fn rotated_narrow_crop_inverse_samples_source_into_preview_only() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(600, 400, |x, y| {
            image::Rgb([x as f32 / 599.0, y as f32 / 399.0, 0.5])
        }));
        let adjustments = json!({
            "rotation": 7.0,
            "orientationSteps": 1,
            "flipVertical": true,
            "crop": {"x": 100.0, "y": 160.0, "width": 200.0, "height": 240.0},
        });
        let (full, _) = apply_all_transformations(&source, &adjustments);
        let reference = downscale_f32_image(&full, 100, 100).to_rgb32f();
        let result = compute_direct_crop_preview(&source, &adjustments, 100, None)
            .unwrap()
            .unwrap();
        let preview = result.image.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert_eq!(result.receipt.working_pixel_count, 8_300);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        let mean_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs() as f64)
            .sum::<f64>()
            / preview.as_raw().len() as f64;
        assert!(mean_error < 0.01, "rotated crop mean error {mean_error}");
    }

    #[test]
    fn nonlinear_geometry_narrow_crop_samples_directly_into_preview() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(600, 400, |x, y| {
            image::Rgb([x as f32 / 599.0, y as f32 / 399.0, (x + y) as f32 / 998.0])
        }));
        let adjustments = json!({
            "transformVertical": 12.0,
            "transformHorizontal": -7.0,
            "transformDistortion": 4.0,
            "rotation": -3.0,
            "crop": {"x": 180.0, "y": 120.0, "width": 240.0, "height": 160.0},
        });
        let (full, _) = apply_all_transformations(&source, &adjustments);
        let reference = downscale_f32_image(&full, 120, 120).to_rgb32f();
        let result = compute_direct_crop_preview(&source, &adjustments, 120, None)
            .unwrap()
            .unwrap();
        let preview = result.image.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert_eq!(result.receipt.working_pixel_count, 9_600);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        let mean_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs() as f64)
            .sum::<f64>()
            / preview.as_raw().len() as f64;
        assert!(mean_error < 0.015, "nonlinear crop mean error {mean_error}");
    }

    #[test]
    fn nonlinear_preview_cancellation_stops_between_fixed_output_bands() {
        let source = DynamicImage::new_rgb32f(600, 400);
        let adjustments = json!({
            "transformDistortion": 4.0,
            "crop": {"x": 180.0, "y": 120.0, "width": 240.0, "height": 240.0},
        });
        let checks = std::sync::atomic::AtomicUsize::new(0);
        let cancellation = || {
            if checks.fetch_add(1, Ordering::Relaxed) >= 2 {
                Err("preview_cancelled:Geometry".to_string())
            } else {
                Ok(())
            }
        };
        let error = compute_direct_crop_preview(&source, &adjustments, 128, Some(&cancellation))
            .err()
            .expect("third 32-row band checkpoint should cancel the preview");

        assert_eq!(error, "preview_cancelled:Geometry");
        assert_eq!(checks.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn private_raw_preview_geometry_is_target_bounded_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_PREVIEW_GEOMETRY_PROOF").as_deref() != Ok("1") {
            return;
        }
        let source_path = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE")
            .expect("RAWENGINE_PRIVATE_RAW_SOURCE must select a private RAW");
        let bytes = std::fs::read(&source_path).expect("read private RAW bytes");
        let decoded =
            load_base_image_from_bytes(&bytes, &source_path, false, &AppSettings::default(), None)
                .expect("decode private RAW");
        let (width, height) = decoded.dimensions();
        let crop_width = (width / 3).max(1);
        let crop_height = (height / 3).max(1);
        let adjustments = json!({
            "transformVertical": 11.0,
            "transformHorizontal": -6.0,
            "transformDistortion": 4.0,
            "rotation": 2.5,
            "crop": {
                "x": (width - crop_width) / 2,
                "y": (height - crop_height) / 2,
                "width": crop_width,
                "height": crop_height,
            },
        });
        let started = std::time::Instant::now();
        let result = PreviewGeometryPipeline::execute(PreviewGeometryRequest {
            source: &decoded,
            adjustments: &adjustments,
            target_long_edge: 1920,
            cancellation: None,
        })
        .expect("render private RAW preview geometry");
        let elapsed = started.elapsed();
        eprintln!(
            "private_raw_preview_geometry_proof source={}x{} output={}x{} source_pixels={} working_pixels={} tiles={} elapsed_ms={}",
            width,
            height,
            result.image.width(),
            result.image.height(),
            result.receipt.source_pixel_count,
            result.receipt.working_pixel_count,
            result.receipt.tile_count,
            elapsed.as_millis(),
        );

        assert_eq!(result.image.width().max(result.image.height()), 1920);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        assert_eq!(
            result.receipt.working_pixel_count,
            result.receipt.output_pixel_count
        );
        assert!(result.receipt.tile_count > 1);
        assert!(
            result.receipt.working_pixel_count * 8 < result.receipt.source_pixel_count,
            "preview work should be far below decoded RAW area: {:?} vs {:?}",
            result.receipt.working_pixel_count,
            result.receipt.source_pixel_count
        );
        assert!(elapsed < Duration::from_secs(10));
    }

    #[test]
    fn normal_preview_does_not_invoke_full_resolution_transform() {
        let state = AppState::new();
        let source = DynamicImage::new_rgb32f(400, 300);
        let full_transform_count = FULL_TRANSFORM_INVOCATIONS.load(Ordering::Relaxed);
        let (preview, _, _) =
            compute_preview_transformed_for_state(&state, &source, &json!({}), 100, None).unwrap();

        assert_eq!(preview.dimensions(), (100, 75));
        assert_eq!(
            FULL_TRANSFORM_INVOCATIONS.load(Ordering::Relaxed),
            full_transform_count
        );
    }

    #[test]
    fn preview_geometry_receipt_proves_work_scales_with_target_not_source_area() {
        let source = DynamicImage::new_rgb32f(1000, 800);
        let result = PreviewGeometryPipeline::execute(PreviewGeometryRequest {
            source: &source,
            adjustments: &json!({}),
            target_long_edge: 100,
            cancellation: None,
        })
        .unwrap();

        assert_eq!(result.image.dimensions(), (100, 80));
        assert_eq!(result.receipt.source_pixel_count, 800_000);
        assert_eq!(result.receipt.working_pixel_count, 8_000);
        assert_eq!(result.receipt.output_pixel_count, 8_000);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        assert!(!result.receipt.direct_crop);
    }

    #[test]
    fn preview_geometry_cancels_between_bounded_pipeline_stages() {
        let source = DynamicImage::new_rgb32f(1000, 800);
        let checks = std::sync::atomic::AtomicUsize::new(0);
        let cancellation = || {
            if checks.fetch_add(1, Ordering::Relaxed) >= 1 {
                Err("preview_cancelled:Geometry".to_string())
            } else {
                Ok(())
            }
        };
        let error = PreviewGeometryPipeline::execute(PreviewGeometryRequest {
            source: &source,
            adjustments: &json!({}),
            target_long_edge: 100,
            cancellation: Some(&cancellation),
        })
        .err()
        .expect("second checkpoint should stop obsolete preview work");

        assert_eq!(error, "preview_cancelled:Geometry");
        assert_eq!(checks.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn preview_geometry_scales_pixel_crop_coordinates_once() {
        let adjustments = json!({
            "crop": {"x": 1200.0, "y": 800.0, "width": 4000.0, "height": 3000.0},
            "rotation": 1.5,
            "transformVertical": 12.0,
        });
        let scaled = scale_preview_geometry_adjustments(&adjustments, 0.25);
        assert_eq!(
            scaled["crop"],
            json!({"x": 300.0, "y": 200.0, "width": 1000.0, "height": 750.0})
        );
        assert_eq!(scaled["rotation"], adjustments["rotation"]);
        assert_eq!(
            scaled["transformVertical"],
            adjustments["transformVertical"]
        );
    }

    #[test]
    fn preview_geometry_matches_full_transform_reference_with_bounded_working_output() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(400, 300, |x, y| {
            image::Rgb([x as f32 / 399.0, y as f32 / 299.0, (x + y) as f32 / 698.0])
        }));
        let adjustments = json!({
            "rotation": 2.0,
            "flipHorizontal": true,
            "crop": {"x": 100.0, "y": 75.0, "width": 200.0, "height": 150.0},
        });

        let (full, offset) = apply_all_transformations(&source, &adjustments);
        let reference = downscale_f32_image(&full, 100, 100).to_rgb32f();
        let (preview, effective_scale, preview_offset) =
            compute_preview_transformed(&source, &adjustments, 100, None).unwrap();
        let preview = preview.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert!(preview.width() <= 100 && preview.height() <= 100);
        assert!((effective_scale - 0.5).abs() < 1e-6);
        assert_eq!(preview_offset, offset);

        let mean_absolute_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs() as f64)
            .sum::<f64>()
            / preview.as_raw().len() as f64;
        assert!(
            mean_absolute_error < 0.015,
            "preview/reference mean absolute error {mean_absolute_error} exceeded tolerance"
        );
    }

    #[test]
    fn preview_geometry_prepares_patch_assets_at_preview_resolution() {
        let source = DynamicImage::new_rgb32f(400, 300);
        let mask = GrayImage::from_pixel(400, 300, Luma([255]));
        let color = RgbImage::from_pixel(400, 300, image::Rgb([255, 0, 0]));
        let adjustments = json!({
            "aiPatches": [{
                "id": "preview-patch",
                "revision": 1,
                "visible": true,
                "patchData": {
                    "mask": encoded_preview_fixture(DynamicImage::ImageLuma8(mask)),
                    "color": encoded_preview_fixture(DynamicImage::ImageRgb8(color)),
                },
                "subMasks": [],
            }],
        });

        let (preview, effective_scale, _) =
            compute_preview_transformed(&source, &adjustments, 100, None).unwrap();
        let preview = preview.to_rgb32f();
        let center = preview.get_pixel(preview.width() / 2, preview.height() / 2);

        assert_eq!(preview.dimensions(), (100, 75));
        assert!((effective_scale - 0.25).abs() < 1e-6);
        assert!(center[0] > 0.99 && center[1] < 0.01 && center[2] < 0.01);
    }

    #[test]
    fn narrow_crop_blends_source_anchored_patch_in_preview_space() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_pixel(
            400,
            300,
            image::Rgb([0.1, 0.2, 0.3]),
        ));
        let mask = GrayImage::from_fn(400, 300, |x, _| {
            Luma([((x as f32 / 399.0) * 255.0).round() as u8])
        });
        let color = RgbImage::from_pixel(400, 300, image::Rgb([255, 0, 0]));
        let adjustments = json!({
            "rotation": 3.0,
            "crop": {"x": 100.0, "y": 75.0, "width": 200.0, "height": 150.0},
            "aiPatches": [{
                "id": "mapped-preview-patch",
                "revision": 1,
                "visible": true,
                "patchData": {
                    "mask": encoded_preview_fixture(DynamicImage::ImageLuma8(mask)),
                    "color": encoded_preview_fixture(DynamicImage::ImageRgb8(color)),
                },
                "subMasks": [],
            }],
        });
        let patched = composite_patches_on_image(&source, &adjustments).unwrap();
        let (full, _) = apply_all_transformations(patched, &adjustments);
        let reference = downscale_f32_image(&full, 100, 100).to_rgb32f();
        let result = compute_direct_crop_preview(&source, &adjustments, 100, None)
            .unwrap()
            .unwrap();
        let preview = result.image.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert_eq!(result.receipt.working_pixel_count, 7_500);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        let mean_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs() as f64)
            .sum::<f64>()
            / preview.as_raw().len() as f64;
        assert!(mean_error < 0.02, "mapped patch mean error {mean_error}");
    }

    fn write_test_lut(path: &std::path::Path, middle: f32) {
        let mut cube = String::from("LUT_3D_SIZE 2\n");
        for _ in 0..8 {
            cube.push_str(&format!("0 {middle} 1\n"));
        }
        std::fs::write(path, cube).unwrap();
    }

    #[test]
    fn lut_processing_cache_reuses_content_and_invalidates_replaced_path() {
        let temp = tempfile::tempdir().unwrap();
        let first_path = temp.path().join("first.cube");
        let alias_path = temp.path().join("alias.cube");
        write_test_lut(&first_path, 0.5);
        write_test_lut(&alias_path, 0.5);
        let state = AppState::new();

        let first = get_or_load_lut(&state, first_path.to_str().unwrap()).unwrap();
        let warm = get_or_load_lut(&state, first_path.to_str().unwrap()).unwrap();
        let alias = get_or_load_lut(&state, alias_path.to_str().unwrap()).unwrap();
        assert!(Arc::ptr_eq(&first, &warm));
        assert!(Arc::ptr_eq(&first, &alias));

        let replacement = temp.path().join("replacement.cube");
        write_test_lut(&replacement, 0.25);
        std::fs::rename(&replacement, &first_path).unwrap();
        let changed = get_or_load_lut(&state, first_path.to_str().unwrap()).unwrap();
        assert!(!Arc::ptr_eq(&first, &changed));
        assert_ne!(first.content_hash, changed.content_hash);
    }

    #[test]
    fn preview_dispatch_rejects_an_expected_image_mismatch_before_enqueue() {
        let error = validate_expected_preview_image("/photos/alaska-b.ARW", "/photos/alaska-a.ARW")
            .expect_err("a request for image A must not run against image B");

        assert_eq!(
            error,
            "Preview request rejected: expected image is no longer loaded"
        );
    }

    #[test]
    fn preview_dispatch_accepts_the_expected_loaded_image() {
        assert!(
            validate_expected_preview_image("/photos/alaska-a.ARW", "/photos/alaska-a.ARW").is_ok()
        );
    }

    fn hdr_test_item(
        path: &str,
        width: u32,
        height: u32,
    ) -> (String, String, DynamicImage, Duration, f32) {
        (
            path.to_string(),
            format!("blake3:test-hash-{}", path),
            DynamicImage::new_rgb8(width, height),
            Duration::from_millis(125),
            100.0,
        )
    }

    #[test]
    fn validate_hdr_merge_dimensions_accepts_matching_inputs() {
        let items = vec![
            hdr_test_item("/tmp/base.exr", 64, 48),
            hdr_test_item("/tmp/bright.exr", 64, 48),
            hdr_test_item("/tmp/dark.exr", 64, 48),
        ];

        assert!(validate_hdr_merge_dimensions(&items).is_ok());
    }

    #[test]
    fn validate_hdr_merge_dimensions_reports_target_mismatch() {
        let items = vec![
            hdr_test_item("/tmp/base.exr", 64, 48),
            hdr_test_item("/tmp/wrong-size.exr", 32, 48),
        ];

        let error =
            validate_hdr_merge_dimensions(&items).expect_err("dimension mismatch should fail");

        assert!(error.contains("Dimension mismatch detected."));
        assert!(error.contains("Base image (base.exr): 64x48"));
        assert!(error.contains("Target image (wrong-size.exr): 32x48"));
    }
}
