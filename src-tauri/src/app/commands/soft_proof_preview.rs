use std::sync::Arc;

use image::{DynamicImage, RgbImage};
use rapidraw_codecs::JpegPreset;
use serde::Deserialize;
use tauri::{Emitter, ipc::Response};

use crate::app::preview_session_service::validate_expected_preview_image;
use crate::app_state::{
    AnalyticsFrameId, AnalyticsJob, AnalyticsProducts, AnalyticsSamplingPolicy, AppState,
    FrontendPreviewOperationIdentity,
};
use crate::editor::viewer_sampling_service::{
    CachedViewerSampleFrame, SampleablePixels, ViewerSampleCacheSlot,
};
use crate::{color, export, image_analytics};

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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExportSoftProofPreviewRequest {
    active_waveform_channel: Option<String>,
    black_point_compensation: bool,
    compute_waveform: bool,
    color_profile: export::export_processing::ExportColorProfile,
    expected_image_path: Option<String>,
    export_soft_proof_recipe_id: Option<String>,
    edit_document_v2: crate::adjustments::edit_document_v2::EditDocumentV2,
    preview_operation_identity: FrontendPreviewOperationIdentity,
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
    let edit_document = request.edit_document_v2.compile()?;

    let loaded_image = state
        .editor()
        .image_snapshot()
        .ok_or("No original image loaded")?;
    if let Some(expected_image_path) = request.expected_image_path.as_deref() {
        validate_expected_preview_image(&loaded_image.path, expected_image_path)
            .map_err(|error| error.to_string())?;
    }
    request
        .preview_operation_identity
        .validate_for_render(
            &loaded_image.path,
            request.viewer_sample_graph_revision.as_deref(),
            false,
        )
        .map_err(str::to_string)?;
    let loaded_image = crate::image_loader::resolve_loaded_image_for_current_document(
        loaded_image,
        &edit_document,
        &state,
        &app_handle,
    )?;
    let session = SoftProofPreviewSession {
        generation: state.render().preview_session().current_generation(),
        source_identity: loaded_image.path.clone(),
        source_fingerprint: loaded_image.artifact_source.source_fingerprint(),
    };
    let source_image = crate::image_loader::composite_current_source_artifacts(
        loaded_image.image.as_ref(),
        &edit_document,
    )
    .map_err(|error| error.to_string())?
    .into_owned();

    let preview_dim = request.target_resolution.unwrap_or(1920).clamp(512, 8192);
    let preview_image = export::export_processing::render_current_export_preview(
        &state,
        &app_handle,
        &loaded_image.path,
        loaded_image.artifact_source.source_fingerprint(),
        &source_image,
        loaded_image.is_raw,
        &edit_document,
        preview_dim,
        "export_soft_proof_preview",
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
        .render()
        .preview_session()
        .with_active_image_session(session.generation, &session.source_identity, || {
            let current_generation = state.render().preview_session().current_generation();
            let (current_source_identity, current_source_fingerprint) = state
                .editor()
                .image_snapshot()
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
                edit_document.content_fingerprint(),
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
            .editor()
            .publish_viewer_sample(ViewerSampleCacheSlot::SoftProof, frame);
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
        let _ = state.render().analytics().submit(AnalyticsJob {
            path: loaded_image.path,
            frame_id: AnalyticsFrameId::default(),
            preview_operation_identity: Box::new(request.preview_operation_identity),
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
    edit_document_v2: crate::adjustments::edit_document_v2::EditDocumentV2,
    color_profile: export::export_processing::ExportColorProfile,
    rendering_intent: export::export_processing::ExportRenderingIntent,
    black_point_compensation: bool,
    target_resolution: Option<u32>,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<export::export_processing::ExportReceiptMetadata, String> {
    let edit_document = edit_document_v2.compile()?;

    let loaded_image = state
        .editor()
        .image_snapshot()
        .ok_or("No original image loaded")?;
    let loaded_image = crate::image_loader::resolve_loaded_image_for_current_document(
        loaded_image,
        &edit_document,
        &state,
        &app_handle,
    )?;
    let session = SoftProofPreviewSession {
        generation: state.render().preview_session().current_generation(),
        source_identity: loaded_image.path.clone(),
        source_fingerprint: loaded_image.artifact_source.source_fingerprint(),
    };
    let source_image = crate::image_loader::composite_current_source_artifacts(
        loaded_image.image.as_ref(),
        &edit_document,
    )
    .map_err(|error| error.to_string())?
    .into_owned();

    let preview_dim = target_resolution.unwrap_or(1920).clamp(512, 8192);
    let preview_image = export::export_processing::render_current_export_preview(
        &state,
        &app_handle,
        &loaded_image.path,
        loaded_image.artifact_source.source_fingerprint(),
        &source_image,
        loaded_image.is_raw,
        &edit_document,
        preview_dim,
        "resolve_export_soft_proof_metadata",
    )?;

    let metadata = export::export_processing::export_soft_proof_transform_metadata(
        &preview_image,
        &color_profile,
        &rendering_intent,
        black_point_compensation,
    )?;
    state
        .render()
        .preview_session()
        .with_active_image_session(session.generation, &session.source_identity, || {
            let current_generation = state.render().preview_session().current_generation();
            let (current_source_identity, current_source_fingerprint) = state
                .editor()
                .image_snapshot()
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use super::{SoftProofPreviewSession, validate_current_source};
    use crate::app::preview_session_service::PreviewSessionService;

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
        let installed = service.begin_image_load();
        service
            .complete_image_load(&installed, "/a.raw", || ())
            .unwrap();
        let installed_generation = installed.generation();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let publisher_service = Arc::clone(&service);
        let publisher = thread::spawn(move || {
            publisher_service.with_active_image_session(installed_generation, "/a.raw", || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                "published"
            })
        });
        entered_rx.recv().unwrap();

        let (transition_started_tx, transition_started_rx) = mpsc::channel();
        let (transition_tx, transition_rx) = mpsc::channel();
        let transition_service = Arc::clone(&service);
        let transition = thread::spawn(move || {
            transition_started_tx.send(()).unwrap();
            transition_tx
                .send(transition_service.begin_image_load())
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
        assert_eq!(
            transition_rx.recv().unwrap().generation(),
            installed_generation + 1
        );
        transition.join().unwrap();
        assert_eq!(
            service.with_active_image_session(installed_generation, "/a.raw", || {
                panic!("stale soft-proof viewer/event/analytics output published")
            }),
            None
        );
    }
}
