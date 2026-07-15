//! Exact-generation scheduling for Film preview, export, and thumbnail work.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FilmRenderQualityV1 {
    InteractiveDragV1,
    SettledPreviewV1,
    ExportFullV1,
    ProfileThumbnailV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmRenderIdentityV1 {
    pub source_content_sha256: String,
    pub selected_image_id: String,
    pub graph_revision: u64,
    pub upstream_graph_sha256: String,
    pub film_node_sha256: String,
    pub compiled_profile_sha256: String,
    pub execution_plan_sha256: String,
    pub orientation_and_geometry_sha256: String,
    pub full_resolution_coordinate_policy: String,
    pub quality: FilmRenderQualityV1,
    pub view_output_sha256: String,
    pub crop_and_dimensions_sha256: String,
}

#[cfg(test)]
fn can_commit(current: &FilmRenderIdentityV1, result: &FilmRenderIdentityV1) -> bool {
    current == result
}

#[derive(Clone)]
pub(crate) struct FilmRenderLease {
    request_id: String,
    lane: String,
    generation: u64,
    identity: FilmRenderIdentityV1,
    cancellation: Arc<AtomicBool>,
}

impl FilmRenderLease {
    #[cfg(test)]
    pub(crate) fn request_id(&self) -> &str {
        &self.request_id
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancellation.load(Ordering::Acquire)
    }

    #[cfg(test)]
    fn generation(&self) -> u64 {
        self.generation
    }
}

struct ActiveFilmRender {
    request_id: String,
    generation: u64,
    identity: FilmRenderIdentityV1,
    cancellation: Arc<AtomicBool>,
}

#[derive(Default)]
struct FilmRenderSchedulerState {
    next_generation: u64,
    active_by_lane: HashMap<String, ActiveFilmRender>,
    lane_by_request_id: HashMap<String, String>,
}

#[derive(Default)]
pub(crate) struct FilmRenderScheduler {
    state: Mutex<FilmRenderSchedulerState>,
}

