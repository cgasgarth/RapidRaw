use std::borrow::Cow;
use std::sync::Arc;
use std::thread;

use image::{DynamicImage, GenericImageView, ImageBuffer, Luma, RgbaImage};
use tauri::{Emitter, Manager};

use crate::adjustment_utils::hydrate_adjustments;
use crate::app_settings::load_preview_runtime_settings_or_default;
use crate::app_state::{
    AnalyticsConfig, AnalyticsFrameId, AnalyticsProducts, AppState, CachedPreview,
    CachedViewerSampleFrame,
};
use crate::generate_transformed_preview;
use crate::image_processing::{
    RenderRequest, downscale_f32_image, get_or_init_gpu_context,
    process_and_get_dynamic_image_with_analytics, resolve_tonemapper_override_from_handle,
};
use crate::mask_generation::get_cached_or_generate_mask;
use crate::preview_scheduler::{
    PreviewAbort, PreviewCancellation, PreviewCompletion, PreviewScheduler,
    PreviewSchedulingPolicy, PreviewStage,
};
use crate::render_plan::{
    CompileRenderPlanContext, RenderPlanRevision, compile_render_plan_cached, content_revision,
};
use crate::{get_or_load_lut, render_caches, render_pipeline};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NativePreviewPresentationReason {
    Enabled,
    DisabledBySetting,
    UnsupportedPlatform,
    DisplayUnavailable,
    RequestRequiresCpuPixels,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct NativePreviewPresentationDecision {
    enabled: bool,
    reason: NativePreviewPresentationReason,
}

fn native_preview_presentation_decision(
    setting_enabled: bool,
    display_available: bool,
    has_roi: bool,
) -> NativePreviewPresentationDecision {
    let reason = if !setting_enabled {
        NativePreviewPresentationReason::DisabledBySetting
    } else if cfg!(any(target_os = "android", target_os = "linux")) {
        NativePreviewPresentationReason::UnsupportedPlatform
    } else if has_roi {
        NativePreviewPresentationReason::RequestRequiresCpuPixels
    } else if !display_available {
        NativePreviewPresentationReason::DisplayUnavailable
    } else {
        NativePreviewPresentationReason::Enabled
    };
    NativePreviewPresentationDecision {
        enabled: reason == NativePreviewPresentationReason::Enabled,
        reason,
    }
}

pub(crate) struct PreviewJobConfig<'a> {
    pub(crate) app_handle: &'a tauri::AppHandle,
    pub(crate) state: tauri::State<'a, AppState>,
    pub(crate) adjustments_json: serde_json::Value,
    pub(crate) expected_image_path: &'a str,
    pub(crate) is_interactive: bool,
    pub(crate) target_resolution: Option<u32>,
    pub(crate) roi: Option<(f32, f32, f32, f32)>,
    pub(crate) compute_waveform: bool,
    pub(crate) active_waveform_channel: Option<&'a str>,
    pub(crate) viewer_sample_graph_revision: Option<&'a str>,
    pub(crate) cancellation: Option<&'a PreviewCancellation>,
    pub(crate) preview_id: crate::preview_scheduler::PreviewRequestId,
}

fn cancellation_checkpoint(
    cancellation: Option<&PreviewCancellation>,
    stage: PreviewStage,
) -> Result<(), String> {
    cancellation
        .map(|handle| handle.check(stage).map_err(format_preview_abort))
        .unwrap_or(Ok(()))
}

fn format_preview_abort(abort: PreviewAbort) -> String {
    match abort {
        PreviewAbort::Superseded {
            by_generation,
            stage,
        } => {
            format!("preview_superseded:{by_generation}:{stage:?}")
        }
        PreviewAbort::Cancelled { stage } => format!("preview_cancelled:{stage:?}"),
    }
}

fn abort_stage(message: &str) -> PreviewStage {
    [
        PreviewStage::Source,
        PreviewStage::Geometry,
        PreviewStage::Masks,
        PreviewStage::CpuDetail,
        PreviewStage::Gpu,
        PreviewStage::Readback,
        PreviewStage::Encode,
        PreviewStage::Publish,
    ]
    .into_iter()
    .find(|stage| message.ends_with(&format!("{stage:?}")))
    .unwrap_or(PreviewStage::Queued)
}

fn hash_revision(revision: &str) -> u64 {
    let bytes = blake3::hash(revision.as_bytes());
    u64::from_le_bytes(bytes.as_bytes()[..8].try_into().unwrap())
}

fn requested_products(compute_scopes: bool, active: Option<&str>) -> AnalyticsProducts {
    let mut products = AnalyticsProducts::HISTOGRAM | AnalyticsProducts::GAMUT_MASK;
    if !compute_scopes {
        return products;
    }
    products |= match active {
        Some("parade") => AnalyticsProducts::PARADE,
        Some("vectorscope") => AnalyticsProducts::VECTORSCOPE,
        Some("luma") | Some("rgb") => AnalyticsProducts::WAVEFORM,
        _ => {
            AnalyticsProducts::WAVEFORM | AnalyticsProducts::PARADE | AnalyticsProducts::VECTORSCOPE
        }
    };
    products
}

