mod raw_frame;
mod registration;
mod runtime;
mod single_image;

pub use raw_frame::SuperResolutionReadinessSettings;
pub use runtime::SuperResolutionDryRunPlan;
use serde::Serialize;

use crate::app_state::AppState;

#[derive(Serialize)]
#[serde(untagged)]
pub enum SuperResolutionPlanResponse {
    Burst(SuperResolutionDryRunPlan),
    SingleImage(single_image::SingleImageSwinIrPreviewPlan),
}

#[tauri::command]
pub async fn plan_super_resolution(
    paths: Vec<String>,
    settings: SuperResolutionReadinessSettings,
    state: tauri::State<'_, AppState>,
) -> Result<SuperResolutionPlanResponse, String> {
    if settings.source_mode == single_image::SOURCE_MODE {
        return single_image::plan(&paths).map(SuperResolutionPlanResponse::SingleImage);
    }
    runtime::plan_super_resolution(paths, settings, state)
        .await
        .map(SuperResolutionPlanResponse::Burst)
}

#[tauri::command]
pub fn cancel_super_resolution_registration(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    runtime::cancel_super_resolution_registration(state)
}
