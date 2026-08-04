use std::collections::HashMap;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::GenericImageView;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{adjustments, ui};
use crate::AppState;

pub(super) fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "list_images",
            "description": "List a page of supported images in a directory.",
            "inputSchema": { "type": "object", "properties": {
                "path": { "type": "string", "description": "Directory path." },
                "recursive": { "type": "boolean", "default": false },
                "offset": { "type": "integer", "minimum": 0, "default": 0 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 500, "default": 100 }
            }, "required": ["path"] }
        }),
        json!({
            "name": "select_image",
            "description": "Load an image into the RapidRAW editor UI.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" }
            }, "required": ["imagePath"] }
        }),
        json!({
            "name": "get_image_state",
            "description": "Get the current draft adjustments and edit revision for an image.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" }
            }, "required": ["imagePath"] }
        }),
        json!({
            "name": "get_active_image_state",
            "description": "Get the image currently loaded in the active RapidRAW editor session.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_histogram_data",
            "description": "Get the existing RapidRAW histogram for the active edited image, with 256 red, green, blue, and luma bins.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" }
            }, "required": ["imagePath"] }
        }),
        json!({
            "name": "set_adjustments",
            "description": "Replace the full non-destructive adjustment snapshot. For one or more field changes while leaving omitted fields unchanged, use update_adjustments.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" },
                "adjustments": adjustments::adjustments_schema(),
                "expectedRevision": { "type": "string" }
            }, "required": ["imagePath", "adjustments"] }
        }),
        json!({
            "name": "update_adjustments",
            "description": "Update one or more adjustment fields. Omitted fields, including nested fields, remain unchanged; supplied values override the existing edit.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" },
                "changes": adjustments::adjustments_schema(),
                "expectedRevision": { "type": "string" }
            }, "required": ["imagePath", "changes"] }
        }),
        json!({
            "name": "reset_adjustments",
            "description": "Reset an image's adjustments through the editor UI.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" },
                "expectedRevision": { "type": "string" }
            }, "required": ["imagePath"] }
        }),
        json!({
            "name": "apply_auto_adjustments",
            "description": "Calculate and apply RapidRAW's automatic adjustments.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" },
                "expectedRevision": { "type": "string" }
            }, "required": ["imagePath"] }
        }),
        json!({
            "name": "get_preview",
            "description": "Render the current or supplied edit as a JPEG image for the agent.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" },
                "adjustments": adjustments::adjustments_schema(),
                "maxDimension": { "type": "integer", "minimum": 128, "maximum": 4096, "default": 1280 },
                "expectedRevision": { "type": "string" }
            }, "required": ["imagePath"] }
        }),
    ]
}

pub(super) async fn call_tool(
    app_handle: &AppHandle,
    headers: &HashMap<String, String>,
    params: Value,
) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((-32602, "tools/call requires params.name".to_string()))?;
    if let Some(header_name) = headers.get("mcp-name")
        && header_name != name
    {
        return Err((
            -32602,
            "Mcp-Name does not match the requested tool".to_string(),
        ));
    }
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let result = match name {
        "list_images" => list_images(app_handle, &arguments),
        "select_image" => select_image(app_handle, &arguments).await,
        "get_image_state" => get_image_state(app_handle, &arguments),
        "get_active_image_state" => get_active_image_state(app_handle),
        "get_histogram_data" => get_histogram_data(app_handle, &arguments).await,
        "set_adjustments" => set_adjustments(app_handle, &arguments).await,
        "update_adjustments" => update_adjustments(app_handle, &arguments).await,
        "reset_adjustments" => reset_adjustments(app_handle, &arguments).await,
        "apply_auto_adjustments" => apply_auto_adjustments(app_handle, &arguments).await,
        "get_preview" => get_preview(app_handle, &arguments).await,
        _ => Err("unknown RapidRAW tool".to_string()),
    };

    match result {
        Ok(value) => Ok(tool_success(value)),
        Err(error) => Ok(tool_error(&error)),
    }
}

