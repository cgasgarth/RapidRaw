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

    let service = state.computational().hdr();
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
