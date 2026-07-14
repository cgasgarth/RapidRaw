use crate::color::density::negative_log_density_channel;
use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::formats::jpeg_data_url;
use crate::image_loader::{load_base_image_from_bytes, load_base_image_from_bytes_with_report};
use crate::image_processing::RawEngineArtifacts;
use base64::{Engine as _, engine::general_purpose};
use chrono::Utc;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageReader, Rgb32FImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::AppHandle;
use uuid::Uuid;

use super::negative_lab_detail_finish::{
    NegativeLabDetailFinishMetrics, NegativeLabDetailFinishParams, apply_negative_lab_detail_finish,
};
use super::negative_lab_optical_finish::{
    NegativeLabOpticalFinishMetrics, NegativeLabOpticalFinishParams,
    apply_negative_lab_optical_finish,
};
use crate::AppState;
use crate::image_processing::downscale_f32_image;
use crate::load_settings_or_default;
use crate::raw::negative_lab_auto_meter::{
    NegativeLabAutoMeterControls, NegativeLabAutoMeterReceipt, measure_auto_meter,
};
use crate::raw::negative_lab_cmy_timing::{
    NegativeLabCmyTimingMetrics, NegativeLabCmyTimingParams, apply_cmy_timing_pixel,
};
use crate::raw::negative_lab_color_finish::{
    NegativeLabColorFinishMetrics, NegativeLabScannerColorFinishParams, apply_color_finish,
};
use crate::raw::negative_lab_neutral_axis::{
    NegativeLabNeutralAxisAnalysis, NegativeLabNeutralAxisParams, analyze_neutral_axis,
    compile_neutral_axis_cmy_timing,
};
use crate::raw::negative_lab_paper_profile::NegativeLabPaperProfileSnapshot;
use sha2::{Digest, Sha256};
use tauri::Emitter;

