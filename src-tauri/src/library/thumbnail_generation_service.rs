use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};

use super::thumbnail_scheduler::{
    FinishOutcome, GenerationProgress, InvalidationOutcome, ThumbnailGeneration, ThumbnailJob,
    ThumbnailScheduler, UpdateThumbnailQueueRequest,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThumbnailOperationAuthority {
    pub generation: ThumbnailGeneration,
    pub operation_id: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct ThumbnailLifecycleEmission {
    pub authority: ThumbnailOperationAuthority,
    pub current: usize,
    pub progress: GenerationProgress,
    pub terminal: bool,
    pub total: usize,
}

pub(crate) struct ThumbnailServiceJob {
    pub authority: ThumbnailOperationAuthority,
    pub job: ThumbnailJob,
}

pub(crate) struct ExplicitThumbnailBatch {
    pub authority: ThumbnailOperationAuthority,
    pub cancellation: Arc<AtomicBool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OperationKind {
    Scheduler,
    Explicit,
}

struct ActiveOperation {
    authority: ThumbnailOperationAuthority,
    cancellation: Arc<AtomicBool>,
    current: usize,
    kind: OperationKind,
    terminal: bool,
    total: usize,
}

#[derive(Default)]
struct ThumbnailLifecycleState {
    active: Option<ActiveOperation>,
    next_operation_id: u64,
}

pub(crate) struct ThumbnailGenerationService {
    lifecycle: Mutex<ThumbnailLifecycleState>,
    scheduler: Arc<ThumbnailScheduler>,
    transitions: Mutex<()>,
}

impl Default for ThumbnailGenerationService {
    fn default() -> Self {
        Self {
            lifecycle: Mutex::new(ThumbnailLifecycleState::default()),
            scheduler: ThumbnailScheduler::new(Default::default()),
            transitions: Mutex::new(()),
        }
    }
}

impl ThumbnailGenerationService {
    pub(crate) fn update(
        &self,
        request: UpdateThumbnailQueueRequest,
    ) -> Result<(ThumbnailOperationAuthority, ThumbnailLifecycleEmission), &'static str> {
        let _transition = self
            .transitions
            .lock()
            .map_err(|_| "thumbnail_lifecycle_unavailable")?;
        let progress = self.scheduler.update(request)?;
        let authority = self.ensure_scheduler_operation(progress.generation)?;
        let emission = self
            .record_scheduler_progress(authority, progress)
            .ok_or("thumbnail_operation_stale")?;
        Ok((authority, emission))
    }

    pub(crate) fn invalidate_if_demanded(
        &self,
        path: &str,
        source_revision: String,
    ) -> Result<(InvalidationOutcome, Option<ThumbnailLifecycleEmission>), &'static str> {
        let _transition = self
            .transitions
            .lock()
            .map_err(|_| "thumbnail_lifecycle_unavailable")?;
        let (outcome, progress) = self
            .scheduler
            .invalidate_if_demanded(path, source_revision)?;
        if outcome != InvalidationOutcome::Scheduled {
            return Ok((outcome, None));
        }
        let authority = self.ensure_scheduler_operation(progress.generation)?;
        Ok((outcome, self.record_scheduler_progress(authority, progress)))
    }

    pub(crate) fn claim(&self) -> Option<ThumbnailServiceJob> {
        loop {
            let job = self.scheduler.claim()?;
            let authority = self
                .lifecycle
                .lock()
                .ok()?
                .active
                .as_ref()
                .filter(|operation| {
                    operation.kind == OperationKind::Scheduler
                        && operation.authority.generation == job.generation
                        && !operation.terminal
                })
                .map(|operation| operation.authority);
            if let Some(authority) = authority {
                return Some(ThumbnailServiceJob { authority, job });
            }
            let _ = self.scheduler.finish(&job, FinishOutcome::Cancelled);
        }
    }

    pub(crate) fn is_publishable(&self, job: &ThumbnailServiceJob) -> bool {
        let Ok(_transition) = self.transitions.lock() else {
            return false;
        };
        self.is_current(job.authority) && self.scheduler.is_publishable(&job.job)
    }

    pub(crate) fn finish(
        &self,
        job: &ThumbnailServiceJob,
        outcome: FinishOutcome,
    ) -> Option<ThumbnailLifecycleEmission> {
        let _transition = self.transitions.lock().ok()?;
        let progress = self.scheduler.finish(&job.job, outcome)?;
        self.record_scheduler_progress(job.authority, progress)
    }

    pub(crate) fn cancel(
        &self,
        authority: ThumbnailOperationAuthority,
    ) -> Option<ThumbnailLifecycleEmission> {
        let _transition = self.transitions.lock().ok()?;
        let kind = {
            let state = self.lifecycle.lock().ok()?;
            let operation = state
                .active
                .as_ref()
                .filter(|operation| operation.authority == authority && !operation.terminal)?;
            operation.kind
        };
        let progress = match kind {
            OperationKind::Scheduler => self.scheduler.cancel_generation(authority.generation)?,
            OperationKind::Explicit => self.scheduler.snapshot(),
        };
        let mut state = self.lifecycle.lock().ok()?;
        let operation = state
            .active
            .as_mut()
            .filter(|operation| operation.authority == authority && !operation.terminal)?;
        operation.cancellation.store(true, Ordering::Release);
        operation.terminal = true;
        Some(ThumbnailLifecycleEmission {
            authority,
            current: operation.current,
            progress,
            terminal: true,
            total: operation.total,
        })
    }

    pub(crate) fn begin_explicit(
        &self,
        total: usize,
    ) -> Result<(ExplicitThumbnailBatch, ThumbnailLifecycleEmission), &'static str> {
        let _transition = self
            .transitions
            .lock()
            .map_err(|_| "thumbnail_lifecycle_unavailable")?;
        if total == 0 {
            return Err("thumbnail_batch_empty");
        }
        let generation = self.scheduler.snapshot().generation;
        let _ = self.scheduler.cancel_generation(generation);
        let mut state = self
            .lifecycle
            .lock()
            .map_err(|_| "thumbnail_lifecycle_unavailable")?;
        if let Some(previous) = state.active.take() {
            previous.cancellation.store(true, Ordering::Release);
        }
        let authority = next_authority(&mut state, generation)?;
        let cancellation = Arc::new(AtomicBool::new(false));
        state.active = Some(ActiveOperation {
            authority,
            cancellation: Arc::clone(&cancellation),
            current: 0,
            kind: OperationKind::Explicit,
            terminal: false,
            total,
        });
        Ok((
            ExplicitThumbnailBatch {
                authority,
                cancellation,
            },
            ThumbnailLifecycleEmission {
                authority,
                current: 0,
                progress: GenerationProgress {
                    generation,
                    requested_unique: total,
                    ..Default::default()
                },
                terminal: false,
                total,
            },
        ))
    }

    pub(crate) fn advance_explicit(
        &self,
        authority: ThumbnailOperationAuthority,
    ) -> Option<ThumbnailLifecycleEmission> {
        let _transition = self.transitions.lock().ok()?;
        let mut state = self.lifecycle.lock().ok()?;
        let operation = state.active.as_mut().filter(|operation| {
            operation.authority == authority
                && operation.kind == OperationKind::Explicit
                && !operation.terminal
        })?;
        operation.current = operation.current.saturating_add(1).min(operation.total);
        operation.terminal = operation.current == operation.total;
        Some(ThumbnailLifecycleEmission {
            authority,
            current: operation.current,
            progress: GenerationProgress {
                generation: authority.generation,
                requested_unique: operation.total,
                completed: operation.current,
                ..Default::default()
            },
            terminal: operation.terminal,
            total: operation.total,
        })
    }

    pub(crate) fn is_current(&self, authority: ThumbnailOperationAuthority) -> bool {
        self.lifecycle
            .lock()
            .ok()
            .and_then(|state| {
                state
                    .active
                    .as_ref()
                    .map(|operation| operation.authority == authority && !operation.terminal)
            })
            .unwrap_or(false)
    }

    fn ensure_scheduler_operation(
        &self,
        generation: ThumbnailGeneration,
    ) -> Result<ThumbnailOperationAuthority, &'static str> {
        let mut state = self
            .lifecycle
            .lock()
            .map_err(|_| "thumbnail_lifecycle_unavailable")?;
        let needs_new = state.active.as_ref().is_none_or(|operation| {
            operation.authority.generation != generation
                || operation.kind != OperationKind::Scheduler
                || operation.terminal
        });
        if needs_new {
            if let Some(previous) = state.active.take() {
                previous.cancellation.store(true, Ordering::Release);
            }
            let authority = next_authority(&mut state, generation)?;
            state.active = Some(ActiveOperation {
                authority,
                cancellation: Arc::new(AtomicBool::new(false)),
                current: 0,
                kind: OperationKind::Scheduler,
                terminal: false,
                total: 0,
            });
        }
        Ok(state.active.as_ref().unwrap().authority)
    }

    fn record_scheduler_progress(
        &self,
        authority: ThumbnailOperationAuthority,
        progress: GenerationProgress,
    ) -> Option<ThumbnailLifecycleEmission> {
        let current = progress.completed
            + progress.cache_hits
            + progress.failed
            + progress.cancelled
            + progress.dropped;
        let mut state = self.lifecycle.lock().ok()?;
        let operation = state.active.as_mut().filter(|operation| {
            operation.authority == authority && operation.kind == OperationKind::Scheduler
        })?;
        if current < operation.current || progress.requested_unique < operation.total {
            return None;
        }
        operation.current = current;
        operation.total = progress.requested_unique;
        operation.terminal =
            progress.requested_unique > 0 && progress.pending == 0 && progress.in_flight == 0;
        Some(ThumbnailLifecycleEmission {
            authority,
            current,
            terminal: operation.terminal,
            total: operation.total,
            progress,
        })
    }
}

