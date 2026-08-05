use std::collections::HashMap;
use std::path::Path;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::GenericImageView;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{adjustments, ui};
use crate::AppState;
use crate::export_processing::{
    ExportRequest, ExportSettings, ResizeMode, ResizeOptions, WatermarkAnchor, WatermarkSettings,
};

fn export_settings_schema() -> Value {
    json!({
        "type": "object",
        "description": "Optional export settings. Omitted fields use RapidRAW's export-panel defaults.",
        "additionalProperties": false,
        "properties": {
            "jpegQuality": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 90,
                "description": "Quality for JPEG, WebP, and JXL output. JXL quality 100 is lossless."
            },
            "resize": {
                "type": ["object", "null"],
                "description": "Set to null to export at the processed image size.",
                "additionalProperties": false,
                "properties": {
                    "mode": { "type": "string", "enum": ["longEdge", "shortEdge", "width", "height"] },
                    "value": { "type": "integer", "minimum": 1, "description": "Target dimension in pixels." },
                    "dontEnlarge": { "type": "boolean", "default": true }
                },
                "required": ["mode", "value", "dontEnlarge"]
            },
            "keepMetadata": { "type": "boolean", "default": true },
            "preserveTimestamps": { "type": "boolean", "default": false },
            "stripGps": { "type": "boolean", "default": true, "description": "Remove GPS metadata when keepMetadata is true." },
            "filenameTemplate": {
                "type": ["string", "null"],
                "default": "{original_filename}_edited",
                "description": "Filename stem template. Variables: {original_filename}, {sequence}, {YYYY}, {MM}, {DD}, {hh}, {mm}."
            },
            "watermark": {
                "type": ["object", "null"],
                "description": "Optional watermark image and placement.",
                "additionalProperties": false,
                "properties": {
                    "path": { "type": "string", "description": "Path to the watermark image." },
                    "anchor": { "type": "string", "enum": ["topLeft", "topCenter", "topRight", "centerLeft", "center", "centerRight", "bottomLeft", "bottomCenter", "bottomRight"] },
                    "scale": { "type": "number", "minimum": 1, "maximum": 50, "description": "Watermark width as a percentage of the source image's shortest edge." },
                    "spacing": { "type": "number", "minimum": 0, "maximum": 25, "description": "Distance from the edge as a percentage of the shortest edge." },
                    "opacity": { "type": "number", "minimum": 0, "maximum": 100 }
                },
                "required": ["path", "anchor", "scale", "spacing", "opacity"]
            },
            "exportMasks": { "type": "boolean", "default": false },
            "preserveFolders": { "type": "boolean", "default": false, "description": "Preserve paths relative to baseOriginFolders." }
        }
    })
}

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
        json!({
            "name": "export_images",
            "description": "Export one or more images to an output directory and wait for completion. The active image's current editor edit is used for that image; other images use their sidecars.",
            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {
                "imagePaths": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Source image paths." },
                "outputDirectory": { "type": "string", "description": "Directory to create/use for exported files." },
                "outputFormat": { "type": "string", "enum": ["jpg", "jpeg", "png", "tiff", "webp", "jxl", "avif", "cube"], "default": "jpg" },
                "exportSettings": export_settings_schema(),
                "baseOriginFolders": { "type": "array", "items": { "type": "string" }, "description": "Optional source roots used when preserveFolders is true." }
            }, "required": ["imagePaths", "outputDirectory"] }
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
        "export_images" => export_images(app_handle, &arguments).await,
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

async fn export_images(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let image_paths = arguments
        .get("imagePaths")
        .and_then(Value::as_array)
        .ok_or("imagePaths is required and must be an array".to_string())?;
    if image_paths.is_empty() {
        return Err("imagePaths must contain at least one image path".to_string());
    }

    let paths = image_paths
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let path = value
                .as_str()
                .filter(|path| !path.is_empty())
                .ok_or_else(|| format!("imagePaths[{index}] must be a non-empty string"))?;
            ui::ensure_path_exists(path, false)?;
            Ok(path.to_string())
        })
        .collect::<Result<Vec<_>, String>>()?;

    let output_directory = required_string(arguments, "outputDirectory")?;
    let output_path = Path::new(&output_directory);
    if output_path.exists() && !output_path.is_dir() {
        return Err(format!(
            "outputDirectory is not a directory: {output_directory}"
        ));
    }
    std::fs::create_dir_all(output_path).map_err(|error| {
        format!("could not create outputDirectory '{output_directory}': {error}")
    })?;

    let output_format = match arguments.get("outputFormat") {
        None => "jpg".to_string(),
        Some(value) => value
            .as_str()
            .ok_or("outputFormat must be a string".to_string())?
            .to_ascii_lowercase(),
    };
    if !matches!(
        output_format.as_str(),
        "jpg" | "jpeg" | "png" | "tiff" | "webp" | "jxl" | "avif" | "cube"
    ) {
        return Err(format!(
            "outputFormat '{output_format}' is unsupported; use jpg, jpeg, png, tiff, webp, jxl, avif, or cube"
        ));
    }

    let active = ui::require_active_session(app_handle, None)?;
    let export_settings = parse_export_settings(arguments.get("exportSettings"))?;
    let base_origin_folders = parse_base_origin_folders(arguments, &paths)?;

    crate::export_processing::export_images_and_wait(
        ExportRequest {
            paths: paths.clone(),
            output_folder: output_directory.clone(),
            base_origin_folders,
            export_settings,
            output_format: output_format.clone(),
            current_edit_path: active.path.clone(),
            current_edit_adjustments: active.adjustments.clone(),
        },
        app_handle.clone(),
    )
    .await?;

    Ok(json!({
        "imagePaths": paths,
        "outputDirectory": output_directory,
        "outputFormat": output_format,
        "exportedCount": image_paths.len(),
        "activeImagePath": active.path,
    }))
}

