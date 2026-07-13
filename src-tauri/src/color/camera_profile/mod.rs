mod dcp_parse;
pub(crate) mod execute;
pub(crate) mod registry;

pub(crate) use dcp_parse::{DcpParseLimits, parse_dcp};

use serde::{Deserialize, Serialize};

pub(crate) const CAMERA_PROFILE_CONTRACT: &str = "rapidraw.camera_profile.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProfileTableEncoding {
    Linear,
    Srgb,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub(crate) struct HsvDelta {
    pub hue_shift_degrees: f32,
    pub saturation_scale: f32,
    pub value_scale: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct ProfileTable {
    pub dimensions: [usize; 3],
    pub encoding: ProfileTableEncoding,
    pub entries: Vec<HsvDelta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct ToneCurvePoint {
    pub input: f32,
    pub output: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct DcpProfileV1 {
    pub name: String,
    pub camera_model: Option<String>,
    pub calibration_illuminants: [Option<u16>; 2],
    pub color_matrices: [Option<[[f64; 3]; 3]>; 2],
    pub camera_calibrations: [Option<[[f64; 3]; 3]>; 2],
    pub reduction_matrices: [Option<[[f64; 3]; 3]>; 2],
    pub analog_balance: [f64; 3],
    pub forward_matrices: [Option<[[f64; 3]; 3]>; 2],
    pub hue_sat_maps: [Option<ProfileTable>; 2],
    pub look_table: Option<ProfileTable>,
    pub tone_curve: Vec<ToneCurvePoint>,
    pub baseline_exposure_ev: f32,
    pub default_black_render: Option<u32>,
    pub calibration_signature: Option<String>,
    pub copyright: Option<String>,
    pub embed_policy: Option<u32>,
    pub content_sha256: String,
    pub unsupported_tag_ids: Vec<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CameraProfileSource {
    Embedded,
    Open,
    User,
    Generated,
    MatrixFallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CameraIdentityMatch {
    Exact,
    Unrestricted,
    CompatibleAlias,
    UserForcedCompatible,
    UserForcedUnverified,
    MatrixFallback,
    UnsupportedChannels,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct CameraProfileReceiptV1 {
    pub contract: &'static str,
    pub implementation_version: u32,
    pub profile_name: String,
    pub profile_sha256: String,
    pub source: CameraProfileSource,
    pub camera_match: CameraIdentityMatch,
    pub illuminant_weight: f64,
    pub technical_table_applied: bool,
    pub creative_table_applied: bool,
    pub tone_curve_applied: bool,
    pub creative_amount: f32,
    pub baseline_exposure_ev: f32,
    pub default_black_render: Option<u32>,
    pub embed_policy: Option<u32>,
    pub unsupported_tag_ids: Vec<u16>,
    pub limitation_codes: Vec<&'static str>,
}
