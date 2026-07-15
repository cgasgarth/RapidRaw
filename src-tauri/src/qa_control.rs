use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

use crate::app_state::AppState;
use crate::render_caches::RenderCaches;

const CONTROL_SOCKET_ENV: &str = "RAWENGINE_QA_CONTROL_SOCKET";
const CONTROL_TOKEN_ENV: &str = "RAWENGINE_QA_CONTROL_TOKEN";
const BUILD_IDENTITY_ENV: &str = "RAWENGINE_QA_BUILD_IDENTITY";
const WORKTREE_IDENTITY_ENV: &str = "RAWENGINE_QA_WORKTREE_IDENTITY";
const MAX_REQUEST_BYTES: u64 = 1024 * 1024;
pub(crate) const RESET_EVENT: &str = "rawengine-qa-reset";
pub(crate) const OPEN_FIXTURE_EVENT: &str = "rawengine-qa-open-fixture";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaExpectedIdentity {
    worktree: String,
    build: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum QaResetMode {
    Empty,
    Library,
    Editor,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum QaCacheMode {
    Cold,
    Warm,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
enum QaOperation {
    Health,
    Capabilities,
    Reset { mode: QaResetMode },
    OpenFixture { path: PathBuf },
    Diagnostics,
    Screenshot { path: PathBuf },
    SetCacheMode { mode: QaCacheMode },
    Shutdown,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QaRequest {
    id: String,
    token: String,
    expected_identity: QaExpectedIdentity,
    #[serde(flatten)]
    operation: QaOperation,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QaResponse {
    id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QaCapabilities {
    protocol_version: u32,
    health: bool,
    reset: bool,
    open_fixture: bool,
    revision_diagnostics: bool,
    screenshot: bool,
    clean_shutdown: bool,
    cold_warm_mode: bool,
    ai: bool,
    advanced_codecs: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QaResetEvent {
    mode: QaResetMode,
    session_revision: u64,
    source_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QaOpenFixtureEvent {
    path: String,
    session_revision: u64,
}

pub(crate) struct QaControlState {
    ready: AtomicBool,
    shutdown: AtomicBool,
    session_revision: AtomicU64,
    render_revision: AtomicU64,
    source_path: Mutex<Option<String>>,
    cache_mode: Mutex<QaCacheMode>,
    identity: QaExpectedIdentity,
}

impl QaControlState {
    pub(crate) fn from_environment() -> Self {
        Self {
            ready: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            session_revision: AtomicU64::new(0),
            render_revision: AtomicU64::new(0),
            source_path: Mutex::new(None),
            cache_mode: Mutex::new(QaCacheMode::Warm),
            identity: QaExpectedIdentity {
                worktree: std::env::var(WORKTREE_IDENTITY_ENV).unwrap_or_default(),
                build: std::env::var(BUILD_IDENTITY_ENV).unwrap_or_default(),
            },
        }
    }

    pub(crate) fn mark_ready(&self) {
        self.ready.store(true, Ordering::Release);
    }

    fn capabilities() -> QaCapabilities {
        QaCapabilities {
            protocol_version: 1,
            health: true,
            reset: true,
            open_fixture: true,
            revision_diagnostics: true,
            screenshot: cfg!(target_os = "macos"),
            clean_shutdown: true,
            cold_warm_mode: true,
            ai: cfg!(feature = "ai"),
            advanced_codecs: cfg!(feature = "advanced-codecs"),
        }
    }
}

fn token_matches(expected: &str, actual: &str) -> bool {
    let expected_hash = Sha256::digest(expected.as_bytes());
    let actual_hash = Sha256::digest(actual.as_bytes());
    expected_hash
        .iter()
        .zip(actual_hash.iter())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn validate_request(
    request: &QaRequest,
    state: &QaControlState,
    token: &str,
) -> Result<(), String> {
    if !token_matches(token, &request.token) {
        return Err("QA control authentication failed".into());
    }
    if request.expected_identity != state.identity {
        return Err(format!(
            "QA identity mismatch: expected worktree={} build={}, running worktree={} build={}",
            request.expected_identity.worktree,
            request.expected_identity.build,
            state.identity.worktree,
            state.identity.build
        ));
    }
    Ok(())
}

fn operation_allowed_before_ready(operation: &QaOperation) -> bool {
    matches!(
        operation,
        QaOperation::Health | QaOperation::Capabilities | QaOperation::Shutdown
    )
}

#[cfg(unix)]
fn process_resource_usage() -> Value {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: getrusage initializes the provided rusage for the current process on success.
    let result = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if result != 0 {
        return Value::Null;
    }
    // SAFETY: the successful getrusage call above initialized every field.
    let usage = unsafe { usage.assume_init() };
    #[cfg(target_os = "macos")]
    let resident_bytes = usage.ru_maxrss.max(0) as u64;
    #[cfg(not(target_os = "macos"))]
    let resident_bytes = (usage.ru_maxrss.max(0) as u64).saturating_mul(1024);
    let micros = |seconds: i64, microseconds: i64| {
        (seconds.max(0) as u64)
            .saturating_mul(1_000_000)
            .saturating_add(microseconds.max(0) as u64)
    };
    json!({
        "peakResidentBytes": resident_bytes,
        "filesystemReadOps": usage.ru_inblock.max(0) as u64,
        "filesystemWriteOps": usage.ru_oublock.max(0) as u64,
        "userCpuMicros": micros(
            usage.ru_utime.tv_sec,
            i64::from(usage.ru_utime.tv_usec),
        ),
        "systemCpuMicros": micros(
            usage.ru_stime.tv_sec,
            i64::from(usage.ru_stime.tv_usec),
        ),
    })
}

#[cfg(not(unix))]
fn process_resource_usage() -> Value {
    Value::Null
}

fn scheduler_metrics(app_state: &AppState) -> Value {
    app_state
        .services
        .preview_runtime
        .metrics_snapshot()
        .map(|metrics| {
            json!({
                "interactiveSubmissions": metrics.interactive_submissions,
                "settledSubmissions": metrics.settled_submissions,
                "pendingReplacements": metrics.pending_replacements,
                "activeCancellations": metrics.active_cancellations,
                "renderedInteractive": metrics.rendered_interactive,
                "renderedSettled": metrics.rendered_settled,
                "maxResidentRequests": metrics.max_resident_requests,
            })
        })
        .unwrap_or(Value::Null)
}

fn gpu_execution_receipt(app_state: &AppState) -> Value {
    app_state
        .gpu_processor
        .lock()
        .ok()
        .and_then(|processor| {
            processor.as_ref().and_then(|processor| {
                processor
                    .processor
                    .last_execution_receipt()
                    .map(|receipt| receipt)
            })
        })
        .map(|receipt| {
            json!({
                "executionSequence": receipt.execution_sequence,
                "runtimeIdentity": receipt.runtime_identity.map(|identity| json!({
                    "deviceGeneration": identity.device_generation,
                    "processorGeneration": identity.processor_generation,
                })),
                "frameIdentity": receipt.frame_identity.map(|identity| json!({
                    "sourceRevision": identity.source_revision,
                    "stageRevision": identity.stage_revision,
                    "width": identity.width,
                    "height": identity.height,
                })),
                "graphFingerprint": receipt.graph_fingerprint,
                "stageBits": receipt.stages.bits(),
                "blurDispatchCount": receipt.blur_dispatch_count,
                "renderPassCount": receipt.render_pass_count,
                "commandBufferCount": receipt.command_buffer_count,
                "queueSubmitCount": receipt.queue_submit_count,
                "estimatedPeakResourceBytes": receipt.estimated_peak_resource_bytes,
                "cpuEncodeMicros": receipt.cpu_encode_time.as_micros().min(u64::MAX as u128) as u64,
                "dehaze": serde_json::to_value(&receipt.dehaze).unwrap_or(Value::Null),
            })
        })
        .unwrap_or(Value::Null)
}

fn diagnostics(state: &QaControlState, app_state: &AppState) -> Value {
    let active_native_source = app_state
        .original_image
        .lock()
        .ok()
        .and_then(|image| image.as_ref().map(|image| image.path.clone()));
    let cache_report = RenderCaches::new(app_state).native_cache_report();
    let preview = app_state.cached_preview.lock().ok().and_then(|preview| {
        preview.as_ref().map(|preview| {
            let identity = &preview.identity;
            json!({
                "source": identity.source.canonical_identity,
                "imageSession": identity.image_session,
                "adjustmentRevision": identity.adjustment_revision,
                "planRevision": identity.plan_revision,
                "width": identity.width,
                "height": identity.height,
                "completedStage": identity.completed_stage,
                "backendGeneration": identity.backend_generation,
            })
        })
    });
    json!({
        "ready": state.ready.load(Ordering::Acquire),
        "identity": state.identity,
        "sessionRevision": state.session_revision.load(Ordering::Acquire),
        "renderRevision": state.render_revision.load(Ordering::Acquire),
        "loadImageGeneration": app_state.load_image_generation.load(Ordering::Acquire),
        "sourcePath": state.source_path.lock().ok().and_then(|path| path.clone()),
        "activeNativeSource": active_native_source,
        "preview": preview,
        "cacheMode": state.cache_mode.lock().map(|mode| *mode).unwrap_or(QaCacheMode::Cold),
        "cache": cache_report,
        "processResources": process_resource_usage(),
        "scheduler": scheduler_metrics(app_state),
        "gpuExecution": gpu_execution_receipt(app_state),
    })
}

fn canonical_output_path(path: &Path, worktree: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path.extension().and_then(|extension| extension.to_str()) != Some("png")
    {
        return Err("Screenshot path must be an absolute .png path".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Screenshot path has no parent".to_string())?;
    let artifact_root = worktree.join("private-artifacts");
    let relative = path.strip_prefix(&artifact_root).map_err(|_| {
        "Screenshot path must remain inside this worktree's private-artifacts directory".to_string()
    })?;
    if relative
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("Screenshot path contains an invalid traversal component".into());
    }
    fs::create_dir_all(&artifact_root)
        .map_err(|error| format!("Failed to create private artifact root: {error}"))?;
    if fs::symlink_metadata(&artifact_root)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Private artifact root must not be a symlink".into());
    }
    let artifact_root = artifact_root
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let parent = parent.canonicalize().map_err(|error| error.to_string())?;
    if !parent.starts_with(&artifact_root) {
        return Err(
            "Screenshot path must remain inside this worktree's private-artifacts directory".into(),
        );
    }
    let file_name = path
        .file_name()
        .ok_or_else(|| "Screenshot path has no filename".to_string())?;
    Ok(parent.join(file_name))
}

#[cfg(target_os = "macos")]
fn capture_main_window(app: &tauri::AppHandle, output: &Path) -> Result<(), String> {
    use objc::{msg_send, runtime::Object, sel, sel_impl};

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let window_for_main = window.clone();
    window
        .run_on_main_thread(move || {
            let result = window_for_main
                .ns_window()
                .map_err(|error| error.to_string())
                .and_then(|ns_window| {
                    let ns_window = ns_window as *mut Object;
                    if ns_window.is_null() {
                        return Err("Main NSWindow is unavailable".into());
                    }
                    let window_number: i64 = unsafe { msg_send![ns_window, windowNumber] };
                    Ok(window_number)
                });
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    let window_number = receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|error| format!("Timed out resolving main window number: {error}"))??;
    let mut capture = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-l", &window_number.to_string()])
        .arg(output)
        .spawn()
        .map_err(|error| format!("Failed to launch screencapture: {error}"))?;
    let mut status = None;
    for _ in 0..100 {
        status = capture.try_wait().map_err(|error| error.to_string())?;
        if status.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let status = match status {
        Some(status) => status,
        None => {
            let _ = capture.kill();
            let _ = capture.wait();
            return Err("screencapture timed out after 5 seconds".into());
        }
    };
    if !status.success() {
        return Err(format!("screencapture exited with {status}"));
    }
    let size = fs::metadata(output)
        .map_err(|error| format!("Screenshot missing: {error}"))?
        .len();
    if size == 0 {
        return Err("Screenshot is empty".into());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn capture_main_window(_app: &tauri::AppHandle, _output: &Path) -> Result<(), String> {
    Err("Native QA screenshots are supported on macOS".into())
}

fn dispatch(
    request: QaRequest,
    token: &str,
    app: &tauri::AppHandle,
    state: &QaControlState,
    app_state: &AppState,
) -> Result<(Value, bool), String> {
    validate_request(&request, state, token)?;
    if !state.ready.load(Ordering::Acquire) && !operation_allowed_before_ready(&request.operation) {
        return Err("Native QA frontend is not ready".into());
    }
    match request.operation {
        QaOperation::Health => Ok((
            json!({
                "ready": state.ready.load(Ordering::Acquire),
                "pid": std::process::id(),
                "identity": state.identity,
                "capabilities": QaControlState::capabilities(),
            }),
            false,
        )),
        QaOperation::Capabilities => Ok((json!(QaControlState::capabilities()), false)),
        QaOperation::Reset { mode } => {
            RenderCaches::new(app_state).clear_active_image_render_state();
            let source_path = if mode == QaResetMode::Editor {
                state.source_path.lock().ok().and_then(|path| path.clone())
            } else {
                if mode == QaResetMode::Empty
                    && let Ok(mut path) = state.source_path.lock()
                {
                    *path = None;
                }
                None
            };
            let session_revision = state.session_revision.fetch_add(1, Ordering::AcqRel) + 1;
            state.render_revision.fetch_add(1, Ordering::AcqRel);
            app.emit(
                RESET_EVENT,
                QaResetEvent {
                    mode,
                    session_revision,
                    source_path: source_path.clone(),
                },
            )
            .map_err(|error| error.to_string())?;
            Ok((
                json!({ "mode": mode, "sessionRevision": session_revision, "sourcePath": source_path }),
                false,
            ))
        }
        QaOperation::OpenFixture { path } => {
            if !path.is_absolute() || !path.is_file() {
                return Err("Fixture path must be an existing absolute file".into());
            }
            let canonical = path.canonicalize().map_err(|error| error.to_string())?;
            let source = canonical.to_string_lossy().into_owned();
            if let Ok(mut path) = state.source_path.lock() {
                *path = Some(source.clone());
            }
            let session_revision = state.session_revision.fetch_add(1, Ordering::AcqRel) + 1;
            state.render_revision.fetch_add(1, Ordering::AcqRel);
            app.emit(
                OPEN_FIXTURE_EVENT,
                QaOpenFixtureEvent {
                    path: source.clone(),
                    session_revision,
                },
            )
            .map_err(|error| error.to_string())?;
            Ok((
                json!({ "path": source, "sessionRevision": session_revision }),
                false,
            ))
        }
        QaOperation::Diagnostics => Ok((diagnostics(state, app_state), false)),
        QaOperation::Screenshot { path } => {
            let output = canonical_output_path(&path, Path::new(&state.identity.worktree))?;
            capture_main_window(app, &output)?;
            Ok((
                json!({ "path": output, "bytes": fs::metadata(&output).map_err(|error| error.to_string())?.len() }),
                false,
            ))
        }
        QaOperation::SetCacheMode { mode } => {
            if mode == QaCacheMode::Cold {
                RenderCaches::new(app_state).clear_image_caches();
                RenderCaches::new(app_state).clear_session_caches();
            }
            if let Ok(mut cache_mode) = state.cache_mode.lock() {
                *cache_mode = mode;
            }
            let render_revision = state.render_revision.fetch_add(1, Ordering::AcqRel) + 1;
            Ok((
                json!({ "mode": mode, "renderRevision": render_revision }),
                false,
            ))
        }
        QaOperation::Shutdown => {
            state.shutdown.store(true, Ordering::Release);
            Ok((json!({ "shuttingDown": true }), true))
        }
    }
}

#[cfg(unix)]
fn handle_stream(stream: UnixStream, token: &str, app: &tauri::AppHandle) -> Result<bool, String> {
    // A listener must stay nonblocking so shutdown remains observable, but accepted
    // streams can inherit O_NONBLOCK on macOS. The client writes after connect, so an
    // immediate read on an inherited nonblocking stream can spuriously fail with
    // EAGAIN and strand the client without a response.
    stream
        .set_nonblocking(false)
        .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .by_ref()
        .take(MAX_REQUEST_BYTES)
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    let request_id = serde_json::from_str::<Value>(&line)
        .ok()
        .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| "invalid".into());
    let response = match serde_json::from_str::<QaRequest>(&line) {
        Ok(request) => {
            let request_id = request.id.clone();
            let state = app.state::<QaControlState>();
            let app_state = app.state::<AppState>();
            match dispatch(request, token, app, &state, &app_state) {
                Ok((result, shutdown)) => (
                    QaResponse {
                        id: request_id,
                        ok: true,
                        result: Some(result),
                        error: None,
                    },
                    shutdown,
                ),
                Err(error) => (
                    QaResponse {
                        id: request_id,
                        ok: false,
                        result: None,
                        error: Some(error),
                    },
                    false,
                ),
            }
        }
        Err(error) => (
            QaResponse {
                id: request_id,
                ok: false,
                result: None,
                error: Some(error.to_string()),
            },
            false,
        ),
    };
    let mut stream = reader.into_inner();
    serde_json::to_writer(&mut stream, &response.0).map_err(|error| error.to_string())?;
    stream.write_all(b"\n").map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())?;
    Ok(response.1)
}

#[cfg(unix)]
pub(crate) fn start(app: tauri::AppHandle) -> Result<(), String> {
    let socket_path = match std::env::var_os(CONTROL_SOCKET_ENV) {
        Some(path) => PathBuf::from(path),
        None => return Ok(()),
    };
    let token =
        std::env::var(CONTROL_TOKEN_ENV).map_err(|_| "QA control token is missing".to_string())?;
    if token.len() < 32 {
        return Err("QA control token must contain at least 32 characters".into());
    }
    if !socket_path.is_absolute() {
        return Err("QA control socket path must be absolute".into());
    }
    if socket_path.parent() != Some(Path::new("/tmp")) {
        return Err("QA control socket must be created directly under /tmp".into());
    }
    let socket_name = socket_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !socket_name.starts_with("rawengine-native-qa-") || !socket_name.ends_with(".sock") {
        return Err("QA control socket filename is invalid".into());
    }
    let identity = &app.state::<QaControlState>().identity;
    if identity.worktree.is_empty() || identity.build.is_empty() {
        return Err("QA worktree/build identity is missing".into());
    }
    let _ = fs::remove_file(&socket_path);
    let listener = UnixListener::bind(&socket_path).map_err(|error| error.to_string())?;
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    std::thread::Builder::new()
        .name("rawengine-qa-control".into())
        .spawn(move || {
            while !app
                .state::<QaControlState>()
                .shutdown
                .load(Ordering::Acquire)
            {
                match listener.accept() {
                    Ok((stream, _)) => match handle_stream(stream, &token, &app) {
                        Ok(true) => break,
                        Ok(false) => {}
                        Err(error) => log::warn!("QA control request failed: {error}"),
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    Err(error) => {
                        log::error!("QA control listener failed: {error}");
                        break;
                    }
                }
            }
            let _ = fs::remove_file(&socket_path);
            if app
                .state::<QaControlState>()
                .shutdown
                .load(Ordering::Acquire)
            {
                app.exit(0);
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn start(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> QaControlState {
        QaControlState {
            ready: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            session_revision: AtomicU64::new(0),
            render_revision: AtomicU64::new(0),
            source_path: Mutex::new(None),
            cache_mode: Mutex::new(QaCacheMode::Warm),
            identity: QaExpectedIdentity {
                worktree: "/repo".into(),
                build: "build-1".into(),
            },
        }
    }

    fn request(token: &str, identity: QaExpectedIdentity) -> QaRequest {
        QaRequest {
            id: "request-1".into(),
            token: token.into(),
            expected_identity: identity,
            operation: QaOperation::Health,
        }
    }

    #[test]
    fn authentication_and_identity_are_both_required() {
        let state = state();
        let identity = state.identity.clone();
        assert!(
            validate_request(&request("wrong", identity.clone()), &state, "correct-token").is_err()
        );
        assert!(
            validate_request(
                &request(
                    "correct-token",
                    QaExpectedIdentity {
                        build: "other".into(),
                        ..identity.clone()
                    }
                ),
                &state,
                "correct-token"
            )
            .is_err()
        );
        assert!(
            validate_request(&request("correct-token", identity), &state, "correct-token").is_ok()
        );
    }

    #[test]
    fn capability_manifest_is_explicit_and_versioned() {
        let capabilities = QaControlState::capabilities();
        assert_eq!(capabilities.protocol_version, 1);
        assert!(capabilities.health && capabilities.reset && capabilities.open_fixture);
        assert!(
            capabilities.revision_diagnostics
                && capabilities.clean_shutdown
                && capabilities.cold_warm_mode
        );
        assert_eq!(capabilities.screenshot, cfg!(target_os = "macos"));
    }

    #[test]
    fn only_observation_and_shutdown_are_allowed_before_frontend_readiness() {
        assert!(operation_allowed_before_ready(&QaOperation::Health));
        assert!(operation_allowed_before_ready(&QaOperation::Capabilities));
        assert!(operation_allowed_before_ready(&QaOperation::Shutdown));
        assert!(!operation_allowed_before_ready(&QaOperation::Reset {
            mode: QaResetMode::Empty,
        }));
    }

    #[test]
    fn output_path_requires_absolute_png() {
        let worktree = tempfile::tempdir().unwrap();
        let allowed = worktree.path().join("private-artifacts/qa/proof.png");
        fs::create_dir_all(allowed.parent().unwrap()).unwrap();
        assert!(canonical_output_path(Path::new("relative.png"), worktree.path()).is_err());
        assert!(
            canonical_output_path(
                &worktree.path().join("private-artifacts/proof.jpg"),
                worktree.path()
            )
            .is_err()
        );
        assert!(canonical_output_path(&allowed, worktree.path()).is_ok());
        assert!(canonical_output_path(Path::new("/tmp/outside.png"), worktree.path()).is_err());
    }

    #[test]
    fn every_protocol_operation_has_a_deterministic_json_shape() {
        let identity = json!({ "worktree": "/repo", "build": "build-1" });
        let cases = [
            json!({ "method": "health" }),
            json!({ "method": "capabilities" }),
            json!({ "method": "reset", "mode": "empty" }),
            json!({ "method": "openFixture", "path": "/tmp/fixture.ARW" }),
            json!({ "method": "diagnostics" }),
            json!({ "method": "screenshot", "path": "/tmp/proof.png" }),
            json!({ "method": "setCacheMode", "mode": "cold" }),
            json!({ "method": "shutdown" }),
        ];
        for operation in cases {
            let mut request = json!({
                "id": "request-1",
                "token": "a-valid-token",
                "expectedIdentity": identity.clone(),
            });
            request
                .as_object_mut()
                .unwrap()
                .extend(operation.as_object().unwrap().clone());
            serde_json::from_value::<QaRequest>(request).expect("protocol operation must parse");
        }
    }

    #[test]
    fn process_resource_usage_is_nonnegative_when_supported() {
        let usage = process_resource_usage();
        if cfg!(unix) {
            for key in [
                "peakResidentBytes",
                "filesystemReadOps",
                "filesystemWriteOps",
                "userCpuMicros",
                "systemCpuMicros",
            ] {
                assert!(
                    usage.get(key).and_then(Value::as_u64).is_some(),
                    "missing {key}"
                );
            }
        } else {
            assert!(usage.is_null());
        }
    }
}
