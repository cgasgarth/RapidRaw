#[cfg(any(feature = "validation-harness", test))]
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use crate::app_state::PreviewJob;
use crate::preview_scheduler::{PreviewRequestId, PreviewScheduler};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PreviewWorkerToken(u64);

#[cfg(any(feature = "validation-harness", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PreviewRuntimeMetricsSnapshot {
    pub interactive_submissions: u64,
    pub settled_submissions: u64,
    pub pending_replacements: u64,
    pub active_cancellations: u64,
    pub rendered_interactive: u64,
    pub rendered_settled: u64,
    pub max_resident_requests: usize,
}

#[derive(Default)]
struct PreviewRuntimeState {
    generation: u64,
    scheduler: Option<Arc<PreviewScheduler>>,
}

#[derive(Default)]
pub(crate) struct PreviewRuntimeService {
    state: Mutex<PreviewRuntimeState>,
}

impl PreviewRuntimeService {
    pub(crate) fn install(&self, scheduler: Arc<PreviewScheduler>) -> PreviewWorkerToken {
        let (token, previous) = {
            let mut state = self.state.lock().expect("preview runtime service poisoned");
            state.generation = state
                .generation
                .checked_add(1)
                .expect("preview worker generation exhausted");
            let token = PreviewWorkerToken(state.generation);
            let previous = state.scheduler.replace(scheduler);
            (token, previous)
        };
        if let Some(previous) = previous {
            previous.shutdown();
        }
        token
    }

    pub(crate) fn submit(&self, job: PreviewJob) -> Result<PreviewRequestId, PreviewJob> {
        let scheduler = self
            .state
            .lock()
            .expect("preview runtime service poisoned")
            .scheduler
            .clone();
        match scheduler {
            Some(scheduler) => scheduler.submit(job),
            None => Err(job),
        }
    }

    pub(crate) fn invalidate_current(&self) -> u64 {
        loop {
            let (generation, scheduler) = {
                let state = self.state.lock().expect("preview runtime service poisoned");
                (state.generation, state.scheduler.clone())
            };
            let Some(scheduler) = scheduler else {
                return 0;
            };
            let render_generation = scheduler.invalidate_current();
            let still_current = self
                .state
                .lock()
                .expect("preview runtime service poisoned")
                .generation
                == generation;
            if still_current {
                return render_generation;
            }
        }
    }

    #[cfg(any(feature = "validation-harness", test))]
    pub(crate) fn metrics_snapshot(&self) -> Option<PreviewRuntimeMetricsSnapshot> {
        let scheduler = self
            .state
            .lock()
            .expect("preview runtime service poisoned")
            .scheduler
            .clone()?;
        Some(PreviewRuntimeMetricsSnapshot {
            interactive_submissions: scheduler
                .metrics
                .interactive_submissions
                .load(Ordering::Acquire),
            settled_submissions: scheduler
                .metrics
                .settled_submissions
                .load(Ordering::Acquire),
            pending_replacements: scheduler
                .metrics
                .pending_replacements
                .load(Ordering::Acquire),
            active_cancellations: scheduler
                .metrics
                .active_cancellations
                .load(Ordering::Acquire),
            rendered_interactive: scheduler
                .metrics
                .rendered_interactive
                .load(Ordering::Acquire),
            rendered_settled: scheduler.metrics.rendered_settled.load(Ordering::Acquire),
            max_resident_requests: scheduler
                .metrics
                .max_resident_requests
                .load(Ordering::Acquire),
        })
    }

    pub(crate) fn uninstall(&self, token: PreviewWorkerToken) {
        let scheduler = {
            let mut state = self.state.lock().expect("preview runtime service poisoned");
            if state.generation != token.0 {
                return;
            }
            state.scheduler.take()
        };
        if let Some(scheduler) = scheduler {
            scheduler.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview_scheduler::{PreviewCompletion, PreviewSchedulingPolicy, PreviewStage};
    use serde_json::json;
    use std::sync::Barrier;
    use std::thread;
    use tokio::sync::oneshot;

    fn job() -> (PreviewJob, oneshot::Receiver<PreviewCompletion>) {
        let (responder, receiver) = oneshot::channel();
        (
            PreviewJob {
                adjustments: Arc::new(json!({})),
                expected_image_path: "preview.raw".into(),
                is_interactive: true,
                target_resolution: None,
                roi: None,
                compute_waveform: false,
                active_waveform_channel: None,
                viewer_sample_graph_revision: None,
                responder,
            },
            receiver,
        )
    }

    #[test]
    fn replacing_worker_stops_old_queue_and_routes_new_submissions() {
        let service = PreviewRuntimeService::default();
        let first = PreviewScheduler::new(PreviewSchedulingPolicy::default());
        service.install(first);
        let (queued, mut old_receiver) = job();
        assert!(service.submit(queued).is_ok());

        let current = PreviewScheduler::new(PreviewSchedulingPolicy::default());
        service.install(Arc::clone(&current));
        assert!(matches!(
            old_receiver.try_recv(),
            Ok(PreviewCompletion::Failed {
                code: "preview_worker_stopped",
                ..
            })
        ));

        let (current_job, _) = job();
        let id = service.submit(current_job).ok().expect("current scheduler");
        assert_eq!(
            service.metrics_snapshot().unwrap().interactive_submissions,
            1
        );
        assert_eq!(current.next().unwrap().id, id);
    }

    #[test]
    fn concurrent_stale_uninstall_cannot_remove_successor_worker() {
        let service = Arc::new(PreviewRuntimeService::default());
        let stale = service.install(PreviewScheduler::new(PreviewSchedulingPolicy::default()));
        let release = Arc::new(Barrier::new(2));
        let worker = {
            let release = Arc::clone(&release);
            let service = Arc::clone(&service);
            thread::spawn(move || {
                release.wait();
                service.uninstall(stale);
            })
        };

        let current = PreviewScheduler::new(PreviewSchedulingPolicy::default());
        let current_token = service.install(Arc::clone(&current));
        release.wait();
        worker.join().unwrap();
        let installed = service.state.lock().unwrap().scheduler.clone().unwrap();
        assert!(Arc::ptr_eq(&installed, &current));

        let (current_job, mut receiver) = job();
        assert!(service.submit(current_job).is_ok());
        service.uninstall(current_token);
        assert!(matches!(
            receiver.try_recv(),
            Ok(PreviewCompletion::Failed {
                code: "preview_worker_stopped",
                ..
            })
        ));
        assert!(service.state.lock().unwrap().scheduler.is_none());
    }

    #[test]
    fn invalidation_delegates_without_holding_service_state() {
        let service = PreviewRuntimeService::default();
        let scheduler = PreviewScheduler::new(PreviewSchedulingPolicy::default());
        service.install(Arc::clone(&scheduler));
        let (queued, mut receiver) = job();
        let id = service.submit(queued).ok().expect("installed scheduler");

        assert_eq!(service.invalidate_current(), id.generation + 1);
        assert!(matches!(
            receiver.try_recv(),
            Ok(PreviewCompletion::Superseded {
                stage: PreviewStage::Queued,
                ..
            })
        ));
    }
}
