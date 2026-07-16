use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct ComputationalRuntimeService {
    denoise: Arc<super::denoise_service::EnhancedDenoiseService>,
    focus_stack: Arc<crate::merge::focus_stack::planning_service::FocusStackPlanningService>,
    focus_stack_results: Arc<crate::merge::focus_stack::job::FocusStackResultService>,
    jobs: Arc<crate::app::services::JobCoordinator>,
    hdr: Arc<crate::merge::hdr::planning_service::HdrPlanningService>,
    burst_sr: Arc<crate::merge::super_resolution::planning_service::BurstSrPlanningService>,
    panorama: Arc<crate::merge::panorama_stitching::service::PanoramaService>,
}

impl ComputationalRuntimeService {
    pub(crate) fn new(jobs: Arc<crate::app::services::JobCoordinator>) -> Self {
        Self {
            denoise: Arc::default(),
            focus_stack: Arc::default(),
            focus_stack_results: Arc::default(),
            jobs,
            hdr: Arc::default(),
            burst_sr: Arc::default(),
            panorama: Arc::default(),
        }
    }

    pub(crate) fn denoise(&self) -> &Arc<super::denoise_service::EnhancedDenoiseService> {
        &self.denoise
    }

    pub(crate) fn focus_stack(
        &self,
    ) -> &Arc<crate::merge::focus_stack::planning_service::FocusStackPlanningService> {
        &self.focus_stack
    }

    pub(crate) fn focus_stack_results(
        &self,
    ) -> &Arc<crate::merge::focus_stack::job::FocusStackResultService> {
        &self.focus_stack_results
    }

    pub(crate) fn jobs(&self) -> &crate::app::services::JobCoordinator {
        self.jobs.as_ref()
    }

    pub(crate) fn hdr(&self) -> &Arc<crate::merge::hdr::planning_service::HdrPlanningService> {
        &self.hdr
    }

    pub(crate) fn burst_sr(
        &self,
    ) -> &Arc<crate::merge::super_resolution::planning_service::BurstSrPlanningService> {
        &self.burst_sr
    }

    pub(crate) fn panorama(
        &self,
    ) -> &Arc<crate::merge::panorama_stitching::service::PanoramaService> {
        &self.panorama
    }

    pub(crate) fn cancel_hdr_plan(&self) {
        self.hdr.cancel();
        let _ = self
            .jobs
            .cancel_active_family(crate::merge::computational_job::ComputationalMergeFamily::Hdr);
    }

    pub(crate) fn cancel_focus_stack_plan(&self) {
        self.focus_stack.cancel();
    }

    pub(crate) fn cancel_super_resolution_registration(&self) -> Result<(), String> {
        self.burst_sr.cancel();
        self.jobs
            .cancel_active_family(
                crate::merge::computational_job::ComputationalMergeFamily::SuperResolution,
            )
            .map(|_| ())
    }

    pub(crate) fn cancel_panorama_alignment(&self, cancellation_id: &str) -> bool {
        self.panorama.cancel(cancellation_id)
    }

    pub(crate) fn cancel_merge_job(&self, job_id: String) -> Result<bool, String> {
        self.jobs
            .cancel(&crate::merge::computational_job::ComputationalMergeJobId::from_string(job_id))
    }
}

