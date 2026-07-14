use crate::app_state::AppState;
use crate::file_management::parse_virtual_path;

use super::candidate::AcceptedFocusRuntime;
use super::planning_service::AcceptedFocusPlan;
use super::{FocusStackInputPlan, FocusStackReadinessSettings, build_input_plan};

#[tauri::command]
pub(crate) async fn plan_focus_stack(
    paths: Vec<String>,
    ordered_source_ids: Vec<String>,
    graph_revisions: Vec<String>,
    settings: FocusStackReadinessSettings,
    state: tauri::State<'_, AppState>,
) -> Result<FocusStackInputPlan, String> {
    let service = &state.services.focus_stack;
    let generation = service.begin();
    let resolved_paths = paths
        .iter()
        .map(|path| parse_virtual_path(path).0.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let plan = build_input_plan(
        &resolved_paths,
        &ordered_source_ids,
        &graph_revisions,
        settings,
        || !service.is_current(generation),
    )?;
    let accepted = plan.accepted.then(|| {
        (
            AcceptedFocusPlan {
                plan_id: plan.accepted_dry_run_plan_id.clone(),
                plan_hash: plan.accepted_dry_run_plan_hash.clone(),
            },
            AcceptedFocusRuntime {
                identity: plan.candidate_identity(),
                paths: resolved_paths,
            },
        )
    });
    service
        .complete(generation, accepted)
        .map_err(str::to_string)?;
    Ok(plan)
}

#[tauri::command]
pub(crate) async fn cancel_focus_stack_plan(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.services.focus_stack.cancel();
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "tauri-test")]
    use tauri::{Manager, ipc::InvokeBody, webview::InvokeRequest};

    #[cfg(feature = "tauri-test")]
    use super::*;

    #[cfg(feature = "tauri-test")]
    #[test]
    fn ipc_cancel_invalidates_the_active_focus_plan_generation() {
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .invoke_handler(tauri::generate_handler![cancel_focus_stack_plan])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let state = app.state::<AppState>();
        let generation = state.services.focus_stack.begin();

        tauri::test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "cancel_focus_stack_plan".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .expect("focus cancellation IPC response");

        assert!(!state.services.focus_stack.is_current(generation));
        assert!(
            state
                .services
                .focus_stack
                .accepted_plan()
                .unwrap()
                .is_none()
        );
    }
}
