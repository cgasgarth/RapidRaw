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
    let service = state.computational().focus_stack();
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
