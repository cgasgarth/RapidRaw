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
mod editor;
mod events;
mod export;
mod geometry;
mod gpu;
mod io;
mod layers;
mod library;
mod merge;
mod negative_lab_profiles;
mod preset_converter;
mod presets;
mod proofs;
#[cfg(all(feature = "validation-harness", unix))]
mod qa_control;
mod raw;
mod render;
mod tagging;
pub mod tone;
#[cfg(test)]
mod validation;
mod window_customizer;

pub(crate) use color::*;
pub use community_presets::CommunityPreset;
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

use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::panic;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma, RgbImage, Rgba};
use imageproc::drawing::draw_line_segment_mut;
use imageproc::edges::canny;
use imageproc::hough::{LineDetectionOptions, detect_lines};
use rapidraw_codecs::JpegPreset;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager, ipc::Response};

#[cfg(feature = "ai")]
use crate::ai::ai_commands as build_ai_commands;
#[cfg(not(feature = "ai"))]
use crate::app::disabled_commands as build_ai_commands;
use crate::hdr_artifact_sidecar::write_hdr_output_sidecar;
use crate::image_codecs::{encode_jpeg_data_url, encode_jpeg_response, encode_png_data_url};
use crate::merge::atomic_derived_output::{AtomicDerivedOutputTransaction, DerivedOutputManifest};
use crate::merge::hdr::ALIGNMENT_POLICY_ID;
use crate::merge::hdr::planning_service::{HdrSavePayload, PendingHdrSourceRef};

