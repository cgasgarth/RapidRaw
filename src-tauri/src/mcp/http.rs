use std::collections::HashMap;
use std::env;
use std::fs;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::{DEFAULT_PORT, MAX_BODY_BYTES, MAX_HEADER_BYTES, PROTOCOL_VERSION, tools};

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
    let state = app_handle.state::<crate::AppState>();
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

    if let Some(header_version) = headers.get("mcp-protocol-version")
        && header_version != PROTOCOL_VERSION
    {
        return Some(json_rpc_error(
            id,
            -32602,
            "unsupported MCP protocol version",
        ));
    }

    if let Some(header_method) = headers.get("mcp-method")
        && header_method != method
    {
        return Some(json_rpc_error(
            id,
            -32602,
            "Mcp-Method does not match the JSON-RPC method",
        ));
    }

    if method == "notifications/initialized" {
        return None;
    }

    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "ping" => Ok(json!({})),
        "initialize" | "server/discover" => Ok(discovery_result()),
        "tools/list" => Ok(json!({
            "tools": tools::tool_definitions(),
            "ttlMs": 30_000,
            "cacheScope": "public",
        })),
        "tools/call" => tools::call_tool(app_handle, headers, params).await,
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
