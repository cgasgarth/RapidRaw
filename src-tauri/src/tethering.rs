use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::app_state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherDiscoveryRequest {
    #[serde(default)]
    provider_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherSessionOpenRequest {
    camera_id: String,
    #[serde(default)]
    destination_root: Option<String>,
    #[serde(default)]
    provider_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherCaptureRequest {
    #[serde(default)]
    destination_root: Option<String>,
    #[serde(default)]
    fake_source_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherSessionSnapshot {
    camera_display_name: String,
    camera_id: String,
    destination_root: Option<String>,
    opened_at: String,
    provider_mode: String,
    session_id: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherSessionResponse {
    session: Option<TetherSessionSnapshot>,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherCaptureResponse {
    bytes: u64,
    camera_display_name: String,
    checksum: String,
    captured_at: String,
    imported_path: String,
    provider_mode: String,
    session_id: String,
    source_path: String,
    status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherDiscoveryResponse {
    cameras: Vec<TetheredCamera>,
    provider: TetherProviderStatus,
    proof: TetherDiscoveryProof,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherProviderStatus {
    adapter: String,
    mode: String,
    status: String,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherDiscoveryProof {
    fake_provider_available: bool,
    macos_provider_boundary: String,
    manual_hardware_required: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetheredCamera {
    battery_percent: Option<u8>,
    capabilities: Vec<TetherCapability>,
    connection: TetherConnectionStatus,
    display_name: String,
    id: String,
    make: String,
    model: String,
    storage: TetherStorageStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherCapability {
    id: String,
    label: String,
    status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherConnectionStatus {
    transport: String,
    trusted: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherStorageStatus {
    free_gb: Option<f64>,
    label: String,
    state: String,
}

trait TetherProvider {
    fn discover(&self) -> TetherDiscoveryResponse;
}

struct FakeTetherProvider;
struct MacosTetherProvider;

impl TetherProvider for FakeTetherProvider {
    fn discover(&self) -> TetherDiscoveryResponse {
        TetherDiscoveryResponse {
            cameras: vec![TetheredCamera {
                battery_percent: Some(87),
                capabilities: vec![
                    capability("discovery", "Discovery", "ready"),
                    capability("battery_status", "Battery reported", "ready"),
                    capability("storage_status", "Storage reported", "ready"),
                    capability(
                        "remote_capture",
                        "Remote capture not implemented",
                        "not_checked",
                    ),
                ],
                connection: TetherConnectionStatus {
                    transport: "USB-C PTP".to_string(),
                    trusted: true,
                },
                display_name: "Sony ILCE-7M4".to_string(),
                id: "fake-sony-ilce-7m4-usb".to_string(),
                make: "Sony".to_string(),
                model: "ILCE-7M4".to_string(),
                storage: TetherStorageStatus {
                    free_gb: Some(118.4),
                    label: "Slot 1".to_string(),
                    state: "ready".to_string(),
                },
            }],
            provider: TetherProviderStatus {
                adapter: "fake_tether_provider".to_string(),
                message: "Deterministic CI provider; no hardware access.".to_string(),
                mode: "fake".to_string(),
                status: "ready".to_string(),
            },
            proof: proof("fake_tether_provider"),
        }
    }
}

impl TetherProvider for MacosTetherProvider {
    fn discover(&self) -> TetherDiscoveryResponse {
        TetherDiscoveryResponse {
            cameras: Vec::new(),
            provider: TetherProviderStatus {
                adapter: "macos_tether_provider_boundary".to_string(),
                message: "Hardware discovery boundary is present; native camera adapter implementation is deferred.".to_string(),
                mode: "auto".to_string(),
                status: "hardware_adapter_pending".to_string(),
            },
            proof: proof("macos_tether_provider_boundary"),
        }
    }
}

#[tauri::command]
pub fn discover_tethered_cameras(
    request: Option<TetherDiscoveryRequest>,
) -> TetherDiscoveryResponse {
    let mode = resolve_provider_mode(request.and_then(|request| request.provider_mode));
    discover_with_provider_mode(&mode)
}

#[tauri::command]
pub fn open_tether_session(
    request: TetherSessionOpenRequest,
    state: tauri::State<'_, AppState>,
) -> Result<TetherSessionResponse, String> {
    open_tether_session_for_state(request, &state)
}

#[tauri::command]
pub fn get_tether_session(state: tauri::State<'_, AppState>) -> TetherSessionResponse {
    let session = state.tether_session.lock().unwrap().clone();
    TetherSessionResponse {
        status: session
            .as_ref()
            .map(|session| session.status.clone())
            .unwrap_or_else(|| "closed".to_string()),
        session,
    }
}

#[tauri::command]
pub fn close_tether_session(state: tauri::State<'_, AppState>) -> TetherSessionResponse {
    close_tether_session_for_state(&state)
}

#[tauri::command]
pub fn trigger_tether_capture(
    request: Option<TetherCaptureRequest>,
    state: tauri::State<'_, AppState>,
) -> Result<TetherCaptureResponse, String> {
    trigger_tether_capture_for_state(request, &state)
}

fn resolve_provider_mode(provider_mode: Option<String>) -> String {
    provider_mode
        .or_else(|| std::env::var("RAWENGINE_TETHER_PROVIDER_MODE").ok())
        .unwrap_or_else(|| "auto".to_string())
}

fn discover_with_provider_mode(mode: &str) -> TetherDiscoveryResponse {
    if mode == "fake" {
        FakeTetherProvider.discover()
    } else {
        MacosTetherProvider.discover()
    }
}

fn open_tether_session_for_state(
    request: TetherSessionOpenRequest,
    state: &AppState,
) -> Result<TetherSessionResponse, String> {
    let mode = resolve_provider_mode(request.provider_mode);
    let discovery = discover_with_provider_mode(&mode);
    let camera = discovery
        .cameras
        .iter()
        .find(|camera| camera.id == request.camera_id)
        .ok_or_else(|| "Camera is not available for tether session.".to_string())?;

    let session = TetherSessionSnapshot {
        camera_display_name: camera.display_name.clone(),
        camera_id: camera.id.clone(),
        destination_root: request.destination_root,
        opened_at: chrono::Utc::now().to_rfc3339(),
        provider_mode: discovery.provider.mode,
        session_id: format!("tether-session-{}", uuid::Uuid::new_v4()),
        status: "open".to_string(),
    };

    *state.tether_session.lock().unwrap() = Some(session.clone());
    Ok(TetherSessionResponse {
        session: Some(session),
        status: "open".to_string(),
    })
}

fn close_tether_session_for_state(state: &AppState) -> TetherSessionResponse {
    *state.tether_session.lock().unwrap() = None;
    TetherSessionResponse {
        session: None,
        status: "closed".to_string(),
    }
}

fn trigger_tether_capture_for_state(
    request: Option<TetherCaptureRequest>,
    state: &AppState,
) -> Result<TetherCaptureResponse, String> {
    let request = request.unwrap_or(TetherCaptureRequest {
        destination_root: None,
        fake_source_path: None,
    });
    let session = state
        .tether_session
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Open a tether session before capture.".to_string())?;

    if session.provider_mode != "fake" {
        return Err("Native camera capture is not implemented yet.".to_string());
    }

    let source_path = request
        .fake_source_path
        .or_else(|| std::env::var("RAWENGINE_TETHER_FAKE_CAPTURE_SOURCE").ok())
        .map(PathBuf::from)
        .ok_or_else(|| {
            "Set RAWENGINE_TETHER_FAKE_CAPTURE_SOURCE to a RAW file for fake capture.".to_string()
        })?;
    if !source_path.is_file() {
        return Err(format!(
            "Fake capture source does not exist: {}",
            source_path.display()
        ));
    }

    let destination_root = request
        .destination_root
        .or(session.destination_root.clone())
        .or_else(|| std::env::var("RAWENGINE_TETHER_CAPTURE_DESTINATION_ROOT").ok())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("rawengine-tether-captures"));
    fs::create_dir_all(&destination_root).map_err(|error| error.to_string())?;

    let captured_at = chrono::Utc::now();
    let extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("raw");
    let file_name = format!(
        "{}-{}.{}",
        captured_at.format("%Y%m%dT%H%M%SZ"),
        session.camera_id,
        extension
    );
    let imported_path = destination_root.join(file_name);
    let temporary_path = imported_path.with_extension(format!("{extension}.part"));

    fs::copy(&source_path, &temporary_path).map_err(|error| error.to_string())?;
    let source_checksum = sha256_file(&source_path)?;
    let output_checksum = sha256_file(&temporary_path)?;
    if source_checksum != output_checksum {
        let _ = fs::remove_file(&temporary_path);
        return Err("Fake capture checksum verification failed.".to_string());
    }
    fs::rename(&temporary_path, &imported_path).map_err(|error| error.to_string())?;
    let bytes = fs::metadata(&imported_path)
        .map_err(|error| error.to_string())?
        .len();

    Ok(TetherCaptureResponse {
        bytes,
        camera_display_name: session.camera_display_name,
        checksum: output_checksum,
        captured_at: captured_at.to_rfc3339(),
        imported_path: imported_path.to_string_lossy().to_string(),
        provider_mode: session.provider_mode,
        session_id: session.session_id,
        source_path: source_path.to_string_lossy().to_string(),
        status: "captured".to_string(),
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

fn capability(id: &str, label: &str, status: &str) -> TetherCapability {
    TetherCapability {
        id: id.to_string(),
        label: label.to_string(),
        status: status.to_string(),
    }
}

fn proof(boundary: &str) -> TetherDiscoveryProof {
    TetherDiscoveryProof {
        fake_provider_available: true,
        macos_provider_boundary: boundary.to_string(),
        manual_hardware_required: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_tether_provider_returns_one_ready_camera() {
        let response = discover_tethered_cameras(Some(TetherDiscoveryRequest {
            provider_mode: Some("fake".to_string()),
        }));

        assert_eq!(response.cameras.len(), 1);
        assert_eq!(response.provider.status, "ready");
        assert_eq!(response.cameras[0].display_name, "Sony ILCE-7M4");
        assert!(response.cameras[0].connection.trusted);
        assert!(response.proof.fake_provider_available);
    }

    #[test]
    fn auto_provider_declares_deferred_hardware_boundary() {
        let response = discover_tethered_cameras(Some(TetherDiscoveryRequest {
            provider_mode: Some("auto".to_string()),
        }));

        assert!(response.cameras.is_empty());
        assert_eq!(response.provider.status, "hardware_adapter_pending");
        assert_eq!(
            response.proof.macos_provider_boundary,
            "macos_tether_provider_boundary"
        );
    }

    #[test]
    fn fake_provider_opens_and_closes_session() {
        let state = AppState::new();
        let session = open_tether_session_for_state(
            TetherSessionOpenRequest {
                camera_id: "fake-sony-ilce-7m4-usb".to_string(),
                destination_root: Some("/validation/tether".to_string()),
                provider_mode: Some("fake".to_string()),
            },
            &state,
        )
        .unwrap();

        assert_eq!(session.status, "open");
        assert_eq!(
            session.session.as_ref().unwrap().camera_display_name,
            "Sony ILCE-7M4"
        );
        assert!(state.tether_session.lock().unwrap().is_some());

        let closed = close_tether_session_for_state(&state);
        assert_eq!(closed.status, "closed");
        assert!(state.tether_session.lock().unwrap().is_none());
    }

    #[test]
    fn session_open_rejects_missing_camera() {
        let state = AppState::new();
        let error = open_tether_session_for_state(
            TetherSessionOpenRequest {
                camera_id: "missing-camera".to_string(),
                destination_root: None,
                provider_mode: Some("fake".to_string()),
            },
            &state,
        )
        .unwrap_err();

        assert!(error.contains("not available"));
        assert!(state.tether_session.lock().unwrap().is_none());
    }

    #[test]
    fn fake_provider_captures_verified_raw_copy() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-capture-test-{}",
            uuid::Uuid::new_v4()
        ));
        let configured_source = std::env::var("RAWENGINE_TETHER_PRIVATE_RAW_SOURCE").ok();
        let source_path = configured_source
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("source.ARW"));
        let destination_root = root.join("destination");
        fs::create_dir_all(&root).unwrap();
        if configured_source.is_none() {
            fs::write(&source_path, b"fake raw bytes").unwrap();
        }

        open_tether_session_for_state(
            TetherSessionOpenRequest {
                camera_id: "fake-sony-ilce-7m4-usb".to_string(),
                destination_root: Some(destination_root.to_string_lossy().to_string()),
                provider_mode: Some("fake".to_string()),
            },
            &state,
        )
        .unwrap();

        let capture = trigger_tether_capture_for_state(
            Some(TetherCaptureRequest {
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
            }),
            &state,
        )
        .unwrap();

        assert_eq!(capture.status, "captured");
        assert_eq!(capture.provider_mode, "fake");
        assert!(capture.imported_path.ends_with(".ARW"));
        assert!(Path::new(&capture.imported_path).is_file());
        assert!(capture.bytes > 0);
        assert_eq!(capture.checksum, sha256_file(&source_path).unwrap());

        let _ = fs::remove_dir_all(root);
    }
}
