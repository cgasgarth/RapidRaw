use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::json;

use crate::app_state::AppState;
use crate::merge::derived_output_provenance::stable_hash;

use super::raw_frame::{
    SR_BAYER_INTAKE_ALGORITHM_ID, SuperResolutionBayerBurstSource, SuperResolutionRawFrame,
    SuperResolutionReadinessSettings, check_cancel, decode_bayer_burst_frame,
};
use super::registration::{SuperResolutionRegistrationResult, solve_global_se2_registration};

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
    pub registration: Option<SuperResolutionRegistrationResult>,
    pub registration_input_hash: String,
    pub warning_codes: Vec<String>,
}

fn claim_registration_job(
    registry: &Mutex<Option<Arc<AtomicBool>>>,
) -> Result<Arc<AtomicBool>, String> {
    let mut job = registry
        .lock()
        .map_err(|_| "super_resolution_registration_state_unavailable".to_string())?;
    if job.is_some() {
        return Err("super_resolution_registration_already_running".to_string());
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
        .map_err(|_| "super_resolution_registration_state_unavailable".to_string())?;
    let Some(cancellation_token) = job.as_ref() else {
        return Err("super_resolution_registration_not_running".to_string());
    };
    if cancellation_token.swap(true, Ordering::SeqCst) {
        return Err("super_resolution_registration_cancellation_already_requested".to_string());
    }
    Ok(())
}

fn build_dry_run_plan(
    mut frames: Vec<SuperResolutionRawFrame>,
    settings: &SuperResolutionReadinessSettings,
    cancellation_token: &AtomicBool,
) -> Result<SuperResolutionDryRunPlan, String> {
    check_cancel(cancellation_token)?;
    let mut block_codes = settings_block_codes(settings);
    if frames.len() < 2 {
        block_codes.push("insufficient_sources".to_string());
    }
    if frames.windows(2).any(|pair| {
        pair[0].source.width != pair[1].source.width
            || pair[0].source.height != pair[1].source.height
            || pair[0].source.camera_make != pair[1].source.camera_make
            || pair[0].source.camera_model != pair[1].source.camera_model
            || pair[0].source.calibration.bayer_pattern != pair[1].source.calibration.bayer_pattern
            || pair[0].source.calibration.bits_per_sample
                != pair[1].source.calibration.bits_per_sample
            || pair[0].source.calibration_identity != pair[1].source.calibration_identity
    }) {
        block_codes.push("inconsistent_bayer_burst_calibration".to_string());
        for frame in &mut frames {
            frame
                .source
                .block_codes
                .push("inconsistent_bayer_burst_calibration".to_string());
        }
    }
    block_codes.sort();
    block_codes.dedup();
    let calibration_consistent = !block_codes
        .iter()
        .any(|code| code == "inconsistent_bayer_burst_calibration");
    let registration_input_hash = stable_hash(&json!({
        "algorithmId": SR_BAYER_INTAKE_ALGORITHM_ID,
        "proxy": {
            "algorithmId": super::raw_frame::SR_GREEN_PROXY_ALGORITHM_ID,
            "cropVersion": super::raw_frame::SR_PROXY_CROP_VERSION,
            "normalizationVersion": super::raw_frame::SR_PROXY_NORMALIZATION_VERSION,
        },
        "settings": settings,
        "sources": frames.iter().map(|frame| &frame.source).collect::<Vec<_>>(),
    }));
    let mut registration = None;
    if block_codes.is_empty() {
        let (result, registration_blocks) =
            solve_global_se2_registration(&frames, cancellation_token)?;
        block_codes.extend(registration_blocks);
        registration = Some(result);
    }
    block_codes.sort();
    block_codes.dedup();
    let intake = SuperResolutionBayerBurstIntake {
        algorithm_id: SR_BAYER_INTAKE_ALGORITHM_ID,
        calibration_consistent,
        source_count: frames.len(),
        sources: frames.into_iter().map(|frame| frame.source).collect(),
    };
    let plan_identity = json!({
        "blockCodes": block_codes,
        "intake": &intake,
        "registration": &registration,
        "registrationInputHash": &registration_input_hash,
        "settings": settings,
    });
    let plan_hash = stable_hash(&plan_identity);
    let plan_id = format!("super_resolution_registration_plan_{}", &plan_hash[7..23]);
    let mut warning_codes = vec!["native_registration_preview_only_no_reconstruction".to_string()];
    if registration
        .as_ref()
        .is_some_and(|result| !result.excluded_sources.is_empty())
    {
        warning_codes.push("registration_excluded_sources".to_string());
    }
    if !block_codes.is_empty() {
        warning_codes.push("registration_not_accepted".to_string());
    }

    Ok(SuperResolutionDryRunPlan {
        accepted: block_codes.is_empty(),
        accepted_dry_run_plan_hash: plan_hash,
        accepted_dry_run_plan_id: plan_id,
        block_codes,
        intake,
        registration,
        registration_input_hash,
        warning_codes,
    })
}

fn settings_block_codes(settings: &SuperResolutionReadinessSettings) -> Vec<String> {
    let mut codes = Vec::new();
    if settings.source_mode != "multi_image" {
        codes.push("unsupported_source_mode".to_string());
    }
    if settings.alignment_mode != "auto" && settings.alignment_mode != "translation" {
        codes.push("unsupported_alignment_model".to_string());
    }
    if (settings.output_scale - 2.0).abs() > f32::EPSILON {
        codes.push("unsupported_output_scale".to_string());
    }
    if settings.max_preview_dimension_px == 0 {
        codes.push("invalid_preview_dimension".to_string());
    }
    codes
}

pub async fn plan_super_resolution(
    paths: Vec<String>,
    settings: SuperResolutionReadinessSettings,
    state: tauri::State<'_, AppState>,
) -> Result<SuperResolutionDryRunPlan, String> {
    if !(2..=8).contains(&paths.len()) {
        return Err("super_resolution_source_count_out_of_range".to_string());
    }
    let cancellation_token = claim_registration_job(&state.super_resolution_registration_job)?;
    let task_token = Arc::clone(&cancellation_token);
    let task = tokio::task::spawn_blocking(move || {
        let mut frames = Vec::with_capacity(paths.len());
        for (source_index, path) in paths.iter().enumerate() {
            check_cancel(&task_token)?;
            frames.push(decode_bayer_burst_frame(
                path,
                source_index,
                settings.max_preview_dimension_px,
                &task_token,
            )?);
        }
        build_dry_run_plan(frames, &settings, &task_token)
    });
    let result = task
        .await
        .map_err(|error| format!("super_resolution_registration_task_failed:{error}"))
        .and_then(|result| result);
    finish_registration_job(
        &state.super_resolution_registration_job,
        &cancellation_token,
    );
    result
}

pub fn cancel_super_resolution_registration(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    request_registration_cancellation(&state.super_resolution_registration_job)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;

    #[test]
    fn unsupported_models_fail_closed_before_registration() {
        let settings = SuperResolutionReadinessSettings {
            alignment_mode: "homography".to_string(),
            detail_policy: "conservative".to_string(),
            max_preview_dimension_px: 2400,
            output_scale: 2.0,
            quality_preference: "best".to_string(),
            reconstruction_mode: "model_detail".to_string(),
            source_mode: "multi_image".to_string(),
        };
        assert_eq!(
            settings_block_codes(&settings),
            vec!["unsupported_alignment_model"]
        );
    }

    #[test]
    fn cancellation_registry_is_exclusive_and_clears() {
        let registry = Mutex::new(None);
        let token = claim_registration_job(&registry).expect("first job claims registry");
        assert!(claim_registration_job(&registry).is_err());
        request_registration_cancellation(&registry).expect("active job cancels");
        assert!(check_cancel(&token).is_err());
        finish_registration_job(&registry, &token);
        assert!(claim_registration_job(&registry).is_ok());
    }

    #[test]
    fn private_alaska_burst_runs_native_se2_registration_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_SR_SE2_REGISTRATION_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            return;
        }
        let private_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
                .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
        );
        let paths = [
            "private-fixtures/super-resolution/alaska-burst-v1/_DSC7861.ARW",
            "private-fixtures/super-resolution/alaska-burst-v1/_DSC7862.ARW",
            "private-fixtures/super-resolution/alaska-burst-v1/_DSC7863.ARW",
            "private-fixtures/super-resolution/alaska-burst-v1/_DSC7864.ARW",
        ]
        .into_iter()
        .map(|relative_path| {
            private_root
                .join(relative_path)
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
        let settings = SuperResolutionReadinessSettings {
            alignment_mode: "auto".to_string(),
            detail_policy: "conservative".to_string(),
            max_preview_dimension_px: 2400,
            output_scale: 2.0,
            quality_preference: "best".to_string(),
            reconstruction_mode: "model_detail".to_string(),
            source_mode: "multi_image".to_string(),
        };
        let token = AtomicBool::new(false);
        let frames = paths
            .iter()
            .enumerate()
            .map(|(source_index, path)| {
                decode_bayer_burst_frame(
                    path,
                    source_index,
                    settings.max_preview_dimension_px,
                    &token,
                )
            })
            .collect::<Result<Vec<_>, _>>()
            .expect("private Alaska burst decodes as calibrated Bayer");
        let plan = build_dry_run_plan(frames, &settings, &token)
            .expect("native SR registration returns a deterministic plan");
        let registration = plan
            .registration
            .as_ref()
            .expect("calibrated private burst produces a native registration result");
        let output_dir = private_root.join("private-artifacts/validation/computational-merge");
        std::fs::create_dir_all(&output_dir).expect("private proof output directory exists");
        let report = json!({
            "accepted": plan.accepted,
            "acceptedDryRunPlanHash": plan.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": plan.accepted_dry_run_plan_id,
            "blockCodes": plan.block_codes,
            "excludedSources": registration.excluded_sources,
            "previewHash": registration.preview.content_hash,
            "referenceSourceIndex": registration.reference_source_index,
            "registrationAlgorithm": registration.algorithm_id,
            "registrationInputHash": plan.registration_input_hash,
            "selectedSourceIndexes": registration.selected_source_indexes,
            "sourceHashes": plan.intake.sources.iter().map(|source| &source.content_hash).collect::<Vec<_>>(),
            "summary": registration.summary,
            "transforms": registration.transforms,
            "warningCodes": plan.warning_codes,
        });
        std::fs::write(
            output_dir.join("sr-se2-registration-runtime.json"),
            serde_json::to_vec_pretty(&report).expect("sanitized private proof serializes"),
        )
        .expect("sanitized private proof writes");
        assert!(
            plan.accepted
                || registration
                    .excluded_sources
                    .iter()
                    .any(|exclusion| exclusion.code == "residual_inlier_coverage_failure"),
            "private burst must either be accepted or fail closed with a measured residual rejection: {:?}",
            plan.block_codes
        );
    }
}
