use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use crate::app_state::{AnalyticsFrameId, AnalyticsJob};

#[derive(Default)]
struct Slots {
    active: bool,
    pending: Option<AnalyticsJob>,
    shutdown: bool,
}

#[derive(Default)]
pub struct AnalyticsSchedulerMetrics {
    pub scheduled: AtomicU64,
    pub superseded: AtomicU64,
    pub completed: AtomicU64,
    pub cancelled: AtomicU64,
    pub max_resident_jobs: AtomicUsize,
}

pub struct AnalyticsScheduler {
    slots: Mutex<Slots>,
    wake: Condvar,
    current: Mutex<Option<AnalyticsFrameId>>,
    pub metrics: AnalyticsSchedulerMetrics,
}

impl AnalyticsScheduler {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            slots: Mutex::new(Slots::default()),
            wake: Condvar::new(),
            current: Mutex::new(None),
            metrics: AnalyticsSchedulerMetrics::default(),
        })
    }

    pub fn submit(&self, job: AnalyticsJob) -> Result<(), AnalyticsJob> {
        let mut slots = self.slots.lock().unwrap();
        if slots.shutdown {
            return Err(job);
        }
        *self.current.lock().unwrap() = Some(job.frame_id);
        self.metrics.scheduled.fetch_add(1, Ordering::Relaxed);
        if slots.pending.replace(job).is_some() {
            self.metrics.superseded.fetch_add(1, Ordering::Relaxed);
        }
        self.metrics
            .max_resident_jobs
            .fetch_max(usize::from(slots.active) + 1, Ordering::Relaxed);
        self.wake.notify_one();
        Ok(())
    }

    pub fn next(&self) -> Option<AnalyticsJob> {
        let mut slots = self.slots.lock().unwrap();
        loop {
            if slots.shutdown {
                return None;
            }
            if let Some(job) = slots.pending.take() {
                slots.active = true;
                return Some(job);
            }
            slots = self.wake.wait(slots).unwrap();
        }
    }

    pub fn is_current(&self, id: AnalyticsFrameId) -> bool {
        *self.current.lock().unwrap() == Some(id) && !self.slots.lock().unwrap().shutdown
    }

    pub fn finish(&self, completed: bool) {
        self.slots.lock().unwrap().active = false;
        if completed {
            self.metrics.completed.fetch_add(1, Ordering::Relaxed);
        } else {
            self.metrics.cancelled.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn shutdown(&self) {
        let mut slots = self.slots.lock().unwrap();
        slots.shutdown = true;
        slots.pending.take();
        self.wake.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::{AnalyticsProducts, AnalyticsSamplingPolicy};
    use image::DynamicImage;

    fn job(generation: u64) -> AnalyticsJob {
        AnalyticsJob {
            path: "fixture".into(),
            frame_id: AnalyticsFrameId {
                image_session: 1,
                preview_generation: generation,
                graph_revision: 1,
            },
            image: Arc::new(DynamicImage::new_rgb8(1, 1)),
            products: AnalyticsProducts::HISTOGRAM,
            active_waveform_channel: None,
            policy: AnalyticsSamplingPolicy::default(),
        }
    }

    #[test]
    fn ten_thousand_submissions_retain_only_newest_pending() {
        let scheduler = AnalyticsScheduler::new();
        scheduler.submit(job(1)).unwrap();
        let active = scheduler.next().unwrap();
        for generation in 2..=10_001 {
            scheduler.submit(job(generation)).unwrap();
        }
        assert!(!scheduler.is_current(active.frame_id));
        assert_eq!(
            scheduler.next().unwrap().frame_id.preview_generation,
            10_001
        );
        assert_eq!(
            scheduler.metrics.max_resident_jobs.load(Ordering::Relaxed),
            2
        );
        assert_eq!(scheduler.metrics.superseded.load(Ordering::Relaxed), 9_999);
    }

    #[test]
    fn newer_frame_cancels_active_identity_and_shutdown_wakes() {
        let scheduler = AnalyticsScheduler::new();
        scheduler.submit(job(1)).unwrap();
        let active = scheduler.next().unwrap();
        scheduler.submit(job(2)).unwrap();
        assert!(!scheduler.is_current(active.frame_id));
        scheduler.shutdown();
        scheduler.finish(false);
        assert!(scheduler.next().is_none());
    }
}
