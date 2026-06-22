use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::formats::jpeg_data_url;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::RawEngineArtifacts;
use base64::{Engine as _, engine::general_purpose};
use chrono::Utc;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, Rgb32FImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use crate::AppState;
use crate::image_processing::downscale_f32_image;
use crate::load_settings_or_default;
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct NegativeConversionParams {
    pub red_weight: f32,
    pub green_weight: f32,
    pub blue_weight: f32,

    #[serde(default = "default_base_fog_strength")]
    pub base_fog_strength: f32,
    #[serde(default)]
    pub base_fog_sample: Option<NegativeBaseFogSampleRect>,
    pub exposure: f32,
    pub contrast: f32,
    #[serde(default = "default_black_point")]
    pub black_point: f32,
    #[serde(default = "default_white_point")]
    pub white_point: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeBaseFogSampleRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default)]
#[serde(rename_all = "snake_case")]
pub enum NegativeConversionOutputFormat {
    JpegProof,
    #[default]
    Tiff16,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeConversionSaveOptions {
    pub output_format: NegativeConversionOutputFormat,
    pub suffix: String,
    #[serde(default = "default_write_conversion_bundle")]
    pub write_conversion_bundle: bool,
    #[serde(default)]
    pub accepted_dry_run_plan_hash: Option<String>,
    #[serde(default)]
    pub accepted_dry_run_plan_id: Option<String>,
    #[serde(default)]
    pub acquisition_warning_codes: Vec<String>,
    #[serde(default)]
    pub acquisition_source_families: Vec<String>,
    #[serde(default)]
    pub profile_provenance_hash: Option<String>,
    #[serde(default)]
    pub selected_profile: Option<NegativeLabSelectedProfileSnapshot>,
    #[serde(default)]
    pub frame_exposure_overrides: NegativeLabFrameExposureOverridePayload,
    #[serde(default)]
    pub frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabFrameExposureOverridePayload {
    pub overrides: Vec<NegativeLabFrameExposureOverride>,
    pub schema_version: u8,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabFrameExposureOverride {
    pub effective_exposure: f32,
    pub exposure_offset: f32,
    pub frame_id: String,
    pub source_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabFrameRgbBalanceOverridePayload {
    pub overrides: Vec<NegativeLabFrameRgbBalanceOverride>,
    pub schema_version: u8,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabFrameRgbBalance {
    pub blue_weight: f32,
    pub green_weight: f32,
    pub red_weight: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabFrameRgbBalanceOverride {
    pub frame_id: String,
    pub rgb_balance_offset: NegativeLabFrameRgbBalance,
    pub source_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabSelectedProfileSnapshot {
    pub claim_level: String,
    pub claim_policy: String,
    pub display_name: String,
    pub does_not_prove: Vec<String>,
    pub evidence_fixture_count: u32,
    pub measurement_profile_id: Option<String>,
    pub params: NegativeConversionParams,
    pub preset_id: String,
    pub profile_provenance_hash: String,
    pub profile_status: String,
    pub provenance_summary: String,
    pub runtime_status: String,
    pub source_generic_preset_id: Option<String>,
}

#[derive(Serialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeBaseFogEstimate {
    pub red_weight: f32,
    pub green_weight: f32,
    pub blue_weight: f32,
    pub base_rgb: [f32; 3],
    pub base_density: [f32; 3],
    pub confidence: f32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabNeutralPatchSuggestion {
    pub application_risk: String,
    pub apply_allowed: bool,
    pub confidence: f32,
    pub correction_magnitude: f32,
    pub effective_rgb_balance: NegativeLabFrameRgbBalance,
    pub neutrality_risk: String,
    pub offset_clamped: bool,
    pub sample_density: [f32; 3],
    pub sample_rect: NegativeBaseFogSampleRect,
    pub sample_rgb: [f32; 3],
    pub suggested_rgb_balance_offset: NegativeLabFrameRgbBalance,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabHighlightPatchExposureSuggestion {
    pub application_risk: String,
    pub apply_allowed: bool,
    pub correction_magnitude_ev: f32,
    pub current_frame_exposure_offset: f32,
    pub current_frame_clipped_fraction: f32,
    pub current_sample_clipped_fraction: f32,
    pub current_sample_p99_max_channel: f32,
    pub current_sample_rgb: [f32; 3],
    pub effective_exposure: f32,
    pub offset_clamped: bool,
    pub projected_frame_clipped_fraction: f32,
    pub projected_sample_clipped_fraction: f32,
    pub projected_sample_p99_max_channel: f32,
    pub projected_sample_rgb: [f32; 3],
    pub role: String,
    pub sample_rect: NegativeBaseFogSampleRect,
    pub status: String,
    pub suggested_exposure_delta_ev: f32,
    pub suggested_frame_exposure_offset: f32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabShadowPatchBlackPointSuggestion {
    pub application_risk: String,
    pub apply_allowed: bool,
    pub correction_magnitude: f32,
    pub current_black_point: f32,
    pub current_sample_p01_min_channel: f32,
    pub current_sample_rgb: [f32; 3],
    pub endpoint_clamped: bool,
    pub projected_black_point: f32,
    pub projected_sample_p01_min_channel: f32,
    pub projected_sample_rgb: [f32; 3],
    pub role: String,
    pub sample_rect: NegativeBaseFogSampleRect,
    pub status: String,
    pub suggested_black_point_delta: f32,
}

#[derive(Debug, Clone, Copy)]
struct NegativeLabHighlightPatchMetrics {
    frame_clipped_fraction: f32,
    sample_clipped_fraction: f32,
    sample_p99_max_channel: f32,
    sample_rgb: [f32; 3],
}

#[derive(Debug, Clone, Copy)]
struct NegativeLabShadowPatchMetrics {
    sample_p01_min_channel: f32,
    sample_rgb: [f32; 3],
}

const MIN_CHANNEL_WEIGHT: f32 = 0.5;
const MAX_CHANNEL_WEIGHT: f32 = 2.0;
const MIN_BASE_FOG_STRENGTH: f32 = 0.0;
const MAX_BASE_FOG_STRENGTH: f32 = 1.25;
const MIN_EXPOSURE: f32 = -2.0;
const MAX_EXPOSURE: f32 = 2.0;
const MIN_CONTRAST: f32 = 0.5;
const MAX_CONTRAST: f32 = 2.5;
const MIN_BLACK_POINT: f32 = 0.0;
const MAX_BLACK_POINT: f32 = 0.95;
const MIN_WHITE_POINT: f32 = 0.05;
const MAX_WHITE_POINT: f32 = 1.0;
const MIN_ENDPOINT_SEPARATION: f32 = 0.05;
const DEFAULT_OUTPUT_SUFFIX: &str = "Positive";
const JPEG_PROOF_QUALITY: u8 = 92;
const NEGATIVE_LAB_CONVERSION_BUNDLE_SCHEMA_VERSION: u8 = 1;
const NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING: f32 = 0.98;
const NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV: f32 = 0.05;
const NEGATIVE_LAB_SHADOW_TARGET_FLOOR: f32 = 0.035;
const NEGATIVE_LAB_BLACK_POINT_STEP: f32 = 0.01;

impl Default for NegativeLabFrameExposureOverridePayload {
    fn default() -> Self {
        Self {
            overrides: Vec::new(),
            schema_version: 1,
        }
    }
}

impl Default for NegativeLabFrameRgbBalanceOverridePayload {
    fn default() -> Self {
        Self {
            overrides: Vec::new(),
            schema_version: 1,
        }
    }
}

fn default_base_fog_strength() -> f32 {
    1.0
}

fn default_black_point() -> f32 {
    0.0
}

fn default_white_point() -> f32 {
    1.0
}

fn default_write_conversion_bundle() -> bool {
    true
}

impl Default for NegativeConversionSaveOptions {
    fn default() -> Self {
        Self {
            output_format: NegativeConversionOutputFormat::Tiff16,
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
            write_conversion_bundle: default_write_conversion_bundle(),
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            profile_provenance_hash: None,
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
        }
    }
}

impl NegativeConversionSaveOptions {
    fn sanitized(self) -> Self {
        let suffix = sanitize_output_suffix(&self.suffix);
        let profile_provenance_hash = self
            .profile_provenance_hash
            .filter(|hash| is_valid_negative_lab_profile_provenance_hash(hash));
        let selected_profile = self.selected_profile.filter(|profile| {
            is_valid_negative_lab_profile_provenance_hash(&profile.profile_provenance_hash)
                && profile_provenance_hash
                    .as_ref()
                    .map(|hash| hash == &profile.profile_provenance_hash)
                    .unwrap_or(true)
        });
        let frame_exposure_overrides = self
            .frame_exposure_overrides
            .overrides
            .into_iter()
            .filter(|override_entry| {
                override_entry.effective_exposure.is_finite()
                    && override_entry.exposure_offset.is_finite()
                    && (MIN_EXPOSURE..=MAX_EXPOSURE).contains(&override_entry.exposure_offset)
                    && !override_entry.frame_id.trim().is_empty()
                    && !override_entry.source_path.trim().is_empty()
            })
            .collect();
        let frame_rgb_balance_overrides = self
            .frame_rgb_balance_overrides
            .overrides
            .into_iter()
            .filter(|override_entry| {
                negative_lab_rgb_balance_offset_is_valid(&override_entry.rgb_balance_offset)
                    && !override_entry.frame_id.trim().is_empty()
                    && !override_entry.source_path.trim().is_empty()
            })
            .collect();

        Self {
            output_format: self.output_format,
            suffix,
            write_conversion_bundle: self.write_conversion_bundle,
            accepted_dry_run_plan_hash: self.accepted_dry_run_plan_hash,
            accepted_dry_run_plan_id: self.accepted_dry_run_plan_id,
            acquisition_warning_codes: self
                .acquisition_warning_codes
                .into_iter()
                .filter(|code| is_valid_negative_lab_acquisition_warning_code(code))
                .collect(),
            acquisition_source_families: self
                .acquisition_source_families
                .into_iter()
                .filter(|family| is_valid_negative_lab_acquisition_source_family(family))
                .collect(),
            profile_provenance_hash,
            selected_profile,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload {
                overrides: frame_exposure_overrides,
                schema_version: 1,
            },
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload {
                overrides: frame_rgb_balance_overrides,
                schema_version: 1,
            },
        }
    }

    fn validate_accepted_batch_plan(&self, paths_len: usize) -> Result<(), String> {
        if paths_len <= 1 {
            return Ok(());
        }

        let plan_hash = self.accepted_dry_run_plan_hash.as_deref().ok_or_else(|| {
            "Batch negative export requires an accepted dry-run plan hash.".to_string()
        })?;
        let plan_id = self.accepted_dry_run_plan_id.as_deref().ok_or_else(|| {
            "Batch negative export requires an accepted dry-run plan id.".to_string()
        })?;

        if !is_valid_negative_lab_plan_hash(plan_hash) {
            return Err("Batch negative export accepted dry-run plan hash is invalid.".to_string());
        }

        let hash_suffix = plan_hash.strip_prefix("fnv1a32:").ok_or_else(|| {
            "Batch negative export accepted dry-run plan hash is invalid.".to_string()
        })?;
        let expected_plan_id = format!("negative_lab_batch_plan_{hash_suffix}");
        if plan_id != expected_plan_id {
            return Err(
                "Batch negative export accepted dry-run plan id does not match hash.".to_string(),
            );
        }

        Ok(())
    }

    fn effective_params_for_path(
        &self,
        base_params: &NegativeConversionParams,
        source_path: &str,
    ) -> NegativeConversionParams {
        let mut params = *base_params;
        if let Some(override_entry) = self
            .frame_exposure_overrides
            .overrides
            .iter()
            .find(|candidate| candidate.source_path == source_path)
        {
            params = NegativeConversionParams {
                exposure: override_entry.effective_exposure,
                ..params
            }
            .sanitized();
        }

        if let Some(override_entry) = self
            .frame_rgb_balance_overrides
            .overrides
            .iter()
            .find(|candidate| candidate.source_path == source_path)
        {
            let effective_rgb_balance =
                negative_lab_effective_rgb_balance(&params, &override_entry.rgb_balance_offset);
            params = NegativeConversionParams {
                blue_weight: effective_rgb_balance.blue_weight,
                green_weight: effective_rgb_balance.green_weight,
                red_weight: effective_rgb_balance.red_weight,
                ..params
            }
            .sanitized();
        }

        params
    }
}

impl Default for NegativeConversionParams {
    fn default() -> Self {
        Self {
            red_weight: 1.0,
            green_weight: 1.0,
            blue_weight: 1.0,
            base_fog_strength: default_base_fog_strength(),
            base_fog_sample: None,
            exposure: 0.0,
            contrast: 1.0,
            black_point: default_black_point(),
            white_point: default_white_point(),
        }
    }
}

fn sanitize_output_suffix(suffix: &str) -> String {
    let sanitized: String = suffix
        .chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                Some(c)
            } else if c.is_whitespace() {
                Some('_')
            } else {
                None
            }
        })
        .take(40)
        .collect();

    if sanitized.is_empty() {
        DEFAULT_OUTPUT_SUFFIX.to_string()
    } else {
        sanitized
    }
}

fn is_valid_negative_lab_plan_hash(plan_hash: &str) -> bool {
    let Some(hash_suffix) = plan_hash.strip_prefix("fnv1a32:") else {
        return false;
    };

    hash_suffix.len() == 8 && hash_suffix.chars().all(|value| value.is_ascii_hexdigit())
}

fn is_valid_negative_lab_profile_provenance_hash(profile_hash: &str) -> bool {
    is_valid_negative_lab_plan_hash(profile_hash)
}

fn build_negative_lab_plan_hash(value: &str) -> String {
    let mut hash = 0x811c9dc5_u32;
    for byte in value.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn negative_lab_rgb_balance_offset_is_valid(balance: &NegativeLabFrameRgbBalance) -> bool {
    [
        balance.blue_weight,
        balance.green_weight,
        balance.red_weight,
    ]
    .iter()
    .all(|value| value.is_finite() && (-1.5..=1.5).contains(value))
}

fn negative_lab_effective_rgb_balance(
    params: &NegativeConversionParams,
    offset: &NegativeLabFrameRgbBalance,
) -> NegativeLabFrameRgbBalance {
    NegativeLabFrameRgbBalance {
        blue_weight: (params.blue_weight + offset.blue_weight)
            .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
        green_weight: (params.green_weight + offset.green_weight)
            .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
        red_weight: (params.red_weight + offset.red_weight)
            .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
    }
}

fn snap_negative_lab_rgb_offset(value: f32) -> f32 {
    ((value.clamp(-1.5, 1.5) * 100.0).round() / 100.0).clamp(-1.5, 1.5)
}

fn negative_lab_rgb_offset_was_clamped(value: f32) -> bool {
    !(-1.5..=1.5).contains(&value)
}

fn negative_lab_neutrality_risk(sample_density: [f32; 3]) -> String {
    let min_density = sample_density.iter().copied().fold(f32::INFINITY, f32::min);
    let max_density = sample_density
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let spread = max_density - min_density;
    if spread <= 0.08 {
        "low".to_string()
    } else if spread <= 0.18 {
        "medium".to_string()
    } else {
        "high".to_string()
    }
}

fn negative_lab_correction_risk(correction_magnitude: f32) -> String {
    if correction_magnitude <= 0.15 {
        "low".to_string()
    } else if correction_magnitude <= 0.40 {
        "medium".to_string()
    } else {
        "high".to_string()
    }
}

fn build_negative_lab_neutral_patch_suggestion(
    params: NegativeConversionParams,
    sample_rect: NegativeBaseFogSampleRect,
    estimate: NegativeBaseFogEstimate,
) -> NegativeLabNeutralPatchSuggestion {
    let sanitized_params = params.sanitized();
    let raw_blue_offset = estimate.blue_weight - sanitized_params.blue_weight;
    let raw_green_offset = estimate.green_weight - sanitized_params.green_weight;
    let raw_red_offset = estimate.red_weight - sanitized_params.red_weight;
    let suggested_rgb_balance_offset = NegativeLabFrameRgbBalance {
        blue_weight: snap_negative_lab_rgb_offset(raw_blue_offset),
        green_weight: snap_negative_lab_rgb_offset(raw_green_offset),
        red_weight: snap_negative_lab_rgb_offset(raw_red_offset),
    };
    let offset_clamped = negative_lab_rgb_offset_was_clamped(raw_blue_offset)
        || negative_lab_rgb_offset_was_clamped(raw_green_offset)
        || negative_lab_rgb_offset_was_clamped(raw_red_offset);
    let correction_magnitude = suggested_rgb_balance_offset
        .blue_weight
        .abs()
        .max(suggested_rgb_balance_offset.green_weight.abs())
        .max(suggested_rgb_balance_offset.red_weight.abs());
    let effective_rgb_balance =
        negative_lab_effective_rgb_balance(&sanitized_params, &suggested_rgb_balance_offset);

    NegativeLabNeutralPatchSuggestion {
        application_risk: negative_lab_correction_risk(correction_magnitude),
        apply_allowed: !offset_clamped && correction_magnitude <= 0.75,
        confidence: estimate.confidence,
        correction_magnitude,
        effective_rgb_balance,
        neutrality_risk: negative_lab_neutrality_risk(estimate.base_density),
        offset_clamped,
        sample_density: estimate.base_density,
        sample_rect,
        sample_rgb: estimate.base_rgb,
        suggested_rgb_balance_offset,
    }
}

fn snap_negative_lab_frame_exposure_offset(value: f32) -> f32 {
    ((value.clamp(MIN_EXPOSURE, MAX_EXPOSURE) / NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV).round()
        * NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV)
        .clamp(MIN_EXPOSURE, MAX_EXPOSURE)
}

fn negative_lab_exposure_risk(correction_magnitude_ev: f32) -> String {
    if correction_magnitude_ev <= 0.35 {
        "low".to_string()
    } else if correction_magnitude_ev <= 0.75 {
        "medium".to_string()
    } else {
        "high".to_string()
    }
}

fn sample_rect_pixel_bounds(
    rect: NegativeBaseFogSampleRect,
    width: u32,
    height: u32,
) -> (u32, u32, u32, u32) {
    let start_x = ((rect.x * width as f32).floor() as u32).min(width.saturating_sub(1));
    let start_y = ((rect.y * height as f32).floor() as u32).min(height.saturating_sub(1));
    let end_x = (((rect.x + rect.width) * width as f32).ceil() as u32).clamp(start_x + 1, width);
    let end_y = (((rect.y + rect.height) * height as f32).ceil() as u32).clamp(start_y + 1, height);

    (start_x, end_x, start_y, end_y)
}

fn negative_lab_highlight_patch_metrics(
    rendered: &DynamicImage,
    sample_rect: NegativeBaseFogSampleRect,
) -> NegativeLabHighlightPatchMetrics {
    let rgb = rendered.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let (start_x, end_x, start_y, end_y) = sample_rect_pixel_bounds(sample_rect, width, height);
    let mut sample_max_channels = Vec::with_capacity(
        (end_x.saturating_sub(start_x) * end_y.saturating_sub(start_y)) as usize,
    );
    let mut sample_rgb_sum = [0.0_f32; 3];
    let mut sample_clipped_count = 0_usize;
    let mut frame_clipped_count = 0_usize;
    let mut sample_count = 0_usize;

    for (x, y, pixel) in rgb.enumerate_pixels() {
        let channels = pixel.0;
        let max_channel = channels[0].max(channels[1]).max(channels[2]);
        if max_channel >= NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING {
            frame_clipped_count += 1;
        }

        if x >= start_x && x < end_x && y >= start_y && y < end_y {
            sample_rgb_sum[0] += channels[0];
            sample_rgb_sum[1] += channels[1];
            sample_rgb_sum[2] += channels[2];
            sample_max_channels.push(max_channel);
            sample_count += 1;
            if max_channel >= NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING {
                sample_clipped_count += 1;
            }
        }
    }

    sample_max_channels.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let p99_index = ((sample_max_channels.len().saturating_sub(1)) as f32 * 0.99).round() as usize;
    let sample_p99_max_channel = sample_max_channels
        .get(p99_index.min(sample_max_channels.len().saturating_sub(1)))
        .copied()
        .unwrap_or(0.0);
    let safe_sample_count = sample_count.max(1) as f32;
    let frame_count = (width as usize * height as usize).max(1) as f32;

    NegativeLabHighlightPatchMetrics {
        frame_clipped_fraction: frame_clipped_count as f32 / frame_count,
        sample_clipped_fraction: sample_clipped_count as f32 / safe_sample_count,
        sample_p99_max_channel,
        sample_rgb: sample_rgb_sum.map(|value| value / safe_sample_count),
    }
}

fn build_negative_lab_highlight_patch_exposure_suggestion(
    input: &DynamicImage,
    params: NegativeConversionParams,
    current_frame_exposure_offset: f32,
    sample_rect: NegativeBaseFogSampleRect,
) -> NegativeLabHighlightPatchExposureSuggestion {
    let sanitized_params = params.sanitized();
    let current_offset = snap_negative_lab_frame_exposure_offset(current_frame_exposure_offset);
    let effective_current_exposure =
        (sanitized_params.exposure + current_offset).clamp(MIN_EXPOSURE, MAX_EXPOSURE);
    let current_effective_params = NegativeConversionParams {
        exposure: effective_current_exposure,
        ..sanitized_params
    };
    let current_render = run_pipeline(input, &current_effective_params, None);
    let current_metrics = negative_lab_highlight_patch_metrics(&current_render, sample_rect);

    if current_metrics.sample_p99_max_channel <= NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING {
        return NegativeLabHighlightPatchExposureSuggestion {
            application_risk: "low".to_string(),
            apply_allowed: false,
            correction_magnitude_ev: 0.0,
            current_frame_exposure_offset: current_offset,
            current_frame_clipped_fraction: current_metrics.frame_clipped_fraction,
            current_sample_clipped_fraction: current_metrics.sample_clipped_fraction,
            current_sample_p99_max_channel: current_metrics.sample_p99_max_channel,
            current_sample_rgb: current_metrics.sample_rgb,
            effective_exposure: effective_current_exposure,
            offset_clamped: false,
            projected_frame_clipped_fraction: current_metrics.frame_clipped_fraction,
            projected_sample_clipped_fraction: current_metrics.sample_clipped_fraction,
            projected_sample_p99_max_channel: current_metrics.sample_p99_max_channel,
            projected_sample_rgb: current_metrics.sample_rgb,
            role: "highlight".to_string(),
            sample_rect,
            status: "already_safe".to_string(),
            suggested_exposure_delta_ev: 0.0,
            suggested_frame_exposure_offset: current_offset,
        };
    }

    let mut selected_delta = None;
    let mut selected_metrics = current_metrics;
    let mut selected_effective_exposure = effective_current_exposure;
    let mut selected_offset = current_offset;

    for step in 1..=80 {
        let exposure_delta = -(step as f32 * NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV);
        let candidate_offset =
            snap_negative_lab_frame_exposure_offset(current_offset + exposure_delta);
        let candidate_effective_exposure =
            (sanitized_params.exposure + candidate_offset).clamp(MIN_EXPOSURE, MAX_EXPOSURE);
        let candidate_params = NegativeConversionParams {
            exposure: candidate_effective_exposure,
            ..sanitized_params
        };
        let candidate_render = run_pipeline(input, &candidate_params, None);
        let candidate_metrics =
            negative_lab_highlight_patch_metrics(&candidate_render, sample_rect);

        if candidate_metrics.sample_p99_max_channel <= NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING {
            selected_delta = Some(candidate_offset - current_offset);
            selected_metrics = candidate_metrics;
            selected_effective_exposure = candidate_effective_exposure;
            selected_offset = candidate_offset;
            break;
        }

        if candidate_offset <= MIN_EXPOSURE || candidate_effective_exposure <= MIN_EXPOSURE {
            selected_delta = Some(candidate_offset - current_offset);
            selected_metrics = candidate_metrics;
            selected_effective_exposure = candidate_effective_exposure;
            selected_offset = candidate_offset;
            break;
        }
    }

    let suggested_exposure_delta_ev = selected_delta.unwrap_or(0.0);
    let correction_magnitude_ev = suggested_exposure_delta_ev.abs();
    let offset_clamped =
        selected_offset <= MIN_EXPOSURE || selected_effective_exposure <= MIN_EXPOSURE;
    let application_risk = negative_lab_exposure_risk(correction_magnitude_ev);
    let suggested_is_safe =
        selected_metrics.sample_p99_max_channel <= NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING;
    let apply_allowed = suggested_is_safe
        && !offset_clamped
        && correction_magnitude_ev <= 0.75
        && selected_metrics.frame_clipped_fraction <= current_metrics.frame_clipped_fraction;
    let status = if suggested_is_safe {
        "suggested"
    } else {
        "blocked"
    };

    NegativeLabHighlightPatchExposureSuggestion {
        application_risk,
        apply_allowed,
        correction_magnitude_ev,
        current_frame_exposure_offset: current_offset,
        current_frame_clipped_fraction: current_metrics.frame_clipped_fraction,
        current_sample_clipped_fraction: current_metrics.sample_clipped_fraction,
        current_sample_p99_max_channel: current_metrics.sample_p99_max_channel,
        current_sample_rgb: current_metrics.sample_rgb,
        effective_exposure: selected_effective_exposure,
        offset_clamped,
        projected_frame_clipped_fraction: selected_metrics.frame_clipped_fraction,
        projected_sample_clipped_fraction: selected_metrics.sample_clipped_fraction,
        projected_sample_p99_max_channel: selected_metrics.sample_p99_max_channel,
        projected_sample_rgb: selected_metrics.sample_rgb,
        role: "highlight".to_string(),
        sample_rect,
        status: status.to_string(),
        suggested_exposure_delta_ev,
        suggested_frame_exposure_offset: selected_offset,
    }
}

fn negative_lab_shadow_patch_metrics(
    rendered: &DynamicImage,
    sample_rect: NegativeBaseFogSampleRect,
) -> NegativeLabShadowPatchMetrics {
    let rgb = rendered.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let (start_x, end_x, start_y, end_y) = sample_rect_pixel_bounds(sample_rect, width, height);
    let mut sample_min_channels = Vec::with_capacity(
        (end_x.saturating_sub(start_x) * end_y.saturating_sub(start_y)) as usize,
    );
    let mut sample_rgb_sum = [0.0_f32; 3];
    let mut sample_count = 0_usize;

    for (x, y, pixel) in rgb.enumerate_pixels() {
        if x >= start_x && x < end_x && y >= start_y && y < end_y {
            let channels = pixel.0;
            sample_rgb_sum[0] += channels[0];
            sample_rgb_sum[1] += channels[1];
            sample_rgb_sum[2] += channels[2];
            sample_min_channels.push(channels[0].min(channels[1]).min(channels[2]));
            sample_count += 1;
        }
    }

    sample_min_channels.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let p01_index = ((sample_min_channels.len().saturating_sub(1)) as f32 * 0.01).round() as usize;
    let sample_p01_min_channel = sample_min_channels.get(p01_index).copied().unwrap_or(0.0);
    let safe_sample_count = sample_count.max(1) as f32;

    NegativeLabShadowPatchMetrics {
        sample_p01_min_channel,
        sample_rgb: sample_rgb_sum.map(|value| value / safe_sample_count),
    }
}

fn build_negative_lab_shadow_patch_black_point_suggestion(
    input: &DynamicImage,
    params: NegativeConversionParams,
    sample_rect: NegativeBaseFogSampleRect,
) -> NegativeLabShadowPatchBlackPointSuggestion {
    let sanitized_params = params.sanitized();
    let current_render = run_pipeline(input, &sanitized_params, None);
    let current_metrics = negative_lab_shadow_patch_metrics(&current_render, sample_rect);

    if current_metrics.sample_p01_min_channel <= NEGATIVE_LAB_SHADOW_TARGET_FLOOR {
        return NegativeLabShadowPatchBlackPointSuggestion {
            application_risk: "low".to_string(),
            apply_allowed: false,
            correction_magnitude: 0.0,
            current_black_point: sanitized_params.black_point,
            current_sample_p01_min_channel: current_metrics.sample_p01_min_channel,
            current_sample_rgb: current_metrics.sample_rgb,
            endpoint_clamped: false,
            projected_black_point: sanitized_params.black_point,
            projected_sample_p01_min_channel: current_metrics.sample_p01_min_channel,
            projected_sample_rgb: current_metrics.sample_rgb,
            role: "shadow".to_string(),
            sample_rect,
            status: "already_safe".to_string(),
            suggested_black_point_delta: 0.0,
        };
    }

    let max_black_point = (sanitized_params.white_point - MIN_ENDPOINT_SEPARATION)
        .clamp(MIN_BLACK_POINT, MAX_BLACK_POINT);
    let mut selected_black_point = sanitized_params.black_point;
    let mut selected_metrics = current_metrics;
    let mut suggested = false;

    for step in 1..=95 {
        let candidate_black_point = (sanitized_params.black_point
            + step as f32 * NEGATIVE_LAB_BLACK_POINT_STEP)
            .min(max_black_point);
        let candidate_params = NegativeConversionParams {
            black_point: candidate_black_point,
            ..sanitized_params
        };
        let candidate_render = run_pipeline(input, &candidate_params, None);
        let candidate_metrics = negative_lab_shadow_patch_metrics(&candidate_render, sample_rect);
        selected_black_point = candidate_black_point;
        selected_metrics = candidate_metrics;

        if selected_metrics.sample_p01_min_channel <= NEGATIVE_LAB_SHADOW_TARGET_FLOOR {
            suggested = true;
            break;
        }

        if candidate_black_point >= max_black_point {
            break;
        }
    }

    let suggested_black_point_delta = selected_black_point - sanitized_params.black_point;
    let correction_magnitude = suggested_black_point_delta.abs();
    let endpoint_clamped = selected_black_point >= max_black_point;
    let application_risk = negative_lab_correction_risk(correction_magnitude);
    let apply_allowed = suggested && !endpoint_clamped && correction_magnitude <= 0.35;
    let status = if suggested { "suggested" } else { "blocked" };

    NegativeLabShadowPatchBlackPointSuggestion {
        application_risk,
        apply_allowed,
        correction_magnitude,
        current_black_point: sanitized_params.black_point,
        current_sample_p01_min_channel: current_metrics.sample_p01_min_channel,
        current_sample_rgb: current_metrics.sample_rgb,
        endpoint_clamped,
        projected_black_point: selected_black_point,
        projected_sample_p01_min_channel: selected_metrics.sample_p01_min_channel,
        projected_sample_rgb: selected_metrics.sample_rgb,
        role: "shadow".to_string(),
        sample_rect,
        status: status.to_string(),
        suggested_black_point_delta,
    }
}

fn is_valid_negative_lab_acquisition_warning_code(warning_code: &str) -> bool {
    matches!(
        warning_code,
        "lossy_source_for_negative_lab" | "mixed_source_families" | "unknown_acquisition_state"
    )
}

fn is_valid_negative_lab_acquisition_source_family(source_family: &str) -> bool {
    matches!(
        source_family,
        "jpeg_lossy" | "raw_like" | "tiff_scan" | "unknown"
    )
}

fn build_negative_output_path(
    real_path: &str,
    save_options: &NegativeConversionSaveOptions,
) -> PathBuf {
    let p = Path::new(real_path);
    let parent = p.parent().unwrap_or(Path::new(""));
    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
    let extension = match save_options.output_format {
        NegativeConversionOutputFormat::JpegProof => "jpg",
        NegativeConversionOutputFormat::Tiff16 => "tiff",
    };
    let filename = format!("{}_{}.{}", stem, save_options.suffix, extension);
    parent.join(&filename)
}

fn negative_lab_output_sidecar_path(output_path: &Path) -> PathBuf {
    output_path.with_file_name(format!(
        "{}.rrdata",
        output_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ))
}

fn negative_lab_conversion_bundle_path(first_output_path: &Path) -> PathBuf {
    first_output_path.with_file_name(format!(
        "{}.conversion-bundle.json",
        first_output_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ))
}

fn hash_negative_lab_file(output_path: &Path, label: &str) -> Result<String, String> {
    let bytes = fs::read(output_path)
        .map_err(|e| format!("Failed to read Negative Lab {label} for hash: {}", e))?;
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(format!("fnv1a64:{hash:016x}"))
}

fn hash_negative_lab_output_file(output_path: &Path) -> Result<String, String> {
    hash_negative_lab_file(output_path, "output")
}

#[derive(Debug, Clone)]
struct NegativeLabConversionBundleOutputRef {
    source_path: PathBuf,
    output_path: PathBuf,
    sidecar_path: PathBuf,
    output_width: u32,
    output_height: u32,
}

fn negative_lab_path_filename(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn negative_lab_output_format_id(output_format: NegativeConversionOutputFormat) -> &'static str {
    match output_format {
        NegativeConversionOutputFormat::JpegProof => "jpeg_proof",
        NegativeConversionOutputFormat::Tiff16 => "tiff16",
    }
}

fn write_negative_lab_conversion_bundle(
    bundle_path: &Path,
    params: &NegativeConversionParams,
    save_options: &NegativeConversionSaveOptions,
    outputs: &[NegativeLabConversionBundleOutputRef],
) -> Result<(), String> {
    let output_format = negative_lab_output_format_id(save_options.output_format);
    let output_refs: Result<Vec<_>, String> = outputs
        .iter()
        .map(|output| {
            Ok(serde_json::json!({
                "contentHash": hash_negative_lab_output_file(&output.output_path)?,
                "dimensions": {
                    "height": output.output_height,
                    "width": output.output_width,
                },
                "format": output_format,
                "filename": negative_lab_path_filename(&output.output_path),
                "path": output.output_path.to_string_lossy(),
                "sidecarFilename": negative_lab_path_filename(&output.sidecar_path),
                "sidecarPath": output.sidecar_path.to_string_lossy(),
                "source": {
                    "contentHash": hash_negative_lab_file(&output.source_path, "source")?,
                    "filename": negative_lab_path_filename(&output.source_path),
                    "path": output.source_path.to_string_lossy(),
                }
            }))
        })
        .collect();
    let profile_hash = save_options
        .selected_profile
        .as_ref()
        .map(|profile| profile.profile_provenance_hash.clone())
        .or_else(|| save_options.profile_provenance_hash.clone());
    let replay_seed = serde_json::json!({
        "outputFormat": output_format,
        "frameExposureOverrides": save_options.frame_exposure_overrides.clone(),
        "frameRgbBalanceOverrides": save_options.frame_rgb_balance_overrides.clone(),
        "params": params,
        "paths": outputs
            .iter()
            .map(|output| output.source_path.to_string_lossy().to_string())
            .collect::<Vec<_>>(),
        "profileProvenanceHash": profile_hash,
        "suffix": save_options.suffix,
    })
    .to_string();
    let replay_plan_hash = format!("fnv1a32:{}", build_negative_lab_plan_hash(&replay_seed));
    let bundle = serde_json::json!({
        "acquisition": {
            "sourceFamilies": save_options.acquisition_source_families,
            "warningCodes": save_options.acquisition_warning_codes,
        },
        "conversion": {
            "acceptedDryRunPlanHash": save_options.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": save_options.accepted_dry_run_plan_id,
            "frameExposureOverrides": save_options.frame_exposure_overrides.clone(),
            "frameRgbBalanceOverrides": save_options.frame_rgb_balance_overrides.clone(),
            "outputFormat": output_format,
            "params": params,
            "profileProvenanceHash": save_options.profile_provenance_hash,
            "selectedProfile": save_options.selected_profile,
            "suffix": save_options.suffix,
        },
        "doesNotProve": [
            "cryptographic_authenticity",
            "embedded_source_pixels",
            "external_source_relinking",
            "named_stock_colorimetric_match",
            "zip_archive_packaging"
        ],
        "outputs": output_refs?,
        "replay": {
            "appServerCommand": "negative.lab.conversion_plan",
            "identityHash": replay_plan_hash,
            "requiresSourceFiles": true,
        },
        "schemaVersion": NEGATIVE_LAB_CONVERSION_BUNDLE_SCHEMA_VERSION,
    });
    let json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| format!("Failed to serialize Negative Lab conversion bundle: {}", e))?;
    fs::write(bundle_path, json).map_err(|e| {
        format!(
            "Failed to write Negative Lab conversion bundle {}: {}",
            bundle_path.display(),
            e
        )
    })
}

fn write_negative_lab_output_sidecar(
    output_path: &Path,
    source_path: &Path,
    params: &NegativeConversionParams,
    save_options: &NegativeConversionSaveOptions,
    output_width: u32,
    output_height: u32,
) -> Result<(), String> {
    let sidecar_path = negative_lab_output_sidecar_path(output_path);
    let mut sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
    let artifact_id = format!("artifact_negative_lab_{}", Uuid::new_v4().simple());
    let output_artifact_id = format!("{}_output", artifact_id);
    let content_hash = hash_negative_lab_output_file(output_path)?;
    let output_format = match save_options.output_format {
        NegativeConversionOutputFormat::JpegProof => "jpeg_proof",
        NegativeConversionOutputFormat::Tiff16 => "tiff16",
    };

    let artifact = serde_json::json!({
        "artifactId": artifact_id,
        "createdAt": Utc::now().to_rfc3339(),
        "conversion": {
            "acceptedDryRunPlanHash": save_options.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": save_options.accepted_dry_run_plan_id,
            "frameExposureOverrides": save_options.frame_exposure_overrides.clone(),
            "frameRgbBalanceOverrides": save_options.frame_rgb_balance_overrides.clone(),
            "outputFormat": output_format,
            "params": params,
            "profileProvenanceHash": save_options.profile_provenance_hash,
            "selectedProfile": save_options.selected_profile.clone(),
        },
        "operationId": "negative_lab.convert",
        "operationVersion": 1,
        "outputArtifacts": [{
            "artifactId": output_artifact_id,
            "contentHash": content_hash,
            "dimensions": {
                "height": output_height,
                "width": output_width,
            },
            "kind": "negative_lab_positive",
            "storage": "sidecar_artifact",
        }],
        "provenance": {
            "commandId": "command_negative_lab_convert",
            "profileProvenanceHash": save_options.profile_provenance_hash,
            "selectedProfile": save_options.selected_profile.clone(),
            "runtimeStatus": "rendered",
        },
        "schemaVersion": 1,
        "sourceImageRefs": [{
            "imagePath": source_path.to_string_lossy(),
        }],
        "warnings": [],
    });

    let artifacts = sidecar
        .raw_engine_artifacts
        .get_or_insert_with(RawEngineArtifacts::new_v1);
    artifacts.schema_version = 1;
    artifacts.negative_lab_artifacts.push(artifact);
    artifacts.stale_artifact_ids.retain(|id| !id.is_empty());

    let json = serde_json::to_string_pretty(&sidecar)
        .map_err(|e| format!("Failed to serialize Negative Lab sidecar: {}", e))?;
    fs::write(&sidecar_path, json).map_err(|e| {
        format!(
            "Failed to write Negative Lab sidecar {}: {}",
            sidecar_path.display(),
            e
        )
    })
}

impl NegativeConversionParams {
    fn sanitized(self) -> Self {
        fn finite_or_default(value: f32, fallback: f32) -> f32 {
            if value.is_finite() { value } else { fallback }
        }

        let defaults = Self::default();

        Self {
            red_weight: finite_or_default(self.red_weight, defaults.red_weight)
                .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
            green_weight: finite_or_default(self.green_weight, defaults.green_weight)
                .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
            blue_weight: finite_or_default(self.blue_weight, defaults.blue_weight)
                .clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT),
            base_fog_strength: finite_or_default(
                self.base_fog_strength,
                defaults.base_fog_strength,
            )
            .clamp(MIN_BASE_FOG_STRENGTH, MAX_BASE_FOG_STRENGTH),
            base_fog_sample: self.base_fog_sample.and_then(sanitize_sample_rect),
            exposure: finite_or_default(self.exposure, defaults.exposure)
                .clamp(MIN_EXPOSURE, MAX_EXPOSURE),
            contrast: finite_or_default(self.contrast, defaults.contrast)
                .clamp(MIN_CONTRAST, MAX_CONTRAST),
            black_point: finite_or_default(self.black_point, defaults.black_point)
                .clamp(MIN_BLACK_POINT, MAX_BLACK_POINT),
            white_point: finite_or_default(self.white_point, defaults.white_point)
                .clamp(MIN_WHITE_POINT, MAX_WHITE_POINT),
        }
        .with_sanitized_endpoints()
    }

    fn with_sanitized_endpoints(mut self) -> Self {
        if self.white_point - self.black_point < MIN_ENDPOINT_SEPARATION {
            self.white_point = (self.black_point + MIN_ENDPOINT_SEPARATION).min(MAX_WHITE_POINT);
            self.black_point = self
                .black_point
                .min(self.white_point - MIN_ENDPOINT_SEPARATION)
                .max(MIN_BLACK_POINT);
        }

        self
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ChannelBounds {
    pub min: f32,
    pub max: f32,
}

fn sanitize_sample_rect(rect: NegativeBaseFogSampleRect) -> Option<NegativeBaseFogSampleRect> {
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.width.is_finite()
        || !rect.height.is_finite()
    {
        return None;
    }

    let x = rect.x.clamp(0.0, 0.98);
    let y = rect.y.clamp(0.0, 0.98);
    let width = rect.width.clamp(0.02, 1.0 - x);
    let height = rect.height.clamp(0.02, 1.0 - y);

    Some(NegativeBaseFogSampleRect {
        x,
        y,
        width,
        height,
    })
}

fn analyze_bounds(
    log_data: &[f32],
    width: usize,
    height: usize,
    sample_rect: Option<NegativeBaseFogSampleRect>,
) -> [ChannelBounds; 3] {
    let sanitized_rect = sample_rect.and_then(sanitize_sample_rect);
    let (start_x, end_x, start_y, end_y) = if let Some(rect) = sanitized_rect {
        let start_x = ((rect.x * width as f32).floor() as usize).min(width.saturating_sub(1));
        let start_y = ((rect.y * height as f32).floor() as usize).min(height.saturating_sub(1));
        let end_x =
            (((rect.x + rect.width) * width as f32).ceil() as usize).clamp(start_x + 1, width);
        let end_y =
            (((rect.y + rect.height) * height as f32).ceil() as usize).clamp(start_y + 1, height);
        (start_x, end_x, start_y, end_y)
    } else {
        let margin_x = (width as f32 * 0.12) as usize;
        let margin_y = (height as f32 * 0.12) as usize;
        (
            margin_x,
            width.saturating_sub(margin_x),
            margin_y,
            height.saturating_sub(margin_y),
        )
    };

    let est_pixels = (end_x.saturating_sub(start_x)) * (end_y.saturating_sub(start_y));
    let step = (est_pixels / 40_000).max(1);
    let row_step = if sanitized_rect.is_some() { 1 } else { 3 };

    let mut r_vals = Vec::with_capacity(est_pixels / step);
    let mut g_vals = Vec::with_capacity(est_pixels / step);
    let mut b_vals = Vec::with_capacity(est_pixels / step);

    for y in (start_y..end_y).step_by(row_step) {
        let row_offset = y * width * 3;

        for x in (start_x..end_x).step_by(step) {
            let idx = row_offset + (x * 3);

            if idx + 2 < log_data.len() {
                let r = log_data[idx];
                let g = log_data[idx + 1];
                let b = log_data[idx + 2];

                if r.is_finite() {
                    r_vals.push(r);
                }
                if g.is_finite() {
                    g_vals.push(g);
                }
                if b.is_finite() {
                    b_vals.push(b);
                }
            }
        }
    }

    let get_bounds = |mut vals: Vec<f32>| -> ChannelBounds {
        if vals.is_empty() {
            return ChannelBounds { min: 0.0, max: 1.0 };
        }

        vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));

        let len = vals.len() as f32;

        let min_idx = (len * 0.001) as usize;
        let max_idx = (len * 0.999) as usize;

        let min = vals[min_idx.min(vals.len().saturating_sub(1))];
        let max = vals[max_idx.min(vals.len().saturating_sub(1))];

        let safe_max = if max <= min + 0.0001 { min + 1.0 } else { max };

        ChannelBounds { min, max: safe_max }
    };

    [get_bounds(r_vals), get_bounds(g_vals), get_bounds(b_vals)]
}

fn estimate_base_fog_from_image(
    input: &DynamicImage,
    sample_rect: Option<NegativeBaseFogSampleRect>,
) -> NegativeBaseFogEstimate {
    let rgb = input.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let log_pixels: Vec<f32> = rgb
        .as_raw()
        .par_iter()
        .map(|&v| -v.clamp(1e-6, 1.0).log10())
        .collect();
    let bounds = analyze_bounds(&log_pixels, width as usize, height as usize, sample_rect);

    let base_densities = [
        bounds[0].min.max(0.001),
        bounds[1].min.max(0.001),
        bounds[2].min.max(0.001),
    ];
    let mean_density = (base_densities[0] + base_densities[1] + base_densities[2]) / 3.0;
    let channel_spread = base_densities.iter().fold(0.0_f32, |max_value, value| {
        max_value.max((value - mean_density).abs())
    });
    let density_range = [
        bounds[0].max - bounds[0].min,
        bounds[1].max - bounds[1].min,
        bounds[2].max - bounds[2].min,
    ];
    let mean_range = (density_range[0] + density_range[1] + density_range[2]) / 3.0;

    let to_weight = |density: f32| {
        (mean_density / density.max(0.001)).clamp(MIN_CHANNEL_WEIGHT, MAX_CHANNEL_WEIGHT)
    };

    NegativeBaseFogEstimate {
        red_weight: to_weight(base_densities[0]),
        green_weight: to_weight(base_densities[1]),
        blue_weight: to_weight(base_densities[2]),
        base_rgb: base_densities.map(|density| 10.0_f32.powf(-density).clamp(0.0, 1.0)),
        base_density: base_densities,
        confidence: ((mean_range * 2.0) + (channel_spread * 1.5)).clamp(0.0, 1.0),
    }
}

fn run_pipeline(
    input: &DynamicImage,
    params: &NegativeConversionParams,
    override_bounds: Option<[ChannelBounds; 3]>,
) -> DynamicImage {
    let params = params.sanitized();
    let rgb = input.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let raw_pixels = rgb.as_raw();

    let log_pixels: Vec<f32> = raw_pixels
        .par_iter()
        .map(|&v| -v.clamp(1e-6, 1.0).log10())
        .collect();

    let bounds = if let Some(b) = override_bounds {
        b
    } else {
        analyze_bounds(
            &log_pixels,
            width as usize,
            height as usize,
            params.base_fog_sample,
        )
    };

    let mut out_buffer = vec![0.0f32; raw_pixels.len()];

    let k = 4.0 * params.contrast;
    let x0 = 0.6 - (params.exposure * 0.25);
    let gamma_inv = 1.0 / 2.2;

    let y0 = 1.0 / (1.0 + (k * x0).exp());
    let y1 = 1.0 / (1.0 + (-k * (1.0 - x0)).exp());
    let scale = 1.0 / (y1 - y0);
    let endpoint_span = (params.white_point - params.black_point).max(MIN_ENDPOINT_SEPARATION);
    let apply_endpoints =
        |value: f32| -> f32 { ((value - params.black_point) / endpoint_span).clamp(0.0, 1.0) };

    out_buffer
        .par_chunks_mut(3)
        .enumerate()
        .for_each(|(i, out_pixel)| {
            let idx = i * 3;

            let base_r = bounds[0].min * params.base_fog_strength;
            let base_g = bounds[1].min * params.base_fog_strength;
            let base_b = bounds[2].min * params.base_fog_strength;

            let mut n_r = (log_pixels[idx] - base_r) / (bounds[0].max - base_r).max(0.0001);
            let mut n_g = (log_pixels[idx + 1] - base_g) / (bounds[1].max - base_g).max(0.0001);
            let mut n_b = (log_pixels[idx + 2] - base_b) / (bounds[2].max - base_b).max(0.0001);

            n_r = n_r.max(0.0) * params.red_weight;
            n_g = n_g.max(0.0) * params.green_weight;
            n_b = n_b.max(0.0) * params.blue_weight;

            let apply_curve = |x: f32| -> f32 {
                let sigmoid = 1.0 / (1.0 + (-k * (x - x0)).exp());
                let s_norm = (sigmoid - y0) * scale;
                s_norm.clamp(0.0, 1.0)
            };

            let mut r = apply_curve(n_r);
            let mut g = apply_curve(n_g);
            let mut b = apply_curve(n_b);

            let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            let max_ch = r.max(g).max(b);

            if max_ch > 0.9 {
                let overflow = ((max_ch - 0.9) * 10.0).clamp(0.0, 1.0);
                let sat_reduction = overflow * overflow;

                r = r + (luma - r) * sat_reduction;
                g = g + (luma - g) * sat_reduction;
                b = b + (luma - b) * sat_reduction;
            }

            out_pixel[0] = apply_endpoints(r).powf(gamma_inv);
            out_pixel[1] = apply_endpoints(g).powf(gamma_inv);
            out_pixel[2] = apply_endpoints(b).powf(gamma_inv);
        });

    let out_img = Rgb32FImage::from_vec(width, height, out_buffer).unwrap();
    DynamicImage::ImageRgb32F(out_img)
}

#[tauri::command]
pub async fn preview_negative_conversion(
    path: String,
    params: NegativeConversionParams,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();

    let mut hasher = DefaultHasher::new();
    source_path_str.hash(&mut hasher);
    "negative_preview_base".hash(&mut hasher);
    let cache_key = hasher.finish();

    let base_image_for_processing = {
        let mut cache = state.geometry_cache.lock().unwrap();

        if let Some(cached_img) = cache.get(&cache_key) {
            cached_img.clone()
        } else {
            let image_to_downscale = {
                let original_lock = state.original_image.lock().unwrap();
                if let Some(loaded) = original_lock.as_ref() {
                    if loaded.path == source_path_str {
                        loaded.image.clone().as_ref().clone()
                    } else {
                        drop(original_lock);
                        let settings = load_settings_or_default(&app_handle);

                        match read_file_mapped(Path::new(&source_path_str)) {
                            Ok(mmap) => load_base_image_from_bytes(
                                &mmap,
                                &source_path_str,
                                false,
                                &settings,
                                None,
                            )
                            .map_err(|e| e.to_string())?,
                            Err(_e) => {
                                let bytes = fs::read(&source_path_str)
                                    .map_err(|io_err| io_err.to_string())?;
                                load_base_image_from_bytes(
                                    &bytes,
                                    &source_path_str,
                                    false,
                                    &settings,
                                    None,
                                )
                                .map_err(|e| e.to_string())?
                            }
                        }
                    }
                } else {
                    drop(original_lock);
                    let settings = load_settings_or_default(&app_handle);

                    match read_file_mapped(Path::new(&source_path_str)) {
                        Ok(mmap) => load_base_image_from_bytes(
                            &mmap,
                            &source_path_str,
                            false,
                            &settings,
                            None,
                        )
                        .map_err(|e| e.to_string())?,
                        Err(_e) => {
                            let bytes =
                                fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                            load_base_image_from_bytes(
                                &bytes,
                                &source_path_str,
                                false,
                                &settings,
                                None,
                            )
                            .map_err(|e| e.to_string())?
                        }
                    }
                }
            };

            let downscaled = downscale_f32_image(&image_to_downscale, 1080, 1080);

            cache.insert(cache_key, downscaled.clone());
            downscaled
        }
    };

    let processed = run_pipeline(&base_image_for_processing, &params, None);

    let mut buf = Cursor::new(Vec::new());
    processed
        .to_rgb8()
        .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, 80))
        .map_err(|e| e.to_string())?;

    let base64_str = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(jpeg_data_url(base64_str))
}

#[tauri::command]
pub async fn estimate_negative_base_fog(
    path: String,
    sample_rect: Option<NegativeBaseFogSampleRect>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<NegativeBaseFogEstimate, String> {
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();

    let image = {
        let original_lock = state.original_image.lock().unwrap();
        if let Some(loaded) = original_lock.as_ref() {
            if loaded.path == source_path_str {
                loaded.image.clone().as_ref().clone()
            } else {
                drop(original_lock);
                let settings = load_settings_or_default(&app_handle);
                match read_file_mapped(Path::new(&source_path_str)) {
                    Ok(mmap) => {
                        load_base_image_from_bytes(&mmap, &source_path_str, false, &settings, None)
                    }
                    Err(_) => {
                        let bytes =
                            fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                        load_base_image_from_bytes(&bytes, &source_path_str, false, &settings, None)
                    }
                }
                .map_err(|e| e.to_string())?
            }
        } else {
            drop(original_lock);
            let settings = load_settings_or_default(&app_handle);
            match read_file_mapped(Path::new(&source_path_str)) {
                Ok(mmap) => {
                    load_base_image_from_bytes(&mmap, &source_path_str, false, &settings, None)
                }
                Err(_) => {
                    let bytes = fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                    load_base_image_from_bytes(&bytes, &source_path_str, false, &settings, None)
                }
            }
            .map_err(|e| e.to_string())?
        }
    };

    let downscaled = downscale_f32_image(&image, 1080, 1080);
    Ok(estimate_base_fog_from_image(&downscaled, sample_rect))
}

#[tauri::command]
pub async fn suggest_negative_lab_neutral_patch_rgb_balance(
    path: String,
    params: NegativeConversionParams,
    sample_rect: NegativeBaseFogSampleRect,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<NegativeLabNeutralPatchSuggestion, String> {
    let sanitized_rect = sanitize_sample_rect(sample_rect)
        .ok_or_else(|| "Neutral patch sample rect is invalid.".to_string())?;
    let estimate =
        estimate_negative_base_fog(path, Some(sanitized_rect), state, app_handle).await?;
    Ok(build_negative_lab_neutral_patch_suggestion(
        params,
        sanitized_rect,
        estimate,
    ))
}

#[tauri::command]
pub async fn suggest_negative_lab_highlight_patch_exposure(
    path: String,
    params: NegativeConversionParams,
    current_frame_exposure_offset: f32,
    sample_rect: NegativeBaseFogSampleRect,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<NegativeLabHighlightPatchExposureSuggestion, String> {
    let sanitized_rect = sanitize_sample_rect(sample_rect)
        .ok_or_else(|| "Highlight patch sample rect is invalid.".to_string())?;
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let image = {
        let original_lock = state.original_image.lock().unwrap();
        if let Some(loaded) = original_lock.as_ref() {
            if loaded.path == source_path_str {
                loaded.image.clone().as_ref().clone()
            } else {
                drop(original_lock);
                let settings = load_settings_or_default(&app_handle);
                match read_file_mapped(Path::new(&source_path_str)) {
                    Ok(mmap) => {
                        load_base_image_from_bytes(&mmap, &source_path_str, false, &settings, None)
                    }
                    Err(_) => {
                        let bytes =
                            fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                        load_base_image_from_bytes(&bytes, &source_path_str, false, &settings, None)
                    }
                }
                .map_err(|e| e.to_string())?
            }
        } else {
            drop(original_lock);
            let settings = load_settings_or_default(&app_handle);
            match read_file_mapped(Path::new(&source_path_str)) {
                Ok(mmap) => {
                    load_base_image_from_bytes(&mmap, &source_path_str, false, &settings, None)
                }
                Err(_) => {
                    let bytes = fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                    load_base_image_from_bytes(&bytes, &source_path_str, false, &settings, None)
                }
            }
            .map_err(|e| e.to_string())?
        }
    };
    let downscaled = downscale_f32_image(&image, 1080, 1080);

    Ok(build_negative_lab_highlight_patch_exposure_suggestion(
        &downscaled,
        params,
        current_frame_exposure_offset,
        sanitized_rect,
    ))
}

#[tauri::command]
pub async fn suggest_negative_lab_shadow_patch_black_point(
    path: String,
    params: NegativeConversionParams,
    sample_rect: NegativeBaseFogSampleRect,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<NegativeLabShadowPatchBlackPointSuggestion, String> {
    let sanitized_rect = sanitize_sample_rect(sample_rect)
        .ok_or_else(|| "Shadow patch sample rect is invalid.".to_string())?;
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let image = {
        let original_lock = state.original_image.lock().unwrap();
        if let Some(loaded) = original_lock.as_ref() {
            if loaded.path == source_path_str {
                loaded.image.clone().as_ref().clone()
            } else {
                drop(original_lock);
                let settings = load_settings_or_default(&app_handle);
                match read_file_mapped(Path::new(&source_path_str)) {
                    Ok(mmap) => {
                        load_base_image_from_bytes(&mmap, &source_path_str, false, &settings, None)
                    }
                    Err(_) => {
                        let bytes =
                            fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                        load_base_image_from_bytes(&bytes, &source_path_str, false, &settings, None)
                    }
                }
                .map_err(|e| e.to_string())?
            }
        } else {
            drop(original_lock);
            let settings = load_settings_or_default(&app_handle);
            match read_file_mapped(Path::new(&source_path_str)) {
                Ok(mmap) => {
                    load_base_image_from_bytes(&mmap, &source_path_str, false, &settings, None)
                }
                Err(_) => {
                    let bytes = fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                    load_base_image_from_bytes(&bytes, &source_path_str, false, &settings, None)
                }
            }
            .map_err(|e| e.to_string())?
        }
    };
    let downscaled = downscale_f32_image(&image, 1080, 1080);

    Ok(build_negative_lab_shadow_patch_black_point_suggestion(
        &downscaled,
        params,
        sanitized_rect,
    ))
}

#[tauri::command]
pub async fn convert_negatives(
    paths: Vec<String>,
    params: NegativeConversionParams,
    options: Option<NegativeConversionSaveOptions>,
    app_handle: AppHandle,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut bundle_outputs = Vec::new();
        let save_options = options.unwrap_or_default().sanitized();
        save_options.validate_accepted_batch_plan(paths.len())?;
        let sanitized_params = params.sanitized();

        for (i, path_str) in paths.iter().enumerate() {
            let _ = app_handle.emit(
                "negative-batch-progress",
                serde_json::json!({
                    "current": i + 1,
                    "total": paths.len(),
                    "path": path_str
                }),
            );

            let (source_path, _) = parse_virtual_path(path_str);
            let real_path = source_path.to_string_lossy().to_string();

            let settings = load_settings_or_default(&app_handle);

            let img = match read_file_mapped(Path::new(&real_path)) {
                Ok(mmap) => load_base_image_from_bytes(&mmap, &real_path, false, &settings, None),
                Err(_) => {
                    let bytes = fs::read(&real_path).unwrap_or_default();
                    load_base_image_from_bytes(&bytes, &real_path, false, &settings, None)
                }
            }
            .map_err(|e| e.to_string())?;

            let bounds_ref = downscale_f32_image(&img, 1080, 1080);
            let ref_rgb = bounds_ref.to_rgb32f();
            let (ref_w, ref_h) = ref_rgb.dimensions();
            let log_pixels: Vec<f32> = ref_rgb
                .as_raw()
                .par_iter()
                .map(|&v| -v.clamp(1e-6, 1.0).log10())
                .collect();
            let effective_params =
                save_options.effective_params_for_path(&sanitized_params, &real_path);
            let bounds = analyze_bounds(
                &log_pixels,
                ref_w as usize,
                ref_h as usize,
                effective_params.base_fog_sample,
            );

            let processed = run_pipeline(&img, &effective_params, Some(bounds));

            let out_path = build_negative_output_path(&real_path, &save_options);
            let filename = out_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            match save_options.output_format {
                NegativeConversionOutputFormat::JpegProof => {
                    let mut buf = Cursor::new(Vec::new());
                    processed
                        .to_rgb8()
                        .write_with_encoder(JpegEncoder::new_with_quality(
                            &mut buf,
                            JPEG_PROOF_QUALITY,
                        ))
                        .map_err(|e| format!("Failed to encode {}: {}", filename, e))?;
                    fs::write(&out_path, buf.into_inner())
                        .map_err(|e| format!("Failed to save {}: {}", filename, e))?;
                }
                NegativeConversionOutputFormat::Tiff16 => {
                    processed
                        .to_rgb16()
                        .save(&out_path)
                        .map_err(|e| format!("Failed to save {}: {}", filename, e))?;
                }
            }

            let _ = crate::exif_processing::write_rrexif_sidecar(&real_path, &out_path);
            write_negative_lab_output_sidecar(
                &out_path,
                Path::new(&real_path),
                &effective_params,
                &save_options,
                processed.width(),
                processed.height(),
            )?;
            bundle_outputs.push(NegativeLabConversionBundleOutputRef {
                output_height: processed.height(),
                output_path: out_path.clone(),
                output_width: processed.width(),
                sidecar_path: negative_lab_output_sidecar_path(&out_path),
                source_path: PathBuf::from(&real_path),
            });
            results.push(out_path.to_string_lossy().to_string());
        }

        if save_options.write_conversion_bundle
            && let Some(first_output) = bundle_outputs.first()
        {
            write_negative_lab_conversion_bundle(
                &negative_lab_conversion_bundle_path(&first_output.output_path),
                &sanitized_params,
                &save_options,
                &bundle_outputs,
            )?;
        }

        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_settings::AppSettings;
    use crate::formats::is_raw_file;
    use crate::image_loader::load_base_image_from_bytes;
    use image::{DynamicImage, Pixel, Rgb32FImage};
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::path::PathBuf;

    fn render_fixture(
        pixels: Vec<f32>,
        params: NegativeConversionParams,
        bounds: [ChannelBounds; 3],
    ) -> Rgb32FImage {
        let input = DynamicImage::ImageRgb32F(Rgb32FImage::from_vec(3, 1, pixels).unwrap());
        run_pipeline(&input, &params, Some(bounds)).to_rgb32f()
    }

    fn luminance(pixel: image::Rgb<f32>) -> f32 {
        let channels = pixel.channels();
        0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }

    fn assert_images_near(left: &Rgb32FImage, right: &Rgb32FImage) {
        assert_eq!(left.dimensions(), right.dimensions());

        for (left_pixel, right_pixel) in left.pixels().zip(right.pixels()) {
            for (left_channel, right_channel) in
                left_pixel.channels().iter().zip(right_pixel.channels())
            {
                assert!(
                    (left_channel - right_channel).abs() <= 0.000_001,
                    "expected matching preview/export channel values, got {left_channel} and {right_channel}"
                );
            }
        }
    }

    fn mean_abs_delta(left: &Rgb32FImage, right: &Rgb32FImage) -> f32 {
        assert_eq!(left.dimensions(), right.dimensions());

        let mut total = 0.0_f32;
        let mut count = 0_u32;
        for (left_pixel, right_pixel) in left.pixels().zip(right.pixels()) {
            for (left_channel, right_channel) in
                left_pixel.channels().iter().zip(right_pixel.channels())
            {
                total += (left_channel - right_channel).abs();
                count += 1;
            }
        }

        total / count.max(1) as f32
    }

    fn hash_rendered_image(image: &Rgb32FImage) -> String {
        let mut hash = 0xcbf29ce484222325_u64;
        for pixel in image.pixels() {
            for channel in pixel.channels() {
                for byte in channel.to_bits().to_le_bytes() {
                    hash ^= u64::from(byte);
                    hash = hash.wrapping_mul(0x100000001b3);
                }
            }
        }

        format!("fnv1a64:{hash:016x}")
    }

    fn assert_near(left: f32, right: f32) {
        assert!(
            (left - right).abs() <= 0.000_001,
            "expected {left} to be within tolerance of {right}"
        );
    }

    #[test]
    fn negative_lab_neutral_patch_suggestion_snaps_and_applies_frame_rgb_offset() {
        let suggestion = build_negative_lab_neutral_patch_suggestion(
            NegativeConversionParams {
                red_weight: 1.07,
                green_weight: 0.96,
                blue_weight: 1.18,
                ..NegativeConversionParams::default()
            },
            NegativeBaseFogSampleRect {
                x: 0.18,
                y: 0.62,
                width: 0.18,
                height: 0.18,
            },
            NegativeBaseFogEstimate {
                red_weight: 1.143,
                green_weight: 0.934,
                blue_weight: 1.159,
                base_rgb: [0.716, 0.578, 0.441],
                base_density: [0.145, 0.238, 0.356],
                confidence: 0.82,
            },
        );

        assert_eq!(suggestion.neutrality_risk, "high");
        assert_eq!(suggestion.application_risk, "low");
        assert!(suggestion.apply_allowed);
        assert!(!suggestion.offset_clamped);
        assert_near(suggestion.correction_magnitude, 0.07);
        assert_near(suggestion.suggested_rgb_balance_offset.red_weight, 0.07);
        assert_near(suggestion.suggested_rgb_balance_offset.green_weight, -0.03);
        assert_near(suggestion.suggested_rgb_balance_offset.blue_weight, -0.02);
        assert_near(suggestion.effective_rgb_balance.red_weight, 1.14);
        assert_near(suggestion.effective_rgb_balance.green_weight, 0.93);
        assert_near(suggestion.effective_rgb_balance.blue_weight, 1.16);
    }

    #[test]
    fn negative_lab_neutrality_risk_uses_density_spread_thresholds() {
        assert_eq!(negative_lab_neutrality_risk([0.1, 0.15, 0.17]), "low");
        assert_eq!(negative_lab_neutrality_risk([0.1, 0.2, 0.28]), "medium");
        assert_eq!(negative_lab_neutrality_risk([0.1, 0.22, 0.31]), "high");
    }

    #[test]
    fn negative_lab_neutral_patch_suggestion_blocks_extreme_clamped_offset() {
        let suggestion = build_negative_lab_neutral_patch_suggestion(
            NegativeConversionParams {
                red_weight: 0.5,
                green_weight: 1.0,
                blue_weight: 1.0,
                ..NegativeConversionParams::default()
            },
            NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.2,
                height: 0.2,
            },
            NegativeBaseFogEstimate {
                red_weight: 2.5,
                green_weight: 1.22,
                blue_weight: 1.08,
                base_rgb: [0.7, 0.7, 0.7],
                base_density: [0.16, 0.17, 0.18],
                confidence: 0.7,
            },
        );

        assert_eq!(suggestion.application_risk, "high");
        assert!(!suggestion.apply_allowed);
        assert!(suggestion.offset_clamped);
        assert_near(suggestion.correction_magnitude, 1.5);
        assert_near(suggestion.suggested_rgb_balance_offset.red_weight, 1.5);
    }

    #[test]
    fn negative_lab_highlight_patch_exposure_suggestion_recovers_clipped_patch() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                6,
                4,
                vec![
                    0.004, 0.004, 0.004, 0.005, 0.005, 0.005, 0.007, 0.007, 0.007, 0.42, 0.38,
                    0.34, 0.58, 0.52, 0.46, 0.001, 0.001, 0.001, 0.004, 0.004, 0.004, 0.005, 0.005,
                    0.005, 0.007, 0.007, 0.007, 0.42, 0.38, 0.34, 0.58, 0.52, 0.46, 0.001, 0.001,
                    0.001, 0.004, 0.004, 0.004, 0.005, 0.005, 0.005, 0.007, 0.007, 0.007, 0.42,
                    0.38, 0.34, 0.58, 0.52, 0.46, 0.001, 0.001, 0.001, 0.004, 0.004, 0.004, 0.005,
                    0.005, 0.005, 0.007, 0.007, 0.007, 0.42, 0.38, 0.34, 0.58, 0.52, 0.46, 0.001,
                    0.001, 0.001,
                ],
            )
            .unwrap(),
        );
        let suggestion = build_negative_lab_highlight_patch_exposure_suggestion(
            &input,
            NegativeConversionParams {
                exposure: 2.0,
                contrast: 1.2,
                base_fog_sample: Some(NegativeBaseFogSampleRect {
                    x: 0.0,
                    y: 0.0,
                    width: 1.0,
                    height: 1.0,
                }),
                ..NegativeConversionParams::default()
            },
            0.0,
            NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.35,
                height: 1.0,
            },
        );

        assert_eq!(suggestion.role, "highlight");
        assert_eq!(suggestion.status, "suggested");
        assert!(suggestion.apply_allowed);
        assert!(suggestion.suggested_exposure_delta_ev < 0.0);
        assert!(suggestion.correction_magnitude_ev <= 0.75);
        assert!(
            suggestion.projected_sample_p99_max_channel <= NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING
        );
        assert!(
            suggestion.projected_frame_clipped_fraction
                <= suggestion.current_frame_clipped_fraction
        );
    }

    #[test]
    fn negative_lab_highlight_patch_exposure_suggestion_reports_already_safe_patch() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                2,
                2,
                vec![
                    0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50,
                ],
            )
            .unwrap(),
        );
        let suggestion = build_negative_lab_highlight_patch_exposure_suggestion(
            &input,
            NegativeConversionParams {
                exposure: -1.4,
                contrast: 0.8,
                ..NegativeConversionParams::default()
            },
            0.0,
            NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        );

