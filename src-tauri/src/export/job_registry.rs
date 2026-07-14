//! Export-owned lifecycle registry for the single active export operation.
//!
//! The registry is the synchronization boundary for admission, cancellation,
//! task ownership, completion, and observability. Callers never receive its
//! mutex or mutate the active slot directly.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::batch_export_pipeline::PipelineCancellation;

const ACTIVE_EXPORT_ERROR: &str = "An export is already in progress.";
const NO_EXPORT_ERROR: &str = "No export task is currently running.";
const CANCELLATION_PENDING_ERROR: &str = "Export cancellation is already in progress.";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCancellationAck {
    pub(crate) active_job_id: String,
    pub(crate) cancellation_requested: bool,
    pub(crate) task_attached: bool,
    pub(crate) token_observed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportJobSnapshot {
    pub job_id: String,
    pub generation: u64,
    pub cancellation_requested: bool,
    pub task_attached: bool,
}

#[derive(Clone)]
pub(crate) struct ExportJobHandle {
    job_id: String,
    generation: u64,
    cancellation_token: Arc<AtomicBool>,
    cancellation_notify: Arc<Notify>,
}

impl ExportJobHandle {
    pub(crate) fn job_id(&self) -> &str {
        &self.job_id
    }

    pub(crate) fn cancellation(&self) -> PipelineCancellation {
        PipelineCancellation::from_parts(
            Arc::clone(&self.cancellation_token),
            Arc::clone(&self.cancellation_notify),
        )
    }
}

struct ActiveExportJob {
    handle: ExportJobHandle,
    task_handle: Option<JoinHandle<()>>,
}

impl ActiveExportJob {
    fn matches(&self, handle: &ExportJobHandle) -> bool {
        self.handle.generation == handle.generation
            && self.handle.job_id == handle.job_id
            && Arc::ptr_eq(&self.handle.cancellation_token, &handle.cancellation_token)
    }

    fn snapshot(&self) -> ExportJobSnapshot {
        ExportJobSnapshot {
            job_id: self.handle.job_id.clone(),
            generation: self.handle.generation,
            cancellation_requested: self.handle.cancellation_token.load(Ordering::SeqCst),
            task_attached: self.task_handle.is_some(),
        }
    }
}

#[derive(Default)]
struct RegistryState {
    next_generation: u64,
    active: Option<ActiveExportJob>,
}

#[derive(Default)]
pub(crate) struct ExportJobRegistry {
    state: Mutex<RegistryState>,
}

impl ExportJobRegistry {
    pub(crate) fn admit(&self) -> Result<ExportJobHandle, String> {
        let mut state = self.state.lock().unwrap();
        if state.active.is_some() {
            return Err(ACTIVE_EXPORT_ERROR.to_string());
        }
        state.next_generation = state
            .next_generation
            .checked_add(1)
            .expect("export job generation exhausted");
        let handle = ExportJobHandle {
            job_id: format!("export-job:{}", uuid::Uuid::new_v4()),
            generation: state.next_generation,
            cancellation_token: Arc::new(AtomicBool::new(false)),
            cancellation_notify: Arc::new(Notify::new()),
        };
        state.active = Some(ActiveExportJob {
            handle: handle.clone(),
            task_handle: None,
        });
        Ok(handle)
    }

    pub(crate) fn attach_task(&self, handle: &ExportJobHandle, task: JoinHandle<()>) -> bool {
        let mut task = Some(task);
        let attached = {
            let mut state = self.state.lock().unwrap();
            match state.active.as_mut() {
                Some(active) if active.matches(handle) && active.task_handle.is_none() => {
                    active.task_handle = task.take();
                    true
                }
                _ => false,
            }
        };
        if let Some(stale_task) = task {
            stale_task.abort();
        }
        attached
    }

    pub(crate) fn request_cancellation(&self) -> Result<ExportCancellationAck, String> {
        // The guard remains held through the token transition and snapshot so
        // acknowledgement linearizes against completion and next admission.
        let state = self.state.lock().unwrap();
        let Some(active) = state.active.as_ref() else {
            return Err(NO_EXPORT_ERROR.to_string());
        };
        if active
            .handle
            .cancellation_token
            .swap(true, Ordering::SeqCst)
        {
            return Err(CANCELLATION_PENDING_ERROR.to_string());
        }
        active.handle.cancellation_notify.notify_waiters();
        Ok(ExportCancellationAck {
            active_job_id: active.handle.job_id.clone(),
            cancellation_requested: true,
            task_attached: active.task_handle.is_some(),
            token_observed: active.handle.cancellation_token.load(Ordering::SeqCst),
        })
    }

    pub(crate) fn complete(&self, handle: &ExportJobHandle) -> bool {
        let mut state = self.state.lock().unwrap();
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.matches(handle))
        {
            state.active = None;
            true
        } else {
            false
        }
    }

    pub fn snapshot(&self) -> Option<ExportJobSnapshot> {
        self.state
            .lock()
            .unwrap()
            .active
            .as_ref()
            .map(ActiveExportJob::snapshot)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    #[test]
    fn forced_concurrent_admission_has_exactly_one_owner() {
        let registry = Arc::new(ExportJobRegistry::default());
        let barrier = Arc::new(Barrier::new(17));
        let contenders = (0..16)
            .map(|_| {
                let registry = Arc::clone(&registry);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    registry.admit()
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();

        let results = contenders
            .into_iter()
            .map(|contender| contender.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .all(|error| error == ACTIVE_EXPORT_ERROR)
        );
        let owner = results.into_iter().find_map(Result::ok).unwrap();
        assert_eq!(registry.snapshot().unwrap().job_id, owner.job_id());
        assert!(registry.complete(&owner));
    }

    #[test]
    fn stale_completion_cannot_release_a_newer_job() {
        let registry = ExportJobRegistry::default();
        let first = registry.admit().unwrap();
        assert!(registry.complete(&first));
        let second = registry.admit().unwrap();

        assert!(!registry.complete(&first));
        let active = registry.snapshot().unwrap();
        assert_eq!(active.job_id, second.job_id());
        assert_eq!(active.generation, 2);
        assert!(registry.complete(&second));
    }

    #[test]
    fn cancellation_is_atomic_and_visible_in_snapshot() {
        let registry = ExportJobRegistry::default();
        let handle = registry.admit().unwrap();

        let acknowledgement = registry.request_cancellation().unwrap();
        assert_eq!(acknowledgement.active_job_id, handle.job_id());
        assert!(acknowledgement.cancellation_requested);
        assert!(acknowledgement.token_observed);
        assert!(!acknowledgement.task_attached);
        assert!(handle.cancellation().is_cancelled());
        assert!(registry.snapshot().unwrap().cancellation_requested);
        assert_eq!(
            registry.request_cancellation().unwrap_err(),
            CANCELLATION_PENDING_ERROR
        );
        assert!(registry.complete(&handle));
    }

    #[tokio::test]
    async fn stale_task_attachment_is_rejected_and_aborted() {
        let registry = ExportJobRegistry::default();
        let stale = registry.admit().unwrap();
        assert!(registry.complete(&stale));
        let current = registry.admit().unwrap();
        let stale_task = tokio::spawn(std::future::pending());
        let abort_observer = stale_task.abort_handle();

        assert!(!registry.attach_task(&stale, stale_task));
        tokio::task::yield_now().await;
        assert!(abort_observer.is_finished());
        assert_eq!(registry.snapshot().unwrap().job_id, current.job_id());
        assert!(registry.complete(&current));
    }
}