pub(crate) fn process_preview_job(config: PreviewJobConfig<'_>) -> Result<Vec<u8>, String> {
    let PreviewJobConfig {
        app_handle,
        state,
        mut adjustments_json,
        expected_image_path,
        is_interactive,
        target_resolution,
        roi,
        compute_waveform,
        active_waveform_channel,
        viewer_sample_graph_revision,
        cancellation,
        preview_id,
    } = config;

    let fn_start = std::time::Instant::now();
    cancellation_checkpoint(cancellation, PreviewStage::Source)?;
    let context = get_or_init_gpu_context(&state, app_handle)?;
    hydrate_adjustments(&state, &mut adjustments_json);
    cancellation_checkpoint(cancellation, PreviewStage::Source)?;

    let loaded_image_guard = state.original_image.lock().unwrap();
    let loaded_image = loaded_image_guard
        .as_ref()
        .ok_or("No original image loaded")?
        .clone();
    drop(loaded_image_guard);
    crate::validate_expected_preview_image(&loaded_image.path, expected_image_path)?;
    if let Some(plan) =
        crate::layers::apply_authoritative_layer_stack(&mut adjustments_json, expected_image_path)?
    {
        log::debug!(
            "native layer preview plan revision={} layer={:?} hash={}",
            plan.graph_revision,
            plan.layer_id,
            plan.plan_hash
        );
    }
    cancellation_checkpoint(cancellation, PreviewStage::Geometry)?;
    let adjustments_clone = adjustments_json;

    let settings = load_preview_runtime_settings_or_default(app_handle);
    let is_raw = loaded_image.is_raw;
    let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
    let lut = adjustments_clone["lutPath"]
        .as_str()
        .and_then(|path| get_or_load_lut(&state, path).ok());
    let settings_revision = u64::from(tm_override.unwrap_or(0));
    let revision = viewer_sample_graph_revision.map_or_else(
        || {
            content_revision(
                &adjustments_clone,
                preview_id.image_session,
                loaded_image.artifact_source.source_fingerprint(),
                settings_revision,
            )
        },
        |graph_revision| RenderPlanRevision {
            image_session: preview_id.image_session,
            source_revision: loaded_image.artifact_source.source_fingerprint(),
            adjustment_revision: hash_revision(graph_revision),
            schema_version: 1,
            settings_revision,
        },
    );
    let render_plan = compile_render_plan_cached(
        &adjustments_clone,
        CompileRenderPlanContext {
            revision,
            is_raw,
            tonemapper_override: tm_override,
        },
        lut,
    )
    .map_err(|error| error.to_string())?;
    log::debug!(
        "render_plan revision={:?} compile_us={} geometry_scale={} effective_fields={} fingerprints={:?}",
        render_plan.revision,
        render_plan.compile_time.as_micros(),
        render_plan.geometry.scale,
        render_plan
            .effective_json
            .as_object()
            .map_or(0, serde_json::Map::len),
        render_plan.fingerprints,
    );
    let new_transform_hash = render_plan.fingerprints.full;
    let live_quality = settings.live_preview_quality.as_str();

    let default_preview_dim = settings.editor_preview_resolution;
    let preview_dim = target_resolution.unwrap_or(default_preview_dim);
    let has_roi = roi.is_some();
    let native_presentation = native_preview_presentation_decision(
        settings.use_wgpu_renderer,
        context.presentation.is_available(),
        has_roi,
    );
    let use_wgpu_renderer = native_presentation.enabled;
    let (interactive_divisor, interactive_quality) = match live_quality {
        "full" => (1.0_f32, 85_u8),
        "performance" => (if has_roi { 1.8_f32 } else { 1.5_f32 }, 65_u8),
        _ => (if has_roi { 1.4_f32 } else { 1.0_f32 }, 75_u8),
    };
    let mut preview_identity =
        crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
            &loaded_image.artifact_source,
            preview_id.image_session,
            render_plan.revision.adjustment_revision,
            render_plan.fingerprints.source,
            render_plan.fingerprints.geometry,
            preview_dim,
            preview_dim,
        );
    preview_identity.plan_revision = render_plan.fingerprints.full;
    preview_identity.retouch_stage = render_plan.fingerprints.retouch;
    preview_identity.completed_stage = "geometry-retouch-base";

    let cached_preview = state.cached_preview.lock().unwrap().clone();

    let base_valid = cached_preview
        .as_ref()
        .is_some_and(|c| c.identity == preview_identity && c.preview_dim == preview_dim);
    let small_valid = base_valid
        && cached_preview
            .as_ref()
            .is_some_and(|c| c.interactive_divisor == interactive_divisor);

    let (final_preview_base, scale_for_gpu, unscaled_crop_offset) = if base_valid {
        let cached = cached_preview.as_ref().unwrap();
        (
            Arc::clone(&cached.image),
            cached.scale,
            cached.unscaled_crop_offset,
        )
    } else {
        render_caches::RenderCaches::new(&state).clear_gpu_image_cache();
        let (base, scale, offset) =
            generate_transformed_preview(&state, &loaded_image, &adjustments_clone, preview_dim)?;
        (Arc::new(base), scale, offset)
    };
    cancellation_checkpoint(cancellation, PreviewStage::Geometry)?;

    let small_preview_base = if small_valid {
        Arc::clone(&cached_preview.as_ref().unwrap().small_image)
    } else {
        let small = if interactive_divisor > 1.0 {
            let target_size = (preview_dim as f32 / interactive_divisor) as u32;
            let (w, h) = final_preview_base.dimensions();
            let (small_w, small_h) = if w > h {
                let ratio = h as f32 / w as f32;
                (target_size, (target_size as f32 * ratio) as u32)
            } else {
                let ratio = w as f32 / h as f32;
                ((target_size as f32 * ratio) as u32, target_size)
            };
            Arc::new(downscale_f32_image(&final_preview_base, small_w, small_h))
        } else {
            Arc::clone(&final_preview_base)
        };

        if is_interactive && base_valid {
            render_caches::RenderCaches::new(&state).clear_gpu_image_cache();
        }

        small
    };

    let (processing_image, effective_scale, jpeg_quality) = if is_interactive {
        let orig_w = final_preview_base.width() as f32;
        let small_w = small_preview_base.width() as f32;
        let scale_factor = if orig_w > 0.0 { small_w / orig_w } else { 1.0 };
        let new_scale = scale_for_gpu * scale_factor;
        (
            Arc::clone(&small_preview_base),
            new_scale,
            interactive_quality,
        )
    } else {
        (Arc::clone(&final_preview_base), scale_for_gpu, 94)
    };

    let pre_gpu_detail_stage = render_pipeline::apply_pre_gpu_detail_stages(
        processing_image.as_ref(),
        new_transform_hash,
        &adjustments_clone,
    );
    cancellation_checkpoint(cancellation, PreviewStage::CpuDetail)?;
    let processing_image_ref = pre_gpu_detail_stage.image.as_ref();

    let (preview_width, preview_height) = processing_image_ref.dimensions();
    let pixel_roi = if is_interactive {
        roi.map(|(nx, ny, nw, nh)| crate::gpu_processing::Roi {
            x: (nx * preview_width as f32).round() as u32,
            y: (ny * preview_height as f32).round() as u32,
            width: (nw * preview_width as f32).round() as u32,
            height: (nh * preview_height as f32).round() as u32,
        })
    } else {
        None
    };

    let scaled_crop_offset = (
        unscaled_crop_offset.0 * effective_scale,
        unscaled_crop_offset.1 * effective_scale,
    );

    let mut mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> =
        Vec::with_capacity(render_plan.masks.len());
    for def in render_plan.masks.iter() {
        cancellation_checkpoint(cancellation, PreviewStage::Masks)?;
        if let Some(mask) = get_cached_or_generate_mask(
            &state,
            def,
            preview_width,
            preview_height,
            effective_scale,
            scaled_crop_offset,
            &adjustments_clone,
        ) {
            mask_bitmaps.push(mask);
        }
    }

    cancellation_checkpoint(cancellation, PreviewStage::CpuDetail)?;
    let retouched_processing_image = crate::retouch_render::apply_clone_retouch_layers(
        processing_image_ref,
        &adjustments_clone,
        &mask_bitmaps,
    );
    cancellation_checkpoint(cancellation, PreviewStage::Gpu)?;

    let pre_gpu_identity = crate::gpu_processing::PreGpuImageIdentity::from_image(
        retouched_processing_image.as_ref(),
        loaded_image.artifact_source.source_fingerprint(),
        pre_gpu_detail_stage.render_hash,
    );
    let wants_analytics = !(is_interactive && pixel_roi.is_some());
    let channel_filter = if is_interactive {
        active_waveform_channel.map(str::to_string)
    } else {
        None
    };

    let analytics_config = if wants_analytics {
        state
            .analytics_scheduler
            .lock()
            .unwrap()
            .clone()
            .map(|scheduler| AnalyticsConfig {
                path: loaded_image.path.clone(),
                frame_id: AnalyticsFrameId {
                    image_session: preview_id.image_session,
                    preview_generation: preview_id.generation,
                    graph_revision: viewer_sample_graph_revision.map(hash_revision).unwrap_or(0),
                },
                products: requested_products(compute_waveform, active_waveform_channel),
                active_waveform_channel: channel_filter,
                scheduler,
            })
    } else {
        None
    };

    let render_request = || RenderRequest {
        adjustments: render_plan.adjustments,
        mask_bitmaps: &mask_bitmaps,
        lut: render_plan.lut.clone(),
        roi: pixel_roi,
    };
    let presentation_identity =
        use_wgpu_renderer.then_some(crate::gpu_display::NativeFrameIdentity {
            image_session: preview_id.image_session,
            preview_generation: preview_id.generation,
        });
    let presentation_is_current =
        || cancellation_checkpoint(cancellation, PreviewStage::Publish).is_ok();
    let mut final_processed_image_result = process_and_get_dynamic_image_with_analytics(
        &context,
        &state,
        retouched_processing_image.as_ref(),
        pre_gpu_identity,
        render_request(),
        "apply_adjustments",
        use_wgpu_renderer,
        presentation_identity,
        use_wgpu_renderer.then_some(&presentation_is_current as &dyn Fn() -> bool),
        analytics_config.clone(),
    );

    let mut presented_natively = use_wgpu_renderer;
    if use_wgpu_renderer && let Err(error) = &final_processed_image_result {
        cancellation_checkpoint(cancellation, PreviewStage::Publish)?;
        log::warn!(
            "native preview presentation failed ({error}); using CPU transport for session={} generation={}",
            preview_id.image_session,
            preview_id.generation
        );
        presented_natively = false;
        final_processed_image_result = process_and_get_dynamic_image_with_analytics(
            &context,
            &state,
            retouched_processing_image.as_ref(),
            pre_gpu_identity,
            render_request(),
            "apply_adjustments_fallback",
            false,
            None,
            None,
            analytics_config,
        );
    }

    let final_processed_image = match final_processed_image_result {
        Ok(image) => Arc::new(image),
        Err(_) => {
            log::error!(
                "[process_preview_job] processing failed after {:.2?}",
                fn_start.elapsed()
            );
            return Err("Processing failed".to_string());
        }
    };
    cancellation_checkpoint(cancellation, PreviewStage::Readback)?;

    if presented_natively {
        cancellation_checkpoint(cancellation, PreviewStage::Publish)?;
        log::info!(
            "native_preview_transport session={} generation={} readback_bytes=0 jpeg_bytes=0 response_bytes=11 submit_latency_us={}",
            preview_id.image_session,
            preview_id.generation,
            fn_start.elapsed().as_micros()
        );
        let _ = app_handle.emit(
            crate::events::WGPU_FRAME_READY,
            serde_json::json!({
                "path": loaded_image.path,
                "imageSession": preview_id.image_session,
                "generation": preview_id.generation,
                "width": preview_width,
                "height": preview_height,
                "submitLatencyMicros": fn_start.elapsed().as_micros().min(u64::MAX as u128) as u64,
            }),
        );
        return Ok(b"WGPU_RENDER".to_vec());
    }

    cancellation_checkpoint(cancellation, PreviewStage::Encode)?;
    let bytes = encode_preview_response(
        Some(app_handle),
        final_processed_image.as_ref(),
        is_interactive,
        pixel_roi,
        preview_width,
        preview_height,
        jpeg_quality,
        fn_start,
    )?;
    cancellation_checkpoint(cancellation, PreviewStage::Publish)?;
    *state.cached_preview.lock().unwrap() = Some(CachedPreview {
        image: Arc::clone(&final_preview_base),
        small_image: Arc::clone(&small_preview_base),
        identity: preview_identity.clone(),
        scale: scale_for_gpu,
        unscaled_crop_offset,
        preview_dim,
        interactive_divisor,
    });
    if !is_interactive && let Some(graph_revision) = viewer_sample_graph_revision {
        let mut viewer_identity = preview_identity;
        viewer_identity.color_domain =
            crate::render::artifact_identity::ArtifactColorDomain::ViewEncoded;
        viewer_identity.completed_stage = "view-output";
        viewer_identity.detail_stage = render_plan.fingerprints.detail;
        viewer_identity.color_stage = render_plan.fingerprints.color;
        viewer_identity.output_stage = render_plan.fingerprints.output;
        viewer_identity.width = final_processed_image.width();
        viewer_identity.height = final_processed_image.height();
        let frame = settled_viewer_sample_frame(
            &final_processed_image,
            graph_revision,
            &loaded_image.path,
            viewer_identity,
        );
        let weight = frame.pixels.retained_bytes();
        state
            .viewer_sample_frames
            .insert("edited".to_string(), Arc::new(frame), weight);
    }
    Ok(bytes)
}