#[path = "negative_lab_hd_paper_curve.rs"]
pub(crate) mod negative_lab_hd_paper_curve;
use negative_lab_hd_paper_curve::{
    NegativeLabDensityPrintAlgorithm, NegativeLabHdPaperCurveParams, scene_linear_reflectance,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NegativeConversionParams {
    #[serde(default = "default_process_family")]
    pub process_family: NegativeLabProcessFamily,
    pub red_weight: f32,
    pub green_weight: f32,
    pub blue_weight: f32,
    #[serde(default = "default_bounds_schema_version")]
    pub bounds_schema_version: u8,

    #[serde(default = "default_base_fog_strength")]
    pub base_fog_strength: f32,
    #[serde(default)]
    pub base_fog_sample: Option<NegativeBaseFogSampleRect>,
    #[serde(default = "default_analysis_buffer")]
    pub analysis_buffer: f32,
    #[serde(default)]
    pub base_fog_bounds_provenance: NegativeLabBaseFogBoundsProvenance,
    pub exposure: f32,
    pub contrast: f32,
    #[serde(default = "default_black_point")]
    pub black_point: f32,
    #[serde(default = "default_black_point_offset")]
    pub black_point_offset: f32,
    #[serde(default = "default_color_range_clip")]
    pub color_range_clip: f32,
    #[serde(default = "default_luma_range_clip")]
    pub luma_range_clip: f32,
    #[serde(default = "default_white_point_offset")]
    pub white_point_offset: f32,
    #[serde(default = "default_white_point")]
    pub white_point: f32,
    #[serde(default)]
    pub conversion_model: NegativeConversionModel,
    /// Hash of the loader-grounded source interpretation accepted by preview/apply.
    #[serde(default)]
    pub source_interpretation_hash: Option<String>,
    #[serde(default)]
    pub color_finish: NegativeLabScannerColorFinishParams,
    #[serde(default)]
    pub cmy_timing: NegativeLabCmyTimingParams,
    #[serde(default)]
    pub neutral_axis: NegativeLabNeutralAxisParams,
    #[serde(default)]
    pub detail_finish: NegativeLabDetailFinishParams,
    #[serde(default)]
    pub optical_finish: NegativeLabOpticalFinishParams,
    #[serde(default)]
    pub render_intent: NegativeLabRenderIntent,
    #[serde(default)]
    pub flat_log_master: NegativeLabFlatLogMasterParams,
    #[serde(default)]
    pub print_curve_algorithm: NegativeLabDensityPrintAlgorithm,
    #[serde(default)]
    pub print_curve_v2: Option<NegativeLabHdPaperCurveParams>,
    #[serde(default)]
    pub paper_profile: Option<NegativeLabPaperProfileSnapshot>,
    #[serde(default)]
    pub auto_meter: NegativeLabAutoMeterControls,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabCalibrationPatchV1 {
    pub expected_rgb: [f32; 3],
    pub independent_color_patch: bool,
    pub observed_rgb: [f32; 3],
    #[serde(default)]
    pub clipped: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabProfileFitRequestV1 {
    pub patches: Vec<NegativeLabCalibrationPatchV1>,
    pub schema_version: u8,
    pub source_interpretation_hash: String,
    pub target_layout_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabFittedParametersV1 {
    pub base_fog_strength: f32,
    pub blue_weight: f32,
    pub contrast: f32,
    pub green_weight: f32,
    pub red_weight: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabProfileFitReceiptV1 {
    pub algorithm_id: String,
    pub claim_status: String,
    pub confidence: f32,
    pub crosstalk_status: String,
    pub fitted_params: NegativeLabFittedParametersV1,
    pub max_residual: f32,
    pub report_hash: String,
    pub rejected_patch_count: u32,
    pub residual_mean: f32,
    pub schema_version: u8,
    pub source_interpretation_hash: String,
    pub target_layout_id: String,
    pub used_patch_count: u32,
    pub warning_codes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NegativeConversionModel {
    #[default]
    DensityRgbV1,
    NegativeLogDensityV1,
    /// Loader-grounded E-6/reversal scans are already positive film; they
    /// must not enter the negative-density/base-fog inversion path.
    #[serde(rename = "e6_positive")]
    E6PositiveV1,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NegativeLabProcessFamily {
    #[default]
    C41ColorNegative,
    BlackAndWhiteSilverNegative,
}

fn default_process_family() -> NegativeLabProcessFamily {
    NegativeLabProcessFamily::C41ColorNegative
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NegativeLabBaseFogBoundsProvenance {
    #[default]
    AutomaticAnalysis,
    ManualBaseFogSample,
    ProfileEmbeddedBaseFogSample,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeBaseFogSampleRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabPreviewArtifactDimensions {
    pub height: u32,
    pub width: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabRuntimeBaseFogRgbTriplet {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabRuntimeBaseFogSampleSummary {
    pub clipped_fraction: f32,
    pub confidence: f32,
    pub density_range: f32,
    pub density_rgb: NegativeLabRuntimeBaseFogRgbTriplet,
    pub mean_rgb: NegativeLabRuntimeBaseFogRgbTriplet,
    pub sample_count: u32,
    pub sample_rect: NegativeBaseFogSampleRect,
    pub source: String,
    pub warning_codes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabOutputTransformV1 {
    pub bit_depth: u8,
    pub implementation_version: u8,
    pub input_color_domain: String,
    pub intent: String,
    pub output_color_domain: String,
    pub transform_id: String,
    pub transfer_function: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabSceneLinearStatsV1 {
    pub content_hash: String,
    pub max: f32,
    pub min: f32,
    pub non_finite_count: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDryRunPreviewArtifact {
    pub artifact_id: String,
    pub base_fog_sample_summary: NegativeLabRuntimeBaseFogSampleSummary,
    pub content_hash: String,
    pub density_normalization_metrics: NegativeLabDensityNormalizationMetrics,
    pub density_scopes: NegativeLabDensityScopes,
    pub detail_finish_metrics: NegativeLabDetailFinishMetrics,
    pub color_finish_metrics: NegativeLabColorFinishMetrics,
    pub optical_finish_metrics: NegativeLabOpticalFinishMetrics,
    pub cmy_timing_metrics: NegativeLabCmyTimingMetrics,
    pub neutral_axis_analysis: NegativeLabNeutralAxisAnalysis,
    pub auto_meter: NegativeLabAutoMeterReceipt,
    #[serde(default)]
    pub paper_profile: Option<NegativeLabPaperProfileSnapshot>,
    pub dimensions: NegativeLabPreviewArtifactDimensions,
    pub flat_log_master: NegativeLabFlatLogMasterParams,
    pub render_intent: NegativeLabRenderIntent,
    pub preview_output_transform: NegativeLabOutputTransformV1,
    pub scene_linear_print: NegativeLabSceneLinearStatsV1,
    pub bypassed_stage_ids: Vec<String>,
    pub preview_data_url: String,
    pub stage_artifacts: Vec<NegativeLabStagePreviewArtifact>,
    pub renderer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_interpretation_hash: Option<String>,
    pub storage: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabSourceInterpretationV1 {
    pub applied_linearization: String,
    pub bit_depth: u8,
    pub block_reasons: Vec<String>,
    pub confidence: f32,
    pub decoder_backend: String,
    pub decoder_version: String,
    pub dimensions: NegativeLabPreviewArtifactDimensions,
    pub embedded_icc_profile: bool,
    pub interpretation_hash: String,
    pub non_finite_fraction: f32,
    pub orientation: String,
    pub raw_demosaic_mode: Option<String>,
    pub sample_format: String,
    pub schema_version: u8,
    pub source_hash: String,
    pub source_type: String,
    pub transfer_function: String,
    pub warning_codes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabStagePreviewArtifact {
    pub color_domain: String,
    pub content_hash: String,
    pub dimensions: NegativeLabPreviewArtifactDimensions,
    pub display_transform: String,
    pub preview_data_url: String,
    pub recipe_hash: String,
    pub stage_id: String,
    pub stage_version: u8,
    pub bounds_receipt: NegativeLabDensityBoundsReceipt,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityAxisBoundsSummary {
    pub min: f32,
    pub max: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityChannelBoundsSummary {
    pub min: f32,
    pub max: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityNormalizationAxisBounds {
    pub color: NegativeLabDensityAxisBoundsSummary,
    pub luma: NegativeLabDensityAxisBoundsSummary,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityNormalizationChannelBounds {
    pub r: NegativeLabDensityChannelBoundsSummary,
    pub g: NegativeLabDensityChannelBoundsSummary,
    pub b: NegativeLabDensityChannelBoundsSummary,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityBoundsSet {
    pub axis_bounds: NegativeLabDensityNormalizationAxisBounds,
    pub channel_bounds: NegativeLabDensityNormalizationChannelBounds,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityBoundsReceipt {
    pub algorithm_id: String,
    pub analysis_buffer: f32,
    pub analysis_rect: NegativeBaseFogSampleRect,
    pub base_bounds: NegativeLabDensityBoundsSet,
    pub base_fog_provenance: NegativeLabBaseFogBoundsProvenance,
    pub color_range_clip: f32,
    pub final_bounds: NegativeLabDensityBoundsSet,
    pub luma_range_clip: f32,
    pub schema_version: u8,
    pub warning_codes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityNormalizationMetrics {
    pub axis_bounds: NegativeLabDensityNormalizationAxisBounds,
    pub bounds_receipt: NegativeLabDensityBoundsReceipt,
    pub channel_bounds: NegativeLabDensityNormalizationChannelBounds,
    pub clipped_pixel_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crosstalk_receipt: Option<NegativeLabCrosstalkReceipt>,
    pub density_range_unclamped: f32,
    pub epsilon_clamped_pixel_count: u32,
    pub renderer_version: u8,
}

/// Immutable per-frame density bounds used by the roll-level lock operation.
/// These are loader/native-analysis outputs; the roll operation never feeds a
/// mixed result back into local analysis.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabRollBoundsFrameV1 {
    pub anchor: bool,
    pub eligible: bool,
    pub frame_id: String,
    pub local_bounds: NegativeLabDensityBoundsSet,
    pub source_interpretation_hash: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabRollBoundsRequestV1 {
    pub analysis_version: String,
    pub frames: Vec<NegativeLabRollBoundsFrameV1>,
    pub source_interpretation_hash: String,
    pub use_roll_colour: bool,
    pub use_roll_luma: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabRollBoundsFrameResultV1 {
    pub anchor: bool,
    pub eligible: bool,
    pub final_bounds: NegativeLabDensityBoundsSet,
    pub frame_id: String,
    pub local_bounds: NegativeLabDensityBoundsSet,
    pub roll_bounds: NegativeLabDensityBoundsSet,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabRollBoundsReceiptV1 {
    pub algorithm_id: String,
    pub analysis_version: String,
    pub frame_results: Vec<NegativeLabRollBoundsFrameResultV1>,
    pub plan_hash: String,
    pub roll_bounds: NegativeLabDensityBoundsSet,
    pub schema_version: u8,
    pub source_interpretation_hash: String,
    pub use_roll_colour: bool,
    pub use_roll_luma: bool,
    pub warning_codes: Vec<String>,
}

const NEGATIVE_LAB_SCOPE_HISTOGRAM_BINS: usize = 32;
const NEGATIVE_LAB_SCOPE_CURVE_SAMPLES: usize = 17;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabScopeHistogram {
    pub bins: Vec<u32>,
    pub max: f32,
    pub min: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityScopePoint {
    pub input_density: f32,
    pub output_luma: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabDensityScopes {
    pub algorithm_id: String,
    pub clipped_pixel_count: u32,
    pub density_histogram: NegativeLabScopeHistogram,
    pub gamut_out_of_range_pixel_count: u32,
    pub h_and_d_curve: Vec<NegativeLabDensityScopePoint>,
    pub output_luma_histogram: NegativeLabScopeHistogram,
    pub sample_count: u32,
    pub schema_version: u8,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NegativeConversionOutputFormat {
    JpegProof,
    #[default]
    Tiff16,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NegativeLabRenderIntent {
    #[default]
    Print,
    FlatLogMaster,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct NegativeLabFlatLogMasterParams {
    #[serde(default = "default_flat_log_gain")]
    pub gain: f32,
    #[serde(default = "default_flat_log_lift")]
    pub lift: f32,
    #[serde(default = "default_flat_log_algorithm_version")]
    pub algorithm_version: u8,
}

const fn default_flat_log_gain() -> f32 {
    1.0
}
const fn default_flat_log_lift() -> f32 {
    0.02
}
const fn default_flat_log_algorithm_version() -> u8 {
    1
}

impl Default for NegativeLabFlatLogMasterParams {
    fn default() -> Self {
        Self {
            gain: 1.0,
            lift: 0.02,
            algorithm_version: 1,
        }
    }
}

impl NegativeLabFlatLogMasterParams {
    fn sanitized(self) -> Self {
        Self {
            gain: if self.gain.is_finite() {
                self.gain.clamp(0.1, 2.0)
            } else {
                default_flat_log_gain()
            },
            lift: if self.lift.is_finite() {
                self.lift.clamp(0.0, 0.25)
            } else {
                default_flat_log_lift()
            },
            algorithm_version: 1,
        }
    }
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
    #[serde(default = "default_negative_lab_acquisition_profile")]
    pub selected_acquisition_profile: NegativeLabAcquisitionProfileSnapshot,
    #[serde(default)]
    pub profile_provenance_hash: Option<String>,
    #[serde(default)]
    pub selected_profile: Option<NegativeLabSelectedProfileSnapshot>,
    #[serde(default)]
    pub frame_exposure_overrides: NegativeLabFrameExposureOverridePayload,
    #[serde(default)]
    pub frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload,
    #[serde(default)]
    pub patch_sampler_corrections: serde_json::Value,
    #[serde(default)]
    pub accepted_dust_heal_layers_by_source_path: HashMap<String, Vec<serde_json::Value>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabAcquisitionProfileSnapshot {
    pub channel_basis: String,
    pub display_name: String,
    pub id: String,
    pub input_transform: String,
    pub provenance_summary: String,
    pub warning_codes: Vec<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crosstalk_profile: Option<serde_json::Value>,
    pub display_name: String,
    pub does_not_prove: Vec<String>,
    pub evidence_fixture_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub film_class: Option<String>,
    pub measurement_profile_id: Option<String>,
    pub params: NegativeConversionParams,
    pub preset_id: String,
    pub profile_provenance_hash: String,
    pub profile_status: String,
    pub provenance_summary: String,
    pub runtime_status: String,
    pub source_generic_preset_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabCrosstalkProfile {
    pub matrix: [[f32; 3]; 3],
    pub profile_id: String,
    pub provenance: String,
    pub provenance_hash: String,
    pub schema_version: u8,
    pub strength: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabCrosstalkReceipt {
    pub applied_matrix: [[f32; 3]; 3],
    pub bounds_analysis_identity: String,
    pub conditioning: f32,
    pub post_neutral_error: f32,
    pub pre_neutral_error: f32,
    pub profile_id: String,
    pub provenance_hash: String,
    pub requested_matrix: [[f32; 3]; 3],
    pub row_sums: [f32; 3],
    pub schema_version: u8,
    pub strength: f32,
}

const IDENTITY_CROSSTALK_MATRIX: [[f32; 3]; 3] =
    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];

fn resolve_negative_lab_crosstalk(
    value: Option<&serde_json::Value>,
) -> Result<Option<NegativeLabCrosstalkReceipt>, String> {
    let Some(value) = value else { return Ok(None) };
    let profile: NegativeLabCrosstalkProfile = serde_json::from_value(value.clone())
        .map_err(|error| format!("Invalid Negative Lab crosstalk profile: {error}"))?;
    if profile.schema_version != 1
        || !profile.strength.is_finite()
        || !(0.0..=1.0).contains(&profile.strength)
    {
        return Err("Invalid Negative Lab crosstalk schema version or strength.".to_string());
    }
    let mut applied = [[0.0_f32; 3]; 3];
    let mut row_sums = [0.0_f32; 3];
    let mut pre_neutral_error = 0.0_f32;
    for row in 0..3 {
        for column in 0..3 {
            let requested = profile.matrix[row][column];
            if !requested.is_finite() || !(-2.0..=2.0).contains(&requested) {
                return Err(
                    "Negative Lab crosstalk matrix contains an invalid coefficient.".to_string(),
                );
            }
            applied[row][column] = IDENTITY_CROSSTALK_MATRIX[row][column]
                * (1.0 - profile.strength)
                + requested * profile.strength;
        }
        let sum = applied[row].iter().sum::<f32>();
        if !sum.is_finite() || sum.abs() < 1.0e-6 {
            return Err("Negative Lab crosstalk matrix has a non-normalizable row.".to_string());
        }
        pre_neutral_error = pre_neutral_error.max((sum - 1.0).abs());
        for coefficient in &mut applied[row] {
            *coefficient /= sum;
        }
        row_sums[row] = applied[row].iter().sum();
    }
    let determinant = applied[0][0]
        * (applied[1][1] * applied[2][2] - applied[1][2] * applied[2][1])
        - applied[0][1] * (applied[1][0] * applied[2][2] - applied[1][2] * applied[2][0])
        + applied[0][2] * (applied[1][0] * applied[2][1] - applied[1][1] * applied[2][0]);
    if !determinant.is_finite() || determinant.abs() < 1.0e-5 {
        return Err("Negative Lab crosstalk matrix is singular or ill-conditioned.".to_string());
    }
    Ok(Some(NegativeLabCrosstalkReceipt {
        applied_matrix: applied,
        bounds_analysis_identity: "post_crosstalk_density:fixed_grid_block_median_luma_color_v1"
            .to_string(),
        conditioning: determinant.abs().recip(),
        post_neutral_error: row_sums
            .iter()
            .fold(0.0_f32, |error, sum| error.max((sum - 1.0).abs())),
        pre_neutral_error,
        profile_id: profile.profile_id,
        provenance_hash: profile.provenance_hash,
        requested_matrix: profile.matrix,
        row_sums,
        schema_version: profile.schema_version,
        strength: profile.strength,
    }))
}

fn apply_negative_lab_crosstalk_density(
    density: [f32; 3],
    receipt: &NegativeLabCrosstalkReceipt,
) -> [f32; 3] {
    receipt
        .applied_matrix
        .map(|row| row[0] * density[0] + row[1] * density[1] + row[2] * density[2])
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
const NEGATIVE_LAB_DENSITY_EPSILON: f32 = 0.000001;
const NEGATIVE_LAB_DENSITY_RANGE_EPSILON: f32 = 0.0001;
const NEGATIVE_LAB_RUNTIME_PREVIEW_RENDERER: &str = "rawengine_negative_lab_runtime_preview_v1";
const NEGATIVE_LAB_LOG_DENSITY_RENDERER_VERSION: u8 = 2;
const NEGATIVE_LAB_RUNTIME_PREVIEW_STORAGE: &str = "temp_cache";
const NEGATIVE_LAB_BASE_FOG_SOURCE_REQUESTED_RECT: &str = "requested_base_fog_sample_rect";
const NEGATIVE_LAB_BASE_FOG_SOURCE_DEFAULT_RECT: &str = "deterministic_edge_safe_default_rect";
const NEGATIVE_LAB_BASE_FOG_WARNING_CLIPPED_CHANNEL: &str = "clipped_base_channel";
const NEGATIVE_LAB_BASE_FOG_WARNING_LOW_CONFIDENCE: &str = "low_acquisition_confidence";
const NEGATIVE_LAB_BASE_FOG_WARNING_MISSING_VISIBLE_BASE: &str = "missing_visible_base";
const NEGATIVE_LAB_BASE_FOG_WARNING_UNEVEN_ILLUMINATION: &str = "uneven_illumination";
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

fn default_analysis_buffer() -> f32 {
    0.04
}

fn default_bounds_schema_version() -> u8 {
    1
}

fn default_black_point() -> f32 {
    0.0
}

fn default_black_point_offset() -> f32 {
    0.0
}

fn default_color_range_clip() -> f32 {
    0.12
}

fn default_luma_range_clip() -> f32 {
    0.08
}

fn default_white_point_offset() -> f32 {
    0.0
}

fn default_white_point() -> f32 {
    1.0
}

fn default_write_conversion_bundle() -> bool {
    true
}

fn default_patch_sampler_corrections() -> serde_json::Value {
    serde_json::json!({
        "corrections": [],
        "schemaVersion": 1
    })
}

#[cfg(test)]
#[allow(dead_code)]
fn default_negative_lab_identity_crosstalk_profile() -> serde_json::Value {
    serde_json::json!({
        "matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        "profileId": "negative_lab.crosstalk.identity.rawengine.v1",
        "provenance": "rawengine_identity_default",
        "provenanceHash": "fnv1a32:1882ba5c",
        "schemaVersion": 1,
        "strength": 0,
    })
}

fn default_negative_lab_acquisition_profile() -> NegativeLabAcquisitionProfileSnapshot {
    NegativeLabAcquisitionProfileSnapshot {
        channel_basis: "camera_rgb".to_string(),
        display_name: "Camera RAW linear capture".to_string(),
        id: "camera_raw_linear_v1".to_string(),
        input_transform: "linear_camera_raw".to_string(),
        provenance_summary:
            "Camera RAW capture with scanner/lab auto corrections avoided; preferred for inversion."
                .to_string(),
        warning_codes: vec!["scanner_profile_unmeasured".to_string()],
    }
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
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            profile_provenance_hash: None,
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
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
        let accepted_dust_heal_layers_by_source_path = self
            .accepted_dust_heal_layers_by_source_path
            .into_iter()
            .filter_map(|(source_path, layers)| {
                let source_path = source_path.trim().to_string();
                let layers: Vec<serde_json::Value> = layers
                    .into_iter()
                    .filter(|layer| {
                        layer
                            .get("id")
                            .and_then(|value| value.as_str())
                            .is_some_and(|id| !id.trim().is_empty())
                    })
                    .collect();
                (!source_path.is_empty() && !layers.is_empty()).then_some((source_path, layers))
            })
            .collect();
        let patch_sampler_corrections =
            sanitize_negative_lab_patch_sampler_corrections(self.patch_sampler_corrections);

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
            selected_acquisition_profile: sanitize_negative_lab_acquisition_profile(
                self.selected_acquisition_profile,
            ),
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
            patch_sampler_corrections,
            accepted_dust_heal_layers_by_source_path,
        }
    }

    fn accepted_dust_heal_layers_for_path(&self, source_path: &str) -> Vec<serde_json::Value> {
        self.accepted_dust_heal_layers_by_source_path
            .get(source_path)
            .cloned()
            .unwrap_or_default()
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
        let mut params = base_params.clone();
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
            process_family: NegativeLabProcessFamily::C41ColorNegative,
            red_weight: 1.0,
            green_weight: 1.0,
            blue_weight: 1.0,
            base_fog_strength: default_base_fog_strength(),
            base_fog_sample: None,
            analysis_buffer: default_analysis_buffer(),
            base_fog_bounds_provenance: NegativeLabBaseFogBoundsProvenance::AutomaticAnalysis,
            bounds_schema_version: default_bounds_schema_version(),
            exposure: 0.0,
            contrast: 1.0,
            black_point: default_black_point(),
            black_point_offset: default_black_point_offset(),
            color_range_clip: default_color_range_clip(),
            luma_range_clip: default_luma_range_clip(),
            white_point_offset: default_white_point_offset(),
            white_point: default_white_point(),
            conversion_model: NegativeConversionModel::DensityRgbV1,
            source_interpretation_hash: None,
            color_finish: NegativeLabScannerColorFinishParams::default(),
            cmy_timing: NegativeLabCmyTimingParams::default(),
            neutral_axis: NegativeLabNeutralAxisParams::default(),
            detail_finish: NegativeLabDetailFinishParams::default(),
            optical_finish: NegativeLabOpticalFinishParams::default(),
            render_intent: NegativeLabRenderIntent::Print,
            flat_log_master: NegativeLabFlatLogMasterParams::default(),
            print_curve_algorithm: NegativeLabDensityPrintAlgorithm::DensityRgbV1,
            print_curve_v2: None,
            paper_profile: None,
            auto_meter: NegativeLabAutoMeterControls::default(),
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

fn sanitize_negative_lab_patch_sampler_corrections(value: serde_json::Value) -> serde_json::Value {
    let corrections = value
        .get("corrections")
        .and_then(|value| value.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| {
                    entry.get("accepted").and_then(|value| value.as_bool()) == Some(true)
                        && entry
                            .get("correctionId")
                            .and_then(|value| value.as_str())
                            .is_some_and(|value| !value.trim().is_empty())
                        && entry
                            .get("frameId")
                            .and_then(|value| value.as_str())
                            .is_some_and(|value| !value.trim().is_empty())
                        && entry
                            .get("sourcePath")
                            .and_then(|value| value.as_str())
                            .is_some_and(|value| !value.trim().is_empty())
                        && entry.get("values").is_some_and(|value| value.is_object())
                        && matches!(
                            entry.get("role").and_then(|value| value.as_str()),
                            Some(
                                "base_fog"
                                    | "highlight_exposure"
                                    | "neutral_rgb_balance"
                                    | "shadow_black_point"
                            )
                        )
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    serde_json::json!({
        "corrections": corrections,
        "schemaVersion": 1
    })
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
        ..sanitized_params.clone()
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
            ..sanitized_params.clone()
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
            ..sanitized_params.clone()
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

fn is_valid_negative_lab_acquisition_profile(
    profile: &NegativeLabAcquisitionProfileSnapshot,
) -> bool {
    matches!(
        profile.id.as_str(),
        "camera_raw_linear_v1"
            | "dng_linear_camera_v1"
            | "scanner_tiff_16bit_flat_v1"
            | "scanner_rgb_jpeg_review_v1"
    ) && matches!(
        profile.channel_basis.as_str(),
        "camera_rgb" | "scanner_rgb" | "rendered_rgb"
    ) && matches!(
        profile.input_transform.as_str(),
        "linear_camera_raw" | "linear_dng" | "scanner_rgb_flat" | "rendered_rgb_review_only"
    ) && !profile.display_name.trim().is_empty()
        && !profile.provenance_summary.trim().is_empty()
}

fn sanitize_negative_lab_acquisition_profile(
    profile: NegativeLabAcquisitionProfileSnapshot,
) -> NegativeLabAcquisitionProfileSnapshot {
    if is_valid_negative_lab_acquisition_profile(&profile) {
        return profile;
    }
    default_negative_lab_acquisition_profile()
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
    let output_stem = format!("{}_{}", stem, save_options.suffix);

    for collision_index in 0..10_000 {
        let candidate_stem = if collision_index == 0 {
            output_stem.clone()
        } else {
            format!("{output_stem}-{collision_index}")
        };
        let candidate = parent.join(format!("{candidate_stem}.{extension}"));
        if candidate.exists() || negative_lab_output_sidecar_path(&candidate).exists() {
            continue;
        }
        if save_options.write_conversion_bundle
            && negative_lab_conversion_bundle_path(&candidate).exists()
        {
            continue;
        }
        return candidate;
    }

    parent.join(format!(
        "{}-{}.{}",
        output_stem,
        Uuid::new_v4().simple(),
        extension
    ))
}

fn validate_render_intent_output_format(
    render_intent: NegativeLabRenderIntent,
    output_format: NegativeConversionOutputFormat,
) -> Result<(), String> {
    if render_intent == NegativeLabRenderIntent::FlatLogMaster
        && output_format != NegativeConversionOutputFormat::Tiff16
    {
        return Err("Flat-log master intent only supports TIFF16 output.".to_string());
    }
    Ok(())
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

fn negative_lab_file_state(path: &Path, label: &str) -> Result<serde_json::Value, String> {
    let metadata = fs::metadata(path)
        .map_err(|e| format!("Failed to read Negative Lab {label} metadata: {}", e))?;
    let modified_unix_ms = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    Ok(serde_json::json!({
        "contentHash": hash_negative_lab_file(path, label)?,
        "filename": negative_lab_path_filename(path),
        "modifiedUnixMs": modified_unix_ms,
        "path": path.to_string_lossy(),
        "sizeBytes": metadata.len(),
    }))
}

#[derive(Debug, Clone)]
struct NegativeLabConversionBundleOutputRef {
    density_normalization_metrics: NegativeLabDensityNormalizationMetrics,
    auto_meter: NegativeLabAutoMeterReceipt,
    #[allow(dead_code)]
    color_finish_metrics: Option<NegativeLabColorFinishMetrics>,
    flat_log_master: NegativeLabFlatLogMasterParams,
    render_intent: NegativeLabRenderIntent,
    source_path: PathBuf,
    output_path: PathBuf,
    sidecar_path: PathBuf,
    output_width: u32,
    output_height: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabSavedPositiveDimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NegativeLabSavedPositiveHandoff {
    pub artifact_id: String,
    pub conversion_bundle_path: Option<String>,
    pub density_normalization_metrics: NegativeLabDensityNormalizationMetrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_finish_metrics: Option<NegativeLabColorFinishMetrics>,
    pub flat_log_master: NegativeLabFlatLogMasterParams,
    pub frame_exposure_overrides: NegativeLabFrameExposureOverridePayload,
    pub frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload,
    pub output_artifact_id: String,
    pub output_format: String,
    pub output_hash: String,
    pub output_path: String,
    pub path: String,
    pub positive_variant_id: String,
    pub profile_provenance_hash: Option<String>,
    pub replay_plan_hash: String,
    pub render_intent: NegativeLabRenderIntent,
    pub selected_acquisition_profile: NegativeLabAcquisitionProfileSnapshot,
    pub selected_profile: Option<NegativeLabSelectedProfileSnapshot>,
    pub sidecar_path: String,
    pub source_image_ref: String,
    pub source_path: String,
    pub dimensions: NegativeLabSavedPositiveDimensions,
}

#[derive(Debug, Clone)]
struct NegativeLabOutputSidecarReceipt {
    artifact_id: String,
    output_artifact_id: String,
    output_hash: String,
    positive_variant_id: String,
    replay_plan_hash: String,
    sidecar_path: PathBuf,
}

struct NegativeLabOutputRenderReceipt<'a> {
    density_normalization_metrics: &'a NegativeLabDensityNormalizationMetrics,
    auto_meter: Option<&'a NegativeLabAutoMeterReceipt>,
    color_finish_metrics: Option<&'a NegativeLabColorFinishMetrics>,
    neutral_axis_analysis: Option<&'a NegativeLabNeutralAxisAnalysis>,
    dimensions: NegativeLabSavedPositiveDimensions,
    flat_log_master: NegativeLabFlatLogMasterParams,
    render_intent: NegativeLabRenderIntent,
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

fn build_negative_lab_replay_plan_hash(
    params: &NegativeConversionParams,
    save_options: &NegativeConversionSaveOptions,
    output_format: &str,
    source_paths: Vec<String>,
) -> String {
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
        "patchSamplerCorrections": save_options.patch_sampler_corrections.clone(),
        "paths": source_paths,
        "profileProvenanceHash": profile_hash,
        "suffix": save_options.suffix,
        "selectedAcquisitionProfile": save_options.selected_acquisition_profile.clone(),
    })
    .to_string();
    format!("fnv1a32:{}", build_negative_lab_plan_hash(&replay_seed))
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
                "densityNormalizationMetrics": output.density_normalization_metrics,
                "autoMeter": output.auto_meter,
                "colorFinishMetrics": output.color_finish_metrics,
                "flatLogMaster": output.flat_log_master,
                "dimensions": {
                    "height": output.output_height,
                    "width": output.output_width,
                },
                "format": output_format,
                "renderIntent": output.render_intent,
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
    let replay_plan_hash = build_negative_lab_replay_plan_hash(
        params,
        save_options,
        output_format,
        outputs
            .iter()
            .map(|output| output.source_path.to_string_lossy().to_string())
            .collect::<Vec<_>>(),
    );
    let bundle = serde_json::json!({
        "acquisition": {
            "selectedProfile": save_options.selected_acquisition_profile,
            "sourceFamilies": save_options.acquisition_source_families,
            "warningCodes": save_options.acquisition_warning_codes,
        },
        "conversion": {
            "acceptedDryRunPlanHash": save_options.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": save_options.accepted_dry_run_plan_id,
            "frameExposureOverrides": save_options.frame_exposure_overrides.clone(),
            "frameRgbBalanceOverrides": save_options.frame_rgb_balance_overrides.clone(),
            "outputFormat": output_format,
            "renderIntent": params.render_intent,
            "flatLogMaster": params.flat_log_master,
            "patchSamplerCorrections": save_options.patch_sampler_corrections.clone(),
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

fn attach_negative_lab_conversion_bundle_path_to_output_sidecars(
    bundle_path: &Path,
    outputs: &[NegativeLabConversionBundleOutputRef],
) -> Result<(), String> {
    let bundle_path_value = serde_json::Value::String(bundle_path.to_string_lossy().to_string());

    for output in outputs {
        let mut sidecar = crate::exif_processing::load_sidecar(&output.sidecar_path);
        let Some(artifacts) = sidecar.raw_engine_artifacts.as_mut() else {
            continue;
        };
        let output_path = output.output_path.to_string_lossy().to_string();
        let mut changed = false;

        for artifact in &mut artifacts.negative_lab_artifacts {
            let matches_output = artifact
                .get("outputArtifacts")
                .and_then(|value| value.as_array())
                .map(|outputs| {
                    outputs.iter().any(|candidate| {
                        candidate.get("path").and_then(|value| value.as_str())
                            == Some(output_path.as_str())
                    })
                })
                .unwrap_or(false);

            if !matches_output {
                continue;
            }

            if let Some(object) = artifact.as_object_mut() {
                if object.get("conversionBundlePath") != Some(&bundle_path_value) {
                    object.insert(
                        "conversionBundlePath".to_string(),
                        bundle_path_value.clone(),
                    );
                    changed = true;
                }
                if let Some(conversion) = object
                    .get_mut("conversion")
                    .and_then(|value| value.as_object_mut())
                    && conversion.get("conversionBundlePath") != Some(&bundle_path_value)
                {
                    conversion.insert(
                        "conversionBundlePath".to_string(),
                        bundle_path_value.clone(),
                    );
                    changed = true;
                }
            }
        }

        if changed {
            let json = serde_json::to_string_pretty(&sidecar).map_err(|e| {
                format!(
                    "Failed to serialize Negative Lab sidecar with conversion bundle path: {}",
                    e
                )
            })?;
            fs::write(&output.sidecar_path, json).map_err(|e| {
                format!(
                    "Failed to update Negative Lab sidecar {} with conversion bundle path: {}",
                    output.sidecar_path.display(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

fn write_negative_lab_output_sidecar(
    output_path: &Path,
    source_path: &Path,
    params: &NegativeConversionParams,
    save_options: &NegativeConversionSaveOptions,
    accepted_dust_heal_layers: &[serde_json::Value],
    replay_plan_hash: &str,
    render_receipt: NegativeLabOutputRenderReceipt<'_>,
) -> Result<NegativeLabOutputSidecarReceipt, String> {
    let sidecar_path = negative_lab_output_sidecar_path(output_path);
    let mut sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
    let artifact_id = format!("artifact_negative_lab_{}", Uuid::new_v4().simple());
    let output_artifact_id = format!("{}_output", artifact_id);
    let positive_variant_id = format!("positive_variant_{}", Uuid::new_v4().simple());
    let content_hash = hash_negative_lab_output_file(output_path)?;
    let source_state = negative_lab_file_state(source_path, "source")?;
    let output_state = negative_lab_file_state(output_path, "output")?;
    let output_format = match save_options.output_format {
        NegativeConversionOutputFormat::JpegProof => "jpeg_proof",
        NegativeConversionOutputFormat::Tiff16 => "tiff16",
    };

    let artifact = serde_json::json!({
        "artifactId": artifact_id,
        "createdAt": Utc::now().to_rfc3339(),
        "sidecarPath": sidecar_path.to_string_lossy(),
        "conversion": {
            "acceptedDryRunPlanHash": save_options.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": save_options.accepted_dry_run_plan_id,
            "acceptedDryRunIdentity": {
                "planHash": save_options.accepted_dry_run_plan_hash,
                "planId": save_options.accepted_dry_run_plan_id,
                "replayPlanHash": replay_plan_hash,
            },
            "frameExposureOverrides": save_options.frame_exposure_overrides.clone(),
            "frameRgbBalanceOverrides": save_options.frame_rgb_balance_overrides.clone(),
            "densityNormalizationMetrics": render_receipt.density_normalization_metrics,
            "autoMeter": render_receipt.auto_meter,
            "colorFinishMetrics": render_receipt.color_finish_metrics,
            "neutralAxisAnalysis": render_receipt.neutral_axis_analysis,
            "flatLogMaster": render_receipt.flat_log_master,
            "noOverwritePolicy": "never_overwrite_original",
            "outputFormat": output_format,
            "renderIntent": render_receipt.render_intent,
            "patchSamplerCorrections": save_options.patch_sampler_corrections.clone(),
            "params": params,
            "profileProvenanceHash": save_options.profile_provenance_hash,
            "recipeHash": replay_plan_hash,
            "selectedProfile": save_options.selected_profile.clone(),
            "selectedAcquisitionProfile": save_options.selected_acquisition_profile.clone(),
        },
        "acquisition": {
            "selectedProfile": save_options.selected_acquisition_profile.clone(),
            "sourceFamilies": save_options.acquisition_source_families.clone(),
            "warningCodes": save_options.acquisition_warning_codes.clone(),
        },
        "operationId": "negative_lab.convert",
        "operationVersion": 1,
        "outputArtifacts": [{
            "artifactId": output_artifact_id,
            "contentHash": content_hash,
            "dimensions": {
                "height": render_receipt.dimensions.height,
                "width": render_receipt.dimensions.width,
            },
            "fileState": output_state,
            "format": output_format,
            "kind": "negative_lab_positive",
            "path": output_path.to_string_lossy(),
            "outputIntent": "editable_positive",
            "positiveVariantId": positive_variant_id,
            "storage": "sidecar_artifact",
        }],
        "provenance": {
            "commandId": "command_negative_lab_convert",
            "noOverwritePolicy": "never_overwrite_original",
            "proofState": "runtime_rendered_positive",
            "profileProvenanceHash": save_options.profile_provenance_hash,
            "selectedAcquisitionProfile": save_options.selected_acquisition_profile.clone(),
            "selectedProfile": save_options.selected_profile.clone(),
            "runtimeStatus": "rendered",
            "warningCodes": save_options.acquisition_warning_codes.clone(),
        },
        "replay": {
            "appServerCommand": "negative.lab.conversion_plan",
            "identityHash": replay_plan_hash,
            "requiresSourceFiles": true,
        },
        "schemaVersion": 1,
        "staleState": {
            "invalidationReasons": [],
            "state": "current",
        },
        "sourceImageRefs": [{
            "contentHash": source_state.get("contentHash").cloned().unwrap_or(serde_json::Value::Null),
            "fileState": source_state,
            "imagePath": source_path.to_string_lossy(),
        }],
        "warnings": save_options.acquisition_warning_codes.clone(),
    });

    let artifacts = sidecar
        .raw_engine_artifacts
        .get_or_insert_with(RawEngineArtifacts::new_v1);
    artifacts.schema_version = 1;
    artifacts.negative_lab_artifacts.push(artifact);
    upsert_negative_lab_layer_stack_sidecar(
        artifacts,
        output_path,
        &positive_variant_id,
        &artifact_id,
        accepted_dust_heal_layers,
    );
    artifacts.stale_artifact_ids.retain(|id| !id.is_empty());

    crate::exif_processing::save_sidecar_metadata_atomic(&sidecar_path, &sidecar)?;

    Ok(NegativeLabOutputSidecarReceipt {
        artifact_id,
        output_artifact_id,
        output_hash: content_hash,
        positive_variant_id,
        replay_plan_hash: replay_plan_hash.to_string(),
        sidecar_path,
    })
}

pub(crate) fn refresh_negative_lab_stale_artifacts(
    metadata: &mut crate::image_processing::ImageMetadata,
) -> bool {
    let Some(artifacts) = metadata.raw_engine_artifacts.as_mut() else {
        return false;
    };

    let mut changed = false;
    let mut negative_stale_ids = Vec::new();
    for artifact in &mut artifacts.negative_lab_artifacts {
        let Some(artifact_id) = artifact
            .get("artifactId")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
        else {
            continue;
        };
        let reasons = negative_lab_artifact_stale_reasons(artifact);
        let stale_state = if reasons.is_empty() {
            "current"
        } else {
            "stale"
        };
        if !reasons.is_empty() {
            negative_stale_ids.push(artifact_id.clone());
        }
        let next_stale_state = serde_json::json!({
            "invalidationReasons": reasons,
            "state": stale_state,
        });
        if artifact.get("staleState") != Some(&next_stale_state)
            && let Some(object) = artifact.as_object_mut()
        {
            object.insert("staleState".to_string(), next_stale_state);
            changed = true;
        }
    }

    let negative_artifact_ids = artifacts
        .negative_lab_artifacts
        .iter()
        .filter_map(|artifact| artifact.get("artifactId").and_then(|value| value.as_str()))
        .collect::<std::collections::HashSet<_>>();
    let mut stale_artifact_ids = artifacts
        .stale_artifact_ids
        .iter()
        .filter(|artifact_id| !negative_artifact_ids.contains(artifact_id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    stale_artifact_ids.extend(negative_stale_ids);
    stale_artifact_ids.retain(|id| !id.is_empty());

    if artifacts.stale_artifact_ids != stale_artifact_ids {
        artifacts.stale_artifact_ids = stale_artifact_ids;
        changed = true;
    }

    changed
}

fn negative_lab_artifact_stale_reasons(artifact: &serde_json::Value) -> Vec<&'static str> {
    let mut reasons = Vec::new();
    let output = artifact
        .get("outputArtifacts")
        .and_then(|value| value.as_array())
        .and_then(|outputs| outputs.first());
    let output_path = output
        .and_then(|value| value.get("path"))
        .and_then(|value| value.as_str());
    match output_path {
        Some(path) if Path::new(path).exists() => {
            if let Some(expected_hash) = output
                .and_then(|value| value.get("contentHash"))
                .and_then(|value| value.as_str())
                && hash_negative_lab_output_file(Path::new(path))
                    .ok()
                    .as_deref()
                    != Some(expected_hash)
            {
                reasons.push("output_artifact_changed");
            }
            negative_lab_push_file_state_reasons(
                &mut reasons,
                output.and_then(|value| value.get("fileState")),
                Path::new(path),
                "output_artifact_changed",
            );
        }
        _ => reasons.push("output_artifact_missing"),
    }

    let source = artifact
        .get("sourceImageRefs")
        .and_then(|value| value.as_array())
        .and_then(|sources| sources.first());
    let source_path = source
        .and_then(|value| value.get("imagePath"))
        .and_then(|value| value.as_str());
    match source_path {
        Some(path) if Path::new(path).exists() => {
            if let Some(expected_hash) = source
                .and_then(|value| value.get("contentHash"))
                .and_then(|value| value.as_str())
                && hash_negative_lab_file(Path::new(path), "source")
                    .ok()
                    .as_deref()
                    != Some(expected_hash)
            {
                reasons.push("source_content_hash_changed");
            }
            negative_lab_push_file_state_reasons(
                &mut reasons,
                source.and_then(|value| value.get("fileState")),
                Path::new(path),
                "source_file_state_changed",
            );
        }
        _ => reasons.push("source_missing"),
    }

    let replay_hash = artifact
        .get("replay")
        .and_then(|value| value.get("identityHash"))
        .and_then(|value| value.as_str());
    let recipe_hash = artifact
        .get("conversion")
        .and_then(|value| value.get("recipeHash"))
        .and_then(|value| value.as_str());
    if replay_hash.is_none() || recipe_hash.is_none() || replay_hash != recipe_hash {
        reasons.push("recipe_hash_changed");
    }

    reasons.sort_unstable();
    reasons.dedup();
    reasons
}

fn negative_lab_push_file_state_reasons(
    reasons: &mut Vec<&'static str>,
    file_state: Option<&serde_json::Value>,
    path: &Path,
    reason: &'static str,
) {
    let Some(file_state) = file_state else {
        reasons.push(reason);
        return;
    };
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => {
            reasons.push(reason);
            return;
        }
    };
    if file_state.get("sizeBytes").and_then(|value| value.as_u64()) != Some(metadata.len()) {
        reasons.push(reason);
        return;
    }
    let modified_unix_ms = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    if file_state
        .get("modifiedUnixMs")
        .and_then(|value| value.as_u64())
        != modified_unix_ms
    {
        reasons.push(reason);
    }
}

fn upsert_negative_lab_layer_stack_sidecar(
    artifacts: &mut RawEngineArtifacts,
    output_path: &Path,
    positive_variant_id: &str,
    artifact_id: &str,
    layers: &[serde_json::Value],
) {
    let output_image_path = output_path.to_string_lossy().to_string();
    artifacts.layer_stack_sidecars.retain(|sidecar| {
        sidecar
            .get("sourceImagePath")
            .and_then(|value| value.as_str())
            .is_none_or(|source_image_path| source_image_path != output_image_path)
    });
    artifacts.layer_stack_sidecars.push(serde_json::json!({
        "graphRevision": format!("graph_negative_lab_{}", positive_variant_id),
        "layers": layers,
        "lastCommandId": format!("command_seed_layer_stack_{}", artifact_id),
        "schemaVersion": 1,
        "sourceImagePath": output_image_path,
        "storage": "sidecar_artifact",
    }));
}

impl NegativeConversionParams {
    fn sanitized(self) -> Self {
        fn finite_or_default(value: f32, fallback: f32) -> f32 {
            if value.is_finite() { value } else { fallback }
        }

        let defaults = Self::default();
        let base_fog_sample = self.base_fog_sample.and_then(sanitize_sample_rect);

        Self {
            process_family: self.process_family,
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
            base_fog_sample,
            analysis_buffer: finite_or_default(self.analysis_buffer, defaults.analysis_buffer)
                .clamp(0.0, 0.25),
            base_fog_bounds_provenance: if base_fog_sample.is_some() {
                self.base_fog_bounds_provenance
            } else {
                NegativeLabBaseFogBoundsProvenance::AutomaticAnalysis
            },
            bounds_schema_version: default_bounds_schema_version(),
            exposure: finite_or_default(self.exposure, defaults.exposure)
                .clamp(MIN_EXPOSURE, MAX_EXPOSURE),
            contrast: finite_or_default(self.contrast, defaults.contrast)
                .clamp(MIN_CONTRAST, MAX_CONTRAST),
            black_point: finite_or_default(self.black_point, defaults.black_point)
                .clamp(MIN_BLACK_POINT, MAX_BLACK_POINT),
            black_point_offset: finite_or_default(
                self.black_point_offset,
                defaults.black_point_offset,
            )
            .clamp(-0.25, 0.25),
            color_range_clip: finite_or_default(self.color_range_clip, defaults.color_range_clip)
                .clamp(0.01, 0.3),
            luma_range_clip: finite_or_default(self.luma_range_clip, defaults.luma_range_clip)
                .clamp(0.01, 0.3),
            white_point_offset: finite_or_default(
                self.white_point_offset,
                defaults.white_point_offset,
            )
            .clamp(-0.25, 0.25),
            white_point: finite_or_default(self.white_point, defaults.white_point)
                .clamp(MIN_WHITE_POINT, MAX_WHITE_POINT),
            conversion_model: self.conversion_model,
            source_interpretation_hash: self.source_interpretation_hash.clone(),
            color_finish: self.color_finish.sanitized(),
            cmy_timing: self.cmy_timing.sanitized(),
            neutral_axis: self.neutral_axis.sanitized(),
            detail_finish: self.detail_finish.sanitized(),
            optical_finish: self.optical_finish.sanitized(),
            render_intent: self.render_intent,
            flat_log_master: self.flat_log_master.sanitized(),
            print_curve_algorithm: self.print_curve_algorithm,
            print_curve_v2: self
                .print_curve_v2
                .map(NegativeLabHdPaperCurveParams::sanitized),
            paper_profile: self
                .paper_profile
                .map(NegativeLabPaperProfileSnapshot::sanitized),
            auto_meter: self.auto_meter.sanitized(),
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

#[derive(Debug, Clone, Copy)]
struct NegativeLabDensityMetricsAccumulator {
    min: [f32; 3],
    max: [f32; 3],
}

impl Default for NegativeLabDensityMetricsAccumulator {
    fn default() -> Self {
        Self {
            min: [f32::INFINITY; 3],
            max: [f32::NEG_INFINITY; 3],
        }
    }
}

impl NegativeLabDensityMetricsAccumulator {
    fn observe(&mut self, normalized_density: [f32; 3]) {
        for (channel_index, value) in normalized_density.into_iter().enumerate() {
            self.min[channel_index] = self.min[channel_index].min(value);
            self.max[channel_index] = self.max[channel_index].max(value);
        }
    }

    fn merge(mut self, other: Self) -> Self {
        for channel_index in 0..3 {
            self.min[channel_index] = self.min[channel_index].min(other.min[channel_index]);
            self.max[channel_index] = self.max[channel_index].max(other.max[channel_index]);
        }
        self
    }

    fn into_metrics(
        self,
        clipped_pixel_count: u32,
        epsilon_clamped_pixel_count: u32,
        bounds_receipt: NegativeLabDensityBoundsReceipt,
    ) -> NegativeLabDensityNormalizationMetrics {
        let fallback = ChannelBounds { min: 0.0, max: 0.0 };
        let red = if self.min[0].is_finite() && self.max[0].is_finite() {
            ChannelBounds {
                min: self.min[0],
                max: self.max[0],
            }
        } else {
            fallback
        };
        let green = if self.min[1].is_finite() && self.max[1].is_finite() {
            ChannelBounds {
                min: self.min[1],
                max: self.max[1],
            }
        } else {
            fallback
        };
        let blue = if self.min[2].is_finite() && self.max[2].is_finite() {
            ChannelBounds {
                min: self.min[2],
                max: self.max[2],
            }
        } else {
            fallback
        };
        let global_min = red.min.min(green.min).min(blue.min);
        let global_max = red.max.max(green.max).max(blue.max);

        let axis_bounds = bounds_receipt.final_bounds.axis_bounds;
        NegativeLabDensityNormalizationMetrics {
            axis_bounds,
            bounds_receipt,
            channel_bounds: NegativeLabDensityNormalizationChannelBounds {
                r: NegativeLabDensityChannelBoundsSummary {
                    min: red.min,
                    max: red.max,
                },
                g: NegativeLabDensityChannelBoundsSummary {
                    min: green.min,
                    max: green.max,
                },
                b: NegativeLabDensityChannelBoundsSummary {
                    min: blue.min,
                    max: blue.max,
                },
            },
            clipped_pixel_count,
            crosstalk_receipt: None,
            density_range_unclamped: (global_max - global_min).max(0.0),
            epsilon_clamped_pixel_count,
            renderer_version: NEGATIVE_LAB_LOG_DENSITY_RENDERER_VERSION,
        }
    }
}

#[derive(Debug, Clone)]
struct NegativeLabPipelineRender {
    normalized_density_preview: DynamicImage,
    rendered_preview: DynamicImage,
    scene_linear_print_preview: DynamicImage,
    density_normalization_metrics: NegativeLabDensityNormalizationMetrics,
    density_scopes: NegativeLabDensityScopes,
    detail_finish_metrics: NegativeLabDetailFinishMetrics,
    color_finish_metrics: NegativeLabColorFinishMetrics,
    optical_finish_metrics: NegativeLabOpticalFinishMetrics,
    cmy_timing_metrics: NegativeLabCmyTimingMetrics,
    neutral_axis_analysis: NegativeLabNeutralAxisAnalysis,
    auto_meter: NegativeLabAutoMeterReceipt,
}

fn negative_lab_density_from_linear_channel(value: f32) -> f32 {
    negative_log_density_channel(value)
}

fn negative_lab_count_density_input_guards(raw_pixels: &[f32]) -> (u32, u32) {
    raw_pixels
        .chunks_exact(3)
        .fold((0_u32, 0_u32), |(epsilon_count, clipped_count), pixel| {
            let epsilon_hit = pixel
                .iter()
                .any(|&value| !value.is_finite() || value <= NEGATIVE_LAB_DENSITY_EPSILON);
            let clipped_hit = pixel
                .iter()
                .any(|&value| !value.is_finite() || !(0.0..=1.0).contains(&value));

            (
                epsilon_count + u32::from(epsilon_hit),
                clipped_count + u32::from(clipped_hit),
            )
        })
}

fn build_negative_lab_scope_histogram(values: &[f32]) -> NegativeLabScopeHistogram {
    let finite_values: Vec<f32> = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect();
    let min = finite_values
        .iter()
        .copied()
        .reduce(f32::min)
        .unwrap_or(0.0);
    let max = finite_values
        .iter()
        .copied()
        .reduce(f32::max)
        .unwrap_or(1.0)
        .max(min);
    let span = (max - min).max(f32::EPSILON);
    let mut bins = vec![0_u32; NEGATIVE_LAB_SCOPE_HISTOGRAM_BINS];
    for value in finite_values {
        let position = ((value - min) / span).clamp(0.0, 1.0);
        let index = ((position * NEGATIVE_LAB_SCOPE_HISTOGRAM_BINS as f32).floor() as usize)
            .min(NEGATIVE_LAB_SCOPE_HISTOGRAM_BINS - 1);
        bins[index] = bins[index].saturating_add(1);
    }
    NegativeLabScopeHistogram { bins, max, min }
}

fn build_negative_lab_density_scopes(
    log_pixels: &[f32],
    out_buffer: &[f32],
    clipped_pixel_count: u32,
) -> NegativeLabDensityScopes {
    let mut density_values = Vec::with_capacity(log_pixels.len() / 3);
    let mut output_luma_values = Vec::with_capacity(out_buffer.len() / 3);
    let mut gamut_out_of_range_pixel_count = 0_u32;
    for (log_pixel, output_pixel) in log_pixels.chunks_exact(3).zip(out_buffer.chunks_exact(3)) {
        let input_density = (log_pixel[0] + log_pixel[1] + log_pixel[2]) / 3.0;
        let output_luma =
            0.2126 * output_pixel[0] + 0.7152 * output_pixel[1] + 0.0722 * output_pixel[2];
        density_values.push(input_density);
        output_luma_values.push(output_luma);
        if output_pixel
            .iter()
            .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
        {
            gamut_out_of_range_pixel_count = gamut_out_of_range_pixel_count.saturating_add(1);
        }
    }

    let mut curve_pairs: Vec<(f32, f32)> = density_values
        .iter()
        .copied()
        .zip(output_luma_values.iter().copied())
        .collect();
    curve_pairs.sort_by(|left, right| left.0.total_cmp(&right.0));
    let sample_count = curve_pairs.len() as u32;
    let h_and_d_curve = if curve_pairs.is_empty() {
        Vec::new()
    } else {
        (0..NEGATIVE_LAB_SCOPE_CURVE_SAMPLES)
            .map(|sample_index| {
                let position = if NEGATIVE_LAB_SCOPE_CURVE_SAMPLES == 1 {
                    0.0
                } else {
                    sample_index as f32 / (NEGATIVE_LAB_SCOPE_CURVE_SAMPLES - 1) as f32
                };
                let index = ((curve_pairs.len() - 1) as f32 * position).round() as usize;
                NegativeLabDensityScopePoint {
                    input_density: curve_pairs[index].0,
                    output_luma: curve_pairs[index].1,
                }
            })
            .collect()
    };

    NegativeLabDensityScopes {
        algorithm_id: "native_negative_lab_density_scopes_v1".to_string(),
        clipped_pixel_count,
        density_histogram: build_negative_lab_scope_histogram(&density_values),
        gamut_out_of_range_pixel_count,
        h_and_d_curve,
        output_luma_histogram: build_negative_lab_scope_histogram(&output_luma_values),
        sample_count,
        schema_version: 1,
    }
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

fn percentile_from_sorted(values: &[f32], percentile: f32) -> f32 {
    if values.is_empty() {
        return 0.0;
    }

    let clamped_percentile = percentile.clamp(0.0, 1.0);
    let position = (values.len().saturating_sub(1)) as f32 * clamped_percentile;
    let lower_index = position.floor() as usize;
    let upper_index = position.ceil() as usize;
    let lower_value = values[lower_index.min(values.len().saturating_sub(1))];
    let upper_value = values[upper_index.min(values.len().saturating_sub(1))];

    if lower_index == upper_index {
        lower_value
    } else {
        lower_value + ((upper_value - lower_value) * (position - lower_index as f32))
    }
}

fn median_from_sorted(values: &[f32]) -> f32 {
    percentile_from_sorted(values, 0.5)
}

fn percentile_bounds(mut values: Vec<f32>, tail_clip: f32) -> ChannelBounds {
    if values.is_empty() {
        return ChannelBounds { min: 0.0, max: 0.0 };
    }

    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let clip = tail_clip.clamp(0.0, 0.49);
    let min = percentile_from_sorted(&values, clip);
    let max = percentile_from_sorted(&values, 1.0 - clip);
    let safe_max = if max <= min + NEGATIVE_LAB_DENSITY_RANGE_EPSILON {
        min + NEGATIVE_LAB_DENSITY_RANGE_EPSILON
    } else {
        max
    };

    ChannelBounds { min, max: safe_max }
}

#[derive(Debug, Clone, Copy)]
struct AnalysisWindow {
    end_x: usize,
    end_y: usize,
    start_x: usize,
    start_y: usize,
}

#[derive(Debug, Clone)]
struct NegativeLabRobustBoundsAnalysis {
    base_density: [f32; 3],
    chroma_bounds: [ChannelBounds; 3],
    luma_bounds: ChannelBounds,
    receipt: NegativeLabDensityBoundsReceipt,
}

fn build_analysis_window(width: usize, height: usize, analysis_buffer: f32) -> AnalysisWindow {
    let margin_x = (analysis_buffer.clamp(0.0, 0.25) * width as f32).round() as usize;
    let margin_y = (analysis_buffer.clamp(0.0, 0.25) * height as f32).round() as usize;
    let start_x = margin_x.min(width.saturating_sub(1));
    let start_y = margin_y.min(height.saturating_sub(1));
    AnalysisWindow {
        end_x: width.saturating_sub(margin_x).max(start_x + 1),
        end_y: height.saturating_sub(margin_y).max(start_y + 1),
        start_x,
        start_y,
    }
}

fn sample_rect_analysis_window(
    width: usize,
    height: usize,
    sample_rect: NegativeBaseFogSampleRect,
    analysis_buffer: f32,
) -> AnalysisWindow {
    let buffer_x = (analysis_buffer.clamp(0.0, 0.25) * width as f32).round() as usize;
    let buffer_y = (analysis_buffer.clamp(0.0, 0.25) * height as f32).round() as usize;
    let start_x = ((sample_rect.x * width as f32).floor() as usize)
        .saturating_sub(buffer_x)
        .min(width.saturating_sub(1));
    let start_y = ((sample_rect.y * height as f32).floor() as usize)
        .saturating_sub(buffer_y)
        .min(height.saturating_sub(1));
    AnalysisWindow {
        end_x: (((sample_rect.x + sample_rect.width) * width as f32).ceil() as usize)
            .saturating_add(buffer_x)
            .clamp(start_x + 1, width),
        end_y: (((sample_rect.y + sample_rect.height) * height as f32).ceil() as usize)
            .saturating_add(buffer_y)
            .clamp(start_y + 1, height),
        start_x,
        start_y,
    }
}

fn fixed_grid_block_medians(
    log_data: &[f32],
    width: usize,
    window: AnalysisWindow,
) -> Vec<[f32; 3]> {
    const GRID_SIZE: usize = 12;
    let span_x = window.end_x.saturating_sub(window.start_x).max(1);
    let span_y = window.end_y.saturating_sub(window.start_y).max(1);
    let mut medians = Vec::with_capacity(GRID_SIZE * GRID_SIZE);

    for grid_y in 0..GRID_SIZE {
        let block_start_y = window.start_y + (span_y * grid_y) / GRID_SIZE;
        let block_end_y = window.start_y + (span_y * (grid_y + 1)) / GRID_SIZE;
        if block_start_y >= block_end_y {
            continue;
        }
        for grid_x in 0..GRID_SIZE {
            let block_start_x = window.start_x + (span_x * grid_x) / GRID_SIZE;
            let block_end_x = window.start_x + (span_x * (grid_x + 1)) / GRID_SIZE;
            if block_start_x >= block_end_x {
                continue;
            }

            let mut channels = [Vec::new(), Vec::new(), Vec::new()];
            for y in block_start_y..block_end_y {
                let row_offset = y * width * 3;
                for x in block_start_x..block_end_x {
                    let index = row_offset + x * 3;
                    if index + 2 >= log_data.len() {
                        continue;
                    }
                    for channel_index in 0..3 {
                        let value = log_data[index + channel_index];
                        if value.is_finite() {
                            channels[channel_index].push(value);
                        }
                    }
                }
            }
            if channels.iter().all(|values| !values.is_empty()) {
                for values in &mut channels {
                    values
                        .sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
                }
                medians.push([
                    median_from_sorted(&channels[0]),
                    median_from_sorted(&channels[1]),
                    median_from_sorted(&channels[2]),
                ]);
            }
        }
    }

    medians
}

fn density_luma(channels: [f32; 3]) -> f32 {
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

fn project_zero_luma(mut channels: [f32; 3]) -> [f32; 3] {
    let luma = density_luma(channels);
    for channel in &mut channels {
        *channel -= luma;
    }
    channels
}

fn channel_bounds_summary(
    bounds: [ChannelBounds; 3],
) -> NegativeLabDensityNormalizationChannelBounds {
    let summary = |bound: ChannelBounds| NegativeLabDensityChannelBoundsSummary {
        max: bound.max,
        min: bound.min,
    };
    NegativeLabDensityNormalizationChannelBounds {
        r: summary(bounds[0]),
        g: summary(bounds[1]),
        b: summary(bounds[2]),
    }
}

fn analyze_robust_density_bounds(
    log_data: &[f32],
    width: usize,
    height: usize,
    params: &NegativeConversionParams,
) -> NegativeLabRobustBoundsAnalysis {
    let analysis_window = build_analysis_window(width, height, params.analysis_buffer);
    let analysis_medians = fixed_grid_block_medians(log_data, width, analysis_window);
    let sample_rect = params.base_fog_sample.and_then(sanitize_sample_rect);
    let base_medians = sample_rect
        .map(|rect| {
            fixed_grid_block_medians(
                log_data,
                width,
                sample_rect_analysis_window(width, height, rect, params.analysis_buffer),
            )
        })
        .filter(|medians| !medians.is_empty())
        .unwrap_or_else(|| analysis_medians.clone());
    let base_channel_bounds = std::array::from_fn(|channel_index| {
        percentile_bounds(
            base_medians
                .iter()
                .map(|channels| channels[channel_index])
                .collect(),
            0.1,
        )
    });
    let base_density = std::array::from_fn(|channel_index| {
        let bounds = base_channel_bounds[channel_index];
        let automatic_floor = bounds.min;
        let manual_center = (bounds.min + bounds.max) * 0.5;
        (if sample_rect.is_some() {
            manual_center
        } else {
            automatic_floor
        }) * params.base_fog_strength
    });
    let mut luma_values = Vec::with_capacity(analysis_medians.len());
    let mut chroma_values = [Vec::new(), Vec::new(), Vec::new()];
    for channels in &analysis_medians {
        let relative = [
            channels[0] - base_density[0],
            channels[1] - base_density[1],
            channels[2] - base_density[2],
        ];
        let luma = density_luma(relative);
        luma_values.push(luma);
        for channel_index in 0..3 {
            chroma_values[channel_index].push(relative[channel_index] - luma);
        }
    }
    let analyzed_luma_bounds = percentile_bounds(luma_values, params.luma_range_clip);
    let analyzed_luma_span = (analyzed_luma_bounds.max - analyzed_luma_bounds.min)
        .max(NEGATIVE_LAB_DENSITY_RANGE_EPSILON);
    let luma_bounds = ChannelBounds {
        min: analyzed_luma_bounds.min + params.black_point_offset * analyzed_luma_span,
        max: (analyzed_luma_bounds.max + params.white_point_offset * analyzed_luma_span).max(
            analyzed_luma_bounds.min
                + params.black_point_offset * analyzed_luma_span
                + NEGATIVE_LAB_DENSITY_RANGE_EPSILON,
        ),
    };
    let raw_chroma_bounds: [ChannelBounds; 3] = std::array::from_fn(|channel_index| {
        percentile_bounds(
            std::mem::take(&mut chroma_values[channel_index]),
            params.color_range_clip,
        )
    });
    let projected_chroma_min = project_zero_luma(raw_chroma_bounds.map(|bounds| bounds.min));
    let projected_chroma_max = project_zero_luma(raw_chroma_bounds.map(|bounds| bounds.max));
    let chroma_bounds = std::array::from_fn(|channel_index| ChannelBounds {
        min: projected_chroma_min[channel_index].min(projected_chroma_max[channel_index]),
        max: projected_chroma_min[channel_index]
            .max(projected_chroma_max[channel_index])
            .max(projected_chroma_min[channel_index] + NEGATIVE_LAB_DENSITY_RANGE_EPSILON),
    });
    let final_channel_bounds = std::array::from_fn(|channel_index| ChannelBounds {
        min: luma_bounds.min + chroma_bounds[channel_index].min,
        max: luma_bounds.max + chroma_bounds[channel_index].max,
    });
    let base_luma_bounds = percentile_bounds(
        base_medians
            .iter()
            .map(|channels| density_luma(*channels))
            .collect(),
        0.1,
    );
    let base_chroma_bounds: [ChannelBounds; 3] = std::array::from_fn(|channel_index| {
        percentile_bounds(
            base_medians
                .iter()
                .map(|channels| channels[channel_index] - density_luma(*channels))
                .collect(),
            0.1,
        )
    });
    let color_axis = ChannelBounds {
        min: chroma_bounds
            .iter()
            .map(|bounds| bounds.min)
            .fold(f32::INFINITY, f32::min),
        max: chroma_bounds
            .iter()
            .map(|bounds| bounds.max)
            .fold(f32::NEG_INFINITY, f32::max),
    };
    let base_color_axis = ChannelBounds {
        min: base_chroma_bounds
            .iter()
            .map(|bounds| bounds.min)
            .fold(f32::INFINITY, f32::min),
        max: base_chroma_bounds
            .iter()
            .map(|bounds| bounds.max)
            .fold(f32::NEG_INFINITY, f32::max),
    };
    let axis_summary =
        |luma: ChannelBounds, color: ChannelBounds| NegativeLabDensityNormalizationAxisBounds {
            color: NegativeLabDensityAxisBoundsSummary {
                max: color.max,
                min: color.min,
            },
            luma: NegativeLabDensityAxisBoundsSummary {
                max: luma.max,
                min: luma.min,
            },
        };
    let base_spread = base_density
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max)
        - base_density.iter().copied().fold(f32::INFINITY, f32::min);
    let mean_base_range = base_channel_bounds
        .iter()
        .map(|bounds| bounds.max - bounds.min)
        .sum::<f32>()
        / 3.0;
    let base_confidence = ((mean_base_range * 2.0) + (base_spread * 1.5)).clamp(0.0, 1.0);
    let mut warning_codes = Vec::new();
    if base_confidence < 0.6 {
        warning_codes.push(NEGATIVE_LAB_BASE_FOG_WARNING_LOW_CONFIDENCE.to_string());
    }
    if base_confidence < 0.12 {
        warning_codes.push(NEGATIVE_LAB_BASE_FOG_WARNING_MISSING_VISIBLE_BASE.to_string());
    }
    if base_density
        .iter()
        .any(|density| 10.0_f32.powf(-density) <= 0.01 || 10.0_f32.powf(-density) >= 0.99)
    {
        warning_codes.push(NEGATIVE_LAB_BASE_FOG_WARNING_CLIPPED_CHANNEL.to_string());
    }
    if base_spread > 0.18 {
        warning_codes.push(NEGATIVE_LAB_BASE_FOG_WARNING_UNEVEN_ILLUMINATION.to_string());
    }
    warning_codes.sort();
    warning_codes.dedup();
    let receipt = NegativeLabDensityBoundsReceipt {
        algorithm_id: "fixed_grid_block_median_luma_color_v1".to_string(),
        analysis_buffer: params.analysis_buffer,
        analysis_rect: NegativeBaseFogSampleRect {
            height: (analysis_window.end_y - analysis_window.start_y) as f32 / height.max(1) as f32,
            width: (analysis_window.end_x - analysis_window.start_x) as f32 / width.max(1) as f32,
            x: analysis_window.start_x as f32 / width.max(1) as f32,
            y: analysis_window.start_y as f32 / height.max(1) as f32,
        },
        base_bounds: NegativeLabDensityBoundsSet {
            axis_bounds: axis_summary(base_luma_bounds, base_color_axis),
            channel_bounds: channel_bounds_summary(base_channel_bounds),
        },
        base_fog_provenance: if sample_rect.is_some() {
            params.base_fog_bounds_provenance
        } else {
            NegativeLabBaseFogBoundsProvenance::AutomaticAnalysis
        },
        color_range_clip: params.color_range_clip,
        final_bounds: NegativeLabDensityBoundsSet {
            axis_bounds: axis_summary(luma_bounds, color_axis),
            channel_bounds: channel_bounds_summary(final_channel_bounds),
        },
        luma_range_clip: params.luma_range_clip,
        schema_version: default_bounds_schema_version(),
        warning_codes,
    };

    NegativeLabRobustBoundsAnalysis {
        base_density,
        chroma_bounds,
        luma_bounds,
        receipt,
    }
}

fn normalize_density_with_robust_bounds(
    density: [f32; 3],
    robust_bounds: &NegativeLabRobustBoundsAnalysis,
) -> [f32; 3] {
    let relative_density = [
        density[0] - robust_bounds.base_density[0],
        density[1] - robust_bounds.base_density[1],
        density[2] - robust_bounds.base_density[2],
    ];
    let luma_density = density_luma(relative_density);
    let luma_range = (robust_bounds.luma_bounds.max - robust_bounds.luma_bounds.min)
        .max(NEGATIVE_LAB_DENSITY_RANGE_EPSILON);
    let normalized_luma = (luma_density - robust_bounds.luma_bounds.min) / luma_range;
    let mut chroma = std::array::from_fn(|channel_index| {
        (relative_density[channel_index] - luma_density).clamp(
            robust_bounds.chroma_bounds[channel_index].min,
            robust_bounds.chroma_bounds[channel_index].max,
        )
    });
    chroma = project_zero_luma(chroma);
    [
        normalized_luma + chroma[0] / luma_range,
        normalized_luma + chroma[1] / luma_range,
        normalized_luma + chroma[2] / luma_range,
    ]
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
        .map(|&v| negative_lab_density_from_linear_channel(v))
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

fn run_e6_positive_pipeline(
    input: &DynamicImage,
    params: &NegativeConversionParams,
) -> NegativeLabPipelineRender {
    let rgb = input.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let raw_pixels = rgb.as_raw();
    let mut channel_min = [f32::INFINITY; 3];
    let mut channel_max = [f32::NEG_INFINITY; 3];
    for pixel in raw_pixels.chunks_exact(3) {
        for channel in 0..3 {
            let value = if pixel[channel].is_finite() {
                pixel[channel].max(0.0)
            } else {
                0.0
            };
            channel_min[channel] = channel_min[channel].min(value);
            channel_max[channel] = channel_max[channel].max(value);
        }
    }
    let channel_bounds: [ChannelBounds; 3] = std::array::from_fn(|channel| ChannelBounds {
        min: if channel_min[channel].is_finite() {
            channel_min[channel]
        } else {
            0.0
        },
        max: if channel_max[channel].is_finite() {
            channel_max[channel]
        } else {
            1.0
        },
    });
    let normalize = |value: f32, bounds: ChannelBounds| {
        ((value.max(0.0) - bounds.min) / (bounds.max - bounds.min).max(1.0e-6)).clamp(0.0, 1.0)
    };
    let mut normalized = Vec::with_capacity(raw_pixels.len());
    let mut scene_linear = Vec::with_capacity(raw_pixels.len());
    let mut metrics = NegativeLabDensityMetricsAccumulator::default();
    for pixel in raw_pixels.chunks_exact(3) {
        let values = [
            normalize(pixel[0], channel_bounds[0]),
            normalize(pixel[1], channel_bounds[1]),
            normalize(pixel[2], channel_bounds[2]),
        ];
        metrics.observe(values);
        normalized.extend_from_slice(&values);
        scene_linear.extend_from_slice(&values);
    }
    let axis_bounds = NegativeLabDensityNormalizationAxisBounds {
        color: NegativeLabDensityAxisBoundsSummary { min: 0.0, max: 1.0 },
        luma: NegativeLabDensityAxisBoundsSummary { min: 0.0, max: 1.0 },
    };
    let bounds_set = NegativeLabDensityBoundsSet {
        axis_bounds,
        channel_bounds: NegativeLabDensityNormalizationChannelBounds {
            r: NegativeLabDensityChannelBoundsSummary {
                min: channel_bounds[0].min,
                max: channel_bounds[0].max,
            },
            g: NegativeLabDensityChannelBoundsSummary {
                min: channel_bounds[1].min,
                max: channel_bounds[1].max,
            },
            b: NegativeLabDensityChannelBoundsSummary {
                min: channel_bounds[2].min,
                max: channel_bounds[2].max,
            },
        },
    };
    let bounds_receipt = NegativeLabDensityBoundsReceipt {
        algorithm_id: "native_negative_lab_e6_positive_normalization_v1".to_string(),
        analysis_buffer: 0.0,
        analysis_rect: NegativeBaseFogSampleRect {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
        base_bounds: bounds_set,
        base_fog_provenance: NegativeLabBaseFogBoundsProvenance::AutomaticAnalysis,
        color_range_clip: params.color_range_clip,
        final_bounds: bounds_set,
        luma_range_clip: params.luma_range_clip,
        schema_version: default_bounds_schema_version(),
        warning_codes: vec![
            "e6_positive_bypasses_negative_density".to_string(),
            "e6_positive_bypasses_base_fog".to_string(),
            "e6_positive_bypasses_crosstalk".to_string(),
        ],
    };
    let mut density_metrics = metrics.into_metrics(0, 0, bounds_receipt);
    density_metrics.density_range_unclamped = 1.0;
    let density_scopes = build_negative_lab_density_scopes(&normalized, &normalized, 0);
    let normalized_image = Rgb32FImage::from_vec(width, height, normalized).unwrap();
    let mut scene_image = Rgb32FImage::from_vec(width, height, scene_linear).unwrap();
    let detail_finish_metrics =
        apply_negative_lab_detail_finish(&mut scene_image, &params.detail_finish);
    // E6 positive rendering keeps scanner color-finish disabled, but still
    // emits the authoritative identity metrics required by the pipeline
    // receipt. Calling the shared operation with `applicable = false` keeps
    // pixels unchanged while preserving the same operation identity/hash
    // contract as the negative pipeline.
    let color_finish = apply_color_finish(&scene_image, &params.color_finish, false);
    let optical_finish =
        apply_negative_lab_optical_finish(&color_finish.image, &params.optical_finish, false);
    let finished_scene_linear = optical_finish.image;
    let rendered = Rgb32FImage::from_vec(
        width,
        height,
        finished_scene_linear
            .as_raw()
            .par_iter()
            .map(|value| negative_lab_scene_linear_to_srgb(*value))
            .collect(),
    )
    .unwrap();
    NegativeLabPipelineRender {
        normalized_density_preview: DynamicImage::ImageRgb32F(normalized_image),
        rendered_preview: DynamicImage::ImageRgb32F(rendered),
        scene_linear_print_preview: DynamicImage::ImageRgb32F(finished_scene_linear),
        density_normalization_metrics: density_metrics,
        density_scopes,
        detail_finish_metrics,
        color_finish_metrics: color_finish.metrics,
        optical_finish_metrics: optical_finish.metrics,
        cmy_timing_metrics: NegativeLabCmyTimingMetrics::default(),
        neutral_axis_analysis: NegativeLabNeutralAxisAnalysis::default(),
        auto_meter: measure_auto_meter(&[], &params.auto_meter, 0, params.render_intent),
    }
}

fn run_bw_silver_pipeline(
    input: &DynamicImage,
    params: &NegativeConversionParams,
) -> NegativeLabPipelineRender {
    let rgb = input.to_rgb32f();
    let weights = [params.red_weight, params.green_weight, params.blue_weight];
    let weight_sum = weights.iter().copied().sum::<f32>().max(1.0e-6);
    let monochrome = Rgb32FImage::from_fn(rgb.width(), rgb.height(), |x, y| {
        let pixel = rgb.get_pixel(x, y).0;
        let density_signal = (pixel[0].max(0.0) * weights[0]
            + pixel[1].max(0.0) * weights[1]
            + pixel[2].max(0.0) * weights[2])
            / weight_sum;
        image::Rgb([density_signal; 3])
    });
    let mut bw_params = params.clone();
    bw_params.process_family = NegativeLabProcessFamily::C41ColorNegative;
    bw_params.red_weight = 1.0;
    bw_params.green_weight = 1.0;
    bw_params.blue_weight = 1.0;
    bw_params.color_finish = NegativeLabScannerColorFinishParams::default();
    // Auto-density/ISO-R is a color-negative meter. Keep the BW path fail-safe
    // rather than applying a color-negative grade to a monochrome signal.
    bw_params.auto_meter = NegativeLabAutoMeterControls::default();
    let mut render = run_pipeline_with_metrics(
        &DynamicImage::ImageRgb32F(monochrome),
        &bw_params,
        None,
        None,
    );
    render
        .density_normalization_metrics
        .bounds_receipt
        .warning_codes
        .extend([
            "bw_silver_monochrome_luminance_policy_v1".to_string(),
            "bw_silver_disables_dye_unmix_crosstalk".to_string(),
            "bw_silver_disables_color_timing".to_string(),
            "bw_silver_disables_scanner_finish".to_string(),
        ]);
    render
}

fn run_pipeline_with_metrics(
    input: &DynamicImage,
    params: &NegativeConversionParams,
    _override_bounds: Option<[ChannelBounds; 3]>,
    crosstalk_profile: Option<&serde_json::Value>,
) -> NegativeLabPipelineRender {
    let params = params.clone().sanitized();
    if params.conversion_model == NegativeConversionModel::E6PositiveV1 {
        return run_e6_positive_pipeline(input, &params);
    }
    if params.process_family == NegativeLabProcessFamily::BlackAndWhiteSilverNegative {
        return run_bw_silver_pipeline(input, &params);
    }
    let rgb = input.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let raw_pixels = rgb.as_raw();
    let (epsilon_clamped_pixel_count, clipped_pixel_count) =
        negative_lab_count_density_input_guards(raw_pixels);

    let mut log_pixels: Vec<f32> = raw_pixels
        .par_iter()
        .map(|&v| negative_lab_density_from_linear_channel(v))
        .collect();
    let crosstalk_receipt = resolve_negative_lab_crosstalk(crosstalk_profile)
        .expect("Negative Lab crosstalk profiles must be validated before rendering");
    if let Some(receipt) = crosstalk_receipt.as_ref() {
        log_pixels.par_chunks_mut(3).for_each(|pixel| {
            let transformed =
                apply_negative_lab_crosstalk_density([pixel[0], pixel[1], pixel[2]], receipt);
            pixel.copy_from_slice(&transformed);
        });
    }

    let robust_bounds =
        analyze_robust_density_bounds(&log_pixels, width as usize, height as usize, &params);

    let mut out_buffer = vec![0.0f32; raw_pixels.len()];
    let mut normalized_density_buffer = vec![0.0f32; raw_pixels.len()];
    let mut scene_linear_print_buffer = vec![0.0f32; raw_pixels.len()];

    let k = 4.0 * params.contrast;
    let x0 = 0.6 - (params.exposure * 0.25);

    let y0 = 1.0 / (1.0 + (k * x0).exp());
    let y1 = 1.0 / (1.0 + (-k * (1.0 - x0)).exp());
    let scale = 1.0 / (y1 - y0);
    let endpoint_span = (params.white_point - params.black_point).max(MIN_ENDPOINT_SEPARATION);
    let apply_endpoints =
        |value: f32| -> f32 { ((value - params.black_point) / endpoint_span).clamp(0.0, 1.0) };
    let weights = [params.red_weight, params.green_weight, params.blue_weight];
    let legacy_pre_curve_clamp = params.conversion_model == NegativeConversionModel::DensityRgbV1;
    let hd_curve = if let Some(profile) = params.paper_profile.as_ref() {
        if profile.compatible_with(params.process_family, params.render_intent) {
            let mut curve = profile.to_hd_curve();
            if let Some(manual) = params.print_curve_v2.as_ref() {
                let manual = manual.clone().sanitized();
                curve.iso_r_grade = (curve.iso_r_grade * manual.iso_r_grade).clamp(0.5, 3.0);
                curve.density_offset =
                    (curve.density_offset + manual.density_offset).clamp(-0.5, 0.5);
                curve.toe_strength =
                    (curve.toe_strength + manual.toe_strength - 0.25).clamp(0.0, 1.0);
                curve.shoulder_strength =
                    (curve.shoulder_strength + manual.shoulder_strength - 0.25).clamp(0.0, 1.0);
                curve.midtone_shape = (curve.midtone_shape + manual.midtone_shape).clamp(-1.0, 1.0);
            }
            Some(curve.sanitized())
        } else {
            None
        }
    } else {
        (params.print_curve_algorithm == NegativeLabDensityPrintAlgorithm::NegativeDensityPrintV2)
            .then(|| params.print_curve_v2.unwrap_or_default().sanitized())
    };
    let paper_profile_channel_cmy = params
        .paper_profile
        .as_ref()
        .filter(|profile| profile.compatible_with(params.process_family, params.render_intent))
        .map(|profile| profile.clone().sanitized().channel_cmy)
        .unwrap_or([0.0; 3]);

    let mut model_density_buffer = vec![0.0f32; raw_pixels.len()];
    model_density_buffer
        .par_chunks_mut(3)
        .zip(log_pixels.par_chunks(3))
        .for_each(|(model_density_pixel, log_pixel)| {
            let normalized_density = normalize_density_with_robust_bounds(
                [log_pixel[0], log_pixel[1], log_pixel[2]],
                &robust_bounds,
            );
            model_density_pixel.copy_from_slice(&[
                if legacy_pre_curve_clamp {
                    normalized_density[0].max(0.0)
                } else {
                    normalized_density[0]
                },
                if legacy_pre_curve_clamp {
                    normalized_density[1].max(0.0)
                } else {
                    normalized_density[1]
                },
                if legacy_pre_curve_clamp {
                    normalized_density[2].max(0.0)
                } else {
                    normalized_density[2]
                },
            ]);
        });
    let neutral_axis_analysis = analyze_neutral_axis(
        model_density_buffer.as_chunks::<3>().0,
        width as usize,
        height as usize,
        &params.neutral_axis,
    );
    let effective_cmy_timing =
        compile_neutral_axis_cmy_timing(&params.cmy_timing, &neutral_axis_analysis);
    let auto_meter = measure_auto_meter(
        &model_density_buffer,
        &params.auto_meter,
        clipped_pixel_count,
        params.render_intent,
    );
    // Legacy density_rgb_v1 callers may not provide a paper profile. When an
    // auto meter is explicitly enabled and confidence permits application,
    // materialize the native default H&D curve so the receipt corresponds to
    // an actual render change instead of a no-op.
    let mut hd_curve = hd_curve;
    if hd_curve.is_none() && (auto_meter.density_applied || auto_meter.grade_applied) {
        hd_curve = Some(NegativeLabHdPaperCurveParams::default());
    }
    if let Some(curve) = hd_curve.as_mut() {
        curve.density_offset =
            (curve.density_offset + auto_meter.applied_density_offset).clamp(-0.5, 0.5);
        curve.iso_r_grade = (curve.iso_r_grade * auto_meter.effective_iso_r_grade).clamp(0.5, 3.0);
        *curve = curve.clone().sanitized();
    }

    let mut density_metrics = out_buffer
        .par_chunks_mut(3)
        .zip(model_density_buffer.par_chunks(3))
        .zip(normalized_density_buffer.par_chunks_mut(3))
        .zip(scene_linear_print_buffer.par_chunks_mut(3))
        .fold(
            NegativeLabDensityMetricsAccumulator::default,
            |mut metrics,
             (
                ((out_pixel, model_density_pixel), normalized_density_pixel),
                scene_linear_print_pixel,
            )| {
                let model_density = [
                    model_density_pixel[0],
                    model_density_pixel[1],
                    model_density_pixel[2],
                ];
                metrics.observe(model_density);
                normalized_density_pixel.copy_from_slice(&model_density);

                let weighted_density = apply_cmy_timing_pixel(
                    [
                        (model_density[0] + paper_profile_channel_cmy[0]) * weights[0],
                        (model_density[1] + paper_profile_channel_cmy[1]) * weights[1],
                        (model_density[2] + paper_profile_channel_cmy[2]) * weights[2],
                    ],
                    &effective_cmy_timing,
                );

                let apply_curve = |x: f32| -> f32 {
                    let sigmoid = 1.0 / (1.0 + (-k * (x - x0)).exp());
                    let s_norm = (sigmoid - y0) * scale;
                    s_norm.clamp(0.0, 1.0)
                };

                let mut r = hd_curve
                    .as_ref()
                    .map(|curve| scene_linear_reflectance(weighted_density[0], curve))
                    .unwrap_or_else(|| apply_curve(weighted_density[0]));
                let mut g = hd_curve
                    .as_ref()
                    .map(|curve| scene_linear_reflectance(weighted_density[1], curve))
                    .unwrap_or_else(|| apply_curve(weighted_density[1]));
                let mut b = hd_curve
                    .as_ref()
                    .map(|curve| scene_linear_reflectance(weighted_density[2], curve))
                    .unwrap_or_else(|| apply_curve(weighted_density[2]));

                let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                let max_ch = r.max(g).max(b);

                if max_ch > 0.9 {
                    let overflow = ((max_ch - 0.9) * 10.0).clamp(0.0, 1.0);
                    let sat_reduction = overflow * overflow;

                    r = r + (luma - r) * sat_reduction;
                    g = g + (luma - g) * sat_reduction;
                    b = b + (luma - b) * sat_reduction;
                }

                let scene_linear = if hd_curve.is_some() {
                    [r, g, b]
                } else {
                    [apply_endpoints(r), apply_endpoints(g), apply_endpoints(b)]
                };
                scene_linear_print_pixel.copy_from_slice(&scene_linear);
                out_pixel[0] = negative_lab_scene_linear_to_srgb(scene_linear[0]);
                out_pixel[1] = negative_lab_scene_linear_to_srgb(scene_linear[1]);
                out_pixel[2] = negative_lab_scene_linear_to_srgb(scene_linear[2]);

                metrics
            },
        )
        .reduce(
            NegativeLabDensityMetricsAccumulator::default,
            NegativeLabDensityMetricsAccumulator::merge,
        )
        .into_metrics(
            clipped_pixel_count,
            epsilon_clamped_pixel_count,
            robust_bounds.receipt,
        );
    density_metrics.crosstalk_receipt = crosstalk_receipt;
    let density_scopes =
        build_negative_lab_density_scopes(&log_pixels, &out_buffer, clipped_pixel_count);

    let normalized_density_img =
        Rgb32FImage::from_vec(width, height, normalized_density_buffer).unwrap();
    let is_flat_log_master = params.render_intent == NegativeLabRenderIntent::FlatLogMaster;
    let mut scene_linear_print_img = if is_flat_log_master {
        let flat = params.flat_log_master.sanitized();
        Rgb32FImage::from_fn(width, height, |x, y| {
            let density = normalized_density_img.get_pixel(x, y).0;
            image::Rgb(density.map(|value| (flat.lift + flat.gain * (1.0 - value)).clamp(0.0, 1.0)))
        })
    } else {
        Rgb32FImage::from_vec(width, height, scene_linear_print_buffer).unwrap()
    };
    let detail_finish_metrics = if is_flat_log_master {
        NegativeLabDetailFinishMetrics::default()
    } else {
        apply_negative_lab_detail_finish(&mut scene_linear_print_img, &params.detail_finish)
    };
    let color_finish = if is_flat_log_master {
        apply_color_finish(
            &scene_linear_print_img,
            &NegativeLabScannerColorFinishParams::default(),
            false,
        )
    } else {
        apply_color_finish(
            &scene_linear_print_img,
            &params.color_finish,
            params.conversion_model != NegativeConversionModel::NegativeLogDensityV1,
        )
    };
    let optical_finish = if is_flat_log_master {
        apply_negative_lab_optical_finish(
            &color_finish.image,
            &NegativeLabOpticalFinishParams::default(),
            false,
        )
    } else {
        apply_negative_lab_optical_finish(&color_finish.image, &params.optical_finish, true)
    };
    let finished_scene_linear = optical_finish.image;
    let out_img = Rgb32FImage::from_fn(width, height, |x, y| {
        let pixel = finished_scene_linear.get_pixel(x, y).0;
        image::Rgb(pixel.map(negative_lab_scene_linear_to_srgb))
    });

    NegativeLabPipelineRender {
        normalized_density_preview: DynamicImage::ImageRgb32F(normalized_density_img),
        rendered_preview: DynamicImage::ImageRgb32F(out_img),
        scene_linear_print_preview: DynamicImage::ImageRgb32F(finished_scene_linear),
        density_normalization_metrics: density_metrics,
        density_scopes,
        detail_finish_metrics,
        color_finish_metrics: color_finish.metrics,
        optical_finish_metrics: optical_finish.metrics,
        cmy_timing_metrics: NegativeLabCmyTimingMetrics::default(),
        neutral_axis_analysis: NegativeLabNeutralAxisAnalysis::default(),
        auto_meter: measure_auto_meter(&[], &params.auto_meter, 0, params.render_intent),
    }
}

fn run_pipeline(
    input: &DynamicImage,
    params: &NegativeConversionParams,
    override_bounds: Option<[ChannelBounds; 3]>,
) -> DynamicImage {
    run_pipeline_with_metrics(input, params, override_bounds, None).rendered_preview
}

fn build_negative_lab_preview_cache_key(source_path: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    source_path.hash(&mut hasher);
    "negative_preview_base".hash(&mut hasher);
    hasher.finish()
}

fn negative_lab_source_type_for_path(
    path: &str,
    format: Option<image::ImageFormat>,
) -> &'static str {
    if crate::formats::is_raw_file(path) {
        "raw"
    } else {
        match format {
            Some(image::ImageFormat::Jpeg) => "rendered_jpeg",
            Some(image::ImageFormat::Tiff) => "linear_tiff_candidate",
            _ => "unknown",
        }
    }
}

fn negative_lab_image_bit_depth(image: &DynamicImage) -> u8 {
    match image.color() {
        image::ColorType::L8
        | image::ColorType::La8
        | image::ColorType::Rgb8
        | image::ColorType::Rgba8 => 8,
        image::ColorType::L16
        | image::ColorType::La16
        | image::ColorType::Rgb16
        | image::ColorType::Rgba16 => 16,
        image::ColorType::Rgb32F | image::ColorType::Rgba32F => 32,
        _ => 8,
    }
}

fn build_negative_lab_source_interpretation(
    path: &str,
    bytes: &[u8],
    image: &DynamicImage,
    raw_report: Option<&crate::raw_processing::RawDevelopmentReport>,
    format: Option<image::ImageFormat>,
) -> NegativeLabSourceInterpretationV1 {
    let source_type = negative_lab_source_type_for_path(path, format);
    let (
        decoder_backend,
        decoder_version,
        raw_demosaic_mode,
        bit_depth,
        transfer_function,
        applied_linearization,
        confidence,
    ) = match source_type {
        "raw" => (
            "rawler".to_string(),
            "rawengine_rawler_v1".to_string(),
            raw_report.map(|report| format!("{:?}", report.demosaic_path)),
            32,
            "camera_rgb_profiled".to_string(),
            "native_raw_to_scene_linear_v1".to_string(),
            0.95,
        ),
        "linear_tiff_candidate" => (
            "image".to_string(),
            "image_crate_v1".to_string(),
            None,
            negative_lab_image_bit_depth(image),
            "unproven".to_string(),
            "identity_declared_by_source_metadata".to_string(),
            0.55,
        ),
        "rendered_jpeg" => (
            "image".to_string(),
            "image_crate_v1".to_string(),
            None,
            negative_lab_image_bit_depth(image),
            "srgb_or_embedded_icc".to_string(),
            "none_review_only".to_string(),
            0.35,
        ),
        _ => (
            "image".to_string(),
            "image_crate_v1".to_string(),
            None,
            negative_lab_image_bit_depth(image),
            "unknown".to_string(),
            "none".to_string(),
            0.0,
        ),
    };
    let rgb = image.to_rgb32f();
    let total = rgb.as_raw().len().max(1) as f32;
    let non_finite_count = rgb
        .as_raw()
        .iter()
        .filter(|value| !value.is_finite())
        .count() as f32;
    let clipped_count = rgb
        .as_raw()
        .iter()
        .filter(|value| value.is_finite() && (**value < 0.0 || **value > 1.0))
        .count();
    let mut warning_codes = Vec::new();
    let mut block_reasons = Vec::new();
    if source_type == "rendered_jpeg" {
        warning_codes.push("rendered_jpeg_review_only".to_string());
    }
    if source_type == "linear_tiff_candidate" {
        warning_codes.push("linear_transfer_unproven".to_string());
    }
    if source_type == "unknown" {
        warning_codes.push("unsupported_negative_lab_source".to_string());
        block_reasons.push("decoder_format_unknown".to_string());
    }
    if clipped_count > 0 {
        warning_codes.push("source_samples_clipped".to_string());
    }
    if non_finite_count > 0.0 {
        warning_codes.push("source_samples_non_finite".to_string());
        block_reasons.push("non_finite_source_samples".to_string());
    }
    let mut interpretation = NegativeLabSourceInterpretationV1 {
        applied_linearization,
        bit_depth,
        block_reasons,
        confidence,
        decoder_backend,
        decoder_version,
        dimensions: NegativeLabPreviewArtifactDimensions {
            height: image.height(),
            width: image.width(),
        },
        embedded_icc_profile: false,
        interpretation_hash: String::new(),
        non_finite_fraction: non_finite_count / total,
        orientation: "unknown".to_string(),
        raw_demosaic_mode,
        sample_format: format!("{:?}", image.color()),
        schema_version: 1,
        source_hash: format!("sha256:{}", hex::encode(Sha256::digest(bytes))),
        source_type: source_type.to_string(),
        transfer_function,
        warning_codes,
    };
    let canonical = serde_json::to_vec(&interpretation).unwrap_or_default();
    interpretation.interpretation_hash =
        format!("sha256:{}", hex::encode(Sha256::digest(canonical)));
    interpretation
}

fn preflight_negative_lab_source_path(
    source_path: &str,
    app_handle: &AppHandle,
) -> Result<NegativeLabSourceInterpretationV1, String> {
    let bytes = fs::read(source_path).map_err(|error| error.to_string())?;
    let settings = load_settings_or_default(app_handle);
    let format = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .ok()
        .and_then(|reader| reader.format());
    let (image, raw_report) =
        load_base_image_from_bytes_with_report(&bytes, source_path, false, &settings, None)
            .map_err(|error| error.to_string())?;
    Ok(build_negative_lab_source_interpretation(
        source_path,
        &bytes,
        &image,
        raw_report.as_ref(),
        format,
    ))
}

fn validate_negative_lab_source_interpretation(
    params: &NegativeConversionParams,
    interpretation: &NegativeLabSourceInterpretationV1,
) -> Result<(), String> {
    if let Some(expected_hash) = params.source_interpretation_hash.as_deref()
        && expected_hash != interpretation.interpretation_hash
    {
        return Err(
            "Negative Lab source interpretation changed; rerun preflight before preview or apply."
                .to_string(),
        );
    }
    if !interpretation.block_reasons.is_empty() {
        return Err(format!(
            "Negative Lab source preflight blocked this input: {}",
            interpretation.block_reasons.join(", ")
        ));
    }
    Ok(())
}

fn fit_negative_lab_profile(
    request: NegativeLabProfileFitRequestV1,
) -> Result<NegativeLabProfileFitReceiptV1, String> {
    if request.schema_version != 1 {
        return Err("Negative Lab calibration target schema version is unsupported.".to_string());
    }
    if request.target_layout_id != "rawengine_negative_lab_target_v1" {
        return Err("Negative Lab calibration target layout is unsupported.".to_string());
    }
    if !request.source_interpretation_hash.starts_with("sha256:") {
        return Err(
            "Negative Lab profile fitting requires a loader interpretation hash.".to_string(),
        );
    }
    if request.patches.len() < 12 {
        return Err(
            "Negative Lab profile fitting requires at least 12 target patches.".to_string(),
        );
    }
    let mut rejected_patch_count = 0_u32;
    let mut usable = Vec::new();
    for patch in request.patches {
        let valid = !patch.clipped
            && patch
                .expected_rgb
                .iter()
                .chain(patch.observed_rgb.iter())
                .all(|value| value.is_finite() && (0.0..=1.0).contains(value));
        if !valid {
            rejected_patch_count += 1;
        } else {
            usable.push(patch);
        }
    }
    if usable.len() < 12 {
        return Err(
            "Negative Lab profile fitting failed closed: fewer than 12 usable patches.".to_string(),
        );
    }
    let mut ordered = usable.clone();
    ordered.sort_by(|left, right| {
        let left_luma = left.expected_rgb.iter().sum::<f32>();
        let right_luma = right.expected_rgb.iter().sum::<f32>();
        left_luma
            .partial_cmp(&right_luma)
            .unwrap_or(Ordering::Equal)
    });
    let mut monotonic_violation = false;
    for pair in ordered.windows(2) {
        let left = pair[0].observed_rgb.iter().sum::<f32>();
        let right = pair[1].observed_rgb.iter().sum::<f32>();
        if right + 0.02 < left {
            monotonic_violation = true;
            break;
        }
    }
    if monotonic_violation {
        return Err(
            "Negative Lab profile fitting failed closed: target response is non-monotonic."
                .to_string(),
        );
    }
    let mut ratios = [Vec::new(), Vec::new(), Vec::new()];
    let mut residuals = Vec::with_capacity(usable.len());
    let mut independent_color_count = 0_u32;
    for patch in &usable {
        for (channel, channel_ratios) in ratios.iter_mut().enumerate() {
            if patch.observed_rgb[channel] > 0.001 {
                channel_ratios.push(
                    (patch.expected_rgb[channel] / patch.observed_rgb[channel]).clamp(0.5, 2.0),
                );
            }
        }
        if patch.independent_color_patch {
            independent_color_count += 1;
        }
        let residual = (0..3)
            .map(|channel| (patch.expected_rgb[channel] - patch.observed_rgb[channel]).abs())
            .sum::<f32>()
            / 3.0;
        residuals.push(residual);
    }
    let mean_ratio = |values: &[f32]| values.iter().sum::<f32>() / values.len().max(1) as f32;
    let fitted_params = NegativeLabFittedParametersV1 {
        base_fog_strength: 1.0,
        blue_weight: mean_ratio(&ratios[2]),
        contrast: (1.0
            + (mean_ratio(&ratios[0]) + mean_ratio(&ratios[1]) + mean_ratio(&ratios[2]) - 3.0)
                * 0.5)
            .clamp(0.5, 2.0),
        green_weight: mean_ratio(&ratios[1]),
        red_weight: mean_ratio(&ratios[0]),
    };
    let residual_mean = residuals.iter().sum::<f32>() / residuals.len().max(1) as f32;
    let max_residual = residuals.iter().copied().fold(0.0_f32, f32::max);
    // Twelve usable patches is the minimum accepted calibration target. Treat
    // that complete minimum target as sufficient sample coverage, then let
    // residual quality determine whether runtime application is allowed.
    let confidence =
        ((usable.len() as f32 / 12.0).min(1.0) * (1.0 - residual_mean).max(0.0)).clamp(0.0, 1.0);
    let claim_status = if confidence >= 0.65 && max_residual <= 0.2 {
        "runtime_parameter_applied"
    } else {
        "blocked_or_unsupported"
    };
    let crosstalk_status = if independent_color_count >= 3 {
        "identity_crosstalk_pending_conditioning"
    } else {
        "identity_not_measured"
    };
    let warning_codes = if claim_status == "runtime_parameter_applied" {
        vec![
            "no_stock_emulation_claim".to_string(),
            "no_colorimetric_match_claim".to_string(),
        ]
    } else {
        vec!["fit_confidence_below_runtime_threshold".to_string()]
    };
    let mut receipt = NegativeLabProfileFitReceiptV1 {
        algorithm_id: "native_negative_lab_profile_fit_v1".to_string(),
        claim_status: claim_status.to_string(),
        confidence,
        crosstalk_status: crosstalk_status.to_string(),
        fitted_params,
        max_residual,
        report_hash: String::new(),
        rejected_patch_count,
        residual_mean,
        schema_version: 1,
        source_interpretation_hash: request.source_interpretation_hash,
        target_layout_id: request.target_layout_id,
        used_patch_count: usable.len() as u32,
        warning_codes,
    };
    let canonical = serde_json::to_vec(&receipt).map_err(|error| error.to_string())?;
    receipt.report_hash = format!("sha256:{}", hex::encode(Sha256::digest(canonical)));
    Ok(receipt)
}

fn validate_roll_bounds_set(bounds: &NegativeLabDensityBoundsSet) -> bool {
    let axes = [bounds.axis_bounds.color, bounds.axis_bounds.luma];
    let channels = [
        bounds.channel_bounds.r,
        bounds.channel_bounds.g,
        bounds.channel_bounds.b,
    ];
    axes.into_iter()
        .map(|axis| (axis.min, axis.max))
        .chain(channels.into_iter().map(|axis| (axis.min, axis.max)))
        .all(|(min, max)| min.is_finite() && max.is_finite() && min <= max)
}

fn median_finite(values: &mut [f32]) -> f32 {
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    percentile_from_sorted(values, 0.5)
}

fn aggregate_negative_lab_roll_bounds(
    request: NegativeLabRollBoundsRequestV1,
) -> Result<NegativeLabRollBoundsReceiptV1, String> {
    if request.analysis_version != "fixed_grid_block_median_luma_color_v1" {
        return Err("Negative Lab roll bounds analysis version is unsupported.".to_string());
    }
    if !request.source_interpretation_hash.starts_with("sha256:")
        || request.source_interpretation_hash.len() != 71
    {
        return Err("Negative Lab roll bounds require a loader interpretation hash.".to_string());
    }
    if request.frames.is_empty() {
        return Err("Negative Lab roll bounds require at least one frame.".to_string());
    }
    if request.frames.iter().any(|frame| {
        frame.source_interpretation_hash != request.source_interpretation_hash
            || frame.frame_id.trim().is_empty()
            || !validate_roll_bounds_set(&frame.local_bounds)
    }) {
        return Err(
            "Negative Lab roll bounds contain stale identity or invalid local bounds.".to_string(),
        );
    }
    let eligible = request
        .frames
        .iter()
        .filter(|frame| frame.eligible)
        .collect::<Vec<_>>();
    if eligible.is_empty() {
        return Err("Negative Lab roll bounds require one eligible frame.".to_string());
    }

    let median_axis =
        |selector: fn(NegativeLabDensityBoundsSet) -> NegativeLabDensityAxisBoundsSummary| {
            let mut mins = eligible
                .iter()
                .map(|frame| selector(frame.local_bounds).min)
                .collect::<Vec<_>>();
            let mut maxs = eligible
                .iter()
                .map(|frame| selector(frame.local_bounds).max)
                .collect::<Vec<_>>();
            NegativeLabDensityAxisBoundsSummary {
                min: median_finite(&mut mins),
                max: median_finite(&mut maxs),
            }
        };
    let median_channel =
        |selector: fn(NegativeLabDensityBoundsSet) -> NegativeLabDensityChannelBoundsSummary| {
            let mut mins = eligible
                .iter()
                .map(|frame| selector(frame.local_bounds).min)
                .collect::<Vec<_>>();
            let mut maxs = eligible
                .iter()
                .map(|frame| selector(frame.local_bounds).max)
                .collect::<Vec<_>>();
            NegativeLabDensityChannelBoundsSummary {
                min: median_finite(&mut mins),
                max: median_finite(&mut maxs),
            }
        };
    let roll_bounds = NegativeLabDensityBoundsSet {
        axis_bounds: NegativeLabDensityNormalizationAxisBounds {
            color: median_axis(|bounds| bounds.axis_bounds.color),
            luma: median_axis(|bounds| bounds.axis_bounds.luma),
        },
        channel_bounds: NegativeLabDensityNormalizationChannelBounds {
            b: median_channel(|bounds| bounds.channel_bounds.b),
            g: median_channel(|bounds| bounds.channel_bounds.g),
            r: median_channel(|bounds| bounds.channel_bounds.r),
        },
    };
    let frame_results = request
        .frames
        .iter()
        .map(|frame| {
            let mut final_bounds = frame.local_bounds;
            if request.use_roll_luma {
                final_bounds.axis_bounds.luma = roll_bounds.axis_bounds.luma;
            }
            if request.use_roll_colour {
                final_bounds.axis_bounds.color = roll_bounds.axis_bounds.color;
                final_bounds.channel_bounds = roll_bounds.channel_bounds;
            }
            NegativeLabRollBoundsFrameResultV1 {
                anchor: frame.anchor,
                eligible: frame.eligible,
                final_bounds,
                frame_id: frame.frame_id.clone(),
                local_bounds: frame.local_bounds,
                roll_bounds,
            }
        })
        .collect::<Vec<_>>();
    let mut receipt = NegativeLabRollBoundsReceiptV1 {
        algorithm_id: "native_negative_lab_roll_bounds_v1".to_string(),
        analysis_version: request.analysis_version,
        frame_results,
        plan_hash: String::new(),
        roll_bounds,
        schema_version: 1,
        source_interpretation_hash: request.source_interpretation_hash,
        use_roll_colour: request.use_roll_colour,
        use_roll_luma: request.use_roll_luma,
        warning_codes: if eligible.len() == 1 {
            vec!["single_frame_identity_plan".to_string()]
        } else {
            Vec::new()
        },
    };
    let canonical = serde_json::to_vec(&receipt).map_err(|error| error.to_string())?;
    receipt.plan_hash = format!("sha256:{}", hex::encode(Sha256::digest(canonical)));
    Ok(receipt)
}

#[tauri::command]
pub async fn fit_negative_lab_measured_profile(
    request: NegativeLabProfileFitRequestV1,
) -> Result<NegativeLabProfileFitReceiptV1, String> {
    fit_negative_lab_profile(request)
}

#[tauri::command]
pub async fn lock_negative_lab_roll_bounds(
    request: NegativeLabRollBoundsRequestV1,
) -> Result<NegativeLabRollBoundsReceiptV1, String> {
    aggregate_negative_lab_roll_bounds(request)
}

#[tauri::command]
pub async fn preflight_negative_lab_source(
    path: String,
    app_handle: AppHandle,
) -> Result<NegativeLabSourceInterpretationV1, String> {
    let (source_path, _) = parse_virtual_path(&path);
    preflight_negative_lab_source_path(&source_path.to_string_lossy(), &app_handle)
}

fn load_negative_lab_preview_processing_image(
    source_path_str: &str,
    state: &tauri::State<'_, AppState>,
    app_handle: &AppHandle,
) -> Result<DynamicImage, String> {
    let cache_key = build_negative_lab_preview_cache_key(source_path_str);
    if let Some(cached_img) = state.geometry_cache.get(&cache_key) {
        return Ok(cached_img.as_ref().clone());
    }

    let image_to_downscale = {
        let original_lock = state.original_image.lock().unwrap();
        if let Some(loaded) = original_lock.as_ref() {
            if loaded.path == source_path_str {
                loaded.image.clone().as_ref().clone()
            } else {
                drop(original_lock);
                let settings = load_settings_or_default(app_handle);

                match read_file_mapped(Path::new(source_path_str)) {
                    Ok(mmap) => {
                        load_base_image_from_bytes(&mmap, source_path_str, false, &settings, None)
                    }
                    Err(_) => {
                        let bytes =
                            fs::read(source_path_str).map_err(|io_err| io_err.to_string())?;
                        load_base_image_from_bytes(&bytes, source_path_str, false, &settings, None)
                    }
                }
                .map_err(|error| error.to_string())?
            }
        } else {
            drop(original_lock);
            let settings = load_settings_or_default(app_handle);

            match read_file_mapped(Path::new(source_path_str)) {
                Ok(mmap) => {
                    load_base_image_from_bytes(&mmap, source_path_str, false, &settings, None)
                }
                Err(_) => {
                    let bytes = fs::read(source_path_str).map_err(|io_err| io_err.to_string())?;
                    load_base_image_from_bytes(&bytes, source_path_str, false, &settings, None)
                }
            }
            .map_err(|error| error.to_string())?
        }
    };

    let downscaled = downscale_f32_image(&image_to_downscale, 1080, 1080);
    state.geometry_cache.insert(
        cache_key,
        Arc::new(downscaled.clone()),
        downscaled.as_bytes().len() as u64,
    );
    Ok(downscaled)
}

fn default_negative_lab_runtime_base_fog_sample_rect() -> NegativeBaseFogSampleRect {
    NegativeBaseFogSampleRect {
        x: 0.02,
        y: 0.2,
        width: 0.12,
        height: 0.6,
    }
}

fn negative_lab_runtime_base_fog_density_range(sample_density: [f32; 3]) -> f32 {
    let min_density = sample_density.iter().copied().fold(f32::INFINITY, f32::min);
    let max_density = sample_density
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    (max_density - min_density).max(0.0)
}

fn build_negative_lab_runtime_base_fog_rgb_triplet(
    rgb: [f32; 3],
) -> NegativeLabRuntimeBaseFogRgbTriplet {
    NegativeLabRuntimeBaseFogRgbTriplet {
        r: rgb[0],
        g: rgb[1],
        b: rgb[2],
    }
}

fn negative_lab_runtime_base_fog_warning_codes(
    estimate: &NegativeBaseFogEstimate,
    clipped_fraction: f32,
    density_range: f32,
) -> Vec<String> {
    let mut warning_codes = Vec::new();
    if estimate.confidence < 0.6 {
        warning_codes.push(NEGATIVE_LAB_BASE_FOG_WARNING_LOW_CONFIDENCE.to_string());
    }
    if clipped_fraction > 0.0
        || estimate
            .base_rgb
            .iter()
            .any(|&channel| channel <= 0.01 || channel >= 0.99)
    {
        warning_codes.push(NEGATIVE_LAB_BASE_FOG_WARNING_CLIPPED_CHANNEL.to_string());
    }
    if density_range > 0.18 {
        warning_codes.push(NEGATIVE_LAB_BASE_FOG_WARNING_UNEVEN_ILLUMINATION.to_string());
    }
    if estimate.confidence < 0.12 {
        warning_codes.push(NEGATIVE_LAB_BASE_FOG_WARNING_MISSING_VISIBLE_BASE.to_string());
    }
    warning_codes.sort();
    warning_codes.dedup();
    warning_codes
}

fn build_negative_lab_runtime_base_fog_sample_summary(
    input: &DynamicImage,
    requested_sample_rect: Option<NegativeBaseFogSampleRect>,
) -> NegativeLabRuntimeBaseFogSampleSummary {
    let sample_rect = requested_sample_rect
        .and_then(sanitize_sample_rect)
        .unwrap_or_else(default_negative_lab_runtime_base_fog_sample_rect);
    let estimate = estimate_base_fog_from_image(input, Some(sample_rect));
    let rgb = input.to_rgb32f();
    let (width, height) = rgb.dimensions();
    let (start_x, end_x, start_y, end_y) = sample_rect_pixel_bounds(sample_rect, width, height);
    let mut sample_rgb_sum = [0.0_f32; 3];
    let mut sample_count = 0_usize;
    let mut clipped_count = 0_usize;

    for y in start_y..end_y {
        for x in start_x..end_x {
            let channels = rgb.get_pixel(x, y).0;
            sample_rgb_sum[0] += channels[0];
            sample_rgb_sum[1] += channels[1];
            sample_rgb_sum[2] += channels[2];
            sample_count += 1;
            if channels[0] <= 0.01
                || channels[1] <= 0.01
                || channels[2] <= 0.01
                || channels[0] >= 0.99
                || channels[1] >= 0.99
                || channels[2] >= 0.99
            {
                clipped_count += 1;
            }
        }
    }

    let safe_sample_count = sample_count.max(1) as f32;
    let mean_rgb = sample_rgb_sum.map(|value| value / safe_sample_count);
    let clipped_fraction = clipped_count as f32 / safe_sample_count;
    let density_range = negative_lab_runtime_base_fog_density_range(estimate.base_density);
    let warning_codes =
        negative_lab_runtime_base_fog_warning_codes(&estimate, clipped_fraction, density_range);

    NegativeLabRuntimeBaseFogSampleSummary {
        clipped_fraction,
        confidence: estimate.confidence,
        density_range,
        density_rgb: build_negative_lab_runtime_base_fog_rgb_triplet(estimate.base_density),
        mean_rgb: build_negative_lab_runtime_base_fog_rgb_triplet(mean_rgb),
        sample_count: sample_count.max(1) as u32,
        sample_rect,
        source: if requested_sample_rect
            .and_then(sanitize_sample_rect)
            .is_some()
        {
            NEGATIVE_LAB_BASE_FOG_SOURCE_REQUESTED_RECT.to_string()
        } else {
            NEGATIVE_LAB_BASE_FOG_SOURCE_DEFAULT_RECT.to_string()
        },
        warning_codes,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_negative_lab_dry_run_preview_artifact(
    rendered_preview: &DynamicImage,
    normalized_density_preview: &DynamicImage,
    scene_linear_print_preview: &DynamicImage,
    base_fog_sample_summary: NegativeLabRuntimeBaseFogSampleSummary,
    density_normalization_metrics: NegativeLabDensityNormalizationMetrics,
    detail_finish_metrics: NegativeLabDetailFinishMetrics,
    color_finish_metrics: NegativeLabColorFinishMetrics,
    optical_finish_metrics: NegativeLabOpticalFinishMetrics,
    cmy_timing_metrics: NegativeLabCmyTimingMetrics,
    neutral_axis_analysis: NegativeLabNeutralAxisAnalysis,
    auto_meter: NegativeLabAutoMeterReceipt,
    params: &NegativeConversionParams,
    density_scopes: NegativeLabDensityScopes,
) -> Result<NegativeLabDryRunPreviewArtifact, String> {
    let rgb8 = rendered_preview.to_rgb8();
    let dimensions = NegativeLabPreviewArtifactDimensions {
        height: rgb8.height(),
        width: rgb8.width(),
    };
    let content_hash = format!("sha256:{}", hex::encode(Sha256::digest(rgb8.as_raw())));
    let content_hash_suffix = content_hash.trim_start_matches("sha256:");
    let artifact_id = format!(
        "artifact_negative_lab_runtime_preview_{}",
        &content_hash_suffix[..content_hash_suffix.len().min(12)]
    );
    let mut buf = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(rgb8)
        .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, 80))
        .map_err(|error| error.to_string())?;

    let base64_str = general_purpose::STANDARD.encode(buf.get_ref());
    let normalized_density = normalized_density_preview.to_rgb32f();
    let scene_linear_print = scene_linear_print_preview.to_rgb32f();
    let scene_linear_stats = negative_lab_scene_linear_stats(&scene_linear_print);
    let recipe_hash = negative_lab_stage_recipe_hash(
        params,
        density_normalization_metrics.crosstalk_receipt.as_ref(),
    )?;
    let stage_artifacts = vec![
        build_negative_lab_stage_preview_artifact(
            "normalized_density",
            "normalized_density",
            "normalized_density_clamp_v1",
            &normalized_density,
            &density_normalization_metrics.bounds_receipt,
            &recipe_hash,
        )?,
        build_negative_lab_stage_preview_artifact(
            "scene_linear_print",
            "scene_linear_print",
            "scene_linear_to_srgb_gamma_v1",
            &scene_linear_print,
            &density_normalization_metrics.bounds_receipt,
            &recipe_hash,
        )?,
    ];
    Ok(NegativeLabDryRunPreviewArtifact {
        artifact_id,
        base_fog_sample_summary,
        content_hash,
        density_normalization_metrics,
        density_scopes,
        detail_finish_metrics,
        color_finish_metrics,
        optical_finish_metrics,
        cmy_timing_metrics,
        neutral_axis_analysis,
        auto_meter,
        paper_profile: params.paper_profile.clone(),
        dimensions,
        flat_log_master: params.flat_log_master,
        render_intent: params.render_intent,
        bypassed_stage_ids: if params.render_intent == NegativeLabRenderIntent::FlatLogMaster {
            vec![
                "h_and_d_print_curve".to_string(),
                "detail_finish".to_string(),
            ]
        } else {
            Vec::new()
        },
        preview_data_url: jpeg_data_url(base64_str),
        preview_output_transform: negative_lab_preview_output_transform(),
        scene_linear_print: scene_linear_stats,
        stage_artifacts,
        renderer: NEGATIVE_LAB_RUNTIME_PREVIEW_RENDERER.to_string(),
        source_interpretation_hash: params.source_interpretation_hash.clone(),
        storage: NEGATIVE_LAB_RUNTIME_PREVIEW_STORAGE.to_string(),
    })
}

fn negative_lab_stage_recipe_hash(
    params: &NegativeConversionParams,
    crosstalk_receipt: Option<&NegativeLabCrosstalkReceipt>,
) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(params.clone().sanitized(), crosstalk_receipt))
        .map_err(|error| format!("Failed to hash Negative Lab stage recipe: {error}"))?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

fn negative_lab_stage_pixels_hash(stage: &Rgb32FImage) -> String {
    let mut hasher = Sha256::new();
    for value in stage.as_raw() {
        hasher.update(value.to_le_bytes());
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn negative_lab_scene_linear_to_srgb(value: f32) -> f32 {
    value.clamp(0.0, 1.0).powf(1.0 / 2.2)
}

fn negative_lab_preview_output_transform() -> NegativeLabOutputTransformV1 {
    NegativeLabOutputTransformV1 {
        bit_depth: 8,
        implementation_version: 1,
        input_color_domain: "scene_linear_print_srgb_d65".to_string(),
        intent: "display_preview".to_string(),
        output_color_domain: "srgb_display".to_string(),
        transform_id: "scene_linear_to_srgb_gamma_v1".to_string(),
        transfer_function: "gamma_2_2_display_proof".to_string(),
    }
}

fn negative_lab_scene_linear_stats(stage: &Rgb32FImage) -> NegativeLabSceneLinearStatsV1 {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut non_finite_count = 0_u32;
    for value in stage.as_raw() {
        if value.is_finite() {
            min = min.min(*value);
            max = max.max(*value);
        } else {
            non_finite_count += 1;
        }
    }
    NegativeLabSceneLinearStatsV1 {
        content_hash: negative_lab_stage_pixels_hash(stage),
        max: if max.is_finite() { max } else { 0.0 },
        min: if min.is_finite() { min } else { 0.0 },
        non_finite_count,
    }
}

fn build_negative_lab_stage_preview_artifact(
    stage_id: &str,
    color_domain: &str,
    display_transform: &str,
    stage: &Rgb32FImage,
    bounds_receipt: &NegativeLabDensityBoundsReceipt,
    recipe_hash: &str,
) -> Result<NegativeLabStagePreviewArtifact, String> {
    let rgb8 = image::RgbImage::from_fn(stage.width(), stage.height(), |x, y| {
        let pixel = stage.get_pixel(x, y).0;
        let transformed = if stage_id == "scene_linear_print" {
            pixel.map(negative_lab_scene_linear_to_srgb)
        } else {
            pixel.map(|value| (0.5 + value * 0.5).clamp(0.0, 1.0))
        };
        image::Rgb([
            (transformed[0] * 255.0).round() as u8,
            (transformed[1] * 255.0).round() as u8,
            (transformed[2] * 255.0).round() as u8,
        ])
    });
    let mut buf = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(rgb8)
        .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, 80))
        .map_err(|error| error.to_string())?;
    Ok(NegativeLabStagePreviewArtifact {
        color_domain: color_domain.to_string(),
        content_hash: negative_lab_stage_pixels_hash(stage),
        dimensions: NegativeLabPreviewArtifactDimensions {
            height: stage.height(),
            width: stage.width(),
        },
        display_transform: display_transform.to_string(),
        preview_data_url: jpeg_data_url(general_purpose::STANDARD.encode(buf.get_ref())),
        recipe_hash: recipe_hash.to_string(),
        stage_id: stage_id.to_string(),
        stage_version: 1,
        bounds_receipt: bounds_receipt.clone(),
    })
}

#[tauri::command]
pub async fn preview_negative_conversion(
    path: String,
    params: NegativeConversionParams,
    crosstalk_profile: Option<serde_json::Value>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let interpretation = preflight_negative_lab_source_path(&source_path_str, &app_handle)?;
    validate_negative_lab_source_interpretation(&params, &interpretation)?;
    let base_image_for_processing =
        load_negative_lab_preview_processing_image(&source_path_str, &state, &app_handle)?;
    resolve_negative_lab_crosstalk(crosstalk_profile.as_ref())?;
    let rendered_preview = run_pipeline_with_metrics(
        &base_image_for_processing,
        &params,
        None,
        crosstalk_profile.as_ref(),
    );
    let base_fog_sample_summary = build_negative_lab_runtime_base_fog_sample_summary(
        &base_image_for_processing,
        params.base_fog_sample,
    );
    Ok(build_negative_lab_dry_run_preview_artifact(
        &rendered_preview.rendered_preview,
        &rendered_preview.normalized_density_preview,
        &rendered_preview.scene_linear_print_preview,
        base_fog_sample_summary,
        rendered_preview.density_normalization_metrics,
        rendered_preview.detail_finish_metrics,
        rendered_preview.color_finish_metrics,
        rendered_preview.optical_finish_metrics,
        rendered_preview.cmy_timing_metrics,
        rendered_preview.neutral_axis_analysis,
        rendered_preview.auto_meter,
        &params,
        rendered_preview.density_scopes,
    )?
    .preview_data_url)
}

#[tauri::command]
pub async fn render_negative_lab_dry_run_preview_artifact(
    path: String,
    params: NegativeConversionParams,
    crosstalk_profile: Option<serde_json::Value>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<NegativeLabDryRunPreviewArtifact, String> {
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let interpretation = preflight_negative_lab_source_path(&source_path_str, &app_handle)?;
    validate_negative_lab_source_interpretation(&params, &interpretation)?;
    let base_image_for_processing =
        load_negative_lab_preview_processing_image(&source_path_str, &state, &app_handle)?;
    resolve_negative_lab_crosstalk(crosstalk_profile.as_ref())?;
    let rendered_preview = run_pipeline_with_metrics(
        &base_image_for_processing,
        &params,
        None,
        crosstalk_profile.as_ref(),
    );
    let base_fog_sample_summary = build_negative_lab_runtime_base_fog_sample_summary(
        &base_image_for_processing,
        params.base_fog_sample,
    );
    build_negative_lab_dry_run_preview_artifact(
        &rendered_preview.rendered_preview,
        &rendered_preview.normalized_density_preview,
        &rendered_preview.scene_linear_print_preview,
        base_fog_sample_summary,
        rendered_preview.density_normalization_metrics,
        rendered_preview.detail_finish_metrics,
        rendered_preview.color_finish_metrics,
        rendered_preview.optical_finish_metrics,
        rendered_preview.cmy_timing_metrics,
        rendered_preview.neutral_axis_analysis,
        rendered_preview.auto_meter,
        &params,
        rendered_preview.density_scopes,
    )
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
) -> Result<Vec<NegativeLabSavedPositiveHandoff>, String> {
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut bundle_outputs = Vec::new();
        let save_options = options.unwrap_or_default().sanitized();
        save_options.validate_accepted_batch_plan(paths.len())?;
        let sanitized_params = params.sanitized();
        validate_render_intent_output_format(
            sanitized_params.render_intent,
            save_options.output_format,
        )?;
        let crosstalk_profile = save_options
            .selected_profile
            .as_ref()
            .and_then(|profile| profile.crosstalk_profile.as_ref());
        resolve_negative_lab_crosstalk(crosstalk_profile)?;
        let real_source_paths = paths
            .iter()
            .map(|path_str| {
                let (source_path, _) = parse_virtual_path(path_str);
                source_path.to_string_lossy().to_string()
            })
            .collect::<Vec<_>>();
        let output_format = negative_lab_output_format_id(save_options.output_format).to_string();
        let replay_plan_hash = build_negative_lab_replay_plan_hash(
            &sanitized_params,
            &save_options,
            &output_format,
            real_source_paths.clone(),
        );

        for (i, path_str) in paths.iter().enumerate() {
            let _ = app_handle.emit(
                "negative-batch-progress",
                serde_json::json!({
                    "current": i + 1,
                    "total": paths.len(),
                    "path": path_str
                }),
            );

            let real_path = real_source_paths
                .get(i)
                .cloned()
                .ok_or_else(|| format!("Missing Negative Lab source path at index {}", i))?;

            let interpretation = preflight_negative_lab_source_path(&real_path, &app_handle)?;
            let effective_params =
                save_options.effective_params_for_path(&sanitized_params, &real_path);
            validate_negative_lab_source_interpretation(&effective_params, &interpretation)?;

            let settings = load_settings_or_default(&app_handle);

            let img = match read_file_mapped(Path::new(&real_path)) {
                Ok(mmap) => load_base_image_from_bytes(&mmap, &real_path, false, &settings, None),
                Err(_) => {
                    let bytes = fs::read(&real_path).unwrap_or_default();
                    load_base_image_from_bytes(&bytes, &real_path, false, &settings, None)
                }
            }
            .map_err(|e| e.to_string())?;

            let pipeline_render =
                run_pipeline_with_metrics(&img, &effective_params, None, crosstalk_profile);
            let processed = pipeline_render.rendered_preview;
            let output_pixels =
                if effective_params.render_intent == NegativeLabRenderIntent::FlatLogMaster {
                    pipeline_render.scene_linear_print_preview
                } else {
                    processed.clone()
                };
            let density_normalization_metrics = pipeline_render.density_normalization_metrics;
            let color_finish_metrics = pipeline_render.color_finish_metrics;

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
                    output_pixels
                        .to_rgb16()
                        .save(&out_path)
                        .map_err(|e| format!("Failed to save {}: {}", filename, e))?;
                }
            }

            let _ = crate::exif_processing::write_rrexif_sidecar(&real_path, &out_path);
            let sidecar_receipt = write_negative_lab_output_sidecar(
                &out_path,
                Path::new(&real_path),
                &effective_params,
                &save_options,
                &save_options.accepted_dust_heal_layers_for_path(&real_path),
                &replay_plan_hash,
                NegativeLabOutputRenderReceipt {
                    density_normalization_metrics: &density_normalization_metrics,
                    auto_meter: Some(&pipeline_render.auto_meter),
                    color_finish_metrics: Some(&color_finish_metrics),
                    neutral_axis_analysis: Some(&pipeline_render.neutral_axis_analysis),
                    dimensions: NegativeLabSavedPositiveDimensions {
                        height: processed.height(),
                        width: processed.width(),
                    },
                    flat_log_master: effective_params.flat_log_master,
                    render_intent: effective_params.render_intent,
                },
            )?;
            bundle_outputs.push(NegativeLabConversionBundleOutputRef {
                density_normalization_metrics: density_normalization_metrics.clone(),
                auto_meter: pipeline_render.auto_meter.clone(),
                color_finish_metrics: Some(color_finish_metrics.clone()),
                flat_log_master: effective_params.flat_log_master,
                render_intent: effective_params.render_intent,
                output_height: processed.height(),
                output_path: out_path.clone(),
                output_width: processed.width(),
                sidecar_path: sidecar_receipt.sidecar_path.clone(),
                source_path: PathBuf::from(&real_path),
            });
            let output_path = out_path.to_string_lossy().to_string();
            results.push(NegativeLabSavedPositiveHandoff {
                artifact_id: sidecar_receipt.artifact_id,
                conversion_bundle_path: None,
                density_normalization_metrics,
                color_finish_metrics: Some(color_finish_metrics),
                flat_log_master: effective_params.flat_log_master,
                dimensions: NegativeLabSavedPositiveDimensions {
                    height: processed.height(),
                    width: processed.width(),
                },
                frame_exposure_overrides: save_options.frame_exposure_overrides.clone(),
                frame_rgb_balance_overrides: save_options.frame_rgb_balance_overrides.clone(),
                output_artifact_id: sidecar_receipt.output_artifact_id,
                output_format: output_format.clone(),
                output_hash: sidecar_receipt.output_hash,
                output_path: output_path.clone(),
                path: output_path.clone(),
                positive_variant_id: sidecar_receipt.positive_variant_id,
                profile_provenance_hash: save_options.profile_provenance_hash.clone(),
                replay_plan_hash: sidecar_receipt.replay_plan_hash,
                render_intent: effective_params.render_intent,
                selected_acquisition_profile: save_options.selected_acquisition_profile.clone(),
                selected_profile: save_options.selected_profile.clone(),
                sidecar_path: sidecar_receipt.sidecar_path.to_string_lossy().to_string(),
                source_image_ref: real_path.clone(),
                source_path: real_path,
            });
        }

        if save_options.write_conversion_bundle
            && let Some(first_output) = bundle_outputs.first()
        {
            let conversion_bundle_path =
                negative_lab_conversion_bundle_path(&first_output.output_path);
            write_negative_lab_conversion_bundle(
                &conversion_bundle_path,
                &sanitized_params,
                &save_options,
                &bundle_outputs,
            )?;
            attach_negative_lab_conversion_bundle_path_to_output_sidecars(
                &conversion_bundle_path,
                &bundle_outputs,
            )?;
            let conversion_bundle_path = conversion_bundle_path.to_string_lossy().to_string();
            for result in &mut results {
                result.conversion_bundle_path = Some(conversion_bundle_path.clone());
            }
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
    use image::{DynamicImage, ImageFormat, Pixel, Rgb32FImage};
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

    fn fixture_density_metrics() -> NegativeLabDensityNormalizationMetrics {
        let mut pixels = Vec::with_capacity(12 * 12 * 3);
        for y in 0..12 {
            for x in 0..12 {
                let density = 0.1 + (x + y) as f32 / 16.0;
                let rgb = 10.0_f32.powf(-density);
                pixels.extend_from_slice(&[rgb, rgb * 0.98, rgb * 0.94]);
            }
        }
        run_pipeline_with_metrics(
            &DynamicImage::ImageRgb32F(Rgb32FImage::from_vec(12, 12, pixels).unwrap()),
            &NegativeConversionParams::default(),
            None,
            None,
        )
        .density_normalization_metrics
    }

    fn roll_bounds_fixture_frame(
        frame_id: &str,
        scale: f32,
        eligible: bool,
    ) -> NegativeLabRollBoundsFrameV1 {
        let mut local_bounds = fixture_density_metrics().bounds_receipt.final_bounds;
        local_bounds.axis_bounds.luma.min *= scale;
        local_bounds.axis_bounds.luma.max *= scale;
        local_bounds.axis_bounds.color.min *= scale;
        local_bounds.axis_bounds.color.max *= scale;
        NegativeLabRollBoundsFrameV1 {
            anchor: frame_id.ends_with('1'),
            eligible,
            frame_id: frame_id.to_string(),
            local_bounds,
            source_interpretation_hash:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    .to_string(),
        }
    }

    #[test]
    fn roll_bounds_lock_keeps_local_inputs_and_applies_independent_axes() {
        let frames = vec![
            roll_bounds_fixture_frame("frame-1", 1.0, true),
            roll_bounds_fixture_frame("frame-2", 1.2, true),
            roll_bounds_fixture_frame("frame-3", 0.8, false),
        ];
        let luma_only = aggregate_negative_lab_roll_bounds(NegativeLabRollBoundsRequestV1 {
            analysis_version: "fixed_grid_block_median_luma_color_v1".to_string(),
            frames: frames.clone(),
            source_interpretation_hash:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    .to_string(),
            use_roll_colour: false,
            use_roll_luma: true,
        })
        .expect("luma-only lock should fit");
        let frame = luma_only
            .frame_results
            .iter()
            .find(|frame| frame.frame_id == "frame-2")
            .expect("frame result should be present");
        assert_eq!(
            frame.final_bounds.axis_bounds.color,
            frame.local_bounds.axis_bounds.color
        );
        assert_eq!(
            frame.final_bounds.channel_bounds,
            frame.local_bounds.channel_bounds
        );
        assert_eq!(
            frame.final_bounds.axis_bounds.luma,
            luma_only.roll_bounds.axis_bounds.luma
        );
        assert_ne!(
            frame.final_bounds.axis_bounds.luma,
            frame.local_bounds.axis_bounds.luma
        );

        let colour_only = aggregate_negative_lab_roll_bounds(NegativeLabRollBoundsRequestV1 {
            analysis_version: "fixed_grid_block_median_luma_color_v1".to_string(),
            frames,
            source_interpretation_hash:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    .to_string(),
            use_roll_colour: true,
            use_roll_luma: false,
        })
        .expect("colour-only lock should fit");
        let colour_frame = colour_only
            .frame_results
            .iter()
            .find(|frame| frame.frame_id == "frame-2")
            .expect("frame result should be present");
        assert_eq!(
            colour_frame.final_bounds.axis_bounds.luma,
            colour_frame.local_bounds.axis_bounds.luma
        );
        assert_eq!(
            colour_frame.final_bounds.axis_bounds.color,
            colour_only.roll_bounds.axis_bounds.color
        );
        assert_eq!(
            colour_frame.final_bounds.channel_bounds,
            colour_only.roll_bounds.channel_bounds
        );
        assert!(colour_only.plan_hash.starts_with("sha256:"));
    }

    #[test]
    fn source_interpretation_hash_is_deterministic_and_flags_jpeg_review() {
        let image =
            DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 1, image::Rgb([32, 64, 96])));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Jpeg)
            .expect("jpeg fixture should encode");
        let first = build_negative_lab_source_interpretation(
            "fixture.jpg",
            &bytes,
            &image,
            None,
            Some(ImageFormat::Jpeg),
        );
        let second = build_negative_lab_source_interpretation(
            "fixture.jpg",
            &bytes,
            &image,
            None,
            Some(ImageFormat::Jpeg),
        );
        assert_eq!(first.interpretation_hash, second.interpretation_hash);
        assert_eq!(first.source_type, "rendered_jpeg");
        assert!(
            first
                .warning_codes
                .iter()
                .any(|code| code == "rendered_jpeg_review_only")
        );
    }

    #[test]
    fn source_interpretation_hash_mismatch_invalidates_preview_params() {
        let image =
            DynamicImage::ImageRgb32F(Rgb32FImage::from_vec(1, 1, vec![0.2, 0.3, 0.4]).unwrap());
        let interpretation = build_negative_lab_source_interpretation(
            "fixture.tiff",
            &[1, 2, 3],
            &image,
            None,
            Some(ImageFormat::Tiff),
        );
        let params = NegativeConversionParams {
            source_interpretation_hash: Some(
                "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                    .to_string(),
            ),
            ..NegativeConversionParams::default()
        };
        assert!(validate_negative_lab_source_interpretation(&params, &interpretation).is_err());
    }

    fn calibration_fixture_patches() -> Vec<NegativeLabCalibrationPatchV1> {
        (0..12)
            .map(|index| {
                let level = 0.08 + index as f32 * 0.07;
                NegativeLabCalibrationPatchV1 {
                    expected_rgb: [level, level * 0.95, level * 0.9],
                    independent_color_patch: index >= 9,
                    observed_rgb: [level / 1.1, level * 0.95 / 0.9, level * 0.9 / 1.2],
                    clipped: false,
                }
            })
            .collect()
    }

    #[test]
    fn measured_profile_fit_recovers_channel_weights_and_claims_runtime() {
        let receipt = fit_negative_lab_profile(NegativeLabProfileFitRequestV1 {
            patches: calibration_fixture_patches(),
            schema_version: 1,
            source_interpretation_hash:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    .to_string(),
            target_layout_id: "rawengine_negative_lab_target_v1".to_string(),
        })
        .expect("synthetic calibration target should fit");
        assert_eq!(receipt.claim_status, "runtime_parameter_applied");
        assert!((receipt.fitted_params.red_weight - 1.1).abs() < 0.02);
        assert!((receipt.fitted_params.green_weight - 0.9).abs() < 0.02);
        assert!((receipt.fitted_params.blue_weight - 1.2).abs() < 0.02);
        assert_eq!(
            receipt.crosstalk_status,
            "identity_crosstalk_pending_conditioning"
        );
        assert!(receipt.report_hash.starts_with("sha256:"));
    }

    #[test]
    fn measured_profile_fit_rejects_clipped_or_non_monotonic_targets() {
        let mut clipped = calibration_fixture_patches();
        clipped[0].clipped = true;
        clipped[1].clipped = true;
        assert!(
            fit_negative_lab_profile(NegativeLabProfileFitRequestV1 {
                patches: clipped,
                schema_version: 1,
                source_interpretation_hash:
                    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                        .to_string(),
                target_layout_id: "rawengine_negative_lab_target_v1".to_string(),
            })
            .is_err()
        );

        let mut non_monotonic = calibration_fixture_patches();
        non_monotonic[11].observed_rgb = [0.01, 0.01, 0.01];
        assert!(
            fit_negative_lab_profile(NegativeLabProfileFitRequestV1 {
                patches: non_monotonic,
                schema_version: 1,
                source_interpretation_hash:
                    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                        .to_string(),
                target_layout_id: "rawengine_negative_lab_target_v1".to_string(),
            })
            .is_err()
        );
    }

    #[test]
    fn e6_positive_normalization_preserves_polarity_and_bypasses_negative_stages() {
        let params = NegativeConversionParams {
            conversion_model: NegativeConversionModel::E6PositiveV1,
            ..NegativeConversionParams::default()
        };
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                3,
                1,
                vec![0.05, 0.05, 0.05, 0.5, 0.5, 0.5, 0.95, 0.95, 0.95],
            )
            .unwrap(),
        );
        let render = run_pipeline_with_metrics(&input, &params, None, None);
        let output = render.rendered_preview.to_rgb32f();
        assert!(output.get_pixel(0, 0)[0] < output.get_pixel(1, 0)[0]);
        assert!(output.get_pixel(1, 0)[0] < output.get_pixel(2, 0)[0]);
        assert_eq!(
            render
                .density_normalization_metrics
                .bounds_receipt
                .algorithm_id,
            "native_negative_lab_e6_positive_normalization_v1"
        );
        assert!(
            render
                .density_normalization_metrics
                .crosstalk_receipt
                .is_none()
        );
        assert!(
            render
                .density_normalization_metrics
                .bounds_receipt
                .warning_codes
                .iter()
                .any(|code| code == "e6_positive_bypasses_base_fog")
        );
        assert_eq!(render.color_finish_metrics.effective_radius_pixels, 0);
        assert_eq!(render.color_finish_metrics.changed_pixel_ratio, 0.0);
        assert_eq!(
            render.color_finish_metrics.before_hash,
            render.color_finish_metrics.after_hash
        );
        assert_eq!(
            render.color_finish_metrics.operation_id,
            "negative_lab.scanner_color_finish"
        );
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

    #[derive(Debug, Clone)]
    struct NegativeLabBaseFogCandidate {
        confidence: f32,
        estimate: NegativeBaseFogEstimate,
        sample_rect: NegativeBaseFogSampleRect,
        score: f32,
        source: &'static str,
        warnings: Vec<&'static str>,
    }

    fn channel_cast_ratio_from_weights(
        red_weight: f32,
        green_weight: f32,
        blue_weight: f32,
    ) -> f32 {
        let min_weight = red_weight.min(green_weight).min(blue_weight).max(0.001);
        let max_weight = red_weight.max(green_weight).max(blue_weight);
        max_weight / min_weight
    }

    fn negative_lab_changed_pixel_ratio(left: &Rgb32FImage, right: &Rgb32FImage) -> f32 {
        assert_eq!(left.dimensions(), right.dimensions());

        let changed = right
            .pixels()
            .zip(left.pixels())
            .filter(|(right_pixel, left_pixel)| {
                right_pixel
                    .channels()
                    .iter()
                    .zip(left_pixel.channels())
                    .any(|(right_channel, left_channel)| {
                        (right_channel - left_channel).abs() > 0.01
                    })
            })
            .count();
        changed as f32 / (right.width() * right.height()).max(1) as f32
    }

    fn ranked_negative_lab_edge_base_fog_candidates(
        input: &DynamicImage,
    ) -> Vec<NegativeLabBaseFogCandidate> {
        let candidate_rects = [
            (
                "left_edge_border",
                NegativeBaseFogSampleRect {
                    x: 0.0,
                    y: 0.0,
                    width: 0.18,
                    height: 1.0,
                },
            ),
            (
                "right_edge_border",
                NegativeBaseFogSampleRect {
                    x: 0.82,
                    y: 0.0,
                    width: 0.18,
                    height: 1.0,
                },
            ),
            (
                "top_edge_border",
                NegativeBaseFogSampleRect {
                    x: 0.0,
                    y: 0.0,
                    width: 1.0,
                    height: 0.18,
                },
            ),
            (
                "bottom_edge_border",
                NegativeBaseFogSampleRect {
                    x: 0.0,
                    y: 0.82,
                    width: 1.0,
                    height: 0.18,
                },
            ),
        ];

        let mut candidates: Vec<NegativeLabBaseFogCandidate> = candidate_rects
            .into_iter()
            .map(|(source, sample_rect)| {
                let estimate = estimate_base_fog_from_image(input, Some(sample_rect));
                let channel_cast_ratio = channel_cast_ratio_from_weights(
                    estimate.red_weight,
                    estimate.green_weight,
                    estimate.blue_weight,
                );
                let mut warnings = Vec::new();
                if estimate.confidence < 0.05 {
                    warnings.push("low_base_estimate_confidence");
                }
                if channel_cast_ratio > 1.35 {
                    warnings.push("strong_channel_cast_candidate");
                }
                let score = estimate.confidence - ((channel_cast_ratio - 1.0).max(0.0) * 0.12);

                NegativeLabBaseFogCandidate {
                    confidence: estimate.confidence,
                    estimate,
                    sample_rect,
                    score,
                    source,
                    warnings,
                }
            })
            .collect();

        candidates.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
        });
        candidates
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
    fn negative_lab_patch_suggestions_cover_neutral_highlight_and_shadow_roles() {
        let sample_rect = NegativeBaseFogSampleRect {
            x: 0.0,
            y: 0.0,
            width: 0.5,
            height: 1.0,
        };
        let neutral = build_negative_lab_neutral_patch_suggestion(
            NegativeConversionParams {
                red_weight: 1.07,
                green_weight: 0.96,
                blue_weight: 1.18,
                ..NegativeConversionParams::default()
            },
            sample_rect,
            NegativeBaseFogEstimate {
                red_weight: 1.14,
                green_weight: 0.94,
                blue_weight: 1.16,
                base_rgb: [0.72, 0.58, 0.44],
                base_density: [0.14, 0.24, 0.36],
                confidence: 0.82,
            },
        );
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                2,
                vec![
                    0.004, 0.004, 0.004, 0.006, 0.006, 0.006, 0.72, 0.72, 0.72, 0.99, 0.99, 0.99,
                    0.004, 0.004, 0.004, 0.006, 0.006, 0.006, 0.72, 0.72, 0.72, 0.99, 0.99, 0.99,
                ],
            )
            .unwrap(),
        );
        let highlight = build_negative_lab_highlight_patch_exposure_suggestion(
            &input,
            NegativeConversionParams {
                exposure: 2.0,
                ..NegativeConversionParams::default()
            },
            0.0,
            sample_rect,
        );
        let shadow = build_negative_lab_shadow_patch_black_point_suggestion(
            &input,
            NegativeConversionParams::default(),
            sample_rect,
        );

        assert_near(neutral.sample_rect.x, sample_rect.x);
        assert_near(neutral.sample_rect.y, sample_rect.y);
        assert_near(neutral.sample_rect.width, sample_rect.width);
        assert_near(neutral.sample_rect.height, sample_rect.height);
        assert_eq!(highlight.role, "highlight");
        assert_eq!(shadow.role, "shadow");
        assert!(neutral.confidence > 0.0);
        assert!(highlight.suggested_exposure_delta_ev <= 0.0);
        assert!(shadow.suggested_black_point_delta >= 0.0);
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
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: f32::INFINITY,
            contrast: f32::NEG_INFINITY,
            black_point: f32::NAN,
            white_point: f32::NEG_INFINITY,
            ..NegativeConversionParams::default()
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
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
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
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
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
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
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
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
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
    fn negative_conversion_output_path_uses_no_overwrite_suffix() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let source_path = temp_dir.path().join("frame_001.tif");
        let first_output = temp_dir.path().join("frame_001_Positive.tiff");
        fs::write(&source_path, b"negative-source").expect("source should be written");
        fs::write(&first_output, b"existing-positive").expect("existing output should be written");

        let output_path = build_negative_output_path(
            &source_path.to_string_lossy(),
            &NegativeConversionSaveOptions::default(),
        );

        assert_eq!(
            output_path,
            temp_dir.path().join("frame_001_Positive-1.tiff")
        );
        assert_ne!(output_path, source_path);
        assert_ne!(output_path, first_output);
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
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
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
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
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
        let baseline_render = render_fixture(pixels.clone(), base_params.clone(), bounds);
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
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.1,
            contrast: 1.08,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
        };
        let accepted_dust_heal_layers = vec![serde_json::json!({
            "adjustmentPreset": "empty_adjustment_layer_v1",
            "blendMode": "normal",
            "id": "dust_candidate_001_heal_layer",
            "maskIds": ["dust_candidate_001_target"],
            "name": "Dust heal dust_candidate_001",
            "opacity": 1.0,
            "retouchCloneSource": {
                "alignmentErrorPx": 0,
                "candidateProvenance": {
                    "algorithmId": "local_heal_v1",
                    "candidateId": "dust_candidate_001",
                    "candidateKind": "dust_spot",
                    "changedPixelCount": 257,
                    "confidence": 0.92,
                    "confidenceSemantics": "ranking_score_v1",
                    "origin": "negative_lab_dust_candidate",
                    "outputHash": "fnv1a32:9e2d410f",
                    "outputSampleHash": "fnv1a32:63ac0172",
                    "sourceFrameId": "negative-lab-frame-001",
                    "sourceSampleHash": "fnv1a32:34f64dd7",
                    "statusAtAcceptance": "acknowledged",
                },
                "featherRadiusPx": 3.5,
                "radiusPx": 10.0,
                "retouchMode": "heal",
                "rotationDegrees": 0,
                "scale": 1,
                "sourcePoint": { "x": 0.42, "y": 0.38 },
                "targetPoint": { "x": 0.36, "y": 0.38 },
            },
            "visible": true,
        })];
        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            profile_provenance_hash: Some("fnv1a32:aaaaaaaa".to_string()),
            output_format: NegativeConversionOutputFormat::Tiff16,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: Vec::new(),
            acquisition_source_families: Vec::new(),
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            selected_profile: Some(NegativeLabSelectedProfileSnapshot {
                claim_level: "measured_profile".to_string(),
                claim_policy: "process_family_profile_no_stock_claim".to_string(),
                crosstalk_profile: Some(default_negative_lab_identity_crosstalk_profile()),
                display_name: "Measured C-41 Process Family".to_string(),
                does_not_prove: vec![
                    "no_stock_emulation_claim".to_string(),
                    "no_colorimetric_match_claim".to_string(),
                ],
                evidence_fixture_count: 1,
                film_class: Some("color_negative".to_string()),
                measurement_profile_id: Some(
                    "negative_lab.measured.c41.process_family.v1".to_string(),
                ),
                params: params.clone(),
                preset_id: "negative_lab.measured.c41.process_family.v1".to_string(),
                profile_provenance_hash: "fnv1a32:aaaaaaaa".to_string(),
                profile_status: "fixture_measured".to_string(),
                provenance_summary: "Fixture-measured process-family profile.".to_string(),
                runtime_status: "runtime_parameter_applied".to_string(),
                source_generic_preset_id: Some("negative_lab.generic.c41.neutral.v1".to_string()),
            }),
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::from([(
                source_path.to_string_lossy().to_string(),
                accepted_dust_heal_layers,
            )]),
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };

        write_negative_lab_output_sidecar(
            &output_path,
            &source_path,
            &params,
            &save_options,
            &save_options.accepted_dust_heal_layers_for_path(&source_path.to_string_lossy()),
            "fnv1a32:2f4a91bc",
            NegativeLabOutputRenderReceipt {
                density_normalization_metrics: &fixture_density_metrics(),
                auto_meter: None,
                color_finish_metrics: None,
                neutral_axis_analysis: None,
                dimensions: NegativeLabSavedPositiveDimensions {
                    height: 8,
                    width: 12,
                },
                flat_log_master: NegativeLabFlatLogMasterParams::default(),
                render_intent: NegativeLabRenderIntent::Print,
            },
        )
        .expect("sidecar should be written");

        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        let sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        let artifacts = sidecar
            .raw_engine_artifacts
            .expect("rawEngineArtifacts should be present");
        let artifact = artifacts
            .negative_lab_artifacts
            .clone()
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
        assert_eq!(artifact["replay"]["identityHash"], "fnv1a32:2f4a91bc");
        assert_eq!(
            artifact["conversion"]["acceptedDryRunPlanId"],
            "negative_lab_batch_plan_2f4a91bc"
        );
        assert_eq!(
            artifact["conversion"]["acceptedDryRunIdentity"]["planHash"],
            "fnv1a32:2f4a91bc"
        );
        assert_eq!(
            artifact["conversion"]["noOverwritePolicy"],
            "never_overwrite_original"
        );
        assert_eq!(artifact["conversion"]["recipeHash"], "fnv1a32:2f4a91bc");
        assert_eq!(
            artifact["acquisition"]["selectedProfile"]["id"],
            "camera_raw_linear_v1"
        );
        assert_eq!(artifact["outputArtifacts"][0]["dimensions"]["width"], 12);
        assert_eq!(artifact["outputArtifacts"][0]["dimensions"]["height"], 8);
        assert_eq!(
            artifact["outputArtifacts"][0]["kind"],
            "negative_lab_positive"
        );
        assert_eq!(
            artifact["outputArtifacts"][0]["path"],
            output_path.to_string_lossy().to_string()
        );
        assert_eq!(artifact["outputArtifacts"][0]["format"], "tiff16");
        assert_eq!(
            artifact["outputArtifacts"][0]["storage"],
            "sidecar_artifact"
        );
        assert_eq!(
            artifact["outputArtifacts"][0]["outputIntent"],
            "editable_positive"
        );
        assert!(
            artifact["outputArtifacts"][0]["positiveVariantId"]
                .as_str()
                .unwrap_or_default()
                .starts_with("positive_variant_")
        );
        assert!(
            artifact["outputArtifacts"][0]["contentHash"]
                .as_str()
                .unwrap_or_default()
                .starts_with("fnv1a64:")
        );
        assert_eq!(
            artifact["outputArtifacts"][0]["fileState"]["path"],
            output_path.to_string_lossy().to_string()
        );
        assert_eq!(
            artifact["sourceImageRefs"][0]["imagePath"],
            source_path.to_string_lossy().to_string()
        );
        assert_eq!(
            artifact["sourceImageRefs"][0]["fileState"]["path"],
            source_path.to_string_lossy().to_string()
        );
        assert_eq!(artifact["staleState"]["state"], "current");
        assert_eq!(artifacts.layer_stack_sidecars.len(), 1);
        let layer_stack = &artifacts.layer_stack_sidecars[0];
        assert_eq!(
            layer_stack["sourceImagePath"],
            output_path.to_string_lossy().to_string()
        );
        assert_eq!(layer_stack["storage"], "sidecar_artifact");
        assert_eq!(layer_stack["layers"].as_array().unwrap().len(), 1);
        assert_eq!(
            layer_stack["layers"][0]["id"],
            "dust_candidate_001_heal_layer"
        );
        assert_eq!(
            layer_stack["layers"][0]["retouchCloneSource"]["candidateProvenance"]["origin"],
            "negative_lab_dust_candidate"
        );
        assert!(
            layer_stack["graphRevision"]
                .as_str()
                .unwrap_or_default()
                .starts_with("graph_negative_lab_positive_variant_")
        );

        let bundle_path = negative_lab_conversion_bundle_path(&output_path);
        fs::write(&bundle_path, b"{}").expect("bundle should be written");
        attach_negative_lab_conversion_bundle_path_to_output_sidecars(
            &bundle_path,
            &[NegativeLabConversionBundleOutputRef {
                density_normalization_metrics: fixture_density_metrics(),
                auto_meter: measure_auto_meter(
                    &[],
                    &NegativeLabAutoMeterControls::default(),
                    0,
                    NegativeLabRenderIntent::Print,
                ),
                color_finish_metrics: None,
                flat_log_master: NegativeLabFlatLogMasterParams::default(),
                render_intent: NegativeLabRenderIntent::Print,
                output_height: 8,
                output_path,
                output_width: 12,
                sidecar_path: sidecar_path.clone(),
                source_path,
            }],
        )
        .expect("sidecar should record conversion bundle path");
        let sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        let artifact = sidecar
            .raw_engine_artifacts
            .expect("rawEngineArtifacts should be present")
            .negative_lab_artifacts
            .into_iter()
            .last()
            .expect("Negative Lab artifact should be present");
        assert_eq!(
            artifact["conversionBundlePath"],
            bundle_path.to_string_lossy().to_string()
        );
        assert_eq!(
            artifact["conversion"]["conversionBundlePath"],
            bundle_path.to_string_lossy().to_string()
        );
    }

    #[test]
    fn negative_lab_refresh_marks_changed_positive_artifact_stale() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let source_path = temp_dir.path().join("frame_001.tif");
        let output_path = temp_dir.path().join("frame_001_Positive.tiff");
        fs::write(&source_path, b"negative-source").expect("source should be written");
        fs::write(&output_path, b"positive-output").expect("output should be written");
        let params = NegativeConversionParams {
            red_weight: 1.0,
            green_weight: 1.0,
            blue_weight: 1.0,
            base_fog_strength: 1.0,
            base_fog_sample: None,
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.0,
            contrast: 1.0,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
        };
        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            profile_provenance_hash: Some("fnv1a32:aaaaaaaa".to_string()),
            output_format: NegativeConversionOutputFormat::Tiff16,
            write_conversion_bundle: default_write_conversion_bundle(),
            acquisition_warning_codes: vec!["scanner_input_profile_unverified".to_string()],
            acquisition_source_families: vec!["camera_raw".to_string()],
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };

        write_negative_lab_output_sidecar(
            &output_path,
            &source_path,
            &params,
            &save_options,
            &[],
            "fnv1a32:2f4a91bc",
            NegativeLabOutputRenderReceipt {
                density_normalization_metrics: &fixture_density_metrics(),
                auto_meter: None,
                color_finish_metrics: None,
                neutral_axis_analysis: None,
                dimensions: NegativeLabSavedPositiveDimensions {
                    height: 8,
                    width: 12,
                },
                flat_log_master: NegativeLabFlatLogMasterParams::default(),
                render_intent: NegativeLabRenderIntent::Print,
            },
        )
        .expect("sidecar should be written");

        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        let mut sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        assert!(!refresh_negative_lab_stale_artifacts(&mut sidecar));

        fs::write(&output_path, b"changed-positive-output").expect("output should be changed");
        assert!(refresh_negative_lab_stale_artifacts(&mut sidecar));
        let artifacts = sidecar
            .raw_engine_artifacts
            .expect("rawEngineArtifacts should be present");
        let artifact = artifacts
            .negative_lab_artifacts
            .first()
            .expect("Negative Lab artifact should be present");
        let artifact_id = artifact["artifactId"].as_str().unwrap_or_default();
        assert!(
            artifacts
                .stale_artifact_ids
                .contains(&artifact_id.to_string())
        );
        assert_eq!(artifact["staleState"]["state"], "stale");
        assert!(
            artifact["staleState"]["invalidationReasons"]
                .as_array()
                .expect("stale reasons should be an array")
                .iter()
                .any(|reason| reason == "output_artifact_changed")
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
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.05,
            contrast: 0.95,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
        };
        let selected_acquisition_profile = NegativeLabAcquisitionProfileSnapshot {
            channel_basis: "scanner_rgb".to_string(),
            display_name: "16-bit flatbed/film scanner TIFF".to_string(),
            id: "scanner_tiff_16bit_flat_v1".to_string(),
            input_transform: "scanner_rgb_flat".to_string(),
            provenance_summary:
                "Flat 16-bit scanner RGB input with automatic color, contrast, sharpening, and inversion off."
                    .to_string(),
            warning_codes: vec!["scanner_profile_unmeasured".to_string()],
        };
        let save_options = NegativeConversionSaveOptions {
            accepted_dry_run_plan_hash: Some("fnv1a32:2f4a91bc".to_string()),
            accepted_dry_run_plan_id: Some("negative_lab_batch_plan_2f4a91bc".to_string()),
            output_format: NegativeConversionOutputFormat::JpegProof,
            write_conversion_bundle: true,
            acquisition_warning_codes: vec!["lossy_source_for_negative_lab".to_string()],
            acquisition_source_families: vec!["jpeg_lossy".to_string()],
            selected_acquisition_profile,
            profile_provenance_hash: Some("fnv1a32:e5855424".to_string()),
            selected_profile: None,
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: serde_json::json!({
                "corrections": [{
                    "accepted": true,
                    "appliedAt": "2026-07-01T00:00:00Z",
                    "correctionId": "patch_sampler_neutral_rgb_balance_f4a91bc2",
                    "frameId": "negative-lab-frame-1",
                    "role": "neutral_rgb_balance",
                    "sampleRect": null,
                    "sourceCommand": "suggest_negative_lab_neutral_patch_rgb_balance",
                    "sourcePath": source_path.to_string_lossy().to_string(),
                    "values": {
                        "suggestedRgbBalanceOffset": {
                            "blueWeight": 0.02,
                            "greenWeight": -0.01,
                            "redWeight": 0.03
                        }
                    }
                }],
                "schemaVersion": 1
            }),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
            suffix: DEFAULT_OUTPUT_SUFFIX.to_string(),
        };
        let bundle_path = negative_lab_conversion_bundle_path(&output_path);

        write_negative_lab_conversion_bundle(
            &bundle_path,
            &params,
            &save_options,
            &[NegativeLabConversionBundleOutputRef {
                density_normalization_metrics: fixture_density_metrics(),
                auto_meter: measure_auto_meter(
                    &[],
                    &NegativeLabAutoMeterControls::default(),
                    0,
                    NegativeLabRenderIntent::Print,
                ),
                color_finish_metrics: None,
                flat_log_master: NegativeLabFlatLogMasterParams::default(),
                render_intent: NegativeLabRenderIntent::Print,
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
        assert_eq!(
            bundle["outputs"][0]["densityNormalizationMetrics"]["boundsReceipt"]["schemaVersion"],
            1
        );
        assert_eq!(bundle["conversion"]["outputFormat"], "jpeg_proof");
        assert_eq!(
            bundle["conversion"]["profileProvenanceHash"],
            "fnv1a32:e5855424"
        );
        assert_eq!(
            bundle["acquisition"]["warningCodes"][0],
            "lossy_source_for_negative_lab"
        );
        assert_eq!(
            bundle["acquisition"]["selectedProfile"]["id"],
            "scanner_tiff_16bit_flat_v1"
        );
        assert_eq!(
            bundle["acquisition"]["selectedProfile"]["inputTransform"],
            "scanner_rgb_flat"
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
                conversion_model: NegativeConversionModel::DensityRgbV1,
                exposure: 50.0,
                contrast: -50.0,
                black_point: 0.99,
                white_point: 0.01,
                ..NegativeConversionParams::default()
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
                conversion_model: NegativeConversionModel::DensityRgbV1,
                exposure: 0.0,
                contrast: 1.0,
                black_point: 0.0,
                white_point: 1.0,
                ..NegativeConversionParams::default()
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
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.05,
            contrast: 1.1,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
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
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.05,
            contrast: 1.1,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
        };
        let render = run_pipeline_with_metrics(&input, &params, None, None);
        let rendered = render.rendered_preview.to_rgb32f();
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
                "densityNormalizationMetrics": {
                    "axisBounds": {
                        "color": {
                            "max": render.density_normalization_metrics.axis_bounds.color.max,
                            "min": render.density_normalization_metrics.axis_bounds.color.min
                        },
                        "luma": {
                            "max": render.density_normalization_metrics.axis_bounds.luma.max,
                            "min": render.density_normalization_metrics.axis_bounds.luma.min
                        }
                    },
                    "boundsReceipt": render.density_normalization_metrics.bounds_receipt,
                    "channelBounds": {
                        "blue": {
                            "max": render.density_normalization_metrics.channel_bounds.b.max,
                            "min": render.density_normalization_metrics.channel_bounds.b.min
                        },
                        "green": {
                            "max": render.density_normalization_metrics.channel_bounds.g.max,
                            "min": render.density_normalization_metrics.channel_bounds.g.min
                        },
                        "red": {
                            "max": render.density_normalization_metrics.channel_bounds.r.max,
                            "min": render.density_normalization_metrics.channel_bounds.r.min
                        }
                    },
                    "clippedPixelCount": render.density_normalization_metrics.clipped_pixel_count,
                    "densityRangeUnclamped": render.density_normalization_metrics.density_range_unclamped,
                    "epsilonClampedPixelCount": render.density_normalization_metrics.epsilon_clamped_pixel_count,
                    "rendererVersion": render.density_normalization_metrics.renderer_version
                },
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
    fn negative_log_density_v1_reports_unclamped_density_metrics() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                5,
                1,
                vec![
                    0.95, 0.90, 0.88, 0.65, 0.60, 0.58, 0.30, 0.26, 0.22, 0.0000001, 0.0, 0.0, 1.2,
                    0.98, 0.96,
                ],
            )
            .unwrap(),
        );
        let legacy_render = run_pipeline_with_metrics(
            &input,
            &NegativeConversionParams {
                base_fog_sample: Some(NegativeBaseFogSampleRect {
                    x: 0.0,
                    y: 0.0,
                    width: 0.4,
                    height: 1.0,
                }),
                contrast: 1.05,
                exposure: 0.03,
                ..NegativeConversionParams::default()
            },
            None,
            None,
        );
        let neg_log_render = run_pipeline_with_metrics(
            &input,
            &NegativeConversionParams {
                base_fog_sample: Some(NegativeBaseFogSampleRect {
                    x: 0.0,
                    y: 0.0,
                    width: 0.4,
                    height: 1.0,
                }),
                conversion_model: NegativeConversionModel::NegativeLogDensityV1,
                contrast: 1.05,
                exposure: 0.03,
                ..NegativeConversionParams::default()
            },
            None,
            None,
        );
        let rendered = neg_log_render.rendered_preview.to_rgb32f();

        assert!(rendered.as_raw().iter().all(|value| value.is_finite()));
        assert!(
            legacy_render
                .density_normalization_metrics
                .channel_bounds
                .r
                .min
                >= 0.0
        );
        let neg_log_channel_bounds = neg_log_render.density_normalization_metrics.channel_bounds;
        assert!(
            [
                neg_log_channel_bounds.r.min,
                neg_log_channel_bounds.g.min,
                neg_log_channel_bounds.b.min,
            ]
            .into_iter()
            .any(|minimum| minimum < 0.0)
        );
        assert!(
            neg_log_render
                .density_normalization_metrics
                .epsilon_clamped_pixel_count
                >= 1
        );
        assert!(
            neg_log_render
                .density_normalization_metrics
                .clipped_pixel_count
                >= 1
        );
        assert!(
            neg_log_render
                .density_normalization_metrics
                .density_range_unclamped
                > 0.0
        );
    }

    #[test]
    fn negative_log_density_v1_preserves_preview_runtime_shape() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                2,
                vec![
                    0.72, 0.68, 0.60, 0.74, 0.70, 0.62, 0.95, 0.93, 0.90, 0.98, 0.96, 0.94, 0.30,
                    0.28, 0.24, 0.18, 0.16, 0.12, 0.06, 0.05, 0.04, 0.02, 0.015, 0.01,
                ],
            )
            .unwrap(),
        );
        let legacy_params = NegativeConversionParams {
            base_fog_sample: Some(NegativeBaseFogSampleRect {
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 0.5,
            }),
            contrast: 1.1,
            exposure: 0.02,
            red_weight: 1.03,
            green_weight: 0.99,
            blue_weight: 0.96,
            ..NegativeConversionParams::default()
        };
        let neg_log_params = NegativeConversionParams {
            conversion_model: NegativeConversionModel::NegativeLogDensityV1,
            ..legacy_params.clone()
        };

        let legacy_render = run_pipeline_with_metrics(&input, &legacy_params, None, None);
        let neg_log_render = run_pipeline_with_metrics(&input, &neg_log_params, None, None);
        let legacy_rgb = legacy_render.rendered_preview.to_rgb32f();
        let neg_log_rgb = neg_log_render.rendered_preview.to_rgb32f();

        assert_eq!(legacy_rgb.dimensions(), neg_log_rgb.dimensions());
        assert!(
            legacy_rgb.as_raw().iter().all(|value| value.is_finite())
                && neg_log_rgb.as_raw().iter().all(|value| value.is_finite())
        );
        assert!(
            neg_log_render
                .density_normalization_metrics
                .channel_bounds
                .r
                .min
                < 0.0
        );
        assert_eq!(
            legacy_render
                .density_normalization_metrics
                .channel_bounds
                .r
                .min,
            0.0
        );
        assert_eq!(
            neg_log_render
                .density_normalization_metrics
                .renderer_version,
            NEGATIVE_LAB_LOG_DENSITY_RENDERER_VERSION
        );
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
        let downscaled_input = downscale_f32_image(&input, 1080, 1080);
        let base_fog_candidates = ranked_negative_lab_edge_base_fog_candidates(&downscaled_input);
        assert!(
            base_fog_candidates.len() >= 4,
            "Negative Lab public proof must rank edge/border base candidates"
        );
        let selected_base_fog_candidate = base_fog_candidates
            .first()
            .expect("ranked base fog candidate")
            .clone();
        assert!(
            selected_base_fog_candidate.confidence > 0.01,
            "Negative Lab auto base estimate confidence should be positive"
        );
        let auto_channel_cast_ratio = channel_cast_ratio_from_weights(
            selected_base_fog_candidate.estimate.red_weight,
            selected_base_fog_candidate.estimate.green_weight,
            selected_base_fog_candidate.estimate.blue_weight,
        );
        assert!(
            auto_channel_cast_ratio < 1.5,
            "Negative Lab public proof auto base estimate should avoid extreme channel cast"
        );

        let params = NegativeConversionParams {
            red_weight: selected_base_fog_candidate.estimate.red_weight,
            green_weight: selected_base_fog_candidate.estimate.green_weight,
            blue_weight: selected_base_fog_candidate.estimate.blue_weight,
            base_fog_strength: 1.0,
            base_fog_sample: Some(selected_base_fog_candidate.sample_rect),
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.05,
            contrast: 0.95,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
        };
        let preview_before =
            run_pipeline(&input, &NegativeConversionParams::default(), None).to_rgb32f();
        let preview_after = run_pipeline(&input, &params, None).to_rgb32f();
        let preview_before_hash = hash_rendered_image(&preview_before);
        let preview_after_hash = hash_rendered_image(&preview_after);
        assert_ne!(
            preview_before_hash, preview_after_hash,
            "Negative Lab auto base estimate should change the preview render"
        );

        let ref_rgb = downscaled_input.to_rgb32f();
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
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            profile_provenance_hash: Some("fnv1a32:e5855424".to_string()),
            selected_profile: Some(NegativeLabSelectedProfileSnapshot {
                claim_level: "generic_starting_point_only".to_string(),
                claim_policy: applied_profile_claim_policy.to_string(),
                crosstalk_profile: Some(default_negative_lab_identity_crosstalk_profile()),
                display_name: applied_profile_display_name.to_string(),
                does_not_prove: vec![
                    "no_stock_emulation_claim".to_string(),
                    "no_colorimetric_match_claim".to_string(),
                ],
                evidence_fixture_count: 0,
                film_class: Some("color_negative".to_string()),
                measurement_profile_id: None,
                params: params.clone(),
                preset_id: applied_profile_id.to_string(),
                profile_provenance_hash: "fnv1a32:e5855424".to_string(),
                profile_status: "generic_unmeasured".to_string(),
                provenance_summary: "Generic engineered C-41 portrait starting point.".to_string(),
                runtime_status: "runtime_parameter_applied".to_string(),
                source_generic_preset_id: None,
            }),
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
            suffix: "Positive".to_string(),
        };
        write_negative_lab_output_sidecar(
            &output_path,
            source_path,
            &params,
            &save_options,
            &[],
            "fnv1a32:2f4a91bc",
            NegativeLabOutputRenderReceipt {
                density_normalization_metrics: &fixture_density_metrics(),
                auto_meter: None,
                color_finish_metrics: None,
                neutral_axis_analysis: None,
                dimensions: NegativeLabSavedPositiveDimensions {
                    height: rendered.height(),
                    width: rendered.width(),
                },
                flat_log_master: NegativeLabFlatLogMasterParams::default(),
                render_intent: NegativeLabRenderIntent::Print,
            },
        )
        .expect("write public negative positive sidecar");

        let input_rgb = input.to_rgb32f();
        let rendered_rgb = rendered.to_rgb32f();
        let changed_pixel_ratio = negative_lab_changed_pixel_ratio(&input_rgb, &rendered_rgb);
        let input_to_output_delta = mean_abs_delta(&input_rgb, &rendered_rgb);

        assert!(changed_pixel_ratio > 0.05);
        assert!(input_to_output_delta > 0.01);
        assert!(
            output_path.exists(),
            "Negative Lab public export proof must write the positive output"
        );

        let sidecar_path = negative_lab_output_sidecar_path(&output_path);
        assert!(
            sidecar_path.exists(),
            "Negative Lab public export proof must write a sidecar"
        );
        let sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        let artifact = sidecar
            .raw_engine_artifacts
            .expect("rawEngineArtifacts should be present")
            .negative_lab_artifacts
            .into_iter()
            .last()
            .expect("Negative Lab sidecar artifact should be present");
        assert_eq!(
            artifact["conversion"]["selectedAcquisitionProfile"]["id"],
            "camera_raw_linear_v1"
        );
        assert_eq!(
            artifact["conversion"]["densityNormalizationMetrics"]["boundsReceipt"]["algorithmId"],
            "fixed_grid_block_median_luma_color_v1"
        );
        let bundle_path = negative_lab_conversion_bundle_path(&output_path);
        write_negative_lab_conversion_bundle(
            &bundle_path,
            &params,
            &save_options,
            &[NegativeLabConversionBundleOutputRef {
                density_normalization_metrics: fixture_density_metrics(),
                auto_meter: measure_auto_meter(
                    &[],
                    &NegativeLabAutoMeterControls::default(),
                    0,
                    NegativeLabRenderIntent::Print,
                ),
                color_finish_metrics: None,
                flat_log_master: NegativeLabFlatLogMasterParams::default(),
                render_intent: NegativeLabRenderIntent::Print,
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
                        "height": params.base_fog_sample.expect("sample").height,
                        "width": params.base_fog_sample.expect("sample").width,
                        "x": params.base_fog_sample.expect("sample").x,
                        "y": params.base_fog_sample.expect("sample").y
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
                "profileProvenanceHash": "fnv1a32:e5855424",
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
                        "height": params.base_fog_sample.expect("sample").height,
                        "width": params.base_fog_sample.expect("sample").width,
                        "x": params.base_fog_sample.expect("sample").x,
                        "y": params.base_fog_sample.expect("sample").y
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
            "issue": 4398,
            "metrics": {
                "autoBaseConfidence": selected_base_fog_candidate.confidence,
                "baseFogSampleSource": selected_base_fog_candidate.source,
                "channelCastRatio": auto_channel_cast_ratio,
                "changedPixelRatio": changed_pixel_ratio,
                "inputToOutputMeanAbsDelta": input_to_output_delta,
                "meanInputOutputDelta": input_to_output_delta,
                "previewAfterHash": preview_after_hash,
                "previewBeforeHash": preview_before_hash,
                "previewChanged": preview_before_hash != preview_after_hash,
                "rankedBaseFogCandidates": base_fog_candidates
                    .iter()
                    .map(|candidate| json!({
                        "baseDensity": candidate.estimate.base_density,
                        "baseRgb": candidate.estimate.base_rgb,
                        "blueWeight": candidate.estimate.blue_weight,
                        "channelCastRatio": channel_cast_ratio_from_weights(
                            candidate.estimate.red_weight,
                            candidate.estimate.green_weight,
                            candidate.estimate.blue_weight
                        ),
                        "confidence": candidate.confidence,
                        "greenWeight": candidate.estimate.green_weight,
                        "redWeight": candidate.estimate.red_weight,
                        "sampleRect": {
                            "height": candidate.sample_rect.height,
                            "width": candidate.sample_rect.width,
                            "x": candidate.sample_rect.x,
                            "y": candidate.sample_rect.y
                        },
                        "score": candidate.score,
                        "source": candidate.source,
                        "warnings": candidate.warnings
                    }))
                    .collect::<Vec<_>>(),
                "sampleRect": {
                    "height": params.base_fog_sample.expect("sample").height,
                    "width": params.base_fog_sample.expect("sample").width,
                    "x": params.base_fog_sample.expect("sample").x,
                    "y": params.base_fog_sample.expect("sample").y
                },
                "sampleSource": selected_base_fog_candidate.source,
                "savedOutputExists": output_path.exists(),
                "savedOutputPath": "src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg",
                "warnings": selected_base_fog_candidate.warnings
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
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.05,
            contrast: 0.95,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
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
        let base_fog_estimate = estimate_base_fog_from_image(&bounds_ref, params.base_fog_sample);
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
            accepted_dry_run_plan_hash: Some("fnv1a32:4527e2e1".to_string()),
            accepted_dry_run_plan_id: Some(
                "negative_lab_private_raw_plan_4527_density_v1".to_string(),
            ),
            output_format: NegativeConversionOutputFormat::JpegProof,
            write_conversion_bundle: true,
            acquisition_warning_codes: vec!["raw_source_not_verified_negative_scan".to_string()],
            acquisition_source_families: vec!["camera_raw".to_string()],
            selected_acquisition_profile: default_negative_lab_acquisition_profile(),
            profile_provenance_hash: Some("fnv1a32:e5855424".to_string()),
            selected_profile: Some(NegativeLabSelectedProfileSnapshot {
                claim_level: "generic_starting_point_only".to_string(),
                claim_policy: "generic_starting_point_no_stock_claim".to_string(),
                crosstalk_profile: Some(default_negative_lab_identity_crosstalk_profile()),
                display_name: "C-41 Portrait".to_string(),
                does_not_prove: vec![
                    "no_stock_emulation_claim".to_string(),
                    "no_colorimetric_match_claim".to_string(),
                ],
                evidence_fixture_count: 0,
                film_class: Some("color_negative".to_string()),
                measurement_profile_id: None,
                params: params.clone(),
                preset_id: "negative_lab.generic.c41.portrait.v1".to_string(),
                profile_provenance_hash: "fnv1a32:e5855424".to_string(),
                profile_status: "generic_unmeasured".to_string(),
                provenance_summary: "Generic engineered C-41 portrait starting point.".to_string(),
                runtime_status: "runtime_parameter_applied".to_string(),
                source_generic_preset_id: None,
            }),
            frame_exposure_overrides: NegativeLabFrameExposureOverridePayload::default(),
            frame_rgb_balance_overrides: NegativeLabFrameRgbBalanceOverridePayload::default(),
            patch_sampler_corrections: default_patch_sampler_corrections(),
            accepted_dust_heal_layers_by_source_path: HashMap::new(),
            suffix: "Positive".to_string(),
        };
        write_negative_lab_output_sidecar(
            &output_path,
            &source_path,
            &params,
            &save_options,
            &[],
            "fnv1a32:2f4a91bc",
            NegativeLabOutputRenderReceipt {
                density_normalization_metrics: &fixture_density_metrics(),
                auto_meter: None,
                color_finish_metrics: None,
                neutral_axis_analysis: None,
                dimensions: NegativeLabSavedPositiveDimensions {
                    height: rendered.height(),
                    width: rendered.width(),
                },
                flat_log_master: NegativeLabFlatLogMasterParams::default(),
                render_intent: NegativeLabRenderIntent::Print,
            },
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
                density_normalization_metrics: fixture_density_metrics(),
                auto_meter: measure_auto_meter(
                    &[],
                    &NegativeLabAutoMeterControls::default(),
                    0,
                    NegativeLabRenderIntent::Print,
                ),
                color_finish_metrics: None,
                flat_log_master: NegativeLabFlatLogMasterParams::default(),
                render_intent: NegativeLabRenderIntent::Print,
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
            "issue": 4527,
            "colorManagement": {
                "acquisitionProfileId": "camera_raw_linear_v1",
                "channelBasis": "linear_raw_rgb",
                "decodePath": "load_base_image_from_bytes",
                "outputIntent": "jpeg_proof_review",
                "previewOutputTransfer": "gamma_2_2_display_proof"
            },
            "densityDomainInversion": {
                "algorithm": "density_rgb_v1",
                "baseSample": {
                    "estimatedBaseDensity": base_fog_estimate.base_density,
                    "estimatedBaseRgb": base_fog_estimate.base_rgb,
                    "height": params.base_fog_sample.expect("sample").height,
                    "source": "manual_real_raw_border_sample",
                    "width": params.base_fog_sample.expect("sample").width,
                    "x": params.base_fog_sample.expect("sample").x,
                    "y": params.base_fog_sample.expect("sample").y
                },
                "densityAssumptions": {
                    "baseFogStrength": params.base_fog_strength,
                    "channelBounds": {
                        "blue": {
                            "max": bounds[2].max,
                            "min": bounds[2].min
                        },
                        "green": {
                            "max": bounds[1].max,
                            "min": bounds[1].min
                        },
                        "red": {
                            "max": bounds[0].max,
                            "min": bounds[0].min
                        }
                    },
                    "densityTransform": "-log10(clamp(linear_rgb, 1e-6, 1.0))",
                    "epsilonPolicy": "clamp_linear_rgb_min_1e-6",
                    "normalization": "subtract_sampled_base_density_then_divide_by_density_range",
                    "printCurve": "sigmoid_density_curve_gamma_2_2_preview",
                    "referenceDownscaleMaxEdge": 1080
                },
                "neutralBalance": {
                    "blueWeight": params.blue_weight,
                    "greenWeight": params.green_weight,
                    "redWeight": params.red_weight
                },
                "positiveOutput": {
                    "contentHash": sha256_negative_lab_file(&output_path).expect("hash private output"),
                    "dimensions": {
                        "height": rendered.height(),
                        "width": rendered.width()
                    },
                    "format": "jpeg_proof",
                    "path": "private-artifacts/validation/negative-lab-real-raw/alaska-negative-lab-v1-Positive.jpg"
                }
            },
            "localRawRuntime": {
                "decodePath": "load_base_image_from_bytes",
                "execution": "tauri_test_negative_lab_private_raw_export",
                "outputFormat": "jpeg_proof",
                "proofContext": {
                    "acceptedDryRunPlanHash": save_options.accepted_dry_run_plan_hash,
                    "acceptedDryRunPlanId": save_options.accepted_dry_run_plan_id,
                    "conversionBundleWritten": bundle_path.exists(),
                    "sidecarWritten": sidecar_path.exists()
                },
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

    #[test]
    fn negative_lab_crosstalk_private_raw_changes_preview_and_saved_positive_when_enabled() {
        if std::env::var("RAWENGINE_RUN_NEGATIVE_LAB_PRIVATE_RAW_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            eprintln!("skipping Negative Lab crosstalk private RAW proof");
            return;
        }
        let private_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
                .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
        );
        let source_path =
            private_root.join("private-fixtures/negative-lab/alaska-negative-lab-v1.arw");
        let source_path_string = source_path.to_string_lossy().to_string();
        let input = load_base_image_from_bytes(
            &fs::read(&source_path).expect("read private RAW"),
            &source_path_string,
            false,
            &AppSettings::default(),
            None,
        )
        .expect("decode private RAW through app loader");
        let params = NegativeConversionParams::default();
        let mut profile = crosstalk_profile(
            [
                [1.08, -0.06, -0.02],
                [-0.03, 1.07, -0.04],
                [-0.02, -0.08, 1.1],
            ],
            0.35,
        );
        profile["profileId"] =
            json!("negative_lab.crosstalk.generic.rawengine_c41_starting_point.v1");
        profile["provenance"] = json!("rawengine_generic");
        profile["provenanceHash"] = json!("fnv1a32:664fbacc");
        let identity = run_pipeline_with_metrics(&input, &params, None, None);
        let transformed = run_pipeline_with_metrics(&input, &params, None, Some(&profile));
        let identity_rgb = identity.rendered_preview.to_rgb32f();
        let transformed_rgb = transformed.rendered_preview.to_rgb32f();
        let output_delta = mean_abs_delta(&identity_rgb, &transformed_rgb);
        assert!(
            output_delta > 0.0001,
            "crosstalk must visibly change decoded RAW output"
        );
        let receipt = transformed
            .density_normalization_metrics
            .crosstalk_receipt
            .as_ref()
            .expect("crosstalk receipt");
        assert!(receipt.post_neutral_error < 1.0e-6);

        let artifact_root =
            private_root.join("private-artifacts/validation/negative-lab-crosstalk-real-raw");
        fs::create_dir_all(&artifact_root).expect("create private proof directory");
        let output_path = artifact_root.join("alaska-negative-lab-crosstalk-Positive.jpg");
        let mut encoded = Cursor::new(Vec::new());
        transformed
            .rendered_preview
            .to_rgb8()
            .write_with_encoder(JpegEncoder::new_with_quality(
                &mut encoded,
                JPEG_PROOF_QUALITY,
            ))
            .expect("encode crosstalk positive");
        fs::write(&output_path, encoded.into_inner()).expect("write crosstalk positive");
        let reopened = image::open(&output_path).expect("reopen crosstalk positive");
        assert_eq!(reopened.width(), transformed.rendered_preview.width());
        assert_eq!(reopened.height(), transformed.rendered_preview.height());

        let report = json!({
            "boundsAnalysisIdentity": receipt.bounds_analysis_identity,
            "conditioning": receipt.conditioning,
            "outputDeltaFromIdentity": output_delta,
            "outputHash": sha256_negative_lab_file(&output_path).expect("hash crosstalk positive"),
            "postNeutralError": receipt.post_neutral_error,
            "profileId": receipt.profile_id,
            "proofStatus": "private_raw_crosstalk_preview_and_saved_positive_rendered",
            "sourceHash": sha256_negative_lab_file(&source_path).expect("hash private RAW"),
        });
        fs::write(
            artifact_root.join("alaska-negative-lab-crosstalk-report.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .expect("write crosstalk private RAW report");
    }

    fn sha256_negative_lab_file(path: &Path) -> Result<String, String> {
        let bytes =
            fs::read(path).map_err(|error| format!("read {}: {}", path.display(), error))?;
        Ok(format!("sha256:{}", hex::encode(Sha256::digest(&bytes))))
    }

    #[test]
    fn dry_run_preview_artifact_uses_rendered_rgb_hash_and_dimensions() {
        let rendered_preview = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(2, 1, vec![0.12, 0.34, 0.56, 0.78, 0.52, 0.21]).unwrap(),
        );
        let summary = build_negative_lab_runtime_base_fog_sample_summary(&rendered_preview, None);
        let density_metrics = NegativeLabDensityNormalizationMetrics {
            axis_bounds: NegativeLabDensityNormalizationAxisBounds {
                color: NegativeLabDensityAxisBoundsSummary {
                    min: -0.12,
                    max: 0.12,
                },
                luma: NegativeLabDensityAxisBoundsSummary {
                    min: -0.03,
                    max: 1.02,
                },
            },
            bounds_receipt: fixture_density_metrics().bounds_receipt,
            channel_bounds: NegativeLabDensityNormalizationChannelBounds {
                r: NegativeLabDensityChannelBoundsSummary { min: 0.0, max: 1.0 },
                g: NegativeLabDensityChannelBoundsSummary { min: 0.0, max: 1.0 },
                b: NegativeLabDensityChannelBoundsSummary { min: 0.0, max: 1.0 },
            },
            clipped_pixel_count: 0,
            crosstalk_receipt: None,
            density_range_unclamped: 1.0,
            epsilon_clamped_pixel_count: 0,
            renderer_version: NEGATIVE_LAB_LOG_DENSITY_RENDERER_VERSION,
        };

        let artifact = build_negative_lab_dry_run_preview_artifact(
            &rendered_preview,
            &rendered_preview,
            &rendered_preview,
            summary.clone(),
            density_metrics,
            NegativeLabDetailFinishMetrics::default(),
            apply_color_finish(
                &rendered_preview.to_rgb32f(),
                &NegativeLabScannerColorFinishParams::default(),
                true,
            )
            .metrics,
            NegativeLabOpticalFinishMetrics::default(),
            NegativeLabCmyTimingMetrics::default(),
            NegativeLabNeutralAxisAnalysis::default(),
            measure_auto_meter(
                &[],
                &NegativeLabAutoMeterControls::default(),
                0,
                NegativeLabRenderIntent::Print,
            ),
            &NegativeConversionParams::default(),
            build_negative_lab_density_scopes(&[0.2, 0.3, 0.4], &[0.1, 0.2, 0.3], 0),
        )
        .expect("build preview artifact");
        let rgb8 = rendered_preview.to_rgb8();
        let expected_hash = format!("sha256:{}", hex::encode(Sha256::digest(rgb8.as_raw())));

        assert_eq!(artifact.content_hash, expected_hash);
        assert_eq!(artifact.dimensions.width, 2);
        assert_eq!(artifact.dimensions.height, 1);
        assert_eq!(artifact.renderer, NEGATIVE_LAB_RUNTIME_PREVIEW_RENDERER);
        assert_eq!(artifact.storage, NEGATIVE_LAB_RUNTIME_PREVIEW_STORAGE);
        assert_eq!(
            artifact.preview_output_transform.transform_id,
            "scene_linear_to_srgb_gamma_v1"
        );
        assert_eq!(
            artifact.preview_output_transform.input_color_domain,
            "scene_linear_print_srgb_d65"
        );
        assert_eq!(
            artifact.scene_linear_print.content_hash,
            negative_lab_stage_pixels_hash(&rendered_preview.to_rgb32f())
        );
        assert_eq!(artifact.scene_linear_print.non_finite_count, 0);
        assert_eq!(artifact.stage_artifacts.len(), 2);
        assert_eq!(artifact.stage_artifacts[0].stage_id, "normalized_density");
        assert_eq!(artifact.stage_artifacts[1].stage_id, "scene_linear_print");
        assert_eq!(artifact.stage_artifacts[0].stage_version, 1);
        assert_eq!(artifact.stage_artifacts[1].stage_version, 1);
        assert_eq!(
            artifact.density_normalization_metrics.renderer_version,
            NEGATIVE_LAB_LOG_DENSITY_RENDERER_VERSION
        );
        assert_eq!(
            artifact.artifact_id,
            format!(
                "artifact_negative_lab_runtime_preview_{}",
                &expected_hash.trim_start_matches("sha256:")[..12]
            )
        );
        assert!(
            artifact
                .preview_data_url
                .starts_with("data:image/jpeg;base64,")
        );
        assert_eq!(
            artifact.base_fog_sample_summary.source,
            NEGATIVE_LAB_BASE_FOG_SOURCE_DEFAULT_RECT
        );
        assert!(artifact.base_fog_sample_summary.sample_count > 0);
        assert_eq!(
            artifact.base_fog_sample_summary.sample_rect.width,
            summary.sample_rect.width
        );
    }

    #[test]
    fn scene_linear_output_transform_is_named_and_deterministic() {
        let transform = negative_lab_preview_output_transform();
        assert_eq!(transform.transform_id, "scene_linear_to_srgb_gamma_v1");
        assert_eq!(negative_lab_scene_linear_to_srgb(0.0), 0.0);
        assert_eq!(negative_lab_scene_linear_to_srgb(1.0), 1.0);
        let midpoint = negative_lab_scene_linear_to_srgb(0.25);
        assert!((midpoint - 0.5325).abs() < 0.001);
    }

    #[test]
    fn native_stage_artifacts_share_recipe_and_bounds_identity_but_hash_distinct_domains() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(2, 1, vec![0.12, 0.34, 0.56, 0.78, 0.52, 0.21]).unwrap(),
        );
        let params = NegativeConversionParams::default();
        let pipeline = run_pipeline_with_metrics(&input, &params, None, None);
        let summary = build_negative_lab_runtime_base_fog_sample_summary(&input, None);
        let artifact = build_negative_lab_dry_run_preview_artifact(
            &pipeline.rendered_preview,
            &pipeline.normalized_density_preview,
            &pipeline.scene_linear_print_preview,
            summary,
            pipeline.density_normalization_metrics,
            pipeline.detail_finish_metrics,
            pipeline.color_finish_metrics,
            pipeline.optical_finish_metrics,
            pipeline.cmy_timing_metrics,
            pipeline.neutral_axis_analysis,
            pipeline.auto_meter,
            &params,
            pipeline.density_scopes,
        )
        .expect("build native stage artifacts");

        let normalized = &artifact.stage_artifacts[0];
        let scene_linear = &artifact.stage_artifacts[1];
        assert_eq!(normalized.color_domain, "normalized_density");
        assert_eq!(scene_linear.color_domain, "scene_linear_print");
        assert_ne!(normalized.content_hash, scene_linear.content_hash);
        assert_eq!(normalized.recipe_hash, scene_linear.recipe_hash);
        assert_eq!(
            normalized.bounds_receipt.schema_version,
            scene_linear.bounds_receipt.schema_version
        );
        assert!(
            normalized
                .preview_data_url
                .starts_with("data:image/jpeg;base64,")
        );
        assert!(
            scene_linear
                .preview_data_url
                .starts_with("data:image/jpeg;base64,")
        );
    }

    #[test]
    fn runtime_base_fog_sample_summary_preserves_requested_rect_and_warning_codes() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                4,
                1,
                vec![
                    1.0, 0.82, 0.45, 0.99, 0.80, 0.44, 0.18, 0.12, 0.09, 0.16, 0.11, 0.08,
                ],
            )
            .unwrap(),
        );
        let sample_rect = NegativeBaseFogSampleRect {
            x: 0.0,
            y: 0.0,
            width: 0.5,
            height: 1.0,
        };

        let summary = build_negative_lab_runtime_base_fog_sample_summary(&input, Some(sample_rect));

        assert_eq!(summary.sample_rect.x, sample_rect.x);
        assert_eq!(summary.sample_rect.width, sample_rect.width);
        assert_eq!(summary.source, NEGATIVE_LAB_BASE_FOG_SOURCE_REQUESTED_RECT);
        assert!(summary.sample_count >= 2);
        assert!(
            summary
                .warning_codes
                .contains(&NEGATIVE_LAB_BASE_FOG_WARNING_CLIPPED_CHANNEL.to_string())
        );
        assert!(summary.confidence >= 0.0 && summary.confidence <= 1.0);
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
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.0,
            contrast: 1.0,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
        };
        let sampled_params = NegativeConversionParams {
            red_weight: sampled_estimate.red_weight,
            green_weight: sampled_estimate.green_weight,
            blue_weight: sampled_estimate.blue_weight,
            base_fog_strength: 1.0,
            base_fog_sample: Some(sample_rect),
            conversion_model: NegativeConversionModel::DensityRgbV1,
            exposure: 0.0,
            contrast: 1.0,
            black_point: 0.0,
            white_point: 1.0,
            ..NegativeConversionParams::default()
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

    #[test]
    fn robust_bounds_reject_isolated_dust_better_than_naive_percentiles() {
        let width = 120_usize;
        let height = 120_usize;
        let mut clean = Vec::with_capacity(width * height * 3);
        for y in 0..height {
            let density = 0.12 + 1.4 * y as f32 / (height - 1) as f32;
            for _ in 0..width {
                clean.extend_from_slice(&[density + 0.04, density, density - 0.03]);
            }
        }
        let mut dusty = clean.clone();
        for grid_y in 0..12 {
            for grid_x in 0..12 {
                let pixel_index = ((grid_y * 10) * width + grid_x * 10) * 3;
                dusty[pixel_index..pixel_index + 3].copy_from_slice(&[4.0, 4.0, 4.0]);
            }
        }
        let params = NegativeConversionParams {
            analysis_buffer: 0.0,
            ..NegativeConversionParams::default()
        };
        let clean_bounds = analyze_robust_density_bounds(&clean, width, height, &params);
        let dusty_bounds = analyze_robust_density_bounds(&dusty, width, height, &params);
        let naive_clean = percentile_bounds(
            clean
                .chunks_exact(3)
                .map(|pixel| density_luma([pixel[0], pixel[1], pixel[2]]))
                .collect(),
            0.001,
        );
        let naive_dusty = percentile_bounds(
            dusty
                .chunks_exact(3)
                .map(|pixel| density_luma([pixel[0], pixel[1], pixel[2]]))
                .collect(),
            0.001,
        );

        assert!((clean_bounds.luma_bounds.max - dusty_bounds.luma_bounds.max).abs() < 0.0001);
        assert!((clean_bounds.luma_bounds.min - dusty_bounds.luma_bounds.min).abs() < 0.0001);
        assert!((naive_clean.max - naive_dusty.max).abs() > 1.0);
    }

    #[test]
    fn luma_and_color_clips_drive_independent_density_bounds() {
        let width = 120_usize;
        let height = 120_usize;
        let mut density = Vec::with_capacity(width * height * 3);
        for y in 0..height {
            let luma = 0.1 + 1.6 * y as f32 / (height - 1) as f32;
            for x in 0..width {
                let color = -0.24 + 0.48 * x as f32 / (width - 1) as f32;
                density.extend_from_slice(&[luma + color, luma - color * 0.2, luma - color * 0.65]);
            }
        }
        let baseline = analyze_robust_density_bounds(
            &density,
            width,
            height,
            &NegativeConversionParams {
                analysis_buffer: 0.0,
                color_range_clip: 0.02,
                luma_range_clip: 0.08,
                ..NegativeConversionParams::default()
            },
        );
        let color_clipped = analyze_robust_density_bounds(
            &density,
            width,
            height,
            &NegativeConversionParams {
                analysis_buffer: 0.0,
                color_range_clip: 0.25,
                luma_range_clip: 0.08,
                ..NegativeConversionParams::default()
            },
        );
        let luma_clipped = analyze_robust_density_bounds(
            &density,
            width,
            height,
            &NegativeConversionParams {
                analysis_buffer: 0.0,
                color_range_clip: 0.02,
                luma_range_clip: 0.2,
                ..NegativeConversionParams::default()
            },
        );

        assert!((baseline.luma_bounds.min - color_clipped.luma_bounds.min).abs() < 0.000001);
        assert!((baseline.luma_bounds.max - color_clipped.luma_bounds.max).abs() < 0.000001);
        let probe = [1.5, 0.75, 0.35];
        let baseline_probe = normalize_density_with_robust_bounds(probe, &baseline);
        let color_clipped_probe = normalize_density_with_robust_bounds(probe, &color_clipped);
        assert!(
            baseline_probe
                .iter()
                .zip(color_clipped_probe)
                .any(|(baseline, clipped)| (baseline - clipped).abs() > 0.001)
        );
        assert!((density_luma(baseline_probe) - density_luma(color_clipped_probe)).abs() < 0.00001);
        assert!(
            baseline.receipt.final_bounds.axis_bounds.color.max
                - baseline.receipt.final_bounds.axis_bounds.color.min
                > color_clipped.receipt.final_bounds.axis_bounds.color.max
                    - color_clipped.receipt.final_bounds.axis_bounds.color.min
        );
        assert!(
            baseline.luma_bounds.max - baseline.luma_bounds.min
                > luma_clipped.luma_bounds.max - luma_clipped.luma_bounds.min
        );
    }

    fn crosstalk_profile(matrix: [[f32; 3]; 3], strength: f32) -> serde_json::Value {
        serde_json::json!({
            "matrix": matrix,
            "profileId": "negative_lab.crosstalk.user.native_test.v1",
            "provenance": "user_owned",
            "provenanceHash": "fnv1a32:1234abcd",
            "schemaVersion": 1,
            "strength": strength,
        })
    }

    #[test]
    fn negative_lab_crosstalk_strength_zero_is_identity() {
        let profile = crosstalk_profile([[0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8]], 0.0);
        let receipt = resolve_negative_lab_crosstalk(Some(&profile))
            .unwrap()
            .unwrap();
        assert_eq!(receipt.applied_matrix, IDENTITY_CROSSTALK_MATRIX);
        assert_eq!(
            apply_negative_lab_crosstalk_density([0.2, 0.6, 1.1], &receipt),
            [0.2, 0.6, 1.1]
        );
    }

    #[test]
    fn negative_lab_crosstalk_preserves_neutral_and_changes_colored_density() {
        let profile = crosstalk_profile(
            [
                [1.08, -0.06, -0.02],
                [-0.03, 1.07, -0.04],
                [-0.02, -0.08, 1.10],
            ],
            1.0,
        );
        let receipt = resolve_negative_lab_crosstalk(Some(&profile))
            .unwrap()
            .unwrap();
        let neutral = apply_negative_lab_crosstalk_density([0.7, 0.7, 0.7], &receipt);
        assert!(neutral.iter().all(|channel| (channel - 0.7).abs() < 1.0e-6));
        assert!(
            receipt
                .row_sums
                .iter()
                .all(|sum| (sum - 1.0).abs() < 1.0e-6)
        );
        let colored = apply_negative_lab_crosstalk_density([0.2, 0.6, 1.1], &receipt);
        assert!(
            colored
                .iter()
                .zip([0.2, 0.6, 1.1])
                .any(|(actual, original)| (actual - original).abs() > 0.01)
        );
    }

    #[test]
    fn negative_lab_detail_finish_changes_native_render_and_disabled_path_is_identity() {
        let input = DynamicImage::ImageRgb32F(Rgb32FImage::from_fn(16, 16, |x, y| {
            let value = if x < 8 {
                0.25 + y as f32 * 0.002
            } else {
                0.62 + y as f32 * 0.002
            };
            image::Rgb([value, value * 0.82, value * 0.64])
        }));
        let disabled = NegativeConversionParams::default();
        let enabled = NegativeConversionParams {
            detail_finish: NegativeLabDetailFinishParams {
                enabled: true,
                local_contrast_amount: 0.5,
                sharpening_amount: 0.65,
                ..Default::default()
            },
            ..disabled.clone()
        };
        let baseline = run_pipeline_with_metrics(&input, &disabled, None, None);
        let identity = run_pipeline_with_metrics(&input, &disabled, None, None);
        let finished = run_pipeline_with_metrics(&input, &enabled, None, None);
        assert_eq!(
            baseline.rendered_preview.to_rgb8(),
            identity.rendered_preview.to_rgb8()
        );
        assert_ne!(
            baseline.scene_linear_print_preview.to_rgb32f().as_raw(),
            finished.scene_linear_print_preview.to_rgb32f().as_raw()
        );
        assert!(finished.detail_finish_metrics.changed_pixel_ratio > 0.0);
        assert!(finished.detail_finish_metrics.chroma_drift_max < 1.0e-4);
    }

    #[test]
    fn negative_lab_crosstalk_changes_rendered_pixels_and_reports_post_transform_bounds() {
        let mut pixels = Vec::with_capacity(12 * 12 * 3);
        for y in 0..12 {
            for x in 0..12 {
                let density = 0.08 + (x + y) as f32 / 18.0;
                pixels.extend_from_slice(&[
                    10.0_f32.powf(-(density * 0.72)),
                    10.0_f32.powf(-(density * 1.05)),
                    10.0_f32.powf(-(density * 1.38)),
                ]);
            }
        }
        let input = DynamicImage::ImageRgb32F(Rgb32FImage::from_vec(12, 12, pixels).unwrap());
        let params = NegativeConversionParams::default();
        let profile = crosstalk_profile(
            [
                [1.08, -0.06, -0.02],
                [-0.03, 1.07, -0.04],
                [-0.02, -0.08, 1.1],
            ],
            0.35,
        );
        let identity = run_pipeline_with_metrics(&input, &params, None, None);
        let transformed = run_pipeline_with_metrics(&input, &params, None, Some(&profile));

        assert_ne!(
            identity.rendered_preview.to_rgb8().as_raw(),
            transformed.rendered_preview.to_rgb8().as_raw()
        );
        let receipt = transformed
            .density_normalization_metrics
            .crosstalk_receipt
            .unwrap();
        assert_eq!(
            receipt.bounds_analysis_identity,
            "post_crosstalk_density:fixed_grid_block_median_luma_color_v1"
        );
        assert!(receipt.post_neutral_error < 1.0e-6);
    }

    #[test]
    fn negative_lab_crosstalk_rejects_singular_matrices() {
        let singular = crosstalk_profile([[1.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]], 1.0);
        assert!(resolve_negative_lab_crosstalk(Some(&singular)).is_err());
    }

    #[test]
    fn native_density_scopes_are_bounded_and_derived_from_render_buffers() {
        let scopes = build_negative_lab_density_scopes(
            &[0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
            &[0.0, 0.1, 0.2, 0.8, 0.9, 1.0],
            2,
        );
        assert_eq!(scopes.algorithm_id, "native_negative_lab_density_scopes_v1");
        assert_eq!(scopes.schema_version, 1);
        assert_eq!(
            scopes.density_histogram.bins.len(),
            NEGATIVE_LAB_SCOPE_HISTOGRAM_BINS
        );
        assert_eq!(
            scopes.output_luma_histogram.bins.len(),
            NEGATIVE_LAB_SCOPE_HISTOGRAM_BINS
        );
        assert_eq!(scopes.h_and_d_curve.len(), NEGATIVE_LAB_SCOPE_CURVE_SAMPLES);
        assert_eq!(scopes.sample_count, 2);
        assert_eq!(scopes.clipped_pixel_count, 2);
        assert_eq!(scopes.gamut_out_of_range_pixel_count, 0);
        assert_eq!(scopes.h_and_d_curve[0].input_density, 0.2);
        assert!((scopes.h_and_d_curve[0].output_luma - 0.08596).abs() < 0.001);
        assert_eq!(scopes.h_and_d_curve[16].input_density, 0.5);
        assert!((scopes.h_and_d_curve[16].output_luma - 0.88596).abs() < 0.001);
        assert!(
            scopes
                .h_and_d_curve
                .windows(2)
                .all(|points| points[0].input_density <= points[1].input_density)
        );
    }

    #[test]
    fn flat_log_master_is_positive_linear_and_bypasses_print_finish() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                3,
                1,
                vec![0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.64, 0.72, 0.8],
            )
            .unwrap(),
        );
        let print =
            run_pipeline_with_metrics(&input, &NegativeConversionParams::default(), None, None);
        let flat_params = NegativeConversionParams {
            render_intent: NegativeLabRenderIntent::FlatLogMaster,
            flat_log_master: NegativeLabFlatLogMasterParams {
                lift: 0.1,
                gain: 0.8,
                algorithm_version: 1,
            },
            ..NegativeConversionParams::default()
        };
        let flat = run_pipeline_with_metrics(&input, &flat_params, None, None);
        assert_ne!(
            print.rendered_preview.to_rgb8().as_raw(),
            flat.rendered_preview.to_rgb8().as_raw()
        );
        assert_eq!(
            flat.detail_finish_metrics,
            NegativeLabDetailFinishMetrics::default()
        );
        let scene = flat.scene_linear_print_preview.to_rgb32f();
        assert!(
            scene
                .as_raw()
                .iter()
                .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
        );
        assert!(
            scene
                .as_raw()
                .iter()
                .zip(flat.rendered_preview.to_rgb32f().as_raw())
                .any(|(linear, display)| { (*linear - *display).abs() > 0.001 })
        );
    }

    #[test]
    fn flat_log_master_rejects_jpeg_output() {
        assert!(
            validate_render_intent_output_format(
                NegativeLabRenderIntent::FlatLogMaster,
                NegativeConversionOutputFormat::JpegProof,
            )
            .is_err()
        );
        assert!(
            validate_render_intent_output_format(
                NegativeLabRenderIntent::FlatLogMaster,
                NegativeConversionOutputFormat::Tiff16,
            )
            .is_ok()
        );
        assert!(
            validate_render_intent_output_format(
                NegativeLabRenderIntent::Print,
                NegativeConversionOutputFormat::JpegProof,
            )
            .is_ok()
        );
    }

    #[test]
    fn negative_lab_bw_process_constructs_one_neutral_density_signal() {
        let input = DynamicImage::ImageRgb32F(
            Rgb32FImage::from_vec(
                3,
                1,
                vec![0.04, 0.12, 0.3, 0.2, 0.45, 0.08, 0.72, 0.18, 0.36],
            )
            .unwrap(),
        );
        let params = NegativeConversionParams {
            process_family: NegativeLabProcessFamily::BlackAndWhiteSilverNegative,
            red_weight: 0.8,
            green_weight: 1.2,
            blue_weight: 0.9,
            color_finish: NegativeLabScannerColorFinishParams {
                enabled: true,
                ..NegativeLabScannerColorFinishParams::default()
            },
            ..NegativeConversionParams::default()
        };
        let render = run_pipeline_with_metrics(&input, &params, None, None);
        let scene = render.scene_linear_print_preview.to_rgb32f();
        for pixel in scene.pixels() {
            assert!((pixel[0] - pixel[1]).abs() <= 1.0e-6);
            assert!((pixel[1] - pixel[2]).abs() <= 1.0e-6);
            assert!(pixel.0.iter().all(|value| value.is_finite()));
        }
        let warnings = &render
            .density_normalization_metrics
            .bounds_receipt
            .warning_codes;
        assert!(
            warnings
                .iter()
                .any(|code| code == "bw_silver_disables_color_timing")
        );
        assert!(
            warnings
                .iter()
                .any(|code| code == "bw_silver_disables_scanner_finish")
        );
        let color =
            run_pipeline_with_metrics(&input, &NegativeConversionParams::default(), None, None);
        assert_ne!(
            scene.as_raw(),
            color.scene_linear_print_preview.to_rgb32f().as_raw()
        );
    }
}
