use std::collections::HashMap;
use std::env;
use std::fmt::Display;
use std::fs;

use ::http::{
    HeaderName, HeaderValue, Method, Request,
    header::{CONNECTION, CONTENT_LENGTH, TRANSFER_ENCODING},
};
use bytes::Bytes;
use http_body::Body;
use http_body_util::{BodyExt, Full};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::server::{McpHttpService, create_http_service};
use super::{DEFAULT_PORT, MAX_BODY_BYTES, MAX_HEADER_BYTES, PROTOCOL_VERSION};

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
            serde_json::to_string_pretty(&serde_json::json!({
                "url": format!("http://127.0.0.1:{bound_port}/mcp"),
                "protocolVersion": PROTOCOL_VERSION,
            }))
            .unwrap_or_default(),
        );
    }

    log::info!(
        "MCP server listening on http://127.0.0.1:{bound_port}/mcp (loopback-only, no auth)"
    );

    let service = create_http_service(app_handle);
    loop {
        let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let service_for_connection = service.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_connection(stream, service_for_connection).await {
                log::debug!("MCP connection closed: {}", error);
            }
        });
    }
}

async fn handle_connection(mut stream: TcpStream, service: McpHttpService) -> Result<(), String> {
    let request = read_request(&mut stream).await?;

    if request.method == "OPTIONS" {
        write_basic_response(&mut stream, 204, "", "text/plain").await?;
        return Ok(());
    }

    if request.method != "POST" || request.path != "/mcp" {
        write_basic_response(&mut stream, 404, "not found", "text/plain").await?;
        return Ok(());
    }

    let request = build_rmcp_request(request)?;
    let response = service.handle(request).await;
    write_rmcp_response(&mut stream, response).await
}

fn build_rmcp_request(request: HttpRequest) -> Result<Request<Full<Bytes>>, String> {
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|error| format!("invalid HTTP method: {error}"))?;
    let mut builder = Request::builder().method(method).uri(request.path);
    let headers = builder
        .headers_mut()
        .ok_or_else(|| "unable to build MCP request headers".to_string())?;
    for (name, value) in request.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("invalid HTTP header name: {error}"))?;
        let value = HeaderValue::from_str(&value)
            .map_err(|error| format!("invalid HTTP header value: {error}"))?;
        headers.append(name, value);
    }

    builder
        .body(Full::new(Bytes::from(request.body)))
        .map_err(|error| format!("unable to build MCP request: {error}"))
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

async fn write_basic_response(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
    content_type: &str,
) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| error.to_string())
}

async fn write_rmcp_response<B>(
    stream: &mut TcpStream,
    response: ::http::Response<B>,
) -> Result<(), String>
where
    B: Body<Data = Bytes> + Send,
    B::Error: Display,
{
    let (parts, body) = response.into_parts();
    let body = body
        .collect()
        .await
        .map_err(|error| error.to_string())?
        .to_bytes();
    let reason = parts.status.canonical_reason().unwrap_or_default();
    let mut response = format!("HTTP/1.1 {} {reason}\r\n", parts.status.as_u16());
    for (name, value) in &parts.headers {
        if name == CONTENT_LENGTH || name == TRANSFER_ENCODING || name == CONNECTION {
            continue;
        }
        let value = value
            .to_str()
            .map_err(|error| format!("invalid MCP response header: {error}"))?;
        response.push_str(&format!("{}: {value}\r\n", name.as_str()));
    }
    response.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    ));
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&body)
        .await
        .map_err(|error| error.to_string())
}