fn parse_export_settings(value: Option<&Value>) -> Result<ExportSettings, String> {
    let Some(value) = value else {
        return Ok(default_export_settings());
    };
    let object = value
        .as_object()
        .ok_or("exportSettings must be an object".to_string())?;
    const VALID_KEYS: &[&str] = &[
        "jpegQuality",
        "resize",
        "keepMetadata",
        "preserveTimestamps",
        "stripGps",
        "filenameTemplate",
        "watermark",
        "exportMasks",
        "preserveFolders",
    ];
    if let Some(key) = object
        .keys()
        .find(|key| !VALID_KEYS.contains(&key.as_str()))
    {
        return Err(format!(
            "exportSettings contains unsupported field '{key}'; valid fields are {}",
            VALID_KEYS.join(", ")
        ));
    }

    let jpeg_quality = bounded_u64(object, "jpegQuality", 90, 1, 100)? as u8;
    let resize = match object.get("resize") {
        None | Some(Value::Null) => None,
        Some(value) => Some(parse_resize_options(value)?),
    };
    let keep_metadata = optional_bool(object, "keepMetadata", true)?;
    let preserve_timestamps = optional_bool(object, "preserveTimestamps", false)?;
    let strip_gps = optional_bool(object, "stripGps", true)?;
    let filename_template = match object.get("filenameTemplate") {
        None | Some(Value::Null) => Some("{original_filename}_edited".to_string()),
        Some(value) => Some(
            value
                .as_str()
                .ok_or("exportSettings.filenameTemplate must be a string or null".to_string())?
                .to_string(),
        ),
    };
    let watermark = match object.get("watermark") {
        None | Some(Value::Null) => None,
        Some(value) => Some(parse_watermark_settings(value)?),
    };

    Ok(ExportSettings {
        jpeg_quality,
        resize,
        keep_metadata,
        preserve_timestamps,
        strip_gps,
        filename_template,
        watermark,
        export_masks: optional_bool(object, "exportMasks", false)?,
        preserve_folders: optional_bool(object, "preserveFolders", false)?,
    })
}

fn default_export_settings() -> ExportSettings {
    ExportSettings {
        jpeg_quality: 90,
        resize: None,
        keep_metadata: true,
        preserve_timestamps: false,
        strip_gps: true,
        filename_template: Some("{original_filename}_edited".to_string()),
        watermark: None,
        export_masks: false,
        preserve_folders: false,
    }
}

fn parse_resize_options(value: &Value) -> Result<ResizeOptions, String> {
    let object = value
        .as_object()
        .ok_or("exportSettings.resize must be an object or null".to_string())?;
    let mode = match object.get("mode").and_then(Value::as_str) {
        Some("longEdge") => ResizeMode::LongEdge,
        Some("shortEdge") => ResizeMode::ShortEdge,
        Some("width") => ResizeMode::Width,
        Some("height") => ResizeMode::Height,
        Some(mode) => {
            return Err(format!(
                "exportSettings.resize.mode '{mode}' is invalid; use longEdge, shortEdge, width, or height"
            ));
        }
        None => return Err("exportSettings.resize.mode is required".to_string()),
    };
    let value = object
        .get("value")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0 && *value <= u32::MAX as u64)
        .ok_or("exportSettings.resize.value must be a positive integer".to_string())?
        as u32;
    Ok(ResizeOptions {
        mode,
        value,
        dont_enlarge: object.get("dontEnlarge").and_then(Value::as_bool).ok_or(
            "exportSettings.resize.dontEnlarge is required and must be boolean".to_string(),
        )?,
    })
}

