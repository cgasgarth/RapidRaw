use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum SmartPreviewDemandClass {
    VisibleIdle,
    ExplicitBuild,
    SelectedImageOfflineSafety,
}

#[derive(Clone)]
pub struct SmartPreviewCancellation(Arc<AtomicBool>);

impl SmartPreviewCancellation {
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    pub fn flag(&self) -> &AtomicBool {
        &self.0
    }

    fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
}

#[derive(Clone)]
pub struct SmartPreviewJob {
    pub path: Arc<str>,
    pub adjustments: Arc<[u8]>,
    pub source_revision: String,
    pub generation: u64,
    pub demand_class: SmartPreviewDemandClass,
    pub cancellation: SmartPreviewCancellation,
}

struct State {
    pending: VecDeque<SmartPreviewJob>,
    in_flight: HashMap<Arc<str>, SmartPreviewJob>,
    current_generation: HashMap<Arc<str>, u64>,
    next_generation: u64,
    completed: u64,
    cancelled: u64,
    failed: u64,
    dropped: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPreviewProgress {
    pub pending: usize,
    pub in_flight: usize,
    pub completed: u64,
    pub cancelled: u64,
    pub failed: u64,
    pub dropped: u64,
}

pub struct SmartPreviewScheduler {
    state: Mutex<State>,
    wake: Condvar,
    max_pending: usize,
}

impl SmartPreviewScheduler {
    pub fn new(max_pending: usize) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                pending: VecDeque::new(),
                in_flight: HashMap::new(),
                current_generation: HashMap::new(),
                next_generation: 0,
                completed: 0,
                cancelled: 0,
                failed: 0,
                dropped: 0,
            }),
            wake: Condvar::new(),
            max_pending: max_pending.max(1),
        })
    }

    pub fn enqueue(
        &self,
        path: String,
        source_revision: String,
        adjustments: Vec<u8>,
        demand_class: SmartPreviewDemandClass,
    ) -> u64 {
        let path: Arc<str> = Arc::from(path);
        let mut state = self.state.lock().unwrap();
        if let Some(existing) = state.in_flight.get(&path)
            && existing.source_revision == source_revision
        {
            return existing.generation;
        }
        if let Some(position) = state.pending.iter().position(|job| job.path == path) {
            let existing = &state.pending[position];
            if existing.source_revision == source_revision {
                let generation = existing.generation;
                if demand_class > existing.demand_class {
                    let mut promoted = state.pending.remove(position).unwrap();
                    promoted.demand_class = demand_class;
                    state.pending.push_back(promoted);
                    self.wake.notify_one();
                }
                return generation;
            }
            state
                .pending
                .remove(position)
                .unwrap()
                .cancellation
                .cancel();
        }
        if let Some(existing) = state.in_flight.get(&path) {
            existing.cancellation.cancel();
        }
        state.next_generation += 1;
        let generation = state.next_generation;
        state.current_generation.insert(path.clone(), generation);
        let job = SmartPreviewJob {
            path,
            adjustments: adjustments.into(),
            source_revision,
            generation,
            demand_class,
            cancellation: SmartPreviewCancellation(Arc::new(AtomicBool::new(false))),
        };
        state.pending.push_back(job);
        while state.pending.len() > self.max_pending {
            if let Some(dropped) = state.pending.pop_back() {
                dropped.cancellation.cancel();
                state.dropped += 1;
            }
        }
        drop(state);
        self.wake.notify_one();
        generation
    }

    pub fn claim(&self) -> SmartPreviewJob {
        let mut state = self.state.lock().unwrap();
        loop {
            let next = state
                .pending
                .iter()
                .enumerate()
                .max_by(|(_, left), (_, right)| {
                    left.demand_class
                        .cmp(&right.demand_class)
                        .then_with(|| right.generation.cmp(&left.generation))
                })
                .map(|(index, _)| index);
            if let Some(index) = next {
                let job = state.pending.remove(index).unwrap();
                if job.cancellation.is_cancelled() {
                    continue;
                }
                state.in_flight.insert(job.path.clone(), job.clone());
                return job;
            }
            state = self.wake.wait(state).unwrap();
        }
    }

    pub fn is_publishable(&self, job: &SmartPreviewJob) -> bool {
        !job.cancellation.is_cancelled()
            && self
                .state
                .lock()
                .unwrap()
                .current_generation
                .get(&job.path)
                .is_some_and(|generation| *generation == job.generation)
    }

    pub fn finish(&self, job: &SmartPreviewJob, succeeded: bool) -> SmartPreviewProgress {
        let mut state = self.state.lock().unwrap();
        state.in_flight.remove(&job.path);
        if job.cancellation.is_cancelled() {
            state.cancelled += 1;
        } else if succeeded {
            state.completed += 1;
        } else {
            state.failed += 1;
        }
        Self::build_progress(&state)
    }

    pub fn progress(&self) -> SmartPreviewProgress {
        Self::build_progress(&self.state.lock().unwrap())
    }

    fn build_progress(state: &State) -> SmartPreviewProgress {
        SmartPreviewProgress {
            pending: state.pending.len(),
            in_flight: state.in_flight.len(),
            completed: state.completed,
            cancelled: state.cancelled,
            failed: state.failed,
            dropped: state.dropped,
        }
    }

    #[cfg(test)]
    fn pending_len(&self) -> usize {
        self.state.lock().unwrap().pending.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::thumbnail_scheduler::{
        ThumbnailDemandClass, ThumbnailGeneration, ThumbnailRequestSpec, ThumbnailScheduler,
        UpdateThumbnailQueueRequest,
    };
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn duplicate_demand_single_flights_and_promotes() {
        let scheduler = SmartPreviewScheduler::new(4);
        let first = scheduler.enqueue(
            "a.raw".into(),
            "r1".into(),
            vec![],
            SmartPreviewDemandClass::VisibleIdle,
        );
        let promoted = scheduler.enqueue(
            "a.raw".into(),
            "r1".into(),
            vec![],
            SmartPreviewDemandClass::ExplicitBuild,
        );
        assert_eq!(first, promoted);
        assert_eq!(scheduler.pending_len(), 1);
        assert_eq!(
            scheduler.claim().demand_class,
            SmartPreviewDemandClass::ExplicitBuild
        );
    }

    #[test]
    fn revision_change_cancels_old_publication_and_queue_is_bounded() {
        let scheduler = SmartPreviewScheduler::new(2);
        let old = scheduler.enqueue(
            "a.raw".into(),
            "r1".into(),
            vec![],
            SmartPreviewDemandClass::ExplicitBuild,
        );
        let old_job = scheduler.claim();
        assert_eq!(old, old_job.generation);
        scheduler.enqueue(
            "a.raw".into(),
            "r2".into(),
            vec![],
            SmartPreviewDemandClass::ExplicitBuild,
        );
        scheduler.enqueue(
            "b.raw".into(),
            "r1".into(),
            vec![],
            SmartPreviewDemandClass::VisibleIdle,
        );
        scheduler.enqueue(
            "c.raw".into(),
            "r1".into(),
            vec![],
            SmartPreviewDemandClass::VisibleIdle,
        );
        assert!(!scheduler.is_publishable(&old_job));
        assert_eq!(scheduler.pending_len(), 2);
    }

    #[test]
    fn thousand_item_idle_submission_stays_bounded_and_non_blocking() {
        let scheduler = SmartPreviewScheduler::new(64);
        let started = Instant::now();
        for index in 0..1_000 {
            scheduler.enqueue(
                format!("/roll/image-{index:04}.raw"),
                format!("revision-{index}"),
                vec![],
                SmartPreviewDemandClass::VisibleIdle,
            );
        }
        assert_eq!(scheduler.pending_len(), 64);
        assert_eq!(scheduler.progress().dropped, 936);
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn blocked_smart_preview_lane_cannot_hold_visible_thumbnail_claim() {
        let smart = SmartPreviewScheduler::new(4);
        smart.enqueue(
            "/roll/a.raw".into(),
            "r1".into(),
            vec![],
            SmartPreviewDemandClass::ExplicitBuild,
        );
        let (claimed_tx, claimed_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let smart_worker = smart;
        let worker = std::thread::spawn(move || {
            let job = smart_worker.claim();
            claimed_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            smart_worker.finish(&job, true);
        });
        claimed_rx.recv_timeout(Duration::from_secs(1)).unwrap();

        let thumbnails = ThumbnailScheduler::new(Default::default());
        thumbnails
            .update(UpdateThumbnailQueueRequest {
                generation: ThumbnailGeneration(1),
                replace_pending: true,
                requests: vec![ThumbnailRequestSpec {
                    path: "/roll/visible.raw".into(),
                    priority: 0,
                    demand_class: ThumbnailDemandClass::Visible,
                    source_revision: Some("r1".into()),
                }],
            })
            .unwrap();
        let started = Instant::now();
        let visible = thumbnails.claim().expect("visible thumbnail claim");
        assert_eq!(&*visible.path, "/roll/visible.raw");
        assert!(started.elapsed() < Duration::from_millis(10));

        release_tx.send(()).unwrap();
        worker.join().unwrap();
    }
}