        assert_eq!(suggestion.status, "already_safe");
        assert!(!suggestion.apply_allowed);
        assert_near(suggestion.suggested_exposure_delta_ev, 0.0);
        assert!(
            suggestion.current_sample_p99_max_channel <= NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING
        );
    }

    #[test]
    fn negative_lab_shadow_patch_black_point_suggestion_recovers_lifted_shadow() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                4,
                vec![
                    0.99, 0.99, 0.99, 0.72, 0.72, 0.72, 0.68, 0.68, 0.68, 0.22, 0.22, 0.22, 0.99,
                    0.99, 0.99, 0.72, 0.72, 0.72, 0.68, 0.68, 0.68, 0.22, 0.22, 0.22, 0.99, 0.99,
                    0.99, 0.72, 0.72, 0.72, 0.68, 0.68, 0.68, 0.22, 0.22, 0.22, 0.99, 0.99, 0.99,
                    0.72, 0.72, 0.72, 0.68, 0.68, 0.68, 0.22, 0.22, 0.22,
                ],
            )
            .unwrap(),
        );
        let suggestion = build_negative_lab_shadow_patch_black_point_suggestion(
            &input,
            NegativeConversionParams {
                black_point: 0.0,
                contrast: 1.0,
                exposure: 0.0,
                white_point: 1.0,
                ..NegativeConversionParams::default()
            },
            NegativeBaseFogSampleRect {
                x: 0.25,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            },
        );

        assert_eq!(suggestion.role, "shadow");
        assert_eq!(suggestion.status, "suggested");
        assert!(suggestion.apply_allowed);
        assert!(suggestion.suggested_black_point_delta > 0.0);
        assert!(suggestion.correction_magnitude <= 0.35);
        assert!(suggestion.projected_sample_p01_min_channel <= NEGATIVE_LAB_SHADOW_TARGET_FLOOR);
    }

    #[test]
    fn negative_lab_shadow_patch_black_point_suggestion_reports_already_safe_patch() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                2,
                2,
                vec![
                    0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
                ],
            )
            .unwrap(),
        );
        let suggestion = build_negative_lab_shadow_patch_black_point_suggestion(
            &input,
            NegativeConversionParams {
                black_point: 0.0,
                contrast: 1.0,
                exposure: 0.0,
                white_point: 1.0,
                ..NegativeConversionParams::default()
            },
            NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        );

        assert_eq!(suggestion.status, "already_safe");
        assert!(!suggestion.apply_allowed);
        assert_near(suggestion.suggested_black_point_delta, 0.0);
        assert!(suggestion.current_sample_p01_min_channel <= NEGATIVE_LAB_SHADOW_TARGET_FLOOR);
    }

    #[test]
    fn negative_conversion_params_clamp_to_supported_api_range() {
        let sanitized = NegativeConversionParams {
            red_weight: f32::NAN,
            green_weight: 99.0,
            blue_weight: -99.0,
            base_fog_strength: f32::NAN,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: f32::NAN,
                y: 0.0,
                width: 0.1,
                height: 0.1,
            }),
            exposure: f32::INFINITY,
            contrast: f32::NEG_INFINITY,
            black_point: f32::NAN,
            white_point: f32::NEG_INFINITY,
        }
        .sanitized();

        assert_eq!(
            sanitized.red_weight,
            NegativeConversionParams::default().red_weight
        );
        assert_eq!(sanitized.green_weight, MAX_CHANNEL_WEIGHT);
        assert_eq!(sanitized.blue_weight, MIN_CHANNEL_WEIGHT);
        assert_eq!(
            sanitized.base_fog_strength,
            NegativeConversionParams::default().base_fog_strength
        );
        assert!(sanitized.base_fog_sample.is_none());
        assert_eq!(
            sanitized.exposure,
            NegativeConversionParams::default().exposure
        );
        assert_eq!(
            sanitized.contrast,
            NegativeConversionParams::default().contrast
        );
        assert_eq!(
            sanitized.black_point,
            NegativeConversionParams::default().black_point
        );
        assert_eq!(
            sanitized.white_point,
            NegativeConversionParams::default().white_point
        );
    }

    #[test]
    fn negative_conversion_save_options_sanitize_output_suffix() {
        let sanitized = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: Some("fnv1a32:2f4a91bc".to_string()),
            output_format: NegativeConversionOutputFormat::JpegProof,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: " Proof / Final:01 ".to_string(),
        }
        .sanitized();

        assert!(matches!(
            sanitized.output_format,
            NegativeConversionOutputFormat::JpegProof
        ));
        assert_eq!(sanitized.suffix, "_Proof__Final01_");
        assert_eq!(
            sanitized.profile_provenance_hash.as_deref(),
            Some("fnv1a32:2f4a91bc")
        );
    }

    #[test]
    fn negative_conversion_save_options_default_empty_suffix() {
        let sanitized = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: Some("not-a-hash".to_string()),
            output_format: NegativeConversionOutputFormat::Tiff16,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: "///".to_string(),
        }
        .sanitized();

        assert_eq!(sanitized.suffix, DEFAULT_OUTPUT_SUFFIX);
        assert!(sanitized.profile_provenance_hash.is_none());
    }

    #[test]
    fn negative_conversion_output_paths_keep_original_safe() {
        let jpeg_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: None,
            output_format: NegativeConversionOutputFormat::JpegProof,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: "Web Proof".to_string(),
        }
        .sanitized();
        let tiff_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: None,
            accepted_dry_run_plan_id: None,
            profile_provenance_hash: None,
            output_format: NegativeConversionOutputFormat::Tiff16,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: "".to_string(),
        }
        .sanitized();

        let source_path = "/roll_01/frame_001.tif";
        let jpeg_output = build_negative_output_path(source_path, &jpeg_options);
        let tiff_output = build_negative_output_path(source_path, &tiff_options);

        assert_eq!(
            jpeg_output,
            PathBuf::from("/roll_01/frame_001_Web_Proof.jpg")
        );
        assert_eq!(
            tiff_output,
            PathBuf::from("/roll_01/frame_001_Positive.tiff")
        );
        assert_ne!(jpeg_output, PathBuf::from(source_path));
        assert_ne!(tiff_output, PathBuf::from(source_path));
    }

    #[test]
    fn negative_conversion_batch_exports_require_accepted_plan_identity() {
        let missing_plan = NegativeConversionSaveOptions::default();
        assert!(
            missing_plan.validate_accepted_batch_plan(2).is_err(),
            "batch export without accepted plan should fail"
        );
        assert!(missing_plan.validate_accepted_batch_plan(1).is_ok());

        let accepted_plan = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            profile_provenance_hash: Some("fnv1a32:aaaaaaaa".to_string()),
            output_format: NegativeConversionOutputFormat::Tiff16,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };
        assert!(accepted_plan.validate_accepted_batch_plan(2).is_ok());

        let mismatched_plan = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_deadbeef".to_string()),
            profile_provenance_hash: None,
            output_format: NegativeConversionOutputFormat::Tiff16,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };
        assert!(mismatched_plan.validate_accepted_batch_plan(2).is_err());
    }

    #[test]
    fn negative_conversion_applies_path_scoped_frame_exposure_override() {
        let base_params = NegativeConversionParams {
            exposure: -0.05,
            ..NegativeConversionParams::default()
        }
        .sanitized();
        let save_options = NegativeConversionSaveOptions {
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload {
                overrides: vec![NegativeLabFrameExposureOverride {
                    effective_exposure: 0.45,
                    exposure_offset: 0.5,
                    frame_id: "negative-lab-frame-1".to_string(),
                    source_path: "/roll/frame-001.tif".to_string(),
                }],
                schema_version: 1,
            },
            ..NegativeConversionSaveOptions::default()
        }
        .sanitized();

        assert_eq!(
            save_options
                .effective_params_for_path(&base_params, "/roll/frame-001.tif")
                .exposure,
            0.45
        );
        assert_eq!(
            save_options
                .effective_params_for_path(&base_params, "/roll/frame-002.tif")
                .exposure,
            -0.05
        );
    }

    #[test]
    fn negative_conversion_applies_path_scoped_frame_rgb_balance_override() {
        let base_params = NegativeConversionParams {
            blue_weight: 1.0,
            exposure: -0.05,
            green_weight: 0.95,
            red_weight: 1.05,
            ..NegativeConversionParams::default()
        }
        .sanitized();
        let save_options = NegativeConversionSaveOptions {
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload {
                overrides: vec![NegativeLabFrameExposureOverride {
                    effective_exposure: 0.25,
                    exposure_offset: 0.3,
                    frame_id: "negative-lab-frame-1".to_string(),
                    source_path: "/roll/frame-001.tif".to_string(),
                }],
                schema_version: 1,
            },
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload {
                overrides: vec![NegativeLabFrameRgbBalanceOverride {
                    frame_id: "negative-lab-frame-1".to_string(),
                    rgb_balance_offset: NegativeLabFrameRgbBalance {
                        blue_weight: 0.12,
                        green_weight: -0.04,
                        red_weight: 0.13,
                    },
                    source_path: "/roll/frame-001.tif".to_string(),
                }],
                schema_version: 1,
            },
            ..NegativeConversionSaveOptions::default()
        }
        .sanitized();
        let frame_one_params =
            save_options.effective_params_for_path(&base_params, "/roll/frame-001.tif");
        let frame_two_params =
            save_options.effective_params_for_path(&base_params, "/roll/frame-002.tif");

        assert_eq!(frame_one_params.exposure, 0.25);
        assert_near(frame_one_params.red_weight, 1.18);
        assert_near(frame_one_params.green_weight, 0.91);
        assert_near(frame_one_params.blue_weight, 1.12);
        assert_eq!(frame_two_params.exposure, -0.05);
        assert_near(frame_two_params.red_weight, 1.05);

        let bounds = [
            ChannelBounds {
                min: 0.02,
                max: 1.5,
            },
            ChannelBounds {
                min: 0.02,
                max: 1.5,
            },
            ChannelBounds {
                min: 0.02,
                max: 1.5,
            },
        ];
        let pixels = vec![
            0.92, 0.72, 0.52, //
            0.22, 0.16, 0.10, //
            0.03, 0.02, 0.01,
        ];
        let baseline_render = render_fixture(pixels.clone(), base_params, bounds);
        let override_render = render_fixture(pixels.clone(), frame_one_params, bounds);
        let reset_render = render_fixture(pixels, base_params, bounds);

        assert_ne!(
            hash_rendered_image(&baseline_render),
            hash_rendered_image(&override_render)
        );
        assert_eq!(
            hash_rendered_image(&baseline_render),
            hash_rendered_image(&reset_render)
        );
        assert!(mean_abs_delta(&baseline_render, &override_render) > 0.001);
    }

    #[test]
    fn negative_conversion_save_options_deserialize_frame_override_payloads() {
        let payload = json!({
            "frameExposureOverrides": {
                "overrides": [{
                    "effectiveExposure": 0.25,
                    "exposureOffset": 0.3,
                    "frameId": "negative-lab-frame-1",
                    "sourcePath": "/roll/frame-001.tif"
                }],
                "schemaVersion": 1
            },
            "frameRgbBalanceOverrides": {
                "overrides": [{
                    "frameId": "negative-lab-frame-1",
                    "rgbBalanceOffset": {
                        "blueWeight": 0.12,
                        "greenWeight": -0.04,
                        "redWeight": 0.13
                    },
                    "sourcePath": "/roll/frame-001.tif"
                }],
                "schemaVersion": 1
            },
            "outputFormat": "jpeg_proof",
            "suffix": "Positive",
            "writeConversionBundle": true
        });
        let save_options: NegativeConversionSaveOptions = serde_json::from_value(payload)
            .expect("versioned frame override payloads should deserialize");

        assert_eq!(save_options.frame_exposure_overrides.schema_version, 1);
        assert_eq!(save_options.frame_exposure_overrides.overrides.len(), 1);
        assert_eq!(save_options.frame_rgb_balance_overrides.schema_version, 1);
        assert_eq!(
            save_options.frame_rgb_balance_overrides.overrides[0]
                .rgb_balance_offset
                .red_weight,
            0.13
        );
    }

    #[test]
    fn negative_lab_output_sidecar_records_profile_provenance() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let source_path = temp_dir.path().join("frame_001.tif");
        let output_path = temp_dir.path().join("frame_001_Positive.tiff");
        fs::write(&source_path, b"negative-source").expect("source should be written");
        fs::write(&output_path, b"positive-output").expect("output should be written");
        let params = NegativeConversionParams {
            red_weight: 1.03,
            green_weight: 0.99,
            blue_weight: 1.02,
            base_fog_strength: 1.0,
            base_fog_sample: None,
            exposure: 0.1,
            contrast: 1.08,
            black_point: 0.0,
            white_point: 1.0,
        };
        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            profile_provenance_hash: Some("fnv1a32:aaaaaaaa".to_string()),
            output_format: NegativeConversionOutputFormat::Tiff16,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            selected_profile: Some(NegativeLabSelectedProfileSnapshot {
                claim_level: "measured_profile".to_string(),
                claim_policy: "process_family_profile_no_stock_claim".to_string(),
                display_name: "Measured C-41 Process Family".to_string(),
                does_not_prove: vec![
                    "no_stock_emulation_claim".to_string(),
                    "no_colorimetric_match_claim".to_string(),
                ],
                evidence_fixture_count: 1,
                measurement_profile_id: Some(
                    "negative_lab.measured.c41.process_family.v1".to_string(),
                ),
                params,
                preset_id: "negative_lab.measured.c41.process_family.v1".to_string(),
                profile_provenance_hash: "fnv1a32:aaaaaaaa".to_string(),
                profile_status: "fixture_measured".to_string(),
                provenance_summary: "Fixture-measured process-family profile.".to_string(),
                runtime_status: "runtime_parameter_applied".to_string(),
                source_generic_preset_id: Some("negative_lab.generic.c41.neutral.v1".to_string()),
            }),
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };

        write_negative_lab_output_sidecar(
            &output_path,
            &source_path,
            &params,
            &save_options,
            12,
            8,
        )
        .expect("sidecar should be written");

        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        let sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        let artifact = sidecar
            .raw_engine_artifacts
            .expect("rawEngineArtifacts should be present")
            .negative_lab_artifacts
            .pop()
            .expect("Negative Lab artifact should be present");

        assert_eq!(artifact["operationId"], "negative_lab.convert");
        assert_eq!(
            artifact["conversion"]["profileProvenanceHash"],
            "fnv1a32:aaaaaaaa"
        );
        assert_eq!(
            artifact["conversion"]["selectedProfile"]["presetId"],
            "negative_lab.measured.c41.process_family.v1"
        );
        assert_eq!(
            artifact["provenance"]["selectedProfile"]["profileProvenanceHash"],
            "fnv1a32:aaaaaaaa"
        );
        assert_eq!(
            artifact["conversion"]["acceptedDryRunPlanId"],
            "negative_lab_batch_plan_2f4a91bc"
        );
        assert_eq!(artifact["outputArtifacts"][0]["dimensions"]["width"], 12);
        assert_eq!(artifact["outputArtifacts"][0]["dimensions"]["height"], 8);
        assert_eq!(
            artifact["outputArtifacts"][0]["kind"],
            "negative_lab_positive"
        );
        assert_eq!(
            artifact["outputArtifacts"][0]["storage"],
            "sidecar_artifact"
        );
        assert!(
            artifact["outputArtifacts"][0]["contentHash"]
                .as_str()
                .unwrap_or_default()
                .starts_with("fnv1a64:")
        );
    }

    #[test]
    fn negative_lab_conversion_bundle_records_runtime_outputs() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let source_path = temp_dir.path().join("frame_001.tif");
        let output_path = temp_dir.path().join("frame_001_Positive.jpg");
        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        fs::write(&source_path, b"negative-source").expect("source should be written");
        fs::write(&output_path, b"positive-output").expect("output should be written");
        fs::write(&sidecar_path, b"{}").expect("sidecar should be written");
        let params = NegativeConversionParams {
            red_weight: 1.03,
            green_weight: 1.0,
            blue_weight: 0.98,
            base_fog_strength: 1.0,
            base_fog_sample: None,
            exposure: 0.05,
            contrast: 0.95,
            black_point: 0.0,
            white_point: 1.0,
        };
        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            output_format: NegativeConversionOutputFormat::JpegProof,
            write_conversion_bundle: true,
            acquisition_warning_codes: vec!["lossy_source_for_negative_lab".to_string()],
            acquisition_source_families: vec!["jpeg_lossy".to_string()],
            profile_provenance_hash: Some("fnv1a32:9ed1e301".to_string()),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };
        let bundle_path = negative_lab_conversion_bundle_path(&output_path);

        write_negative_lab_conversion_bundle(
            &bundle_path,
            &params,
            &save_options,
            &[NegativeLabConversionBundleOutputRef {
                output_height: 8,
                output_path,
                output_width: 12,
                sidecar_path,
                source_path,
            }],
        )
        .expect("conversion bundle should be written");

        let bundle: serde_json::Value =
            serde_json::from_slice(&fs::read(&bundle_path).expect("read conversion bundle"))
                .expect("parse conversion bundle");
        assert_eq!(bundle["schemaVersion"], 1);
        assert_eq!(bundle["conversion"]["outputFormat"], "jpeg_proof");
        assert_eq!(
            bundle["conversion"]["profileProvenanceHash"],
            "fnv1a32:9ed1e301"
        );
        assert_eq!(
            bundle["acquisition"]["warningCodes"][0],
            "lossy_source_for_negative_lab"
        );
        assert_eq!(bundle["outputs"][0]["filename"], "frame_001_Positive.jpg");
        assert_eq!(
            bundle["outputs"][0]["sidecarFilename"],
            "frame_001_Positive.jpg.rrdata"
        );
        assert_eq!(
            bundle["replay"]["appServerCommand"],
            "negative.lab.conversion_plan"
        );
    }

    #[test]
    fn negative_conversion_rejects_pathological_api_values_before_density_math() {
        let rendered = render_fixture(
            vec![
                0.92, 0.72, 0.52, //
                0.22, 0.16, 0.10, //
                0.03, 0.02, 0.01,
            ],
            NegativeConversionParams {
                red_weight: f32::NAN,
                green_weight: f32::INFINITY,
                blue_weight: f32::NEG_INFINITY,
                base_fog_strength: 99.0,
                base_fog_sample: None,
                exposure: 50.0,
                contrast: -50.0,
                black_point: 0.99,
                white_point: 0.01,
            },
            [
                ChannelBounds {
                    min: 0.02,
                    max: 1.5,
                },
                ChannelBounds {
                    min: 0.02,
                    max: 1.5,
                },
                ChannelBounds {
                    min: 0.02,
                    max: 1.5,
                },
            ],
        );

        for pixel in rendered.pixels() {
            for channel in pixel.channels() {
                assert!(channel.is_finite());
                assert!((0.0..=1.0).contains(channel));
            }
        }
    }

    #[test]
    fn color_negative_fixture_renders_finite_monotonic_positive_values() {
        let rendered = render_fixture(
            vec![
                0.82, 0.64, 0.46, //
                0.36, 0.28, 0.20, //
                0.09, 0.07, 0.05,
            ],
            NegativeConversionParams {
                red_weight: 1.2,
                green_weight: 1.0,
                blue_weight: 0.75,
                base_fog_strength: 1.0,
                base_fog_sample: None,
                exposure: 0.0,
                contrast: 1.0,
                black_point: 0.0,
                white_point: 1.0,
            },
            [
                ChannelBounds {
                    min: 0.05,
                    max: 1.2,
                },
                ChannelBounds {
                    min: 0.08,
                    max: 1.25,
                },
                ChannelBounds {
                    min: 0.12,
                    max: 1.35,
                },
            ],
        );

        let thin = luminance(*rendered.get_pixel(0, 0));
        let mid = luminance(*rendered.get_pixel(1, 0));
        let dense = luminance(*rendered.get_pixel(2, 0));

        for pixel in rendered.pixels() {
            for channel in pixel.channels() {
                assert!(channel.is_finite());
                assert!((0.0..=1.0).contains(channel));
            }
        }

        assert!(
            thin < mid,
            "denser color negative sample should render brighter than thin sample"
        );
        assert!(
            mid < dense,
            "densest color negative sample should render brightest"
        );

        let mid_pixel = rendered.get_pixel(1, 0).channels();
        let color_spread = (mid_pixel[0] - mid_pixel[2]).abs();
        assert!(
            color_spread > 0.01,
            "color fixture should preserve channel-specific response"
        );
    }

    #[test]
    fn negative_conversion_black_white_points_remap() {
        let pixels = vec![
            0.82, 0.64, 0.46, //
            0.36, 0.28, 0.20, //
            0.09, 0.07, 0.05,
        ];
        let bounds = [
            ChannelBounds {
                min: 0.05,
                max: 1.2,
            },
            ChannelBounds {
                min: 0.08,
                max: 1.25,
            },
            ChannelBounds {
                min: 0.12,
                max: 1.35,
            },
        ];

        let baseline = render_fixture(pixels.clone(), NegativeConversionParams::default(), bounds);
        let tightened = render_fixture(
            pixels.clone(),
            NegativeConversionParams {
                black_point: 0.18,
                white_point: 0.82,
                ..NegativeConversionParams::default()
            },
            bounds,
        );
        let reset = render_fixture(
            pixels,
            NegativeConversionParams {
                black_point: 0.0,
                white_point: 1.0,
                ..NegativeConversionParams::default()
            },
            bounds,
        );

        assert_ne!(
            hash_rendered_image(&baseline),
            hash_rendered_image(&tightened),
            "non-default print endpoints should change rendered positive pixels"
        );
        assert_eq!(
            hash_rendered_image(&baseline),
            hash_rendered_image(&reset),
            "reset endpoints should match default render identity"
        );
    }

    #[test]
    fn black_and_white_negative_fixture_renders_neutral_monotonic_values() {
        let rendered = render_fixture(
            vec![
                0.78, 0.78, 0.78, //
                0.32, 0.32, 0.32, //
                0.08, 0.08, 0.08,
            ],
            NegativeConversionParams::default(),
            [
                ChannelBounds {
                    min: 0.05,
                    max: 1.2,
                },
                ChannelBounds {
                    min: 0.05,
                    max: 1.2,
                },
                ChannelBounds {
                    min: 0.05,
                    max: 1.2,
                },
            ],
        );

        let thin = luminance(*rendered.get_pixel(0, 0));
        let mid = luminance(*rendered.get_pixel(1, 0));
        let dense = luminance(*rendered.get_pixel(2, 0));

        assert!(
            thin < mid,
            "denser black-and-white sample should render brighter than thin sample"
        );
        assert!(
            mid < dense,
            "densest black-and-white sample should render brightest"
        );

        for pixel in rendered.pixels() {
            let channels = pixel.channels();
            let max_chroma_delta = (channels[0] - channels[1])
                .abs()
                .max((channels[1] - channels[2]).abs())
                .max((channels[0] - channels[2]).abs());

            assert!(
                max_chroma_delta <= 0.0001,
                "black-and-white fixture should remain neutral"
            );
        }
    }

    #[test]
    fn base_fog_strength_changes_thin_density_rendering() {
        let pixels = vec![
            0.72, 0.56, 0.38, //
            0.30, 0.22, 0.16, //
            0.08, 0.06, 0.04,
        ];
        let bounds = [
            ChannelBounds {
                min: 0.12,
                max: 1.2,
            },
            ChannelBounds {
                min: 0.16,
                max: 1.25,
            },
            ChannelBounds {
                min: 0.22,
                max: 1.35,
            },
        ];
        let corrected = render_fixture(pixels.clone(), NegativeConversionParams::default(), bounds);
        let uncorrected = render_fixture(
            pixels,
            NegativeConversionParams {
                base_fog_strength: 0.0,
                ..NegativeConversionParams::default()
            },
            bounds,
        );

        assert_ne!(
            corrected.get_pixel(0, 0).channels(),
            uncorrected.get_pixel(0, 0).channels()
        );
    }

    #[test]
    fn negative_preview_and_export_fixture_share_density_pipeline() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                2,
                vec![
                    0.92, 0.75, 0.42, 0.80, 0.58, 0.32, 0.44, 0.30, 0.18, 0.18, 0.12, 0.08, //
                    0.88, 0.70, 0.38, 0.68, 0.48, 0.26, 0.36, 0.24, 0.14, 0.12, 0.08, 0.05,
                ],
            )
            .unwrap(),
        );
        let params = NegativeConversionParams {
            red_weight: 1.07,
            green_weight: 0.96,
            blue_weight: 1.18,
            base_fog_strength: 1.0,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            }),
            exposure: 0.05,
            contrast: 1.1,
            black_point: 0.0,
            white_point: 1.0,
        };
        let rgb = input.to_rgb32f();
        let (width, height) = rgb.dimensions();
        let log_pixels: Vec<f32> = rgb
            .as_raw()
            .iter()
            .map(|&v| -v.clamp(1e-6, 1.0).log10())
            .collect();
        let export_bounds = analyze_bounds(
            &log_pixels,
            width as usize,
            height as usize,
            params.base_fog_sample,
        );

        let preview_render = run_pipeline(&input, &params, None).to_rgb32f();
        let export_render = run_pipeline(&input, &params, Some(export_bounds)).to_rgb32f();

        assert_images_near(&preview_render, &export_render);
        assert_ne!(
            preview_render.get_pixel(0, 0).channels(),
            preview_render.get_pixel(3, 1).channels()
        );
    }

    #[test]
    fn negative_density_cpu_report_proves_apply_capable_fixture_path() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                2,
                vec![
                    0.95, 0.83, 0.44, 0.88, 0.70, 0.38, 0.50, 0.31, 0.18, 0.08, 0.05, 0.03, //
                    0.92, 0.78, 0.38, 0.68, 0.48, 0.26, 0.32, 0.20, 0.12, 0.06, 0.04, 0.02,
                ],
            )
            .unwrap(),
        );
        let params = NegativeConversionParams {
            red_weight: 1.07,
            green_weight: 0.96,
            blue_weight: 1.18,
            base_fog_strength: 1.0,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            }),
            exposure: 0.05,
            contrast: 1.1,
            black_point: 0.0,
            white_point: 1.0,
        };
        let rendered = run_pipeline(&input, &params, None).to_rgb32f();
        let input_rgb = input.to_rgb32f();
        let input_to_output_delta = mean_abs_delta(&input_rgb, &rendered);
        let changed_pixel_count = rendered
            .pixels()
            .zip(input_rgb.pixels())
            .filter(|(rendered_pixel, input_pixel)| {
                rendered_pixel
                    .channels()
                    .iter()
                    .zip(input_pixel.channels())
                    .any(|(rendered_channel, input_channel)| {
                        (rendered_channel - input_channel).abs() > 0.01
                    })
            })
            .count();
        let monotonic_luma = luminance(*rendered.get_pixel(0, 0))
            < luminance(*rendered.get_pixel(1, 0))
            && luminance(*rendered.get_pixel(1, 0)) < luminance(*rendered.get_pixel(3, 0));

        assert!(input_to_output_delta > 0.05);
        assert!(changed_pixel_count > 0);
        assert!(monotonic_luma);

        if let Ok(report_path) = std::env::var("RAWENGINE_NEGATIVE_LAB_DENSITY_CPU_REPORT") {
            let report = json!({
                "algorithm": "density_rgb_v1",
                "artifactHash": hash_rendered_image(&rendered),
                "changedPixelCount": changed_pixel_count,
                "doesNotProve": [
                    "camera_raw_decode_path",
                    "automatic_base_fog_estimation",
                    "display_referred_input_accuracy",
                    "neutralization_accuracy",
                    "colorimetric_scene_reconstruction",
                    "roll_batch_execution",
                    "ui_app_server_e2e",
                    "commercial_converter_parity"
                ],
                "inputContract": "declared_linear_scan_rgb",
                "inputToOutputMeanAbsDelta": input_to_output_delta,
                "issue": 2343,
                "monotonicLuma": monotonic_luma,
                "outputDimensions": {
                    "height": rendered.height(),
                    "width": rendered.width()
                },
                "runtimeStatus": "cpu_apply_capable_fixture_path",
                "warningMode": "synthetic_linear_fixture_only"
            });
            fs::write(report_path, serde_json::to_vec_pretty(&report).unwrap())
                .expect("write Negative Lab density CPU report");
        }
    }

    #[test]
    fn negative_lab_public_scan_exports_positive_report_when_enabled() {
        if std::env::var("RAWENGINE_RUN_NEGATIVE_LAB_PUBLIC_EXPORT_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping Negative Lab public export proof");
            return;
        }

        let report_path = std::env::var("RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_REPORT")
            .expect("RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_REPORT is required");
        let source_path =
            Path::new("../fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg");
        let output_dir = Path::new("target/negative-lab-public-export-proof");
        fs::create_dir_all(output_dir).expect("create Negative Lab public export proof dir");

        let input = image::open(source_path).expect("open public negative fixture");
        let applied_profile_id = "negative_lab.generic.c41.portrait.v1";
        let applied_profile_display_name = "C-41 Portrait";
        let applied_profile_claim_policy = "generic_starting_point_no_stock_claim";
        let applied_profile_does_not_prove = [
            "no_named_stock_emulation_claim",
            "no_colorimetric_match_claim",
            "not_measured_from_manufacturer_profile",
        ];
        let params = NegativeConversionParams {
            red_weight: 1.03,
            green_weight: 1.0,
            blue_weight: 0.98,
            base_fog_strength: 1.0,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.35,
                height: 0.35,
            }),
            exposure: 0.05,
            contrast: 0.95,
            black_point: 0.0,
            white_point: 1.0,
        };
        let bounds_ref = downscale_f32_image(&input, 1080, 1080);
        let ref_rgb = bounds_ref.to_rgb32f();
        let (ref_w, ref_h) = ref_rgb.dimensions();
        let log_pixels: Vec<f32> = ref_rgb
            .as_raw()
            .iter()
            .map(|&value| -value.clamp(1e-6, 1.0).log10())
            .collect();
        let bounds = analyze_bounds(
            &log_pixels,
            ref_w as usize,
            ref_h as usize,
            params.base_fog_sample,
        );
        let rendered = run_pipeline(&input, &params, Some(bounds));
        let output_path = output_dir.join("110-format-ericht-negative-cc0-320-Positive.jpg");
        let mut buf = Cursor::new(Vec::new());
        rendered
            .to_rgb8()
            .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, JPEG_PROOF_QUALITY))
            .expect("encode public negative positive JPEG");
        fs::write(&output_path, buf.into_inner()).expect("write public negative positive JPEG");

        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            output_format: NegativeConversionOutputFormat::JpegProof,
            write_conversion_bundle: true,
            acquisition_warning_codes: vec!["lossy_source_for_negative_lab".to_string()],
            acquisition_source_families: vec!["jpeg_lossy".to_string()],
            profile_provenance_hash: Some("fnv1a32:9ed1e301".to_string()),
            selected_profile: Some(NegativeLabSelectedProfileSnapshot {
                claim_level: "generic_starting_point_only".to_string(),
                claim_policy: applied_profile_claim_policy.to_string(),
                display_name: applied_profile_display_name.to_string(),
                does_not_prove: vec![
                    "no_stock_emulation_claim".to_string(),
                    "no_colorimetric_match_claim".to_string(),
                ],
                evidence_fixture_count: 0,
                measurement_profile_id: None,
                params,
                preset_id: applied_profile_id.to_string(),
                profile_provenance_hash: "fnv1a32:9ed1e301".to_string(),
                profile_status: "generic_unmeasured".to_string(),
                provenance_summary: "Generic engineered C-41 portrait starting point.".to_string(),
                runtime_status: "runtime_parameter_applied".to_string(),
                source_generic_preset_id: None,
            }),
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: "Positive".to_string(),
        };
        write_negative_lab_output_sidecar(
            &output_path,
            source_path,
            &params,
            &save_options,
            rendered.width(),
            rendered.height(),
        )
        .expect("write public negative positive sidecar");

        let input_rgb = input.to_rgb32f();
        let rendered_rgb = rendered.to_rgb32f();
        let changed_pixel_ratio = rendered_rgb
            .pixels()
            .zip(input_rgb.pixels())
            .filter(|(rendered_pixel, input_pixel)| {
                rendered_pixel
                    .channels()
                    .iter()
                    .zip(input_pixel.channels())
                    .any(|(rendered_channel, input_channel)| {
                        (rendered_channel - input_channel).abs() > 0.01
                    })
            })
            .count() as f32
            / (rendered.width() * rendered.height()).max(1) as f32;
        let input_to_output_delta = mean_abs_delta(&input_rgb, &rendered_rgb);

        assert!(changed_pixel_ratio > 0.05);
        assert!(input_to_output_delta > 0.01);

        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        assert!(
            sidecar_path.exists(),
            "Negative Lab public export proof must write a sidecar"
        );
        let bundle_path = negative_lab_conversion_bundle_path(&output_path);
        write_negative_lab_conversion_bundle(
            &bundle_path,
            &params,
            &save_options,
            &[NegativeLabConversionBundleOutputRef {
                output_height: rendered.height(),
                output_path: output_path.clone(),
                output_width: rendered.width(),
                sidecar_path,
                source_path: source_path.to_path_buf(),
            }],
        )
        .expect("write public negative conversion bundle");
        assert!(
            bundle_path.exists(),
            "Negative Lab public export proof must write a conversion bundle"
        );
        let report = json!({
            "algorithm": "density_rgb_v1",
            "appliedProfile": {
                "claimLevel": "generic_starting_point_only",
                "claimPolicy": applied_profile_claim_policy,
                "displayName": applied_profile_display_name,
                "doesNotProve": applied_profile_does_not_prove,
                "params": {
                    "base_fog_sample": {
                        "height": 0.35,
                        "width": 0.35,
                        "x": 0.0,
                        "y": 0.0
                    },
                    "base_fog_strength": params.base_fog_strength,
                    "blue_weight": params.blue_weight,
                    "contrast": params.contrast,
                    "exposure": params.exposure,
                    "green_weight": params.green_weight,
                    "red_weight": params.red_weight
                },
                "presetId": applied_profile_id,
                "processFamily": "c41_color_negative",
                "profileProvenanceHash": "fnv1a32:9ed1e301",
                "runtimeStatus": "runtime_parameter_applied",
                "stockFamilyDescriptor": "Soft portrait color negative"
            },
            "doesNotProve": [
                "camera_raw_decode_path",
                "capture_one_class_quality",
                "commercial_converter_parity",
                "full_macos_app_manual_session",
                "icc_colorimetric_accuracy",
                "raw_scan_input",
                "stock_library_maturity"
            ],
            "fixtureId": "negative_lab.real.public.cc0_110_ericht_negative_001",
            "controlSurface": {
                "baseFog": {
                    "sampleRect": {
                        "height": 0.35,
                        "width": 0.35,
                        "x": 0.0,
                        "y": 0.0
                    },
                    "strength": params.base_fog_strength
                },
                "density": {
                    "blueWeight": params.blue_weight,
                    "contrast": params.contrast,
                    "exposure": params.exposure,
                    "greenWeight": params.green_weight,
                    "redWeight": params.red_weight
                },
                "export": {
                    "acceptedDryRunPlanHash": save_options.accepted_dry_run_plan_hash,
                    "acceptedDryRunPlanId": save_options.accepted_dry_run_plan_id,
                    "conversionBundle": true,
                    "outputFormat": "jpeg_proof",
                    "profileProvenanceHash": save_options.profile_provenance_hash,
                    "suffix": save_options.suffix
                },
                "preset": {
                    "claimPolicy": applied_profile_claim_policy,
                    "displayName": applied_profile_display_name,
                    "presetId": applied_profile_id,
                    "processFamily": "c41_color_negative"
                }
            },
            "inputToOutputMeanAbsDelta": input_to_output_delta,
            "issue": 2311,
            "metrics": {
                "changedPixelRatio": changed_pixel_ratio,
                "inputToOutputMeanAbsDelta": input_to_output_delta
            },
            "output": {
                "contentHash": hash_negative_lab_output_file(&output_path).expect("hash output"),
                "dimensions": {
                    "height": rendered.height(),
                    "width": rendered.width()
                },
                "format": "jpeg_proof",
                "path": "src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg"
            },
            "runtimeStatus": "public_negative_scan_positive_export_rendered",
            "schemaVersion": 1,
            "conversionBundle": {
                "contentHash": hash_negative_lab_output_file(&bundle_path).expect("hash bundle"),
                "path": "src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg.conversion-bundle.json",
                "schemaVersion": NEGATIVE_LAB_CONVERSION_BUNDLE_SCHEMA_VERSION
            },
            "sidecar": {
                "containsNegativeLabArtifact": true,
                "path": "src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg.rrdata",
                "runtimeGeneratedIds": true
            },
            "source": {
                "license": "CC0 public fixture",
                "manifest": "fixtures/negative-lab/public/110-format-ericht-negative-cc0-samples.json",
                "path": "fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg",
                "sha256": "sha256:f0913770ce2ec72f2261d6cc0948091e3224d11904049727a42beb864ef5673b"
            }
        });
        fs::write(report_path, serde_json::to_vec_pretty(&report).unwrap())
            .expect("write Negative Lab public export report");
    }

    #[test]
    fn negative_lab_private_raw_exports_positive_report_when_enabled() {
        if std::env::var("RAWENGINE_RUN_NEGATIVE_LAB_PRIVATE_RAW_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping Negative Lab private RAW proof");
            return;
        }

        let private_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
                .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
        );
        let source_relative_path = "private-fixtures/negative-lab/alaska-negative-lab-v1.arw";
        let source_path = private_root.join(source_relative_path);
        let source_path_string = source_path.to_string_lossy().to_string();
        assert!(
            is_raw_file(&source_path_string),
            "Negative Lab private proof source must be a RAW file"
        );

        let source_hash_before =
            sha256_negative_lab_file(&source_path).expect("hash source before");
        let source_bytes = fs::read(&source_path).expect("read private RAW source");
        let settings = AppSettings::default();
        let input =
            load_base_image_from_bytes(&source_bytes, &source_path_string, false, &settings, None)
                .expect("decode private RAW source through app loader");
        let source_hash_after = sha256_negative_lab_file(&source_path).expect("hash source after");

        let params = NegativeConversionParams {
            red_weight: 1.03,
            green_weight: 1.0,
            blue_weight: 0.98,
            base_fog_strength: 1.0,
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.35,
                height: 0.35,
            }),
            exposure: 0.05,
            contrast: 0.95,
            black_point: 0.0,
            white_point: 1.0,
        };
        let bounds_ref = downscale_f32_image(&input, 1080, 1080);
        let ref_rgb = bounds_ref.to_rgb32f();
        let (ref_w, ref_h) = ref_rgb.dimensions();
        let log_pixels: Vec<f32> = ref_rgb
            .as_raw()
            .iter()
            .map(|&value| -value.clamp(1e-6, 1.0).log10())
            .collect();
        let bounds = analyze_bounds(
            &log_pixels,
            ref_w as usize,
            ref_h as usize,
            params.base_fog_sample,
        );
        let rendered = run_pipeline(&input, &params, Some(bounds));
        let input_rgb = input.to_rgb32f();
        let rendered_rgb = rendered.to_rgb32f();
        let changed_pixel_ratio = rendered_rgb
            .pixels()
            .zip(input_rgb.pixels())
            .filter(|(rendered_pixel, input_pixel)| {
                rendered_pixel
                    .channels()
                    .iter()
                    .zip(input_pixel.channels())
                    .any(|(rendered_channel, input_channel)| {
                        (rendered_channel - input_channel).abs() > 0.01
                    })
            })
            .count() as f32
            / (rendered.width() * rendered.height()).max(1) as f32;
        let input_to_output_delta = mean_abs_delta(&input_rgb, &rendered_rgb);
        assert!(changed_pixel_ratio > 0.05);
        assert!(input_to_output_delta > 0.01);
        assert_eq!(source_hash_before, source_hash_after);

        let artifact_root = private_root.join("private-artifacts/validation/negative-lab-real-raw");
        fs::create_dir_all(&artifact_root).expect("create Negative Lab private RAW artifact dir");
        let output_path = artifact_root.join("alaska-negative-lab-v1-Positive.jpg");
        let mut buf = Cursor::new(Vec::new());
        rendered
            .to_rgb8()
            .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, JPEG_PROOF_QUALITY))
            .expect("encode private RAW Negative Lab positive JPEG");
        fs::write(&output_path, buf.into_inner()).expect("write private RAW positive JPEG");

        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:3028e2e1".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_private_raw_plan_3028e2e1".to_string()),
            output_format: NegativeConversionOutputFormat::JpegProof,
            write_conversion_bundle: true,
            acquisition_warning_codes: vec!["raw_source_not_verified_negative_scan".to_string()],
            acquisition_source_families: vec!["camera_raw".to_string()],
            profile_provenance_hash: Some("fnv1a32:9ed1e301".to_string()),
            selected_profile: Some(NegativeLabSelectedProfileSnapshot {
                claim_level: "generic_starting_point_only".to_string(),
                claim_policy: "generic_starting_point_no_stock_claim".to_string(),
                display_name: "C-41 Portrait".to_string(),
                does_not_prove: vec![
                    "no_stock_emulation_claim".to_string(),
                    "no_colorimetric_match_claim".to_string(),
                ],
                evidence_fixture_count: 0,
                measurement_profile_id: None,
                params,
                preset_id: "negative_lab.generic.c41.portrait.v1".to_string(),
                profile_provenance_hash: "fnv1a32:9ed1e301".to_string(),
                profile_status: "generic_unmeasured".to_string(),
                provenance_summary: "Generic engineered C-41 portrait starting point.".to_string(),
                runtime_status: "runtime_parameter_applied".to_string(),
                source_generic_preset_id: None,
            }),
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            suffix: "Positive".to_string(),
        };
        write_negative_lab_output_sidecar(
            &output_path,
            &source_path,
            &params,
            &save_options,
            rendered.width(),
            rendered.height(),
        )
        .expect("write private RAW Negative Lab sidecar");
        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        assert!(sidecar_path.exists());
        let bundle_path = negative_lab_conversion_bundle_path(&output_path);
        write_negative_lab_conversion_bundle(
            &bundle_path,
            &params,
            &save_options,
            &[NegativeLabConversionBundleOutputRef {
                output_height: rendered.height(),
                output_path: output_path.clone(),
                output_width: rendered.width(),
                sidecar_path: sidecar_path.clone(),
                source_path,
            }],
        )
        .expect("write private RAW Negative Lab conversion bundle");
        assert!(bundle_path.exists());

        let report_path = artifact_root.join("alaska-negative-lab-v1-report.json");
        let report = json!({
            "artifacts": [
                {
                    "hash": source_hash_before,
                    "kind": "source_raw_private",
                    "path": source_relative_path,
                    "publicRepoAllowed": false
                },
                {
                    "hash": sha256_negative_lab_file(&output_path).expect("hash private output"),
                    "kind": "positive_jpeg_private",
                    "path": "private-artifacts/validation/negative-lab-real-raw/alaska-negative-lab-v1-Positive.jpg",
                    "publicRepoAllowed": false
                },
                {
                    "hash": sha256_negative_lab_file(&sidecar_path).expect("hash private sidecar"),
                    "kind": "sidecar_private",
                    "path": "private-artifacts/validation/negative-lab-real-raw/alaska-negative-lab-v1-Positive.jpg.rrdata",
                    "publicRepoAllowed": false
                },
                {
                    "hash": sha256_negative_lab_file(&bundle_path).expect("hash private bundle"),
                    "kind": "conversion_bundle_private",
                    "path": "private-artifacts/validation/negative-lab-real-raw/alaska-negative-lab-v1-Positive.jpg.conversion-bundle.json",
                    "publicRepoAllowed": false
                }
            ],
            "doesNotProve": [
                "capture_one_class_quality",
                "commercial_converter_parity",
                "film_stock_emulation_accuracy",
                "macos_app_ui_e2e_session",
                "measured_negative_profile_accuracy",
                "source_is_actual_film_negative"
            ],
            "fixtureId": "validation.negative-lab-real-raw.alaska.v1",
            "issue": 3028,
            "localRawRuntime": {
                "decodePath": "load_base_image_from_bytes",
                "execution": "tauri_test_negative_lab_private_raw_export",
                "outputFormat": "jpeg_proof",
                "sourceHashUnchanged": source_hash_before == source_hash_after,
                "sourceIsRaw": true
            },
            "metrics": {
                "changedPixelRatio": changed_pixel_ratio,
                "inputToOutputMeanAbsDelta": input_to_output_delta
            },
            "proofBoundary": "private_raw_negative_lab_runtime_not_final_negative_quality",
            "proofStatus": "private_raw_negative_lab_positive_export_rendered",
            "schemaVersion": 1,
            "validationMode": "local_alaska_raw_negative_lab_runtime"
        });
        fs::write(report_path, serde_json::to_vec_pretty(&report).unwrap())
            .expect("write Negative Lab private RAW report");
    }

    fn sha256_negative_lab_file(path: &Path) -> Result<String, String> {
        let bytes =
            fs::read(path).map_err(|error| format!("read {}: {}", path.display(), error))?;
        Ok(format!("sha256:{}", hex::encode(Sha256::digest(&bytes))))
    }

    #[test]
    fn sampled_base_fog_preview_export_acceptance_changes_render() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                6,
                2,
                vec![
                    0.95, 0.83, 0.44, 0.93, 0.80, 0.40, 0.56, 0.36, 0.20, 0.38, 0.23, 0.14, 0.21,
                    0.13, 0.08, 0.10, 0.06, 0.04, //
                    0.92, 0.78, 0.38, 0.89, 0.72, 0.34, 0.50, 0.31, 0.18, 0.32, 0.20, 0.12, 0.18,
                    0.11, 0.07, 0.08, 0.05, 0.03,
                ],
            )
            .unwrap(),
        );
        let sample_rect = NegativeBaseFogSampleRect {
            x: 0.0,
            y: 0.0,
            width: 0.34,
            height: 1.0,
        };
        let auto_estimate = estimate_base_fog_from_image(&input, None);
        let sampled_estimate = estimate_base_fog_from_image(&input, Some(sample_rect));
        let default_params = NegativeConversionParams::default();
        let auto_params = NegativeConversionParams {
            red_weight: auto_estimate.red_weight,
            green_weight: auto_estimate.green_weight,
            blue_weight: auto_estimate.blue_weight,
            base_fog_strength: 1.0,
            base_fog_sample: None,
            exposure: 0.0,
            contrast: 1.0,
            black_point: 0.0,
            white_point: 1.0,
        };
        let sampled_params = NegativeConversionParams {
            red_weight: sampled_estimate.red_weight,
            green_weight: sampled_estimate.green_weight,
            blue_weight: sampled_estimate.blue_weight,
            base_fog_strength: 1.0,
            base_fog_sample: Some(sample_rect),
            exposure: 0.0,
            contrast: 1.0,
            black_point: 0.0,
            white_point: 1.0,
        };
        let rgb = input.to_rgb32f();
        let (width, height) = rgb.dimensions();
        let log_pixels: Vec<f32> = rgb
            .as_raw()
            .iter()
            .map(|&value| -value.clamp(1e-6, 1.0).log10())
            .collect();
        let sampled_export_bounds = analyze_bounds(
            &log_pixels,
            width as usize,
            height as usize,
            sampled_params.base_fog_sample,
        );

        let default_preview = run_pipeline(&input, &default_params, None).to_rgb32f();
        let auto_preview = run_pipeline(&input, &auto_params, None).to_rgb32f();
        let sampled_preview = run_pipeline(&input, &sampled_params, None).to_rgb32f();
        let sampled_export =
            run_pipeline(&input, &sampled_params, Some(sampled_export_bounds)).to_rgb32f();

        assert!(
            mean_abs_delta(&default_preview, &auto_preview) > 0.01,
            "auto base/fog should visibly alter the preview render"
        );
        assert!(
            mean_abs_delta(&auto_preview, &sampled_preview) > 0.01,
            "sampled base/fog should visibly alter the accepted preview render"
        );
        assert_images_near(&sampled_preview, &sampled_export);
    }

    #[test]
    fn base_fog_estimate_returns_bounded_weights_and_confidence() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                3,
                2,
                vec![
                    0.90, 0.74, 0.42, 0.72, 0.50, 0.28, 0.40, 0.26, 0.14, //
                    0.88, 0.72, 0.40, 0.68, 0.46, 0.24, 0.36, 0.22, 0.12,
                ],
            )
            .unwrap(),
        );

        let estimate = estimate_base_fog_from_image(&input, None);
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.red_weight));
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.green_weight));
        assert!((MIN_CHANNEL_WEIGHT..=MAX_CHANNEL_WEIGHT).contains(&estimate.blue_weight));
        assert!((0.0..=1.0).contains(&estimate.confidence));
        assert_eq!(estimate.base_rgb.len(), 3);
        assert_eq!(estimate.base_density.len(), 3);
        for value in estimate.base_rgb {
            assert!((0.0..=1.0).contains(&value));
        }
        for value in estimate.base_density {
            assert!(value.is_finite());
            assert!(value >= 0.0);
        }
    }

    #[test]
    fn sampled_base_fog_estimate_uses_requested_patch() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                1,
                vec![
                    0.95, 0.82, 0.45, 0.95, 0.82, 0.45, 0.30, 0.28, 0.26, 0.28, 0.26, 0.24,
                ],
            )
            .unwrap(),
        );

        let full_frame = estimate_base_fog_from_image(&input, None);
        let right_patch = estimate_base_fog_from_image(
            &input,
            Some(NegativeBaseFogSampleRect {
                x: 0.5,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            }),
        );

        assert_ne!(
            (
                full_frame.red_weight,
                full_frame.green_weight,
                full_frame.blue_weight
            ),
            (
                right_patch.red_weight,
                right_patch.green_weight,
                right_patch.blue_weight
            )
        );
    }
}
