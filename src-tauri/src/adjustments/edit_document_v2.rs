use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::tone::curves::{CurveChannelMode, CurvePoint, compile_scene_curve};
use crate::tone::output_curves::{OutputCurvePoint, OutputCurveTargetV1, compile_output_curve};

const EDIT_DOCUMENT_V2_SCHEMA_VERSION: u8 = 2;
const LEGACY_SOURCE_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
enum EditNodeTypeV2 {
    SceneGlobalColorTone,
    SceneCurve,
    ToneEqualizer,
    DisplayCreative,
    DetailDenoiseDehaze,
    PointColor,
    CameraInput,
    Geometry,
    Layers,
    SourceArtifacts,
}

impl EditNodeTypeV2 {
    fn contract(self) -> (&'static str, &'static str, u32) {
        match self {
            Self::Geometry => ("geometry", "legacy_pipeline_v1", 1),
            Self::SceneGlobalColorTone => ("scene_global_color_tone", "scene_referred_v2", 1),
            Self::SceneCurve => ("scene_curve", "scene_referred_v2", 1),
            Self::ToneEqualizer => ("tone_equalizer", "scene_referred_v2", 1),
            Self::DisplayCreative => ("display_creative", "scene_referred_v2", 1),
            Self::DetailDenoiseDehaze => ("detail_denoise_dehaze", "scene_referred_v2", 1),
            Self::PointColor => ("point_color", "scene_referred_v2", 1),
            Self::CameraInput => ("camera_input", "scene_referred_v2", 1),
            Self::Layers => ("layers", "scene_referred_v2", 1),
            Self::SourceArtifacts => ("source_artifacts", "scene_referred_v2", 1),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditNodeEnvelopeV2 {
    enabled: bool,
    implementation_version: u32,
    params: Map<String, Value>,
    process: String,
    #[serde(rename = "type")]
    node_type: EditNodeTypeV2,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneGlobalColorToneParamsV2 {
    blacks: f64,
    brightness: f64,
    contrast: f64,
    exposure: f64,
    highlights: f64,
    saturation: f64,
    shadows: f64,
    whites: f64,
}

impl SceneGlobalColorToneParamsV2 {
    fn compile(&self) -> Result<(), String> {
        validate_scene_tone_parameter("blacks", self.blacks, -100.0, 100.0)?;
        validate_scene_tone_parameter("brightness", self.brightness, -5.0, 5.0)?;
        validate_scene_tone_parameter("contrast", self.contrast, -100.0, 100.0)?;
        validate_scene_tone_parameter("exposure", self.exposure, -5.0, 5.0)?;
        validate_scene_tone_parameter("highlights", self.highlights, -100.0, 100.0)?;
        validate_scene_tone_parameter("saturation", self.saturation, -100.0, 100.0)?;
        validate_scene_tone_parameter("shadows", self.shadows, -100.0, 100.0)?;
        validate_scene_tone_parameter("whites", self.whites, -100.0, 100.0)?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
enum GeometryCropUnitV2 {
    #[serde(rename = "%")]
    Percent,
    #[serde(rename = "normalized")]
    Normalized,
    #[serde(rename = "px")]
    Pixels,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeometryCropV2 {
    height: f64,
    unit: GeometryCropUnitV2,
    width: f64,
    x: f64,
    y: f64,
}

impl GeometryCropV2 {
    fn validate(&self) -> Result<(), String> {
        if !self.height.is_finite()
            || !self.width.is_finite()
            || !self.x.is_finite()
            || !self.y.is_finite()
            || self.height <= 0.0
            || self.width <= 0.0
            || self.x < 0.0
            || self.y < 0.0
        {
            return Err(
                "EditDocumentV2 geometry crop coordinates must be finite and positive within the source"
                    .to_string(),
            );
        }
        let maximum = match self.unit {
            GeometryCropUnitV2::Percent => Some(100.0),
            GeometryCropUnitV2::Normalized => Some(1.0),
            GeometryCropUnitV2::Pixels => None,
        };
        if maximum.is_some_and(|limit| self.x + self.width > limit || self.y + self.height > limit)
        {
            return Err("EditDocumentV2 geometry crop exceeds its unit bounds".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeometryV2 {
    aspect_ratio: Option<f64>,
    crop: Option<GeometryCropV2>,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    rotation: f64,
}

impl GeometryV2 {
    fn validate(&self) -> Result<(), String> {
        if self
            .aspect_ratio
            .is_some_and(|ratio| !ratio.is_finite() || ratio <= 0.0)
        {
            return Err(
                "EditDocumentV2 geometry aspectRatio must be finite and positive".to_string(),
            );
        }
        if self.orientation_steps > 3 {
            return Err(
                "EditDocumentV2 geometry orientationSteps must be within 0..=3".to_string(),
            );
        }
        if !self.rotation.is_finite() || !(-45.0..=45.0).contains(&self.rotation) {
            return Err("EditDocumentV2 geometry rotation must be within -45..=45".to_string());
        }
        if let Some(crop) = &self.crop {
            crop.validate()?;
        }
        Ok(())
    }
}

fn validate_scene_tone_parameter(
    field: &str,
    value: f64,
    minimum: f64,
    maximum: f64,
) -> Result<(), String> {
    if value.is_finite() && value >= minimum && value <= maximum {
        return Ok(());
    }
    Err(format!(
        "EditDocumentV2 node 'scene_global_color_tone' field '{field}' must be finite and within [{minimum}, {maximum}]"
    ))
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DetailDenoiseDehazeV2 {
    clarity: f64,
    color_noise_reduction: f64,
    dehaze: f64,
    denoise_contrast_protection: f64,
    denoise_detail: f64,
    denoise_natural_grain: f64,
    denoise_shadow_bias: f64,
    luma_noise_reduction: f64,
    sharpness: f64,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToneEqualizerSettingsV1 {
    auto_placement: bool,
    band_ev: [f64; 9],
    detail_preservation: f64,
    edge_refinement: f64,
    enabled: bool,
    mask_exposure_compensation: f64,
    pivot_ev: f64,
    preview_mode: u8,
    range_ev: f64,
    selected_band: u8,
    smoothing_radius: f64,
}

impl ToneEqualizerSettingsV1 {
    fn validate(&self) -> Result<(), String> {
        for (field, value, minimum, maximum) in [
            ("detailPreservation", self.detail_preservation, 0.0, 1.0),
            ("edgeRefinement", self.edge_refinement, 0.0, 8.0),
            (
                "maskExposureCompensation",
                self.mask_exposure_compensation,
                -4.0,
                4.0,
            ),
            ("pivotEv", self.pivot_ev, -8.0, 8.0),
            ("rangeEv", self.range_ev, 4.0, 24.0),
            ("smoothingRadius", self.smoothing_radius, 4.0, 64.0),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 tone_equalizer field '{field}' must be finite and within [{minimum}, {maximum}]"
                ));
            }
        }
        if self
            .band_ev
            .iter()
            .any(|value| !value.is_finite() || !(-4.0..=4.0).contains(value))
        {
            return Err(
                "EditDocumentV2 tone_equalizer bandEv values must be finite and within [-4, 4]"
                    .to_string(),
            );
        }
        if self.preview_mode > 4 {
            return Err(
                "EditDocumentV2 tone_equalizer previewMode must be within 0..=4".to_string(),
            );
        }
        if self.selected_band > 8 {
            return Err(
                "EditDocumentV2 tone_equalizer selectedBand must be within 0..=8".to_string(),
            );
        }
        let _ = (self.auto_placement, self.enabled);
        Ok(())
    }
}

fn point_color_in_range(value: f64, minimum: f64, maximum: f64) -> bool {
    value.is_finite() && (minimum..=maximum).contains(&value)
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PointColorCoordinateV1 {
    chroma: f64,
    hue_degrees: f64,
    lightness: f64,
}

impl PointColorCoordinateV1 {
    fn validate(&self) -> Result<(), String> {
        if point_color_in_range(self.chroma, 0.0, 2.0)
            && point_color_in_range(self.hue_degrees, 0.0, 360.0)
            && point_color_in_range(self.lightness, -1.0, 4.0)
        {
            return Ok(());
        }
        Err("EditDocumentV2 point_color coordinate is out of range".to_string())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PointColorSampleV1 {
    confidence: f64,
    graph_revision: String,
    id: String,
    sample_radius_px: f64,
    source_color: PointColorCoordinateV1,
    source_scene_revision: String,
}

impl PointColorSampleV1 {
    fn validate(&self) -> Result<(), String> {
        if !point_color_in_range(self.confidence, 0.0, 1.0)
            || !point_color_in_range(self.sample_radius_px, 1.0, 128.0)
            || self.graph_revision.is_empty()
            || self.id.is_empty()
            || self.source_scene_revision.is_empty()
        {
            return Err("EditDocumentV2 point_color sample is invalid".to_string());
        }
        self.source_color.validate()
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PointColorAdjustmentV1 {
    chroma_radius: f64,
    chroma_shift: f64,
    enabled: bool,
    feather: f64,
    hue_radius_degrees: f64,
    hue_shift_degrees: f64,
    id: String,
    lightness_radius: f64,
    lightness_shift: f64,
    name: String,
    opacity: f64,
    samples: Vec<PointColorSampleV1>,
    saturation_shift: f64,
    variance: f64,
}

impl PointColorAdjustmentV1 {
    fn validate(&self) -> Result<(), String> {
        for (field, value, minimum, maximum) in [
            ("chromaRadius", self.chroma_radius, 0.001, 1.0),
            ("chromaShift", self.chroma_shift, -1.0, 1.0),
            ("feather", self.feather, 0.0, 1.0),
            ("hueRadiusDegrees", self.hue_radius_degrees, 0.1, 180.0),
            ("hueShiftDegrees", self.hue_shift_degrees, -180.0, 180.0),
            ("lightnessRadius", self.lightness_radius, 0.001, 2.0),
            ("lightnessShift", self.lightness_shift, -1.0, 1.0),
            ("opacity", self.opacity, 0.0, 1.0),
            ("saturationShift", self.saturation_shift, -1.0, 4.0),
            ("variance", self.variance, 0.25, 4.0),
        ] {
            if !point_color_in_range(value, minimum, maximum) {
                return Err(format!(
                    "EditDocumentV2 point_color field '{field}' must be finite and within [{minimum}, {maximum}]"
                ));
            }
        }
        if self.id.is_empty()
            || self.name.is_empty()
            || self.name.chars().count() > 80
            || !(1..=8).contains(&self.samples.len())
        {
            return Err(
                "EditDocumentV2 point_color adjustment identity or samples are invalid".to_string(),
            );
        }
        for sample in &self.samples {
            sample.validate()?;
        }
        let _ = self.enabled;
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToneEqualizerV2 {
    tone_equalizer: ToneEqualizerSettingsV1,
}

impl ToneEqualizerV2 {
    fn validate(&self) -> Result<(), String> {
        self.tone_equalizer.validate()
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PointColorSkinUniformityV1 {
    chroma_uniformity: f64,
    enabled: bool,
    hue_uniformity: f64,
    lightness_uniformity: f64,
    preserve_extremes: f64,
    range: Option<PointColorAdjustmentV1>,
    target: Option<PointColorCoordinateV1>,
}

impl PointColorSkinUniformityV1 {
    fn validate(&self) -> Result<(), String> {
        for value in [
            self.chroma_uniformity,
            self.hue_uniformity,
            self.lightness_uniformity,
            self.preserve_extremes,
        ] {
            if !point_color_in_range(value, 0.0, 1.0) {
                return Err(
                    "EditDocumentV2 point_color skin uniformity is out of range".to_string()
                );
            }
        }
        if let Some(range) = &self.range {
            range.validate()?;
        }
        if let Some(target) = &self.target {
            target.validate()?;
        }
        let _ = self.enabled;
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum PointColorVisualizeModeV1 {
    Image,
    Range,
    Solo,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PointColorPlanV1 {
    enabled: bool,
    points: Vec<PointColorAdjustmentV1>,
    process: String,
    selected_point_id: Option<String>,
    skin_uniformity: PointColorSkinUniformityV1,
    visualize_mode: PointColorVisualizeModeV1,
}

impl PointColorPlanV1 {
    fn validate(&self) -> Result<(), String> {
        if self.process != "rawengine.point-color.oklab-ap1.v1" || self.points.len() > 16 {
            return Err("EditDocumentV2 point_color process or point count is invalid".to_string());
        }
        for point in &self.points {
            point.validate()?;
        }
        self.skin_uniformity.validate()?;
        let _ = (self.enabled, &self.selected_point_id, &self.visualize_mode);
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PointColorV2 {
    point_color: PointColorPlanV1,
}

impl PointColorV2 {
    fn validate(&self) -> Result<(), String> {
        self.point_color.validate()
    }
}

impl DetailDenoiseDehazeV2 {
    fn validate(&self) -> Result<(), String> {
        for (field, value, minimum, maximum) in [
            ("clarity", self.clarity, -100.0, 100.0),
            (
                "colorNoiseReduction",
                self.color_noise_reduction,
                0.0,
                100.0,
            ),
            ("dehaze", self.dehaze, -100.0, 100.0),
            (
                "denoiseContrastProtection",
                self.denoise_contrast_protection,
                0.0,
                100.0,
            ),
            ("denoiseDetail", self.denoise_detail, 0.0, 100.0),
            (
                "denoiseNaturalGrain",
                self.denoise_natural_grain,
                0.0,
                100.0,
            ),
            ("denoiseShadowBias", self.denoise_shadow_bias, -100.0, 100.0),
            ("lumaNoiseReduction", self.luma_noise_reduction, 0.0, 100.0),
            ("sharpness", self.sharpness, -100.0, 100.0),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 detail_denoise_dehaze field '{field}' must be finite and within [{minimum}, {maximum}]"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DisplayCreativeV2 {
    flare_amount: f64,
    glow_amount: f64,
    grain_amount: f64,
    grain_roughness: f64,
    grain_size: f64,
    halation_amount: f64,
    lut_data: Option<String>,
    lut_intensity: f64,
    lut_name: Option<String>,
    lut_path: Option<String>,
    lut_size: u32,
    vignette_amount: f64,
    vignette_feather: f64,
    vignette_midpoint: f64,
    vignette_roundness: f64,
}

impl DisplayCreativeV2 {
    fn validate(&self) -> Result<(), String> {
        for (field, value, minimum, maximum) in [
            ("flareAmount", self.flare_amount, 0.0, 100.0),
            ("glowAmount", self.glow_amount, 0.0, 100.0),
            ("grainAmount", self.grain_amount, 0.0, 100.0),
            ("grainRoughness", self.grain_roughness, 0.0, 100.0),
            ("grainSize", self.grain_size, 0.0, 100.0),
            ("halationAmount", self.halation_amount, 0.0, 100.0),
            ("lutIntensity", self.lut_intensity, 0.0, 100.0),
            ("vignetteAmount", self.vignette_amount, -100.0, 100.0),
            ("vignetteFeather", self.vignette_feather, 0.0, 100.0),
            ("vignetteMidpoint", self.vignette_midpoint, 0.0, 100.0),
            ("vignetteRoundness", self.vignette_roundness, -100.0, 100.0),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 display_creative field '{field}' must be finite and within [{minimum}, {maximum}]"
                ));
            }
        }
        let _ = (
            &self.lut_data,
            &self.lut_name,
            &self.lut_path,
            self.lut_size,
        );
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum SceneCurveModeV2 {
    Point,
    Parametric,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum SceneCurveToneCurveV2 {
    AutoFilmic,
    Linear,
    SoftContrast,
    HighContrast,
    ShadowLift,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurveLegacyPointV2 {
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurveLegacyChannelsV2 {
    blue: Vec<SceneCurveLegacyPointV2>,
    green: Vec<SceneCurveLegacyPointV2>,
    luma: Vec<SceneCurveLegacyPointV2>,
    red: Vec<SceneCurveLegacyPointV2>,
}

impl SceneCurveLegacyChannelsV2 {
    fn validate(&self) -> Result<(), String> {
        for (channel, points) in [
            ("blue", &self.blue),
            ("green", &self.green),
            ("luma", &self.luma),
            ("red", &self.red),
        ] {
            if !(2..=16).contains(&points.len()) {
                return Err(format!(
                    "EditDocumentV2 scene_curve {channel} requires 2..=16 points"
                ));
            }
            if points.iter().any(|point| {
                !point.x.is_finite()
                    || !point.y.is_finite()
                    || !(0.0..=255.0).contains(&point.x)
                    || !(0.0..=255.0).contains(&point.y)
            }) {
                return Err(format!(
                    "EditDocumentV2 scene_curve {channel} points must be finite within 0..=255"
                ));
            }
            if points.windows(2).any(|pair| pair[1].x <= pair[0].x) {
                return Err(format!(
                    "EditDocumentV2 scene_curve {channel} x coordinates must increase"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurveParametricChannelV2 {
    black_level: f64,
    darks: f64,
    highlights: f64,
    lights: f64,
    shadows: f64,
    split1: f64,
    split2: f64,
    split3: f64,
    white_level: f64,
}

impl SceneCurveParametricChannelV2 {
    fn validate(&self) -> Result<(), String> {
        let signed_values = [self.darks, self.highlights, self.lights, self.shadows];
        if signed_values
            .iter()
            .any(|value| !value.is_finite() || !(-100.0..=100.0).contains(value))
            || !self.black_level.is_finite()
            || !(0.0..=100.0).contains(&self.black_level)
            || !self.white_level.is_finite()
            || !(-100.0..=0.0).contains(&self.white_level)
            || !self.split1.is_finite()
            || !self.split2.is_finite()
            || !self.split3.is_finite()
            || !(0.0..=100.0).contains(&self.split1)
            || !(0.0..=100.0).contains(&self.split2)
            || !(0.0..=100.0).contains(&self.split3)
            || !(self.split1 < self.split2 && self.split2 < self.split3)
        {
            return Err("EditDocumentV2 scene_curve parametric channel is invalid".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurveParametricChannelsV2 {
    blue: SceneCurveParametricChannelV2,
    green: SceneCurveParametricChannelV2,
    luma: SceneCurveParametricChannelV2,
    red: SceneCurveParametricChannelV2,
}

impl SceneCurveParametricChannelsV2 {
    fn validate(&self) -> Result<(), String> {
        self.blue.validate()?;
        self.green.validate()?;
        self.luma.validate()?;
        self.red.validate()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum SceneCurveChannelModeV1 {
    LuminancePreserving,
    LinkedRgb,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurvePointV1 {
    x_ev: f32,
    y_ev: f32,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurveSettingsV1 {
    channel_mode: SceneCurveChannelModeV1,
    middle_grey: f32,
    points: Vec<SceneCurvePointV1>,
}

impl SceneCurveSettingsV1 {
    fn validate(&self) -> Result<(), String> {
        let points = self
            .points
            .iter()
            .map(|point| CurvePoint::new(point.x_ev, point.y_ev))
            .collect::<Vec<_>>();
        let channel_mode = match self.channel_mode {
            SceneCurveChannelModeV1::LuminancePreserving => CurveChannelMode::LuminancePreserving,
            SceneCurveChannelModeV1::LinkedRgb => CurveChannelMode::LinkedRgb,
        };
        compile_scene_curve(&points, self.middle_grey, channel_mode)
            .map(|_| ())
            .map_err(|error| {
                format!("EditDocumentV2 scene_curve sceneCurveV1 is invalid: {error:?}")
            })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum OutputCurveDomainV1 {
    ViewEncoded,
    OutputEncoded,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutputCurvePointV1 {
    input: f32,
    output: f32,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutputCurveSettingsV1 {
    domain: OutputCurveDomainV1,
    peak_nits: f32,
    points: Vec<OutputCurvePointV1>,
    sdr_reference_white_nits: f32,
    target_identity: String,
}

impl OutputCurveSettingsV1 {
    fn validate(&self) -> Result<(), String> {
        if self.target_identity.is_empty() || self.target_identity.len() > 128 {
            return Err(
                "EditDocumentV2 scene_curve outputCurveV1 targetIdentity requires 1..=128 bytes"
                    .to_string(),
            );
        }
        let target = match self.domain {
            OutputCurveDomainV1::ViewEncoded => {
                OutputCurveTargetV1::view_encoded(0, self.sdr_reference_white_nits, self.peak_nits)
            }
            OutputCurveDomainV1::OutputEncoded => OutputCurveTargetV1::output_encoded(
                0,
                self.sdr_reference_white_nits,
                self.peak_nits,
            ),
        };
        let points = self
            .points
            .iter()
            .map(|point| OutputCurvePoint::new(point.input, point.output))
            .collect::<Vec<_>>();
        compile_output_curve(target, &points)
            .map(|_| ())
            .map_err(|error| {
                format!("EditDocumentV2 scene_curve outputCurveV1 is invalid: {error:?}")
            })
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurveV2 {
    curve_mode: SceneCurveModeV2,
    curves: SceneCurveLegacyChannelsV2,
    output_curve_v1: Option<OutputCurveSettingsV1>,
    parametric_curve: SceneCurveParametricChannelsV2,
    point_curves: SceneCurveLegacyChannelsV2,
    scene_curve_v1: Option<SceneCurveSettingsV1>,
    tone_curve: SceneCurveToneCurveV2,
}

impl SceneCurveV2 {
    fn validate(&self) -> Result<(), String> {
        self.curves.validate()?;
        self.point_curves.validate()?;
        self.parametric_curve.validate()?;
        if let Some(scene_curve) = &self.scene_curve_v1 {
            scene_curve.validate()?;
        }
        if let Some(output_curve) = &self.output_curve_v1 {
            output_curve.validate()?;
        }
        let _ = (&self.curve_mode, &self.tone_curve);
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceModeV2 {
    AsShot,
    Auto,
    KelvinTint,
    Chromaticity,
    Preset,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSourceV2 {
    AsShot,
    Auto,
    Picker,
    Preset,
    User,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalancePresetV2 {
    Tungsten,
    Daylight,
    Flash,
    Cloudy,
    Shade,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceMigrationV2 {
    NativeV1,
    LegacyCreativeTemperatureTintV1,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSemanticsV2 {
    RawSceneLinear,
    RenderedSceneLinearApproximation,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSynchronizationModeV2 {
    PerImage,
    LockedReference,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CameraInputWhiteBalanceSynchronizationV2 {
    mode: CameraInputWhiteBalanceSynchronizationModeV2,
    reference_source_identity: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CameraInputTechnicalWhiteBalanceV2 {
    adaptation: String,
    confidence: Option<f64>,
    contract: String,
    duv: f64,
    input_semantics: CameraInputWhiteBalanceSemanticsV2,
    kelvin: f64,
    mode: CameraInputWhiteBalanceModeV2,
    preset_id: Option<CameraInputWhiteBalancePresetV2>,
    sample_count: Option<u64>,
    source: CameraInputWhiteBalanceSourceV2,
    synchronization: CameraInputWhiteBalanceSynchronizationV2,
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CameraInputV2 {
    camera_profile: String,
    camera_profile_amount: f64,
    creative_temperature: f64,
    creative_tint: f64,
    temperature: f64,
    tint: f64,
    white_balance: Option<Value>,
    white_balance_migration: CameraInputWhiteBalanceMigrationV2,
    white_balance_technical: CameraInputTechnicalWhiteBalanceV2,
}

impl CameraInputV2 {
    fn validate(&self) -> Result<(), String> {
        let built_in_profile = matches!(
            self.camera_profile.as_str(),
            "camera_standard"
                | "camera_neutral"
                | "camera_portrait"
                | "camera_landscape"
                | "linear_raw"
        );
        let valid_dcp_profile = self
            .camera_profile
            .strip_prefix("dcp:")
            .is_some_and(|digest| {
                digest.len() == 64
                    && digest
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            });
        if !built_in_profile && !valid_dcp_profile {
            return Err("EditDocumentV2 camera_input cameraProfile is invalid".to_string());
        }
        validate_camera_input_parameter(
            "cameraProfileAmount",
            self.camera_profile_amount,
            0.0,
            100.0,
        )?;
        validate_camera_input_parameter(
            "creativeTemperature",
            self.creative_temperature,
            -100.0,
            100.0,
        )?;
        validate_camera_input_parameter("creativeTint", self.creative_tint, -100.0, 100.0)?;
        validate_camera_input_parameter("temperature", self.temperature, -100.0, 100.0)?;
        validate_camera_input_parameter("tint", self.tint, -100.0, 100.0)?;
        let white_balance = &self.white_balance_technical;
        validate_camera_input_parameter(
            "whiteBalanceTechnical.kelvin",
            white_balance.kelvin,
            1667.0,
            25000.0,
        )?;
        validate_camera_input_parameter(
            "whiteBalanceTechnical.duv",
            white_balance.duv,
            -0.05,
            0.05,
        )?;
        if !white_balance.x.is_finite()
            || !white_balance.y.is_finite()
            || white_balance.x <= 0.0
            || white_balance.x >= 1.0
            || white_balance.y <= 0.0
            || white_balance.y >= 1.0
            || white_balance.x + white_balance.y >= 1.0
        {
            return Err(
                "EditDocumentV2 camera_input whiteBalanceTechnical chromaticity is invalid"
                    .to_string(),
            );
        }
        if white_balance.contract != "rapidraw.white_balance.v1"
            || white_balance.adaptation != "cat16_v1"
        {
            return Err(
                "EditDocumentV2 camera_input whiteBalanceTechnical contract is invalid".to_string(),
            );
        }
        if white_balance
            .confidence
            .is_some_and(|confidence| !confidence.is_finite() || !(0.0..=1.0).contains(&confidence))
        {
            return Err(
                "EditDocumentV2 camera_input whiteBalanceTechnical confidence is invalid"
                    .to_string(),
            );
        }
        if white_balance
            .synchronization
            .reference_source_identity
            .as_ref()
            .is_some_and(|identity| identity.trim().is_empty())
        {
            return Err(
                "EditDocumentV2 camera_input synchronization identity is invalid".to_string(),
            );
        }
        let _ = (
            &self.white_balance,
            &self.white_balance_migration,
            &white_balance.input_semantics,
            &white_balance.mode,
            &white_balance.preset_id,
            white_balance.sample_count,
            &white_balance.source,
            &white_balance.synchronization.mode,
        );
        Ok(())
    }
}

fn validate_camera_input_parameter(
    field: &str,
    value: f64,
    minimum: f64,
    maximum: f64,
) -> Result<(), String> {
    if value.is_finite() && value >= minimum && value <= maximum {
        return Ok(());
    }
    Err(format!(
        "EditDocumentV2 camera_input field '{field}' must be finite and within [{minimum}, {maximum}]"
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditDocumentMigrationReceiptV2 {
    defaulted: Vec<String>,
    disabled: Vec<String>,
    mapped: Vec<String>,
    quarantined: Vec<String>,
    source_schema_version: u8,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum SourceArtifactMaskTypeV2 {
    AiDepth,
    AiForeground,
    AiObject,
    AiPerson,
    AiSky,
    AiSubject,
    All,
    Brush,
    Color,
    Flow,
    Linear,
    Luminance,
    QuickEraser,
    Radial,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum SourceArtifactSubMaskModeV2 {
    Additive,
    Intersect,
    Subtractive,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum LayerBlendModeV2 {
    Normal,
    Multiply,
    Screen,
    Overlay,
    SoftLight,
    Hue,
    Saturation,
    Luminosity,
    Color,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayerV2 {
    adjustments: BTreeMap<String, Value>,
    blend_mode: Option<LayerBlendModeV2>,
    id: String,
    invert: bool,
    layer_group_id: Option<String>,
    layer_group_name: Option<String>,
    name: String,
    opacity: f64,
    reference_match_application_receipt: Option<Map<String, Value>>,
    retouch_clone_source: Option<Map<String, Value>>,
    retouch_remove_source: Option<Map<String, Value>>,
    sub_masks: Vec<SourceArtifactSubMaskV2>,
    visible: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayersV2 {
    masks: Vec<LayerV2>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifactSubMaskV2 {
    id: String,
    invert: bool,
    mode: SourceArtifactSubMaskModeV2,
    name: Option<String>,
    opacity: f64,
    parameters: Option<BTreeMap<String, Value>>,
    #[serde(rename = "type")]
    mask_type: SourceArtifactMaskTypeV2,
    visible: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifactAiPatchV2 {
    id: String,
    invert: bool,
    is_loading: bool,
    name: String,
    patch_data: Value,
    prompt: String,
    sub_masks: Vec<SourceArtifactSubMaskV2>,
    visible: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifactsV2 {
    ai_patches: Vec<SourceArtifactAiPatchV2>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditDocumentProvenanceV2 {
    #[serde(default)]
    reference_match_application_receipt: Option<Map<String, Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EditDocumentV2 {
    extensions: Map<String, Value>,
    geometry: GeometryV2,
    graph_process: String,
    layers: Map<String, Value>,
    migration: Option<EditDocumentMigrationReceiptV2>,
    nodes: BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    provenance: EditDocumentProvenanceV2,
    schema_version: u8,
    source_artifacts: SourceArtifactsV2,
}

impl EditDocumentV2 {
    pub(crate) fn into_render_adjustments(self) -> Result<Value, String> {
        self.validate_document_contract()?;
        let mut adjustments = match self.extensions.get("legacyAdjustments") {
            Some(Value::Object(legacy)) => legacy.clone(),
            Some(_) => {
                return Err(
                    "EditDocumentV2 extensions.legacyAdjustments must be an object".to_string(),
                );
            }
            None => Map::new(),
        };
        if adjustments.contains_key("referenceMatchApplicationReceipt") {
            return Err(
                "EditDocumentV2 referenceMatchApplicationReceipt must be owned by provenance"
                    .to_string(),
            );
        }
        adjustments.remove("generatedProfile");

        for (node_key, node) in &self.nodes {
            if let Some(conflicting_key) = node
                .params
                .keys()
                .find(|parameter| adjustments.contains_key(*parameter))
            {
                return Err(format!(
                    "EditDocumentV2 node '{}' conflicts with quarantined legacy field '{conflicting_key}'",
                    node_key.contract().0
                ));
            }
        }

        for (node_key, node) in self.nodes {
            validate_node_contract(node_key, &node)?;
            let compiled_params = compile_node_params(node_key, &node)?;
            if node.enabled {
                adjustments.extend(compiled_params);
            }
        }
        Ok(Value::Object(adjustments))
    }

    fn validate_document_contract(&self) -> Result<(), String> {
        if self.schema_version != EDIT_DOCUMENT_V2_SCHEMA_VERSION {
            return Err(format!(
                "Unsupported EditDocumentV2 schemaVersion: {}",
                self.schema_version
            ));
        }
        if self.graph_process != "scene_referred_v2" {
            return Err(format!(
                "Unsupported EditDocumentV2 graphProcess: {}",
                self.graph_process
            ));
        }
        if let Some(migration) = &self.migration {
            if migration.source_schema_version != LEGACY_SOURCE_SCHEMA_VERSION {
                return Err(format!(
                    "Unsupported EditDocumentV2 migration sourceSchemaVersion: {}",
                    migration.source_schema_version
                ));
            }
            let _ = (
                &migration.defaulted,
                &migration.disabled,
                &migration.mapped,
                &migration.quarantined,
            );
        }
        validate_geometry_domain(&self.nodes, &self.geometry)?;
        validate_layers_domain(&self.nodes, &self.layers)?;
        validate_source_artifact_domain(&self.nodes, &self.source_artifacts)?;
        if self
            .provenance
            .reference_match_application_receipt
            .as_ref()
            .is_some_and(|receipt| receipt.get("schemaVersion") != Some(&Value::from(1)))
        {
            return Err(
                "EditDocumentV2 reference-match provenance requires schemaVersion 1".to_string(),
            );
        }
        Ok(())
    }
}

fn compile_node_params(
    node_key: EditNodeTypeV2,
    node: &EditNodeEnvelopeV2,
) -> Result<Map<String, Value>, String> {
    match node_key {
        EditNodeTypeV2::CameraInput => {
            parse_camera_input(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::SceneGlobalColorTone => {
            let params = serde_json::from_value::<SceneGlobalColorToneParamsV2>(Value::Object(
                node.params.clone(),
            ))
            .map_err(|error| {
                format!("EditDocumentV2 node 'scene_global_color_tone' has invalid params: {error}")
            })?;
            params.compile()?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::SceneCurve => {
            parse_scene_curve(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::ToneEqualizer => {
            parse_tone_equalizer(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::DetailDenoiseDehaze => {
            parse_detail_denoise_dehaze(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::PointColor => {
            parse_point_color(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::DisplayCreative => {
            parse_display_creative(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::Geometry => {
            parse_geometry(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::SourceArtifacts => {
            parse_source_artifacts(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::Layers => {
            parse_layers(&node.params)?;
            Ok(node.params.clone())
        }
    }
}

fn parse_camera_input(params: &Map<String, Value>) -> Result<CameraInputV2, String> {
    let camera_input: CameraInputV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 camera_input is invalid: {error}"))?;
    camera_input.validate()?;
    Ok(camera_input)
}

fn parse_scene_curve(params: &Map<String, Value>) -> Result<SceneCurveV2, String> {
    let scene_curve: SceneCurveV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 scene_curve is invalid: {error}"))?;
    scene_curve.validate()?;
    Ok(scene_curve)
}

fn parse_tone_equalizer(params: &Map<String, Value>) -> Result<ToneEqualizerV2, String> {
    let tone_equalizer: ToneEqualizerV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 tone_equalizer is invalid: {error}"))?;
    tone_equalizer.validate()?;
    Ok(tone_equalizer)
}

fn parse_detail_denoise_dehaze(
    params: &Map<String, Value>,
) -> Result<DetailDenoiseDehazeV2, String> {
    let detail: DetailDenoiseDehazeV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 detail_denoise_dehaze is invalid: {error}"))?;
    detail.validate()?;
    Ok(detail)
}

fn parse_point_color(params: &Map<String, Value>) -> Result<PointColorV2, String> {
    let point_color: PointColorV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 point_color is invalid: {error}"))?;
    point_color.validate()?;
    Ok(point_color)
}

fn parse_display_creative(params: &Map<String, Value>) -> Result<DisplayCreativeV2, String> {
    let display: DisplayCreativeV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 display_creative is invalid: {error}"))?;
    display.validate()?;
    Ok(display)
}

fn validate_node_contract(
    node_key: EditNodeTypeV2,
    node: &EditNodeEnvelopeV2,
) -> Result<(), String> {
    let (node_name, process, implementation_version) = node_key.contract();
    if node.node_type != node_key {
        return Err(format!(
            "EditDocumentV2 node envelope type must match '{node_name}'"
        ));
    }
    if node.process != process {
        return Err(format!(
            "EditDocumentV2 node '{node_name}' has incompatible process '{}'",
            node.process
        ));
    }
    if node.implementation_version != implementation_version {
        return Err(format!(
            "EditDocumentV2 node '{node_name}' has unsupported implementationVersion {}",
            node.implementation_version
        ));
    }
    Ok(())
}

fn parse_source_artifacts(params: &Map<String, Value>) -> Result<SourceArtifactsV2, String> {
    let artifacts: SourceArtifactsV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 source artifacts are invalid: {error}"))?;
    let mut patch_ids = std::collections::BTreeSet::new();
    for patch in &artifacts.ai_patches {
        if patch.id.trim().is_empty() || !patch_ids.insert(&patch.id) {
            return Err("EditDocumentV2 AI patch IDs must be non-empty and unique".to_string());
        }
        let mut sub_mask_ids = std::collections::BTreeSet::new();
        for sub_mask in &patch.sub_masks {
            if sub_mask.id.trim().is_empty() || !sub_mask_ids.insert(&sub_mask.id) {
                return Err(
                    "EditDocumentV2 AI patch sub-mask IDs must be non-empty and unique".to_string(),
                );
            }
            if !(0.0..=100.0).contains(&sub_mask.opacity) {
                return Err(
                    "EditDocumentV2 AI patch sub-mask opacity must be within 0..=100".to_string(),
                );
            }
        }
    }
    Ok(artifacts)
}

fn parse_geometry(params: &Map<String, Value>) -> Result<GeometryV2, String> {
    let geometry: GeometryV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 geometry is invalid: {error}"))?;
    geometry.validate()?;
    Ok(geometry)
}

fn validate_source_artifact_domain(
    nodes: &BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    domain: &SourceArtifactsV2,
) -> Result<(), String> {
    let Some(node) = nodes.get(&EditNodeTypeV2::SourceArtifacts) else {
        return Ok(());
    };
    if &parse_source_artifacts(&node.params)? == domain {
        return Ok(());
    }
    Err("EditDocumentV2 source_artifacts domain disagrees with its node params".to_string())
}

fn validate_geometry_domain(
    nodes: &BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    domain: &GeometryV2,
) -> Result<(), String> {
    let Some(node) = nodes.get(&EditNodeTypeV2::Geometry) else {
        return Ok(());
    };
    if &parse_geometry(&node.params)? == domain {
        return Ok(());
    }
    Err("EditDocumentV2 geometry domain disagrees with its node params".to_string())
}

fn parse_layers(params: &Map<String, Value>) -> Result<LayersV2, String> {
    let layers: LayersV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 layers are invalid: {error}"))?;
    let mut layer_ids = std::collections::BTreeSet::new();
    for layer in &layers.masks {
        if layer.id.trim().is_empty() || !layer_ids.insert(&layer.id) {
            return Err("EditDocumentV2 layer IDs must be non-empty and unique".to_string());
        }
        if !(0.0..=100.0).contains(&layer.opacity) {
            return Err("EditDocumentV2 layer opacity must be within 0..=100".to_string());
        }
        if layer
            .layer_group_id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty())
            || layer
                .layer_group_name
                .as_ref()
                .is_some_and(|value| value.trim().is_empty())
        {
            return Err("EditDocumentV2 layer group identity must be non-empty".to_string());
        }
        if layer
            .reference_match_application_receipt
            .as_ref()
            .is_some_and(|receipt| receipt.get("schemaVersion") != Some(&Value::from(1)))
        {
            return Err(
                "EditDocumentV2 layer reference-match provenance requires schemaVersion 1"
                    .to_string(),
            );
        }
        let mut sub_mask_ids = std::collections::BTreeSet::new();
        for sub_mask in &layer.sub_masks {
            if sub_mask.id.trim().is_empty() || !sub_mask_ids.insert(&sub_mask.id) {
                return Err(
                    "EditDocumentV2 layer sub-mask IDs must be non-empty and unique".to_string(),
                );
            }
            if !(0.0..=100.0).contains(&sub_mask.opacity) {
                return Err(
                    "EditDocumentV2 layer sub-mask opacity must be within 0..=100".to_string(),
                );
            }
        }
        let _ = (
            &layer.adjustments,
            &layer.blend_mode,
            layer.invert,
            &layer.name,
            &layer.retouch_clone_source,
            &layer.retouch_remove_source,
            layer.visible,
        );
    }
    Ok(layers)
}

fn validate_layers_domain(
    nodes: &BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    domain: &Map<String, Value>,
) -> Result<(), String> {
    let domain = parse_layers(domain)?;
    let Some(node) = nodes.get(&EditNodeTypeV2::Layers) else {
        return Ok(());
    };
    if parse_layers(&node.params)? == domain {
        return Ok(());
    }
    Err("EditDocumentV2 layers domain disagrees with its node params".to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::super::parse::get_all_adjustments_from_json;
    use super::EditDocumentV2;

    fn scene_curve_params() -> Value {
        let identity_curves = json!({
            "blue": [{ "x": 0, "y": 0 }, { "x": 255, "y": 255 }],
            "green": [{ "x": 0, "y": 0 }, { "x": 255, "y": 255 }],
            "luma": [{ "x": 0, "y": 0 }, { "x": 255, "y": 250 }],
            "red": [{ "x": 0, "y": 0 }, { "x": 255, "y": 255 }]
        });
        let parametric_channel = json!({
            "blackLevel": 0,
            "darks": 0,
            "highlights": 0,
            "lights": 0,
            "shadows": 0,
            "split1": 25,
            "split2": 50,
            "split3": 75,
            "whiteLevel": 0
        });
        json!({
            "curveMode": "point",
            "curves": identity_curves,
            "outputCurveV1": {
                "domain": "view_encoded",
                "peakNits": 203,
                "points": [{ "input": 0, "output": 0 }, { "input": 1, "output": 1 }],
                "sdrReferenceWhiteNits": 203,
                "targetIdentity": "rapid-view-default"
            },
            "parametricCurve": {
                "blue": parametric_channel,
                "green": parametric_channel,
                "luma": parametric_channel,
                "red": parametric_channel
            },
            "pointCurves": identity_curves,
            "sceneCurveV1": {
                "channelMode": "luminance_preserving",
                "middleGrey": 0.18,
                "points": [{ "xEv": -16, "yEv": -16 }, { "xEv": 16, "yEv": 16 }]
            },
            "toneCurve": "soft_contrast"
        })
    }

    fn detail_params() -> Value {
        json!({
            "clarity": 16,
            "colorNoiseReduction": 0,
            "dehaze": 8,
            "denoiseContrastProtection": 50,
            "denoiseDetail": 50,
            "denoiseNaturalGrain": 0,
            "denoiseShadowBias": 0,
            "lumaNoiseReduction": 5,
            "sharpness": 24
        })
    }

    fn display_creative_params() -> Value {
        json!({
            "flareAmount": 0,
            "glowAmount": 0,
            "grainAmount": 12,
            "grainRoughness": 50,
            "grainSize": 25,
            "halationAmount": 3,
            "lutData": null,
            "lutIntensity": 80,
            "lutName": null,
            "lutPath": null,
            "lutSize": 0,
            "vignetteAmount": 0,
            "vignetteFeather": 50,
            "vignetteMidpoint": 50,
            "vignetteRoundness": 0
        })
    }

    fn tone_equalizer_params() -> Value {
        json!({
            "toneEqualizer": {
                "autoPlacement": false,
                "bandEv": [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4],
                "detailPreservation": 0.65,
                "edgeRefinement": 2,
                "enabled": true,
                "maskExposureCompensation": 0,
                "pivotEv": 0,
                "previewMode": 0,
                "rangeEv": 16,
                "selectedBand": 4,
                "smoothingRadius": 32
            }
        })
    }

    fn point_color_params() -> Value {
        json!({
            "pointColor": {
                "enabled": true,
                "points": [{
                    "chromaRadius": 0.08,
                    "chromaShift": 0,
                    "enabled": true,
                    "feather": 0.4,
                    "hueRadiusDegrees": 25,
                    "hueShiftDegrees": 0,
                    "id": "point-1",
                    "lightnessRadius": 0.2,
                    "lightnessShift": 0,
                    "name": "Point 1",
                    "opacity": 1,
                    "samples": [{
                        "confidence": 1,
                        "graphRevision": "graph-1",
                        "id": "sample-1",
                        "sampleRadiusPx": 5,
                        "sourceColor": { "chroma": 0.12, "hueDegrees": 30, "lightness": 0.6 },
                        "sourceSceneRevision": "scene-1"
                    }],
                    "saturationShift": 0,
                    "variance": 1
                }],
                "process": "rawengine.point-color.oklab-ap1.v1",
                "selectedPointId": "point-1",
                "skinUniformity": {
                    "chromaUniformity": 0,
                    "enabled": false,
                    "hueUniformity": 0,
                    "lightnessUniformity": 0,
                    "preserveExtremes": 0.5,
                    "range": null,
                    "target": null
                },
                "visualizeMode": "range"
            }
        })
    }

    fn document_with_legacy(legacy: Value) -> Value {
        json!({
            "extensions": { "legacyAdjustments": legacy },
            "geometry": {
                "aspectRatio": null,
                "crop": { "height": 80, "unit": "%", "width": 90, "x": 4, "y": 6 },
                "flipHorizontal": false,
                "flipVertical": true,
                "orientationSteps": 1,
                "rotation": 0.5
            },
            "graphProcess": "scene_referred_v2",
            "layers": { "masks": [] },
            "migration": {
                "defaulted": [],
                "disabled": [],
                "mapped": ["geometry.crop", "geometry.rotation", "layers.masks", "scene_global_color_tone.exposure"],
                "quarantined": ["vibrance"],
                "sourceSchemaVersion": 1
            },
            "nodes": {
                "scene_global_color_tone": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": {
                        "blacks": -4,
                        "brightness": 0.1,
                        "contrast": 18,
                        "exposure": 0.75,
                        "highlights": -22,
                        "saturation": 7,
                        "shadows": 14,
                        "whites": 9
                    },
                    "process": "scene_referred_v2",
                    "type": "scene_global_color_tone"
                },
                "scene_curve": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": scene_curve_params(),
                    "process": "scene_referred_v2",
                    "type": "scene_curve"
                },
                "tone_equalizer": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": tone_equalizer_params(),
                    "process": "scene_referred_v2",
                    "type": "tone_equalizer"
                },
                "display_creative": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": display_creative_params(),
                    "process": "scene_referred_v2",
                    "type": "display_creative"
                },
                "detail_denoise_dehaze": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": detail_params(),
                    "process": "scene_referred_v2",
                    "type": "detail_denoise_dehaze"
                },
                "point_color": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": point_color_params(),
                    "process": "scene_referred_v2",
                    "type": "point_color"
                },
                "camera_input": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": {
                        "cameraProfile": "camera_standard",
                        "cameraProfileAmount": 100,
                        "creativeTemperature": 0,
                        "creativeTint": 0,
                        "temperature": 12,
                        "tint": -3,
                        "whiteBalanceMigration": "native_v1",
                        "whiteBalanceTechnical": {
                            "adaptation": "cat16_v1",
                            "confidence": null,
                            "contract": "rapidraw.white_balance.v1",
                            "duv": 0,
                            "inputSemantics": "raw_scene_linear",
                            "kelvin": 6504,
                            "mode": "as_shot",
                            "presetId": null,
                            "sampleCount": null,
                            "source": "as_shot",
                            "synchronization": { "mode": "per_image", "referenceSourceIdentity": null },
                            "x": 0.32168,
                            "y": 0.33767
                        }
                    },
                    "process": "scene_referred_v2",
                    "type": "camera_input"
                },
                "geometry": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": {
                        "aspectRatio": null,
                        "crop": { "height": 80, "unit": "%", "width": 90, "x": 4, "y": 6 },
                        "flipHorizontal": false,
                        "flipVertical": true,
                        "orientationSteps": 1,
                        "rotation": 0.5
                    },
                    "process": "legacy_pipeline_v1",
                    "type": "geometry"
                },
                "layers": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "masks": [] },
                    "process": "scene_referred_v2",
                    "type": "layers"
                },
                "source_artifacts": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "aiPatches": [] },
                    "process": "scene_referred_v2",
                    "type": "source_artifacts"
                }
            },
            "provenance": {},
            "schemaVersion": 2,
            "sourceArtifacts": { "aiPatches": [] }
        })
    }

    fn source_patch() -> Value {
        json!({
            "id": "patch-1",
            "invert": false,
            "isLoading": false,
            "name": "Repair",
            "patchData": { "pixels": "resident-payload" },
            "prompt": "remove distraction",
            "subMasks": [{
                "id": "mask-1",
                "invert": false,
                "mode": "additive",
                "opacity": 80,
                "parameters": { "mask_data_base64": "encoded-mask" },
                "type": "brush",
                "visible": true
            }],
            "visible": true
        })
    }

    fn layer() -> Value {
        json!({
            "adjustments": { "exposure": 0.4 },
            "blendMode": "overlay",
            "id": "layer-1",
            "invert": false,
            "name": "Local sky",
            "opacity": 72,
            "subMasks": [{
                "id": "sub-mask-1",
                "invert": false,
                "mode": "additive",
                "opacity": 100,
                "parameters": { "feather": 0.5 },
                "type": "brush",
                "visible": true
            }],
            "visible": true
        })
    }

    #[test]
    fn compiles_node_keyed_document_to_render_parity_adjustments() {
        let legacy = json!({
            "futureField": { "enabled": true },
            "rawEngineEditGraphVersion": 2,
            "sectionVisibility": { "basic": true, "color": true, "details": true, "effects": true },
            "toneMapper": "basic",
            "vibrance": 11
        });
        let document: EditDocumentV2 =
            serde_json::from_value(document_with_legacy(legacy)).expect("valid document");
        let compiled = document
            .into_render_adjustments()
            .expect("compiled document");

        let mut expected = json!({
            "aiPatches": [],
            "aspectRatio": null,
            "blacks": -4,
            "brightness": 0.1,
            "cameraProfile": "camera_standard",
            "clarity": 16,
            "colorNoiseReduction": 0,
            "contrast": 18,
            "crop": { "height": 80, "unit": "%", "width": 90, "x": 4, "y": 6 },
            "dehaze": 8,
            "denoiseContrastProtection": 50,
            "denoiseDetail": 50,
            "denoiseNaturalGrain": 0,
            "denoiseShadowBias": 0,
            "exposure": 0.75,
            "flipHorizontal": false,
            "flipVertical": true,
            "futureField": { "enabled": true },
            "highlights": -22,
            "lumaNoiseReduction": 5,
            "masks": [],
            "orientationSteps": 1,
            "pointColor": point_color_params()["pointColor"].clone(),
            "rawEngineEditGraphVersion": 2,
            "rotation": 0.5,
            "saturation": 7,
            "sectionVisibility": { "basic": true, "color": true, "details": true, "effects": true },
            "shadows": 14,
            "sharpness": 24,
            "temperature": 12,
            "tint": -3,
            "toneMapper": "basic",
            "vibrance": 11,
            "whites": 9
        });
        expected["cameraProfileAmount"] = json!(100);
        expected["creativeTemperature"] = json!(0);
        expected["creativeTint"] = json!(0);
        expected["whiteBalanceMigration"] = json!("native_v1");
        expected["whiteBalanceTechnical"] = json!({
            "adaptation": "cat16_v1",
            "confidence": null,
            "contract": "rapidraw.white_balance.v1",
            "duv": 0,
            "inputSemantics": "raw_scene_linear",
            "kelvin": 6504,
            "mode": "as_shot",
            "presetId": null,
            "sampleCount": null,
            "source": "as_shot",
            "synchronization": { "mode": "per_image", "referenceSourceIdentity": null },
            "x": 0.32168,
            "y": 0.33767
        });
        for (key, value) in scene_curve_params()
            .as_object()
            .expect("scene-curve params object")
        {
            expected[key] = value.clone();
        }
        for (key, value) in display_creative_params()
            .as_object()
            .expect("display-creative params object")
        {
            expected[key] = value.clone();
        }
        for (key, value) in tone_equalizer_params()
            .as_object()
            .expect("tone-equalizer params object")
        {
            expected[key] = value.clone();
        }
        assert_eq!(compiled, expected);

        let expected_render = get_all_adjustments_from_json(&expected, true, None);
        let compiled_render = get_all_adjustments_from_json(&compiled, true, None);
        assert_eq!(
            compiled_render.global.exposure,
            expected_render.global.exposure
        );
        assert_eq!(
            compiled_render.global.contrast,
            expected_render.global.contrast
        );
        assert_eq!(
            compiled_render.global.highlights,
            expected_render.global.highlights
        );
        assert_eq!(
            compiled_render.global.vibrance,
            expected_render.global.vibrance
        );
        assert_eq!(
            compiled_render.global.clarity,
            expected_render.global.clarity
        );
        assert_eq!(compiled_render.global.dehaze, expected_render.global.dehaze);
        assert_eq!(
            compiled_render.global.temperature,
            expected_render.global.temperature
        );
        assert_eq!(compiled_render.global.tint, expected_render.global.tint);
        assert_eq!(
            compiled_render.global.grain_amount,
            expected_render.global.grain_amount
        );
        assert_eq!(compiled_render.mask_count, expected_render.mask_count);
    }

    #[test]
    fn rejects_unknown_nodes_and_mismatched_envelopes() {
        let mut unknown = document_with_legacy(json!({}));
        unknown["nodes"]["future_node"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": {},
            "process": "scene_referred_v2",
            "type": "future_node"
        });
        assert!(serde_json::from_value::<EditDocumentV2>(unknown).is_err());

        let mut mismatch = document_with_legacy(json!({}));
        mismatch["nodes"]["geometry"]["type"] = json!("layers");
        let error = serde_json::from_value::<EditDocumentV2>(mismatch)
            .expect("deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("mismatched node must fail");
        assert!(error.contains("must match 'geometry'"));
    }

    #[test]
    fn rejects_unsupported_versions_processes_and_ambiguous_domains() {
        let mut unsupported = document_with_legacy(json!({}));
        unsupported["nodes"]["geometry"]["implementationVersion"] = json!(2);
        let error = serde_json::from_value::<EditDocumentV2>(unsupported)
            .expect("deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("unsupported node version must fail");
        assert!(error.contains("unsupported implementationVersion 2"));

        let mut incompatible = document_with_legacy(json!({}));
        incompatible["nodes"]["geometry"]["process"] = json!("scene_referred_v2");
        let error = serde_json::from_value::<EditDocumentV2>(incompatible)
            .expect("deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("incompatible node process must fail");
        assert!(error.contains("incompatible process"));

        let mut ambiguous = document_with_legacy(json!({}));
        ambiguous["geometry"]["rotation"] = json!(90);
        let error = serde_json::from_value::<EditDocumentV2>(ambiguous)
            .expect("deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("ambiguous geometry must fail");
        assert!(error.contains("geometry domain disagrees"));
    }

    #[test]
    fn disabled_nodes_do_not_reenter_the_render_bag() {
        let mut value = document_with_legacy(json!({ "vibrance": 12 }));
        value["nodes"]["scene_global_color_tone"]["enabled"] = json!(false);
        let document: EditDocumentV2 = serde_json::from_value(value).expect("valid document");
        let compiled = document
            .into_render_adjustments()
            .expect("compiled document");
        assert!(compiled.get("exposure").is_none());
        assert_eq!(compiled["vibrance"], json!(12));
    }

    #[test]
    fn scene_global_color_tone_compiler_rejects_unowned_and_out_of_range_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["scene_global_color_tone"]["params"]["futureTone"] = json!(1);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned scene-tone field must fail");
        assert!(error.contains("unknown field `futureTone`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["scene_global_color_tone"]["params"]["exposure"] = json!(6);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range exposure must fail");
        assert!(error.contains("field 'exposure'"));
        assert!(error.contains("[-5, 5]"));
    }

    #[test]
    fn camera_input_compiler_rejects_unowned_and_malformed_render_authority() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["camera_input"]["params"]["futureInput"] = json!(1);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned camera-input field must fail");
        assert!(error.contains("unknown field `futureInput`"));

        let mut invalid_profile = document_with_legacy(json!({}));
        invalid_profile["nodes"]["camera_input"]["params"]["cameraProfile"] =
            json!("unknown_profile");
        let error = serde_json::from_value::<EditDocumentV2>(invalid_profile)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unknown camera profile must fail");
        assert!(error.contains("cameraProfile is invalid"));

        let mut invalid_amount = document_with_legacy(json!({}));
        invalid_amount["nodes"]["camera_input"]["params"]["cameraProfileAmount"] = json!(101);
        let error = serde_json::from_value::<EditDocumentV2>(invalid_amount)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range camera profile amount must fail");
        assert!(error.contains("cameraProfileAmount"));
        assert!(error.contains("[0, 100]"));

        let mut invalid_chromaticity = document_with_legacy(json!({}));
        invalid_chromaticity["nodes"]["camera_input"]["params"]["whiteBalanceTechnical"]["x"] =
            json!(0.8);
        let error = serde_json::from_value::<EditDocumentV2>(invalid_chromaticity)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("invalid white-balance chromaticity must fail");
        assert!(error.contains("chromaticity is invalid"));
    }

    #[test]
    fn scene_curve_compiler_rejects_unowned_and_malformed_render_authority() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["scene_curve"]["params"]["futureCurve"] = json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned scene-curve field must fail");
        assert!(error.contains("unknown field `futureCurve`"));

        let mut too_many_points = document_with_legacy(json!({}));
        too_many_points["nodes"]["scene_curve"]["params"]["curves"]["luma"] = Value::Array(
            (0..17)
                .map(|index| json!({ "x": index, "y": index }))
                .collect(),
        );
        let error = serde_json::from_value::<EditDocumentV2>(too_many_points)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("oversized legacy curve must fail");
        assert!(error.contains("requires 2..=16 points"));

        let mut non_monotone_scene = document_with_legacy(json!({}));
        non_monotone_scene["nodes"]["scene_curve"]["params"]["sceneCurveV1"]["points"] =
            json!([{ "xEv": -1, "yEv": 1 }, { "xEv": 1, "yEv": 0 }]);
        let error = serde_json::from_value::<EditDocumentV2>(non_monotone_scene)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("non-monotone scene curve must fail");
        assert!(error.contains("OutputNotMonotone"));

        let mut invalid_headroom = document_with_legacy(json!({}));
        invalid_headroom["nodes"]["scene_curve"]["params"]["outputCurveV1"]["peakNits"] =
            json!(100);
        let error = serde_json::from_value::<EditDocumentV2>(invalid_headroom)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("output curve below reference white must fail");
        assert!(error.contains("InvalidTargetLuminance"));
    }

    #[test]
    fn detail_compiler_rejects_unowned_missing_and_out_of_range_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["detail_denoise_dehaze"]["params"]["futureDetail"] = json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned detail field must fail");
        assert!(error.contains("unknown field `futureDetail`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["detail_denoise_dehaze"]["params"]
            .as_object_mut()
            .expect("detail params object")
            .remove("sharpness");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing detail field must fail");
        assert!(error.contains("missing field `sharpness`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["detail_denoise_dehaze"]["params"]["lumaNoiseReduction"] = json!(-1);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range detail field must fail");
        assert!(error.contains("lumaNoiseReduction"));
    }

    #[test]
    fn display_creative_compiler_rejects_stale_missing_and_out_of_range_params() {
        let mut stale = document_with_legacy(json!({}));
        stale["nodes"]["display_creative"]["params"]["filmCurve"] = json!({ "legacy": true });
        let error = serde_json::from_value::<EditDocumentV2>(stale)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("stale display field must fail");
        assert!(error.contains("unknown field `filmCurve`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["display_creative"]["params"]
            .as_object_mut()
            .expect("display params object")
            .remove("lutIntensity");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing display field must fail");
        assert!(error.contains("missing field `lutIntensity`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["display_creative"]["params"]["vignetteAmount"] = json!(101);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range display field must fail");
        assert!(error.contains("vignetteAmount"));
    }

    #[test]
    fn tone_equalizer_compiler_rejects_unowned_missing_and_malformed_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["tone_equalizer"]["params"]["toneEqualizer"]["futureBand"] = json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned tone-equalizer field must fail");
        assert!(error.contains("unknown field `futureBand`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["tone_equalizer"]["params"]["toneEqualizer"]
            .as_object_mut()
            .expect("tone-equalizer settings object")
            .remove("smoothingRadius");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing tone-equalizer field must fail");
        assert!(error.contains("missing field `smoothingRadius`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["tone_equalizer"]["params"]["toneEqualizer"]["bandEv"][4] =
            json!(4.1);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range tone-equalizer band must fail");
        assert!(error.contains("bandEv"));

        let mut wrong_band_count = document_with_legacy(json!({}));
        wrong_band_count["nodes"]["tone_equalizer"]["params"]["toneEqualizer"]["bandEv"] =
            json!([0, 0, 0, 0, 0, 0, 0, 0]);
        let error = serde_json::from_value::<EditDocumentV2>(wrong_band_count)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("wrong tone-equalizer band count must fail");
        assert!(error.contains("array of length 9"));
    }

    #[test]
    fn point_color_compiler_rejects_unowned_missing_oversized_and_out_of_range_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["point_color"]["params"]["pointColor"]["futureRange"] = json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned point-color field must fail");
        assert!(error.contains("unknown field `futureRange`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["point_color"]["params"]["pointColor"]
            .as_object_mut()
            .expect("point-color plan object")
            .remove("process");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing point-color field must fail");
        assert!(error.contains("missing field `process`"));

        let point = point_color_params()["pointColor"]["points"][0].clone();
        let mut too_many_points = document_with_legacy(json!({}));
        too_many_points["nodes"]["point_color"]["params"]["pointColor"]["points"] =
            Value::Array((0..17).map(|_| point.clone()).collect());
        let error = serde_json::from_value::<EditDocumentV2>(too_many_points)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("oversized point-color plan must fail");
        assert!(error.contains("point count is invalid"));

        let sample = point_color_params()["pointColor"]["points"][0]["samples"][0].clone();
        let mut too_many_samples = document_with_legacy(json!({}));
        too_many_samples["nodes"]["point_color"]["params"]["pointColor"]["points"][0]["samples"] =
            Value::Array((0..9).map(|_| sample.clone()).collect());
        let error = serde_json::from_value::<EditDocumentV2>(too_many_samples)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("oversized point-color samples must fail");
        assert!(error.contains("adjustment identity or samples are invalid"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["point_color"]["params"]["pointColor"]["points"][0]["hueRadiusDegrees"] =
            json!(181);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range point-color control must fail");
        assert!(error.contains("hueRadiusDegrees"));

        let mut invalid_process = document_with_legacy(json!({}));
        invalid_process["nodes"]["point_color"]["params"]["pointColor"]["process"] =
            json!("legacy.point-color");
        let error = serde_json::from_value::<EditDocumentV2>(invalid_process)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unknown point-color process must fail");
        assert!(error.contains("process or point count is invalid"));
    }

    #[test]
    fn geometry_compiler_rejects_unowned_out_of_range_and_out_of_bounds_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["geometry"]["params"]["futureWarp"] = json!(1);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned geometry field must fail");
        assert!(error.contains("unknown field `futureWarp`"));

        let mut rotation = document_with_legacy(json!({}));
        rotation["nodes"]["geometry"]["params"]["rotation"] = json!(46);
        rotation["geometry"]["rotation"] = json!(46);
        let error = serde_json::from_value::<EditDocumentV2>(rotation)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range rotation must fail");
        assert!(error.contains("rotation must be within -45..=45"));

        let invalid_crop =
            json!({ "height": 0.8, "unit": "normalized", "width": 0.8, "x": 0.3, "y": 0.3 });
        let mut crop = document_with_legacy(json!({}));
        crop["nodes"]["geometry"]["params"]["crop"] = invalid_crop.clone();
        crop["geometry"]["crop"] = invalid_crop;
        let error = serde_json::from_value::<EditDocumentV2>(crop)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-bounds crop must fail");
        assert!(error.contains("crop exceeds its unit bounds"));

        let mut unknown_domain = document_with_legacy(json!({}));
        unknown_domain["geometry"]["futureWarp"] = json!(1);
        assert!(serde_json::from_value::<EditDocumentV2>(unknown_domain).is_err());
    }

    #[test]
    fn compiles_strict_source_artifacts_and_excludes_quarantined_profile_state() {
        let patch = source_patch();
        let mut value = document_with_legacy(json!({
            "generatedProfile": { "obsolete": true },
            "vibrance": 12
        }));
        value["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch] });
        value["sourceArtifacts"] = json!({ "aiPatches": [patch] });
        let compiled = serde_json::from_value::<EditDocumentV2>(value)
            .expect("valid source document")
            .into_render_adjustments()
            .expect("compiled source document");

        assert_eq!(compiled["aiPatches"][0]["id"], json!("patch-1"));
        assert_eq!(compiled["vibrance"], json!(12));
        assert!(compiled.get("generatedProfile").is_none());
        assert!(compiled.get("referenceMatchApplicationReceipt").is_none());
    }

    #[test]
    fn rejects_malformed_duplicate_ambiguous_and_legacy_owned_source_state() {
        let patch = source_patch();
        let mut malformed = document_with_legacy(json!({}));
        malformed["nodes"]["source_artifacts"]["params"] =
            json!({ "aiPatches": [{ "id": "patch-1", "unsupported": true }] });
        let error = serde_json::from_value::<EditDocumentV2>(malformed)
            .expect("top-level source domain remains valid")
            .into_render_adjustments()
            .expect_err("malformed source node must fail");
        assert!(error.contains("source artifacts are invalid"));

        let mut duplicate = document_with_legacy(json!({}));
        duplicate["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch, patch] });
        duplicate["sourceArtifacts"] = json!({ "aiPatches": [patch, patch] });
        let error = serde_json::from_value::<EditDocumentV2>(duplicate)
            .expect("duplicate IDs deserialize before semantic validation")
            .into_render_adjustments()
            .expect_err("duplicate source IDs must fail");
        assert!(error.contains("non-empty and unique"));

        let mut ambiguous = document_with_legacy(json!({}));
        ambiguous["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch] });
        let error = serde_json::from_value::<EditDocumentV2>(ambiguous)
            .expect("mismatched domains deserialize before semantic validation")
            .into_render_adjustments()
            .expect_err("ambiguous source domains must fail");
        assert!(error.contains("domain disagrees"));

        let legacy_owned = document_with_legacy(json!({
            "referenceMatchApplicationReceipt": { "schemaVersion": 1 }
        }));
        let error = serde_json::from_value::<EditDocumentV2>(legacy_owned)
            .expect("legacy-owned provenance deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("legacy-owned provenance must fail");
        assert!(error.contains("must be owned by provenance"));
    }

    #[test]
    fn compiles_strict_layers_and_rejects_duplicate_or_ambiguous_layer_state() {
        let layer = layer();
        let mut value = document_with_legacy(json!({}));
        value["nodes"]["layers"]["params"] = json!({ "masks": [layer] });
        value["layers"] = json!({ "masks": [layer] });
        let compiled = serde_json::from_value::<EditDocumentV2>(value)
            .expect("valid layers document")
            .into_render_adjustments()
            .expect("compiled layers document");
        assert_eq!(compiled["masks"][0]["id"], json!("layer-1"));

        let mut duplicate = document_with_legacy(json!({}));
        duplicate["nodes"]["layers"]["params"] = json!({ "masks": [layer, layer] });
        duplicate["layers"] = json!({ "masks": [layer, layer] });
        let error = serde_json::from_value::<EditDocumentV2>(duplicate)
            .expect("duplicate layers deserialize before semantic validation")
            .into_render_adjustments()
            .expect_err("duplicate layer IDs must fail");
        assert!(error.contains("non-empty and unique"));

        let mut ambiguous = document_with_legacy(json!({}));
        ambiguous["nodes"]["layers"]["params"] = json!({ "masks": [layer] });
        let error = serde_json::from_value::<EditDocumentV2>(ambiguous)
            .expect("ambiguous layers deserialize before semantic validation")
            .into_render_adjustments()
            .expect_err("ambiguous layers must fail");
        assert!(error.contains("layers domain disagrees"));
    }
}
