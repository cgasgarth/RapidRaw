use std::borrow::Cow;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
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
use crate::{
    AppState, adjustment_fields, compile_consumer_render_plan, get_or_load_lut,
    hydrate_adjustments, render_pipeline,
};

#[derive(Clone, Debug, Eq, PartialEq)]
struct UncroppedPreviewRequest {
    epoch: u64,
    image_generation: u64,
    source_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ActiveImageSession {
    image_generation: u64,
    source_identity: String,
}

#[derive(Default)]
struct UncroppedPreviewAuthority {
    epoch: u64,
    active_image: Option<ActiveImageSession>,
}

/// Owns publication authority for detached uncropped-preview work.
///
/// Rendering may finish out of order, so a worker must still be the newest
/// request for the same active image session before it can update the viewer.
#[derive(Default)]
pub(crate) struct UncroppedPreviewService {
    authority: Mutex<UncroppedPreviewAuthority>,
}

impl UncroppedPreviewService {
    pub(crate) fn begin_image_load(&self, generation: &AtomicUsize) -> usize {
        let mut authority = self
            .authority
            .lock()
            .expect("uncropped-preview authority poisoned");
        authority.epoch = authority.epoch.wrapping_add(1);
        authority.active_image = None;
        generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(crate) fn install_image_session(&self, image_generation: u64, source_identity: &str) {
        let mut authority = self
            .authority
            .lock()
            .expect("uncropped-preview authority poisoned");
        authority.active_image = Some(ActiveImageSession {
            image_generation,
            source_identity: source_identity.to_string(),
        });
    }

    fn begin_request(
        &self,
        image_generation: u64,
        source_identity: String,
    ) -> Option<UncroppedPreviewRequest> {
        let mut authority = self
            .authority
            .lock()
            .expect("uncropped-preview authority poisoned");
        let requested_image = ActiveImageSession {
            image_generation,
            source_identity: source_identity.clone(),
        };
        if authority.active_image.as_ref() != Some(&requested_image) {
            return None;
        }
        authority.epoch = authority.epoch.wrapping_add(1);
        Some(UncroppedPreviewRequest {
            epoch: authority.epoch,
            image_generation,
            source_identity,
        })
    }

    fn publish_if_current<Current, Publish>(
        &self,
        request: &UncroppedPreviewRequest,
        current_image: Current,
        publish: Publish,
    ) -> bool
    where
        Current: FnOnce() -> (u64, Option<String>),
        Publish: FnOnce(),
    {
        let authority = self
            .authority
            .lock()
            .expect("uncropped-preview authority poisoned");
        let (current_image_generation, current_source_identity) = current_image();
        let request_image = ActiveImageSession {
            image_generation: request.image_generation,
            source_identity: request.source_identity.clone(),
        };
        let is_current = authority.epoch == request.epoch
            && authority.active_image.as_ref() == Some(&request_image)
            && request.image_generation == current_image_generation
            && current_source_identity.as_deref() == Some(request.source_identity.as_str());
        if is_current {
            publish();
        }
        is_current
    }
}

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
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded")?;
    let request = state
        .services
        .uncropped_preview
        .begin_request(
            state.load_image_generation.load(Ordering::SeqCst) as u64,
            loaded_image.path.clone(),
        )
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
                    if !state.services.uncropped_preview.publish_if_current(
                        &request,
                        || {
                            let current_generation =
                                state.load_image_generation.load(Ordering::SeqCst) as u64;
                            let current_source = state
                                .original_image
                                .lock()
                                .unwrap()
                                .as_ref()
                                .map(|image| image.path.clone());
                            (current_generation, current_source)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn later_request_supersedes_earlier_request() {
        let service = UncroppedPreviewService::default();
        service.install_image_session(11, "/image-a.raw");
        let first = service
            .begin_request(11, "/image-a.raw".to_string())
            .unwrap();
        let second = service
            .begin_request(11, "/image-a.raw".to_string())
            .unwrap();
        let mut published = Vec::new();

        assert!(!service.publish_if_current(
            &first,
            || (11, Some("/image-a.raw".to_string())),
            || published.push("first"),
        ));
        assert!(service.publish_if_current(
            &second,
            || (11, Some("/image-a.raw".to_string())),
            || published.push("second"),
        ));
        assert_eq!(published, ["second"]);
    }

    #[test]
    fn publication_requires_the_same_image_session_and_source() {
        let service = UncroppedPreviewService::default();
        service.install_image_session(7, "/image-a.raw");
        let request = service
            .begin_request(7, "/image-a.raw".to_string())
            .unwrap();

        assert!(!service.publish_if_current(
            &request,
            || (8, Some("/image-a.raw".to_string())),
            || panic!("generation-mismatched result published"),
        ));
        assert!(!service.publish_if_current(
            &request,
            || (7, Some("/image-b.raw".to_string())),
            || panic!("source-mismatched result published"),
        ));
        assert!(!service.publish_if_current(
            &request,
            || (7, None),
            || panic!("result published without an active source"),
        ));
    }

    #[test]
    fn image_load_transition_invalidates_work_and_blocks_new_requests() {
        let service = UncroppedPreviewService::default();
        let generation = AtomicUsize::new(3);
        service.install_image_session(3, "/image-a.raw");
        let stale_request = service
            .begin_request(3, "/image-a.raw".to_string())
            .unwrap();

        assert_eq!(service.begin_image_load(&generation), 4);
        assert!(
            service
                .begin_request(4, "/image-a.raw".to_string())
                .is_none()
        );
        assert!(!service.publish_if_current(
            &stale_request,
            || (4, Some("/image-a.raw".to_string())),
            || panic!("pre-load result published during a source transition"),
        ));

        service.install_image_session(4, "/image-a.raw");
        assert!(
            service
                .begin_request(4, "/image-a.raw".to_string())
                .is_some()
        );
    }
}