fn settled_viewer_sample_frame(
    image: &Arc<DynamicImage>,
    graph_revision: &str,
    image_identity: &str,
    artifact_identity: crate::render::artifact_identity::RenderArtifactIdentity,
) -> CachedViewerSampleFrame {
    CachedViewerSampleFrame {
        artifact_identity,
        graph_revision: graph_revision.to_string(),
        pixels: crate::app_state::SampleablePixels::native(Arc::clone(image)),
        image_identity: image_identity.to_string(),
        space_label: "Display encoded sRGB".to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn encode_preview_response(
    app_handle: Option<&tauri::AppHandle>,
    final_processed_image: &DynamicImage,
    is_interactive: bool,
    pixel_roi: Option<crate::gpu_processing::Roi>,
    preview_width: u32,
    preview_height: u32,
    jpeg_quality: u8,
    fn_start: std::time::Instant,
) -> Result<Vec<u8>, String> {
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    let display_snapshot = app_handle.map(|app| {
        app.state::<AppState>()
            .display_target_coordinator
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|coordinator| coordinator.current_snapshot())
            .unwrap_or_else(|| {
                Arc::new(crate::display_profile::display_preview_transform_snapshot_for_app(app))
            })
    });
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    if let Some(snapshot) = display_snapshot.as_ref() {
        log::debug!(
            "display_preview_snapshot generation={} display={:?} profile={} status={:?} cmm={} intent={} bpc={} interpolation={} implementation={} contract={}",
            snapshot.selection_generation,
            snapshot.profile.display_id,
            snapshot.icc_sha256,
            snapshot.profile.status,
            snapshot.profile.cmm,
            snapshot.intent,
            snapshot.black_point_compensation,
            snapshot.interpolation,
            snapshot.implementation_version,
            snapshot.encoding_contract,
        );
    }
    let final_rgba_image = match app_handle {
        #[cfg(not(any(target_os = "android", target_os = "linux")))]
        Some(_) => Cow::Owned(to_display_preview_rgba8(
            display_snapshot.as_ref().expect("snapshot resolved"),
            final_processed_image,
        )),
        #[cfg(any(target_os = "android", target_os = "linux"))]
        Some(app) => Cow::Owned(to_display_preview_rgba8(app, final_processed_image)),
        None => to_preview_rgba8(final_processed_image),
    };
    let interactive_geometry = if is_interactive {
        Some(validate_interactive_patch_geometry(
            final_rgba_image.width(),
            final_rgba_image.height(),
            pixel_roi,
            preview_width,
            preview_height,
        )?)
    } else {
        None
    };

    let step_start = std::time::Instant::now();
    let jpeg_bytes = rapidraw_codecs::encode_jpeg_rgba(
        final_rgba_image.as_raw(),
        final_rgba_image.width(),
        final_rgba_image.height(),
        jpeg_quality,
    )
    .map_err(|e| format!("Failed to encode preview: {}", e))?;
    #[cfg(target_os = "macos")]
    let jpeg_bytes = if let Some(snapshot) = display_snapshot.as_ref() {
        jpeg_with_icc_profile(&jpeg_bytes, &snapshot.icc_bytes)?
    } else {
        jpeg_bytes
    };

    if is_interactive {
        let (rx, ry, roi_w, roi_h) = interactive_geometry
            .ok_or_else(|| "Interactive patch geometry was not validated".to_string())?;
        let mut response = Vec::with_capacity(24 + jpeg_bytes.len());
        response.extend_from_slice(&rx.to_le_bytes());
        response.extend_from_slice(&ry.to_le_bytes());
        response.extend_from_slice(&roi_w.to_le_bytes());
        response.extend_from_slice(&roi_h.to_le_bytes());
        response.extend_from_slice(&preview_width.to_le_bytes());
        response.extend_from_slice(&preview_height.to_le_bytes());
        response.extend_from_slice(&jpeg_bytes);

        log::info!(
            "[process_preview_job] interactive ROI {}x{} encode in {:.2?}, total {:.2?}",
            roi_w,
            roi_h,
            step_start.elapsed(),
            fn_start.elapsed()
        );
        Ok(response)
    } else {
        let (width, height) = final_rgba_image.dimensions();
        log::info!(
            "[process_preview_job] full {}x{} q={} encode in {:.2?}, total {:.2?}",
            width,
            height,
            jpeg_quality,
            step_start.elapsed(),
            fn_start.elapsed()
        );
        Ok(jpeg_bytes)
    }
}

#[cfg(target_os = "macos")]
fn jpeg_with_icc_profile(jpeg: &[u8], icc: &[u8]) -> Result<Vec<u8>, String> {
    const HEADER: &[u8] = b"ICC_PROFILE\0";
    const MAX_CHUNK: usize = 65_519;
    if !jpeg.starts_with(&[0xff, 0xd8]) || icc.is_empty() {
        return Err("Cannot tag invalid preview JPEG or empty display ICC profile".to_string());
    }
    let count = icc.len().div_ceil(MAX_CHUNK);
    if count > u8::MAX as usize {
        return Err("Display ICC profile is too large for JPEG APP2 chunking".to_string());
    }
    let mut output = Vec::with_capacity(jpeg.len() + icc.len() + count * 18);
    output.extend_from_slice(&jpeg[..2]);
    for (index, chunk) in icc.chunks(MAX_CHUNK).enumerate() {
        let payload_len = HEADER.len() + 2 + chunk.len();
        output.extend_from_slice(&[0xff, 0xe2]);
        output.extend_from_slice(&((payload_len + 2) as u16).to_be_bytes());
        output.extend_from_slice(HEADER);
        output.push((index + 1) as u8);
        output.push(count as u8);
        output.extend_from_slice(chunk);
    }
    output.extend_from_slice(&jpeg[2..]);
    Ok(output)
}

fn validate_interactive_patch_geometry(
    encoded_width: u32,
    encoded_height: u32,
    pixel_roi: Option<crate::gpu_processing::Roi>,
    preview_width: u32,
    preview_height: u32,
) -> Result<(u32, u32, u32, u32), String> {
    if preview_width == 0 || preview_height == 0 {
        return Err("Interactive patch full-frame dimensions must be non-zero".to_string());
    }

    let roi = pixel_roi.unwrap_or(crate::gpu_processing::Roi {
        x: 0,
        y: 0,
        width: preview_width,
        height: preview_height,
    });
    if roi.width == 0 || roi.height == 0 {
        return Err("Interactive patch ROI dimensions must be non-zero".to_string());
    }
    let roi_right = roi
        .x
        .checked_add(roi.width)
        .ok_or_else(|| "Interactive patch ROI horizontal bounds overflowed".to_string())?;
    let roi_bottom = roi
        .y
        .checked_add(roi.height)
        .ok_or_else(|| "Interactive patch ROI vertical bounds overflowed".to_string())?;
    if roi_right > preview_width || roi_bottom > preview_height {
        return Err("Interactive patch ROI exceeds full-frame dimensions".to_string());
    }
    if encoded_width != roi.width || encoded_height != roi.height {
        return Err(format!(
            "Interactive patch encoded dimensions {}x{} do not match ROI {}x{}",
            encoded_width, encoded_height, roi.width, roi.height
        ));
    }

    Ok((roi.x, roi.y, roi.width, roi.height))
}

fn to_preview_rgba8(image: &DynamicImage) -> Cow<'_, RgbaImage> {
    match image {
        DynamicImage::ImageRgba8(image) => Cow::Borrowed(image),
        image => Cow::Owned(image.to_rgba8()),
    }
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn to_display_preview_rgba8(
    snapshot: &crate::display_profile::DisplayPreviewTransformSnapshot,
    image: &DynamicImage,
) -> RgbaImage {
    let mut image = image.to_rgba8();
    let lut = &snapshot.lut;
    for pixel in image.pixels_mut() {
        let transformed = lut.sample_rgb([
            pixel[0] as f32 / 255.0,
            pixel[1] as f32 / 255.0,
            pixel[2] as f32 / 255.0,
        ]);
        for channel in 0..3 {
            pixel[channel] = (transformed[channel].clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
    image
}

#[cfg(any(target_os = "android", target_os = "linux"))]
fn to_display_preview_rgba8(_app: &tauri::AppHandle, image: &DynamicImage) -> RgbaImage {
    image.to_rgba8()
}

pub(crate) fn start_preview_worker(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<AppState>();
    let scheduler = PreviewScheduler::new_with_export_gpu_pressure(
        PreviewSchedulingPolicy::default(),
        Some(Arc::clone(&state.export_interactive_gpu_waiters)),
    );
    *state.preview_scheduler.lock().unwrap() = Some(Arc::clone(&scheduler));

    thread::spawn(move || {
        while let Some(request) = scheduler.next() {
            let id = request.id;
            let quality = request.quality;
            let queued_for = request.submitted_at.elapsed();
            let cancellation = scheduler.cancellation(id);
            let job = request.job;
            let state = app_handle.state::<AppState>();
            let responder = job.responder;
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                process_preview_job(PreviewJobConfig {
                    app_handle: &app_handle,
                    state,
                    adjustments_json: (*job.adjustments).clone(),
                    expected_image_path: &job.expected_image_path,
                    is_interactive: job.is_interactive,
                    target_resolution: job.target_resolution,
                    roi: job.roi,
                    compute_waveform: job.compute_waveform,
                    active_waveform_channel: job.active_waveform_channel.as_deref(),
                    viewer_sample_graph_revision: job.viewer_sample_graph_revision.as_deref(),
                    cancellation: Some(&cancellation),
                    preview_id: id,
                })
            }));
            let completion = match result {
                Ok(Ok(bytes)) => PreviewCompletion::Rendered { bytes, id },
                Ok(Err(message)) if message.starts_with("preview_superseded") => {
                    let by_generation = message
                        .split(':')
                        .nth(1)
                        .and_then(|value| value.parse().ok())
                        .unwrap_or_else(|| id.generation.saturating_add(1));
                    PreviewCompletion::Superseded {
                        by_generation,
                        stage: abort_stage(&message),
                    }
                }
                Ok(Err(message)) if message.starts_with("preview_cancelled") => {
                    PreviewCompletion::Cancelled {
                        stage: abort_stage(&message),
                    }
                }
                Ok(Err(message)) => PreviewCompletion::Failed {
                    code: "preview_render_failed",
                    message,
                },
                Err(_) => PreviewCompletion::Failed {
                    code: "preview_render_panic",
                    message: "Preview render panicked".to_string(),
                },
            };
            let rendered = matches!(completion, PreviewCompletion::Rendered { .. });
            let _ = responder.send(completion);
            scheduler.finish(quality, rendered);
            log::debug!(
                "preview {:?} session={} generation={} queue_ms={:.1}",
                quality,
                id.image_session,
                id.generation,
                queued_for.as_secs_f64() * 1000.0
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    #[test]
    fn native_presentation_policy_requires_setting_display_and_full_frame() {
        assert_eq!(
            native_preview_presentation_decision(false, true, false).reason,
            NativePreviewPresentationReason::DisabledBySetting
        );
        assert_eq!(
            native_preview_presentation_decision(true, false, false).reason,
            if cfg!(any(target_os = "android", target_os = "linux")) {
                NativePreviewPresentationReason::UnsupportedPlatform
            } else {
                NativePreviewPresentationReason::DisplayUnavailable
            }
        );
        let roi = native_preview_presentation_decision(true, true, true);
        if !cfg!(any(target_os = "android", target_os = "linux")) {
            assert_eq!(
                roi.reason,
                NativePreviewPresentationReason::RequestRequiresCpuPixels
            );
            assert!(native_preview_presentation_decision(true, true, false).enabled);
        }
    }

    #[test]
    fn native_transport_is_bounded_and_not_a_jpeg() {
        let response = b"WGPU_RENDER";
        assert_eq!(response.len(), 11);
        assert_ne!(&response[..2], &[0xff, 0xd8]);
    }

    fn encode_with_owned_source_baseline(
        image: DynamicImage,
        is_interactive: bool,
        pixel_roi: Option<crate::gpu_processing::Roi>,
        preview_width: u32,
        preview_height: u32,
        jpeg_quality: u8,
    ) -> Result<Vec<u8>, String> {
        let rgba = match image {
            DynamicImage::ImageRgba8(rgba) => rgba,
            image => image.to_rgba8(),
        };
        let geometry = if is_interactive {
            Some(validate_interactive_patch_geometry(
                rgba.width(),
                rgba.height(),
                pixel_roi,
                preview_width,
                preview_height,
            )?)
        } else {
            None
        };
        let jpeg = rapidraw_codecs::encode_jpeg_rgba(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            jpeg_quality,
        )
        .map_err(|error| format!("Failed to encode preview: {error}"))?;

        if let Some((x, y, width, height)) = geometry {
            let mut response = Vec::with_capacity(24 + jpeg.len());
            for value in [x, y, width, height, preview_width, preview_height] {
                response.extend_from_slice(&value.to_le_bytes());
            }
            response.extend_from_slice(&jpeg);
            Ok(response)
        } else {
            Ok(jpeg)
        }
    }

    #[test]
    fn preview_encoder_accepts_rgba32f_raw_pipeline_output() {
        let image = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(2, 2, |x, y| {
            Rgba([x as f32 / 2.0, y as f32 / 2.0, 0.25 + x as f32 * 0.1, 1.0])
        }));

        let encoded = encode_preview_response(
            None,
            &image,
            false,
            None,
            2,
            2,
            82,
            std::time::Instant::now(),
        )
        .expect("RGBA32F preview should encode through RGBA8 boundary");

        assert!(encoded.starts_with(&[0xff, 0xd8]));
        assert!(encoded.len() > 16);
    }

    #[test]
    fn shared_encoder_matches_owned_source_bytes_for_rgba8_and_rgba32f() {
        let rgba8 = DynamicImage::ImageRgba8(ImageBuffer::from_fn(7, 5, |x, y| {
            Rgba([(x * 31) as u8, (y * 47) as u8, ((x + y) * 19) as u8, 255])
        }));
        let rgba32f = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(7, 5, |x, y| {
            Rgba([x as f32 / 7.0, y as f32 / 5.0, (x + y) as f32 / 12.0, 1.0])
        }));

        for image in [rgba8, rgba32f] {
            let actual = encode_preview_response(
                None,
                &image,
                false,
                None,
                7,
                5,
                94,
                std::time::Instant::now(),
            )
            .expect("shared source should encode");
            let expected = encode_with_owned_source_baseline(image, false, None, 7, 5, 94)
                .expect("owned source baseline should encode");
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn preview_rgba8_conversion_borrows_rgba8_and_owns_float_conversion() {
        let rgba8 = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 1, Rgba([1, 2, 3, 4])));
        let borrowed = to_preview_rgba8(&rgba8);
        assert!(matches!(borrowed, Cow::Borrowed(_)));
        assert_eq!(
            borrowed.as_raw().as_ptr(),
            rgba8.as_rgba8().unwrap().as_raw().as_ptr()
        );

        let rgba32f =
            DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(1, 1, Rgba([0.25, 0.5, 0.75, 1.0])));
        let converted = to_preview_rgba8(&rgba32f);
        assert!(matches!(converted, Cow::Owned(_)));
        assert_eq!(converted.get_pixel(0, 0).0, [64, 128, 191, 255]);
    }

    #[test]
    fn interactive_preview_encoder_preserves_roi_geometry_contract() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(3, 2, Rgba([20, 40, 60, 255])));
        let encoded = encode_preview_response(
            None,
            &image,
            true,
            Some(crate::gpu_processing::Roi {
                x: 2,
                y: 1,
                width: 3,
                height: 2,
            }),
            8,
            6,
            75,
            std::time::Instant::now(),
        )
        .expect("coherent ROI preview should encode");

        assert_eq!(u32::from_le_bytes(encoded[0..4].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(encoded[4..8].try_into().unwrap()), 1);
        assert_eq!(u32::from_le_bytes(encoded[8..12].try_into().unwrap()), 3);
        assert_eq!(u32::from_le_bytes(encoded[12..16].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(encoded[16..20].try_into().unwrap()), 8);
        assert_eq!(u32::from_le_bytes(encoded[20..24].try_into().unwrap()), 6);
        assert!(encoded[24..].starts_with(&[0xff, 0xd8]));
        let baseline = encode_with_owned_source_baseline(
            image,
            true,
            Some(crate::gpu_processing::Roi {
                x: 2,
                y: 1,
                width: 3,
                height: 2,
            }),
            8,
            6,
            75,
        )
        .expect("owned ROI baseline should encode");
        assert_eq!(encoded, baseline);

        let full_frame =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(3, 2, Rgba([20, 40, 60, 255])));
        let full_frame_encoded = encode_preview_response(
            None,
            &full_frame,
            true,
            None,
            3,
            2,
            75,
            std::time::Instant::now(),
        )
        .expect("coherent full-frame interactive preview should encode");
        assert_eq!(
            u32::from_le_bytes(full_frame_encoded[0..4].try_into().unwrap()),
            0
        );
        assert_eq!(
            u32::from_le_bytes(full_frame_encoded[4..8].try_into().unwrap()),
            0
        );
        assert_eq!(
            u32::from_le_bytes(full_frame_encoded[8..12].try_into().unwrap()),
            3
        );
        assert_eq!(
            u32::from_le_bytes(full_frame_encoded[12..16].try_into().unwrap()),
            2
        );
    }

    #[test]
    fn interactive_preview_encoder_rejects_full_frame_pixels_labeled_as_roi() {
        let full_frame =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(8, 6, Rgba([20, 40, 60, 255])));
        let result = encode_preview_response(
            None,
            &full_frame,
            true,
            Some(crate::gpu_processing::Roi {
                x: 2,
                y: 1,
                width: 3,
                height: 2,
            }),
            8,
            6,
            75,
            std::time::Instant::now(),
        );

        assert_eq!(
            result.unwrap_err(),
            "Interactive patch encoded dimensions 8x6 do not match ROI 3x2"
        );
    }

    #[test]
    fn settled_sampler_frame_shares_encoder_allocation_and_outlives_render_owner() {
        let rendered = Arc::new(DynamicImage::ImageRgba32F(ImageBuffer::from_fn(
            1920,
            1080,
            |x, y| Rgba([x as f32 / 1920.0, y as f32 / 1080.0, 0.25, 1.0]),
        )));
        let sampler_frame = settled_viewer_sample_frame(
            &rendered,
            "history_4",
            "/fixture/settled.raw",
            crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
                &crate::render::artifact_identity::tests_support::source("/fixture/settled.raw"),
                1,
                1,
                1,
                1,
                1920,
                1080,
            ),
        );

        assert!(Arc::ptr_eq(&rendered, sampler_frame.pixels.image()));
        assert_eq!(Arc::strong_count(&rendered), 2);

        let encoded = encode_preview_response(
            None,
            rendered.as_ref(),
            false,
            None,
            1920,
            1080,
            82,
            std::time::Instant::now(),
        )
        .expect("shared RGBA32F settled frame should encode");
        drop(rendered);

        assert_eq!(Arc::strong_count(sampler_frame.pixels.image()), 1);
        assert_eq!(sampler_frame.pixels.dimensions(), (1920, 1080));
        assert_eq!(sampler_frame.graph_revision, "history_4");
        assert_eq!(sampler_frame.image_identity, "/fixture/settled.raw");
        assert_eq!(sampler_frame.space_label, "Display encoded sRGB");
        assert_eq!(
            sampler_frame
                .pixels
                .image()
                .as_rgba32f()
                .unwrap()
                .get_pixel(960, 540)
                .0,
            [0.5, 0.5, 0.25, 1.0]
        );
        assert!(encoded.starts_with(&[0xff, 0xd8]));
        let decoded = image::load_from_memory(&encoded).expect("encoded preview should decode");
        assert_eq!(decoded.dimensions(), (1920, 1080));
    }
}
