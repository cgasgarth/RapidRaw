//! Edited-preview command boundary.
//!
//! Source currentness is read from `PreviewSessionService` before scheduler
//! submission. Its mutex is never held across worker submission or await.

use std::sync::Arc;

use serde::Deserialize;
use tauri::ipc::Response;

use crate::app_state::{AppState, PreviewJob};
use crate::preview_scheduler::PreviewCompletion;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApplyAdjustmentsRequest {
    edit_document_v2: crate::adjustments::edit_document_v2::EditDocumentV2,
    expected_image_path: String,
    is_interactive: bool,
    target_resolution: Option<u32>,
    roi: Option<(f32, f32, f32, f32)>,
    compute_waveform: bool,
    active_waveform_channel: Option<String>,
    viewer_sample_graph_revision: Option<String>,
}

fn map_preview_completion(completion: PreviewCompletion) -> Result<Response, String> {
    match completion {
        PreviewCompletion::Rendered { bytes, .. } => Ok(Response::new(bytes)),
        PreviewCompletion::Superseded { .. } => Err("preview_superseded".to_string()),
        PreviewCompletion::Cancelled { .. } => Err("preview_cancelled".to_string()),
        PreviewCompletion::Failed { code, message } => Err(format!("{code}: {message}")),
    }
}

#[tauri::command]
pub(crate) async fn apply_adjustments(
    request: ApplyAdjustmentsRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Response, String> {
    state
        .services
        .preview_session
        .validate_active_source(&request.expected_image_path)
        .map_err(|error| error.to_string())?;
    let render_adjustments = request.edit_document_v2.into_render_adjustments()?;
    let (tx, rx) = tokio::sync::oneshot::channel();
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

    rx.await
        .map_err(|_| "preview_worker_stopped".to_string())
        .and_then(map_preview_completion)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preview_session_service::ActiveImageSourceError;

    #[test]
    fn source_errors_preserve_the_command_contract() {
        assert_eq!(
            ActiveImageSourceError::Missing.to_string(),
            "No original image loaded"
        );
        assert_eq!(
            ActiveImageSourceError::Stale.to_string(),
            "Preview request rejected: expected image is no longer loaded"
        );
    }

    #[test]
    fn terminal_scheduler_states_keep_typed_frontend_errors() {
        assert_eq!(
            map_preview_completion(PreviewCompletion::Superseded {
                by_generation: 5,
                stage: crate::preview_scheduler::PreviewStage::Publish,
            })
            .err()
            .as_deref(),
            Some("preview_superseded")
        );
        assert_eq!(
            map_preview_completion(PreviewCompletion::Cancelled {
                stage: crate::preview_scheduler::PreviewStage::Publish,
            })
            .err()
            .as_deref(),
            Some("preview_cancelled")
        );
        assert_eq!(
            map_preview_completion(PreviewCompletion::Failed {
                code: "render_failed",
                message: "boom".to_string(),
            })
            .err()
            .as_deref(),
            Some("render_failed: boom")
        );
    }
}
