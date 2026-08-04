mod adjustments;
mod http;
mod tools;
mod ui;

pub use http::{initialize_runtime, start_server};
pub(crate) use ui::tone_mapper_override_for_path;

use crate::AppState;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub fn ui_response(
    request_id: String,
    response: Value,
    error: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    ui::ui_response(request_id, response, error, state)
}

#[tauri::command]
pub fn sync_editor_state(
    path: String,
    adjustments: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ui::sync_editor_state(path, adjustments, state)
}

#[tauri::command]
pub fn clear_editor_session(state: State<'_, AppState>) {
    ui::clear_editor_session(state);
}

use std::time::Duration;

pub(crate) const PROTOCOL_VERSION: &str = "2026-07-28";
pub(crate) const DEFAULT_PORT: u16 = 7790;
pub(crate) const MAX_HEADER_BYTES: usize = 32 * 1024;
pub(crate) const MAX_BODY_BYTES: usize = 12 * 1024 * 1024;
pub(crate) const UI_TIMEOUT: Duration = Duration::from_secs(45);
