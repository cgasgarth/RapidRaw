use std::collections::HashMap;
use std::env;
use std::fs;
use std::time::Duration;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::GenericImageView;
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use uuid::Uuid;

use crate::{AppState, McpEditorState};

const PROTOCOL_VERSION: &str = "2026-07-28";
const DEFAULT_PORT: u16 = 7790;
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_BODY_BYTES: usize = 12 * 1024 * 1024;
const UI_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

pub fn start_server(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_server(app_handle).await {
            log::error!("MCP server stopped: {}", error);
        }
    });
}

pub fn initialize_runtime(app_handle: &AppHandle) -> Result<(), String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;

    Ok(())
}

async fn run_server(app_handle: AppHandle) -> Result<(), String> {
    let requested_port = env::var("RAPIDRAW_MCP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);

    let mut listener = None;
    let mut bound_port = requested_port;
    for port in requested_port..=requested_port.saturating_add(10) {
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(bound) => {
                listener = Some(bound);
                bound_port = port;
                break;
            }
            Err(_) if env::var("RAPIDRAW_MCP_PORT").is_err() => continue,
            Err(error) => return Err(format!("failed to bind 127.0.0.1:{port}: {error}")),
        }
    }

    let listener = listener.ok_or_else(|| "no available MCP port found".to_string())?;
    let state = app_handle.state::<AppState>();
    *state.mcp.port.lock().unwrap() = bound_port;

    if let Ok(config_dir) = app_handle.path().app_config_dir() {
        let _ = fs::create_dir_all(&config_dir);
        let _ = fs::write(
            config_dir.join("mcp-endpoint.json"),
            serde_json::to_string_pretty(&json!({
                "url": format!("http://127.0.0.1:{bound_port}/mcp"),
                "protocolVersion": PROTOCOL_VERSION,
            }))
            .unwrap_or_default(),
        );
    }

    log::info!(
        "MCP server listening on http://127.0.0.1:{bound_port}/mcp (loopback-only, no auth)"
    );

    loop {
        let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let app_for_connection = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_connection(stream, app_for_connection).await {
                log::debug!("MCP connection closed: {}", error);
            }
        });
    }
}

async fn handle_connection(mut stream: TcpStream, app_handle: AppHandle) -> Result<(), String> {
    let request = read_request(&mut stream).await?;

    if request.method == "OPTIONS" {
        write_response(&mut stream, 204, "", "text/plain").await?;
        return Ok(());
    }

    if request.method != "POST" || request.path != "/mcp" {
        write_response(&mut stream, 404, "not found", "text/plain").await?;
        return Ok(());
    }

    let request_json: Value = serde_json::from_slice(&request.body)
        .map_err(|error| format!("invalid JSON request: {error}"))?;
    let response = dispatch_rpc(&app_handle, &request.headers, request_json).await;

    match response {
        Some(value) => write_json_response(&mut stream, 200, &value).await?,
        None => write_response(&mut stream, 202, "", "text/plain").await?,
    }

    Ok(())
}

async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut bytes = Vec::with_capacity(4096);
    let mut header_end = None;
    let mut chunk = [0_u8; 4096];

    while header_end.is_none() {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("connection closed before HTTP headers".to_string());
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > MAX_HEADER_BYTES {
            return Err("HTTP headers exceed the MCP limit".to_string());
        }
        header_end = bytes.windows(4).position(|window| window == b"\r\n\r\n");
    }

    let header_end = header_end.unwrap();
    let header_text = std::str::from_utf8(&bytes[..header_end])
        .map_err(|error| format!("invalid HTTP headers: {error}"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().ok_or("missing HTTP request line")?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or("missing HTTP method")?
        .to_string();
    let path = request_parts.next().ok_or("missing HTTP path")?.to_string();

    let mut headers = HashMap::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or("invalid HTTP header")?;
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err("MCP request body exceeds the limit".to_string());
    }

    let body_start = header_end + 4;
    while bytes.len() < body_start + content_length {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("connection closed before HTTP body".to_string());
        }
        bytes.extend_from_slice(&chunk[..read]);
    }

    Ok(HttpRequest {
        method,
        path,
        headers,
        body: bytes[body_start..body_start + content_length].to_vec(),
    })
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
    content_type: &str,
) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nMCP-Protocol-Version: {PROTOCOL_VERSION}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| error.to_string())
}

