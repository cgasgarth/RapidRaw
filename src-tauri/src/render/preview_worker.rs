use std::borrow::Cow;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use image::{DynamicImage, GenericImageView, ImageBuffer, Luma, RgbaImage};
use imgref::ImgRef;
use mozjpeg_rs::{Encoder, Preset};
use rgb::{FromSlice, RGBA8};
use tauri::{Emitter, Manager};

use crate::adjustment_utils::hydrate_adjustments;
use crate::app_settings::load_preview_runtime_settings_or_default;
use crate::app_state::{
    AnalyticsConfig, AppState, CachedPreview, CachedViewerSampleFrame, PreviewJob,
};
use crate::cache_utils::{calculate_full_job_hash, calculate_transform_hash};
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::generate_transformed_preview;
use crate::image_processing::{
    RenderRequest, downscale_f32_image, get_all_adjustments_from_json, get_or_init_gpu_context,
    process_and_get_dynamic_image_with_analytics, resolve_tonemapper_override_from_handle,
};
use crate::lut_processing::Lut;
use crate::mask_generation::{MaskDefinition, get_cached_or_generate_mask};
use crate::{get_or_load_lut, render_caches, render_pipeline};

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
    } = config;

    let fn_start = std::time::Instant::now();
    let context = get_or_init_gpu_context(&state, app_handle)?;
    hydrate_adjustments(&state, &mut adjustments_json);

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
    let adjustments_clone = adjustments_json;

    let new_transform_hash = calculate_transform_hash(&adjustments_clone);
    let settings = load_preview_runtime_settings_or_default(app_handle);
    let live_quality = settings.live_preview_quality.as_str();

    let default_preview_dim = settings.editor_preview_resolution;
    let preview_dim = target_resolution.unwrap_or(default_preview_dim);
    let use_wgpu_renderer = false;

    let has_roi = roi.is_some();
    let (interactive_divisor, interactive_quality) = match live_quality {
        "full" => (1.0_f32, 85_u8),
        "performance" => (if has_roi { 1.8_f32 } else { 1.5_f32 }, 65_u8),
        _ => (if has_roi { 1.4_f32 } else { 1.0_f32 }, 75_u8),
    };

    let mut cached_preview_lock = state.cached_preview.lock().unwrap();

    let base_valid = cached_preview_lock
        .as_ref()
        .is_some_and(|c| c.transform_hash == new_transform_hash && c.preview_dim == preview_dim);
    let small_valid = base_valid
        && cached_preview_lock
            .as_ref()
            .is_some_and(|c| c.interactive_divisor == interactive_divisor);

    let (final_preview_base, scale_for_gpu, unscaled_crop_offset) = if base_valid {
        let cached = cached_preview_lock.as_ref().unwrap();
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

    let small_preview_base = if small_valid {
        Arc::clone(&cached_preview_lock.as_ref().unwrap().small_image)
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

    *cached_preview_lock = Some(CachedPreview {
        image: Arc::clone(&final_preview_base),
        small_image: Arc::clone(&small_preview_base),
        transform_hash: new_transform_hash,
        scale: scale_for_gpu,
        unscaled_crop_offset,
        preview_dim,
        interactive_divisor,
    });

    drop(cached_preview_lock);

    let (processing_image, effective_scale, jpeg_quality) = if is_interactive {
        let orig_w = final_preview_base.width() as f32;
        let small_w = small_preview_base.width() as f32;
        let scale_factor = if orig_w > 0.0 { small_w / orig_w } else { 1.0 };
        let new_scale = scale_for_gpu * scale_factor;
        (small_preview_base, new_scale, interactive_quality)
    } else {
        (final_preview_base, scale_for_gpu, 94)
    };

    let pre_gpu_detail_stage = render_pipeline::apply_pre_gpu_detail_stages(
        processing_image.as_ref(),
        new_transform_hash,
        &adjustments_clone,
    );
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

    let mask_definitions: Vec<MaskDefinition> = adjustments_clone
        .get("masks")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();

    let scaled_crop_offset = (
        unscaled_crop_offset.0 * effective_scale,
        unscaled_crop_offset.1 * effective_scale,
    );

    let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
        .iter()
        .filter_map(|def| {
            get_cached_or_generate_mask(
                &state,
                def,
                preview_width,
                preview_height,
                effective_scale,
                scaled_crop_offset,
                &adjustments_clone,
            )
        })
        .collect();

    let retouched_processing_image = crate::retouch_render::apply_clone_retouch_layers(
        processing_image_ref,
        &adjustments_clone,
        &mask_bitmaps,
    );

    let is_raw = loaded_image.is_raw;
    let render_adjustments = normalize_film_look_adjustments_for_render(&adjustments_clone);
    let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
    let render_input_hash =
        calculate_full_job_hash(&loaded_image.path, render_adjustments.as_ref());
    let final_adjustments =
        get_all_adjustments_from_json(render_adjustments.as_ref(), is_raw, tm_override);
    let lut: Option<Arc<Lut>> = render_adjustments["lutPath"]
        .as_str()
        .and_then(|path| get_or_load_lut(&state, path).ok());

    let wants_analytics = !(is_interactive && pixel_roi.is_some());
    let channel_filter = if is_interactive {
        active_waveform_channel.map(str::to_string)
    } else {
        None
    };

    let analytics_config = if wants_analytics {
        state
            .analytics_worker_tx
            .lock()
            .unwrap()
            .clone()
            .map(|tx| AnalyticsConfig {
                path: loaded_image.path.clone(),
                compute_waveform,
                active_waveform_channel: channel_filter,
                sender: tx,
            })
    } else {
        None
    };

    let final_processed_image_result = process_and_get_dynamic_image_with_analytics(
        &context,
        &state,
        retouched_processing_image.as_ref(),
        render_input_hash,
        RenderRequest {
            adjustments: final_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut,
            roi: pixel_roi,
        },
        "apply_adjustments",
        use_wgpu_renderer,
        analytics_config,
    );

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

    if !is_interactive && let Some(graph_revision) = viewer_sample_graph_revision {
        state.viewer_sample_frames.lock().unwrap().insert(
            "edited".to_string(),
            settled_viewer_sample_frame(&final_processed_image, graph_revision, &loaded_image.path),
        );
    }

    if use_wgpu_renderer {
        let _ = context.device.poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_millis(500)),
        });
        let _ = app_handle.emit(
            crate::events::WGPU_FRAME_READY,
            serde_json::json!({ "path": loaded_image.path }),
        );
        return Ok(b"WGPU_RENDER".to_vec());
    }

    encode_preview_response(
        final_processed_image.as_ref(),
        is_interactive,
        pixel_roi,
        preview_width,
        preview_height,
        jpeg_quality,
        fn_start,
    )
}