use crate::app::startup::NativeStartupPhase;
use crate::cache_utils::{
    calculate_geometry_hash, calculate_transform_hash, calculate_visual_hash,
};
use crate::editor::preview_geometry::{
    PreviewGeometryQuality, PreviewGeometryTarget, preview_geometry_transform,
};
use crate::editor::viewer_sampling_service::{
    CachedViewerSampleFrame, SampleablePixels, ViewerSampleCacheSlot,
};
use crate::exif_processing::{read_exposure_time_secs, read_iso};
use crate::file_management::parse_virtual_path;
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::formats::is_raw_file;
use crate::image_loader::{composite_patches_on_image, load_base_image_from_bytes};
use crate::image_processing::{
    Crop, GeometryParams, RenderRequest, apply_coarse_rotation, apply_flip, apply_srgb_to_linear,
    downscale_f32_image, get_or_init_gpu_context, process_and_get_dynamic_image,
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

pub(crate) use editor::preview_geometry_service::generate_transformed_preview_cancellable;
pub use editor::preview_geometry_service::{
    PreviewGeometryPipeline, PreviewGeometryReceipt, PreviewGeometryRequest, PreviewGeometryResult,
    PreviewGeometryService, generate_transformed_preview,
};

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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyAdjustmentsRequest {
    edit_document_v2: adjustments::edit_document_v2::EditDocumentV2,
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
    let render_adjustments = request.edit_document_v2.into_render_adjustments()?;

    let job = PreviewJob {
        adjustments: Arc::new(render_adjustments),
        expected_image_path: request.expected_image_path,
        is_interactive: request.is_interactive,
        target_resolution: request.target_resolution,
        roi: request.roi,
        compute_waveform: request.compute_waveform,
        active_waveform_channel: request.active_waveform_channel,
        viewer_sample_graph_revision: request.viewer_sample_graph_revision,
        responder: tx,
    };
    state
        .services
        .preview_runtime
        .submit(job)
        .map_err(|_| "preview_worker_stopped".to_string())?;

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
    let source_color_state = if loaded_image.is_raw {
        color::working_to_output_transform::WorkingColorState::AcesCgLinearV1
    } else {
        color::working_to_output_transform::WorkingColorState::EncodedSrgbV1
    };
    let shared_gamut_warning = if source_color_state
        == color::working_to_output_transform::WorkingColorState::AcesCgLinearV1
    {
        Some(
            color::working_to_output_transform::analyze_acescg_image_gamut_warning_with_mask(
                &preview_image,
                &request.color_profile,
                &request.rendering_intent,
            )?,
        )
    } else {
        None
    };
    let (proof_pixels, width, height, _) =
        export::export_processing::export_soft_proof_rgb_pixels_with_working_color_state(
            &preview_image,
            source_color_state,
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
            pixels: SampleablePixels::native(Arc::new(DynamicImage::ImageRgb8(proof_image))),
            image_identity: loaded_image.path.clone(),
            space_label: format!("Soft proof · {}", proof_metadata.effective_color_profile),
        };
        state
            .services
            .viewer_sampling
            .publish(ViewerSampleCacheSlot::SoftProof, frame);
    }

    let proof_image =
        RgbImage::from_raw(width, height, proof_pixels.clone()).map(DynamicImage::ImageRgb8);

    if let Some(recipe_id) = request.export_soft_proof_recipe_id
        && let Some(proof_image) = proof_image.as_ref()
        && let Ok(gamut_warning_data) =
            image_analytics::calculate_gamut_warning_overlay_from_image(proof_image)
    {
        let shared_warning_mask_data_url = shared_gamut_warning
            .as_ref()
            .map(|analysis| {
                image_analytics::encode_gamut_warning_mask_data_url(
                    &analysis.mask_rgba,
                    analysis.width,
                    analysis.height,
                )
            })
            .transpose()?;
        let shared_gamut_warning = shared_gamut_warning
            .as_ref()
            .map(|analysis| &analysis.receipt);
        let source_image_path = &loaded_image.path;
        let _ = app_handle.emit(
            crate::events::GAMUT_WARNING_UPDATE,
            serde_json::json!({
                "path": source_image_path,
                "data": {
                    "black_point_compensation": proof_metadata.black_point_compensation,
                    "color_managed_transform": proof_metadata.color_managed_transform,
                    "coverage_ratio": shared_gamut_warning.as_ref().map_or(
                        gamut_warning_data.coverage_ratio,
                        |receipt| (receipt.out_of_gamut_pixel_percentage / 100.0) as f32,
                    ),
                    "effective_color_profile": proof_metadata.effective_color_profile,
                    "effective_rendering_intent": proof_metadata.effective_rendering_intent,
                    "export_soft_proof_recipe_id": recipe_id,
                    "height": shared_gamut_warning.map_or(gamut_warning_data.height, |_| height),
                    "mask_data_url": shared_warning_mask_data_url.unwrap_or(gamut_warning_data.mask_data_url),
                    "max_channel_value": gamut_warning_data.max_channel_value,
                    "min_channel_value": gamut_warning_data.min_channel_value,
                    "pixel_count": shared_gamut_warning.map_or(
                        gamut_warning_data.pixel_count,
                        |receipt| receipt.pixel_count,
                    ),
                    "gamut_mapping_implementation": shared_gamut_warning.as_ref().map(
                        |receipt| receipt.implementation_id.clone(),
                    ),
                    "gamut_mapping_version": shared_gamut_warning.as_ref().map(
                        |receipt| receipt.implementation_version,
                    ),
                    "gamut_target": shared_gamut_warning.as_ref().map(
                        |receipt| receipt.target.clone(),
                    ),
                    "gamut_boundary_fingerprint": shared_gamut_warning.as_ref().map(
                        |receipt| receipt.boundary_fingerprint.clone(),
                    ),
                    "gamut_warning_plan_fingerprint": shared_gamut_warning.as_ref().map(
                        |receipt| receipt.plan_fingerprint.clone(),
                    ),
                    "maximum_boundary_excess": shared_gamut_warning.as_ref().map(
                        |receipt| receipt.maximum_boundary_excess,
                    ),
                    "gamut_compressed_pixel_count": shared_gamut_warning.as_ref().map(
                        |receipt| receipt.compressed_pixel_count,
                    ),
                    "gamut_hard_clipped_pixel_count": shared_gamut_warning.as_ref().map(
                        |receipt| receipt.hard_clipped_pixel_count,
                    ),
                    "policy_status": proof_metadata.policy_status,
                    "policy_version": proof_metadata.policy_version,
                    "preview_basis": "export_preview",
                    "source_image_path": source_image_path,
                    "source_precision_path": proof_metadata.source_precision_path,
                    "transform_applied": proof_metadata.transform_applied,
                    "transform_policy_fingerprint": proof_metadata.transform_policy_fingerprint,
                    "warning_pixel_count": shared_gamut_warning.as_ref().map_or(
                        gamut_warning_data.warning_pixel_count,
                        |receipt| receipt.out_of_gamut_pixel_count,
                    ),
                    "width": shared_gamut_warning.map_or(gamut_warning_data.width, |_| width),
                }
            }),
        );
    }

    if let Some(proof_image) = proof_image {
        let _ = state.services.analytics.submit(AnalyticsJob {
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

// Transitional helper retained for existing native tests while the command now
// lives in `editor::preview_geometry`; follow-up cleanup removes this duplicate.
#[allow(dead_code)]
async fn legacy_preview_geometry_transform(
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

fn build_hdr_source_refs(loaded_items: &[LoadedHdrMergeItem]) -> Vec<PendingHdrSourceRef> {
    loaded_items
        .iter()
        .enumerate()
        .map(
            |(source_index, (path, content_hash, img, exposure, iso))| PendingHdrSourceRef {
                content_hash: content_hash.clone(),
                image_path: parse_virtual_path(path).0.to_string_lossy().into_owned(),
                width: img.width(),
                height: img.height(),
                exposure_time_seconds: exposure.as_secs_f32(),
                iso: *iso,
                source_index,
            },
        )
        .collect::<Vec<_>>()
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
    let accepted = state.services.hdr.accepted_plan().map_err(str::to_string)?;
    let mut accepted_plan = accepted.plan.clone();
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

    state
        .services
        .hdr
        .publish_merge(&accepted, runtime_plan, source_refs, hdr_merged)
        .map_err(str::to_string)?;
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

fn build_hdr_apply_source_roles(source_refs: &[PendingHdrSourceRef]) -> Vec<HdrApplySourceRole> {
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
    let HdrSavePayload {
        lease,
        image: hdr_image,
        plan: mut runtime_plan,
        source_refs,
    } = state
        .services
        .hdr
        .acquire_save_payload()
        .map_err(str::to_string)?;

    let (first_path, _) = parse_virtual_path(&first_path_str);
    let parent_dir = first_path
        .parent()
        .ok_or_else(|| "Could not determine parent directory of the first image.".to_string())?;
    let stem = first_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("hdr");

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
    let receipt = transaction.commit_guarded(
        &manifest,
        || lease.authorize_publication(),
        |package| {
            if package.join(&payload_name).is_file() {
                Ok(())
            } else {
                Err("hdr_registration_payload_missing".to_string())
            }
        },
    )?;
    let output_path = PathBuf::from(&receipt.final_package_path).join(&payload_name);
    write_hdr_output_sidecar(
        &output_path,
        &source_refs,
        &runtime_plan,
        hdr_image.width(),
        hdr_image.height(),
    )?;
    let _ = lease.complete();

    let (real_path, _) = crate::file_management::parse_virtual_path(&first_path_str);
    let _ =
        crate::exif_processing::write_rrexif_sidecar(&real_path.to_string_lossy(), &output_path);

    Ok(output_path.to_string_lossy().to_string())
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
                crate::app::commands::startup::publish_file_open(app, argv[1].clone());
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
                    log::info!("Windows/Linux initial open: Storing path {} for later.", &arg);
                    crate::app::commands::startup::publish_file_open(app.handle(), arg);
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
                state
                    .services
                    .gpu_crash_marker
                    .configure(crash_flag_path.clone());
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
                let state = app.state::<AppState>();
                state.services.analytics.start_worker(app.handle().clone());
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
            app::commands::path_preview::generate_preview_for_path,
            app::commands::negative_lab_dust::analyze_negative_lab_dust_spots,
            app::commands::original_preview::generate_original_transformed_preview,
            app::commands::viewer_sampling::sample_viewer_pixel,
            generate_preset_preview,
            app::commands::uncropped_preview::generate_uncropped_preview,
            preview_geometry_transform,
            app::commands::logging::get_log_file_path,
            app::commands::logging::frontend_log,
            app::commands::collage::save_collage,
            merge_hdr,
            merge::hdr::commands::cancel_hdr_plan,
            merge::focus_stack::commands::plan_focus_stack,
            merge::focus_stack::commands::cancel_focus_stack_plan,
            merge::focus_stack::job::prepare_focus_stack_candidate,
            merge::focus_stack::job::read_focus_stack_job,
            merge::focus_stack::apply::apply_focus_stack_candidate,
            merge::focus_stack::retouch::apply_focus_stack_retouch,
            merge::focus_stack::retouch::open_focus_stack_retouch,
            merge::focus_stack::retouch::navigate_focus_stack_retouch,
            save_hdr,
            app::commands::lut::load_and_parse_lut,
            app::commands::community_presets::fetch_community_presets,
            generate_all_community_previews,
            app::commands::temporary_artifacts::save_temp_file,
            app::commands::source::get_image_dimensions,
            app::commands::perspective::analyze_perspective_correction,
            app::commands::source::is_original_file_available,
            app::commands::source::resolve_original_source_identity,
            app::commands::startup::frontend_ready,
            app::commands::startup::get_startup_trace,
            app::commands::startup::record_frontend_startup_phase,
            library::changefeed::configure_library_changefeed,
            library::changefeed::get_library_changefeed_report,
            library::file_management::get_library_change_rows,
            library::catalog::open_library_collection,
            library::catalog::next_library_collection_page,
            library::catalog::reconcile_library_catalog,
            library::catalog::apply_library_catalog_changes,
            library::catalog::get_library_catalog_report,
            library::catalog::get_library_folder_aggregates,
            app::commands::thumbnail::cancel_thumbnail_generation,
            app::commands::wgpu_presentation::update_wgpu_transform,
            app::commands::wgpu_presentation::flush_wgpu_presentation,
            app::commands::wgpu_presentation::get_wgpu_presentation_report,
            editor::picker_commands::analyze_tone_equalizer_placement,
            editor::picker_commands::sample_tone_equalizer_picker,
            editor::picker_commands::sample_point_color_picker,
            app::display_target::get_display_target_report,
            app::commands::wgpu_presentation::get_gpu_pipeline_report,
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
            denoising::execute_denoising,
            denoising::cancel_denoising,
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
            color::calibration::list_supported_chart_definitions,
            color::calibration::validate_chart_capture_geometry,
            image_loader::compare_raw_reconstruction_modes,
            image_loader::load_image,
            image_open_session::begin_image_open,
            image_open_session::schedule_image_prefetch,
            image_open_session::get_image_open_diagnostics,
            image_loader::is_image_cached,
            merge::hdr::commands::plan_hdr,
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
            export::export_processing::get_hdr_export_capabilities,
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
            file_management::commit_batch_auto_adjustment,
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
            file_management::get_active_import_job_status,
            file_management::get_import_job_receipt,
            file_management::validate_import_job_resume,
            file_management::resume_import_job,
            file_management::create_virtual_copy,
            album_management::get_albums,
            album_management::save_albums,
            album_management::add_to_album,
            file_management::get_album_images,
            tagging::indexing::start_background_indexing,
            tagging::indexing::cancel_background_indexing,
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
            negative_conversion::preflight_negative_lab_source,
            negative_conversion::fit_negative_lab_measured_profile,
            negative_conversion::lock_negative_lab_roll_bounds,
            negative_conversion::render_negative_lab_dry_run_preview_artifact,
            negative_conversion::estimate_negative_base_fog,
            negative_conversion::suggest_negative_lab_neutral_patch_rgb_balance,
            negative_conversion::suggest_negative_lab_highlight_patch_exposure,
            negative_conversion::suggest_negative_lab_shadow_patch_black_point,
            negative_conversion::convert_negatives,
            negative_lab_profiles::read_negative_lab_measured_profile_library,
            negative_lab_profiles::write_negative_lab_measured_profile_library,
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
                        crate::app::commands::startup::publish_file_open(
                            app_handle,
                            path_str.to_string(),
                        );
                        log::info!("macOS file open: Published path {}.", path_str);
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
