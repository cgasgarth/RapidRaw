mod inference;
mod model;
mod preprocess;
mod review;

use std::io::Cursor;
use std::path::PathBuf;

use base64::{Engine, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageFormat, Rgb32FImage};
use serde::{Deserialize, Serialize};

use crate::app_state::AppState;
use crate::merge::computational_job::ComputationalMergeFamily;

use self::inference::{OrtSwinIrRunner, run_tiled_x2};
use self::model::{SwinIrCapability, capability};
use self::preprocess::{
    apply_highlight_safe_residual, bicubic_scene_linear_x2, scene_linear_to_encoded_srgb,
};
use self::review::{SingleImageX2Review, build_review};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SingleImageX2PreviewRequest {
    pub source_path: String,
    pub graph_revision: String,
    pub memory_budget_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleImageX2Preview {
    pub schema_version: u32,
    pub job_id: String,
    pub source_path: String,
    pub graph_revision: String,
    pub width: u32,
    pub height: u32,
    pub ai_preview_data_url: String,
    pub bicubic_preview_data_url: String,
    pub review: SingleImageX2Review,
    pub apply_status: &'static str,
    pub derivative_kind: &'static str,
}

#[tauri::command]
pub fn get_single_image_x2_capability() -> SwinIrCapability {
    capability(
        std::env::var_os("RAWENGINE_SWINIR_X2_MODEL_PATH")
            .map(PathBuf::from)
            .as_deref(),
    )
}

#[tauri::command]
pub async fn preview_single_image_x2(
    request: SingleImageX2PreviewRequest,
    state: tauri::State<'_, AppState>,
) -> Result<SingleImageX2Preview, String> {
    let model_path = std::env::var_os("RAWENGINE_SWINIR_X2_MODEL_PATH")
        .map(PathBuf::from)
        .ok_or_else(|| "swinir_x2_disabled_weight_redistribution_unverified".to_string())?;
    model::verify_provisioned_model(&model_path)?;
    let frame = current_frame(&state, &request)?;
    let source = frame.image.to_rgb32f();
    let tile_count =
        inference::tile_count(source.width(), source.height(), request.memory_budget_bytes)?;
    let job = state.computational_merge_jobs.begin(
        ComputationalMergeFamily::SuperResolution,
        "single_image_x2_inference",
        tile_count,
        tile_count,
    )?;
    let job_id = job.job_id.to_string();
    let token = job.cancellation_token.clone();
    let graph_revision = request.graph_revision.clone();
    let source_path = request.source_path.clone();
    let model_path_for_run = model_path.clone();
    let memory_budget = request.memory_budget_bytes;
    let result = tokio::task::spawn_blocking(move || {
        let mut runner = OrtSwinIrRunner::open(&model_path_for_run)?;
        let encoded = scene_linear_to_encoded_srgb(&source);
        let ai_encoded = run_tiled_x2(&encoded, memory_budget, &token, &mut runner)?;
        let baseline = bicubic_scene_linear_x2(&source);
        let output = apply_highlight_safe_residual(&source, &baseline, &ai_encoded);
        let review = build_review(
            &source,
            &baseline,
            &output,
            &ai_encoded,
            &model_path_for_run,
        )?;
        Ok::<_, String>((baseline, output, review))
    })
    .await
    .map_err(|error| format!("single_image_x2_worker_failed:{error}"))?;

    let (baseline, output, review) = match result {
        Ok(value) => value,
        Err(error) => {
            let _ = state.computational_merge_jobs.fail(&job.job_id);
            return Err(error);
        }
    };
    job.cancellation_token.checkpoint()?;
    current_frame(&state, &request)?;
    if !state.computational_merge_jobs.finish(&job.job_id)? {
        return Err("single_image_x2_cancelled_before_publish".to_string());
    }
    Ok(SingleImageX2Preview {
        schema_version: 1,
        job_id,
        source_path,
        graph_revision,
        width: output.width(),
        height: output.height(),
        ai_preview_data_url: png_data_url(&output)?,
        bicubic_preview_data_url: png_data_url(&baseline)?,
        review,
        apply_status: "durable_commit_pending",
        derivative_kind: "rendered_rgb_ai_derivative",
    })
}

#[tauri::command]
pub fn cancel_single_image_x2_preview(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    state
        .computational_merge_jobs
        .cancel_active_family(ComputationalMergeFamily::SuperResolution)
}

fn current_frame(
    state: &AppState,
    request: &SingleImageX2PreviewRequest,
) -> Result<crate::app_state::CachedViewerSampleFrame, String> {
    let frames = state
        .viewer_sample_frames
        .lock()
        .map_err(|_| "single_image_x2_viewer_cache_unavailable".to_string())?;
    let frame = frames
        .get(&request.graph_revision)
        .ok_or_else(|| "single_image_x2_stale_graph_revision".to_string())?;
    if frame.image_identity != request.source_path || frame.graph_revision != request.graph_revision
    {
        return Err("single_image_x2_stale_source".to_string());
    }
    if frame.space_label != "scene_linear_srgb" {
        return Err(format!(
            "single_image_x2_unsupported_working_space:{}",
            frame.space_label
        ));
    }
    Ok(frame.clone())
}

fn png_data_url(image: &Rgb32FImage) -> Result<String, String> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgb32F(image.clone())
        .to_rgb8()
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|error| format!("single_image_x2_png_encode_failed:{error}"))?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    ))
}