async fn write_json_response(
    stream: &mut TcpStream,
    status: u16,
    body: &Value,
) -> Result<(), String> {
    let serialized = serde_json::to_string(body).map_err(|error| error.to_string())?;
    write_response(stream, status, &serialized, "application/json").await
}

async fn dispatch_rpc(
    app_handle: &AppHandle,
    headers: &HashMap<String, String>,
    request: Value,
) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return Some(json_rpc_error(id, -32600, "missing JSON-RPC method"));
    };
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));

    if let Some(header_method) = headers.get("mcp-method")
        && header_method != method
    {
        return Some(json_rpc_error(
            id,
            -32600,
            "Mcp-Method does not match the JSON-RPC method",
        ));
    }

    if let Some(header_version) = headers.get("mcp-protocol-version")
        && header_version != PROTOCOL_VERSION
    {
        return Some(json_rpc_error(
            id,
            -32600,
            "unsupported MCP protocol version",
        ));
    }

    if method == "notifications/initialized" {
        return None;
    }

    let result = match method {
        "ping" => Ok(json!({})),
        "initialize" | "server/discover" => Ok(discovery_result()),
        "tools/list" => Ok(json!({
            "tools": tool_definitions(),
            "ttlMs": 30_000,
            "cacheScope": "public",
        })),
        "tools/call" => call_tool(app_handle, headers, params).await,
        _ => Err((-32601, format!("unsupported MCP method: {method}"))),
    };

    Some(match result {
        Ok(value) => json_rpc_result(id, value),
        Err((code, message)) => json_rpc_error(id, code, &message),
    })
}

fn discovery_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "serverInfo": { "name": "RapidRAW", "version": env!("CARGO_PKG_VERSION") },
        "capabilities": { "tools": { "listChanged": false } },
        "instructions": "Use imagePath explicitly on every RapidRAW operation. Mutations return an editRevision; pass it back as expectedRevision to avoid overwriting newer edits.",
    })
}

fn json_rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn json_rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_definitions() -> Vec<Value> {
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
            "name": "set_adjustments",
            "description": "Replace the full non-destructive adjustment snapshot. For one or more field changes while leaving omitted fields unchanged, use update_adjustments.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" },
                "adjustments": adjustments_schema(),
                "expectedRevision": { "type": "string" }
            }, "required": ["imagePath", "adjustments"] }
        }),
        json!({
            "name": "update_adjustments",
            "description": "Update one or more top-level adjustment fields. Omitted fields remain unchanged; a supplied nested object replaces that nested field.",
            "inputSchema": { "type": "object", "properties": {
                "imagePath": { "type": "string" },
                "changes": adjustments_schema(),
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
                "adjustments": adjustments_schema(),
                "maxDimension": { "type": "integer", "minimum": 128, "maximum": 4096, "default": 1280 },
                "expectedRevision": { "type": "string" }
            }, "required": ["imagePath"] }
        }),
    ]
}

