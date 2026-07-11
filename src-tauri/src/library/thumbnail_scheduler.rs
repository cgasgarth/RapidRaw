use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(
    Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
)]
pub struct ThumbnailGeneration(pub u64);

#[derive(Clone, Copy, Debug, Default, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThumbnailDemandClass {
    Visible,
    Overscan,
    Lookahead,
    #[default]
    Background,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailRequestSpec {
    pub path: String,
    pub priority: i32,
    pub demand_class: ThumbnailDemandClass,
    pub source_revision: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThumbnailQueueRequest {
    pub generation: ThumbnailGeneration,
    pub replace_pending: bool,
    pub requests: Vec<ThumbnailRequestSpec>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationProgress {
    pub generation: ThumbnailGeneration,
    pub requested_unique: usize,
    pub pending: usize,
    pub in_flight: usize,
    pub completed: usize,
    pub cache_hits: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub dropped: usize,
}

#[derive(Clone, Debug)]
pub struct ThumbnailSchedulerPolicy {
    pub max_pending: usize,
    pub max_attempts: u8,
    pub retry_base: Duration,
}

impl Default for ThumbnailSchedulerPolicy {
    fn default() -> Self {
        Self {
            max_pending: 2_000,
            max_attempts: 3,
            retry_base: Duration::from_millis(75),
        }
    }
}

#[derive(Clone)]
pub struct ThumbnailCancellation(Arc<AtomicBool>);

impl ThumbnailCancellation {
    pub fn is_cancelled(&self) -> bool {
        self.0.load(AtomicOrdering::Acquire)
    }
    fn cancel(&self) {
        self.0.store(true, AtomicOrdering::Release);
    }
    pub fn flag(&self) -> &AtomicBool {
        &self.0
    }
}

#[derive(Clone)]
pub struct ThumbnailJob {
    pub path: Arc<str>,
    pub generation: ThumbnailGeneration,
    pub priority: i32,
    pub sequence: u64,
    pub revision: u64,
    pub source_revision: Option<String>,
    pub attempts: u8,
    pub cancellation: ThumbnailCancellation,
}

#[derive(Clone)]
struct PendingThumbnail {
    priority: i32,
    demand_class: ThumbnailDemandClass,
    sequence: u64,
    revision: u64,
    source_revision: Option<String>,
    attempts: u8,
    not_before: Instant,
}

#[derive(Clone, Eq, PartialEq)]
struct HeapEntry {
    path: Arc<str>,
    priority: i32,
    demand_class: ThumbnailDemandClass,
    sequence: u64,
    revision: u64,
}

// BinaryHeap pops greatest first. Lower numeric priority and demand enum win.
impl Ord for HeapEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .priority
            .cmp(&self.priority)
            .then_with(|| other.demand_class.cmp(&self.demand_class))
            .then_with(|| self.revision.cmp(&other.revision))
            .then_with(|| other.sequence.cmp(&self.sequence))
            .then_with(|| other.path.cmp(&self.path))
    }
}
impl PartialOrd for HeapEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

struct InFlightThumbnail {
    job: ThumbnailJob,
    demand_class: ThumbnailDemandClass,
}

struct ThumbnailSchedulerState {
    active_generation: ThumbnailGeneration,
    pending_by_path: HashMap<Arc<str>, PendingThumbnail>,
    heap: BinaryHeap<HeapEntry>,
    in_flight: HashMap<Arc<str>, InFlightThumbnail>,
    progress: GenerationProgress,
    next_sequence: u64,
    next_revision: u64,
    shutdown: bool,
}

pub enum FinishOutcome {
    Completed { cache_hit: bool },
    Failed { retryable: bool },
    Cancelled,
}

pub struct ThumbnailScheduler {
    state: Mutex<ThumbnailSchedulerState>,
    wake: Condvar,
    policy: ThumbnailSchedulerPolicy,
}

