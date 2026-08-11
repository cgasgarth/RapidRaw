use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::timeout;
use uuid::Uuid;

use super::{UI_TIMEOUT, adjustments};
use crate::{AppState, McpEditorState};

pub(super) fn require_active_session(
    app_handle: &AppHandle,
    expected_path: Option<&str>,
) -> Result<McpEditorState, String> {
    let state = app_handle.state::<AppState>();
    let editor_state = state
        .mcp
        .editor_state
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| {
            "RapidRAW MCP is available only while an image is loaded in the editor session"
                .to_string()
        })?;
    if let Some(expected_path) = expected_path
        && editor_state.path != expected_path
    {
        return Err(format!(
            "image is not in the active RapidRAW editor session: {expected_path}"
        ));
    }
    Ok(editor_state)
}

pub(super) async fn request_ui(
    app_handle: &AppHandle,
    kind: &str,
    payload: Value,
) -> Result<Value, String> {
    let request_id = Uuid::new_v4().to_string();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let state = app_handle.state::<AppState>();
    state
        .mcp
        .ui_waiters
        .lock()
        .unwrap()
        .insert(request_id.clone(), sender);

    let mut command = payload;
    if let Some(object) = command.as_object_mut() {
        object.insert("requestId".to_string(), Value::String(request_id.clone()));
        object.insert("kind".to_string(), Value::String(kind.to_string()));
    }
    if let Err(error) = app_handle.emit("mcp-command", command) {
        state.mcp.ui_waiters.lock().unwrap().remove(&request_id);
        return Err(error.to_string());
    }

    match timeout(UI_TIMEOUT, receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("MCP UI bridge was disconnected".to_string()),
        Err(_) => {
            state.mcp.ui_waiters.lock().unwrap().remove(&request_id);
            Err("RapidRAW UI did not acknowledge the MCP command in time".to_string())
        }
    }
}

pub fn ui_response(
    request_id: String,
    response: Value,
    error: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sender = state
        .mcp
        .ui_waiters
        .lock()
        .unwrap()
        .remove(&request_id)
        .ok_or_else(|| "unknown or expired MCP UI request".to_string())?;
    sender
        .send(error.map_or(Ok(response), Err))
        .map_err(|_| "MCP request receiver was dropped".to_string())
}

pub fn sync_editor_state(
    path: String,
    adjustments: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    adjustments::validate_adjustments(&adjustments)?;
    let revision = adjustments::revision_for(&path, &adjustments);
    *state.mcp.editor_state.lock().unwrap() = Some(McpEditorState {
        path: path.clone(),
        adjustments: adjustments.clone(),
        revision: revision.clone(),
    });
    Ok(json!({ "imagePath": path, "adjustments": adjustments, "editRevision": revision }))
}

pub fn clear_editor_session(state: State<'_, AppState>) {
    *state.mcp.editor_state.lock().unwrap() = None;
}

pub(super) fn editor_state_value(state: &McpEditorState) -> Value {
    json!({
        "imagePath": state.path,
        "adjustments": state.adjustments,
        "editRevision": state.revision,
        "isSelected": true,
    })
}

pub(super) fn ensure_path_exists(path: &str, directory: bool) -> Result<(), String> {
    let (source_path, _) = crate::file_management::parse_virtual_path(path);
    let valid = if directory {
        source_path.is_dir()
    } else {
        source_path.is_file()
    };
    if valid {
        Ok(())
    } else {
        Err(format!("path does not exist or has the wrong type: {path}"))
    }
}

pub(crate) fn tone_mapper_override_for_path(state: &AppState, path: &str) -> Option<u32> {
    let editor_state = state.mcp.editor_state.lock().unwrap();
    let tone_mapper = editor_state
        .as_ref()
        .filter(|state| state.path == path)
        .and_then(|state| state.adjustments.get("toneMapper"))
        .and_then(Value::as_str)?;
    Some(if tone_mapper == "agx" { 1 } else { 0 })
}