impl Default for ComputationalRuntimeService {
    fn default() -> Self {
        Self::new(Arc::default())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    #[test]
    fn forced_concurrent_supersession_rejects_stale_focus_and_sr_without_cross_family_mutation() {
        let services = Arc::new(ComputationalRuntimeService::default());
        let stale_focus = services.focus_stack().begin();
        let stale_sr = services.burst_sr().begin_plan();
        let stale_hdr = services.hdr().begin();
        let barrier = Arc::new(Barrier::new(4));

        let focus_worker = {
            let barrier = Arc::clone(&barrier);
            let services = Arc::clone(&services);
            thread::spawn(move || {
                barrier.wait();
                let successor = services.focus_stack().begin();
                barrier.wait();
                let stale_completion = services.focus_stack().complete(stale_focus, None);
                (successor, stale_completion)
            })
        };
        let sr_worker = {
            let barrier = Arc::clone(&barrier);
            let services = Arc::clone(&services);
            thread::spawn(move || {
                barrier.wait();
                let successor = services.burst_sr().begin_plan();
                barrier.wait();
                let stale_completion = services.burst_sr().complete_plan(stale_sr, None);
                (successor, stale_completion)
            })
        };
        let hdr_worker = {
            let barrier = Arc::clone(&barrier);
            let services = Arc::clone(&services);
            thread::spawn(move || {
                barrier.wait();
                let successor = services.hdr().begin();
                barrier.wait();
                (successor, services.hdr().is_current(stale_hdr))
            })
        };

        barrier.wait();
        barrier.wait();
        let (focus, focus_stale_completion) = focus_worker.join().unwrap();
        let (sr, sr_stale_completion) = sr_worker.join().unwrap();
        let (hdr, hdr_stale_current) = hdr_worker.join().unwrap();

        assert_eq!(
            focus_stale_completion,
            Err("focus_stack_plan_cancelled:plan_publication")
        );
        assert_eq!(
            sr_stale_completion,
            Err("super_resolution_registration_stale_completion")
        );
        assert!(!hdr_stale_current);
        assert!(services.focus_stack().is_current(focus));
        assert!(services.burst_sr().is_current(sr));
        assert!(services.hdr().is_current(hdr));
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn production_cancel_commands_resolve_through_computational_capability() {
        use crate::merge::computational_job::ComputationalMergeFamily;
        use crate::merge::panorama_utils::alignment_plan::AlignmentCancellation;
        use serde_json::{Value, json};
        use tauri::{Manager, ipc::InvokeBody, webview::InvokeRequest};

        fn invoke(
            webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
            command: &str,
            body: Value,
            callback: u32,
        ) -> Value {
            tauri::test::get_ipc_response(
                webview,
                InvokeRequest {
                    cmd: command.into(),
                    callback: tauri::ipc::CallbackFn(callback),
                    error: tauri::ipc::CallbackFn(callback + 1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .unwrap_or_else(|error| panic!("{command} IPC failed: {error}"))
            .deserialize()
            .unwrap()
        }

        let app = tauri::test::mock_builder()
            .manage(crate::AppState::new())
            .invoke_handler(tauri::generate_handler![
                crate::computational::commands::cancellation::cancel_hdr_plan,
                crate::computational::commands::cancellation::cancel_focus_stack_plan,
                crate::computational::commands::cancellation::cancel_super_resolution_registration,
                crate::computational::commands::cancellation::cancel_panorama_alignment,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let state = app.state::<crate::AppState>();
        let hdr = state.computational().hdr().begin();
        let focus = state.computational().focus_stack().begin();
        let sr = state.computational().burst_sr().begin_plan();
        let sr_job = state
            .computational()
            .jobs()
            .begin(ComputationalMergeFamily::SuperResolution, "register", 1, 1)
            .unwrap();
        let panorama_cancellation = Arc::new(AlignmentCancellation::default());
        state.computational().panorama().begin_plan(
            vec!["a.raw".into(), "b.raw".into()],
            "facade-panorama".into(),
            Arc::clone(&panorama_cancellation),
        );

        assert_eq!(
            invoke(&webview, "cancel_hdr_plan", json!({}), 0),
            Value::Null
        );
        assert_eq!(
            invoke(&webview, "cancel_focus_stack_plan", json!({}), 2),
            Value::Null
        );
        assert_eq!(
            invoke(
                &webview,
                "cancel_super_resolution_registration",
                json!({}),
                4,
            ),
            Value::Null
        );
        assert_eq!(
            invoke(
                &webview,
                "cancel_panorama_alignment",
                json!({ "cancellationId": "facade-panorama" }),
                6,
            ),
            Value::Bool(true)
        );

        assert!(!state.computational().hdr().is_current(hdr));
        assert!(!state.computational().focus_stack().is_current(focus));
        assert!(!state.computational().burst_sr().is_current(sr));
        assert!(sr_job.cancellation_token.checkpoint().is_err());
        assert!(panorama_cancellation.check("facade proof").is_err());
    }
}
