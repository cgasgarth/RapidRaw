use serde::{Deserialize, Serialize};

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
}
