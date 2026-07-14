use std::sync::atomic::Ordering;

use tauri::Emitter;

use crate::AppState;

/// Cancels the active thumbnail job and publishes an empty progress snapshot.
#[tauri::command]
pub(crate) fn cancel_thumbnail_generation(
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    state
        .thumbnail_cancellation_token
        .store(true, Ordering::SeqCst);

    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.total = 0;
    tracker.completed = 0;
    drop(tracker);

    let _ = app_handle.emit(
        crate::events::THUMBNAIL_PROGRESS,
        serde_json::json!({ "current": 0, "total": 0 }),
    );
    Ok(())
}
