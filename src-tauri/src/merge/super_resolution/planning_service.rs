use std::sync::Mutex;
use std::{collections::HashMap, sync::Arc};

use serde::Serialize;

use super::{candidate::AcceptedBurstSrRuntime, job::BurstSrCandidateJobResult};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct BurstSrPlanHandle(u64);

#[derive(Clone)]
pub(crate) struct AcceptedBurstSrLease {
    lease: LifecycleLease,
    pub runtime: Arc<AcceptedBurstSrRuntime>,
}

#[derive(Clone, Eq, PartialEq)]
struct LifecycleLease {
    generation: u64,
    identity: String,
}

struct AcceptedRecord<T> {
    identity: String,
    value: T,
}

struct ResultRecord<R> {
    generation: u64,
    identity: String,
    value: R,
}

struct Lifecycle<T, R> {
    generation: u64,
    accepted: Option<AcceptedRecord<T>>,
    jobs: HashMap<String, LifecycleLease>,
    results: HashMap<String, ResultRecord<R>>,
}

impl<T, R> Default for Lifecycle<T, R> {
    fn default() -> Self {
        Self {
            generation: 0,
            accepted: None,
            jobs: HashMap::new(),
            results: HashMap::new(),
        }
    }
}

impl<T: Clone, R: Clone> Lifecycle<T, R> {
    fn begin(&mut self) -> BurstSrPlanHandle {
        self.generation = self
            .generation
            .checked_add(1)
            .expect("Burst SR planning generation exhausted");
        self.accepted = None;
        self.jobs.clear();
        self.results.clear();
        BurstSrPlanHandle(self.generation)
    }

    fn complete(
        &mut self,
        handle: BurstSrPlanHandle,
        accepted: Option<(String, T)>,
    ) -> Result<(), &'static str> {
        if self.generation != handle.0 {
            return Err("super_resolution_registration_stale_completion");
        }
        self.accepted = accepted.map(|(identity, value)| AcceptedRecord { identity, value });
        self.jobs.clear();
        self.results.clear();
        Ok(())
    }

    fn publish_result(
        &mut self,
        lease: &LifecycleLease,
        job_id: String,
        value: R,
    ) -> Result<(), &'static str> {
        if !self.lease_current(lease) || self.jobs.get(&job_id) != Some(lease) {
            return Err("sr_candidate_stale_runtime_completion");
        }
        self.results.insert(
            job_id,
            ResultRecord {
                generation: lease.generation,
                identity: lease.identity.clone(),
                value,
            },
        );
        Ok(())
    }

    fn register_job(&mut self, lease: &LifecycleLease, job_id: String) -> Result<(), &'static str> {
        if !self.lease_current(lease) {
            return Err("sr_candidate_stale_runtime");
        }
        self.jobs.insert(job_id, lease.clone());
        Ok(())
    }

    fn job_current(&self, job_id: &str) -> bool {
        self.jobs
            .get(job_id)
            .is_some_and(|lease| self.lease_current(lease))
    }

    fn lease_current(&self, lease: &LifecycleLease) -> bool {
        self.generation == lease.generation
            && self
                .accepted
                .as_ref()
                .is_some_and(|accepted| accepted.identity == lease.identity)
    }

    fn read_result(&self, job_id: &str) -> Option<R> {
        let accepted = self.accepted.as_ref()?;
        let result = self.results.get(job_id)?;
        (result.generation == self.generation && result.identity == accepted.identity)
            .then(|| result.value.clone())
    }
}

#[derive(Default)]
pub(crate) struct BurstSrPlanningService {
    state: Mutex<Lifecycle<Arc<AcceptedBurstSrRuntime>, BurstSrCandidateJobResult>>,
}

impl BurstSrPlanningService {
    pub(crate) fn begin_plan(&self) -> BurstSrPlanHandle {
        crate::merge::atomic_derived_output::with_atomic_output_publish_lock(|| {
            self.state
                .lock()
                .expect("Burst SR planning service poisoned")
                .begin()
        })
        .expect("atomic output publication lock poisoned")
    }

