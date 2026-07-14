use std::sync::{Arc, Mutex, Weak};

use image::DynamicImage;

#[derive(Clone)]
pub(crate) struct PendingHdrSourceRef {
    pub content_hash: String,
    pub image_path: String,
    pub width: u32,
    pub height: u32,
    pub exposure_time_seconds: f32,
    pub iso: f32,
    pub source_index: usize,
}

#[derive(Clone)]
pub(crate) struct PendingHdrMergePlan {
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    pub alignment_policy_id: String,
    pub source_content_hashes: Vec<String>,
    pub source_paths: Vec<String>,
    pub static_radiance_hash: Option<String>,
    pub deghost_radiance_hash: Option<String>,
    pub motion_probability_hash: Option<String>,
    pub ownership_hash: Option<String>,
    pub feather_hash: Option<String>,
    pub unresolved_fraction: Option<f32>,
    pub(crate) planned_sources: Vec<super::PlannedSource>,
    pub(crate) motion_probability_bytes: Vec<u8>,
    pub(crate) ownership_bytes: Vec<u8>,
    pub(crate) feather_bytes: Vec<u8>,
    pub scene_linear_artifact_hash: Option<String>,
    pub tone_mapped_preview_hash: Option<String>,
    pub motion_coverage: Option<f32>,
    pub confidence_mean: Option<f32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct HdrPlanHandle(u64);

#[derive(Clone)]
pub(crate) struct HdrAcceptedPlan {
    pub handle: HdrPlanHandle,
    pub plan: PendingHdrMergePlan,
}

pub(crate) struct HdrSavePayload {
    pub lease: HdrSaveLease,
    pub image: Arc<DynamicImage>,
    pub plan: PendingHdrMergePlan,
    pub source_refs: Vec<PendingHdrSourceRef>,
}

pub(crate) struct HdrSaveLease {
    service: Weak<HdrPlanningService>,
    handle: HdrPlanHandle,
    completed: bool,
}

impl HdrSaveLease {
    pub(crate) fn authorize_publication(&self) -> Result<(), String> {
        self.service
            .upgrade()
            .ok_or_else(|| "hdr_save_state_unavailable".to_string())?
            .authorize_save(self.handle)
            .then_some(())
            .ok_or_else(|| "hdr_save_stale_plan_completion".to_string())
    }

    pub(crate) fn complete(mut self) -> bool {
        let completed = self
            .service
            .upgrade()
            .is_some_and(|service| service.complete_save(self.handle));
        self.completed = true;
        completed
    }
}

impl Drop for HdrSaveLease {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        if let Some(service) = self.service.upgrade() {
            service.release_save(self.handle);
        }
    }
}

#[derive(Default)]
struct HdrPlanningState {
    generation: u64,
    plan: Option<PendingHdrMergePlan>,
    result: Option<Arc<DynamicImage>>,
    source_refs: Vec<PendingHdrSourceRef>,
    save_in_flight: Option<HdrPlanHandle>,
}

#[derive(Default)]
pub(crate) struct HdrPlanningService {
    state: Mutex<HdrPlanningState>,
}

impl HdrPlanningService {
    pub(crate) fn begin(&self) -> HdrPlanHandle {
        crate::merge::atomic_derived_output::with_atomic_output_publish_lock(|| {
            let mut state = self.state.lock().expect("HDR planning service poisoned");
            state.generation = state
                .generation
                .checked_add(1)
                .expect("HDR planning generation exhausted");
            state.plan = None;
            state.result = None;
            state.source_refs.clear();
            state.save_in_flight = None;
            HdrPlanHandle(state.generation)
        })
        .expect("atomic output publication lock poisoned")
    }

    pub(crate) fn is_current(&self, handle: HdrPlanHandle) -> bool {
        self.state
            .lock()
            .map(|state| state.generation == handle.0)
            .unwrap_or(false)
    }

