use crate::AppState;
use crate::library::thumbnail_generation_service::ThumbnailOperationAuthority;
use crate::thumbnail_scheduler::ThumbnailGeneration;

/// Cancels only the exact active thumbnail operation and publishes its terminal snapshot.
#[tauri::command]
pub(crate) fn cancel_thumbnail_generation(
    generation: ThumbnailGeneration,
    operation_id: u64,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    let authority = ThumbnailOperationAuthority {
        generation,
        operation_id,
    };
    let Some(emission) = state.services.thumbnails.cancel(authority) else {
        return Ok(false);
    };
    crate::file_management::emit_thumbnail_lifecycle(&app_handle, &emission);
    Ok(true)
}
