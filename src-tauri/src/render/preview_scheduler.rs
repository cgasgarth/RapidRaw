use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::app_state::PreviewJob;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreviewQuality {
    Interactive,
    Settled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PreviewRequestId {
    pub image_session: u64,
    pub generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreviewStage {
    Queued,
    Source,
    Geometry,
    Masks,
    CpuDetail,
    Gpu,
    Readback,
    Encode,
    Publish,
}

#[derive(Debug)]
pub enum PreviewCompletion {
    Rendered {
        bytes: Vec<u8>,
        id: PreviewRequestId,
    },
    Superseded {
        by_generation: u64,
        stage: PreviewStage,
    },
    Cancelled {
        stage: PreviewStage,
    },
    Failed {
        code: &'static str,
        message: String,
    },
}

pub struct PreviewRequest {
    pub id: PreviewRequestId,
    pub quality: PreviewQuality,
    pub job: PreviewJob,
    pub submitted_at: Instant,
}

#[derive(Clone, Copy)]
pub struct PreviewSchedulingPolicy {
    pub settled_quiescence: Duration,
}

impl Default for PreviewSchedulingPolicy {
    fn default() -> Self {
        Self {
            settled_quiescence: Duration::from_millis(75),
        }
    }
}

#[derive(Default)]
struct PendingPreviewSlots {
    interactive: Option<PreviewRequest>,
    settled: Option<PreviewRequest>,
    shutdown: bool,
    active_quality: Option<PreviewQuality>,
    last_interactive_submission: Option<Instant>,
}

#[derive(Default)]
pub struct PreviewSchedulerMetrics {
    pub interactive_submissions: AtomicU64,
    pub settled_submissions: AtomicU64,
    pub pending_replacements: AtomicU64,
    pub active_cancellations: AtomicU64,
    pub rendered_interactive: AtomicU64,
    pub rendered_settled: AtomicU64,
    pub max_resident_requests: AtomicUsize,
}

pub struct PreviewScheduler {
    pending: Mutex<PendingPreviewSlots>,
    wake: Condvar,
    current_generation: AtomicU64,
    current_session: AtomicU64,
    current_path: Mutex<Option<String>>,
    export_interactive_gpu_waiters: Option<Arc<AtomicUsize>>,
    policy: PreviewSchedulingPolicy,
    pub metrics: PreviewSchedulerMetrics,
}

impl PreviewScheduler {
    /// Supersede every queued/in-flight completion without changing the active image identity.
    pub fn invalidate_current(&self) -> u64 {
        let generation = self.current_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let mut slots = self.pending.lock().unwrap();
        supersede_slot(slots.interactive.take(), generation);
        supersede_slot(slots.settled.take(), generation);
        if let Some(waiters) = self.export_interactive_gpu_waiters.as_ref() {
            waiters.store(
                usize::from(slots.active_quality == Some(PreviewQuality::Interactive)),
                Ordering::Release,
            );
        }
        generation
    }

    pub fn new(policy: PreviewSchedulingPolicy) -> Arc<Self> {
        Self::new_with_export_gpu_pressure(policy, None)
    }

    pub fn new_with_export_gpu_pressure(
        policy: PreviewSchedulingPolicy,
        export_interactive_gpu_waiters: Option<Arc<AtomicUsize>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            pending: Mutex::new(PendingPreviewSlots::default()),
            wake: Condvar::new(),
            current_generation: AtomicU64::new(0),
            current_session: AtomicU64::new(0),
            current_path: Mutex::new(None),
            export_interactive_gpu_waiters,
            policy,
            metrics: PreviewSchedulerMetrics::default(),
        })
    }

    pub fn submit(&self, job: PreviewJob) -> Result<PreviewRequestId, PreviewJob> {
        let now = Instant::now();
        let quality = if job.is_interactive {
            PreviewQuality::Interactive
        } else {
            PreviewQuality::Settled
        };
        let mut slots = self.pending.lock().unwrap();
        if slots.shutdown {
            return Err(job);
        }

        let mut path = self.current_path.lock().unwrap();
        let session = if path.as_deref() == Some(job.expected_image_path.as_str()) {
            self.current_session.load(Ordering::Acquire)
        } else {
            *path = Some(job.expected_image_path.clone());
            let session = self.current_session.fetch_add(1, Ordering::AcqRel) + 1;
            self.current_generation.store(0, Ordering::Release);
            supersede_slot(slots.interactive.take(), 0);
            supersede_slot(slots.settled.take(), 0);
            session
        };
        drop(path);
        let generation = self.current_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let id = PreviewRequestId {
            image_session: session,
            generation,
        };
        let request = PreviewRequest {
            id,
            quality,
            job,
            submitted_at: now,
        };
        let displaced = match quality {
            PreviewQuality::Interactive => {
                if let Some(waiters) = self.export_interactive_gpu_waiters.as_ref() {
                    waiters.store(1, Ordering::Release);
                }
                self.metrics
                    .interactive_submissions
                    .fetch_add(1, Ordering::Relaxed);
                slots.last_interactive_submission = Some(now);
                slots.interactive.replace(request)
            }
            PreviewQuality::Settled => {
                self.metrics
                    .settled_submissions
                    .fetch_add(1, Ordering::Relaxed);
                slots.settled.replace(request)
            }
        };
        if displaced.is_some() {
            self.metrics
                .pending_replacements
                .fetch_add(1, Ordering::Relaxed);
        }
        supersede_slot(displaced, generation);
        let resident = usize::from(slots.active_quality.is_some())
            + usize::from(slots.interactive.is_some())
            + usize::from(slots.settled.is_some());
        self.metrics
            .max_resident_requests
            .fetch_max(resident, Ordering::Relaxed);
        self.wake.notify_one();
        Ok(id)
    }

    pub fn next(&self) -> Option<PreviewRequest> {
        let mut slots = self.pending.lock().unwrap();
        loop {
            if slots.shutdown {
                return None;
            }
            if let Some(request) = slots.interactive.take() {
                slots.active_quality = Some(request.quality);
                return Some(request);
            }
            if slots.settled.is_some() {
                let remaining = slots
                    .last_interactive_submission
                    .and_then(|at| self.policy.settled_quiescence.checked_sub(at.elapsed()));
                if let Some(remaining) = remaining {
                    let (next, _) = self.wake.wait_timeout(slots, remaining).unwrap();
                    slots = next;
                    continue;
                }
                if slots.settled.as_ref().is_some_and(|request| {
                    request.id.generation != self.current_generation.load(Ordering::Acquire)
                }) {
                    let stale = slots.settled.take();
                    supersede_slot(stale, self.current_generation.load(Ordering::Acquire));
                    continue;
                }
                let request = slots.settled.take();
                slots.active_quality = request.as_ref().map(|request| request.quality);
                return request;
            }
            slots = self.wake.wait(slots).unwrap();
        }
    }

    pub fn finish(&self, quality: PreviewQuality, rendered: bool) {
        let mut slots = self.pending.lock().unwrap();
        slots.active_quality = None;
        if quality == PreviewQuality::Interactive
            && let Some(waiters) = self.export_interactive_gpu_waiters.as_ref()
        {
            waiters.store(usize::from(slots.interactive.is_some()), Ordering::Release);
        }
        drop(slots);
        if !rendered {
            return;
        }
        match quality {
            PreviewQuality::Interactive => self
                .metrics
                .rendered_interactive
                .fetch_add(1, Ordering::Relaxed),
            PreviewQuality::Settled => self
                .metrics
                .rendered_settled
                .fetch_add(1, Ordering::Relaxed),
        };
    }

    pub fn cancellation(self: &Arc<Self>, id: PreviewRequestId) -> PreviewCancellation {
        PreviewCancellation {
            id,
            scheduler: Arc::clone(self),
        }
    }

    pub fn shutdown(&self) {
        let mut slots = self.pending.lock().unwrap();
        slots.shutdown = true;
        stop_slot(slots.interactive.take());
        stop_slot(slots.settled.take());
        if let Some(waiters) = self.export_interactive_gpu_waiters.as_ref() {
            waiters.store(0, Ordering::Release);
        }
        self.wake.notify_all();
    }

    fn abort_at(&self, id: PreviewRequestId, stage: PreviewStage) -> Result<(), PreviewAbort> {
        let session = self.current_session.load(Ordering::Acquire);
        let generation = self.current_generation.load(Ordering::Acquire);
        if id.image_session != session || id.generation != generation {
            self.metrics
                .active_cancellations
                .fetch_add(1, Ordering::Relaxed);
            Err(PreviewAbort::Superseded {
                by_generation: generation,
                stage,
            })
        } else if self.pending.lock().unwrap().shutdown {
            Err(PreviewAbort::Cancelled { stage })
        } else {
            Ok(())
        }
    }
}