fn settled_viewer_sample_frame(
    image: &Arc<DynamicImage>,
    graph_revision: &str,
    image_identity: &str,
) -> CachedViewerSampleFrame {
    CachedViewerSampleFrame {
        graph_revision: graph_revision.to_string(),
        image: Arc::clone(image),
        image_identity: image_identity.to_string(),
        space_label: "Display encoded sRGB".to_string(),
    }
}

fn encode_preview_response(
    final_processed_image: &DynamicImage,
    is_interactive: bool,
    pixel_roi: Option<crate::gpu_processing::Roi>,
    preview_width: u32,
    preview_height: u32,
    jpeg_quality: u8,
    fn_start: std::time::Instant,
) -> Result<Vec<u8>, String> {
    let final_rgba_image = to_preview_rgba8(final_processed_image);
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

    let raw_bytes: &[u8] = final_rgba_image.as_raw();
    let rgba8_pixels: &[RGBA8] = raw_bytes.as_rgba();
    let img_ref = ImgRef::new(
        rgba8_pixels,
        final_rgba_image.width() as usize,
        final_rgba_image.height() as usize,
    );

    let step_start = std::time::Instant::now();
    let jpeg_bytes = Encoder::new(Preset::BaselineFastest)
        .quality(jpeg_quality)
        .fast_color(true)
        .encode_imgref(img_ref)
        .map_err(|e| format!("Failed to encode preview: {}", e))?;

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

pub(crate) fn start_preview_worker(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<AppState>();
    let (tx, rx): (Sender<PreviewJob>, Receiver<PreviewJob>) = mpsc::channel();

    *state.preview_worker_tx.lock().unwrap() = Some(tx);

    thread::spawn(move || {
        while let Ok(mut job) = rx.recv() {
            while let Ok(latest_job) = rx.try_recv() {
                job = latest_job;
            }

            let state = app_handle.state::<AppState>();
            let responder = job.responder;
            match process_preview_job(PreviewJobConfig {
                app_handle: &app_handle,
                state,
                adjustments_json: job.adjustments,
                expected_image_path: &job.expected_image_path,
                is_interactive: job.is_interactive,
                target_resolution: job.target_resolution,
                roi: job.roi,
                compute_waveform: job.compute_waveform,
                active_waveform_channel: job.active_waveform_channel.as_deref(),
                viewer_sample_graph_revision: job.viewer_sample_graph_revision.as_deref(),
            }) {
                Ok(bytes) => {
                    let _ = responder.send(bytes);
                }
                Err(e) => {
                    log::error!("Preview worker error: {}", e);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

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
        let jpeg = Encoder::new(Preset::BaselineFastest)
            .quality(jpeg_quality)
            .fast_color(true)
            .encode_imgref(ImgRef::new(
                rgba.as_raw().as_slice().as_rgba(),
                rgba.width() as usize,
                rgba.height() as usize,
            ))
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

        let encoded =
            encode_preview_response(&image, false, None, 2, 2, 82, std::time::Instant::now())
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
            let actual =
                encode_preview_response(&image, false, None, 7, 5, 94, std::time::Instant::now())
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
        let full_frame_encoded =
            encode_preview_response(&full_frame, true, None, 3, 2, 75, std::time::Instant::now())
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
        let sampler_frame =
            settled_viewer_sample_frame(&rendered, "history_4", "/fixture/settled.raw");

        assert!(Arc::ptr_eq(&rendered, &sampler_frame.image));
        assert_eq!(Arc::strong_count(&rendered), 2);

        let encoded = encode_preview_response(
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

        assert_eq!(Arc::strong_count(&sampler_frame.image), 1);
        assert_eq!(sampler_frame.image.dimensions(), (1920, 1080));
        assert_eq!(sampler_frame.graph_revision, "history_4");
        assert_eq!(sampler_frame.image_identity, "/fixture/settled.raw");
        assert_eq!(sampler_frame.space_label, "Display encoded sRGB");
        assert_eq!(
            sampler_frame
                .image
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