impl ThumbnailScheduler {
    pub fn new(policy: ThumbnailSchedulerPolicy) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(ThumbnailSchedulerState {
                active_generation: ThumbnailGeneration::default(),
                pending_by_path: HashMap::new(),
                heap: BinaryHeap::new(),
                in_flight: HashMap::new(),
                progress: GenerationProgress::default(),
                next_sequence: 0,
                next_revision: 0,
                shutdown: false,
            }),
            wake: Condvar::new(),
            policy,
        })
    }

    pub fn update(
        &self,
        request: UpdateThumbnailQueueRequest,
    ) -> Result<GenerationProgress, &'static str> {
        let mut state = self.state.lock().unwrap();
        if request.generation < state.active_generation {
            return Err("thumbnail_generation_stale");
        }
        if request.generation > state.active_generation {
            for item in state.in_flight.values() {
                item.job.cancellation.cancel();
            }
            state.pending_by_path.clear();
            state.heap.clear();
            state.active_generation = request.generation;
            state.progress = GenerationProgress {
                generation: request.generation,
                ..Default::default()
            };
        } else if request.replace_pending {
            // A viewport reprioritization replaces work not yet claimed while
            // allowing already-running jobs from this generation to finish.
            state.pending_by_path.clear();
            state.heap.clear();
        }
        for spec in request.requests {
            let path: Arc<str> = Arc::from(spec.path.trim());
            if path.is_empty() {
                continue;
            }
            if let Some(item) = state.in_flight.get_mut(&path) {
                if item.job.generation == request.generation
                    && item.job.source_revision == spec.source_revision
                {
                    item.demand_class = item.demand_class.min(spec.demand_class);
                    item.job.priority = item.job.priority.min(spec.priority);
                    continue;
                }
                item.job.cancellation.cancel();
            }
            let is_new = !state.pending_by_path.contains_key(&path);
            state.next_revision += 1;
            let revision = state.next_revision;
            let sequence = if let Some(old) = state.pending_by_path.get(&path) {
                old.sequence
            } else {
                state.next_sequence += 1;
                state.next_sequence
            };
            let pending = PendingThumbnail {
                priority: spec.priority,
                demand_class: spec.demand_class,
                sequence,
                revision,
                source_revision: spec.source_revision,
                attempts: 0,
                not_before: Instant::now(),
            };
            state.pending_by_path.insert(path.clone(), pending.clone());
            state.heap.push(Self::entry(path, &pending));
            if is_new {
                state.progress.requested_unique += 1;
            }
        }
        self.enforce_bound(&mut state);
        Self::recount(&mut state);
        let progress = state.progress.clone();
        drop(state);
        self.wake.notify_all();
        Ok(progress)
    }

    fn entry(path: Arc<str>, pending: &PendingThumbnail) -> HeapEntry {
        HeapEntry {
            path,
            priority: pending.priority,
            demand_class: pending.demand_class,
            sequence: pending.sequence,
            revision: pending.revision,
        }
    }

    fn enforce_bound(&self, state: &mut ThumbnailSchedulerState) {
        while state.pending_by_path.len() > self.policy.max_pending {
            let worst = state
                .pending_by_path
                .iter()
                .max_by(|a, b| {
                    a.1.demand_class
                        .cmp(&b.1.demand_class)
                        .then(a.1.priority.cmp(&b.1.priority))
                        .then(a.1.sequence.cmp(&b.1.sequence))
                })
                .map(|(path, _)| path.clone());
            if let Some(path) = worst {
                state.pending_by_path.remove(&path);
                state.progress.dropped += 1;
            } else {
                break;
            }
        }
        if state.heap.len() > state.pending_by_path.len().saturating_mul(3).max(64) {
            state.heap = state
                .pending_by_path
                .iter()
                .map(|(p, v)| Self::entry(p.clone(), v))
                .collect();
        }
    }

    pub fn claim(&self) -> Option<ThumbnailJob> {
        let mut state = self.state.lock().unwrap();
        loop {
            let mut delayed = Vec::new();
            let mut earliest_ready = None;
            while let Some(entry) = state.heap.pop() {
                let Some(pending) = state.pending_by_path.get(&entry.path) else {
                    continue;
                };
                if pending.revision != entry.revision {
                    continue;
                }
                let now = Instant::now();
                if pending.not_before > now {
                    earliest_ready =
                        Some(earliest_ready.map_or(pending.not_before, |ready: Instant| {
                            ready.min(pending.not_before)
                        }));
                    delayed.push(entry);
                    continue;
                }
                state.heap.extend(delayed);
                let pending = state.pending_by_path.remove(&entry.path).unwrap();
                let job = ThumbnailJob {
                    path: entry.path.clone(),
                    generation: state.active_generation,
                    priority: pending.priority,
                    sequence: pending.sequence,
                    revision: pending.revision,
                    source_revision: pending.source_revision,
                    attempts: pending.attempts,
                    cancellation: ThumbnailCancellation(Arc::new(AtomicBool::new(false))),
                };
                state.in_flight.insert(
                    entry.path,
                    InFlightThumbnail {
                        job: job.clone(),
                        demand_class: pending.demand_class,
                    },
                );
                Self::recount(&mut state);
                return Some(job);
            }
            if state.shutdown {
                return None;
            }
            state.heap.extend(delayed);
            if let Some(ready) = earliest_ready {
                let wait = ready.saturating_duration_since(Instant::now());
                let (next, _) = self.wake.wait_timeout(state, wait).unwrap();
                state = next;
            } else if state.heap.is_empty() {
                state = self.wake.wait(state).unwrap();
            }
        }
    }

    pub fn finish(&self, job: &ThumbnailJob, outcome: FinishOutcome) -> Option<GenerationProgress> {
        let mut state = self.state.lock().unwrap();
        let matches = state
            .in_flight
            .get(&job.path)
            .is_some_and(|item| item.job.revision == job.revision);
        if !matches {
            return None;
        }
        let item = state.in_flight.remove(&job.path).unwrap();
        if job.generation != state.active_generation || job.cancellation.is_cancelled() {
            if job.generation == state.active_generation {
                state.progress.cancelled += 1;
            }
        } else {
            match outcome {
                FinishOutcome::Completed { cache_hit } => {
                    if cache_hit {
                        state.progress.cache_hits += 1;
                    } else {
                        state.progress.completed += 1;
                    }
                }
                FinishOutcome::Cancelled => state.progress.cancelled += 1,
                FinishOutcome::Failed { retryable }
                    if retryable && job.attempts + 1 < self.policy.max_attempts =>
                {
                    state.next_revision += 1;
                    let pending = PendingThumbnail {
                        priority: job.priority,
                        demand_class: item.demand_class,
                        sequence: job.sequence,
                        revision: state.next_revision,
                        source_revision: job.source_revision.clone(),
                        attempts: job.attempts + 1,
                        not_before: Instant::now()
                            + self.policy.retry_base * 2u32.pow(job.attempts as u32),
                    };
                    state
                        .pending_by_path
                        .insert(job.path.clone(), pending.clone());
                    state.heap.push(Self::entry(job.path.clone(), &pending));
                }
                FinishOutcome::Failed { .. } => state.progress.failed += 1,
            }
        }
        Self::recount(&mut state);
        let result = state.progress.clone();
        drop(state);
        self.wake.notify_all();
        Some(result)
    }

    pub fn is_publishable(&self, job: &ThumbnailJob) -> bool {
        let state = self.state.lock().unwrap();
        state.active_generation == job.generation
            && !job.cancellation.is_cancelled()
            && state
                .in_flight
                .get(&job.path)
                .is_some_and(|item| item.job.revision == job.revision)
    }
    pub fn snapshot(&self) -> GenerationProgress {
        self.state.lock().unwrap().progress.clone()
    }
    pub fn shutdown(&self) {
        self.state.lock().unwrap().shutdown = true;
        self.wake.notify_all();
    }
    fn recount(state: &mut ThumbnailSchedulerState) {
        state.progress.pending = state.pending_by_path.len();
        state.progress.in_flight = state
            .in_flight
            .values()
            .filter(|x| x.job.generation == state.active_generation)
            .count();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn spec(path: &str, priority: i32, demand_class: ThumbnailDemandClass) -> ThumbnailRequestSpec {
        ThumbnailRequestSpec {
            path: path.into(),
            priority,
            demand_class,
            source_revision: None,
        }
    }
    fn update(generation: u64, requests: Vec<ThumbnailRequestSpec>) -> UpdateThumbnailQueueRequest {
        UpdateThumbnailQueueRequest {
            generation: ThumbnailGeneration(generation),
            replace_pending: true,
            requests,
        }
    }
    #[test]
    fn priority_and_demand_are_deterministic() {
        let scheduler = ThumbnailScheduler::new(Default::default());
        scheduler
            .update(update(
                1,
                vec![
                    spec("background", 0, ThumbnailDemandClass::Background),
                    spec("visible", 0, ThumbnailDemandClass::Visible),
                    spec("nearest", -1, ThumbnailDemandClass::Background),
                ],
            ))
            .unwrap();
        assert_eq!(&*scheduler.claim().unwrap().path, "nearest");
        assert_eq!(&*scheduler.claim().unwrap().path, "visible");
    }
    #[test]
    fn upsert_reprioritizes_without_duplicate() {
        let scheduler = ThumbnailScheduler::new(Default::default());
        scheduler
            .update(update(
                1,
                vec![
                    spec("a", 10, ThumbnailDemandClass::Background),
                    spec("b", 5, ThumbnailDemandClass::Visible),
                ],
            ))
            .unwrap();
        scheduler
            .update(UpdateThumbnailQueueRequest {
                generation: ThumbnailGeneration(1),
                replace_pending: false,
                requests: vec![spec("a", 0, ThumbnailDemandClass::Visible)],
            })
            .unwrap();
        assert_eq!(scheduler.snapshot().requested_unique, 2);
        assert_eq!(&*scheduler.claim().unwrap().path, "a");
    }
    #[test]
    fn replacement_cancels_in_flight_and_rejects_old_generation() {
        let scheduler = ThumbnailScheduler::new(Default::default());
        scheduler
            .update(update(
                1,
                vec![spec("old", 0, ThumbnailDemandClass::Visible)],
            ))
            .unwrap();
        let old = scheduler.claim().unwrap();
        scheduler
            .update(update(
                2,
                vec![spec("new", 0, ThumbnailDemandClass::Visible)],
            ))
            .unwrap();
        assert!(old.cancellation.is_cancelled());
        assert!(!scheduler.is_publishable(&old));
        assert_eq!(
            scheduler.update(update(1, vec![])).unwrap_err(),
            "thumbnail_generation_stale"
        );
    }
    #[test]
    fn queue_bound_evicts_worst_background() {
        let scheduler = ThumbnailScheduler::new(ThumbnailSchedulerPolicy {
            max_pending: 2,
            ..Default::default()
        });
        scheduler
            .update(update(
                1,
                vec![
                    spec("bad", 99, ThumbnailDemandClass::Background),
                    spec("near", 1, ThumbnailDemandClass::Visible),
                    spec("far", 20, ThumbnailDemandClass::Visible),
                ],
            ))
            .unwrap();
        assert_eq!(scheduler.snapshot().dropped, 1);
        assert_eq!(&*scheduler.claim().unwrap().path, "near");
        assert_eq!(&*scheduler.claim().unwrap().path, "far");
    }
    #[test]
    fn completion_counts_once() {
        let scheduler = ThumbnailScheduler::new(Default::default());
        scheduler
            .update(update(7, vec![spec("a", 0, ThumbnailDemandClass::Visible)]))
            .unwrap();
        let job = scheduler.claim().unwrap();
        let progress = scheduler
            .finish(&job, FinishOutcome::Completed { cache_hit: true })
            .unwrap();
        assert_eq!(
            (
                progress.completed,
                progress.cache_hits,
                progress.pending,
                progress.in_flight
            ),
            (0, 1, 0, 0)
        );
        assert!(
            scheduler
                .finish(&job, FinishOutcome::Completed { cache_hit: false })
                .is_none()
        );
    }

    #[test]
    fn delayed_retry_does_not_block_ready_visible_work() {
        let scheduler = ThumbnailScheduler::new(ThumbnailSchedulerPolicy {
            retry_base: Duration::from_secs(10),
            ..Default::default()
        });
        scheduler
            .update(update(
                1,
                vec![spec("retry", -100, ThumbnailDemandClass::Visible)],
            ))
            .unwrap();
        let retry = scheduler.claim().unwrap();
        scheduler
            .finish(&retry, FinishOutcome::Failed { retryable: true })
            .unwrap();
        scheduler
            .update(UpdateThumbnailQueueRequest {
                generation: ThumbnailGeneration(1),
                replace_pending: false,
                requests: vec![spec("ready", 0, ThumbnailDemandClass::Visible)],
            })
            .unwrap();
        assert_eq!(&*scheduler.claim().unwrap().path, "ready");
    }

    #[test]
    #[ignore = "manual scheduler throughput measurement"]
    fn benchmark_fifty_thousand_replacement() {
        let scheduler = ThumbnailScheduler::new(ThumbnailSchedulerPolicy {
            max_pending: 50_000,
            ..Default::default()
        });
        let requests = (0..50_000)
            .map(|index| {
                spec(
                    &format!("/library/{index}.raw"),
                    index,
                    ThumbnailDemandClass::Background,
                )
            })
            .collect();
        let started = Instant::now();
        scheduler.update(update(1, requests)).unwrap();
        let initial_update = started.elapsed();
        let replacement_started = Instant::now();
        scheduler
            .update(update(
                2,
                (0..100)
                    .map(|index| {
                        spec(
                            &format!("/visible/{index}.raw"),
                            index,
                            ThumbnailDemandClass::Visible,
                        )
                    })
                    .collect(),
            ))
            .unwrap();
        let replacement = replacement_started.elapsed();
        let first = scheduler.claim().unwrap();
        assert_eq!(&*first.path, "/visible/0.raw");
        eprintln!(
            "thumbnail_scheduler_50k initial_update_ms={:.3} replacement_100_ms={:.3}",
            initial_update.as_secs_f64() * 1_000.0,
            replacement.as_secs_f64() * 1_000.0
        );
    }
}
