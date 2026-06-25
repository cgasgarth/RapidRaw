use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::app_state::AppState;
use crate::image_processing::RawEngineArtifacts;

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
    backup_destination_root: Option<String>,
    #[serde(default)]
    camera_control_values: BTreeMap<String, String>,
    #[serde(default)]
    destination_root: Option<String>,
    #[serde(default)]
    fake_source_path: Option<String>,
    #[serde(default)]
    ingest_preset_id: Option<String>,
    #[serde(default)]
    metadata_template_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherCameraControlWriteRequest {
    camera_id: String,
    control_id: String,
    #[serde(default)]
    provider_mode: Option<String>,
    value: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherSessionSnapshot {
    camera_display_name: String,
    camera_id: String,
    capture_counter: usize,
    #[serde(skip_serializing)]
    captured_imports_by_checksum: BTreeMap<String, TetherCapturedImport>,
    destination_root: Option<String>,
    opened_at: String,
    provider_mode: String,
    recovery: TetherRecoverySummary,
    session_id: String,
    status: String,
}

#[derive(Clone, Debug)]
struct TetherCapturedImport {
    bytes: u64,
    captured_at: String,
    ingest: TetherCaptureIngestSummary,
    imported_path: String,
    metadata: TetherCaptureMetadataSummary,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherRecoverySummary {
    message: String,
    partial_files_found: usize,
    quarantined_files: Vec<String>,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherCameraControlWriteResponse {
    applied_value: String,
    camera_id: String,
    control_id: String,
    requested_value: String,
    status: String,
    verified_at: String,
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
    backup: TetherCaptureBackupSummary,
    bytes: u64,
    camera_display_name: String,
    camera_control_values: BTreeMap<String, String>,
    checksum: String,
    captured_at: String,
    ingest: TetherCaptureIngestSummary,
    imported_path: String,
    metadata: TetherCaptureMetadataSummary,
    provider_mode: String,
    session_id: String,
    source_path: String,
    status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherCaptureBackupSummary {
    bytes: Option<u64>,
    checksum: Option<String>,
    destination_path: Option<String>,
    enabled: bool,
    error: Option<String>,
    status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherCaptureMetadataSummary {
    applied: bool,
    applied_fields: Vec<String>,
    sidecar_path: Option<String>,
    template_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TetherCaptureIngestSummary {
    add_tags: Vec<String>,
    apply_preset_ids: Vec<String>,
    collision_index: usize,
    file_name: String,
    naming_template: String,
    preset_id: String,
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
    controls: Vec<TetherCameraControl>,
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
struct TetherCameraControl {
    current_value: String,
    id: String,
    label: String,
    status: String,
    unit: Option<String>,
    values: Vec<String>,
    writable: bool,
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
                controls: fake_camera_controls(),
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

#[tauri::command]
pub fn set_tether_camera_control(
    request: TetherCameraControlWriteRequest,
) -> Result<TetherCameraControlWriteResponse, String> {
    set_tether_camera_control_for_provider(request)
}

fn resolve_provider_mode(provider_mode: Option<String>) -> String {
    resolve_provider_mode_with_env(
        provider_mode.as_deref(),
        std::env::var("RAWENGINE_TETHER_PROVIDER_MODE")
            .ok()
            .as_deref(),
    )
}

fn resolve_provider_mode_with_env(
    provider_mode: Option<&str>,
    env_provider_mode: Option<&str>,
) -> String {
    let requested_mode = provider_mode.unwrap_or("auto").trim();
    if requested_mode != "auto" {
        return requested_mode.to_string();
    }

    env_provider_mode
        .map(str::trim)
        .filter(|mode| !mode.is_empty())
        .unwrap_or(requested_mode)
        .to_string()
}

fn resolve_tether_destination_root(destination_root: Option<String>) -> Option<String> {
    resolve_tether_destination_root_with_env(
        destination_root.as_deref(),
        std::env::var("RAWENGINE_TETHER_CAPTURE_DESTINATION_ROOT")
            .ok()
            .as_deref(),
    )
}

fn resolve_tether_destination_root_with_env(
    destination_root: Option<&str>,
    env_destination_root: Option<&str>,
) -> Option<String> {
    destination_root
        .and_then(normalize_optional_path)
        .or_else(|| env_destination_root.and_then(normalize_optional_path))
}

fn normalize_optional_path(path: &str) -> Option<String> {
    let path = path.trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

fn discover_with_provider_mode(mode: &str) -> TetherDiscoveryResponse {
    if mode == "fake" {
        FakeTetherProvider.discover()
    } else {
        MacosTetherProvider.discover()
    }
}

fn set_tether_camera_control_for_provider(
    request: TetherCameraControlWriteRequest,
) -> Result<TetherCameraControlWriteResponse, String> {
    let mode = resolve_provider_mode(request.provider_mode);
    let discovery = discover_with_provider_mode(&mode);
    let camera = discovery
        .cameras
        .iter()
        .find(|camera| camera.id == request.camera_id)
        .ok_or_else(|| "Camera is not available for tether control write.".to_string())?;
    let control = camera
        .controls
        .iter()
        .find(|control| control.id == request.control_id)
        .ok_or_else(|| "Camera control is not supported by this provider.".to_string())?;

    if !control.writable || control.status != "ready" {
        return Err("Camera control is not writable.".to_string());
    }
    if !control.values.iter().any(|value| value == &request.value) {
        return Err(format!(
            "Unsupported value {} for {}.",
            request.value, request.control_id
        ));
    }

    Ok(TetherCameraControlWriteResponse {
        applied_value: request.value.clone(),
        camera_id: request.camera_id,
        control_id: request.control_id,
        requested_value: request.value,
        status: "verified".to_string(),
        verified_at: chrono::Utc::now().to_rfc3339(),
    })
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

    let destination_root = resolve_tether_destination_root(request.destination_root);
    let recovery = recover_tether_destination(destination_root.as_deref());

    let session = TetherSessionSnapshot {
        camera_display_name: camera.display_name.clone(),
        camera_id: camera.id.clone(),
        capture_counter: 0,
        captured_imports_by_checksum: BTreeMap::new(),
        destination_root,
        opened_at: chrono::Utc::now().to_rfc3339(),
        provider_mode: discovery.provider.mode,
        recovery,
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
        backup_destination_root: None,
        camera_control_values: BTreeMap::new(),
        destination_root: None,
        fake_source_path: None,
        ingest_preset_id: None,
        metadata_template_id: None,
    });
    let (session, capture_counter) = {
        let mut guard = state.tether_session.lock().unwrap();
        let session = guard
            .as_mut()
            .ok_or_else(|| "Open a tether session before capture.".to_string())?;
        session.capture_counter += 1;
        (session.clone(), session.capture_counter)
    };

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
    let source_checksum = sha256_file(&source_path)?;
    if let Some(previous_import) =
        find_previous_tether_import(state, &session.session_id, &source_checksum)
    {
        return Ok(TetherCaptureResponse {
            backup: TetherCaptureBackupSummary {
                bytes: None,
                checksum: None,
                destination_path: None,
                enabled: false,
                error: None,
                status: "disabled".to_string(),
            },
            bytes: previous_import.bytes,
            camera_display_name: session.camera_display_name,
            camera_control_values: request.camera_control_values,
            checksum: source_checksum,
            captured_at: previous_import.captured_at,
            ingest: previous_import.ingest,
            imported_path: previous_import.imported_path,
            metadata: previous_import.metadata,
            provider_mode: session.provider_mode,
            session_id: session.session_id,
            source_path: source_path.to_string_lossy().to_string(),
            status: "duplicate".to_string(),
        });
    }

    let destination_root = request
        .destination_root
        .or(session.destination_root.clone())
        .and_then(|destination_root| resolve_tether_destination_root(Some(destination_root)))
        .or_else(|| resolve_tether_destination_root(None))
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("rawengine-tether-captures"));
    fs::create_dir_all(&destination_root).map_err(|error| error.to_string())?;

    let captured_at = chrono::Utc::now();
    let extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("raw");
    let (imported_path, mut ingest) = resolve_imported_capture_path(
        &destination_root,
        extension,
        &captured_at,
        &session,
        &source_path,
        capture_counter,
        request.ingest_preset_id.as_deref(),
    );
    let temporary_path = imported_path.with_extension(format!("{extension}.part"));

    let output_checksum = write_verified_primary_capture(
        &source_path,
        &temporary_path,
        &imported_path,
        &source_checksum,
    )?;
    let bytes = fs::metadata(&imported_path)
        .map_err(|error| error.to_string())?
        .len();
    let metadata = apply_capture_metadata_template(
        &imported_path,
        request.metadata_template_id.as_deref(),
        &session,
        &captured_at,
        &ingest,
        &request.camera_control_values,
    )?;
    apply_capture_import_preset(&imported_path, &mut ingest, &session, &captured_at)?;
    let backup = write_verified_backup_capture(
        request.backup_destination_root.as_deref(),
        &ingest.file_name,
        &imported_path,
        &output_checksum,
    );

    let response = TetherCaptureResponse {
        backup,
        bytes,
        camera_display_name: session.camera_display_name,
        camera_control_values: request.camera_control_values,
        checksum: output_checksum,
        captured_at: captured_at.to_rfc3339(),
        ingest,
        imported_path: imported_path.to_string_lossy().to_string(),
        metadata,
        provider_mode: session.provider_mode,
        session_id: session.session_id,
        source_path: source_path.to_string_lossy().to_string(),
        status: "captured".to_string(),
    };
    record_tether_import(state, &response);
    Ok(response)
}

fn find_previous_tether_import(
    state: &AppState,
    session_id: &str,
    checksum: &str,
) -> Option<TetherCapturedImport> {
    let guard = state.tether_session.lock().unwrap();
    let session = guard.as_ref()?;
    if session.session_id != session_id {
        return None;
    }
    session.captured_imports_by_checksum.get(checksum).cloned()
}

fn record_tether_import(state: &AppState, response: &TetherCaptureResponse) {
    let mut guard = state.tether_session.lock().unwrap();
    let Some(session) = guard.as_mut() else {
        return;
    };
    if session.session_id != response.session_id {
        return;
    }
    session.captured_imports_by_checksum.insert(
        response.checksum.clone(),
        TetherCapturedImport {
            bytes: response.bytes,
            captured_at: response.captured_at.clone(),
            ingest: response.ingest.clone(),
            imported_path: response.imported_path.clone(),
            metadata: response.metadata.clone(),
        },
    );
}

fn write_verified_primary_capture(
    source_path: &Path,
    temporary_path: &Path,
    imported_path: &Path,
    expected_checksum: &str,
) -> Result<String, String> {
    write_verified_primary_capture_result(
        source_path,
        temporary_path,
        imported_path,
        expected_checksum,
        false,
    )
}

fn write_verified_primary_capture_result(
    source_path: &Path,
    temporary_path: &Path,
    imported_path: &Path,
    expected_checksum: &str,
    interrupt_after_copy: bool,
) -> Result<String, String> {
    fs::copy(source_path, temporary_path).map_err(|error| error.to_string())?;
    if interrupt_after_copy {
        return Err(
            "Fake capture interrupted with partial download left for recovery.".to_string(),
        );
    }
    let output_checksum = sha256_file(temporary_path)?;
    if expected_checksum != output_checksum {
        let _ = fs::remove_file(temporary_path);
        return Err("Fake capture checksum verification failed.".to_string());
    }
    fs::rename(temporary_path, imported_path).map_err(|error| error.to_string())?;
    Ok(output_checksum)
}

fn apply_capture_metadata_template(
    imported_path: &Path,
    requested_template_id: Option<&str>,
    session: &TetherSessionSnapshot,
    captured_at: &chrono::DateTime<chrono::Utc>,
    ingest: &TetherCaptureIngestSummary,
    camera_control_values: &BTreeMap<String, String>,
) -> Result<TetherCaptureMetadataSummary, String> {
    let template_id = requested_template_id
        .filter(|template_id| {
            matches!(
                *template_id,
                "none" | "studioSession" | "reviewSelect" | "copyright-client-delivery"
            )
        })
        .unwrap_or("none");

    if template_id == "none" {
        return Ok(TetherCaptureMetadataSummary {
            applied: false,
            applied_fields: Vec::new(),
            sidecar_path: None,
            template_id: template_id.to_string(),
        });
    }

    let sidecar_path = imported_path.with_file_name(format!(
        "{}.rrdata",
        imported_path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .unwrap_or("capture")
    ));
    let mut sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
    let metadata_values = metadata_template_values(template_id, session, captured_at, ingest);
    if let Some(rating) = metadata_values.rating {
        sidecar.rating = rating;
    }
    if let Some(tags) = metadata_values.tags {
        sidecar.tags = Some(tags);
    }

    let mut exif = sidecar.exif.unwrap_or_default();
    for (key, value) in metadata_values.exif_values {
        exif.insert(key, value);
    }
    for (control_id, value) in camera_control_values {
        exif.insert(
            format!("RawEngineTetherControl_{control_id}"),
            value.clone(),
        );
    }
    sidecar.exif = Some(exif);

    let artifacts = sidecar
        .raw_engine_artifacts
        .get_or_insert_with(RawEngineArtifacts::new_v1);
    artifacts.tether_capture_artifacts.retain(|artifact| {
        artifact
            .get("artifactType")
            .and_then(|value| value.as_str())
            != Some("tether_metadata_template")
    });
    artifacts.tether_capture_artifacts.push(json!({
        "artifactType": "tether_metadata_template",
        "appliedAt": captured_at.to_rfc3339(),
        "captureSessionId": session.session_id,
        "ingestPresetId": ingest.preset_id,
        "metadataTemplateId": template_id,
        "cameraControlValues": camera_control_values,
        "sidecarStorage": "sidecar_artifact"
    }));

    crate::exif_processing::save_sidecar_metadata_atomic(&sidecar_path, &sidecar)?;

    let mut applied_fields = metadata_values.applied_fields;
    applied_fields.extend(
        camera_control_values
            .keys()
            .map(|control_id| format!("RawEngineTetherControl_{control_id}")),
    );

    Ok(TetherCaptureMetadataSummary {
        applied: true,
        applied_fields,
        sidecar_path: Some(sidecar_path.to_string_lossy().to_string()),
        template_id: template_id.to_string(),
    })
}

struct TetherMetadataTemplateValues {
    rating: Option<u8>,
    tags: Option<Vec<String>>,
    exif_values: BTreeMap<String, String>,
    applied_fields: Vec<String>,
}

fn metadata_template_values(
    template_id: &str,
    session: &TetherSessionSnapshot,
    captured_at: &chrono::DateTime<chrono::Utc>,
    ingest: &TetherCaptureIngestSummary,
) -> TetherMetadataTemplateValues {
    if template_id == "reviewSelect" {
        return TetherMetadataTemplateValues {
            rating: Some(4),
            tags: Some(vec![
                "tethered-capture".to_string(),
                "review-select".to_string(),
                "color:green".to_string(),
            ]),
            exif_values: BTreeMap::from([
                (
                    "ImageDescription".to_string(),
                    "Review select for client proofing.".to_string(),
                ),
                (
                    "UserComment".to_string(),
                    "Selected during first cull.".to_string(),
                ),
            ]),
            applied_fields: vec![
                "rating".to_string(),
                "colorLabel".to_string(),
                "ImageDescription".to_string(),
                "UserComment".to_string(),
            ],
        };
    }

    if template_id == "copyright-client-delivery" {
        return TetherMetadataTemplateValues {
            rating: None,
            tags: Some(vec![
                "tethered-capture".to_string(),
                "client-delivery".to_string(),
                "copyrighted".to_string(),
            ]),
            exif_values: BTreeMap::from([
                ("Artist".to_string(), "RawEngine Studio".to_string()),
                (
                    "Copyright".to_string(),
                    "Copyright 2026 RawEngine Studio. All rights reserved.".to_string(),
                ),
            ]),
            applied_fields: vec![
                "Artist".to_string(),
                "Copyright".to_string(),
                "tags".to_string(),
            ],
        };
    }

    TetherMetadataTemplateValues {
        rating: Some(1),
        tags: Some(vec![
            "tethered-capture".to_string(),
            "studio-session".to_string(),
        ]),
        exif_values: BTreeMap::from([
            ("Artist".to_string(), "RawEngine tether session".to_string()),
            (
                "ImageDescription".to_string(),
                format!(
                    "Tethered capture from {} at {}",
                    session.camera_display_name,
                    captured_at.to_rfc3339()
                ),
            ),
            (
                "UserComment".to_string(),
                format!(
                    "RawEngine tether ingest preset {} wrote {}.",
                    ingest.preset_id, ingest.file_name
                ),
            ),
        ]),
        applied_fields: vec![
            "rating".to_string(),
            "tags".to_string(),
            "Artist".to_string(),
            "ImageDescription".to_string(),
            "UserComment".to_string(),
        ],
    }
}

fn apply_capture_import_preset(
    imported_path: &Path,
    ingest: &mut TetherCaptureIngestSummary,
    session: &TetherSessionSnapshot,
    captured_at: &chrono::DateTime<chrono::Utc>,
) -> Result<(), String> {
    if ingest.preset_id != "wedding-copy-ingest" {
        return Ok(());
    }

    let add_tags = vec!["wedding".to_string(), "incoming".to_string()];
    let apply_preset_ids = vec!["camera-standard-start".to_string()];
    let sidecar_path = imported_path.with_file_name(format!(
        "{}.rrdata",
        imported_path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .unwrap_or("capture")
    ));
    let mut sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
    let mut tags = sidecar.tags.unwrap_or_default();
    for tag in &add_tags {
        if !tags.contains(tag) {
            tags.push(tag.clone());
        }
    }
    sidecar.tags = Some(tags);

    let artifacts = sidecar
        .raw_engine_artifacts
        .get_or_insert_with(RawEngineArtifacts::new_v1);
    artifacts.tether_capture_artifacts.retain(|artifact| {
        artifact
            .get("artifactType")
            .and_then(|value| value.as_str())
            != Some("tether_import_preset")
    });
    artifacts.tether_capture_artifacts.push(json!({
        "artifactType": "tether_import_preset",
        "appliedAt": captured_at.to_rfc3339(),
        "captureSessionId": session.session_id,
        "presetId": "wedding-copy-ingest",
        "sourcePolicy": "copy",
        "duplicatePolicy": "rename",
        "sidecarPolicy": "copy_existing",
        "rawOnly": true,
        "metadataTemplateId": "copyright-client-delivery",
        "addTags": add_tags,
        "applyPresetIds": apply_preset_ids,
        "pixelPresetStatus": "deferred"
    }));

    crate::exif_processing::save_sidecar_metadata_atomic(&sidecar_path, &sidecar)?;
    ingest.add_tags = add_tags;
    ingest.apply_preset_ids = apply_preset_ids;
    Ok(())
}

fn write_verified_backup_capture(
    backup_destination_root: Option<&str>,
    file_name: &str,
    imported_path: &Path,
    expected_checksum: &str,
) -> TetherCaptureBackupSummary {
    let Some(root) = backup_destination_root.filter(|root| !root.trim().is_empty()) else {
        return TetherCaptureBackupSummary {
            bytes: None,
            checksum: None,
            destination_path: None,
            enabled: false,
            error: None,
            status: "disabled".to_string(),
        };
    };

    match write_verified_backup_capture_result(
        Path::new(root),
        file_name,
        imported_path,
        expected_checksum,
    ) {
        Ok(summary) => summary,
        Err(error) => TetherCaptureBackupSummary {
            bytes: None,
            checksum: None,
            destination_path: None,
            enabled: true,
            error: Some(error),
            status: "failed".to_string(),
        },
    }
}

fn write_verified_backup_capture_result(
    backup_destination_root: &Path,
    file_name: &str,
    imported_path: &Path,
    expected_checksum: &str,
) -> Result<TetherCaptureBackupSummary, String> {
    fs::create_dir_all(backup_destination_root).map_err(|error| error.to_string())?;
    let backup_path = backup_destination_root.join(file_name);
    let temporary_path = backup_path.with_extension(format!(
        "{}.part",
        backup_path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("raw")
    ));

    fs::copy(imported_path, &temporary_path).map_err(|error| error.to_string())?;
    let checksum = sha256_file(&temporary_path)?;
    if checksum != expected_checksum {
        let _ = fs::remove_file(&temporary_path);
        return Err("Backup checksum verification failed.".to_string());
    }
    fs::rename(&temporary_path, &backup_path).map_err(|error| error.to_string())?;
    let bytes = fs::metadata(&backup_path)
        .map_err(|error| error.to_string())?
        .len();

    Ok(TetherCaptureBackupSummary {
        bytes: Some(bytes),
        checksum: Some(checksum),
        destination_path: Some(backup_path.to_string_lossy().to_string()),
        enabled: true,
        error: None,
        status: "verified".to_string(),
    })
}

fn recover_tether_destination(destination_root: Option<&str>) -> TetherRecoverySummary {
    let Some(root) = destination_root.filter(|root| !root.trim().is_empty()) else {
        return tether_recovery_summary(
            "not_checked",
            0,
            Vec::new(),
            "No tether destination configured.",
        );
    };
    let root = Path::new(root);
    if !root.exists() {
        return tether_recovery_summary("clean", 0, Vec::new(), "Tether destination is new.");
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) => {
            return tether_recovery_summary(
                "failed",
                0,
                Vec::new(),
                &format!("Could not scan tether destination: {error}"),
            );
        }
    };

    let mut partial_files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|file_name| file_name.to_str())
                .is_some_and(|file_name| file_name.ends_with(".part"))
        {
            partial_files.push(path);
        }
    }

    if partial_files.is_empty() {
        return tether_recovery_summary(
            "clean",
            0,
            Vec::new(),
            "No partial tether downloads found.",
        );
    }

    let quarantine_root = root.join(".rawengine-tether-quarantine");
    if let Err(error) = fs::create_dir_all(&quarantine_root) {
        return tether_recovery_summary(
            "failed",
            partial_files.len(),
            Vec::new(),
            &format!("Could not create tether quarantine: {error}"),
        );
    }

    let mut quarantined_files = Vec::new();
    for partial_path in &partial_files {
        let file_name = partial_path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .unwrap_or("partial-capture.part");
        let quarantined_path = quarantine_root.join(format!(
            "{}-{}",
            chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
            file_name
        ));
        match fs::rename(partial_path, &quarantined_path) {
            Ok(()) => quarantined_files.push(quarantined_path.to_string_lossy().to_string()),
            Err(error) => {
                return tether_recovery_summary(
                    "failed",
                    partial_files.len(),
                    quarantined_files,
                    &format!("Could not quarantine partial tether download: {error}"),
                );
            }
        }
    }

    tether_recovery_summary(
        "quarantined",
        partial_files.len(),
        quarantined_files,
        "Partial tether downloads were quarantined before capture.",
    )
}

fn tether_recovery_summary(
    status: &str,
    partial_files_found: usize,
    quarantined_files: Vec<String>,
    message: &str,
) -> TetherRecoverySummary {
    TetherRecoverySummary {
        message: message.to_string(),
        partial_files_found,
        quarantined_files,
        status: status.to_string(),
    }
}

fn resolve_imported_capture_path(
    destination_root: &Path,
    extension: &str,
    captured_at: &chrono::DateTime<chrono::Utc>,
    session: &TetherSessionSnapshot,
    source_path: &Path,
    capture_counter: usize,
    requested_preset_id: Option<&str>,
) -> (PathBuf, TetherCaptureIngestSummary) {
    let preset_id = requested_preset_id
        .filter(|preset_id| {
            matches!(
                *preset_id,
                "cameraSequence" | "sourceSequence" | "timestampCamera" | "wedding-copy-ingest"
            )
        })
        .unwrap_or("timestampCamera");
    let naming_template = naming_template_for_preset(preset_id);
    let template_has_counter = naming_template.contains("{counter");

    for attempt in 0..1000 {
        let collision_index = attempt + 1;
        let counter = capture_counter + attempt;
        let mut stem =
            render_ingest_stem(naming_template, captured_at, session, source_path, counter);
        if !template_has_counter && attempt > 0 {
            stem = format!("{stem}-{collision_index:03}");
        }
        let file_name = format!("{stem}.{extension}");
        let candidate = destination_root.join(&file_name);
        if !candidate.exists() {
            return (
                candidate,
                TetherCaptureIngestSummary {
                    add_tags: Vec::new(),
                    apply_preset_ids: Vec::new(),
                    collision_index,
                    file_name,
                    naming_template: naming_template.to_string(),
                    preset_id: preset_id.to_string(),
                },
            );
        }
    }

    let fallback_name = format!(
        "{}-{}.{}",
        captured_at.format("%Y%m%dT%H%M%SZ"),
        uuid::Uuid::new_v4(),
        extension
    );
    (
        destination_root.join(&fallback_name),
        TetherCaptureIngestSummary {
            add_tags: Vec::new(),
            apply_preset_ids: Vec::new(),
            collision_index: 1001,
            file_name: fallback_name,
            naming_template: naming_template.to_string(),
            preset_id: preset_id.to_string(),
        },
    )
}

fn naming_template_for_preset(preset_id: &str) -> &'static str {
    match preset_id {
        "cameraSequence" => "{camera_id}_{counter:04}",
        "sourceSequence" => "{source_stem}_{counter:04}",
        "wedding-copy-ingest" => "{counter:04}_{source_stem}",
        _ => "{capture_utc}_{camera_id}",
    }
}

fn render_ingest_stem(
    template: &str,
    captured_at: &chrono::DateTime<chrono::Utc>,
    session: &TetherSessionSnapshot,
    source_path: &Path,
    counter: usize,
) -> String {
    let source_stem = source_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("capture");
    let rendered = template
        .replace(
            "{capture_utc}",
            &captured_at.format("%Y%m%dT%H%M%SZ").to_string(),
        )
        .replace("{camera_id}", &session.camera_id)
        .replace("{camera_name}", &session.camera_display_name)
        .replace("{source_stem}", source_stem)
        .replace("{counter:04}", &format!("{counter:04}"))
        .replace("{counter}", &counter.to_string());
    let sanitized = sanitize_file_stem(&rendered);
    if sanitized.is_empty() {
        "capture".to_string()
    } else {
        sanitized
    }
}

fn sanitize_file_stem(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    let mut compacted = sanitized;
    while compacted.contains("__") {
        compacted = compacted.replace("__", "_");
    }
    compacted
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

fn fake_camera_controls() -> Vec<TetherCameraControl> {
    vec![
        camera_control(
            "iso",
            "ISO",
            "400",
            None,
            &["100", "200", "400", "800", "1600"],
        ),
        camera_control(
            "shutterSpeed",
            "Shutter",
            "1/125",
            Some("s"),
            &["1/30", "1/60", "1/125", "1/250", "1/500"],
        ),
        camera_control(
            "aperture",
            "Aperture",
            "f/5.6",
            Some("f-stop"),
            &["f/2.8", "f/4", "f/5.6", "f/8", "f/11"],
        ),
    ]
}

fn camera_control(
    id: &str,
    label: &str,
    current_value: &str,
    unit: Option<&str>,
    values: &[&str],
) -> TetherCameraControl {
    TetherCameraControl {
        current_value: current_value.to_string(),
        id: id.to_string(),
        label: label.to_string(),
        status: "ready".to_string(),
        unit: unit.map(str::to_string),
        values: values.iter().map(|value| value.to_string()).collect(),
        writable: true,
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
        assert_eq!(response.cameras[0].controls.len(), 3);
        assert_eq!(response.cameras[0].controls[0].id, "iso");
        assert_eq!(response.cameras[0].controls[0].current_value, "400");
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
    fn provider_mode_env_overrides_auto_for_runtime_proof() {
        assert_eq!(
            resolve_provider_mode_with_env(Some("auto"), Some("fake")),
            "fake"
        );
        assert_eq!(
            resolve_provider_mode_with_env(Some("fake"), Some("auto")),
            "fake"
        );
        assert_eq!(resolve_provider_mode_with_env(None, Some("fake")), "fake");
        assert_eq!(resolve_provider_mode_with_env(Some("auto"), None), "auto");
    }

    #[test]
    fn tether_destination_root_uses_explicit_path_then_env() {
        assert_eq!(
            resolve_tether_destination_root_with_env(
                Some("/explicit/captures"),
                Some("/env/captures")
            ),
            Some("/explicit/captures".to_string())
        );
        assert_eq!(
            resolve_tether_destination_root_with_env(None, Some("/env/captures")),
            Some("/env/captures".to_string())
        );
        assert_eq!(
            resolve_tether_destination_root_with_env(Some("  "), Some("/env/captures")),
            Some("/env/captures".to_string())
        );
        assert_eq!(resolve_tether_destination_root_with_env(None, None), None);
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
        assert_eq!(session.session.as_ref().unwrap().capture_counter, 0);
        assert_eq!(session.session.as_ref().unwrap().recovery.status, "clean");
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
    fn session_open_quarantines_partial_downloads() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-recovery-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let partial_path = root.join("interrupted.ARW.part");
        fs::write(&partial_path, b"partial raw bytes").unwrap();

        let session = open_tether_session_for_state(
            TetherSessionOpenRequest {
                camera_id: "fake-sony-ilce-7m4-usb".to_string(),
                destination_root: Some(root.to_string_lossy().to_string()),
                provider_mode: Some("fake".to_string()),
            },
            &state,
        )
        .unwrap();

        let recovery = &session.session.as_ref().unwrap().recovery;
        assert_eq!(recovery.status, "quarantined");
        assert_eq!(recovery.partial_files_found, 1);
        assert_eq!(recovery.quarantined_files.len(), 1);
        assert!(!partial_path.exists());
        assert!(Path::new(&recovery.quarantined_files[0]).is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_primary_capture_is_quarantined_on_next_session_open() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-interrupted-capture-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_path = root.join("source.ARW");
        let destination_root = root.join("destination");
        fs::create_dir_all(&destination_root).unwrap();
        fs::write(&source_path, b"fake raw bytes").unwrap();
        let expected_checksum = sha256_file(&source_path).unwrap();
        let imported_path = destination_root.join("source_0001.ARW");
        let temporary_path = imported_path.with_extension("ARW.part");

        let error = write_verified_primary_capture_result(
            &source_path,
            &temporary_path,
            &imported_path,
            &expected_checksum,
            true,
        )
        .unwrap_err();

        assert!(error.contains("partial download"));
        assert!(temporary_path.is_file());
        assert!(!imported_path.exists());

        let session = open_tether_session_for_state(
            TetherSessionOpenRequest {
                camera_id: "fake-sony-ilce-7m4-usb".to_string(),
                destination_root: Some(destination_root.to_string_lossy().to_string()),
                provider_mode: Some("fake".to_string()),
            },
            &state,
        )
        .unwrap();
        let recovery = &session.session.as_ref().unwrap().recovery;

        assert_eq!(recovery.status, "quarantined");
        assert_eq!(recovery.partial_files_found, 1);
        assert!(!temporary_path.exists());
        assert!(Path::new(&recovery.quarantined_files[0]).is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fake_provider_verifies_exposure_control_writes() {
        let response = set_tether_camera_control_for_provider(TetherCameraControlWriteRequest {
            camera_id: "fake-sony-ilce-7m4-usb".to_string(),
            control_id: "iso".to_string(),
            provider_mode: Some("fake".to_string()),
            value: "800".to_string(),
        })
        .unwrap();

        assert_eq!(response.status, "verified");
        assert_eq!(response.control_id, "iso");
        assert_eq!(response.requested_value, "800");
        assert_eq!(response.applied_value, "800");
    }

    #[test]
    fn fake_provider_rejects_unsupported_exposure_control_values() {
        let error = set_tether_camera_control_for_provider(TetherCameraControlWriteRequest {
            camera_id: "fake-sony-ilce-7m4-usb".to_string(),
            control_id: "iso".to_string(),
            provider_mode: Some("fake".to_string()),
            value: "64000".to_string(),
        })
        .unwrap_err();

        assert!(error.contains("Unsupported value"));
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
                backup_destination_root: Some(root.join("backup").to_string_lossy().to_string()),
                camera_control_values: BTreeMap::from([
                    ("aperture".to_string(), "f/5.6".to_string()),
                    ("iso".to_string(), "800".to_string()),
                    ("shutterSpeed".to_string(), "1/125".to_string()),
                ]),
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
                ingest_preset_id: Some("sourceSequence".to_string()),
                metadata_template_id: Some("studioSession".to_string()),
            }),
            &state,
        )
        .unwrap();

        assert_eq!(capture.status, "captured");
        assert_eq!(capture.provider_mode, "fake");
        assert!(capture.imported_path.ends_with(".ARW"));
        assert_eq!(capture.ingest.preset_id, "sourceSequence");
        assert_eq!(capture.ingest.naming_template, "{source_stem}_{counter:04}");
        assert_eq!(capture.ingest.collision_index, 1);
        assert!(capture.ingest.file_name.ends_with("_0001.ARW"));
        assert_eq!(
            capture.camera_control_values.get("iso").map(String::as_str),
            Some("800")
        );
        assert!(Path::new(&capture.imported_path).is_file());
        assert!(capture.bytes > 0);
        assert_eq!(capture.checksum, sha256_file(&source_path).unwrap());
        assert_eq!(capture.backup.status, "verified");
        let backup_path = PathBuf::from(capture.backup.destination_path.as_ref().unwrap());
        assert!(backup_path.is_file());
        assert_eq!(capture.backup.checksum.as_ref().unwrap(), &capture.checksum);
        assert!(capture.metadata.applied);
        assert_eq!(capture.metadata.template_id, "studioSession");
        assert!(
            capture
                .metadata
                .applied_fields
                .contains(&"rating".to_string())
        );
        assert!(
            capture
                .metadata
                .applied_fields
                .contains(&"RawEngineTetherControl_iso".to_string())
        );
        let sidecar_path = capture.metadata.sidecar_path.as_ref().unwrap();
        let sidecar = crate::exif_processing::load_sidecar(Path::new(sidecar_path));
        assert_eq!(sidecar.rating, 1);
        assert_eq!(
            sidecar.tags.unwrap(),
            vec!["tethered-capture".to_string(), "studio-session".to_string()]
        );
        let exif = sidecar.exif.unwrap();
        assert_eq!(
            exif.get("Artist").map(String::as_str),
            Some("RawEngine tether session")
        );
        assert_eq!(
            exif.get("RawEngineTetherControl_iso").map(String::as_str),
            Some("800")
        );
        let tether_artifacts = sidecar
            .raw_engine_artifacts
            .unwrap()
            .tether_capture_artifacts;
        assert_eq!(tether_artifacts.len(), 1);
        assert_eq!(
            tether_artifacts[0]["metadataTemplateId"].as_str(),
            Some("studioSession")
        );
        assert_eq!(tether_artifacts[0]["cameraControlValues"]["iso"], "800");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fake_provider_applies_review_select_metadata_template() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-review-select-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_path = root.join("_DSC7511.ARW");
        let destination_root = root.join("destination");
        fs::create_dir_all(&root).unwrap();
        fs::write(&source_path, b"fake raw bytes").unwrap();

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
                backup_destination_root: None,
                camera_control_values: BTreeMap::new(),
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
                ingest_preset_id: Some("timestampCamera".to_string()),
                metadata_template_id: Some("reviewSelect".to_string()),
            }),
            &state,
        )
        .unwrap();

        assert!(capture.metadata.applied);
        assert_eq!(capture.metadata.template_id, "reviewSelect");
        assert!(
            capture
                .metadata
                .applied_fields
                .contains(&"colorLabel".to_string())
        );
        let sidecar_path = capture.metadata.sidecar_path.as_ref().unwrap();
        let sidecar = crate::exif_processing::load_sidecar(Path::new(sidecar_path));
        assert_eq!(sidecar.rating, 4);
        assert_eq!(
            sidecar.tags.unwrap(),
            vec![
                "tethered-capture".to_string(),
                "review-select".to_string(),
                "color:green".to_string()
            ]
        );
        let exif = sidecar.exif.unwrap();
        assert_eq!(
            exif.get("ImageDescription").map(String::as_str),
            Some("Review select for client proofing.")
        );
        assert_eq!(
            exif.get("UserComment").map(String::as_str),
            Some("Selected during first cull.")
        );
        let tether_artifacts = sidecar
            .raw_engine_artifacts
            .unwrap()
            .tether_capture_artifacts;
        assert_eq!(
            tether_artifacts[0]["metadataTemplateId"].as_str(),
            Some("reviewSelect")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fake_provider_applies_copyright_client_delivery_metadata_template() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-copyright-client-delivery-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_path = root.join("_DSC7511.ARW");
        let destination_root = root.join("destination");
        fs::create_dir_all(&root).unwrap();
        fs::write(&source_path, b"fake raw bytes").unwrap();

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
                backup_destination_root: None,
                camera_control_values: BTreeMap::new(),
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
                ingest_preset_id: Some("timestampCamera".to_string()),
                metadata_template_id: Some("copyright-client-delivery".to_string()),
            }),
            &state,
        )
        .unwrap();

        assert!(capture.metadata.applied);
        assert_eq!(capture.metadata.template_id, "copyright-client-delivery");
        assert!(
            capture
                .metadata
                .applied_fields
                .contains(&"Copyright".to_string())
        );
        let sidecar_path = capture.metadata.sidecar_path.as_ref().unwrap();
        let sidecar = crate::exif_processing::load_sidecar(Path::new(sidecar_path));
        assert_eq!(sidecar.rating, 0);
        assert_eq!(
            sidecar.tags.unwrap(),
            vec![
                "tethered-capture".to_string(),
                "client-delivery".to_string(),
                "copyrighted".to_string()
            ]
        );
        let exif = sidecar.exif.unwrap();
        assert_eq!(
            exif.get("Artist").map(String::as_str),
            Some("RawEngine Studio")
        );
        assert_eq!(
            exif.get("Copyright").map(String::as_str),
            Some("Copyright 2026 RawEngine Studio. All rights reserved.")
        );
        let tether_artifacts = sidecar
            .raw_engine_artifacts
            .unwrap()
            .tether_capture_artifacts;
        assert_eq!(
            tether_artifacts[0]["metadataTemplateId"].as_str(),
            Some("copyright-client-delivery")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fake_provider_applies_wedding_copy_ingest_preset() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-wedding-copy-ingest-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_path = root.join("_DSC7511.ARW");
        let destination_root = root.join("destination");
        fs::create_dir_all(&root).unwrap();
        fs::write(&source_path, b"fake raw bytes").unwrap();

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
                backup_destination_root: None,
                camera_control_values: BTreeMap::new(),
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
                ingest_preset_id: Some("wedding-copy-ingest".to_string()),
                metadata_template_id: None,
            }),
            &state,
        )
        .unwrap();

        assert_eq!(capture.ingest.preset_id, "wedding-copy-ingest");
        assert_eq!(capture.ingest.naming_template, "{counter:04}_{source_stem}");
        assert_eq!(capture.ingest.file_name, "0001_DSC7511.ARW");
        assert_eq!(
            capture.ingest.add_tags,
            vec!["wedding".to_string(), "incoming".to_string()]
        );
        assert_eq!(
            capture.ingest.apply_preset_ids,
            vec!["camera-standard-start".to_string()]
        );

        let sidecar_path = format!("{}.rrdata", capture.imported_path);
        let sidecar = crate::exif_processing::load_sidecar(Path::new(&sidecar_path));
        assert_eq!(
            sidecar.tags.unwrap(),
            vec!["wedding".to_string(), "incoming".to_string()]
        );
        let tether_artifacts = sidecar
            .raw_engine_artifacts
            .unwrap()
            .tether_capture_artifacts;
        assert!(tether_artifacts.iter().any(|artifact| {
            artifact
                .get("artifactType")
                .and_then(|value| value.as_str())
                == Some("tether_import_preset")
                && artifact.get("presetId").and_then(|value| value.as_str())
                    == Some("wedding-copy-ingest")
                && artifact
                    .get("metadataTemplateId")
                    .and_then(|value| value.as_str())
                    == Some("copyright-client-delivery")
                && artifact["applyPresetIds"][0] == "camera-standard-start"
        }));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fake_provider_uses_collision_safe_ingest_counters() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-collision-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_path = root.join("source file.ARW");
        let destination_root = root.join("destination");
        fs::create_dir_all(&destination_root).unwrap();
        fs::write(&source_path, b"fake raw bytes").unwrap();

        open_tether_session_for_state(
            TetherSessionOpenRequest {
                camera_id: "fake-sony-ilce-7m4-usb".to_string(),
                destination_root: Some(destination_root.to_string_lossy().to_string()),
                provider_mode: Some("fake".to_string()),
            },
            &state,
        )
        .unwrap();

        fs::write(
            destination_root.join("fake-sony-ilce-7m4-usb_0001.ARW"),
            b"existing",
        )
        .unwrap();

        let capture = trigger_tether_capture_for_state(
            Some(TetherCaptureRequest {
                backup_destination_root: None,
                camera_control_values: BTreeMap::new(),
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
                ingest_preset_id: Some("cameraSequence".to_string()),
                metadata_template_id: None,
            }),
            &state,
        )
        .unwrap();

        assert_eq!(capture.ingest.preset_id, "cameraSequence");
        assert_eq!(capture.ingest.collision_index, 2);
        assert!(capture.ingest.file_name.ends_with("_0002.ARW"));
        assert_eq!(capture.backup.status, "disabled");
        assert!(!capture.metadata.applied);
        assert!(Path::new(&capture.imported_path).is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fake_provider_suppresses_duplicate_imports_in_session() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-duplicate-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_path = root.join("duplicate-source.ARW");
        let destination_root = root.join("destination");
        fs::create_dir_all(&destination_root).unwrap();
        fs::write(&source_path, b"fake raw bytes").unwrap();

        open_tether_session_for_state(
            TetherSessionOpenRequest {
                camera_id: "fake-sony-ilce-7m4-usb".to_string(),
                destination_root: Some(destination_root.to_string_lossy().to_string()),
                provider_mode: Some("fake".to_string()),
            },
            &state,
        )
        .unwrap();

        let first = trigger_tether_capture_for_state(
            Some(TetherCaptureRequest {
                backup_destination_root: None,
                camera_control_values: BTreeMap::new(),
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
                ingest_preset_id: Some("sourceSequence".to_string()),
                metadata_template_id: None,
            }),
            &state,
        )
        .unwrap();
        let duplicate = trigger_tether_capture_for_state(
            Some(TetherCaptureRequest {
                backup_destination_root: None,
                camera_control_values: BTreeMap::new(),
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
                ingest_preset_id: Some("sourceSequence".to_string()),
                metadata_template_id: None,
            }),
            &state,
        )
        .unwrap();

        assert_eq!(first.status, "captured");
        assert_eq!(duplicate.status, "duplicate");
        assert_eq!(duplicate.imported_path, first.imported_path);
        assert_eq!(duplicate.checksum, first.checksum);
        assert_eq!(duplicate.ingest.file_name, first.ingest.file_name);
        assert_eq!(duplicate.backup.status, "disabled");
        assert_eq!(duplicate.backup.destination_path, None);
        let imported_files = fs::read_dir(&destination_root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str())
                    == Some("ARW")
            })
            .count();
        assert_eq!(imported_files, 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fake_provider_reports_backup_failure_without_losing_primary_capture() {
        let state = AppState::new();
        let root = std::env::temp_dir().join(format!(
            "rawengine-tether-backup-failure-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_path = root.join("source.ARW");
        let destination_root = root.join("destination");
        let backup_blocker = root.join("not-a-directory");
        fs::create_dir_all(&destination_root).unwrap();
        fs::write(&source_path, b"fake raw bytes").unwrap();
        fs::write(&backup_blocker, b"file blocks backup directory").unwrap();

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
                backup_destination_root: Some(backup_blocker.to_string_lossy().to_string()),
                camera_control_values: BTreeMap::new(),
                destination_root: None,
                fake_source_path: Some(source_path.to_string_lossy().to_string()),
                ingest_preset_id: Some("timestampCamera".to_string()),
                metadata_template_id: None,
            }),
            &state,
        )
        .unwrap();

        assert_eq!(capture.status, "captured");
        assert!(Path::new(&capture.imported_path).is_file());
        assert_eq!(capture.backup.status, "failed");
        assert!(capture.backup.error.is_some());

        let _ = fs::remove_dir_all(root);
    }
}