fn parse_watermark_settings(value: &Value) -> Result<WatermarkSettings, String> {
    let object = value
        .as_object()
        .ok_or("exportSettings.watermark must be an object or null".to_string())?;
    let path = object
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .ok_or("exportSettings.watermark.path is required".to_string())?;
    ui::ensure_path_exists(path, false)?;
    let anchor = match object.get("anchor").and_then(Value::as_str) {
        Some("topLeft") => WatermarkAnchor::TopLeft,
        Some("topCenter") => WatermarkAnchor::TopCenter,
        Some("topRight") => WatermarkAnchor::TopRight,
        Some("centerLeft") => WatermarkAnchor::CenterLeft,
        Some("center") => WatermarkAnchor::Center,
        Some("centerRight") => WatermarkAnchor::CenterRight,
        Some("bottomLeft") => WatermarkAnchor::BottomLeft,
        Some("bottomCenter") => WatermarkAnchor::BottomCenter,
        Some("bottomRight") => WatermarkAnchor::BottomRight,
        Some(anchor) => {
            return Err(format!(
                "exportSettings.watermark.anchor '{anchor}' is invalid"
            ));
        }
        None => return Err("exportSettings.watermark.anchor is required".to_string()),
    };

    Ok(WatermarkSettings {
        path: path.to_string(),
        anchor,
        scale: bounded_f64(object, "scale", 10.0, 1.0, 50.0)?,
        spacing: bounded_f64(object, "spacing", 5.0, 0.0, 25.0)?,
        opacity: bounded_f64(object, "opacity", 75.0, 0.0, 100.0)?,
    })
}

fn parse_base_origin_folders(arguments: &Value, paths: &[String]) -> Result<Vec<String>, String> {
    if let Some(value) = arguments.get("baseOriginFolders") {
        let folders = value
            .as_array()
            .ok_or("baseOriginFolders must be an array".to_string())?;
        return folders
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let path = value
                    .as_str()
                    .filter(|path| !path.is_empty())
                    .ok_or_else(|| {
                        format!("baseOriginFolders[{index}] must be a non-empty string")
                    })?;
                ui::ensure_path_exists(path, true)?;
                Ok(path.to_string())
            })
            .collect();
    }

    let mut folders = Vec::new();
    for path in paths {
        let (source_path, _) = crate::file_management::parse_virtual_path(path);
        if let Some(parent) = source_path.parent().and_then(Path::to_str)
            && !folders.iter().any(|folder| folder == parent)
        {
            folders.push(parent.to_string());
        }
    }
    Ok(folders)
}

fn optional_bool(
    object: &serde_json::Map<String, Value>,
    key: &str,
    default: bool,
) -> Result<bool, String> {
    match object.get(key) {
        None => Ok(default),
        Some(value) => value
            .as_bool()
            .ok_or_else(|| format!("exportSettings.{key} must be boolean")),
    }
}

fn bounded_u64(
    object: &serde_json::Map<String, Value>,
    key: &str,
    default: u64,
    minimum: u64,
    maximum: u64,
) -> Result<u64, String> {
    let value = match object.get(key) {
        None => default,
        Some(value) => value
            .as_u64()
            .ok_or_else(|| format!("exportSettings.{key} must be an integer"))?,
    };
    if !(minimum..=maximum).contains(&value) {
        return Err(format!(
            "exportSettings.{key} must be an integer from {minimum} to {maximum}"
        ));
    }
    Ok(value)
}

fn bounded_f64(
    object: &serde_json::Map<String, Value>,
    key: &str,
    default: f64,
    minimum: f64,
    maximum: f64,
) -> Result<f32, String> {
    let value = match object.get(key) {
        None => default,
        Some(value) => value
            .as_f64()
            .ok_or_else(|| format!("exportSettings.watermark.{key} must be a number"))?,
    };
    if !(minimum..=maximum).contains(&value) {
        return Err(format!(
            "exportSettings.watermark.{key} must be a number from {minimum} to {maximum}"
        ));
    }
    Ok(value as f32)
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
        let export = definitions
            .iter()
            .find(|tool| tool["name"] == "export_images")
            .expect("export_images tool");
        assert_eq!(
            export["inputSchema"]["properties"]["outputFormat"]["enum"][6],
            "avif"
        );
        assert_eq!(
            export["inputSchema"]["properties"]["outputFormat"]["enum"][7],
            "cube"
        );
        assert_eq!(
            export["inputSchema"]["properties"]["exportSettings"]["properties"]["jpegQuality"]["maximum"],
            100
        );
    }

    #[test]
    fn export_settings_validation_preserves_ui_defaults_and_bounds() {
        let settings = parse_export_settings(Some(&json!({
            "jpegQuality": 80,
            "resize": { "mode": "longEdge", "value": 2048, "dontEnlarge": true },
            "preserveFolders": true
        })))
        .expect("valid export settings");
        assert_eq!(settings.jpeg_quality, 80);
        assert!(settings.resize.is_some());
        assert!(settings.preserve_folders);

        let error = parse_export_settings(Some(&json!({ "jpegQuality": 101 })))
            .expect_err("quality above the UI bound should fail");
        assert!(error.contains("jpegQuality must be an integer from 1 to 100"));
    }
}
