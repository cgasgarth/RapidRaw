mod cfa_observations;
mod fused_color;
mod raw_frame;
mod reconstruction;
mod registration;
mod runtime;
pub(crate) mod single_image;
mod support;

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
