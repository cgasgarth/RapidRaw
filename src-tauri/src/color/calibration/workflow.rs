use super::{
    CalibrationJobResult, CalibrationQualityStatus, ChartGeometry, ChartSamplingReceipt,
    FitCalibrationInput, chart_definition, fit_calibration, sample_chart,
};
use crate::{
    color::{
        calibration::dcp::{encode_generated_dual_matrix_dcp, encode_generated_matrix_dcp},
        camera_profile::{DcpParseLimits, parse_dcp, registry::managed_profile_root},
    },
    file_management::parse_virtual_path,
    raw::raw_processing::decode_raw_camera_linear_for_calibration,
    source_revision::SourceRevision,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

const MAX_CALIBRATION_RAW_BYTES: u64 = 2 * 1024 * 1024 * 1024;
static ACTIVE_CALIBRATION_JOBS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct ChartCalibrationJob {
    id: String,
    cancelled: Arc<AtomicBool>,
}

impl ChartCalibrationJob {
    fn begin(id: String) -> Result<Self, String> {
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        {
            return Err("chart_calibration_job_id_invalid".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut jobs = ACTIVE_CALIBRATION_JOBS.lock().unwrap();
        if jobs.contains_key(&id) {
            return Err("chart_calibration_job_already_running".into());
        }
        jobs.insert(id.clone(), Arc::clone(&cancelled));
        Ok(Self { id, cancelled })
    }

    fn checkpoint(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("chart_calibration_cancelled".into())
        } else {
            Ok(())
        }
    }
}

impl Drop for ChartCalibrationJob {
    fn drop(&mut self) {
        ACTIVE_CALIBRATION_JOBS.lock().unwrap().remove(&self.id);
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SampleChartInput {
    pub job_id: String,
    pub source_path: String,
    pub chart_id: String,
    pub geometry: ChartGeometry,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FitChartInput {
    pub job_id: String,
    pub source_path: String,
    pub calibration: FitCalibrationInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CombineChartCalibrationsInput {
    pub warm: super::CalibrationFitReceipt,
    pub cool: super::CalibrationFitReceipt,
    pub profile_name: String,
    pub confirm_warning: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DualCalibrationJobResult {
    pub published_profile_id: String,
    pub warm_solver_fingerprint: String,
    pub cool_solver_fingerprint: String,
    pub interpolation_contract: String,
}

#[tauri::command]
pub(crate) async fn sample_color_chart(
    input: SampleChartInput,
) -> Result<ChartSamplingReceipt, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let job = ChartCalibrationJob::begin(input.job_id)?;
        let path = parse_virtual_path(&input.source_path).0;
        let metadata =
            fs::metadata(&path).map_err(|_| "chart_calibration_source_unavailable".to_string())?;
        if !metadata.is_file() || metadata.len() > MAX_CALIBRATION_RAW_BYTES {
            return Err("chart_calibration_source_invalid".to_string());
        }
        let revision = SourceRevision::from_path(&path)
            .map_err(|_| "chart_calibration_source_revision_failed".to_string())?;
        let bytes =
            fs::read(&path).map_err(|_| "chart_calibration_source_read_failed".to_string())?;
        job.checkpoint()?;
        let frame =
            decode_raw_camera_linear_for_calibration(&bytes).map_err(|error| error.to_string())?;
        job.checkpoint()?;
        let chart = chart_definition(&input.chart_id).map_err(|error| error.to_string())?;
        sample_chart(&frame, &chart, &input.geometry, revision.identity())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn fit_color_chart(
    app: tauri::AppHandle,
    input: FitChartInput,
) -> Result<CalibrationJobResult, String> {
    let managed_root = managed_profile_root(&app).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let job = ChartCalibrationJob::begin(input.job_id)?;
        let source_path = parse_virtual_path(&input.source_path).0;
        let revision = SourceRevision::from_path(source_path.as_path())
            .map_err(|_| "chart_calibration_source_revision_failed".to_string())?;
        if revision.identity() != input.calibration.sampling.source_revision {
            return Err("chart_calibration_source_revision_changed".to_string());
        }
        let chart = chart_definition(&input.calibration.sampling.chart_id)
            .map_err(|error| error.to_string())?;
        let receipt = fit_calibration(
            &input.calibration.sampling,
            &chart,
            input.calibration.illuminant,
        )
        .map_err(|error| error.to_string())?;
        job.checkpoint()?;
        let published_profile_id = if input.calibration.publish {
            if !receipt.quality_status.publishable() {
                return Err("chart_calibration_quality_not_publishable".to_string());
            }
            if receipt.quality_status == CalibrationQualityStatus::WarningPublishable
                && !input.calibration.confirm_warning
            {
                return Err("chart_calibration_warning_confirmation_required".to_string());
            }
            Some(publish_generated_profile(
                &managed_root,
                &receipt,
                &input.calibration.profile_name,
            )?)
        } else {
            None
        };
        Ok(CalibrationJobResult {
            receipt,
            published_profile_id,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_color_chart_calibration(job_id: String) -> Result<(), String> {
    let jobs = ACTIVE_CALIBRATION_JOBS.lock().unwrap();
    let Some(cancelled) = jobs.get(&job_id) else {
        return Ok(());
    };
    cancelled.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub(crate) async fn combine_color_chart_calibrations(
    app: tauri::AppHandle,
    input: CombineChartCalibrationsInput,
) -> Result<DualCalibrationJobResult, String> {
    let managed_root = managed_profile_root(&app).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        if (input.warm.quality_status == CalibrationQualityStatus::WarningPublishable
            || input.cool.quality_status == CalibrationQualityStatus::WarningPublishable)
            && !input.confirm_warning
        {
            return Err("chart_calibration_warning_confirmation_required".to_string());
        }
        let bytes = encode_generated_dual_matrix_dcp(&input.warm, &input.cool, &input.profile_name)
            .map_err(|error| error.to_string())?;
        let warm_solver_fingerprint = input.warm.solver_fingerprint.clone();
        let cool_solver_fingerprint = input.cool.solver_fingerprint.clone();
        let provenance = serde_json::json!({
            "schemaVersion": 1,
            "interpolationContract": "dcp_reciprocal_temperature_v1",
            "warm": input.warm,
            "cool": input.cool,
        });
        let published_profile_id = persist_generated_profile(&managed_root, &bytes, provenance)?;
        Ok(DualCalibrationJobResult {
            published_profile_id,
            warm_solver_fingerprint,
            cool_solver_fingerprint,
            interpolation_contract: "dcp_reciprocal_temperature_v1".into(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn publish_generated_profile(
    managed_root: &std::path::Path,
    receipt: &super::CalibrationFitReceipt,
    profile_name: &str,
) -> Result<String, String> {
    let bytes =
        encode_generated_matrix_dcp(receipt, profile_name).map_err(|error| error.to_string())?;
    let provenance = serde_json::json!({ "schemaVersion": 1, "receipt": receipt });
    persist_generated_profile(managed_root, &bytes, provenance)
}

fn persist_generated_profile(
    managed_root: &std::path::Path,
    bytes: &[u8],
    mut provenance: serde_json::Value,
) -> Result<String, String> {
    let parsed = parse_dcp(bytes, DcpParseLimits::default()).map_err(|error| error.to_string())?;
    let digest = parsed
        .content_sha256
        .strip_prefix("sha256:")
        .ok_or_else(|| "chart_calibration_profile_hash_invalid".to_string())?;
    let profile_id = format!("dcp:{digest}");
    let Some(provenance_object) = provenance.as_object_mut() else {
        return Err("chart_calibration_receipt_serialize_failed".into());
    };
    provenance_object.insert("profileId".into(), profile_id.clone().into());
    let provenance = serde_json::to_vec_pretty(&provenance)
        .map_err(|_| "chart_calibration_receipt_serialize_failed".to_string())?;
    let generated_root = managed_root.join("generated");
    fs::create_dir_all(&generated_root)
        .map_err(|_| "chart_calibration_profile_create_dir_failed".to_string())?;
    let destination = generated_root.join(format!("{digest}.dcp"));
    if !destination.exists() {
        let mut temporary = tempfile::NamedTempFile::new_in(&generated_root)
            .map_err(|_| "chart_calibration_profile_temp_failed".to_string())?;
        temporary
            .write_all(bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| "chart_calibration_profile_write_failed".to_string())?;
        temporary
            .persist(&destination)
            .map_err(|_| "chart_calibration_profile_persist_failed".to_string())?;
    }
    let receipt_path = generated_root.join(format!("{digest}.calibration.json"));
    let mut receipt_temp = tempfile::NamedTempFile::new_in(&generated_root)
        .map_err(|_| "chart_calibration_receipt_temp_failed".to_string())?;
    receipt_temp
        .write_all(&provenance)
        .and_then(|_| receipt_temp.as_file().sync_all())
        .map_err(|_| "chart_calibration_receipt_write_failed".to_string())?;
    receipt_temp
        .persist(&receipt_path)
        .map_err(|_| "chart_calibration_receipt_persist_failed".to_string())?;
    Ok(profile_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::calibration::{
        CALIBRATION_CONTRACT, CALIBRATION_SOLVER_VERSION, CalibrationFitReceipt, ColorErrorMetrics,
        IlluminantCoordinates,
    };
    use crate::color::camera_profile::registry::resolve_managed_profile;

    #[test]
    fn publish_is_atomic_registry_compatible_and_provenance_sidecar_is_restart_safe() {
        let metrics = ColorErrorMetrics {
            mean_delta_e00: 0.5,
            median_delta_e00: 0.4,
            p95_delta_e00: 0.9,
            max_delta_e00: 1.1,
            neutral_axis_error: 0.2,
            skin_mean_delta_e00: Some(0.6),
        };
        let receipt = CalibrationFitReceipt {
            contract: CALIBRATION_CONTRACT.into(),
            implementation_version: CALIBRATION_SOLVER_VERSION,
            camera_identity: "Synthetic Camera".into(),
            source_revision: "source-revision-v1:private-token".into(),
            raw_processing_profile: "technical".into(),
            chart_id: "colorchecker_classic_24_cc0_srgb_d65_v1".into(),
            chart_version: 1,
            chart_reference_illuminant: "D65".into(),
            chart_observer: "CIE 1931 2 degree".into(),
            chart_provenance: "test".into(),
            chart_license: "CC0-1.0".into(),
            chart_source_url: "https://example.invalid/chart".into(),
            illuminant: IlluminantCoordinates {
                x: 0.3127,
                y: 0.3290,
                cct_kelvin: Some(6504.0),
                duv: Some(0.0),
            },
            adaptation: "Bradford".into(),
            train_patch_ids: vec!["one".into()],
            validation_patch_ids: vec!["two".into()],
            camera_to_xyz: [[0.7, 0.2, 0.1], [0.1, 0.8, 0.1], [0.02, 0.08, 0.9]],
            condition_number: 1.4,
            rejected_patch_ids: Vec::new(),
            train_metrics: metrics.clone(),
            validation_metrics: metrics,
            residual_model_accepted: false,
            quality_status: CalibrationQualityStatus::Excellent,
            warning_codes: Vec::new(),
            solver_fingerprint: "blake3:test".into(),
        };
        let root = tempfile::tempdir().unwrap();
        let id = publish_generated_profile(root.path(), &receipt, "Generated Neutral").unwrap();
        let (profile, source) = resolve_managed_profile(&id, root.path()).unwrap();
        assert_eq!(
            source,
            crate::color::camera_profile::CameraProfileSource::Generated
        );
        assert_eq!(profile.name, "Generated Neutral");
        let digest = id.trim_start_matches("dcp:");
        let sidecar = fs::read_to_string(
            root.path()
                .join("generated")
                .join(format!("{digest}.calibration.json")),
        )
        .unwrap();
        assert!(sidecar.contains("source-revision-v1:private-token"));
        assert!(!sidecar.contains("/Users/"));
        assert!(!sidecar.contains("private/test.raw"));
    }

    #[test]
    fn cancellation_is_idempotent_and_removes_finished_job_identity() {
        let job = ChartCalibrationJob::begin("calibration-cancel-test".into()).unwrap();
        cancel_color_chart_calibration("calibration-cancel-test".into()).unwrap();
        assert_eq!(job.checkpoint().unwrap_err(), "chart_calibration_cancelled");
        drop(job);
        cancel_color_chart_calibration("calibration-cancel-test".into()).unwrap();
        ChartCalibrationJob::begin("calibration-cancel-test".into())
            .expect("completed job identity can be reused");
    }
}
