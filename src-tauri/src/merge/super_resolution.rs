pub(crate) mod apply;
mod artifact;
mod candidate;
mod cfa_cache;
mod cfa_observations;
mod fallback;
mod fused_color;
pub(crate) mod job;
mod motion;
pub(crate) mod planning_service;
mod quality;
mod raw_frame;
mod reconstruction;
mod registration;
mod review;
mod runtime;
mod sharpen;
pub(crate) mod single_image;
mod support;
mod tiles;

pub use raw_frame::SuperResolutionReadinessSettings;
pub use runtime::SuperResolutionDryRunPlan;

use crate::app_state::AppState;

#[tauri::command]
pub async fn plan_super_resolution(
    paths: Vec<String>,
    settings: SuperResolutionReadinessSettings,
    state: tauri::State<'_, AppState>,
) -> Result<SuperResolutionDryRunPlan, String> {
    runtime::plan_super_resolution(paths, settings, state).await
}

#[tauri::command]
pub fn cancel_super_resolution_registration(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    runtime::cancel_super_resolution_registration(state)
}

#[cfg(test)]
mod command_tests {
    #[cfg(feature = "tauri-test")]
    use tauri::{Manager, ipc::InvokeBody, webview::InvokeRequest};

    #[cfg(feature = "tauri-test")]
    use super::*;

    #[cfg(feature = "tauri-test")]
    #[test]
    fn ipc_cancel_invalidates_burst_sr_generation() {
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .invoke_handler(tauri::generate_handler![
                cancel_super_resolution_registration
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let state = app.state::<AppState>();
        let handle = state.services.burst_sr.begin_plan();

        let _ = tauri::test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "cancel_super_resolution_registration".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );

        assert!(!state.services.burst_sr.is_current(handle));
    }
}