fn next_authority(
    state: &mut ThumbnailLifecycleState,
    generation: ThumbnailGeneration,
) -> Result<ThumbnailOperationAuthority, &'static str> {
    state.next_operation_id = state
        .next_operation_id
        .checked_add(1)
        .ok_or("thumbnail_operation_id_exhausted")?;
    Ok(ThumbnailOperationAuthority {
        generation,
        operation_id: state.next_operation_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thumbnail_scheduler::{
        ThumbnailDemandClass, ThumbnailRequestSpec, UpdateThumbnailQueueRequest,
    };
    #[cfg(feature = "tauri-test")]
    use tauri::{Manager, ipc::InvokeBody, webview::InvokeRequest};

    fn request(generation: u64, paths: &[&str]) -> UpdateThumbnailQueueRequest {
        UpdateThumbnailQueueRequest {
            generation: ThumbnailGeneration(generation),
            replace_pending: true,
            requests: paths
                .iter()
                .map(|path| ThumbnailRequestSpec {
                    path: (*path).to_string(),
                    priority: 0,
                    demand_class: ThumbnailDemandClass::Visible,
                    source_revision: None,
                })
                .collect(),
        }
    }

    #[test]
    fn stale_generation_cancel_cannot_touch_successor() {
        let service = ThumbnailGenerationService::default();
        let (first, _) = service.update(request(1, &["a"])).unwrap();
        let first_job = service.claim().unwrap();
        let (second, _) = service.update(request(2, &["b"])).unwrap();

        assert!(service.cancel(first).is_none());
        assert!(first_job.job.cancellation.is_cancelled());
        assert!(service.is_current(second));
        assert!(service.cancel(second).is_some());
    }

    #[test]
    fn concurrent_explicit_successor_rejects_predecessor_cancel_and_progress() {
        let service = Arc::new(ThumbnailGenerationService::default());
        let (first, _) = service.begin_explicit(2).unwrap();
        let first_authority = first.authority;
        let first_cancellation = Arc::clone(&first.cancellation);
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let delayed = {
            let service = Arc::clone(&service);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                (
                    service.cancel(first_authority),
                    service.advance_explicit(first_authority),
                )
            })
        };
        let (second, _) = service.begin_explicit(1).unwrap();
        barrier.wait();
        let (stale_cancel, stale_progress) = delayed.join().unwrap();

        assert!(first_cancellation.load(Ordering::Acquire));
        assert!(stale_cancel.is_none());
        assert!(stale_progress.is_none());
        assert!(!second.cancellation.load(Ordering::Acquire));
        assert!(service.advance_explicit(second.authority).unwrap().terminal);
    }

    #[test]
    fn explicit_progress_is_monotonic_and_terminal_is_last() {
        let service = ThumbnailGenerationService::default();
        let (batch, start) = service.begin_explicit(2).unwrap();
        let first = service.advance_explicit(batch.authority).unwrap();
        let terminal = service.advance_explicit(batch.authority).unwrap();

        assert_eq!((start.current, start.total, start.terminal), (0, 2, false));
        assert_eq!((first.current, first.total, first.terminal), (1, 2, false));
        assert_eq!(
            (terminal.current, terminal.total, terminal.terminal),
            (2, 2, true)
        );
        assert!(service.advance_explicit(batch.authority).is_none());
        assert!(service.cancel(batch.authority).is_none());
    }

    #[test]
    fn completed_scheduler_wave_restarts_with_new_exact_operation() {
        let service = ThumbnailGenerationService::default();
        let (first, _) = service.update(request(4, &["a"])).unwrap();
        let job = service.claim().unwrap();
        let terminal = service
            .finish(&job, FinishOutcome::Completed { cache_hit: false })
            .unwrap();
        assert!(terminal.terminal);

        let (retry, _) = service.update(request(4, &["b"])).unwrap();
        assert_ne!(first.operation_id, retry.operation_id);
        assert!(service.cancel(first).is_none());
        assert!(service.is_current(retry));
    }

    #[test]
    fn retryable_failure_keeps_authority_and_terminal_follows_successful_retry() {
        let service = ThumbnailGenerationService::default();
        let (authority, _) = service.update(request(5, &["retry"])).unwrap();
        let first = service.claim().unwrap();
        let retry_pending = service
            .finish(&first, FinishOutcome::Failed { retryable: true })
            .unwrap();
        assert!(!retry_pending.terminal);
        assert_eq!(retry_pending.progress.pending, 1);
        assert!(service.is_current(authority));

        let retry = service.claim().unwrap();
        assert_eq!(retry.authority, authority);
        let completed = service
            .finish(&retry, FinishOutcome::Completed { cache_hit: false })
            .unwrap();
        assert!(completed.terminal);
        assert_eq!((completed.current, completed.total), (1, 1));
    }

    #[test]
    fn restarted_service_has_clean_generation_state_and_retry_path() {
        let predecessor = ThumbnailGenerationService::default();
        let (old, _) = predecessor.update(request(9, &["old"])).unwrap();
        assert!(predecessor.cancel(old).is_some());
        drop(predecessor);

        let restarted = ThumbnailGenerationService::default();
        let (current, start) = restarted.update(request(1, &["current"])).unwrap();
        assert_eq!(current.generation, ThumbnailGeneration(1));
        assert_eq!((start.current, start.total, start.terminal), (0, 1, false));
        assert!(restarted.is_current(current));
    }

    #[cfg(feature = "tauri-test")]
    #[tauri::command]
    fn cancel_thumbnail_generation_boundary(
        generation: ThumbnailGeneration,
        operation_id: u64,
        state: tauri::State<'_, crate::AppState>,
    ) -> bool {
        state
            .services
            .thumbnails
            .cancel(ThumbnailOperationAuthority {
                generation,
                operation_id,
            })
            .is_some()
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn cancel_ipc_requires_exact_generation_and_operation() {
        let app = tauri::test::mock_builder()
            .manage(crate::AppState::new())
            .invoke_handler(tauri::generate_handler![
                cancel_thumbnail_generation_boundary
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let service = Arc::clone(&app.state::<crate::AppState>().services.thumbnails);
        let (predecessor, _) = service.update(request(1, &["old"])).unwrap();
        let (successor, _) = service.update(request(2, &["current"])).unwrap();

        for (authority, expected_cancelled) in [(predecessor, false), (successor, true)] {
            let response = tauri::test::get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: "cancel_thumbnail_generation_boundary".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: InvokeBody::Json(serde_json::json!({
                        "generation": authority.generation,
                        "operationId": authority.operation_id,
                    })),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .expect("thumbnail cancel IPC response");
            assert_eq!(response.deserialize::<bool>().unwrap(), expected_cancelled);
            if authority == predecessor {
                assert!(service.is_current(successor));
            }
        }
        assert!(!service.is_current(successor));
    }
}