fn list_images(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_string(arguments, "path")?;
    ui::ensure_path_exists(&path, true)?;
    let recursive = arguments
        .get("recursive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let offset = arguments.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .clamp(1, 500) as usize;
    let images = if recursive {
        crate::file_management::list_images_recursive(path, app_handle.clone())?
    } else {
        crate::file_management::list_images_in_dir(path, app_handle.clone())?
    };
    let total = images.len();
    let images = images
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    Ok(json!({
        "images": images,
        "offset": offset,
        "limit": limit,
        "total": total,
        "hasMore": offset.saturating_add(images.len()) < total,
    }))
}

async fn select_image(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    ui::require_active_session(app_handle, None)?;
    ui::ensure_path_exists(&path, false)?;
    ui::request_ui(app_handle, "select-image", json!({ "path": path })).await
}

fn get_image_state(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    ui::require_active_session(app_handle, Some(&path)).map(|state| ui::editor_state_value(&state))
}

fn get_active_image_state(app_handle: &AppHandle) -> Result<Value, String> {
    ui::require_active_session(app_handle, None).map(|state| ui::editor_state_value(&state))
}

async fn get_histogram_data(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    ui::require_active_session(app_handle, Some(&path))?;
    ui::request_ui(app_handle, "get-histogram", json!({ "path": path })).await
}

async fn set_adjustments(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    let adjustments = arguments
        .get("adjustments")
        .cloned()
        .ok_or("adjustments is required".to_string())?;
    adjustments::validate_adjustments(&adjustments)?;
    check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
    ui::require_active_session(app_handle, Some(&path))?;
    ui::request_ui(
        app_handle,
        "apply-adjustments",
        json!({ "path": path, "adjustments": adjustments, "resetHistory": false }),
    )
    .await
}

async fn update_adjustments(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    let changes = arguments
        .get("changes")
        .cloned()
        .ok_or("changes is required".to_string())?;
    adjustments::validate_adjustments(&changes)?;
    check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
    let current = get_image_state(app_handle, arguments)?;
    let current_adjustments = current
        .get("adjustments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let merged = adjustments::merge_adjustments(current_adjustments, changes)?;
    ui::require_active_session(app_handle, Some(&path))?;
    ui::request_ui(
        app_handle,
        "apply-adjustments",
        json!({ "path": path, "adjustments": merged, "resetHistory": false }),
    )
    .await
}

async fn reset_adjustments(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
    ui::require_active_session(app_handle, Some(&path))?;
    ui::request_ui(app_handle, "reset-adjustments", json!({ "path": path })).await
}

async fn apply_auto_adjustments(
    app_handle: &AppHandle,
    arguments: &Value,
) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
    ui::require_active_session(app_handle, Some(&path))?;
    let state = app_handle.state::<AppState>();
    let (image, _) = crate::get_original_image(&state)?;
    let auto = crate::image_processing::perform_auto_analysis(&image);
    let auto_json = crate::image_processing::auto_results_to_json(&auto);
    let current = get_image_state(app_handle, arguments)?;
    let merged = adjustments::merge_adjustments(
        current
            .get("adjustments")
            .cloned()
            .unwrap_or_else(|| json!({})),
        auto_json,
    )?;
    ui::request_ui(
        app_handle,
        "apply-adjustments",
        json!({ "path": path, "adjustments": merged, "resetHistory": false }),
    )
    .await
}

async fn get_preview(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    ui::require_active_session(app_handle, Some(&path))?;
    let adjustments = if let Some(adjustments) = arguments.get("adjustments") {
        adjustments::validate_adjustments(adjustments)?;
        adjustments.clone()
    } else {
        check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
        get_image_state(app_handle, arguments)?
            .get("adjustments")
            .cloned()
            .unwrap_or_else(|| json!({}))
    };
    let max_dimension = arguments
        .get("maxDimension")
        .and_then(Value::as_u64)
        .unwrap_or(1280)
        .clamp(128, 4096) as u32;
    let bytes = crate::generate_preview_bytes_for_path(
        path.clone(),
        adjustments.clone(),
        max_dimension,
        app_handle.clone(),
    )
    .await?;
    let revision = adjustments::revision_for(&path, &adjustments);
    let (width, height) = image::load_from_memory(&bytes)
        .map(|image| image.dimensions())
        .unwrap_or((0, 0));
    Ok(json!({
        "imagePath": path,
        "editRevision": revision,
        "mimeType": "image/jpeg",
        "width": width,
        "height": height,
        "content": [{ "type": "image", "data": BASE64.encode(bytes), "mimeType": "image/jpeg" }],
    }))
}

async fn check_expected_revision(
    app_handle: &AppHandle,
    path: &str,
    expected: Option<&Value>,
) -> Result<(), String> {
    let Some(expected) = expected.and_then(Value::as_str) else {
        return Ok(());
    };
    let current = get_image_state(app_handle, &json!({ "imagePath": path }))?;
    let actual = current
        .get("editRevision")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if expected != actual {
        return Err(format!(
            "edit revision conflict: expected {expected}, current {actual}"
        ));
    }
    Ok(())
}

fn tool_success(value: Value) -> Value {
    if let Some(content) = value.get("content").and_then(Value::as_array) {
        let structured_content = value
            .as_object()
            .map(|object| {
                let mut object = object.clone();
                object.remove("content");
                Value::Object(object)
            })
            .unwrap_or(Value::Null);
        return json!({
            "content": content,
            "structuredContent": structured_content,
            "isError": false,
        });
    }
    json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&value).unwrap_or_default() }],
        "structuredContent": value,
        "isError": false,
    })
}