fn adjustments_schema() -> Value {
    let mut properties = Map::new();
    for (key, min, max, description) in [
        ("exposure", -5.0, 5.0, "EV shift."),
        ("brightness", -5.0, 5.0, "Brightness."),
        ("contrast", -100.0, 100.0, "Contrast."),
        ("highlights", -100.0, 100.0, "Highlights."),
        ("shadows", -100.0, 100.0, "Shadows."),
        ("whites", -100.0, 100.0, "Whites."),
        ("blacks", -100.0, 100.0, "Blacks."),
        ("temperature", -100.0, 100.0, "White balance temperature."),
        ("tint", -100.0, 100.0, "White balance tint."),
        ("saturation", -100.0, 100.0, "Global saturation."),
        ("vibrance", -100.0, 100.0, "Vibrance."),
        ("clarity", -100.0, 100.0, "Clarity."),
        ("structure", -100.0, 100.0, "Structure."),
        ("dehaze", -100.0, 100.0, "Dehaze."),
        ("sharpness", -100.0, 100.0, "Sharpness."),
        ("centré", -100.0, 100.0, "Centre."),
        (
            "chromaticAberrationRedCyan",
            -100.0,
            100.0,
            "Red/cyan chromatic aberration.",
        ),
        (
            "chromaticAberrationBlueYellow",
            -100.0,
            100.0,
            "Blue/yellow chromatic aberration.",
        ),
        ("vignetteAmount", -100.0, 100.0, "Vignette amount."),
        ("vignetteRoundness", -100.0, 100.0, "Vignette roundness."),
        (
            "lensDistortionAmount",
            -100.0,
            100.0,
            "Lens distortion correction.",
        ),
        (
            "lensVignetteAmount",
            -100.0,
            100.0,
            "Lens vignette correction.",
        ),
        (
            "lensTcaAmount",
            -100.0,
            100.0,
            "Lens chromatic aberration correction.",
        ),
        (
            "transformDistortion",
            -100.0,
            100.0,
            "Transform distortion.",
        ),
        ("transformVertical", -100.0, 100.0, "Vertical transform."),
        (
            "transformHorizontal",
            -100.0,
            100.0,
            "Horizontal transform.",
        ),
        ("transformAspect", -100.0, 100.0, "Transform aspect."),
        (
            "transformXOffset",
            -100.0,
            100.0,
            "Horizontal transform offset.",
        ),
        (
            "transformYOffset",
            -100.0,
            100.0,
            "Vertical transform offset.",
        ),
    ] {
        properties.insert(key.to_string(), ranged_number_schema(min, max, description));
    }
    for (key, min, max, description) in [
        ("sharpnessThreshold", 0.0, 80.0, "Sharpening threshold."),
        (
            "lumaNoiseReduction",
            0.0,
            100.0,
            "Luminance noise reduction.",
        ),
        ("colorNoiseReduction", 0.0, 100.0, "Color noise reduction."),
        ("vignetteFeather", 0.0, 100.0, "Vignette feather."),
        ("vignetteMidpoint", 0.0, 100.0, "Vignette midpoint."),
        ("grainAmount", 0.0, 100.0, "Film grain amount."),
        ("grainRoughness", 0.0, 100.0, "Film grain roughness."),
        ("grainSize", 0.0, 100.0, "Film grain size."),
        ("glowAmount", 0.0, 100.0, "Glow amount."),
        ("halationAmount", 0.0, 100.0, "Halation amount."),
        ("flareAmount", 0.0, 100.0, "Flare amount."),
        ("lutIntensity", 0.0, 100.0, "LUT intensity."),
        ("transformScale", 0.0, 500.0, "Transform scale percentage."),
    ] {
        properties.insert(key.to_string(), ranged_number_schema(min, max, description));
    }
    for key in [
        "lensBlurAmount",
        "lensBlurDiffusion",
        "lensBlurMaxDepth",
        "lensBlurMaxFade",
        "lensBlurMinDepth",
        "lensBlurMinFade",
    ] {
        properties.insert(
            key.to_string(),
            ranged_number_schema(0.0, 100.0, "Lens blur control."),
        );
    }
    properties.insert(
        "hue".to_string(),
        ranged_number_schema(-180.0, 180.0, "Global hue in degrees."),
    );
    properties.insert(
        "rotation".to_string(),
        ranged_number_schema(-180.0, 180.0, "Fine rotation in degrees."),
    );
    properties.insert(
        "transformRotate".to_string(),
        ranged_number_schema(-180.0, 180.0, "Transform rotation in degrees."),
    );
    properties.insert(
        "orientationSteps".to_string(),
        json!({ "type": "integer", "minimum": 0, "maximum": 3 }),
    );
    properties.insert("flipHorizontal".to_string(), json!({ "type": "boolean" }));
    properties.insert("flipVertical".to_string(), json!({ "type": "boolean" }));
    properties.insert("curves".to_string(), json!({ "type": "object" }));
    properties.insert("pointCurves".to_string(), json!({ "type": "object" }));
    properties.insert("parametricCurve".to_string(), json!({ "type": "object" }));
    properties.insert("hsl".to_string(), json!({ "type": "object" }));
    properties.insert("colorGrading".to_string(), json!({ "type": "object" }));
    properties.insert("colorCalibration".to_string(), json!({ "type": "object" }));
    properties.insert("crop".to_string(), json!({ "type": ["object", "null"] }));
    properties.insert("masks".to_string(), json!({ "type": "array" }));
    properties.insert("lutPath".to_string(), json!({ "type": ["string", "null"] }));
    properties.insert(
        "lensMaker".to_string(),
        json!({ "type": ["string", "null"] }),
    );
    properties.insert(
        "lensModel".to_string(),
        json!({ "type": ["string", "null"] }),
    );
    properties.insert(
        "aspectRatio".to_string(),
        json!({ "type": ["number", "null"], "exclusiveMinimum": 0 }),
    );
    properties.insert("aiPatches".to_string(), json!({ "type": "array" }));
    properties.insert("sectionVisibility".to_string(), json!({ "type": "object" }));
    properties.insert("showClipping".to_string(), json!({ "type": "boolean" }));
    properties.insert(
        "curveMode".to_string(),
        json!({ "type": "string", "enum": ["point", "parametric"] }),
    );
    properties.insert(
        "toneMapper".to_string(),
        json!({ "type": "string", "enum": ["basic", "agx"] }),
    );
    properties.insert(
        "lensCorrectionMode".to_string(),
        json!({ "type": "string", "enum": ["auto", "manual"] }),
    );
    properties.insert(
        "lensBlurShape".to_string(),
        json!({ "type": "string", "enum": ["circle", "hexagon", "octagon", "ring"] }),
    );
    properties.insert(
        "lensBlurDepthMap".to_string(),
        json!({ "type": ["string", "null"] }),
    );
    properties.insert(
        "lensDistortionParams".to_string(),
        json!({ "type": ["object", "null"] }),
    );
    for key in [
        "lensBlurEnabled",
        "lensDistortionEnabled",
        "lensTcaEnabled",
        "lensVignetteEnabled",
    ] {
        properties.insert(key.to_string(), json!({ "type": "boolean" }));
    }

    json!({
        "type": "object",
        "description": "RapidRAW adjustment object. Scalar controls include min/max bounds; use get_image_state for the full nested shape.",
        "additionalProperties": true,
        "propertyNames": { "enum": adjustment_keys() },
        "properties": properties,
    })
}

