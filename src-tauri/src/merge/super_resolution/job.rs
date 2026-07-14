use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::merge::{
    computational_job::{ComputationalMergeJobId, ComputationalMergeProgress},
    tile_runtime::StageWorkUnits,
};

pub(crate) const STAGES: [&str; 10] = [
    "source_review_validation",
    "sequential_cfa_cache",
    "registration_verification",
    "full_resolution_cfa",
    "fused_color",
    "motion_support_fallback",
    "quality_and_sharpening",
    "review_artifacts",
    "candidate_validation",
    "complete",
];
const WEIGHTS: [u64; 10] = [3, 12, 5, 25, 12, 15, 10, 7, 10, 1];

pub(crate) fn stage_work_units(tiles: u64, sources: u64) -> Vec<StageWorkUnits> {
    STAGES
        .iter()
        .zip(WEIGHTS)
        .map(|(stage, weight)| StageWorkUnits {
            stage: (*stage).into(),
            units: match *stage {
                "sequential_cfa_cache" => sources,
                "full_resolution_cfa" => tiles * 4,
                "fused_color"
                | "motion_support_fallback"
                | "quality_and_sharpening"
                | "review_artifacts" => tiles,
                _ => 1,
            }
            .max(1),
            weight,
        })
        .collect()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BurstSrCandidateJobResult {
    pub job_id: String,
    pub status: String,
    pub error_code: Option<String>,
    pub candidate: Option<super::candidate::BurstSrCandidateHandle>,
    pub progress: ComputationalMergeProgress,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BurstSrCandidateJobHandle {
    pub job_id: String,
    pub status: &'static str,
}

#[tauri::command]
pub fn prepare_burst_sr_candidate(
    accepted_review_id: String,
    memory_budget_bytes: Option<u64>,
    requested_tile_size: Option<u32>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::app_state::AppState>,
) -> Result<BurstSrCandidateJobHandle, String> {
    let accepted = state
        .services
        .burst_sr
        .accepted(&accepted_review_id)
        .map_err(str::to_string)?;
    let plan = super::tiles::plan(
        accepted.runtime.identity.width,
        accepted.runtime.identity.height,
        accepted.runtime.paths.len(),
        memory_budget_bytes.unwrap_or(crate::merge::tile_runtime::DEFAULT_MEMORY_BUDGET_BYTES),
        requested_tile_size.unwrap_or(super::tiles::DEFAULT_CORE),
    )?;
    let total_units = plan.stage_work_units.iter().map(|stage| stage.units).sum();
    let job = state.computational_merge_jobs.begin(
        crate::merge::computational_job::ComputationalMergeFamily::SuperResolution,
        STAGES[0],
        total_units,
        100,
    )?;
    let id = job.job_id.to_string();
    let result_id = id.clone();
    if let Err(error) = state.services.burst_sr.register_job(&accepted, id.clone()) {
        let _ = state.computational_merge_jobs.cancel(&job.job_id);
        return Err(error.to_string());
    }
    std::thread::Builder::new()
        .name(format!("burst-sr-candidate-{id}"))
        .spawn(move || {
            let state = app_handle.state::<crate::app_state::AppState>();
            let outcome = (|| {
                let root = app_handle
                    .path()
                    .app_cache_dir()
                    .map_err(|e| format!("sr_candidate_cache_failed:{e}"))?
                    .join("burst-sr-candidates");
                std::fs::create_dir_all(&root)
                    .map_err(|e| format!("sr_candidate_cache_failed:{e}"))?;
                super::candidate::prepare(
                    &root,
                    &accepted.runtime,
                    &plan,
                    &job.job_id,
                    &job.cancellation_token,
                    &state.computational_merge_jobs,
                )
            })();
            let mut candidate_path = None;
            let (status, error_code, candidate) = match outcome {
                Ok(output)
                    if state
                        .computational_merge_jobs
                        .finish(&job.job_id)
                        .unwrap_or(false) =>
                {
                    candidate_path = Some(output.path);
                    ("succeeded", None, Some(output.handle))
                }
                Ok(output) => {
                    let _ = std::fs::remove_dir_all(output.path);
                    (
                        "cancelled",
                        Some("computational_merge_cancelled".into()),
                        None,
                    )
                }
                Err(error) => {
                    let _ = state.computational_merge_jobs.fail(&job.job_id);
                    let status = if error == "computational_merge_cancelled" {
                        "cancelled"
                    } else {
                        "failed"
                    };
                    (status, Some(error), None)
                }
            };
            let published = state
                .computational_merge_jobs
                .progress(&job.job_id)
                .is_some_and(|progress| {
                    let result = BurstSrCandidateJobResult {
                        job_id: result_id.clone(),
                        status: status.into(),
                        error_code,
                        candidate,
                        progress,
                    };
                    state
                        .services
                        .burst_sr
                        .publish_job_result(&accepted, result_id, result)
                        .is_ok()
                });
            if !published && let Some(path) = candidate_path {
                let _ = std::fs::remove_dir_all(path);
            }
        })
        .map_err(|e| format!("sr_candidate_job_spawn_failed:{e}"))?;
    Ok(BurstSrCandidateJobHandle {
        job_id: id,
        status: "active",
    })
}

#[tauri::command]
pub fn read_burst_sr_candidate_job(
    job_id: String,
    state: tauri::State<'_, crate::app_state::AppState>,
) -> Result<BurstSrCandidateJobResult, String> {
    let id = ComputationalMergeJobId::from_string(job_id.clone());
    if let Some(result) = state.services.burst_sr.read_job_result(&job_id) {
        return Ok(result);
    }
    if !state.services.burst_sr.job_current(&job_id) {
        return Err("computational_merge_job_not_found".to_string());
    }
    let progress = state
        .computational_merge_jobs
        .progress(&id)
        .ok_or("computational_merge_job_not_found")?;
    Ok(BurstSrCandidateJobResult {
        job_id,
        status: format!("{:?}", progress.status).to_lowercase(),
        error_code: None,
        candidate: None,
        progress,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stage_graph_is_frozen_and_weighted() {
        let stages = stage_work_units(12, 4);
        assert_eq!(stages.len(), 10);
        assert_eq!(stages.iter().map(|stage| stage.weight).sum::<u64>(), 100);
        assert_eq!(stages[3].units, 48);
    }
}
