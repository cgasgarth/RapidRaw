use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use tauri::Emitter;

use crate::app_state::AnalyticsJob;

use super::analytics_scheduler::AnalyticsScheduler;
use super::image_analytics::{self, AnalyticsResult};

pub(crate) struct AnalyticsRuntimeService {
    scheduler: Arc<AnalyticsScheduler>,
    started: AtomicBool,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Default for AnalyticsRuntimeService {
    fn default() -> Self {
        Self {
            scheduler: AnalyticsScheduler::new(),
            started: AtomicBool::new(false),
            worker: Mutex::new(None),
        }
    }
}

impl AnalyticsRuntimeService {
    pub(crate) fn start_worker(&self, app_handle: tauri::AppHandle) -> bool {
        self.start_worker_with_sink(move |result| {
            let _ = app_handle.emit(crate::events::ANALYTICS_RESULT, result);
        })
    }

    fn start_worker_with_sink(&self, sink: impl Fn(AnalyticsResult) + Send + 'static) -> bool {
        if self
            .started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return false;
        }

        let scheduler = Arc::clone(&self.scheduler);
        let worker_scheduler = Arc::clone(&scheduler);
        let worker = std::thread::spawn(move || {
            while let Some(job) = worker_scheduler.next() {
                let id = job.frame_id;
                let result = image_analytics::calculate(&job, || worker_scheduler.is_current(id));
                let current = worker_scheduler.is_current(id);
                if current && let Ok(result) = result {
                    sink(result);
                    worker_scheduler.finish(true);
                } else {
                    worker_scheduler.finish(false);
                }
            }
        });
        *self.worker.lock().expect("analytics worker poisoned") = Some(worker);
        true
    }

    pub(crate) fn submit(&self, job: AnalyticsJob) -> Result<(), AnalyticsJob> {
        self.scheduler.submit(job)
    }

    #[cfg(test)]
    fn shutdown(&self) {
        self.scheduler.shutdown();
        if let Some(worker) = self
            .worker
            .lock()
            .expect("analytics worker poisoned")
            .take()
        {
            let _ = worker.join();
        }
    }
}

impl Drop for AnalyticsRuntimeService {
    fn drop(&mut self) {
        self.scheduler.shutdown();
        if let Ok(worker) = self.worker.get_mut()
            && let Some(worker) = worker.take()
        {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::{AnalyticsFrameId, AnalyticsProducts, AnalyticsSamplingPolicy};
    use image::DynamicImage;
    use std::sync::mpsc;
    use std::time::Duration;

    fn job(generation: u64) -> AnalyticsJob {
        AnalyticsJob {
            path: "/fixtures/analytics.raw".to_string(),
            frame_id: AnalyticsFrameId {
                image_session: 4,
                preview_generation: generation,
                graph_revision: 2,
            },
            image: Arc::new(DynamicImage::new_rgb8(1, 1)),
            products: AnalyticsProducts::HISTOGRAM,
            active_waveform_channel: None,
            policy: AnalyticsSamplingPolicy::default(),
        }
    }

    #[test]
    fn worker_starts_once_emits_current_result_and_stops_submission() {
        let service = AnalyticsRuntimeService::default();
        let (tx, rx) = mpsc::channel();
        assert!(service.start_worker_with_sink(move |result| {
            tx.send(result.frame_id).unwrap();
        }));
        assert!(!service.start_worker_with_sink(|_| {}));

        service.submit(job(7)).unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            AnalyticsFrameId {
                image_session: 4,
                preview_generation: 7,
                graph_revision: 2,
            }
        );

        service.shutdown();
        assert!(service.submit(job(8)).is_err());
    }
}
