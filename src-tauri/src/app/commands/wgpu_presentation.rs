//! Tauri commands for the display-owned WGPU presentation service.
//!
//! The command layer only narrows `AppState` to the GPU/presentation service;
//! mailbox synchronization and sequencing remain owned by the scheduler.

use tauri::State;

use crate::AppState;
use crate::gpu::gpu_display::{DisplayTransformState, PresentationSchedulerReport};
use crate::image_processing::get_or_init_gpu_context;

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
    let presentation = state.gpu().presentation_snapshot();
    match presentation {
        Some(presentation) => presentation.flush(sequence).await,
        None => Ok(()),
    }
}

#[tauri::command]
pub(crate) fn get_wgpu_presentation_report(
    state: State<'_, AppState>,
) -> Option<PresentationSchedulerReport> {
    state.gpu().presentation_report()
}

#[tauri::command]
pub(crate) fn get_gpu_pipeline_report(
    state: State<'_, AppState>,
) -> Option<crate::gpu::pipeline_registry::GpuPipelineReport> {
    state.gpu().pipeline_report()
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

#[cfg(all(test, feature = "tauri-test"))]
mod ipc_tests {
    use super::*;
    use serde_json::{Value, json};
    use tauri::{ipc::InvokeBody, webview::InvokeRequest};

    fn invoke(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        command: &str,
        body: Value,
        callback: u32,
    ) -> Value {
        tauri::test::get_ipc_response(
            webview,
            InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(callback),
                error: tauri::ipc::CallbackFn(callback + 1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .unwrap_or_else(|error| panic!("{command} IPC failed: {error}"))
        .deserialize()
        .unwrap()
    }

    #[test]
    fn production_report_and_flush_commands_use_gpu_capability_without_a_context() {
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .invoke_handler(tauri::generate_handler![
                flush_wgpu_presentation,
                get_wgpu_presentation_report,
                get_gpu_pipeline_report,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        assert_eq!(
            invoke(&webview, "get_wgpu_presentation_report", json!({}), 0),
            Value::Null
        );
        assert_eq!(
            invoke(&webview, "get_gpu_pipeline_report", json!({}), 2),
            Value::Null
        );
        assert_eq!(
            invoke(
                &webview,
                "flush_wgpu_presentation",
                json!({ "sequence": 17 }),
                4,
            ),
            Value::Null
        );
    }
}
