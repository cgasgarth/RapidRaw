use std::sync::Arc;
use std::sync::atomic::Ordering;

use image::{DynamicImage, GenericImageView, ImageBuffer, Luma, RgbImage};
use rapidraw_codecs::JpegPreset;
use serde::Deserialize;
use tauri::{Emitter, ipc::Response};

use crate::app_state::{
    AnalyticsFrameId, AnalyticsJob, AnalyticsProducts, AnalyticsSamplingPolicy, AppState,
    LoadedImage,
};
use crate::cache_utils::{calculate_geometry_hash, calculate_transform_hash};
use crate::editor::viewer_sampling_service::{
    CachedViewerSampleFrame, SampleablePixels, ViewerSampleCacheSlot,
};
use crate::image_processing::{
    RenderRequest, get_or_init_gpu_context, process_and_get_dynamic_image,
    resolve_tonemapper_override_from_handle,
};
use crate::lut_processing::Lut;
use crate::mask_generation::{MaskDefinition, get_cached_or_generate_mask};
use crate::{
    color, compile_consumer_render_plan, export, generate_transformed_preview, get_or_load_lut,
    hydrate_adjustments, image_analytics, render_pipeline, validate_expected_preview_image,
};

#[derive(Clone, Debug, Eq, PartialEq)]
struct SoftProofPreviewSession {
    generation: u64,
    source_identity: String,
    source_fingerprint: u64,
}

fn validate_current_source(
    session: &SoftProofPreviewSession,
    current_generation: u64,
    current_source_identity: Option<&str>,
    current_source_fingerprint: Option<u64>,
) -> Result<(), String> {
    if session.generation == current_generation
        && current_source_identity == Some(session.source_identity.as_str())
        && current_source_fingerprint == Some(session.source_fingerprint)
    {
        Ok(())
    } else {
        Err("stale_soft_proof_preview_session".to_string())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportSoftProofPreviewRequest {
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
pub(crate) fn generate_export_soft_proof_preview(
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
    let session = SoftProofPreviewSession {
        generation: state.load_image_generation.load(Ordering::SeqCst) as u64,
        source_identity: loaded_image.path.clone(),
        source_fingerprint: loaded_image.artifact_source.source_fingerprint(),
    };

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

    let encoded = rapidraw_codecs::encode_jpeg_rgb(
        &proof_pixels,
        width,
        height,
        86,
        JpegPreset::Fastest,
        None,
    )
    .map_err(|error| format!("Failed to encode export soft proof preview: {error}"))?;

    state
        .services
        .preview_session
        .with_active_image_session(session.generation, &session.source_identity, || {
            let current_generation = state.load_image_generation.load(Ordering::SeqCst) as u64;
            let (current_source_identity, current_source_fingerprint) = state
                .original_image
                .lock()
                .unwrap()
                .as_ref()
                .map(|image| {
                    (
                        Some(image.path.clone()),
                        Some(image.artifact_source.source_fingerprint()),
                    )
                })
                .unwrap_or((None, None));
            validate_current_source(
                &session,
                current_generation,
                current_source_identity.as_deref(),
                current_source_fingerprint,
            )?;

    if let Some(graph_revision) = request.viewer_sample_graph_revision.as_deref()
        && let Some(proof_image) = RgbImage::from_raw(width, height, proof_pixels.clone())
    {
        let graph_hash = crate::render::artifact_identity::stable_hash(&graph_revision);
        let mut artifact_identity =
            crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
                &loaded_image.artifact_source,
                session.generation,
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

            Ok(Response::new(encoded))
        })
        .unwrap_or_else(|| Err("stale_soft_proof_preview_session".to_string()))
}

#[tauri::command]
pub(crate) fn resolve_export_soft_proof_transform_metadata(
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
    let session = SoftProofPreviewSession {
        generation: state.load_image_generation.load(Ordering::SeqCst) as u64,
        source_identity: loaded_image.path.clone(),
        source_fingerprint: loaded_image.artifact_source.source_fingerprint(),
    };

    let preview_dim = target_resolution.unwrap_or(1920).clamp(512, 8192);
    let preview_image = render_processed_export_soft_proof_preview(
        &state,
        &app_handle,
        &loaded_image,
        &adjustments_clone,
        preview_dim,
    )?;

    let metadata = export::export_processing::export_soft_proof_transform_metadata(
        &preview_image,
        &color_profile,
        &rendering_intent,
        black_point_compensation,
    )?;
    state
        .services
        .preview_session
        .with_active_image_session(session.generation, &session.source_identity, || {
            let current_generation = state.load_image_generation.load(Ordering::SeqCst) as u64;
            let (current_source_identity, current_source_fingerprint) = state
                .original_image
                .lock()
                .unwrap()
                .as_ref()
                .map(|image| {
                    (
                        Some(image.path.clone()),
                        Some(image.artifact_source.source_fingerprint()),
                    )
                })
                .unwrap_or((None, None));
            validate_current_source(
                &session,
                current_generation,
                current_source_identity.as_deref(),
                current_source_fingerprint,
            )?;
            Ok(metadata)
        })
        .unwrap_or_else(|| Err("stale_soft_proof_preview_session".to_string()))
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use super::{SoftProofPreviewSession, validate_current_source};
    use crate::app::commands::uncropped_preview::PreviewSessionService;

    fn session() -> SoftProofPreviewSession {
        SoftProofPreviewSession {
            generation: 7,
            source_identity: "/a.raw".to_string(),
            source_fingerprint: 41,
        }
    }

    #[test]
    fn final_validation_rejects_generation_source_and_revision_changes() {
        let session = session();
        assert!(validate_current_source(&session, 7, Some("/a.raw"), Some(41)).is_ok());
        assert!(validate_current_source(&session, 8, Some("/a.raw"), Some(41)).is_err());
        assert!(validate_current_source(&session, 7, Some("/b.raw"), Some(41)).is_err());
        assert!(validate_current_source(&session, 7, Some("/a.raw"), Some(42)).is_err());
        assert!(validate_current_source(&session, 7, None, None).is_err());
    }

    #[test]
    fn image_switch_waits_for_atomic_publication_then_rejects_stale_work() {
        let service = Arc::new(PreviewSessionService::default());
        let generation = Arc::new(AtomicUsize::new(7));
        service.install_image_session(7, "/a.raw");
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let publisher_service = Arc::clone(&service);
        let publisher = thread::spawn(move || {
            publisher_service.with_active_image_session(7, "/a.raw", || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                "published"
            })
        });
        entered_rx.recv().unwrap();

        let (transition_started_tx, transition_started_rx) = mpsc::channel();
        let (transition_tx, transition_rx) = mpsc::channel();
        let transition_service = Arc::clone(&service);
        let transition_generation = Arc::clone(&generation);
        let transition = thread::spawn(move || {
            transition_started_tx.send(()).unwrap();
            transition_tx
                .send(transition_service.begin_image_load(&transition_generation))
                .unwrap();
        });
        transition_started_rx.recv().unwrap();
        assert!(
            transition_rx
                .recv_timeout(Duration::from_millis(25))
                .is_err()
        );

        release_tx.send(()).unwrap();
        assert_eq!(publisher.join().unwrap(), Some("published"));
        assert_eq!(transition_rx.recv().unwrap(), 8);
        transition.join().unwrap();
        assert_eq!(
            service.with_active_image_session(7, "/a.raw", || {
                panic!("stale soft-proof viewer/event/analytics output published")
            }),
            None
        );
    }
}
