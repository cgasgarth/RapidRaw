use std::borrow::Cow;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use image::GenericImageView;

use crate::app_settings::load_settings_or_default;
use crate::cache_utils::calculate_geometry_hash;
use crate::editor::viewer_sampling_service::{
    CachedViewerSampleFrame, SampleablePixels, ViewerSampleCacheSlot,
};
use crate::image_codecs::encode_jpeg_data_url;
use crate::image_processing::{apply_cpu_default_raw_processing, downscale_f32_image};
use crate::{AppState, apply_all_transformations, hydrate_adjustments};

#[derive(Clone, Debug, Eq, PartialEq)]
struct OriginalPreviewSession {
    generation: u64,
    source_identity: String,
    source_fingerprint: u64,
}

fn validate_source_identity(expected: &str, loaded: &str) -> Result<(), String> {
    if loaded == expected {
        Ok(())
    } else {
        Err(format!(
            "stale_original_preview_source: expected {expected} but loaded {loaded}"
        ))
    }
}

fn validate_current_source(
    session: &OriginalPreviewSession,
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
        Err("stale_original_preview_session".to_string())
    }
}

#[tauri::command]
pub(crate) fn generate_original_transformed_preview(
    js_adjustments: serde_json::Value,
    expected_image_path: String,
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
    validate_source_identity(&expected_image_path, &loaded_image.path)?;
    let session = OriginalPreviewSession {
        generation: state.load_image_generation.load(Ordering::SeqCst) as u64,
        source_identity: loaded_image.path.clone(),
        source_fingerprint: loaded_image.artifact_source.source_fingerprint(),
    };

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

    let (width, height) = transformed_full_res.dimensions();
    let transformed_image = if width > preview_dim || height > preview_dim {
        downscale_f32_image(transformed_full_res.as_ref(), preview_dim, preview_dim)
    } else {
        transformed_full_res.into_owned()
    };
    let encoded = encode_jpeg_data_url(&transformed_image, 80)?;

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

            if let Some(graph_revision) = viewer_sample_graph_revision {
                let graph_hash = crate::render::artifact_identity::stable_hash(&graph_revision);
                let mut artifact_identity =
                    crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
                        &loaded_image.artifact_source,
                        session.generation,
                        graph_hash,
                        session.source_fingerprint,
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
                    pixels: SampleablePixels::native(Arc::new(transformed_image)),
                    image_identity: session.source_identity.clone(),
                    space_label: "Original · Display encoded sRGB".to_string(),
                };
                state
                    .services
                    .viewer_sampling
                    .publish(ViewerSampleCacheSlot::Original, frame);
            }
            Ok(encoded)
        })
        .unwrap_or_else(|| Err("stale_original_preview_session".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    use crate::app::commands::uncropped_preview::PreviewSessionService;

    fn session() -> OriginalPreviewSession {
        OriginalPreviewSession {
            generation: 7,
            source_identity: "/a.raw".to_string(),
            source_fingerprint: 41,
        }
    }

    #[test]
    fn expected_source_must_match_the_captured_image() {
        assert!(validate_source_identity("/a.raw", "/a.raw").is_ok());
        assert_eq!(
            validate_source_identity("/b.raw", "/a.raw").unwrap_err(),
            "stale_original_preview_source: expected /b.raw but loaded /a.raw"
        );
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
    fn image_load_transition_closes_the_final_publication_gate() {
        let service = PreviewSessionService::default();
        let generation = AtomicUsize::new(7);
        service.install_image_session(7, "/a.raw");
        assert_eq!(
            service.with_active_image_session(7, "/a.raw", || "published"),
            Some("published")
        );

        assert_eq!(service.begin_image_load(&generation), 8);
        assert_eq!(
            service.with_active_image_session(7, "/a.raw", || {
                panic!("stale original preview published during image load")
            }),
            None
        );
    }
}
