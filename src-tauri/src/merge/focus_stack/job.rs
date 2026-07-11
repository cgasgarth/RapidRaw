use std::{collections::HashMap, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::merge::{
    computational_job::{ComputationalMergeJobId, ComputationalMergeProgress},
    tile_runtime::StageWorkUnits,
};

pub(crate) const STAGES: [&str; 10] = [
    "source_validation",
    "bounded_decode",
    "alignment_verification",
    "coarse_label_plan",
    "full_resolution_labels",
    "risk_and_retouch_maps",
    "multiresolution_blend",
    "review_artifact_encoding",
    "candidate_tile_store_finalization",
    "complete",
];
const WEIGHTS: [u64; 10] = [3, 8, 5, 7, 22, 10, 28, 7, 9, 1];

pub(crate) fn stage_work_units(tiles: u64, sources: u64) -> Vec<StageWorkUnits> {
    STAGES
        .iter()
        .zip(WEIGHTS)
        .map(|(stage, weight)| StageWorkUnits {
            stage: (*stage).into(),
            units: match *stage {
                "bounded_decode" => sources,
                "full_resolution_labels" | "risk_and_retouch_maps" | "review_artifact_encoding" => {
                    tiles
                }
                "multiresolution_blend" => tiles * sources * super::tiles::PYRAMID_LEVELS as u64,
                _ => 1,
            }
            .max(1),
            weight,
        })
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusStackCandidateJobResult {
    pub job_id: String,
    pub status: String,
    pub error_code: Option<String>,
    pub candidate: Option<super::candidate::FocusStackCandidateHandle>,
    pub progress: ComputationalMergeProgress,
}

#[derive(Default)]
pub struct FocusStackJobResults(Mutex<HashMap<String, FocusStackCandidateJobResult>>);

impl FocusStackJobResults {
    pub(crate) fn read(
        &self,
        id: &ComputationalMergeJobId,
    ) -> Option<FocusStackCandidateJobResult> {
        self.0.lock().ok()?.get(&id.to_string()).cloned()
    }
    fn insert(&self, id: String, result: FocusStackCandidateJobResult) {
        if let Ok(mut results) = self.0.lock() {
            results.insert(id, result);
        }
    }
}

pub(crate) use super::candidate::AcceptedFocusRuntime;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusStackCandidateJobHandle {
    pub job_id: String,
    pub status: &'static str,
}

#[tauri::command]
pub fn prepare_focus_stack_candidate(
    accepted_preview_id: String,
    memory_budget_bytes: Option<u64>,
    requested_tile_size: Option<u32>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::app_state::AppState>,
) -> Result<FocusStackCandidateJobHandle, String> {
    let accepted = state
        .focus_stack_accepted_runtime
        .lock()
        .map_err(|_| "focus_runtime_unavailable")?
        .clone()
        .ok_or("focus_candidate_requires_accepted_preview")?;
    if accepted.identity.plan_id != accepted_preview_id {
        return Err("focus_candidate_accepted_preview_mismatch".into());
    }
    let tile_plan = super::tiles::plan(
        accepted.identity.width,
        accepted.identity.height,
        accepted.paths.len(),
        memory_budget_bytes.unwrap_or(crate::merge::tile_runtime::DEFAULT_MEMORY_BUDGET_BYTES),
        requested_tile_size.unwrap_or(super::tiles::DEFAULT_CORE),
    )?;
    let total_units = tile_plan
        .stage_work_units
        .iter()
        .map(|stage| stage.units)
        .sum();
    let total_weight = tile_plan
        .stage_work_units
        .iter()
        .map(|stage| stage.weight)
        .sum();
    let job = state.computational_merge_jobs.begin(
        crate::merge::computational_job::ComputationalMergeFamily::FocusStack,
        STAGES[0],
        total_units,
        total_weight,
    )?;
    let id = job.job_id.to_string();
    let thread_id = id.clone();
    std::thread::Builder::new()
        .name(format!("focus-candidate-{id}"))
        .spawn(move || {
            let state = app_handle.state::<crate::app_state::AppState>();
            let outcome: Result<_, String> = (|| {
                let root = app_handle
                    .path()
                    .app_cache_dir()
                    .map_err(|e| format!("focus_candidate_cache_failed:{e}"))?
                    .join("focus-candidates");
                std::fs::create_dir_all(&root)
                    .map_err(|e| format!("focus_candidate_cache_failed:{e}"))?;
                super::candidate::prepare(
                    &root,
                    &accepted.identity,
                    &accepted.paths,
                    &tile_plan,
                    &job.job_id,
                    &job.cancellation_token,
                    &state.computational_merge_jobs,
                )
            })();
            let (status, error_code, candidate) = match outcome {
                Ok(output) => {
                    if state
                        .computational_merge_jobs
                        .finish(&job.job_id)
                        .unwrap_or(false)
                    {
                        ("succeeded", None, Some(output.handle))
                    } else {
                        let _ = std::fs::remove_dir_all(output.path);
                        (
                            "cancelled",
                            Some("computational_merge_cancelled".into()),
                            None,
                        )
                    }
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
            if let Some(progress) = state.computational_merge_jobs.progress(&job.job_id) {
                let result = FocusStackCandidateJobResult {
                    job_id: thread_id.clone(),
                    status: status.into(),
                    error_code,
                    candidate,
                    progress,
                };
                state.focus_stack_job_results.insert(thread_id, result);
            }
        })
        .map_err(|e| format!("focus_candidate_job_spawn_failed:{e}"))?;
    Ok(FocusStackCandidateJobHandle {
        job_id: id,
        status: "active",
    })
}

#[tauri::command]
pub fn read_focus_stack_job(
    job_id: String,
    state: tauri::State<'_, crate::app_state::AppState>,
) -> Result<FocusStackCandidateJobResult, String> {
    let id = ComputationalMergeJobId::from_string(job_id.clone());
    if let Some(result) = state.focus_stack_job_results.read(&id) {
        return Ok(result);
    }
    let progress = state
        .computational_merge_jobs
        .progress(&id)
        .ok_or("computational_merge_job_not_found")?;
    Ok(FocusStackCandidateJobResult {
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
    fn frozen_stage_graph_is_complete_and_weighted() {
        let stages = stage_work_units(12, 3);
        assert_eq!(stages.len(), STAGES.len());
        assert_eq!(stages.iter().map(|stage| stage.weight).sum::<u64>(), 100);
        assert_eq!(stages.first().unwrap().stage, "source_validation");
        assert_eq!(stages.last().unwrap().stage, "complete");
        assert_eq!(
            stages[6].units,
            12 * 3 * super::super::tiles::PYRAMID_LEVELS as u64
        );
    }
}
