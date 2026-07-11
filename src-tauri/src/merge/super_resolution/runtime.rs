use std::sync::atomic::AtomicBool;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::{ColorType, ImageEncoder, codecs::png::PngEncoder};
use serde::Serialize;
use serde_json::json;

use crate::app_state::AppState;
use crate::merge::computational_job::ComputationalMergeFamily;
use crate::merge::derived_output_provenance::stable_hash;

use super::raw_frame::{
    SR_BAYER_INTAKE_ALGORITHM_ID, SuperResolutionBayerBurstSource, SuperResolutionRawFrame,
    SuperResolutionReadinessSettings, check_cancel, decode_bayer_burst_frame,
};
use super::registration::{SuperResolutionRegistrationResult, solve_global_se2_registration};
use super::{
    cfa_observations::common_overlap,
    fallback::compose_reference_fallback,
    fused_color::reconstruct_color,
    motion::{RegionEvidence, classify_regions},
    quality::{QualityDecision, evaluate},
    raw_frame::CfaClass,
    reconstruction::{OutputTile, SR_RECONSTRUCTION_ALGORITHM_ID, reconstruct_plane_tile},
    review::{class_overlay, strength_overlay},
    sharpen::sharpen_supported,
};

const SR_COLOR_ALGORITHM_ID: &str = "support_aware_post_fusion_rgb_v1";
const MAX_ARTIFACT_DIMENSION: u32 = 640;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionNativeArtifact {
    pub content_hash: String,
    pub data_url: String,
    pub height: u32,
    pub width: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionPlaneArtifact {
    pub average_outlier_ratio: f32,
    pub average_variance: f32,
    pub class: &'static str,
    pub contributing_source_mask: u8,
    pub coverage_ratio: f32,
    pub residual: SuperResolutionNativeArtifact,
    pub support: SuperResolutionNativeArtifact,
    pub weak_support_ratio: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionReconstructionResult {
    pub algorithm_id: &'static str,
    pub capability: &'static str,
    pub color_algorithm_id: &'static str,
    pub decision: &'static str,
    pub fallback_ratio: f32,
    pub fallback_algorithm_id: &'static str,
    pub fallback_composited: SuperResolutionNativeArtifact,
    pub final_preview: SuperResolutionNativeArtifact,
    pub green_phase_gain: SuperResolutionGreenPhaseGain,
    pub height: u32,
    pub plane_artifacts: Vec<SuperResolutionPlaneArtifact>,
    pub policy_hash: String,
    pub preview: SuperResolutionNativeArtifact,
    pub quality: QualityDecision,
    pub reference_baseline: SuperResolutionNativeArtifact,
    pub region_artifact: SuperResolutionNativeArtifact,
    pub regions: Vec<RegionEvidence>,
    pub motion_algorithm_id: &'static str,
    pub registration_plan_hash: String,
    pub sharpening_artifact: SuperResolutionNativeArtifact,
    pub sharpening_algorithm_id: &'static str,
    pub unsharpened_preview: SuperResolutionNativeArtifact,
    pub width: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionGreenPhaseGain {
    pub accepted: bool,
    pub gain: f32,
    pub residual: f32,
    pub sample_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionBayerBurstIntake {
    pub algorithm_id: &'static str,
    pub calibration_consistent: bool,
    pub source_count: usize,
    pub sources: Vec<SuperResolutionBayerBurstSource>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionDryRunPlan {
    pub accepted: bool,
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    pub block_codes: Vec<String>,
    pub intake: SuperResolutionBayerBurstIntake,
    pub registration: Option<SuperResolutionRegistrationResult>,
    pub registration_input_hash: String,
    pub reconstruction: Option<SuperResolutionReconstructionResult>,
    pub warning_codes: Vec<String>,
}

fn build_dry_run_plan(
    mut frames: Vec<SuperResolutionRawFrame>,
    settings: &SuperResolutionReadinessSettings,
    cancellation_token: &AtomicBool,
) -> Result<SuperResolutionDryRunPlan, String> {
    check_cancel(cancellation_token)?;
    let mut block_codes = settings_block_codes(settings);
    if frames.len() < 2 {
        block_codes.push("insufficient_sources".to_string());
    }
    if frames.windows(2).any(|pair| {
        pair[0].source.width != pair[1].source.width
            || pair[0].source.height != pair[1].source.height
            || pair[0].source.camera_make != pair[1].source.camera_make
            || pair[0].source.camera_model != pair[1].source.camera_model
            || pair[0].source.calibration.bayer_pattern != pair[1].source.calibration.bayer_pattern
            || pair[0].source.calibration.bits_per_sample
                != pair[1].source.calibration.bits_per_sample
            || pair[0].source.calibration_identity != pair[1].source.calibration_identity
    }) {
        block_codes.push("inconsistent_bayer_burst_calibration".to_string());
        for frame in &mut frames {
            frame
                .source
                .block_codes
                .push("inconsistent_bayer_burst_calibration".to_string());
        }
    }
    block_codes.sort();
    block_codes.dedup();
    let calibration_consistent = !block_codes
        .iter()
        .any(|code| code == "inconsistent_bayer_burst_calibration");
    let registration_input_hash = stable_hash(&json!({
        "algorithmId": SR_BAYER_INTAKE_ALGORITHM_ID,
        "proxy": {
            "algorithmId": super::raw_frame::SR_GREEN_PROXY_ALGORITHM_ID,
            "cropVersion": super::raw_frame::SR_PROXY_CROP_VERSION,
            "normalizationVersion": super::raw_frame::SR_PROXY_NORMALIZATION_VERSION,
        },
        "settings": settings,
        "sources": frames.iter().map(|frame| &frame.source).collect::<Vec<_>>(),
    }));
    let mut registration = None;
    if block_codes.is_empty() {
        let (result, registration_blocks) =
            solve_global_se2_registration(&frames, cancellation_token)?;
        block_codes.extend(registration_blocks);
        registration = Some(result);
    }
    block_codes.sort();
    block_codes.dedup();
    let intake = SuperResolutionBayerBurstIntake {
        algorithm_id: SR_BAYER_INTAKE_ALGORITHM_ID,
        calibration_consistent,
        source_count: frames.len(),
        sources: frames.iter().map(|frame| frame.source.clone()).collect(),
    };
    let plan_identity = json!({
        "blockCodes": block_codes,
        "intake": &intake,
        "registration": &registration,
        "registrationInputHash": &registration_input_hash,
        "settings": settings,
    });
    let plan_hash = stable_hash(&plan_identity);
    let plan_id = format!("super_resolution_registration_plan_{}", &plan_hash[7..23]);
    let reconstruction = if block_codes.is_empty() {
        let accepted_registration = registration
            .as_ref()
            .ok_or_else(|| "accepted_registration_missing".to_string())?;
        Some(build_reconstruction(
            &frames,
            accepted_registration,
            &plan_hash,
            cancellation_token,
        )?)
    } else {
        None
    };
    let mut warning_codes = vec!["quality_gate_pending".to_string()];
    if registration
        .as_ref()
        .is_some_and(|result| !result.excluded_sources.is_empty())
    {
        warning_codes.push("registration_excluded_sources".to_string());
    }
    if !block_codes.is_empty() {
        warning_codes.push("registration_not_accepted".to_string());
    }

    Ok(SuperResolutionDryRunPlan {
        accepted: block_codes.is_empty(),
        accepted_dry_run_plan_hash: plan_hash,
        accepted_dry_run_plan_id: plan_id,
        block_codes,
        intake,
        registration,
        registration_input_hash,
        reconstruction,
        warning_codes,
    })
}

fn build_reconstruction(
    frames: &[SuperResolutionRawFrame],
    registration: &SuperResolutionRegistrationResult,
    plan_hash: &str,
    cancellation_token: &AtomicBool,
) -> Result<SuperResolutionReconstructionResult, String> {
    check_cancel(cancellation_token)?;
    let overlap = common_overlap(frames, &registration.transforms)?;
    let full_width = overlap.width * 2;
    let full_height = overlap.height * 2;
    let scale = 1.0;
    let tile_width = full_width.min(MAX_ARTIFACT_DIMENSION);
    let tile_height = full_height.min(MAX_ARTIFACT_DIMENSION);
    let sampled_width = tile_width;
    let sampled_height = tile_height;
    let tile = OutputTile {
        height: sampled_height,
        width: sampled_width,
        x: (full_width - sampled_width) / 2,
        y: (full_height - sampled_height) / 2,
    };
    let classes = [
        (CfaClass::R, "R"),
        (CfaClass::G1, "G1"),
        (CfaClass::G2, "G2"),
        (CfaClass::B, "B"),
    ];
    let mut planes = Vec::with_capacity(4);
    for (class, _) in classes {
        planes.push(reconstruct_plane_tile(
            frames,
            &registration.transforms,
            overlap,
            class,
            tile,
            cancellation_token,
        )?);
    }
    let green_phase_gain = estimate_green_phase_gain(frames, registration);
    if green_phase_gain.accepted {
        for sample in &mut planes[2].estimates {
            sample.estimate *= green_phase_gain.gain;
            sample.residual *= green_phase_gain.gain;
            sample.variance *= green_phase_gain.gain * green_phase_gain.gain;
        }
    }
    check_cancel(cancellation_token)?;
    let reference = frames
        .iter()
        .find(|frame| frame.source.source_index == registration.reference_source_index)
        .ok_or_else(|| "registration_reference_identity_mismatch".to_string())?;
    let pixel_count = (tile_width * tile_height) as usize;
    let mut fused_linear = vec![[0.0; 3]; pixel_count];
    let mut baseline_linear = vec![[0.0; 3]; pixel_count];
    for preview_y in 0..tile_height {
        for preview_x in 0..tile_width {
            let source_x = ((preview_x as f32 * scale).floor() as u32).min(tile.width - 1);
            let source_y = ((preview_y as f32 * scale).floor() as u32).min(tile.height - 1);
            let sample_index = (source_y * tile.width + source_x) as usize;
            let baseline = baseline_rgb_at(reference, overlap, tile, source_x, source_y);
            let color = reconstruct_color(
                planes[0].estimates[sample_index],
                planes[1].estimates[sample_index],
                planes[2].estimates[sample_index],
                planes[3].estimates[sample_index],
                baseline,
                reference.source.calibration.white_balance,
            );
            fused_linear[sample_index] = if color.fallback { baseline } else { color.rgb };
            baseline_linear[sample_index] = baseline;
        }
    }
    check_cancel(cancellation_token)?;
    let registration_uncertainty = registration.summary.p95_residual_px.max(0.01);
    let analysis = classify_regions(&planes, registration_uncertainty);
    let (fallback_linear, fallback_ratio) = compose_reference_fallback(
        &fused_linear,
        &baseline_linear,
        &analysis.classes,
        tile_width,
        tile_height,
    );
    check_cancel(cancellation_token)?;
    let (final_linear, strengths) = sharpen_supported(
        &fallback_linear,
        &analysis.classes,
        &analysis.confidence,
        tile_width,
        tile_height,
    );
    let quality = evaluate(
        &baseline_linear,
        &fallback_linear,
        &final_linear,
        &analysis.classes,
        tile_width,
    );
    let rgb = encode_linear_image(&final_linear);
    let unsharpened_rgb = encode_linear_image(&fused_linear);
    let fallback_rgb = encode_linear_image(&fallback_linear);
    let baseline_rgb = encode_linear_image(&baseline_linear);
    let region_pixels = class_overlay(&analysis.classes);
    let sharpening_pixels = strength_overlay(&strengths);
    let mut plane_artifacts = Vec::with_capacity(4);
    for (plane_index, (_, label)) in classes.into_iter().enumerate() {
        debug_assert_eq!(planes[plane_index].width, tile.width);
        debug_assert_eq!(planes[plane_index].height, tile.height);
        let estimates = &planes[plane_index].estimates;
        let supported = estimates
            .iter()
            .filter(|sample| sample.support_class() == super::support::SupportClass::Supported)
            .count();
        let weak = estimates
            .iter()
            .filter(|sample| sample.support_class() == super::support::SupportClass::Weak)
            .count();
        let support_pixels = sample_map(
            estimates,
            tile.width,
            tile.height,
            tile_width,
            tile_height,
            scale,
            |sample| (sample.effective_samples / 4.0).clamp(0.0, 1.0),
        );
        let residual_pixels = sample_map(
            estimates,
            tile.width,
            tile.height,
            tile_width,
            tile_height,
            scale,
            |sample| (sample.residual * 8.0).clamp(0.0, 1.0),
        );
        plane_artifacts.push(SuperResolutionPlaneArtifact {
            average_outlier_ratio: estimates
                .iter()
                .map(|sample| sample.outlier_ratio)
                .sum::<f32>()
                / estimates.len().max(1) as f32,
            average_variance: estimates.iter().map(|sample| sample.variance).sum::<f32>()
                / estimates.len().max(1) as f32,
            class: label,
            contributing_source_mask: estimates
                .iter()
                .fold(0, |mask, sample| mask | sample.source_mask),
            coverage_ratio: supported as f32 / estimates.len().max(1) as f32,
            residual: encode_png_artifact(
                &residual_pixels,
                tile_width,
                tile_height,
                ColorType::L8,
            )?,
            support: encode_png_artifact(&support_pixels, tile_width, tile_height, ColorType::L8)?,
            weak_support_ratio: weak as f32 / estimates.len().max(1) as f32,
        });
    }
    Ok(SuperResolutionReconstructionResult {
        algorithm_id: SR_RECONSTRUCTION_ALGORITHM_ID,
        capability: "native_burst_cfa_preview",
        color_algorithm_id: SR_COLOR_ALGORITHM_ID,
        decision: quality.decision,
        fallback_ratio,
        fallback_algorithm_id: super::fallback::SR_FALLBACK_ALGORITHM_ID,
        fallback_composited: encode_png_artifact(
            &fallback_rgb,
            tile_width,
            tile_height,
            ColorType::Rgb8,
        )?,
        final_preview: encode_png_artifact(&rgb, tile_width, tile_height, ColorType::Rgb8)?,
        green_phase_gain,
        height: full_height,
        plane_artifacts,
        policy_hash: quality.policy_hash.clone(),
        preview: encode_png_artifact(&rgb, tile_width, tile_height, ColorType::Rgb8)?,
        quality,
        reference_baseline: encode_png_artifact(
            &baseline_rgb,
            tile_width,
            tile_height,
            ColorType::Rgb8,
        )?,
        region_artifact: encode_png_artifact(
            &region_pixels,
            tile_width,
            tile_height,
            ColorType::L8,
        )?,
        regions: analysis.regions,
        motion_algorithm_id: super::motion::SR_MOTION_ALGORITHM_ID,
        registration_plan_hash: plan_hash.to_string(),
        sharpening_artifact: encode_png_artifact(
            &sharpening_pixels,
            tile_width,
            tile_height,
            ColorType::L8,
        )?,
        sharpening_algorithm_id: super::sharpen::SR_SHARPEN_ALGORITHM_ID,
        unsharpened_preview: encode_png_artifact(
            &unsharpened_rgb,
            tile_width,
            tile_height,
            ColorType::Rgb8,
        )?,
        width: full_width,
    })
}

fn estimate_green_phase_gain(
    frames: &[SuperResolutionRawFrame],
    registration: &SuperResolutionRegistrationResult,
) -> SuperResolutionGreenPhaseGain {
    let mut g1_sum = 0.0f64;
    let mut g2_sum = 0.0f64;
    let mut g1_count = 0usize;
    let mut g2_count = 0usize;
    for frame in frames.iter().filter(|frame| {
        registration
            .selected_source_indexes
            .contains(&frame.source.source_index)
    }) {
        for index in 0..frame.sensor.values.len() {
            if !frame.sensor.valid[index] {
                continue;
            }
            match frame.sensor.classes[index] {
                CfaClass::G1 => {
                    g1_sum += frame.sensor.values[index] as f64;
                    g1_count += 1;
                }
                CfaClass::G2 => {
                    g2_sum += frame.sensor.values[index] as f64;
                    g2_count += 1;
                }
                _ => {}
            }
        }
    }
    let sample_count = g1_count.min(g2_count);
    if sample_count < 64 || g1_sum <= 0.0 || g2_sum <= 0.0 {
        return SuperResolutionGreenPhaseGain {
            accepted: false,
            gain: 1.0,
            residual: 1.0,
            sample_count,
        };
    }
    let g1_mean = g1_sum / g1_count as f64;
    let g2_mean = g2_sum / g2_count as f64;
    let gain = (g1_mean / g2_mean) as f32;
    let residual = ((g1_mean - g2_mean).abs() / g1_mean.max(g2_mean)) as f32;
    SuperResolutionGreenPhaseGain {
        accepted: (0.9..=1.1).contains(&gain) && residual <= 0.1,
        gain,
        residual,
        sample_count,
    }
}

fn baseline_rgb_at(
    frame: &SuperResolutionRawFrame,
    overlap: super::cfa_observations::SceneRect,
    tile: OutputTile,
    output_x: u32,
    output_y: u32,
) -> [f32; 3] {
    let sensor_x = (overlap.left + (tile.x + output_x) as f32 * 0.5)
        .floor()
        .clamp(0.0, frame.sensor.width.saturating_sub(1) as f32) as usize;
    let sensor_y = (overlap.top + (tile.y + output_y) as f32 * 0.5)
        .floor()
        .clamp(0.0, frame.sensor.height.saturating_sub(1) as f32) as usize;
    let mut channels = [0.0; 3];
    for y in sensor_y.saturating_sub(1)..=(sensor_y + 1).min(frame.sensor.height - 1) {
        for x in sensor_x.saturating_sub(1)..=(sensor_x + 1).min(frame.sensor.width - 1) {
            let index = y * frame.sensor.width + x;
            let channel = match frame.sensor.classes[index] {
                CfaClass::R => 0,
                CfaClass::B => 2,
                _ => 1,
            };
            channels[channel] = frame.sensor.values[index];
        }
    }
    channels
}

fn sample_map(
    estimates: &[super::support::SampleEstimate],
    source_width: u32,
    source_height: u32,
    width: u32,
    height: u32,
    scale: f32,
    value: impl Fn(super::support::SampleEstimate) -> f32,
) -> Vec<u8> {
    let mut pixels = vec![0; (width * height) as usize];
    for y in 0..height {
        for x in 0..width {
            let sx = ((x as f32 * scale).floor() as u32).min(source_width - 1);
            let sy = ((y as f32 * scale).floor() as u32).min(source_height - 1);
            pixels[(y * width + x) as usize] =
                (value(estimates[(sy * source_width + sx) as usize]) * 255.0).round() as u8;
        }
    }
    pixels
}

fn encode_display_rgb(output: &mut [u8], rgb: [f32; 3]) {
    for (target, value) in output.iter_mut().zip(rgb) {
        *target = (value.max(0.0).powf(1.0 / 2.2).min(1.0) * 255.0).round() as u8;
    }
}

fn encode_linear_image(pixels: &[[f32; 3]]) -> Vec<u8> {
    let mut output = vec![0; pixels.len() * 3];
    for (index, pixel) in pixels.iter().enumerate() {
        encode_display_rgb(&mut output[index * 3..index * 3 + 3], *pixel);
    }
    output
}

fn encode_png_artifact(
    pixels: &[u8],
    width: u32,
    height: u32,
    color: ColorType,
) -> Result<SuperResolutionNativeArtifact, String> {
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(pixels, width, height, color.into())
        .map_err(|error| format!("super_resolution_artifact_encode_failed:{error}"))?;
    let content_hash = format!("blake3:{}", blake3::hash(&bytes).to_hex());
    Ok(SuperResolutionNativeArtifact {
        content_hash,
        data_url: format!("data:image/png;base64,{}", BASE64.encode(bytes)),
        height,
        width,
    })
}

fn settings_block_codes(settings: &SuperResolutionReadinessSettings) -> Vec<String> {
    let mut codes = Vec::new();
    if settings.source_mode != "multi_image" {
        codes.push("unsupported_source_mode".to_string());
    }
    if settings.alignment_mode != "auto" && settings.alignment_mode != "translation" {
        codes.push("unsupported_alignment_model".to_string());
    }
    if (settings.output_scale - 2.0).abs() > f32::EPSILON {
        codes.push("unsupported_output_scale".to_string());
    }
    if settings.max_preview_dimension_px == 0 {
        codes.push("invalid_preview_dimension".to_string());
    }
    codes
}

pub async fn plan_super_resolution(
    paths: Vec<String>,
    settings: SuperResolutionReadinessSettings,
    state: tauri::State<'_, AppState>,
) -> Result<SuperResolutionDryRunPlan, String> {
    if !(2..=8).contains(&paths.len()) {
        return Err("super_resolution_source_count_out_of_range".to_string());
    }
    let job = state.computational_merge_jobs.begin(
        ComputationalMergeFamily::SuperResolution,
        "registration",
        paths.len() as u64,
        paths.len() as u64,
    )?;
    let task_token = job.cancellation_token.clone();
    let task = tokio::task::spawn_blocking(move || {
        let mut frames = Vec::with_capacity(paths.len());
        for (source_index, path) in paths.iter().enumerate() {
            task_token.checkpoint()?;
            frames.push(decode_bayer_burst_frame(
                path,
                source_index,
                settings.max_preview_dimension_px,
                task_token.atomic_flag(),
            )?);
        }
        build_dry_run_plan(frames, &settings, task_token.atomic_flag())
    });
    let result = task
        .await
        .map_err(|error| format!("super_resolution_registration_task_failed:{error}"))
        .and_then(|result| result);
    if result.is_ok() {
        state.computational_merge_jobs.finish(&job.job_id)?;
    } else {
        state.computational_merge_jobs.fail(&job.job_id)?;
    }
    result
}

pub fn cancel_super_resolution_registration(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .computational_merge_jobs
        .cancel_active_family(ComputationalMergeFamily::SuperResolution)
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;

    #[test]
    fn unsupported_models_fail_closed_before_registration() {
        let settings = SuperResolutionReadinessSettings {
            alignment_mode: "homography".to_string(),
            detail_policy: "conservative".to_string(),
            max_preview_dimension_px: 2400,
            output_scale: 2.0,
            quality_preference: "best".to_string(),
            reconstruction_mode: "model_detail".to_string(),
            source_mode: "multi_image".to_string(),
        };
        assert_eq!(
            settings_block_codes(&settings),
            vec!["unsupported_alignment_model"]
        );
    }

    #[test]
    fn private_alaska_burst_runs_native_se2_registration_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_SR_SE2_REGISTRATION_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            return;
        }
        let private_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
                .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
        );
        let paths = [
            "private-fixtures/super-resolution/alaska-burst-v1/_DSC7861.ARW",
            "private-fixtures/super-resolution/alaska-burst-v1/_DSC7862.ARW",
            "private-fixtures/super-resolution/alaska-burst-v1/_DSC7863.ARW",
            "private-fixtures/super-resolution/alaska-burst-v1/_DSC7864.ARW",
        ]
        .into_iter()
        .map(|relative_path| {
            private_root
                .join(relative_path)
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
        let settings = SuperResolutionReadinessSettings {
            alignment_mode: "auto".to_string(),
            detail_policy: "conservative".to_string(),
            max_preview_dimension_px: 2400,
            output_scale: 2.0,
            quality_preference: "best".to_string(),
            reconstruction_mode: "model_detail".to_string(),
            source_mode: "multi_image".to_string(),
        };
        let token = AtomicBool::new(false);
        let frames = paths
            .iter()
            .enumerate()
            .map(|(source_index, path)| {
                decode_bayer_burst_frame(
                    path,
                    source_index,
                    settings.max_preview_dimension_px,
                    &token,
                )
            })
            .collect::<Result<Vec<_>, _>>()
            .expect("private Alaska burst decodes as calibrated Bayer");
        let plan = build_dry_run_plan(frames, &settings, &token)
            .expect("native SR registration returns a deterministic plan");
        let registration = plan
            .registration
            .as_ref()
            .expect("calibrated private burst produces a native registration result");
        let output_dir = private_root.join("private-artifacts/validation/computational-merge");
        std::fs::create_dir_all(&output_dir).expect("private proof output directory exists");
        let report = json!({
            "accepted": plan.accepted,
            "acceptedDryRunPlanHash": plan.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": plan.accepted_dry_run_plan_id,
            "blockCodes": plan.block_codes,
            "excludedSources": registration.excluded_sources,
            "previewHash": registration.preview.content_hash,
            "referenceSourceIndex": registration.reference_source_index,
            "registrationAlgorithm": registration.algorithm_id,
            "registrationInputHash": plan.registration_input_hash,
            "selectedSourceIndexes": registration.selected_source_indexes,
            "sourceHashes": plan.intake.sources.iter().map(|source| &source.content_hash).collect::<Vec<_>>(),
            "summary": registration.summary,
            "transforms": registration.transforms,
            "warningCodes": plan.warning_codes,
        });
        std::fs::write(
            output_dir.join("sr-se2-registration-runtime.json"),
            serde_json::to_vec_pretty(&report).expect("sanitized private proof serializes"),
        )
        .expect("sanitized private proof writes");
        assert!(
            plan.accepted
                || registration
                    .excluded_sources
                    .iter()
                    .any(|exclusion| exclusion.code == "residual_inlier_coverage_failure"),
            "private burst must either be accepted or fail closed with a measured residual rejection: {:?}",
            plan.block_codes
        );
    }
}
