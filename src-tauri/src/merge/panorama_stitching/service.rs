use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};

use crate::panorama_utils::alignment_plan::AlignmentCancellation;

use super::{PanoramaPlanResult, PendingPanoramaResult};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PanoramaPlanHandle(u64);

#[derive(Clone)]
pub(crate) struct PanoramaAcceptedLease {
    generation: u64,
    source_paths: Vec<String>,
}

pub(crate) struct PanoramaSavePayload {
    pub lease: PanoramaSaveLease,
    pub pending: Arc<PendingPanoramaResult>,
}

pub(crate) struct PanoramaSaveLease {
    service: Weak<PanoramaService>,
    handle: PanoramaPlanHandle,
    completed: bool,
}

impl PanoramaSaveLease {
    pub(crate) fn authorize_publication(&self) -> Result<(), String> {
        self.service
            .upgrade()
            .ok_or_else(|| "panorama_save_state_unavailable".to_string())?
            .authorize_save(self.handle)
            .then_some(())
            .ok_or_else(|| "panorama_save_stale_completion".to_string())
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

impl Drop for PanoramaSaveLease {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        if let Some(service) = self.service.upgrade() {
            service.release_save(self.handle);
        }
    }
}

struct State<P = PanoramaPlanResult, R = Arc<PendingPanoramaResult>> {
    generation: u64,
    source_paths: Vec<String>,
    plan: Option<P>,
    result: Option<R>,
    save_in_flight: Option<PanoramaPlanHandle>,
    cancellations: HashMap<String, Arc<AlignmentCancellation>>,
}

impl<P, R> Default for State<P, R> {
    fn default() -> Self {
        Self {
            generation: 0,
            source_paths: Vec::new(),
            plan: None,
            result: None,
            save_in_flight: None,
            cancellations: HashMap::new(),
        }
    }
}

#[derive(Default)]
pub(crate) struct PanoramaService {
    state: Mutex<State>,
}

impl PanoramaService {
    pub(crate) fn begin_plan(
        &self,
        source_paths: Vec<String>,
        cancellation_id: String,
        cancellation: Arc<AlignmentCancellation>,
    ) -> PanoramaPlanHandle {
        crate::merge::atomic_derived_output::with_atomic_output_publish_lock(|| {
            let mut state = self.state.lock().expect("panorama service poisoned");
            for token in state.cancellations.values() {
                token.cancel();
            }
            state.generation = state
                .generation
                .checked_add(1)
                .expect("panorama generation exhausted");
            state.source_paths = source_paths;
            state.plan = None;
            state.result = None;
            state.save_in_flight = None;
            state.cancellations.clear();
            state.cancellations.insert(cancellation_id, cancellation);
            PanoramaPlanHandle(state.generation)
        })
        .expect("atomic output publication lock poisoned")
    }