fn tool_error(error: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": error }],
        "isError": true,
    })
}

fn required_string(arguments: &Value, key: &str) -> Result<String, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("{key} is required"))
}

fn required_image_path(arguments: &Value) -> Result<String, String> {
    let path = required_string(arguments, "imagePath")?;
    ui::ensure_path_exists(&path, false)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_tool_result_keeps_image_content() {
        let result = tool_success(json!({
            "imagePath": "/tmp/example.raw",
            "content": [{ "type": "image", "data": "abc", "mimeType": "image/jpeg" }]
        }));
        assert_eq!(result["content"][0]["type"], "image");
        assert_eq!(result["structuredContent"]["imagePath"], "/tmp/example.raw");
        assert!(result["structuredContent"].get("content").is_none());
    }

    #[test]
    fn tool_schemas_expose_pagination_and_adjustment_bounds() {
        let definitions = tool_definitions();
        let list_images = definitions
            .iter()
            .find(|tool| tool["name"] == "list_images")
            .expect("list_images tool");
        assert_eq!(
            list_images["inputSchema"]["properties"]["limit"]["maximum"],
            500
        );

        let schema = adjustments::adjustments_schema();
        assert_eq!(schema["properties"]["exposure"]["minimum"], -5.0);
        assert_eq!(schema["properties"]["hue"]["maximum"], 180.0);
        assert_eq!(schema["properties"]["toneMapper"]["enum"][0], "basic");
        assert_eq!(
            schema["properties"]["colorGrading"]["properties"]["blending"]["maximum"],
            100.0
        );
        assert_eq!(
            schema["properties"]["colorGrading"]["properties"]["shadows"]["properties"]["hue"]["maximum"],
            360.0
        );
        assert_eq!(
            schema["properties"]["parametricCurve"]["properties"]["luma"]["properties"]["whiteLevel"]
                ["minimum"],
            -100.0
        );
        assert_eq!(
            schema["properties"]["curves"]["properties"]["red"]["items"]["properties"]["x"]["maximum"],
            255.0
        );
        assert!(
            definitions
                .iter()
                .any(|tool| tool["name"] == "get_histogram_data")
        );
    }
}
