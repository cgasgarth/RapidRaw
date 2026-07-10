use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rawler::rawimage::{RawImage, RawImageData, RawPhotometricInterpretation};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::app_state::AppState;
use crate::file_management::parse_virtual_path;
use crate::merge::derived_output_provenance::stable_hash;
use crate::raw_processing::decode_raw_sensor_image;

const SR_BAYER_INTAKE_ALGORITHM_ID: &str = "calibrated_bayer_burst_intake_v1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionBayerCalibration {
    pub bayer_pattern: String,
    pub black_level: Vec<f32>,
    pub black_level_repeat: [usize; 3],
    pub bits_per_sample: usize,
    pub white_balance: [f32; 4],
    pub white_level: Vec<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionBayerBurstSource {
    pub block_codes: Vec<String>,
    pub calibration: SuperResolutionBayerCalibration,
    pub camera_make: String,
    pub camera_model: String,
    pub content_hash: String,
    pub height: u32,
    pub path: String,
    pub source_index: usize,
    pub width: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionReadinessSettings {
    pub alignment_mode: String,
    pub detail_policy: String,
    pub max_preview_dimension_px: u32,
    pub output_scale: f32,
    pub quality_preference: String,
    pub reconstruction_mode: String,
    pub source_mode: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionBayerBurstIntake {
    pub algorithm_id: &'static str,
    pub calibration_consistent: bool,
    pub source_count: usize,
    pub sources: Vec<SuperResolutionBayerBurstSource>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionDryRunPlan {
    pub accepted: bool,
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    pub block_codes: Vec<String>,
    pub intake: SuperResolutionBayerBurstIntake,
    pub warning_codes: Vec<String>,
}

fn claim_registration_job(
    registry: &Mutex<Option<Arc<AtomicBool>>>,
) -> Result<Arc<AtomicBool>, String> {
    let mut job = registry
        .lock()
        .map_err(|_| "Super-resolution registration state is unavailable.")?;
    if job.is_some() {
        return Err("A super-resolution registration task is already in progress.".to_string());
    }

    let cancellation_token = Arc::new(AtomicBool::new(false));
    *job = Some(Arc::clone(&cancellation_token));
    Ok(cancellation_token)
}

fn finish_registration_job(
    registry: &Mutex<Option<Arc<AtomicBool>>>,
    cancellation_token: &Arc<AtomicBool>,
) {
    let Ok(mut job) = registry.lock() else {
        return;
    };
    if job
        .as_ref()
        .is_some_and(|active| Arc::ptr_eq(active, cancellation_token))
    {
        *job = None;
    }
}

fn request_registration_cancellation(
    registry: &Mutex<Option<Arc<AtomicBool>>>,
) -> Result<(), String> {
    let job = registry
        .lock()
        .map_err(|_| "Super-resolution registration state is unavailable.")?;
    let Some(cancellation_token) = job.as_ref() else {
        return Err("No super-resolution registration task is currently running.".to_string());
    };
    if cancellation_token.swap(true, Ordering::SeqCst) {
        return Err(
            "Super-resolution registration cancellation is already in progress.".to_string(),
        );
    }
    Ok(())
}

fn check_cancel(cancellation_token: &AtomicBool) -> Result<(), String> {
    if cancellation_token.load(Ordering::SeqCst) {
        return Err("Super-resolution registration cancelled.".to_string());
    }
    Ok(())
}

fn decode_bayer_burst_source(
    virtual_path: &str,
    source_index: usize,
    cancellation_token: &AtomicBool,
) -> Result<SuperResolutionBayerBurstSource, String> {
    check_cancel(cancellation_token)?;
    let source_path = parse_virtual_path(virtual_path).0;
    let bytes = fs::read(&source_path)
        .map_err(|error| format!("Failed to read {}: {error}", source_path.display()))?;
    check_cancel(cancellation_token)?;

    let decoded = decode_raw_sensor_image(&bytes)
        .map_err(|error| format!("Failed to decode {}: {error}", source_path.display()))?;
    check_cancel(cancellation_token)?;

    let raw_image = decoded.raw_image;
    let calibration = calibrated_bayer_sensor(&raw_image).map_err(|reason| {
        format!(
            "{} is not an eligible calibrated Bayer source: {reason}",
            source_path.display()
        )
    })?;
    let width = u32::try_from(raw_image.width).map_err(|_| {
        format!(
            "{} is wider than supported by SR intake.",
            source_path.display()
        )
    })?;
    let height = u32::try_from(raw_image.height).map_err(|_| {
        format!(
            "{} is taller than supported by SR intake.",
            source_path.display()
        )
    })?;

    Ok(SuperResolutionBayerBurstSource {
        block_codes: Vec::new(),
        calibration,
        camera_make: if raw_image.clean_make.is_empty() {
            decoded.metadata.make
        } else {
            raw_image.clean_make
        },
        camera_model: if raw_image.clean_model.is_empty() {
            decoded.metadata.model
        } else {
            raw_image.clean_model
        },
        content_hash: format!("blake3:{}", blake3::hash(&bytes).to_hex()),
        height,
        path: source_path.to_string_lossy().into_owned(),
        source_index,
        width,
    })
}

fn calibrated_bayer_sensor(
    raw_image: &RawImage,
) -> Result<SuperResolutionBayerCalibration, &'static str> {
    let RawPhotometricInterpretation::Cfa(config) = &raw_image.photometric else {
        return Err("decoded image is not a CFA sensor image");
    };
    if raw_image.cpp != 1 || config.cfa.width != 2 || config.cfa.height != 2 || !config.cfa.is_rgb()
    {
        return Err("only 2x2 RGB Bayer CFA sensor images are supported");
    }
    if !matches!(&raw_image.data, RawImageData::Integer(_)) {
        return Err("only integer Bayer sensor samples are supported");
    }
    if raw_image.width == 0 || raw_image.height == 0 {
        return Err("sensor dimensions are empty");
    }

    Ok(SuperResolutionBayerCalibration {
        bayer_pattern: config.cfa.name.clone(),
        black_level: raw_image.blacklevel.as_vec(),
        black_level_repeat: [
            raw_image.blacklevel.width,
            raw_image.blacklevel.height,
            raw_image.blacklevel.cpp,
        ],
        bits_per_sample: raw_image.bps,
        white_balance: raw_image.wb_coeffs,
        white_level: raw_image.whitelevel.0.clone(),
    })
}

fn build_dry_run_plan(
    mut sources: Vec<SuperResolutionBayerBurstSource>,
    settings: &SuperResolutionReadinessSettings,
) -> SuperResolutionDryRunPlan {
    let mut block_codes = Vec::new();
    if sources.len() < 2 {
        block_codes.push("insufficient_sources".to_string());
    }
    if sources.windows(2).any(|pair| {
        pair[0].width != pair[1].width
            || pair[0].height != pair[1].height
            || pair[0].camera_make != pair[1].camera_make
            || pair[0].camera_model != pair[1].camera_model
            || pair[0].calibration.bayer_pattern != pair[1].calibration.bayer_pattern
            || pair[0].calibration.bits_per_sample != pair[1].calibration.bits_per_sample
    }) {
        block_codes.push("inconsistent_bayer_burst_calibration".to_string());
        for source in &mut sources {
            source
                .block_codes
                .push("inconsistent_bayer_burst_calibration".to_string());
        }
    }
    let calibration_consistent = !block_codes
        .iter()
        .any(|code| code == "inconsistent_bayer_burst_calibration");
    let intake = SuperResolutionBayerBurstIntake {
        algorithm_id: SR_BAYER_INTAKE_ALGORITHM_ID,
        calibration_consistent,
        source_count: sources.len(),
        sources,
    };
    let plan_hash = stable_hash(&json!({
        "algorithmId": intake.algorithm_id,
        "settings": settings,
        "sources": intake.sources,
    }));
    let plan_id = format!("super_resolution_bayer_plan_{}", &plan_hash[7..23]);

    SuperResolutionDryRunPlan {
        accepted: block_codes.is_empty(),
        accepted_dry_run_plan_hash: plan_hash,
        accepted_dry_run_plan_id: plan_id,
        block_codes,
        intake,
        warning_codes: vec!["registration_not_executed_dry_run_only".to_string()],
    }
}

#[tauri::command]
pub async fn plan_super_resolution(
    paths: Vec<String>,
    settings: SuperResolutionReadinessSettings,
    state: tauri::State<'_, AppState>,
) -> Result<SuperResolutionDryRunPlan, String> {
    if !(2..=8).contains(&paths.len()) {
        return Err(
            "Super-resolution requires between two and eight RAW Bayer images.".to_string(),
        );
    }
    if !(1.1..=4.0).contains(&settings.output_scale)
        || settings.max_preview_dimension_px == 0
        || settings.source_mode != "multi_image"
    {
        return Err("Super-resolution readiness settings are invalid.".to_string());
    }

    let cancellation_token = claim_registration_job(&state.super_resolution_registration_job)?;
    let task_token = Arc::clone(&cancellation_token);
    let task = tokio::task::spawn_blocking(move || {
        let mut sources = Vec::with_capacity(paths.len());
        for (source_index, path) in paths.iter().enumerate() {
            sources.push(decode_bayer_burst_source(path, source_index, &task_token)?);
        }
        check_cancel(&task_token)?;
        Ok(build_dry_run_plan(sources, &settings))
    });
    let result = task
        .await
        .map_err(|error| format!("Super-resolution registration task failed: {error}"))
        .and_then(|result| result);
    finish_registration_job(
        &state.super_resolution_registration_job,
        &cancellation_token,
    );
    result
}

#[tauri::command]
pub fn cancel_super_resolution_registration(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    request_registration_cancellation(&state.super_resolution_registration_job)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(index: usize) -> SuperResolutionBayerBurstSource {
        SuperResolutionBayerBurstSource {
            block_codes: Vec::new(),
            calibration: SuperResolutionBayerCalibration {
                bayer_pattern: "RGGB".to_string(),
                black_level: vec![512.0],
                black_level_repeat: [1, 1, 1],
                bits_per_sample: 14,
                white_balance: [2.0, 1.0, 1.0, 1.5],
                white_level: vec![16_383],
            },
            camera_make: "Example".to_string(),
            camera_model: "BurstCam".to_string(),
            content_hash: format!("blake3:{index}"),
            height: 3_000,
            path: format!("/tmp/burst-{index}.arw"),
            source_index: index,
            width: 4_000,
        }
    }

    #[test]
    fn calibrated_bayer_burst_plan_is_accepted_and_deterministic() {
        let first = build_dry_run_plan(vec![source(0), source(1)], &settings());
        let second = build_dry_run_plan(vec![source(0), source(1)], &settings());

        assert!(first.accepted);
        assert!(first.intake.calibration_consistent);
        assert_eq!(
            first.accepted_dry_run_plan_hash,
            second.accepted_dry_run_plan_hash
        );
        assert_eq!(
            first.accepted_dry_run_plan_id,
            second.accepted_dry_run_plan_id
        );
        assert_eq!(first.intake.algorithm_id, SR_BAYER_INTAKE_ALGORITHM_ID);
    }

    #[test]
    fn mismatched_bayer_pattern_blocks_plan() {
        let mut shifted = source(1);
        shifted.calibration.bayer_pattern = "BGGR".to_string();
        let plan = build_dry_run_plan(vec![source(0), shifted], &settings());

        assert!(!plan.accepted);
        assert!(!plan.intake.calibration_consistent);
        assert!(
            plan.block_codes
                .contains(&"inconsistent_bayer_burst_calibration".to_string())
        );
    }

    #[test]
    fn cancellation_claim_is_exclusive_and_clears_after_completion() {
        let registry = Mutex::new(None);
        let token = claim_registration_job(&registry).expect("first job should claim registry");
        assert!(claim_registration_job(&registry).is_err());
        request_registration_cancellation(&registry).expect("active job should cancel");
        assert!(check_cancel(&token).is_err());

        finish_registration_job(&registry, &token);
        assert!(claim_registration_job(&registry).is_ok());
    }

    fn settings() -> SuperResolutionReadinessSettings {
        SuperResolutionReadinessSettings {
            alignment_mode: "auto".to_string(),
            detail_policy: "conservative".to_string(),
            max_preview_dimension_px: 2400,
            output_scale: 2.0,
            quality_preference: "best".to_string(),
            reconstruction_mode: "model_detail".to_string(),
            source_mode: "multi_image".to_string(),
        }
    }
}
