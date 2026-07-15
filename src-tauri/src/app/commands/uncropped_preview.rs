use std::borrow::Cow;
use std::sync::Arc;
use std::thread;

use image::{GenericImageView, ImageBuffer, Luma};
use tauri::{Emitter, Manager};

use crate::app_settings::load_settings_or_default;
use crate::cache_utils::calculate_transform_hash;
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::image_codecs::encode_jpeg_data_url;
use crate::image_loader::composite_patches_on_image;
use crate::image_processing::{
    RenderRequest, apply_coarse_rotation, apply_flip, apply_geometry_warp, downscale_f32_image,
    get_or_init_gpu_context, process_and_get_dynamic_image,
    resolve_tonemapper_override_from_handle,
};
use crate::mask_generation::{MaskDefinition, get_cached_or_generate_mask};
use crate::render::render_plan::compile_consumer_render_plan;
use crate::{AppState, adjustment_fields, get_or_load_lut, hydrate_adjustments, render_pipeline};

#[tauri::command]
pub(crate) fn generate_uncropped_preview(
    js_adjustments: serde_json::Value,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let mut adjustments_clone = js_adjustments;
    hydrate_adjustments(&state, &mut adjustments_clone);

    let loaded_image = state
        .services
        .editor
        .image_snapshot()
        .ok_or("No original image loaded")?;
    let request = state
        .services
        .preview_session
        .begin_request(loaded_image.path.clone())
        .ok_or("uncropped_preview.image_session_transition")?;

    thread::spawn(move || {
        let state = app_handle.state::<AppState>();
        let is_raw = loaded_image.is_raw;
        let has_patches = adjustments_clone
            .get("aiPatches")
            .and_then(|value| value.as_array())
            .is_some_and(|patches| !patches.is_empty());
        let patched_image = if has_patches {
            composite_patches_on_image(&loaded_image.image, &adjustments_clone).unwrap_or_else(
                |error| {
                    log::error!("Failed to composite patches for uncropped preview: {error}");
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
        let (rotated_width, rotated_height) = flipped_image.dimensions();

        let (processing_base, scale_for_gpu) =
            if rotated_width > preview_dim || rotated_height > preview_dim {
                let base = downscale_f32_image(&flipped_image, preview_dim, preview_dim);
                let scale = if rotated_width > 0 {
                    base.width() as f32 / rotated_width as f32
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
            .and_then(|masks| serde_json::from_value(masks.clone()).ok())
            .unwrap_or_default();
        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|definition| {
                get_cached_or_generate_mask(
                    &state,
                    definition,
                    preview_width,
                    preview_height,
                    scale_for_gpu,
                    (0.0, 0.0),
                    &adjustments_clone,
                )
            })
            .collect();

        let tonemapper_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
        let render_adjustments = normalize_film_look_adjustments_for_render(&adjustments_clone);
        let lut = render_adjustments["lutPath"]
            .as_str()
            .and_then(|path| get_or_load_lut(&state, path).ok());
        let render_plan = match compile_consumer_render_plan(
            render_adjustments.as_ref(),
            &loaded_image.path,
            is_raw,
            tonemapper_override,
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
                    if !state.services.preview_session.publish_if_current(
                        &request,
                        || {
                            state
                                .services
                                .editor
                                .image_snapshot()
                                .map(|image| image.path)
                        },
                        || {
                            let _ =
                                app_handle.emit(crate::events::PREVIEW_UPDATE_UNCROPPED, data_url);
                        },
                    ) {
                        log::debug!("Discarding stale uncropped-preview result");
                    }
                }
                Err(error) => {
                    log::error!("Failed to encode uncropped preview: {error}");
                }
            }
        }
    });

    Ok(())
}
