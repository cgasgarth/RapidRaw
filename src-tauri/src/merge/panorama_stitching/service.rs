use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
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
    pub lease: PanoramaAcceptedLease,
    pub pending: Arc<PendingPanoramaResult>,
}

struct State<P = PanoramaPlanResult, R = Arc<PendingPanoramaResult>> {
    generation: u64,
    source_paths: Vec<String>,
    plan: Option<P>,
    result: Option<R>,
    cancellations: HashMap<String, Arc<AlignmentCancellation>>,
}

impl<P, R> Default for State<P, R> {
    fn default() -> Self {
        Self {
            generation: 0,
            source_paths: Vec::new(),
            plan: None,
            result: None,
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
        publish_result(&mut state, lease, Arc::new(result))
    }

    pub(crate) fn fail_render(&self, cancellation_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.cancellations.remove(cancellation_id);
        }
    }

    pub(crate) fn acquire_save(&self) -> Result<PanoramaSavePayload, &'static str> {
        let state = self
            .state
            .lock()
            .map_err(|_| "panorama_state_unavailable")?;
        let pending = acquire_result(&state).ok_or(
            "No panorama image found in memory to save. It might have already been saved.",
        )?;
        Ok(PanoramaSavePayload {
            lease: PanoramaAcceptedLease {
                generation: state.generation,
                source_paths: state.source_paths.clone(),
            },
            pending,
        })
    }

    pub(crate) fn authorize(&self, lease: &PanoramaAcceptedLease) -> Result<(), String> {
        self.state
            .lock()
            .is_ok_and(|state| current(&state, lease))
            .then_some(())
            .ok_or_else(|| "panorama_save_stale_completion".to_string())
    }

    pub(crate) fn complete_save(&self, lease: &PanoramaAcceptedLease) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if !current(&state, lease) {
            return false;
        }
        state.result = None;
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
            state.cancellations.clear();
        })
        .expect("atomic output publication lock poisoned");
    }
}

fn acquire_result<P, R: Clone>(state: &State<P, R>) -> Option<R> {
    state.result.clone()
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