impl FilmRenderScheduler {
    pub(crate) fn begin(
        &self,
        request_id: String,
        lane: String,
        identity: FilmRenderIdentityV1,
    ) -> Result<FilmRenderLease, &'static str> {
        if request_id.trim().is_empty() || lane.trim().is_empty() {
            return Err("film_render_invalid_request_identity");
        }
        let mut state = self.state.lock().expect("film render scheduler poisoned");
        if let Some(previous_lane) = state.lane_by_request_id.remove(&request_id)
            && let Some(previous) = state.active_by_lane.remove(&previous_lane)
        {
            previous.cancellation.store(true, Ordering::Release);
        }
        if let Some(previous) = state.active_by_lane.remove(&lane) {
            previous.cancellation.store(true, Ordering::Release);
            state.lane_by_request_id.remove(&previous.request_id);
        }
        state.next_generation = state
            .next_generation
            .checked_add(1)
            .expect("film render generation exhausted");
        let generation = state.next_generation;
        let cancellation = Arc::new(AtomicBool::new(false));
        state
            .lane_by_request_id
            .insert(request_id.clone(), lane.clone());
        state.active_by_lane.insert(
            lane.clone(),
            ActiveFilmRender {
                request_id: request_id.clone(),
                generation,
                identity: identity.clone(),
                cancellation: Arc::clone(&cancellation),
            },
        );
        Ok(FilmRenderLease {
            request_id,
            lane,
            generation,
            identity,
            cancellation,
        })
    }

    pub(crate) fn cancel(&self, request_id: &str) -> bool {
        let mut state = self.state.lock().expect("film render scheduler poisoned");
        let Some(lane) = state.lane_by_request_id.remove(request_id) else {
            return false;
        };
        let Some(active) = state.active_by_lane.remove(&lane) else {
            return false;
        };
        if active.request_id != request_id {
            state.active_by_lane.insert(lane, active);
            return false;
        }
        active.cancellation.store(true, Ordering::Release);
        true
    }

    pub(crate) fn is_current(&self, lease: &FilmRenderLease) -> bool {
        if lease.is_cancelled() {
            return false;
        }
        self.state
            .lock()
            .expect("film render scheduler poisoned")
            .active_by_lane
            .get(&lease.lane)
            .is_some_and(|active| {
                active.generation == lease.generation
                    && active.request_id == lease.request_id
                    && active.identity == lease.identity
                    && !active.cancellation.load(Ordering::Acquire)
            })
    }

    /// Linearizes publication against cancellation and supersession. The caller
    /// performs encode/cache/event work after this claim, without holding the lock.
    pub(crate) fn claim_current(&self, lease: &FilmRenderLease) -> bool {
        let mut state = self.state.lock().expect("film render scheduler poisoned");
        let Some(active) = state.active_by_lane.get(&lease.lane) else {
            return false;
        };
        if active.generation != lease.generation
            || active.request_id != lease.request_id
            || active.identity != lease.identity
            || active.cancellation.load(Ordering::Acquire)
        {
            return false;
        }
        state.active_by_lane.remove(&lease.lane);
        state.lane_by_request_id.remove(&lease.request_id);
        true
    }

    pub(crate) fn finish(&self, lease: &FilmRenderLease) -> bool {
        let mut state = self.state.lock().expect("film render scheduler poisoned");
        let Some(active) = state.active_by_lane.get(&lease.lane) else {
            return false;
        };
        if active.generation != lease.generation || active.request_id != lease.request_id {
            return false;
        }
        state.active_by_lane.remove(&lease.lane);
        state.lane_by_request_id.remove(&lease.request_id);
        true
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    fn identity(quality: FilmRenderQualityV1) -> FilmRenderIdentityV1 {
        FilmRenderIdentityV1 {
            source_content_sha256: "sha256:source".into(),
            selected_image_id: "image-1".into(),
            graph_revision: 4,
            upstream_graph_sha256: "fnv1a64:1111111111111111".into(),
            film_node_sha256: "fnv1a64:2222222222222222".into(),
            compiled_profile_sha256: "sha256:profile".into(),
            execution_plan_sha256: "sha256:plan".into(),
            orientation_and_geometry_sha256: "fnv1a64:3333333333333333".into(),
            full_resolution_coordinate_policy: "source_stable_v1".into(),
            quality,
            view_output_sha256: "fnv1a64:4444444444444444".into(),
            crop_and_dimensions_sha256: "fnv1a64:5555555555555555".into(),
        }
    }

    #[test]
    fn rejects_out_of_order_quality_result() {
        assert!(!can_commit(
            &identity(FilmRenderQualityV1::SettledPreviewV1),
            &identity(FilmRenderQualityV1::InteractiveDragV1)
        ));
    }

    #[test]
    fn accepts_exact_revision_identity_only() {
        let current = identity(FilmRenderQualityV1::ExportFullV1);
        assert!(can_commit(&current, &current));
        let mut stale = current.clone();
        stale.graph_revision += 1;
        assert!(!can_commit(&current, &stale));
    }

    #[test]
    fn thirty_forced_concurrent_revisions_leave_only_newest_generation_committable() {
        let scheduler = Arc::new(FilmRenderScheduler::default());
        let barrier = Arc::new(Barrier::new(31));
        let workers = (0..30)
            .map(|revision| {
                let scheduler = Arc::clone(&scheduler);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    let mut request = identity(FilmRenderQualityV1::SettledPreviewV1);
                    request.graph_revision = revision;
                    scheduler
                        .begin(
                            format!("request-{revision}"),
                            "preview:image-1".into(),
                            request,
                        )
                        .unwrap()
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let leases = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        let newest = leases
            .iter()
            .max_by_key(|lease| lease.generation())
            .unwrap();
        assert_eq!(
            leases
                .iter()
                .filter(|lease| scheduler.is_current(lease))
                .count(),
            1
        );
        assert!(scheduler.claim_current(newest));
        assert!(leases.iter().all(|lease| !scheduler.is_current(lease)));
    }

    #[test]
    fn exact_cancel_cannot_cancel_or_publish_successor_generation() {
        let scheduler = FilmRenderScheduler::default();
        let first = scheduler
            .begin(
                "first".into(),
                "thumbnail:look".into(),
                identity(FilmRenderQualityV1::ProfileThumbnailV1),
            )
            .unwrap();
        assert!(scheduler.cancel(first.request_id()));
        let successor = scheduler
            .begin(
                "successor".into(),
                "thumbnail:look".into(),
                identity(FilmRenderQualityV1::ProfileThumbnailV1),
            )
            .unwrap();
        assert!(!scheduler.cancel(first.request_id()));
        assert!(!scheduler.claim_current(&first));
        assert!(scheduler.is_current(&successor));
        assert!(scheduler.claim_current(&successor));
    }
}
