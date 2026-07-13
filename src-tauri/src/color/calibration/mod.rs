mod catalog;
mod dcp;
mod sampling;
mod solver;
pub(crate) mod workflow;

pub(crate) use catalog::{ChartDefinition, chart_definition};
pub(crate) use sampling::sample_chart;
pub(crate) use solver::fit_calibration;

use serde::{Deserialize, Serialize};

pub(crate) const CALIBRATION_CONTRACT: &str = "rapidraw.chart_calibration.v1";
pub(crate) const CALIBRATION_SOLVER_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NormalizedPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartGeometry {
    /// top-left, top-right, bottom-right, bottom-left in uncropped source space
    pub corners: [NormalizedPoint; 4],
    pub mirrored: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PatchRole {
    Neutral,
    Skin,
    Chromatic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartSample {
    pub patch_id: String,
    pub role: PatchRole,
    pub camera_rgb_mean: [f64; 3],
    pub camera_rgb_median: [f64; 3],
    pub covariance: [[f64; 3]; 3],
    pub clipped_fraction: f64,
    pub valid_fraction: f64,
    pub spatial_gradient: f64,
    pub sharpness: f64,
    pub sample_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureQualityReceipt {
    pub chart_area_fraction: f64,
    pub minimum_patch_area_pixels: f64,
    pub maximum_clipped_fraction: f64,
    pub maximum_spatial_gradient: f64,
    pub minimum_patch_sharpness: f64,
    pub warning_codes: Vec<String>,
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartSamplingReceipt {
    pub contract: String,
    pub chart_id: String,
    pub chart_version: u32,
    pub source_revision: String,
    pub camera_identity: String,
    pub input_domain: String,
    pub geometry: ChartGeometry,
    pub samples: Vec<ChartSample>,
    pub capture_quality: CaptureQualityReceipt,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IlluminantCoordinates {
    pub x: f64,
    pub y: f64,
    pub cct_kelvin: Option<f64>,
    pub duv: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CalibrationQualityStatus {
    Excellent,
    Acceptable,
    WarningPublishable,
    FailedCaptureQuality,
    FailedSolver,
    FailedValidationOverfit,
}

impl CalibrationQualityStatus {
    pub(crate) fn publishable(self) -> bool {
        matches!(
            self,
            Self::Excellent | Self::Acceptable | Self::WarningPublishable
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColorErrorMetrics {
    pub mean_delta_e00: f64,
    pub median_delta_e00: f64,
    pub p95_delta_e00: f64,
    pub max_delta_e00: f64,
    pub neutral_axis_error: f64,
    pub skin_mean_delta_e00: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalibrationFitReceipt {
    pub contract: String,
    pub implementation_version: u32,
    pub camera_identity: String,
    pub source_revision: String,
    pub raw_processing_profile: String,
    pub chart_id: String,
    pub chart_version: u32,
    pub chart_reference_illuminant: String,
    pub chart_observer: String,
    pub chart_provenance: String,
    pub chart_license: String,
    pub chart_source_url: String,
    pub illuminant: IlluminantCoordinates,
    pub adaptation: String,
    pub train_patch_ids: Vec<String>,
    pub validation_patch_ids: Vec<String>,
    /// camera-linear RGB to XYZ under the declared chart illuminant
    pub camera_to_xyz: [[f64; 3]; 3],
    pub condition_number: f64,
    pub rejected_patch_ids: Vec<String>,
    pub train_metrics: ColorErrorMetrics,
    pub validation_metrics: ColorErrorMetrics,
    pub residual_model_accepted: bool,
    pub quality_status: CalibrationQualityStatus,
    pub warning_codes: Vec<String>,
    pub solver_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FitCalibrationInput {
    pub sampling: ChartSamplingReceipt,
    pub illuminant: IlluminantCoordinates,
    pub profile_name: String,
    pub publish: bool,
    pub confirm_warning: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalibrationJobResult {
    pub receipt: CalibrationFitReceipt,
    pub published_profile_id: Option<String>,
}
