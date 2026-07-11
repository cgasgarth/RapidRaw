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
mod raw;
mod render;
mod tagging;
mod window_customizer;

pub(crate) use color::*;
pub(crate) use computational::*;
pub use computational::{deblur_cpu_reference, denoise_cpu_reference};
pub(crate) use gpu::*;
pub(crate) use io::*;
pub(crate) use library::*;
pub(crate) use merge::*;
pub(crate) use raw::*;
pub(crate) use render::*;

use std::collections::{HashMap, hash_map::DefaultHasher};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::io::Write;
use std::panic;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{Engine as _, engine::general_purpose};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma, RgbImage, Rgba};
use image_hdr::hdr_merge_images;
use image_hdr::input::HDRInput;
use imageproc::drawing::draw_line_segment_mut;
use imageproc::edges::canny;
use imageproc::hough::{LineDetectionOptions, detect_lines};
use mozjpeg_rs::{Encoder, Preset};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager, ipc::Response};
use tempfile::NamedTempFile;

use crate::formats::PNG_DATA_URL_PREFIX;
use crate::hdr_artifact_sidecar::write_hdr_output_sidecar;
use crate::image_codecs::{encode_jpeg_data_url, encode_jpeg_response, encode_png_data_url};
use crate::merge::atomic_derived_output::{AtomicDerivedOutputTransaction, DerivedOutputManifest};
use crate::merge::focus_stack::{
    FocusStackInputPlan, FocusStackReadinessSettings, build_input_plan,
};
use crate::merge::hdr::{ALIGNMENT_POLICY_ID, HdrAlignmentPlanResponse, build_alignment_plan};