    pub(crate) fn complete_plan(
        &self,
        handle: PanoramaPlanHandle,
        cancellation_id: &str,
        plan: PanoramaPlanResult,
    ) -> Result<(), &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "panorama_state_unavailable")?;
        state.cancellations.remove(cancellation_id);
        publish_plan(&mut state, handle, plan)
    }

    pub(crate) fn fail_plan(&self, handle: PanoramaPlanHandle, cancellation_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.cancellations.remove(cancellation_id);
            if state.generation == handle.0 {
                state.plan = None;
            }
        }
    }

    pub(crate) fn accepted(
        &self,
        source_paths: &[String],
    ) -> Result<PanoramaAcceptedLease, &'static str> {
        let state = self
            .state
            .lock()
            .map_err(|_| "panorama_state_unavailable")?;
        if state.plan.is_none() {
            return Err("panorama_stitch_requires_accepted_plan");
        }
        if state.source_paths != source_paths {
            return Err("panorama_stitch_stale_source_identity");
        }
        Ok(PanoramaAcceptedLease {
            generation: state.generation,
            source_paths: state.source_paths.clone(),
        })
    }

    pub(crate) fn register_render(
        &self,
        lease: &PanoramaAcceptedLease,
        cancellation_id: String,
        cancellation: Arc<AlignmentCancellation>,
    ) -> Result<(), &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "panorama_state_unavailable")?;
        if !current(&state, lease) {
            return Err("panorama_stitch_stale_plan");
        }
        state.cancellations.insert(cancellation_id, cancellation);
        Ok(())
    }

    pub(crate) fn publish_render(
        &self,
        lease: &PanoramaAcceptedLease,
        cancellation_id: &str,
        result: PendingPanoramaResult,
    ) -> Result<(), &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "panorama_state_unavailable")?;
        state.cancellations.remove(cancellation_id);
        publish_result(&mut state, lease, Arc::new(result))?;
        state.save_in_flight = None;
        Ok(())
    }

    pub(crate) fn fail_render(&self, cancellation_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.cancellations.remove(cancellation_id);
        }
    }

    pub(crate) fn acquire_save(self: &Arc<Self>) -> Result<PanoramaSavePayload, &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "panorama_state_unavailable")?;
        let pending = acquire_result(&state).ok_or(
            "No panorama image found in memory to save. It might have already been saved.",
        )?;
        let handle = reserve_save(&mut state)?;
        Ok(PanoramaSavePayload {
            lease: PanoramaSaveLease {
                service: Arc::downgrade(self),
                handle,
                completed: false,
            },
            pending,
        })
    }

    fn authorize_save(&self, handle: PanoramaPlanHandle) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| save_is_current(&state, handle))
    }

    fn release_save(&self, handle: PanoramaPlanHandle) {
        if let Ok(mut state) = self.state.lock()
            && save_is_current(&state, handle)
        {
            state.save_in_flight = None;
        }
    }

    fn complete_save(&self, handle: PanoramaPlanHandle) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if !save_is_current(&state, handle) {
            return false;
        }
        state.result = None;
        state.save_in_flight = None;
        true
    }

    pub(crate) fn cancel(&self, cancellation_id: &str) -> bool {
        crate::merge::atomic_derived_output::with_atomic_output_publish_lock(|| {
            let mut state = self.state.lock().expect("panorama service poisoned");
            let Some(token) = state.cancellations.remove(cancellation_id) else {
                return false;
            };
            token.cancel();
            state.generation = state
                .generation
                .checked_add(1)
                .expect("panorama generation exhausted");
            state.plan = None;
            state.result = None;
            state.save_in_flight = None;
            true
        })
        .expect("atomic output publication lock poisoned")
    }

    pub(crate) fn reset(&self) {
        crate::merge::atomic_derived_output::with_atomic_output_publish_lock(|| {
            let mut state = self.state.lock().expect("panorama service poisoned");
            for token in state.cancellations.values() {
                token.cancel();
            }
            state.generation = state
                .generation
                .checked_add(1)
                .expect("panorama generation exhausted");
            state.source_paths.clear();
            state.plan = None;
            state.result = None;
            state.save_in_flight = None;
            state.cancellations.clear();
        })
        .expect("atomic output publication lock poisoned");
    }
}

fn acquire_result<P, R: Clone>(state: &State<P, R>) -> Option<R> {
    state.result.clone()
}

fn reserve_save<P, R>(state: &mut State<P, R>) -> Result<PanoramaPlanHandle, &'static str> {
    if state.save_in_flight.is_some() {
        return Err("panorama_save_already_in_progress");
    }
    let handle = PanoramaPlanHandle(state.generation);
    state.save_in_flight = Some(handle);
    Ok(handle)
}

fn save_is_current<P, R>(state: &State<P, R>, handle: PanoramaPlanHandle) -> bool {
    state.generation == handle.0 && state.save_in_flight == Some(handle)
}

fn publish_plan<P, R>(
    state: &mut State<P, R>,
    handle: PanoramaPlanHandle,
    plan: P,
) -> Result<(), &'static str> {
    if state.generation != handle.0 {
        return Err("panorama_plan_stale_completion");
    }
    state.plan = Some(plan);
    state.save_in_flight = None;
    Ok(())
}

