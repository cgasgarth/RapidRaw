use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerspectiveAnalysisResult {
    pub(crate) analysis: crate::geometry::perspective::PerspectiveAnalysisV1,
    pub(crate) receipt: crate::geometry::perspective::PerspectiveCorrectionReceiptV1,
}

#[tauri::command]
pub(crate) fn analyze_perspective_correction(
    adjustments: serde_json::Value,
    settings: crate::geometry::perspective::PerspectiveCorrectionSettingsV1,
    state: tauri::State<AppState>,
) -> Result<PerspectiveAnalysisResult, String> {
    let loaded = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "perspective.no_loaded_image".to_string())?;
    let orientation = adjustments
        .get("orientationSteps")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default();
    let lens_contract = serde_json::to_string(
        adjustments
            .get("lensDistortionParams")
            .unwrap_or(&serde_json::Value::Null),
    )
    .unwrap_or_default();
    let identity = crate::geometry::perspective::PerspectiveAnalysisIdentityV1 {
        source_revision: loaded.artifact_source.source_fingerprint(),
        orientation_fingerprint: crate::render::artifact_identity::stable_hash(&orientation),
        lens_geometry_fingerprint: crate::render::artifact_identity::stable_hash(&lens_contract),
        analysis_dimensions: [0, 0],
        implementation_version: crate::geometry::perspective::PERSPECTIVE_IMPLEMENTATION_VERSION_V1,
    };
    let analysis = crate::geometry::perspective::analyze_perspective(&loaded.image, identity);
    let receipt =
        crate::geometry::perspective::compile_perspective_plan_with_analysis(&settings, &analysis)?;
    Ok(PerspectiveAnalysisResult { analysis, receipt })
}
