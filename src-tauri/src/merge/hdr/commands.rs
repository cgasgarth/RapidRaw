use crate::app_state::AppState;

use super::planning_service::PendingHdrMergePlan;
use super::{ALIGNMENT_POLICY_ID, HdrAlignmentPlanResponse, build_alignment_plan};

#[tauri::command]
pub(crate) async fn plan_hdr(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<HdrAlignmentPlanResponse, String> {
    if paths.len() < 2 {
        return Err("Please select at least two images to merge.".to_string());
    }

    let service = &state.services.hdr;
    let handle = service.begin();
    let response = build_alignment_plan(&paths, || !service.is_current(handle))?;
    let plan = PendingHdrMergePlan {
        accepted_dry_run_plan_hash: response.accepted_dry_run_plan_hash.clone(),
        accepted_dry_run_plan_id: response.accepted_dry_run_plan_id.clone(),
        alignment_policy_id: ALIGNMENT_POLICY_ID.to_string(),
        source_content_hashes: response
            .sources
            .iter()
            .map(|source| source.frame.content_hash.clone())
            .collect(),
        source_paths: paths,
        static_radiance_hash: Some(response.static_radiance_preview.radiance_hash.clone()),
        deghost_radiance_hash: Some(response.deghost_preview.radiance_hash.clone()),
        motion_probability_hash: Some(response.deghost_preview.motion_probability_hash.clone()),
        ownership_hash: Some(response.deghost_preview.ownership_hash.clone()),
        feather_hash: Some(response.deghost_preview.feather_hash.clone()),
        unresolved_fraction: Some(response.deghost_preview.unresolved_fraction),
        planned_sources: response.sources.clone(),
        motion_probability_bytes: Vec::new(),
        ownership_bytes: Vec::new(),
        feather_bytes: Vec::new(),
        scene_linear_artifact_hash: None,
        tone_mapped_preview_hash: None,
        motion_coverage: None,
        confidence_mean: None,
    };
    service
        .complete_plan(handle, plan)
        .map_err(str::to_string)?;
    Ok(response)
}

#[tauri::command]
pub(crate) async fn cancel_hdr_plan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.services.hdr.cancel();
    let _ = state
        .computational_merge_jobs
        .cancel_active_family(crate::merge::computational_job::ComputationalMergeFamily::Hdr);
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
    fn ipc_cancel_invalidates_the_active_hdr_plan_generation() {
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .invoke_handler(tauri::generate_handler![cancel_hdr_plan])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let state = app.state::<AppState>();
        let handle = state.services.hdr.begin();

        tauri::test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "cancel_hdr_plan".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .expect("HDR cancellation IPC response");

        assert!(!state.services.hdr.is_current(handle));
        assert!(state.services.hdr.accepted_plan().is_err());
    }
}
