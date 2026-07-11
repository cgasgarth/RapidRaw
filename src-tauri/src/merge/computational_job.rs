use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub const COMPUTATIONAL_MERGE_PROGRESS_EVENT: &str = "computational-merge-progress";
const DEFAULT_TERMINAL_CAPACITY: usize = 128;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputationalMergeFamily {
    FocusStack,
    Hdr,
    SuperResolution,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ComputationalMergeJobId(String);

impl ComputationalMergeJobId {
    pub fn from_string(value: String) -> Self {
        Self(value)
    }
}

impl std::fmt::Display for ComputationalMergeJobId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputationalMergeProgress {
    pub schema_version: u32,
    pub job_id: ComputationalMergeJobId,
    pub family: ComputationalMergeFamily,
    pub stage: String,
    pub completed_units: u64,
    pub total_units: u64,
    pub completed_weight: u64,
    pub total_weight: u64,
    pub fraction: f32,
    pub status: ComputationalMergeJobStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputationalMergeJobStatus {
    Active,
    CancelRequested,
    Cancelled,
    Failed,
    Succeeded,
}

#[derive(Clone, Debug)]
pub struct ComputationalMergeCancellationToken(pub(crate) Arc<AtomicBool>);

impl ComputationalMergeCancellationToken {
    pub fn checkpoint(&self) -> Result<(), String> {
        if self.0.load(Ordering::Acquire) {
            Err("computational_merge_cancelled".to_string())
        } else {
            Ok(())
        }
    }

    pub fn atomic_flag(&self) -> &Arc<AtomicBool> {
        &self.0
    }
}

#[derive(Clone)]
pub struct ComputationalMergeJobHandle {
    pub job_id: ComputationalMergeJobId,
    pub cancellation_token: ComputationalMergeCancellationToken,
}

struct JobEntry {
    family: ComputationalMergeFamily,
    token: Arc<AtomicBool>,
    progress: ComputationalMergeProgress,
}

struct RegistryState {
    jobs: HashMap<ComputationalMergeJobId, JobEntry>,
    terminal_order: VecDeque<ComputationalMergeJobId>,
}

pub struct ComputationalMergeJobRegistry {
    state: Mutex<RegistryState>,
    terminal_capacity: usize,
}

impl Default for ComputationalMergeJobRegistry {
    fn default() -> Self {
        Self::with_terminal_capacity(DEFAULT_TERMINAL_CAPACITY)
    }
}

impl ComputationalMergeJobRegistry {
    pub fn with_terminal_capacity(terminal_capacity: usize) -> Self {
        Self {
            state: Mutex::new(RegistryState {
                jobs: HashMap::new(),
                terminal_order: VecDeque::new(),
            }),
            terminal_capacity,
        }
    }

    pub fn begin(
        &self,
        family: ComputationalMergeFamily,
        stage: impl Into<String>,
        total_units: u64,
        total_weight: u64,
    ) -> Result<ComputationalMergeJobHandle, String> {
        if total_units == 0 || total_weight == 0 {
            return Err("computational_merge_invalid_work_plan".to_string());
        }
        let job_id = ComputationalMergeJobId(Uuid::new_v4().to_string());
        let token = Arc::new(AtomicBool::new(false));
        let progress = ComputationalMergeProgress {
            schema_version: 1,
            job_id: job_id.clone(),
            family,
            stage: stage.into(),
            completed_units: 0,
            total_units,
            completed_weight: 0,
            total_weight,
            fraction: 0.0,
            status: ComputationalMergeJobStatus::Active,
        };
        self.state
            .lock()
            .map_err(|_| "computational_merge_job_registry_unavailable".to_string())?
            .jobs
            .insert(
                job_id.clone(),
                JobEntry {
                    family,
                    token: Arc::clone(&token),
                    progress,
                },
            );
        Ok(ComputationalMergeJobHandle {
            job_id,
            cancellation_token: ComputationalMergeCancellationToken(token),
        })
    }

    pub fn cancel(&self, job_id: &ComputationalMergeJobId) -> Result<bool, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "computational_merge_job_registry_unavailable".to_string())?;
        let entry = state
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| "computational_merge_job_not_found".to_string())?;
        if entry.progress.status == ComputationalMergeJobStatus::Active {
            entry.token.store(true, Ordering::Release);
            entry.progress.status = ComputationalMergeJobStatus::CancelRequested;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn cancel_active_family(&self, family: ComputationalMergeFamily) -> Result<bool, String> {
        let job_id = {
            let state = self
                .state
                .lock()
                .map_err(|_| "computational_merge_job_registry_unavailable".to_string())?;
            let mut active = state.jobs.iter().filter(|(_, entry)| {
                entry.family == family
                    && matches!(
                        entry.progress.status,
                        ComputationalMergeJobStatus::Active
                            | ComputationalMergeJobStatus::CancelRequested
                    )
            });
            let first = active.next().map(|(id, _)| id.clone());
            if active.next().is_some() {
                return Err("computational_merge_family_has_multiple_active_jobs".to_string());
            }
            first.ok_or_else(|| "computational_merge_job_not_found".to_string())?
        };
        self.cancel(&job_id)
    }

    pub fn publish_progress(
        &self,
        job_id: &ComputationalMergeJobId,
        stage: impl Into<String>,
        completed_units: u64,
        total_units: u64,
        completed_weight: u64,
        app: Option<&AppHandle>,
    ) -> Result<ComputationalMergeProgress, String> {
        let stage = stage.into();
        let progress = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "computational_merge_job_registry_unavailable".to_string())?;
            let entry = state
                .jobs
                .get_mut(job_id)
                .ok_or_else(|| "computational_merge_job_not_found".to_string())?;
            if entry.progress.status != ComputationalMergeJobStatus::Active {
                return Err("computational_merge_job_not_active".to_string());
            }
            if total_units == 0
                || total_units != entry.progress.total_units
                || completed_weight < entry.progress.completed_weight
                || completed_weight > entry.progress.total_weight
                || completed_units > total_units
                || (stage == entry.progress.stage
                    && completed_units < entry.progress.completed_units)
            {
                return Err("computational_merge_progress_not_monotonic".to_string());
            }
            entry.progress.stage = stage;
            entry.progress.completed_units = completed_units;
            entry.progress.total_units = total_units;
            entry.progress.completed_weight = completed_weight;
            entry.progress.fraction = completed_weight as f32 / entry.progress.total_weight as f32;
            entry.progress.clone()
        };
        if let Some(app) = app {
            app.emit(COMPUTATIONAL_MERGE_PROGRESS_EVENT, &progress)
                .map_err(|error| format!("computational_merge_progress_emit_failed:{error}"))?;
        }
        Ok(progress)
    }

    pub fn finish(&self, job_id: &ComputationalMergeJobId) -> Result<bool, String> {
        self.terminal(job_id, ComputationalMergeJobStatus::Succeeded)
    }

    pub fn fail(&self, job_id: &ComputationalMergeJobId) -> Result<bool, String> {
        self.terminal(job_id, ComputationalMergeJobStatus::Failed)
    }

    fn terminal(
        &self,
        job_id: &ComputationalMergeJobId,
        requested: ComputationalMergeJobStatus,
    ) -> Result<bool, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "computational_merge_job_registry_unavailable".to_string())?;
        let entry = state
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| "computational_merge_job_not_found".to_string())?;
        if matches!(
            entry.progress.status,
            ComputationalMergeJobStatus::Succeeded
                | ComputationalMergeJobStatus::Failed
                | ComputationalMergeJobStatus::Cancelled
        ) {
            return Ok(false);
        }
        entry.progress.status = if entry.token.load(Ordering::Acquire) {
            ComputationalMergeJobStatus::Cancelled
        } else {
            requested
        };
        state.terminal_order.push_back(job_id.clone());
        while state.terminal_order.len() > self.terminal_capacity {
            if let Some(evicted) = state.terminal_order.pop_front() {
                state.jobs.remove(&evicted);
            }
        }
        Ok(entry_status(&state.jobs, job_id) == Some(requested))
    }

    pub fn progress(&self, job_id: &ComputationalMergeJobId) -> Option<ComputationalMergeProgress> {
        self.state
            .lock()
            .ok()?
            .jobs
            .get(job_id)
            .map(|entry| entry.progress.clone())
    }
}