use crate::cache_utils::{
    calculate_full_job_hash, calculate_geometry_hash, calculate_transform_hash,
    calculate_visual_hash,
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
    get_all_adjustments_from_json, get_or_init_gpu_context, process_and_get_dynamic_image,
    resolve_tonemapper_override, resolve_tonemapper_override_from_handle, warp_image_geometry,
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

pub fn generate_transformed_preview(
    state: &tauri::State<AppState>,
    loaded_image: &LoadedImage,
    adjustments: &serde_json::Value,
    preview_dim: u32,
) -> Result<(DynamicImage, f32, (f32, f32)), String> {
    let transform_hash = calculate_transform_hash(adjustments);

    let (transformed_full_res, unscaled_crop_offset) = {
        let mut cache_lock = state.full_transformed_cache.lock().unwrap();
        if let Some((hash, img, offset)) = cache_lock.as_ref() {
            if *hash == transform_hash {
                (Arc::clone(img), *offset)
            } else {
                let (arc_img, offset) = compute_full_transformed_res(loaded_image, adjustments)?;
                *cache_lock = Some((transform_hash, Arc::clone(&arc_img), offset));
                (arc_img, offset)
            }
        } else {
            let (arc_img, offset) = compute_full_transformed_res(loaded_image, adjustments)?;
            *cache_lock = Some((transform_hash, Arc::clone(&arc_img), offset));
            (arc_img, offset)
        }
    };

    let (full_res_w, full_res_h) = transformed_full_res.dimensions();

    let final_preview_base = if full_res_w > preview_dim || full_res_h > preview_dim {
        downscale_f32_image(&transformed_full_res, preview_dim, preview_dim)
    } else {
        (*transformed_full_res).clone()
    };

    let scale_for_gpu = if full_res_w > 0 {
        final_preview_base.width() as f32 / full_res_w as f32
    } else {
        1.0
    };

    Ok((final_preview_base, scale_for_gpu, unscaled_crop_offset))
}

fn compute_full_transformed_res(
    loaded_image: &LoadedImage,
    adjustments: &serde_json::Value,
) -> Result<(Arc<DynamicImage>, (f32, f32)), String> {
    let has_patches = adjustments
        .get("aiPatches")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    let patched_original_image = if has_patches {
        Cow::Owned(
            composite_patches_on_image(&loaded_image.image, adjustments)
                .map_err(|e| format!("Failed to composite AI patches: {}", e))?,
        )
    } else {
        Cow::Borrowed(loaded_image.image.as_ref())
    };

    let (transformed_img, offset) = apply_all_transformations(patched_original_image, adjustments);
    Ok((Arc::new(transformed_img.into_owned()), offset))
}

pub fn get_or_load_lut(state: &tauri::State<AppState>, path: &str) -> Result<Arc<Lut>, String> {
    let mut cache = state.lut_cache.lock().unwrap();
    if let Some(lut) = cache.get(path) {
        return Ok(lut.clone());
    }

    let lut = lut_processing::parse_lut_file(path).map_err(|e| e.to_string())?;
    let arc_lut = Arc::new(lut);
    cache.insert(path.to_string(), arc_lut.clone());
    Ok(arc_lut)
}

#[tauri::command]
fn get_image_dimensions(path: String) -> Result<ImageDimensions, String> {
    let (source_path, _) = parse_virtual_path(&path);
    image::image_dimensions(&source_path)
        .map(|(width, height)| ImageDimensions { width, height })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn is_original_file_available(path: String) -> bool {
    let (source_path, _) = parse_virtual_path(&path);
    source_path.exists()
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

    {
        let cache_lock = state.full_warped_cache.lock().unwrap();
        if let Some((hash, img)) = cache_lock.as_ref()
            && *hash == geo_hash
        {
            return Ok(Arc::clone(img));
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
        *cache_lock = Some((geo_hash, Arc::clone(&warped_arc)));
    }

    Ok(warped_arc)
}

#[tauri::command]
async fn update_wgpu_transform(
    payload: WgpuTransformPayload,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let context = match state.gpu_context.lock().unwrap().as_ref() {
        Some(c) => c.clone(),
        None => return Ok(()),
    };

    tokio::task::spawn_blocking(move || {
        let mut display_lock = context.display.lock().unwrap();
        if let Some(display) = display_lock.as_mut() {
            display.latest_transform.rect = [payload.x, payload.y, payload.width, payload.height];
            display.latest_transform.clip = [
                payload.clip_x,
                payload.clip_y,
                payload.clip_width,
                payload.clip_height,
            ];
            display.latest_transform.window = [payload.window_width, payload.window_height];
            display.latest_transform.bg_primary = payload.bg_primary;
            display.latest_transform.bg_secondary = payload.bg_secondary;
            display.latest_transform.pixelated = if payload.pixelated { 1.0 } else { 0.0 };

            context.queue.write_buffer(
                &display.transform_buffer,
                0,
                bytemuck::bytes_of(&display.latest_transform),
            );
            display.render(&context.device, &context.queue);
        }
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))?;

    Ok(())
}

fn start_analytics_worker(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<AppState>();
    let (tx, rx): (Sender<AnalyticsJob>, Receiver<AnalyticsJob>) = mpsc::channel();
    *state.analytics_worker_tx.lock().unwrap() = Some(tx);

    std::thread::spawn(move || {
        while let Ok(mut job) = rx.recv() {
            while let Ok(latest) = rx.try_recv() {
                job = latest;
            }

            if let Ok(histogram_data) = image_analytics::calculate_histogram_from_image(&job.image)
            {
                let _ = app_handle.emit(
                    crate::events::HISTOGRAM_UPDATE,
                    serde_json::json!({ "path": job.path, "data": histogram_data }),
                );
            }

            if let Ok(gamut_warning_data) =
                image_analytics::calculate_gamut_warning_overlay_from_image(&job.image)
            {
                let _ = app_handle.emit(
                    crate::events::GAMUT_WARNING_UPDATE,
                    serde_json::json!({ "path": job.path, "data": gamut_warning_data }),
                );
            }

            if job.compute_waveform
                && let Ok(waveform_data) = image_analytics::calculate_waveform_from_image(
                    &job.image,
                    job.active_waveform_channel.as_deref(),
                )
            {
                let _ = app_handle.emit(
                    crate::events::WAVEFORM_UPDATE,
                    serde_json::json!({ "path": job.path, "data": waveform_data }),
                );
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
        let tx_guard = state.preview_worker_tx.lock().unwrap();
        if let Some(worker_tx) = &*tx_guard {
            let job = PreviewJob {
                adjustments: request.js_adjustments,
                expected_image_path: request.expected_image_path,
                is_interactive: request.is_interactive,
                target_resolution: request.target_resolution,
                roi: request.roi,
                compute_waveform: request.compute_waveform,
                active_waveform_channel: request.active_waveform_channel,
                viewer_sample_graph_revision: request.viewer_sample_graph_revision,
                responder: tx,
            };
            worker_tx
                .send(job)
                .map_err(|e| format!("Failed to send to preview worker: {}", e))?;
        } else {
            return Err("Preview worker not running".to_string());
        }
    }

    match rx.await {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(_) => Err("Superseded or worker failed".to_string()),
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
        state.viewer_sample_frames.lock().unwrap().insert(
            "softProof".to_string(),
            CachedViewerSampleFrame {
                graph_revision: graph_revision.to_string(),
                image: Arc::new(DynamicImage::ImageRgb8(proof_image)),
                image_identity: loaded_image.path.clone(),
                space_label: format!("Soft proof · {}", proof_metadata.effective_color_profile),
            },
        );
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
        && let Some(sender) = state.analytics_worker_tx.lock().unwrap().clone()
    {
        let _ = sender.send(AnalyticsJob {
            path: loaded_image.path,
            image: Arc::new(proof_image),
            compute_waveform: request.compute_waveform,
            active_waveform_channel: request.active_waveform_channel,
        });
    }

    Encoder::new(Preset::BaselineFastest)
        .quality(86)
        .encode_rgb(&proof_pixels, width, height)
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
    let detail_stage =
        render_pipeline::apply_pre_gpu_detail_stages(&preview_image, transform_hash, adjustments);
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
    let render_adjustments = normalize_film_look_adjustments_for_render(adjustments);
    let tm_override = resolve_tonemapper_override_from_handle(app_handle, loaded_image.is_raw);
    let final_adjustments = get_all_adjustments_from_json(
        render_adjustments.as_ref(),
        loaded_image.is_raw,
        tm_override,
    );
    let lut: Option<Arc<Lut>> = render_adjustments["lutPath"]
        .as_str()
        .and_then(|path| get_or_load_lut(state, path).ok());
    let render_hash = calculate_full_job_hash(&loaded_image.path, render_adjustments.as_ref())
        .wrapping_add(detail_stage.render_hash);

    process_and_get_dynamic_image(
        &context,
        state,
        retouched_image.as_ref(),
        render_hash,
        RenderRequest {
            adjustments: final_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut,
            roi: None,
        },
        "export_soft_proof_preview",
    )
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
        let path = loaded_image.path.clone();
        let is_raw = loaded_image.is_raw;
        let unique_hash = calculate_full_job_hash(&path, &adjustments_clone);
        let has_patches = adjustments_clone
            .get("aiPatches")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty());
        let patched_image = if has_patches {
            Cow::Owned(
                composite_patches_on_image(&loaded_image.image, &adjustments_clone).unwrap_or_else(
                    |e| {
                        eprintln!("Failed to composite patches for uncropped preview: {}", e);
                        loaded_image.image.as_ref().clone()
                    },
                ),
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
        let uncropped_adjustments =
            get_all_adjustments_from_json(render_adjustments.as_ref(), is_raw, tm_override);
        let lut_path = render_adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
        let render_hash = calculate_full_job_hash(&loaded_image.path, render_adjustments.as_ref())
            .wrapping_add(unique_hash);

        if let Ok(processed_image) = process_and_get_dynamic_image(
            &context,
            &state,
            &processing_base,
            render_hash,
            RenderRequest {
                adjustments: uncropped_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
                roi: None,
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
        state.viewer_sample_frames.lock().unwrap().insert(
            "original".to_string(),
            CachedViewerSampleFrame {
                graph_revision,
                image: Arc::new(transformed_image.clone()),
                image_identity: loaded_image.path,
                space_label: "Original · Display encoded sRGB".to_string(),
            },
        );
    }

    encode_jpeg_data_url(&transformed_image, 80)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerSamplePoint {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerSampleImageSize {
    width: u32,
    height: u32,
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
    target: String,
    sample_radius_image_px: u32,
    requested_space: String,
}

fn unavailable_viewer_sample(
    request: &ViewerSampleRequest,
    reason: &str,
    space_label: &str,
) -> serde_json::Value {
    serde_json::json!({
        "status": "unavailable",
        "requestIdentity": request.request_identity,
        "reason": reason,
        "spaceLabel": space_label,
    })
}

fn sample_viewer_frame(
    request: &ViewerSampleRequest,
    frame: &CachedViewerSampleFrame,
) -> serde_json::Value {
    if request.requested_space != "displayEncoded" {
        return unavailable_viewer_sample(request, "unsupportedSpace", &frame.space_label);
    }
    if !request.normalized_image_point.x.is_finite()
        || !request.normalized_image_point.y.is_finite()
        || !(0.0..=1.0).contains(&request.normalized_image_point.x)
        || !(0.0..=1.0).contains(&request.normalized_image_point.y)
        || request.source_image_size.width == 0
        || request.source_image_size.height == 0
    {
        return unavailable_viewer_sample(request, "invalidPoint", &frame.space_label);
    }

    let rgb = frame.image.to_rgb32f();
    let width = rgb.width();
    let height = rgb.height();
    if width == 0 || height == 0 {
        return unavailable_viewer_sample(request, "frameUnavailable", &frame.space_label);
    }
    let center_x =
        (request.normalized_image_point.x * f64::from(width.saturating_sub(1))).round() as u32;
    let center_y =
        (request.normalized_image_point.y * f64::from(height.saturating_sub(1))).round() as u32;
    let source_max = request
        .source_image_size
        .width
        .max(request.source_image_size.height)
        .max(1);
    let frame_max = width.max(height).max(1);
    let radius = ((request.sample_radius_image_px as f64 * f64::from(frame_max)
        / f64::from(source_max))
    .ceil() as u32)
        .min(16);
    let min_x = center_x.saturating_sub(radius);
    let max_x = center_x.saturating_add(radius).min(width - 1);
    let min_y = center_y.saturating_sub(radius);
    let max_y = center_y.saturating_add(radius).min(height - 1);
    let mut totals = [0.0_f64; 3];
    let mut count = 0_u64;
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let pixel = rgb.get_pixel(x, y).0;
            totals[0] += f64::from(pixel[0]);
            totals[1] += f64::from(pixel[1]);
            totals[2] += f64::from(pixel[2]);
            count += 1;
        }
    }
    let channels = totals.map(|value| (value / count as f64).clamp(0.0, 1.0));
    let clipped_channels: Vec<&str> = ["r", "g", "b"]
        .into_iter()
        .zip(channels)
        .filter_map(|(label, value)| (value >= 1.0 - f64::EPSILON).then_some(label))
        .collect();
    let image_x = (request.normalized_image_point.x
        * f64::from(request.source_image_size.width.saturating_sub(1)))
    .round() as u32;
    let image_y = (request.normalized_image_point.y
        * f64::from(request.source_image_size.height.saturating_sub(1)))
    .round() as u32;
    serde_json::json!({
        "status": "available",
        "requestIdentity": request.request_identity,
        "imagePointPx": { "x": image_x, "y": image_y },
        "rgb": channels,
        "luma": channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722,
        "clippedChannels": clipped_channels,
        "spaceLabel": frame.space_label,
    })
}

#[tauri::command]
fn sample_viewer_pixel(
    request: ViewerSampleRequest,
    state: tauri::State<AppState>,
) -> serde_json::Value {
    let _geometry_epoch = request.geometry_epoch;
    let frames = state.viewer_sample_frames.lock().unwrap();
    let Some(frame) = frames.get(&request.target) else {
        return unavailable_viewer_sample(&request, "frameUnavailable", "Unavailable");
    };
    if frame.image_identity != request.image_identity
        || frame.graph_revision != request.graph_revision
    {
        return unavailable_viewer_sample(&request, "staleFrame", &frame.space_label);
    }
    sample_viewer_frame(&request, frame)
}

#[cfg(test)]
mod viewer_sampler_tests {
    use super::*;

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
            target: "edited".to_string(),
            sample_radius_image_px: radius,
            requested_space: "displayEncoded".to_string(),
        }
    }

    #[test]
    fn samples_known_display_encoded_patch_and_luma() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(3, 1, |x, _| match x {
            0 => image::Rgb([255, 0, 0]),
            1 => image::Rgb([0, 128, 0]),
            _ => image::Rgb([0, 0, 255]),
        }));
        let frame = CachedViewerSampleFrame {
            graph_revision: "history_3".to_string(),
            image: Arc::new(image),
            image_identity: "/fixture/color-patches.tif".to_string(),
            space_label: "Display encoded sRGB".to_string(),
        };

        let result = sample_viewer_frame(&fixture_request(0), &frame);
        let rgb = result["rgb"].as_array().expect("RGB tuple");
        assert!((rgb[1].as_f64().unwrap() - 128.0 / 255.0).abs() < 1e-6);
        assert!((result["luma"].as_f64().unwrap() - 0.7152 * 128.0 / 255.0).abs() < 1e-6);
        assert_eq!(result["spaceLabel"], "Display encoded sRGB");
        assert_eq!(
            result["imagePointPx"],
            serde_json::json!({ "x": 1, "y": 0 })
        );
    }

    #[test]
    fn radius_average_and_unsupported_domain_are_explicit() {
        let frame = CachedViewerSampleFrame {
            graph_revision: "history_3".to_string(),
            image: Arc::new(DynamicImage::ImageRgb8(ImageBuffer::from_fn(
                3,
                1,
                |x, _| image::Rgb(if x == 1 { [255, 255, 255] } else { [0, 0, 0] }),
            ))),
            image_identity: "/fixture/color-patches.tif".to_string(),
            space_label: "Display encoded sRGB".to_string(),
        };
        let averaged = sample_viewer_frame(&fixture_request(1), &frame);
        assert!((averaged["rgb"][0].as_f64().unwrap() - 1.0 / 3.0).abs() < 1e-6);

        let mut linear_request = fixture_request(0);
        linear_request.requested_space = "workingLinear".to_string();
        let unavailable = sample_viewer_frame(&linear_request, &frame);
        assert_eq!(unavailable["status"], "unavailable");
        assert_eq!(unavailable["reason"], "unsupportedSpace");
    }
}

#[tauri::command]
async fn preview_geometry_transform(
    params: GeometryParams,
    js_adjustments: serde_json::Value,
    show_lines: bool,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let (loaded_image_path, is_raw) = {
        let guard = state.original_image.lock().unwrap();
        let loaded = guard.as_ref().ok_or("No image loaded")?;
        (loaded.path.clone(), loaded.is_raw)
    };

    let visual_hash = calculate_visual_hash(&loaded_image_path, &js_adjustments);

    let base_image_to_warp = {
        let maybe_cached_image = state
            .geometry_cache
            .lock()
            .unwrap()
            .get(&visual_hash)
            .cloned();

        if let Some(cached_image) = maybe_cached_image {
            cached_image
        } else {
            let context = get_or_init_gpu_context(&state, &app_handle)?;

            let original_image = {
                let guard = state.original_image.lock().unwrap();
                let loaded = guard.as_ref().ok_or("No image loaded")?;
                loaded.image.clone()
            };

            let settings = load_settings_or_default(&app_handle);
            let interactive_divisor = 1.5;
            let final_preview_dim = settings.editor_preview_resolution.unwrap_or(1920);
            let target_dim = (final_preview_dim as f32 / interactive_divisor) as u32;

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
            let all_adjustments =
                get_all_adjustments_from_json(&temp_adjustments, is_raw, tm_override);
            let lut_path = temp_adjustments["lutPath"].as_str();
            let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
            let mask_bitmaps = Vec::new();

            let processed_base = process_and_get_dynamic_image(
                &context,
                &state,
                &preview_base,
                visual_hash,
                RenderRequest {
                    adjustments: all_adjustments,
                    mask_bitmaps: &mask_bitmaps,
                    lut,
                    roi: None,
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
    let unique_hash = calculate_full_job_hash(&loaded_image.path, &js_adjustments);

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
    let all_adjustments =
        get_all_adjustments_from_json(render_adjustments.as_ref(), is_raw, tm_override);
    let lut_path = render_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
    let render_hash = calculate_full_job_hash(&loaded_image.path, render_adjustments.as_ref())
        .wrapping_add(unique_hash);

    let processed_image = process_and_get_dynamic_image(
        &context,
        &state,
        &preview_image,
        render_hash,
        RenderRequest {
            adjustments: all_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut,
            roi: None,
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

    let mut base_thumbnails: Vec<(DynamicImage, bool, f32)> = Vec::new();
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

        base_thumbnails.push((base_image, is_raw, base_scale));
    }

    for preset in presets.iter() {
        let mut processed_tiles: Vec<RgbImage> = Vec::new();
        let js_adjustments = &preset.adjustments;

        let mut preset_hasher = DefaultHasher::new();
        preset.name.hash(&mut preset_hasher);
        let preset_hash = preset_hasher.finish();

        for (i, (base_image, is_raw, base_scale)) in base_thumbnails.iter().enumerate() {
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
            let all_adjustments =
                get_all_adjustments_from_json(render_adjustments.as_ref(), *is_raw, tm_override);
            let lut_path = render_adjustments["lutPath"].as_str();
            let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());

            let unique_hash = calculate_full_job_hash(&preset.name, render_adjustments.as_ref())
                .wrapping_add(preset_hash)
                .wrapping_add(i as u64);

            let processed_image_dynamic = crate::image_processing::process_and_get_dynamic_image(
                &context,
                &state,
                transformed_image.as_ref(),
                unique_hash,
                RenderRequest {
                    adjustments: all_adjustments,
                    mask_bitmaps: &mask_bitmaps,
                    lut,
                    roi: None,
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
    if tracker.load(Ordering::SeqCst) != generation {
        return Err("focus_stack_plan_cancelled:plan_publication".to_string());
    }
    if plan.accepted {
        *state.focus_stack_runtime_plan.lock().unwrap() = Some((
            plan.accepted_dry_run_plan_id.clone(),
            plan.accepted_dry_run_plan_hash.clone(),
        ));
    }
    Ok(plan)
}

#[tauri::command]
async fn cancel_focus_stack_plan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .focus_stack_plan_generation
        .fetch_add(1, Ordering::SeqCst);
    *state.focus_stack_runtime_plan.lock().unwrap() = None;
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
    let accepted_plan = state
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

    let images: Vec<HDRInput> = loaded_items
        .iter()
        .map(|(path, _content_hash, img, exposure, gains)| {
            HDRInput::with_image(img, *exposure, *gains)
                .map_err(|e| format!("Failed to prepare HDR input for {}: {}", path, e))
        })
        .collect::<Result<Vec<HDRInput>, String>>()?;

    log::info!("Starting HDR merge of {} images", images.len());
    let hdr_merged = hdr_merge_images(&mut images.into()).map_err(|e| e.to_string())?;
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

    let final_base64 = encode_png_data_url(&DynamicImage::ImageRgb8(hdr_merged.to_rgb8()))?;
    let output_content_hash = hash_hdr_apply_output(&hdr_merged);
    let current_hashes = source_refs
        .iter()
        .map(|source| source.content_hash.clone())
        .collect::<Vec<_>>();
    if current_hashes != accepted_plan.source_content_hashes {
        return Err("hdr_apply_stale_source_content".to_string());
    }
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

fn hash_hdr_apply_output(hdr_image: &DynamicImage) -> String {
    let rgba = hdr_image.to_rgba32f();
    let bytes = rgba
        .as_raw()
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect::<Vec<_>>();
    format!("blake3:{}", blake3::hash(&bytes).to_hex())
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
    let runtime_plan = state
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
    DynamicImage::ImageRgb8(hdr_image.to_rgb8())
        .write_to(&mut preview, image::ImageFormat::Png)
        .map_err(|error| format!("hdr_preview_encode_failed:{error}"))?;
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
        map_paths: vec!["maps/accepted-artifacts.json".to_string()],
        source_immutability_hashes: runtime_plan.source_content_hashes.clone(),
    };
    let mut transaction =
        AtomicDerivedOutputTransaction::begin(parent_dir, &format!("{stem}_Hdr.rrhdr"))?;
    transaction.write_file(&payload_name, payload.get_ref())?;
    transaction.write_file("preview.png", preview.get_ref())?;
    transaction.write_file("maps/accepted-artifacts.json", &map_lineage)?;
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
    let all_adjustments =
        get_all_adjustments_from_json(render_adjustments.as_ref(), is_raw, tm_override);
    let lut_path = render_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
    let unique_hash = calculate_full_job_hash(&source_path_str, render_adjustments.as_ref());
    let detail_stage = render_pipeline::apply_pre_gpu_detail_stages(
        transformed_image.as_ref(),
        unique_hash,
        render_adjustments.as_ref(),
    );
    let final_image = process_and_get_dynamic_image(
        &context,
        &state,
        detail_stage.image.as_ref(),
        unique_hash,
        RenderRequest {
            adjustments: all_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut,
            roi: None,
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
    let lut = lut_processing::parse_lut_file(&path).map_err(|e| e.to_string())?;
    let lut_size = lut.size;

    let mut cache = state.lut_cache.lock().unwrap();
    cache.insert(path, Arc::new(lut));

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

#[tauri::command]
fn frontend_ready(
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

        if let Err(e) = window.show() {
            log::error!("Failed to show window: {}", e);
        }
        if let Err(e) = window.set_focus() {
            log::error!("Failed to focus window: {}", e);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(PinchZoomDisablePlugin)
        .on_window_event(|window, event| if let tauri::WindowEvent::Resized(size) = event {
            let state = window.state::<AppState>();
            if let Some(ctx) = state.gpu_context.lock().unwrap().as_ref()
                && let Ok(mut display_lock) = ctx.display.try_lock()
                    && let Some(display) = display_lock.as_mut() {
                        display.config.width = size.width.max(1);
                        display.config.height = size.height.max(1);
                        display.surface.configure(&ctx.device, &display.config);
                        display.render(&ctx.device, &ctx.queue);
                    }
        } else if let tauri::WindowEvent::Moved(_) = event {
            #[cfg(target_os = "macos")]
            {
                let state = window.state::<AppState>();
                // Recreate presentation resources so a cross-display move cannot retain the old ICC LUT.
                *state.gpu_context.lock().unwrap() = None;
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
            let config_dir = app_handle.path().app_config_dir().expect("Failed to get config dir");
            let crash_flag_path = config_dir.join(".gpu_init_crash_flag");

            {
                let state = app.state::<AppState>();
                *state.gpu_crash_flag_path.lock().unwrap() = Some(crash_flag_path.clone());
            }

            let mut settings: AppSettings = load_settings_or_default(&app_handle);

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

            let lens_db = lens_correction::load_lensfun_db(&app_handle);
            let state = app.state::<AppState>();
            *state.lens_db.lock().unwrap() = Some(Arc::new(lens_db));

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

            preview_worker::start_preview_worker(app_handle.clone());
            start_analytics_worker(app_handle.clone());
            file_management::start_thumbnail_workers(app_handle);
            jxl_oxide::integration::register_image_decoding_hook();

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

            #[cfg(target_os = "android")]
            android_integration::initialize_android(&window);

            #[cfg(not(target_os = "android"))]
            {
                let app_state = app.state::<AppState>();
                if let Err(error) = get_or_init_gpu_context(&app_state, app.handle()) {
                    log::warn!(
                        "GPU pre-initialization failed (editing and thumbnails may be degraded): {}",
                        error
                    );
                }

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
            Ok(())
        })
        .manage(AppState::new())
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
            save_hdr,
            load_and_parse_lut,
            fetch_community_presets,
            generate_all_community_previews,
            save_temp_file,
            get_image_dimensions,
            is_original_file_available,
            frontend_ready,
            cancel_thumbnail_generation,
            update_wgpu_transform,
            android_integration::resolve_android_content_uri_name,
            cache_utils::clear_session_caches,
            cache_utils::clear_image_caches,
            app_settings::load_settings,
            app_settings::save_settings,
            ai::ai_commands::generate_ai_subject_mask,
            ai::ai_commands::generate_ai_object_mask_proposal,
            ai::ai_commands::precompute_ai_subject_mask,
            ai::ai_commands::generate_ai_foreground_mask,
            ai::ai_commands::generate_ai_sky_mask,
            ai::ai_commands::generate_ai_depth_mask,
            ai::ai_commands::generate_ai_whole_person_mask,
            ai::ai_commands::generate_ai_person_part_mask,
            ai::ai_commands::check_ai_connector_status,
            ai::ai_commands::test_ai_connector_connection,
            ai::ai_commands::invoke_generative_replace_with_mask_def,
            denoise_api::dry_run_denoise_controls,
            denoising::apply_denoising,
            denoising::batch_denoise_images,
            denoising::save_denoised_image,
            display_profile::get_active_display_profile,
            display_profile::get_display_preview_lut_status,
            image_loader::compare_raw_reconstruction_modes,
            image_loader::load_image,
            image_loader::is_image_cached,
            plan_hdr,
            super_resolution::plan_super_resolution,
            super_resolution::cancel_super_resolution_registration,
            merge::computational_job::cancel_computational_merge_job,
            panorama_stitching::plan_panorama,
            panorama_stitching::cancel_panorama_alignment,
            panorama_stitching::stitch_panorama,
            panorama_stitching::save_panorama,
            export::export_processing::get_export_color_capabilities,
            export::export_processing::export_images,
            export::export_processing::cancel_export,
            export::export_processing::estimate_export_sizes,
            auto_adjust::calculate_auto_adjustments,
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