    pub(crate) fn is_current(&self, handle: BurstSrPlanHandle) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| state.generation == handle.0)
    }

    pub(crate) fn complete_plan(
        &self,
        handle: BurstSrPlanHandle,
        accepted: Option<AcceptedBurstSrRuntime>,
    ) -> Result<(), &'static str> {
        let accepted = accepted
            .map(|runtime| runtime_identity(&runtime).map(|identity| (identity, Arc::new(runtime))))
            .transpose()
            .map_err(|_| "sr_runtime_identity_unavailable")?;
        self.state
            .lock()
            .map_err(|_| "sr_runtime_unavailable")?
            .complete(handle, accepted)
    }

    pub(crate) fn accepted(
        &self,
        accepted_review_id: &str,
    ) -> Result<AcceptedBurstSrLease, &'static str> {
        let state = self.state.lock().map_err(|_| "sr_runtime_unavailable")?;
        let accepted = state
            .accepted
            .as_ref()
            .ok_or("sr_candidate_requires_accepted_review")?;
        if accepted.value.identity.review_id != accepted_review_id
            && accepted.value.identity.plan_id != accepted_review_id
        {
            return Err("sr_candidate_accepted_review_mismatch");
        }
        Ok(AcceptedBurstSrLease {
            lease: LifecycleLease {
                generation: state.generation,
                identity: accepted.identity.clone(),
            },
            runtime: Arc::clone(&accepted.value),
        })
    }

    pub(crate) fn accepted_for_apply(&self) -> Result<AcceptedBurstSrLease, &'static str> {
        let state = self
            .state
            .lock()
            .map_err(|_| "invalid_candidate_runtime_unavailable")?;
        let accepted = state.accepted.as_ref().ok_or("stale_candidate_runtime")?;
        Ok(AcceptedBurstSrLease {
            lease: LifecycleLease {
                generation: state.generation,
                identity: accepted.identity.clone(),
            },
            runtime: Arc::clone(&accepted.value),
        })
    }

    pub(crate) fn authorize(&self, lease: &AcceptedBurstSrLease) -> Result<(), String> {
        self.state
            .lock()
            .is_ok_and(|state| state.lease_current(&lease.lease))
            .then_some(())
            .ok_or_else(|| "sr_apply_stale_runtime_completion".to_string())
    }

    pub(crate) fn publish_job_result(
        &self,
        lease: &AcceptedBurstSrLease,
        job_id: String,
        result: BurstSrCandidateJobResult,
    ) -> Result<(), &'static str> {
        self.state
            .lock()
            .map_err(|_| "sr_runtime_unavailable")?
            .publish_result(&lease.lease, job_id, result)
    }

    pub(crate) fn register_job(
        &self,
        lease: &AcceptedBurstSrLease,
        job_id: String,
    ) -> Result<(), &'static str> {
        self.state
            .lock()
            .map_err(|_| "sr_runtime_unavailable")?
            .register_job(&lease.lease, job_id)
    }

    pub(crate) fn job_current(&self, job_id: &str) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| state.job_current(job_id))
    }

    pub(crate) fn read_job_result(&self, job_id: &str) -> Option<BurstSrCandidateJobResult> {
        self.state.lock().ok()?.read_result(job_id)
    }

    pub(crate) fn cancel(&self) {
        crate::merge::atomic_derived_output::with_atomic_output_publish_lock(|| {
            self.state
                .lock()
                .expect("Burst SR planning service poisoned")
                .begin();
        })
        .expect("atomic output publication lock poisoned");
    }
}

fn runtime_identity(runtime: &AcceptedBurstSrRuntime) -> Result<String, serde_json::Error> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Identity<'a> {
        accepted: &'a super::candidate::AcceptedBurstSrIdentity,
        paths: &'a [String],
    }
    let bytes = serde_json::to_vec(&Identity {
        accepted: &runtime.identity,
        paths: &runtime.paths,
    })?;
    Ok(format!("blake3:{}", blake3::hash(&bytes).to_hex()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lease(generation: u64, identity: &str) -> LifecycleLease {
        LifecycleLease {
            generation,
            identity: identity.into(),
        }
    }

    #[test]
    fn reordered_completion_keeps_only_latest_generation() {
        let mut state = Lifecycle::<String, String>::default();
        let first = state.begin();
        let second = state.begin();
        state
            .complete(second, Some(("second".into(), "runtime-2".into())))
            .unwrap();
        assert_eq!(
            state.complete(first, Some(("first".into(), "runtime-1".into()))),
            Err("super_resolution_registration_stale_completion")
        );
        assert_eq!(state.accepted.unwrap().identity, "second");
    }

    #[test]
    fn cancel_invalidates_accepted_runtime_and_results() {
        let mut state = Lifecycle::<String, String>::default();
        let handle = state.begin();
        state
            .complete(handle, Some(("exact".into(), "runtime".into())))
            .unwrap();
        let accepted = lease(handle.0, "exact");
        state.register_job(&accepted, "job".into()).unwrap();
        state
            .publish_result(&accepted, "job".into(), "candidate".into())
            .unwrap();

        state.begin();

        assert!(!state.lease_current(&accepted));
        assert!(state.read_result("job").is_none());
    }

    #[test]
    fn exact_runtime_identity_rejects_stale_candidate_result() {
        let mut state = Lifecycle::<String, String>::default();
        let handle = state.begin();
        state
            .complete(handle, Some(("identity-a".into(), "runtime-a".into())))
            .unwrap();
        let stale = lease(handle.0, "identity-a");
        state.register_job(&stale, "job".into()).unwrap();
        state
            .complete(handle, Some(("identity-b".into(), "runtime".into())))
            .unwrap();

        assert_eq!(
            state.publish_result(&stale, "job".into(), "candidate".into()),
            Err("sr_candidate_stale_runtime_completion")
        );
        assert!(state.read_result("job").is_none());
    }
}