fn ranged_number_schema(minimum: f64, maximum: f64, description: &str) -> Value {
    json!({ "type": "number", "minimum": minimum, "maximum": maximum, "description": description })
}

fn adjustment_keys() -> Vec<String> {
    let mut keys: Vec<String> = crate::all_available_adjustments()
        .into_iter()
        .chain(
            [
                "aiPatches",
                "sectionVisibility",
                "showClipping",
                "lensBlurEnabled",
                "lensBlurAmount",
                "lensBlurDiffusion",
                "lensBlurShape",
                "lensBlurDepthMap",
                "lensBlurMaxDepth",
                "lensBlurMaxFade",
                "lensBlurMinDepth",
                "lensBlurMinFade",
                "lensDistortionParams",
            ]
            .into_iter()
            .map(String::from),
        )
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

async fn call_tool(
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
    require_active_session(app_handle, None)?;
    ensure_path_exists(&path, false)?;
    request_ui(app_handle, "select-image", json!({ "path": path })).await
}

fn get_image_state(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    require_active_session(app_handle, Some(&path))
        .map(|editor_state| editor_state_value(&editor_state))
}

fn get_active_image_state(app_handle: &AppHandle) -> Result<Value, String> {
    require_active_session(app_handle, None).map(|editor_state| editor_state_value(&editor_state))
}

async fn set_adjustments(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    let adjustments = arguments
        .get("adjustments")
        .cloned()
        .ok_or("adjustments is required".to_string())?;
    validate_adjustments(&adjustments)?;
    check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
    ensure_ui_image(app_handle, &path).await?;
    request_ui(
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
    validate_adjustments(&changes)?;
    check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
    let current = get_image_state(app_handle, arguments)?;
    let current_adjustments = current
        .get("adjustments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let merged = merge_top_level(current_adjustments, changes)?;
    ensure_ui_image(app_handle, &path).await?;
    request_ui(
        app_handle,
        "apply-adjustments",
        json!({ "path": path, "adjustments": merged, "resetHistory": false }),
    )
    .await
}

async fn reset_adjustments(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
    ensure_ui_image(app_handle, &path).await?;
    request_ui(app_handle, "reset-adjustments", json!({ "path": path })).await
}

async fn apply_auto_adjustments(
    app_handle: &AppHandle,
    arguments: &Value,
) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    check_expected_revision(app_handle, &path, arguments.get("expectedRevision")).await?;
    ensure_ui_image(app_handle, &path).await?;
    let state = app_handle.state::<AppState>();
    let (image, _) = crate::get_original_image(&state)?;
    let auto = crate::image_processing::perform_auto_analysis(&image);
    let auto_json = crate::image_processing::auto_results_to_json(&auto);
    let current = get_image_state(app_handle, arguments)?;
    let merged = merge_top_level(
        current
            .get("adjustments")
            .cloned()
            .unwrap_or_else(|| json!({})),
        auto_json,
    )?;
    request_ui(
        app_handle,
        "apply-adjustments",
        json!({ "path": path, "adjustments": merged, "resetHistory": false }),
    )
    .await
}

async fn get_preview(app_handle: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let path = required_image_path(arguments)?;
    require_active_session(app_handle, Some(&path))?;
    let adjustments = if let Some(adjustments) = arguments.get("adjustments") {
        validate_adjustments(adjustments)?;
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
    let revision = revision_for(&path, &adjustments);
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

async fn ensure_ui_image(app_handle: &AppHandle, path: &str) -> Result<(), String> {
    let already_selected = require_active_session(app_handle, None)?.path == path;
    if !already_selected {
        let _ = request_ui(app_handle, "select-image", json!({ "path": path })).await?;
    }
    Ok(())
}

fn require_active_session(
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

async fn request_ui(app_handle: &AppHandle, kind: &str, payload: Value) -> Result<Value, String> {
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

#[tauri::command]
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

#[tauri::command]
pub fn sync_editor_state(
    path: String,
    adjustments: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    validate_adjustments(&adjustments)?;
    let revision = revision_for(&path, &adjustments);
    *state.mcp.editor_state.lock().unwrap() = Some(McpEditorState {
        path: path.clone(),
        adjustments: adjustments.clone(),
        revision: revision.clone(),
    });
    Ok(json!({ "imagePath": path, "adjustments": adjustments, "editRevision": revision }))
}

#[tauri::command]
pub fn clear_editor_session(state: State<'_, AppState>) {
    *state.mcp.editor_state.lock().unwrap() = None;
}

fn editor_state_value(state: &McpEditorState) -> Value {
    json!({
        "imagePath": state.path,
        "adjustments": state.adjustments,
        "editRevision": state.revision,
        "isSelected": true,
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
    ensure_path_exists(&path, false)?;
    Ok(path)
}

fn ensure_path_exists(path: &str, directory: bool) -> Result<(), String> {
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

fn revision_for(path: &str, adjustments: &Value) -> String {
    let input = serde_json::to_vec(&json!({ "path": path, "adjustments": adjustments }))
        .unwrap_or_default();
    blake3::hash(&input).to_hex().to_string()
}

fn validate_adjustments(adjustments: &Value) -> Result<(), String> {
    let Some(object) = adjustments.as_object() else {
        return Err("adjustments must be a JSON object".to_string());
    };
    let allowed = adjustment_keys();
    for key in object.keys() {
        if !allowed.iter().any(|allowed_key| allowed_key == key) {
            return Err(format!("unsupported adjustment key: {key}"));
        }
        if let Some((minimum, maximum)) = numeric_adjustment_range(key)
            && let Some(value) = object.get(key)
        {
            if key == "orientationSteps" && value.as_u64().is_none() {
                return Err("adjustment orientationSteps must be an integer".to_string());
            }
            let Some(value) = value.as_f64() else {
                return Err(format!("adjustment {key} must be a number"));
            };
            if !(minimum..=maximum).contains(&value) {
                return Err(format!(
                    "adjustment {key} must be between {minimum} and {maximum}"
                ));
            }
        }
    }
    Ok(())
}

fn numeric_adjustment_range(key: &str) -> Option<(f64, f64)> {
    match key {
        "exposure" | "brightness" => Some((-5.0, 5.0)),
        "contrast"
        | "highlights"
        | "shadows"
        | "whites"
        | "blacks"
        | "temperature"
        | "tint"
        | "saturation"
        | "vibrance"
        | "clarity"
        | "structure"
        | "dehaze"
        | "sharpness"
        | "centré"
        | "chromaticAberrationRedCyan"
        | "chromaticAberrationBlueYellow"
        | "vignetteAmount"
        | "vignetteRoundness"
        | "lensDistortionAmount"
        | "lensVignetteAmount"
        | "lensTcaAmount"
        | "transformDistortion"
        | "transformVertical"
        | "transformHorizontal"
        | "transformAspect"
        | "transformXOffset"
        | "transformYOffset" => Some((-100.0, 100.0)),
        "hue" | "transformRotate" | "rotation" => Some((-180.0, 180.0)),
        "sharpnessThreshold" => Some((0.0, 80.0)),
        "lumaNoiseReduction"
        | "colorNoiseReduction"
        | "lensBlurAmount"
        | "lensBlurDiffusion"
        | "lensBlurMaxDepth"
        | "lensBlurMaxFade"
        | "lensBlurMinDepth"
        | "lensBlurMinFade"
        | "vignetteFeather"
        | "vignetteMidpoint"
        | "grainAmount"
        | "grainRoughness"
        | "grainSize"
        | "glowAmount"
        | "halationAmount"
        | "flareAmount" => Some((0.0, 100.0)),
        "orientationSteps" => Some((0.0, 3.0)),
        "transformScale" => Some((0.0, 500.0)),
        "lutIntensity" => Some((0.0, 100.0)),
        _ => None,
    }
}

fn merge_top_level(current: Value, changes: Value) -> Result<Value, String> {
    let mut current = current.as_object().cloned().unwrap_or_else(Map::new);
    let changes = changes
        .as_object()
        .ok_or("changes must be a JSON object".to_string())?;
    current.extend(changes.clone());
    Ok(Value::Object(current))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_is_stable_for_same_edit() {
        let adjustments = json!({ "exposure": 0.5, "crop": null });
        assert_eq!(
            revision_for("/tmp/example.raw", &adjustments),
            revision_for("/tmp/example.raw", &adjustments)
        );
        assert_ne!(
            revision_for("/tmp/example.raw", &adjustments),
            revision_for("/tmp/other.raw", &adjustments)
        );
    }

    #[test]
    fn adjustment_validation_rejects_unknown_fields() {
        assert!(validate_adjustments(&json!({ "exposure": 0.5 })).is_ok());
        assert!(validate_adjustments(&json!({ "exposure": 6.0 })).is_err());
        assert!(validate_adjustments(&json!({ "notAnAdjustment": 1 })).is_err());
        assert!(validate_adjustments(&json!({ "orientationSteps": 1.5 })).is_err());
        assert!(validate_adjustments(&json!(null)).is_err());
    }

    #[test]
    fn update_merges_only_at_the_top_level() {
        let merged = merge_top_level(
            json!({ "exposure": 0.0, "hsl": { "red": 1.0 } }),
            json!({ "exposure": 0.75 }),
        )
        .expect("valid adjustment object");
        assert_eq!(merged["exposure"], 0.75);
        assert_eq!(merged["hsl"]["red"], 1.0);
    }

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

        let schema = adjustments_schema();
        assert_eq!(schema["properties"]["exposure"]["minimum"], -5.0);
        assert_eq!(schema["properties"]["hue"]["maximum"], 180.0);
        assert!(
            schema["propertyNames"]["enum"]
                .as_array()
                .expect("adjustment key enum")
                .iter()
                .any(|key| key == "transformScale")
        );
    }
}