    pub(crate) fn complete_plan(
        &self,
        handle: HdrPlanHandle,
        plan: PendingHdrMergePlan,
    ) -> Result<(), &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "hdr_plan_state_unavailable")?;
        if state.generation != handle.0 {
            return Err("hdr_plan_cancelled:artifact_publication");
        }
        state.plan = Some(plan);
        state.result = None;
        state.source_refs.clear();
        state.save_in_flight = None;
        Ok(())
    }

    pub(crate) fn accepted_plan(&self) -> Result<HdrAcceptedPlan, &'static str> {
        let state = self
            .state
            .lock()
            .map_err(|_| "hdr_plan_state_unavailable")?;
        let plan = state
            .plan
            .clone()
            .ok_or("hdr_apply_requires_accepted_native_plan")?;
        Ok(HdrAcceptedPlan {
            handle: HdrPlanHandle(state.generation),
            plan,
        })
    }

    pub(crate) fn publish_merge(
        &self,
        accepted: &HdrAcceptedPlan,
        runtime_plan: PendingHdrMergePlan,
        source_refs: Vec<PendingHdrSourceRef>,
        result: DynamicImage,
    ) -> Result<(), &'static str> {
        crate::merge::atomic_derived_output::with_atomic_output_publish_lock(|| {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "hdr_plan_state_unavailable")?;
            let still_accepted = state.generation == accepted.handle.0
                && state.plan.as_ref().is_some_and(|current| {
                    current.accepted_dry_run_plan_id == accepted.plan.accepted_dry_run_plan_id
                        && current.accepted_dry_run_plan_hash
                            == accepted.plan.accepted_dry_run_plan_hash
                })
                && runtime_plan.accepted_dry_run_plan_id == accepted.plan.accepted_dry_run_plan_id
                && runtime_plan.accepted_dry_run_plan_hash
                    == accepted.plan.accepted_dry_run_plan_hash;
            if !still_accepted {
                return Err("hdr_apply_stale_plan_completion");
            }
            state.plan = Some(runtime_plan);
            state.result = Some(Arc::new(result));
            state.source_refs = source_refs;
            state.save_in_flight = None;
            Ok(())
        })
        .map_err(|_| "hdr_plan_state_unavailable")?
    }

    pub(crate) fn acquire_save_payload(self: &Arc<Self>) -> Result<HdrSavePayload, &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "hdr_plan_state_unavailable")?;
        let plan = state
            .plan
            .clone()
            .ok_or("HDR merge plan missing; rerun HDR merge before saving.")?;
        let image = state
            .result
            .clone()
            .ok_or("No hdr image found in memory to save. It might have already been saved.")?;
        if state.save_in_flight.is_some() {
            return Err("hdr_save_already_in_progress");
        }
        let handle = HdrPlanHandle(state.generation);
        state.save_in_flight = Some(handle);
        Ok(HdrSavePayload {
            lease: HdrSaveLease {
                service: Arc::downgrade(self),
                handle,
                completed: false,
            },
            image,
            plan,
            source_refs: state.source_refs.clone(),
        })
    }

    fn authorize_save(&self, handle: HdrPlanHandle) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| state.generation == handle.0 && state.save_in_flight == Some(handle))
    }

    fn release_save(&self, handle: HdrPlanHandle) {
        if let Ok(mut state) = self.state.lock()
            && state.generation == handle.0
            && state.save_in_flight == Some(handle)
        {
            state.save_in_flight = None;
        }
    }

    pub(crate) fn complete_save(&self, handle: HdrPlanHandle) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state.generation != handle.0 || state.save_in_flight != Some(handle) {
            return false;
        }
        state.plan = None;
        state.result = None;
        state.source_refs.clear();
        state.save_in_flight = None;
        true
    }

    pub(crate) fn cancel(&self) {
        crate::merge::atomic_derived_output::with_atomic_output_publish_lock(|| {
            let mut state = self.state.lock().expect("HDR planning service poisoned");
            state.generation = state
                .generation
                .checked_add(1)
                .expect("HDR planning generation exhausted");
            state.plan = None;
            state.result = None;
            state.source_refs.clear();
            state.save_in_flight = None;
        })
        .expect("atomic output publication lock poisoned");
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use image::{DynamicImage, RgbImage};

    use super::*;

    fn plan(index: u64) -> PendingHdrMergePlan {
        PendingHdrMergePlan {
            accepted_dry_run_plan_hash: format!("blake3:plan-{index}"),
            accepted_dry_run_plan_id: format!("hdr-plan-{index}"),
            alignment_policy_id: super::super::ALIGNMENT_POLICY_ID.into(),
            source_content_hashes: vec!["blake3:a".into(), "blake3:b".into()],
            source_paths: vec!["a.raw".into(), "b.raw".into()],
            static_radiance_hash: None,
            deghost_radiance_hash: None,
            motion_probability_hash: None,
            ownership_hash: None,
            feather_hash: None,
            unresolved_fraction: Some(0.0),
            planned_sources: Vec::new(),
            motion_probability_bytes: Vec::new(),
            ownership_bytes: Vec::new(),
            feather_bytes: Vec::new(),
            scene_linear_artifact_hash: None,
            tone_mapped_preview_hash: None,
            motion_coverage: None,
            confidence_mean: None,
        }
    }

    fn source(index: usize) -> PendingHdrSourceRef {
        PendingHdrSourceRef {
            content_hash: format!("blake3:{index}"),
            image_path: format!("{index}.raw"),
            width: 8,
            height: 6,
            exposure_time_seconds: 0.01,
            iso: 100.0,
            source_index: index,
        }
    }

    #[test]
    fn cancel_rejects_started_plan_and_clears_all_runtime_state() {
        let service = HdrPlanningService::default();
        let handle = service.begin();
        service.complete_plan(handle, plan(1)).unwrap();
        service.cancel();

        assert!(!service.is_current(handle));
        assert_eq!(
            service.complete_plan(handle, plan(1)),
            Err("hdr_plan_cancelled:artifact_publication")
        );
        assert!(matches!(
            service.accepted_plan(),
            Err("hdr_apply_requires_accepted_native_plan")
        ));
    }

    #[test]
    fn reordered_concurrent_completion_publishes_only_the_successor_plan() {
        let service = Arc::new(HdrPlanningService::default());
        let first = service.begin();
        let second = service.begin();
        let barrier = Arc::new(Barrier::new(2));
        let successor = {
            let service = Arc::clone(&service);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                service.complete_plan(second, plan(2))
            })
        };
        let stale = {
            let service = Arc::clone(&service);
            thread::spawn(move || {
                barrier.wait();
                successor.join().expect("successor plan worker").unwrap();
                service.complete_plan(first, plan(1))
            })
        };

        assert_eq!(
            stale.join().expect("stale plan worker"),
            Err("hdr_plan_cancelled:artifact_publication")
        );
        assert_eq!(
            service
                .accepted_plan()
                .unwrap()
                .plan
                .accepted_dry_run_plan_id,
            "hdr-plan-2"
        );
    }

    #[test]
    fn merged_state_and_successful_save_clear_atomically() {
        let service = Arc::new(HdrPlanningService::default());
        let handle = service.begin();
        service.complete_plan(handle, plan(3)).unwrap();
        let accepted = service.accepted_plan().unwrap();
        service
            .publish_merge(
                &accepted,
                plan(3),
                vec![source(0), source(1)],
                DynamicImage::ImageRgb8(RgbImage::new(8, 6)),
            )
            .unwrap();

        let payload = service.acquire_save_payload().unwrap();
        assert_eq!(payload.plan.accepted_dry_run_plan_id, "hdr-plan-3");
        assert_eq!(payload.source_refs.len(), 2);
        assert_eq!((payload.image.width(), payload.image.height()), (8, 6));
        assert!(payload.lease.complete());
        assert!(service.accepted_plan().is_err());
        assert!(service.acquire_save_payload().is_err());
    }

    #[test]
    fn stale_merge_completion_cannot_replace_successor_plan() {
        let service = HdrPlanningService::default();
        let first = service.begin();
        service.complete_plan(first, plan(30)).unwrap();
        let stale = service.accepted_plan().unwrap();
        let second = service.begin();
        service.complete_plan(second, plan(31)).unwrap();

        assert_eq!(
            service.publish_merge(
                &stale,
                plan(30),
                vec![source(0), source(1)],
                DynamicImage::ImageRgb8(RgbImage::new(8, 6)),
            ),
            Err("hdr_apply_stale_plan_completion")
        );
        assert_eq!(
            service
                .accepted_plan()
                .unwrap()
                .plan
                .accepted_dry_run_plan_id,
            "hdr-plan-31"
        );
    }

    #[test]
    fn failed_save_releases_lease_without_losing_retry_payload() {
        let service = Arc::new(HdrPlanningService::default());
        let handle = service.begin();
        service.complete_plan(handle, plan(4)).unwrap();
        let accepted = service.accepted_plan().unwrap();
        service
            .publish_merge(
                &accepted,
                plan(4),
                vec![source(0), source(1)],
                DynamicImage::ImageRgb8(RgbImage::new(8, 6)),
            )
            .unwrap();

        let failed_attempt = service.acquire_save_payload().unwrap();
        assert_eq!(
            service.acquire_save_payload().err(),
            Some("hdr_save_already_in_progress")
        );
        drop(failed_attempt);

        let retry = service.acquire_save_payload().unwrap();
        assert_eq!(retry.plan.accepted_dry_run_plan_id, "hdr-plan-4");
        assert!(retry.lease.complete());
    }

    #[test]
    fn successor_plan_winning_save_race_rejects_stale_publication() {
        let service = Arc::new(HdrPlanningService::default());
        let first = service.begin();
        service.complete_plan(first, plan(5)).unwrap();
        let accepted = service.accepted_plan().unwrap();
        service
            .publish_merge(
                &accepted,
                plan(5),
                vec![source(0), source(1)],
                DynamicImage::ImageRgb8(RgbImage::new(8, 6)),
            )
            .unwrap();
        let stale_save = service.acquire_save_payload().unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let successor = {
            let service = Arc::clone(&service);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                service.begin()
            })
        };

        barrier.wait();
        let successor = successor.join().expect("successor plan worker");
        assert!(service.is_current(successor));
        assert_eq!(
            stale_save.lease.authorize_publication(),
            Err("hdr_save_stale_plan_completion".to_string())
        );
    }

    #[test]
    fn cancel_winning_save_race_rejects_stale_publication() {
        let service = Arc::new(HdrPlanningService::default());
        let handle = service.begin();
        service.complete_plan(handle, plan(6)).unwrap();
        let accepted = service.accepted_plan().unwrap();
        service
            .publish_merge(
                &accepted,
                plan(6),
                vec![source(0), source(1)],
                DynamicImage::ImageRgb8(RgbImage::new(8, 6)),
            )
            .unwrap();
        let stale_save = service.acquire_save_payload().unwrap();

        service.cancel();

        assert_eq!(
            stale_save.lease.authorize_publication(),
            Err("hdr_save_stale_plan_completion".to_string())
        );
    }
}
