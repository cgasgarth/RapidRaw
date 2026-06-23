use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherDiscoveryRequest {
    #[serde(default)]
    provider_mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherDiscoveryResponse {
    cameras: Vec<TetheredCamera>,
    provider: TetherProviderStatus,
    proof: TetherDiscoveryProof,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherProviderStatus {
    adapter: String,
    mode: String,
    status: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherDiscoveryProof {
    fake_provider_available: bool,
    macos_provider_boundary: String,
    manual_hardware_required: bool,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherCapability {
    id: String,
    label: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TetherConnectionStatus {
    transport: String,
    trusted: bool,
}

#[derive(Debug, Serialize)]
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
    let mode = request
        .and_then(|request| request.provider_mode)
        .or_else(|| std::env::var("RAWENGINE_TETHER_PROVIDER_MODE").ok())
        .unwrap_or_else(|| "auto".to_string());

    if mode == "fake" {
        FakeTetherProvider.discover()
    } else {
        MacosTetherProvider.discover()
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
}