fn entry_status(
    state: &HashMap<ComputationalMergeJobId, JobEntry>,
    job_id: &ComputationalMergeJobId,
) -> Option<ComputationalMergeJobStatus> {
    state.get(job_id).map(|entry| entry.progress.status)
}

#[tauri::command]
pub fn cancel_computational_merge_job(
    job_id: String,
    state: tauri::State<'_, crate::app_state::AppState>,
) -> Result<bool, String> {
    state
        .computational_merge_jobs
        .cancel(&ComputationalMergeJobId(job_id))
}

#[cfg(test)]
mod computational_job_tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn cancellation_is_idempotent_and_blocks_success() {
        let registry = ComputationalMergeJobRegistry::default();
        let job = registry
            .begin(ComputationalMergeFamily::FocusStack, "tiles", 2, 2)
            .unwrap();
        assert!(registry.cancel(&job.job_id).unwrap());
        assert!(!registry.cancel(&job.job_id).unwrap());
        assert!(job.cancellation_token.checkpoint().is_err());
        assert!(!registry.finish(&job.job_id).unwrap());
        assert_eq!(
            registry.progress(&job.job_id).unwrap().status,
            ComputationalMergeJobStatus::Cancelled
        );
    }

    #[test]
    fn finish_cancel_race_has_one_terminal_state() {
        let registry = Arc::new(ComputationalMergeJobRegistry::default());
        let job = registry
            .begin(ComputationalMergeFamily::FocusStack, "tiles", 1, 1)
            .unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let cancel = {
            let r = Arc::clone(&registry);
            let b = Arc::clone(&barrier);
            let id = job.job_id.clone();
            thread::spawn(move || {
                b.wait();
                r.cancel(&id).unwrap()
            })
        };
        let finish = {
            let r = Arc::clone(&registry);
            let b = Arc::clone(&barrier);
            let id = job.job_id.clone();
            thread::spawn(move || {
                b.wait();
                r.finish(&id).unwrap()
            })
        };
        barrier.wait();
        let _ = cancel.join().unwrap();
        let _ = finish.join().unwrap();
        assert!(matches!(
            registry.progress(&job.job_id).unwrap().status,
            ComputationalMergeJobStatus::Succeeded | ComputationalMergeJobStatus::Cancelled
        ));
    }

    #[test]
    fn terminal_retention_is_bounded_and_families_are_isolated() {
        let registry = ComputationalMergeJobRegistry::with_terminal_capacity(1);
        let focus = registry
            .begin(ComputationalMergeFamily::FocusStack, "x", 1, 1)
            .unwrap();
        let sr = registry
            .begin(ComputationalMergeFamily::SuperResolution, "x", 1, 1)
            .unwrap();
        registry.cancel(&focus.job_id).unwrap();
        registry.finish(&focus.job_id).unwrap();
        assert!(sr.cancellation_token.checkpoint().is_ok());
        registry.finish(&sr.job_id).unwrap();
        assert!(registry.progress(&focus.job_id).is_none());
    }

    #[test]
    fn simultaneous_cancellation_is_idempotent() {
        let registry = Arc::new(ComputationalMergeJobRegistry::default());
        let job = registry
            .begin(
                ComputationalMergeFamily::SuperResolution,
                "registration",
                1,
                1,
            )
            .unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let registry = Arc::clone(&registry);
                let barrier = Arc::clone(&barrier);
                let job_id = job.job_id.clone();
                thread::spawn(move || {
                    barrier.wait();
                    registry.cancel(&job_id).unwrap()
                })
            })
            .collect();
        barrier.wait();
        let requested = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .filter(|requested| *requested)
            .count();
        assert_eq!(requested, 1);
        assert!(job.cancellation_token.checkpoint().is_err());
    }
}
