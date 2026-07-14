//! Tauri commands for the display-owned WGPU presentation service.
//!
//! The command layer only narrows `AppState` to the GPU/presentation service;
//! mailbox synchronization and sequencing remain owned by the scheduler.

use std::sync::Arc;

use tauri::State;

use crate::AppState;
use crate::WgpuTransformPayload;
use crate::gpu::gpu_display::{DisplayTransformState, PresentationSchedulerReport};
use crate::image_processing::get_or_init_gpu_context;

fn to_display_transform(payload: WgpuTransformPayload) -> DisplayTransformState {
    DisplayTransformState {
        rect: [payload.x, payload.y, payload.width, payload.height],
        clip: [
            payload.clip_x,
            payload.clip_y,
            payload.clip_width,
            payload.clip_height,
        ],
        window: [payload.window_width, payload.window_height],
        bg_primary: payload.bg_primary,
        bg_secondary: payload.bg_secondary,
        pixelated: payload.pixelated,
    }
}

#[tauri::command]
pub(crate) fn update_wgpu_transform(
    payload: WgpuTransformPayload,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<u64, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    context
        .presentation
        .submit_transform(to_display_transform(payload))
}

#[tauri::command]
pub(crate) async fn flush_wgpu_presentation(
    sequence: u64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let presentation = state
        .gpu_context
        .lock()
        .unwrap()
        .as_ref()
        .map(|context| Arc::clone(&context.presentation));
    match presentation {
        Some(presentation) => presentation.flush(sequence).await,
        None => Ok(()),
    }
}

#[tauri::command]
pub(crate) fn get_wgpu_presentation_report(
    state: State<'_, AppState>,
) -> Option<PresentationSchedulerReport> {
    state
        .gpu_context
        .lock()
        .unwrap()
        .as_ref()
        .map(|context| context.presentation.report())
}

#[tauri::command]
pub(crate) fn get_gpu_pipeline_report(
    state: State<'_, AppState>,
) -> Option<crate::gpu::pipeline_registry::GpuPipelineReport> {
    state
        .gpu_context
        .lock()
        .unwrap()
        .as_ref()
        .map(|context| context.pipeline_registry.report())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::thread;

    #[test]
    fn transform_command_payload_uses_frontend_camel_case_schema() {
        let payload: WgpuTransformPayload = serde_json::from_value(json!({
            "windowWidth": 1920.0,
            "windowHeight": 1080.0,
            "x": 4.0,
            "y": 8.0,
            "width": 640.0,
            "height": 480.0,
            "clipX": 0.0,
            "clipY": 0.0,
            "clipWidth": 640.0,
            "clipHeight": 480.0,
            "bgPrimary": [0.1, 0.2, 0.3, 1.0],
            "bgSecondary": [0.4, 0.5, 0.6, 1.0],
            "pixelated": false
        }))
        .expect("camel-case transform payload schema");
        let transform = to_display_transform(payload);
        assert_eq!(transform.window, [1920.0, 1080.0]);
        assert_eq!(transform.rect, [4.0, 8.0, 640.0, 480.0]);
        assert_eq!(transform.bg_secondary, [0.4, 0.5, 0.6, 1.0]);
    }

    #[test]
    fn transform_mapping_is_safe_for_concurrent_command_calls() {
        let payload = || WgpuTransformPayload {
            window_width: 1920.0,
            window_height: 1080.0,
            x: 10.0,
            y: 20.0,
            width: 800.0,
            height: 600.0,
            clip_x: 0.0,
            clip_y: 0.0,
            clip_width: 800.0,
            clip_height: 600.0,
            bg_primary: [0.0; 4],
            bg_secondary: [1.0; 4],
            pixelated: true,
        };
        let workers = (0..8)
            .map(|_| {
                let payload = payload();
                thread::spawn(move || to_display_transform(payload))
            })
            .collect::<Vec<_>>();
        for worker in workers {
            let transform = worker.join().expect("transform mapping worker");
            assert_eq!(transform.rect, [10.0, 20.0, 800.0, 600.0]);
            assert!(transform.pixelated);
        }
    }
}
