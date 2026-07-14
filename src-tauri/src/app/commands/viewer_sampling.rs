use crate::app_state::AppState;
use crate::editor::viewer_sampling_service::{ViewerSampleRequest, ViewerSampleResponse};

#[tauri::command]
pub(crate) fn sample_viewer_pixel(
    request: ViewerSampleRequest,
    state: tauri::State<'_, AppState>,
) -> ViewerSampleResponse {
    state.services.viewer_sampling.sample(request)
}
