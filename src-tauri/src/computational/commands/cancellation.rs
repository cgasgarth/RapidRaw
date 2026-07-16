use crate::app_state::AppState;

#[tauri::command]
pub(crate) fn cancel_hdr_plan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.computational().cancel_hdr_plan();
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_focus_stack_plan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.computational().cancel_focus_stack_plan();
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_super_resolution_registration(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.computational().cancel_super_resolution_registration()
}

#[tauri::command]
pub(crate) fn cancel_panorama_alignment(
    cancellation_id: String,
    state: tauri::State<'_, AppState>,
) -> bool {
    state
        .computational()
        .cancel_panorama_alignment(&cancellation_id)
}

#[tauri::command]
pub(crate) fn cancel_computational_merge_job(
    job_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    state.computational().cancel_merge_job(job_id)
}

#[cfg(all(test, feature = "tauri-test"))]
mod tests {
    use std::sync::Arc;

    use serde_json::{Value, json};
    use tauri::{Manager, ipc::InvokeBody, webview::InvokeRequest};

    use super::*;
    use crate::merge::computational_job::ComputationalMergeFamily;
    use crate::merge::panorama_utils::alignment_plan::AlignmentCancellation;

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

    #[test]
    fn exact_ipc_contract_routes_the_complete_cancellation_family_through_the_facade() {
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .invoke_handler(tauri::generate_handler![
                cancel_hdr_plan,
                cancel_focus_stack_plan,
                cancel_super_resolution_registration,
                cancel_panorama_alignment,
                cancel_computational_merge_job,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let state = app.state::<AppState>();
        let hdr = state.computational().hdr().begin();
        let focus = state.computational().focus_stack().begin();
        let burst = state.computational().burst_sr().begin_plan();
        let burst_job = state
            .computational()
            .jobs()
            .begin(ComputationalMergeFamily::SuperResolution, "register", 1, 1)
            .unwrap();
        let explicit_job = state
            .computational()
            .jobs()
            .begin(ComputationalMergeFamily::FocusStack, "merge", 1, 1)
            .unwrap();
        let panorama = Arc::new(AlignmentCancellation::default());
        state.computational().panorama().begin_plan(
            vec!["a.raw".into(), "b.raw".into()],
            "panorama-cancel".into(),
            Arc::clone(&panorama),
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
                json!({ "cancellationId": "panorama-cancel" }),
                6,
            ),
            Value::Bool(true)
        );
        assert_eq!(
            invoke(
                &webview,
                "cancel_computational_merge_job",
                json!({ "jobId": explicit_job.job_id.to_string() }),
                8,
            ),
            Value::Bool(true)
        );

        assert!(!state.computational().hdr().is_current(hdr));
        assert!(!state.computational().focus_stack().is_current(focus));
        assert!(!state.computational().burst_sr().is_current(burst));
        assert!(burst_job.cancellation_token.checkpoint().is_err());
        assert!(explicit_job.cancellation_token.checkpoint().is_err());
        assert!(panorama.check("IPC cancellation family proof").is_err());
    }
}