fn publish_result<P, R>(
    state: &mut State<P, R>,
    lease: &PanoramaAcceptedLease,
    result: R,
) -> Result<(), &'static str> {
    if !current(state, lease) {
        return Err("panorama_stitch_stale_completion");
    }
    state.result = Some(result);
    Ok(())
}

fn current<P, R>(state: &State<P, R>, lease: &PanoramaAcceptedLease) -> bool {
    same_identity(state, lease) && state.plan.is_some()
}

fn same_identity<P, R>(state: &State<P, R>, lease: &PanoramaAcceptedLease) -> bool {
    state.generation == lease.generation && state.source_paths == lease.source_paths
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, Barrier, Mutex},
        thread,
    };

    use super::*;

    #[cfg(feature = "tauri-test")]
    use tauri::{Manager, ipc::InvokeBody, webview::InvokeRequest};

    #[test]
    fn cancel_invalidates_generation_and_result_state() {
        let service = PanoramaService::default();
        let token = Arc::new(AlignmentCancellation::default());
        let handle = service.begin_plan(vec!["a".into(), "b".into()], "plan".into(), token);
        assert!(service.cancel("plan"));
        assert!(!service.cancel("plan"));
        assert!(!service.cancel("unknown"));
        assert_eq!(handle.0, 1);
        assert!(service.accepted(&["a".into(), "b".into()]).is_err());
    }

    #[test]
    fn source_identity_is_order_sensitive() {
        let state: State<(), Arc<()>> = State {
            generation: 3,
            source_paths: vec!["a".into(), "b".into()],
            plan: Some(()),
            ..State::default()
        };
        let exact = PanoramaAcceptedLease {
            generation: 3,
            source_paths: vec!["a".into(), "b".into()],
        };
        let reversed = PanoramaAcceptedLease {
            generation: 3,
            source_paths: vec!["b".into(), "a".into()],
        };
        assert!(current(&state, &exact));
        assert!(!same_identity(&state, &reversed));
    }

    #[test]
    fn reordered_plan_handles_make_predecessor_stale() {
        let service = PanoramaService::default();
        let first = service.begin_plan(
            vec!["a".into(), "b".into()],
            "first".into(),
            Arc::new(AlignmentCancellation::default()),
        );
        let second = service.begin_plan(
            vec!["c".into(), "d".into()],
            "second".into(),
            Arc::new(AlignmentCancellation::default()),
        );
        let state = service.state.lock().unwrap();
        assert_ne!(state.generation, first.0);
        assert_eq!(state.generation, second.0);
    }

    #[test]
    fn stale_plan_completion_after_replan_is_rejected() {
        let mut state: State<(), Arc<()>> = State {
            generation: 2,
            source_paths: vec!["new-a".into(), "new-b".into()],
            ..State::default()
        };

        assert_eq!(
            publish_plan(&mut state, PanoramaPlanHandle(1), ()),
            Err("panorama_plan_stale_completion")
        );
        assert!(state.plan.is_none());
    }

    #[test]
    fn stale_render_completion_after_replan_or_cancel_is_rejected() {
        let lease = PanoramaAcceptedLease {
            generation: 1,
            source_paths: vec!["a".into(), "b".into()],
        };
        let mut state: State<(), Arc<()>> = State {
            generation: 2,
            source_paths: vec!["c".into(), "d".into()],
            plan: Some(()),
            ..State::default()
        };

        assert_eq!(
            publish_result(&mut state, &lease, Arc::new(())),
            Err("panorama_stitch_stale_completion")
        );
        assert!(state.result.is_none());
    }

    #[test]
    fn failed_save_snapshot_is_non_consuming_and_retryable() {
        let result = Arc::new(());
        let state: State<(), Arc<()>> = State {
            generation: 1,
            source_paths: vec!["a".into(), "b".into()],
            plan: Some(()),
            result: Some(Arc::clone(&result)),
            ..State::default()
        };

        let first = acquire_result(&state).unwrap();
        drop(first);
        let retry = acquire_result(&state).unwrap();
        assert!(Arc::ptr_eq(&result, &retry));
    }

    #[test]
    fn concurrent_save_reservations_admit_exactly_one_owner() {
        let state = Arc::new(Mutex::new(State::<(), Arc<()>> {
            generation: 9,
            plan: Some(()),
            result: Some(Arc::new(())),
            ..State::default()
        }));
        let barrier = Arc::new(Barrier::new(3));
        let workers = (0..2)
            .map(|_| {
                let state = Arc::clone(&state);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    reserve_save(&mut state.lock().expect("save state"))
                })
            })
            .collect::<Vec<_>>();

        barrier.wait();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().expect("save reservation worker"))
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter_map(|result| result.err())
                .collect::<Vec<_>>(),
            vec!["panorama_save_already_in_progress"]
        );
    }

    #[test]
    fn failed_save_drop_releases_owner_for_retry() {
        let service = Arc::new(PanoramaService::default());
        let handle = PanoramaPlanHandle(7);
        {
            let mut state = service.state.lock().unwrap();
            state.generation = handle.0;
            state.save_in_flight = Some(handle);
        }
        let failed_attempt = PanoramaSaveLease {
            service: Arc::downgrade(&service),
            handle,
            completed: false,
        };

        drop(failed_attempt);

        let mut state = service.state.lock().unwrap();
        assert_eq!(reserve_save(&mut state), Ok(handle));
    }

    #[test]
    fn successor_plan_winning_publication_race_invalidates_save_owner() {
        let service = Arc::new(PanoramaService::default());
        let stale_handle = PanoramaPlanHandle(1);
        {
            let mut state = service.state.lock().unwrap();
            state.generation = stale_handle.0;
            state.save_in_flight = Some(stale_handle);
        }
        let stale_save = PanoramaSaveLease {
            service: Arc::downgrade(&service),
            handle: stale_handle,
            completed: false,
        };

        let successor = service.begin_plan(
            vec!["new-a".into(), "new-b".into()],
            "successor".into(),
            Arc::new(AlignmentCancellation::default()),
        );

        assert_eq!(successor, PanoramaPlanHandle(2));
        assert_eq!(
            stale_save.authorize_publication(),
            Err("panorama_save_stale_completion".to_string())
        );
    }

    #[test]
    fn cancel_winning_publication_race_invalidates_save_owner() {
        let service = Arc::new(PanoramaService::default());
        let handle = service.begin_plan(
            vec!["a".into(), "b".into()],
            "render".into(),
            Arc::new(AlignmentCancellation::default()),
        );
        service.state.lock().unwrap().save_in_flight = Some(handle);
        let stale_save = PanoramaSaveLease {
            service: Arc::downgrade(&service),
            handle,
            completed: false,
        };

        assert!(service.cancel("render"));
        assert_eq!(
            stale_save.authorize_publication(),
            Err("panorama_save_stale_completion".to_string())
        );
    }

    #[test]
    fn new_plan_winning_final_publish_race_invalidates_save_lease() {
        let lease = PanoramaAcceptedLease {
            generation: 4,
            source_paths: vec!["a".into(), "b".into()],
        };
        let state: State<(), Arc<()>> = State {
            generation: 5,
            source_paths: vec!["c".into(), "d".into()],
            plan: Some(()),
            ..State::default()
        };

        assert!(!current(&state, &lease));
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn ipc_cancel_routes_through_panorama_service() {
        let app = tauri::test::mock_builder()
            .manage(crate::app_state::AppState::new())
            .invoke_handler(tauri::generate_handler![
                super::super::cancel_panorama_alignment
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let state = app.state::<crate::app_state::AppState>();
        state.services.panorama.begin_plan(
            vec!["a".into(), "b".into()],
            "ipc-cancel".into(),
            Arc::new(AlignmentCancellation::default()),
        );

        tauri::test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "cancel_panorama_alignment".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(serde_json::json!({"cancellationId":"ipc-cancel"})),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .expect("panorama cancel IPC response");

        assert!(!state.services.panorama.cancel("ipc-cancel"));
    }
}