pub struct PreviewCancellation {
    id: PreviewRequestId,
    scheduler: Arc<PreviewScheduler>,
}

impl PreviewCancellation {
    pub fn check(&self, stage: PreviewStage) -> Result<(), PreviewAbort> {
        self.scheduler.abort_at(self.id, stage)
    }
}

#[derive(Debug)]
pub enum PreviewAbort {
    Superseded {
        by_generation: u64,
        stage: PreviewStage,
    },
    Cancelled {
        stage: PreviewStage,
    },
}

fn supersede_slot(request: Option<PreviewRequest>, by_generation: u64) {
    if let Some(request) = request {
        let _ = request.job.responder.send(PreviewCompletion::Superseded {
            by_generation,
            stage: PreviewStage::Queued,
        });
    }
}

fn stop_slot(request: Option<PreviewRequest>) {
    if let Some(request) = request {
        let _ = request.job.responder.send(PreviewCompletion::Failed {
            code: "preview_worker_stopped",
            message: "Preview worker stopped".to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::sync::oneshot;

    fn job(interactive: bool) -> (PreviewJob, oneshot::Receiver<PreviewCompletion>) {
        let (tx, rx) = oneshot::channel();
        (
            PreviewJob {
                adjustments: Arc::new(json!({"large": "payload"})),
                expected_image_path: "a.raw".into(),
                is_interactive: interactive,
                target_resolution: None,
                roi: None,
                compute_waveform: false,
                active_waveform_channel: None,
                viewer_sample_graph_revision: None,
                responder: tx,
            },
            rx,
        )
    }

    #[test]
    fn ten_thousand_submissions_keep_only_latest_pending() {
        let scheduler = PreviewScheduler::new(PreviewSchedulingPolicy::default());
        let mut displaced = Vec::new();
        for _ in 0..10_000 {
            let (job, rx) = job(true);
            assert!(scheduler.submit(job).is_ok());
            displaced.push(rx);
        }
        assert_eq!(
            scheduler
                .metrics
                .max_resident_requests
                .load(Ordering::Relaxed),
            1
        );
        assert_eq!(
            scheduler
                .metrics
                .pending_replacements
                .load(Ordering::Relaxed),
            9_999
        );
        for rx in displaced.iter_mut().take(9_999) {
            assert!(matches!(
                rx.try_recv(),
                Ok(PreviewCompletion::Superseded { .. })
            ));
        }
        assert!(matches!(
            scheduler.next(),
            Some(PreviewRequest {
                id: PreviewRequestId {
                    generation: 10_000,
                    ..
                },
                ..
            })
        ));
    }

    #[test]
    fn interactive_preempts_settled_and_settled_runs_after_quiescence() {
        let scheduler = PreviewScheduler::new(PreviewSchedulingPolicy {
            settled_quiescence: Duration::ZERO,
        });
        assert!(scheduler.submit(job(false).0).is_ok());
        assert!(scheduler.submit(job(true).0).is_ok());
        assert_eq!(
            scheduler.next().unwrap().quality,
            PreviewQuality::Interactive
        );
        scheduler.finish(PreviewQuality::Interactive, true);
        let (settled, _) = job(false);
        assert!(scheduler.submit(settled).is_ok());
        assert_eq!(scheduler.next().unwrap().quality, PreviewQuality::Settled);
    }

    #[test]
    fn interactive_lifecycle_drives_shared_export_gpu_pressure() {
        let pressure = Arc::new(AtomicUsize::new(0));
        let scheduler = PreviewScheduler::new_with_export_gpu_pressure(
            PreviewSchedulingPolicy::default(),
            Some(Arc::clone(&pressure)),
        );
        assert!(scheduler.submit(job(true).0).is_ok());
        assert_eq!(pressure.load(Ordering::Acquire), 1);
        let active = scheduler.next().expect("interactive request");
        assert!(scheduler.submit(job(true).0).is_ok());
        scheduler.finish(active.quality, true);
        assert_eq!(pressure.load(Ordering::Acquire), 1);
        let replacement = scheduler.next().expect("replacement request");
        scheduler.finish(replacement.quality, true);
        assert_eq!(pressure.load(Ordering::Acquire), 0);

        assert!(scheduler.submit(job(false).0).is_ok());
        assert_eq!(pressure.load(Ordering::Acquire), 0);
        scheduler.shutdown();
        assert_eq!(pressure.load(Ordering::Acquire), 0);
    }

    #[test]
    fn resident_count_is_bounded_to_active_plus_two_slots() {
        let scheduler = PreviewScheduler::new(PreviewSchedulingPolicy {
            settled_quiescence: Duration::ZERO,
        });
        assert!(scheduler.submit(job(true).0).is_ok());
        let active = scheduler.next().unwrap();
        assert!(scheduler.submit(job(true).0).is_ok());
        assert!(scheduler.submit(job(false).0).is_ok());
        assert_eq!(
            scheduler
                .metrics
                .max_resident_requests
                .load(Ordering::Relaxed),
            3
        );
        drop(active);
        scheduler.shutdown();
    }

    #[test]
    fn session_change_supersedes_old_pending_and_active_token() {
        let scheduler = PreviewScheduler::new(PreviewSchedulingPolicy::default());
        let (old, mut old_rx) = job(false);
        let old_id = scheduler.submit(old).ok().unwrap();
        let (mut new, _) = job(true);
        new.expected_image_path = "b.raw".into();
        assert!(scheduler.submit(new).is_ok());
        assert!(matches!(
            old_rx.try_recv(),
            Ok(PreviewCompletion::Superseded { .. })
        ));
        assert!(
            scheduler
                .cancellation(old_id)
                .check(PreviewStage::Gpu)
                .is_err()
        );
    }

    #[test]
    fn reset_invalidation_acknowledges_generation_and_supersedes_stale_completion() {
        let scheduler = PreviewScheduler::new(PreviewSchedulingPolicy::default());
        let (pending, mut rx) = job(false);
        let id = scheduler
            .submit(pending)
            .ok()
            .expect("scheduler accepts job");
        let acknowledged_generation = scheduler.invalidate_current();
        assert!(acknowledged_generation > id.generation);
        assert!(matches!(
            rx.try_recv(),
            Ok(PreviewCompletion::Superseded { by_generation, .. })
                if by_generation == acknowledged_generation
        ));
        assert!(
            scheduler
                .cancellation(id)
                .check(PreviewStage::Publish)
                .is_err()
        );
    }

    #[test]
    fn shutdown_completes_pending_and_stops_waiter() {
        let scheduler = PreviewScheduler::new(PreviewSchedulingPolicy::default());
        let (pending, mut rx) = job(true);
        assert!(scheduler.submit(pending).is_ok());
        scheduler.shutdown();
        assert!(matches!(
            rx.try_recv(),
            Ok(PreviewCompletion::Failed {
                code: "preview_worker_stopped",
                ..
            })
        ));
        assert!(scheduler.next().is_none());
    }
}
