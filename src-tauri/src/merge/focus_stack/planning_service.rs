use std::sync::Mutex;

use super::candidate::AcceptedFocusRuntime;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FocusStackPlanGeneration(u64);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AcceptedFocusPlan {
    pub plan_id: String,
    pub plan_hash: String,
}

#[derive(Default)]
struct PlanningState {
    generation: u64,
    accepted_plan: Option<AcceptedFocusPlan>,
    accepted_runtime: Option<AcceptedFocusRuntime>,
}

#[derive(Default)]
pub(crate) struct FocusStackPlanningService {
    state: Mutex<PlanningState>,
}

impl FocusStackPlanningService {
    pub(crate) fn begin(&self) -> FocusStackPlanGeneration {
        let mut state = self.state.lock().expect("focus planning service poisoned");
        state.generation = state
            .generation
            .checked_add(1)
            .expect("focus planning generation exhausted");
        state.accepted_plan = None;
        state.accepted_runtime = None;
        FocusStackPlanGeneration(state.generation)
    }

    pub(crate) fn is_current(&self, generation: FocusStackPlanGeneration) -> bool {
        self.state
            .lock()
            .map(|state| state.generation == generation.0)
            .unwrap_or(false)
    }

    pub(crate) fn complete(
        &self,
        generation: FocusStackPlanGeneration,
        accepted: Option<(AcceptedFocusPlan, AcceptedFocusRuntime)>,
    ) -> Result<(), &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "focus_stack_plan_state_unavailable")?;
        if state.generation != generation.0 {
            return Err("focus_stack_plan_cancelled:plan_publication");
        }
        match accepted {
            Some((plan, runtime)) => {
                state.accepted_plan = Some(plan);
                state.accepted_runtime = Some(runtime);
            }
            None => {
                state.accepted_plan = None;
                state.accepted_runtime = None;
            }
        }
        Ok(())
    }

    pub(crate) fn cancel(&self) {
        let mut state = self.state.lock().expect("focus planning service poisoned");
        state.generation = state
            .generation
            .checked_add(1)
            .expect("focus planning generation exhausted");
        state.accepted_plan = None;
        state.accepted_runtime = None;
    }

    #[cfg(test)]
    pub(crate) fn accepted_plan(&self) -> Result<Option<AcceptedFocusPlan>, &'static str> {
        self.state
            .lock()
            .map(|state| state.accepted_plan.clone())
            .map_err(|_| "focus_stack_plan_state_unavailable")
    }

    pub(crate) fn accepted_runtime(&self) -> Result<Option<AcceptedFocusRuntime>, &'static str> {
        self.state
            .lock()
            .map(|state| state.accepted_runtime.clone())
            .map_err(|_| "focus_runtime_unavailable")
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;
    use crate::merge::focus_stack::candidate::AcceptedFocusPlanIdentity;

    fn accepted(index: u64) -> (AcceptedFocusPlan, AcceptedFocusRuntime) {
        let plan_id = format!("focus-plan-{index}");
        let plan_hash = format!("blake3:focus-{index}");
        (
            AcceptedFocusPlan {
                plan_id: plan_id.clone(),
                plan_hash: plan_hash.clone(),
            },
            AcceptedFocusRuntime {
                identity: AcceptedFocusPlanIdentity {
                    plan_id,
                    plan_hash,
                    input_plan_hash: format!("blake3:input-{index}"),
                    width: 64,
                    height: 48,
                    reference_source_index: 0,
                    source_hashes: vec!["blake3:a".into(), "blake3:b".into()],
                    graph_revisions: vec!["graph:a".into(), "graph:b".into()],
                    source_order: vec!["a.raw".into(), "b.raw".into()],
                    transform_hash: "blake3:transform".into(),
                    policy_hash: "blake3:policy".into(),
                    preview_hash: "blake3:preview".into(),
                },
                paths: vec!["a.raw".into(), "b.raw".into()],
            },
        )
    }

    #[test]
    fn cancellation_is_terminal_for_a_started_plan() {
        let service = FocusStackPlanningService::default();
        let generation = service.begin();
        service.cancel();

        assert!(!service.is_current(generation));
        assert_eq!(
            service.complete(generation, Some(accepted(1))),
            Err("focus_stack_plan_cancelled:plan_publication")
        );
        assert_eq!(service.accepted_plan().unwrap(), None);
        assert!(service.accepted_runtime().unwrap().is_none());
    }

    #[test]
    fn forced_concurrent_plans_publish_only_the_latest_generation() {
        const WORKERS: usize = 16;
        let service = Arc::new(FocusStackPlanningService::default());
        let barrier = Arc::new(Barrier::new(WORKERS));
        let workers = (0..WORKERS)
            .map(|index| {
                let service = Arc::clone(&service);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    let generation = service.begin();
                    barrier.wait();
                    (
                        index,
                        generation,
                        service.complete(generation, Some(accepted(index as u64))),
                    )
                })
            })
            .collect::<Vec<_>>();

        let outcomes = workers
            .into_iter()
            .map(|worker| worker.join().expect("focus planning worker"))
            .collect::<Vec<_>>();
        let published = outcomes
            .iter()
            .filter(|(_, _, result)| result.is_ok())
            .collect::<Vec<_>>();
        assert_eq!(published.len(), 1);
        let accepted = service.accepted_plan().unwrap().unwrap();
        assert_eq!(accepted.plan_id, format!("focus-plan-{}", published[0].0));
        let runtime = service.accepted_runtime().unwrap().unwrap();
        assert_eq!(runtime.identity.plan_id, accepted.plan_id);
        assert_eq!(runtime.identity.plan_hash, accepted.plan_hash);
    }
}
