use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::color::perceptual_grading::{PerceptualGradingPlanV1, PerceptualGradingSettingsV1};
use crate::geometry::perspective::{
    PERSPECTIVE_IMPLEMENTATION_VERSION_V1, PerspectiveCorrectionSettingsV1,
};
use crate::tone::curves::{CurveChannelMode, CurvePoint, compile_scene_curve};
use crate::tone::output_curves::{OutputCurvePoint, OutputCurveTargetV1, compile_output_curve};

const EDIT_DOCUMENT_V2_SCHEMA_VERSION: u8 = 2;
const LEGACY_SOURCE_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
enum EditNodeTypeV2 {
    SceneGlobalColorTone,
    ColorPresence,
    SceneCurve,
    ToneEqualizer,
    DisplayCreative,
    FilmEmulation,
    DetailDenoiseDehaze,
    PointColor,
    ColorBalanceRgb,
    SelectiveColorMixer,
    BlackWhiteMixer,
    ChannelMixer,
    LumaLevels,
    PerceptualGrading,
    CameraInput,
    LensCorrection,
    ColorCalibration,
    Geometry,
    Layers,
    SourceArtifacts,
}

impl EditNodeTypeV2 {
    fn contract(self) -> (&'static str, &'static str, u32) {
        match self {
            Self::Geometry => ("geometry", "legacy_pipeline_v1", 1),
            Self::SceneGlobalColorTone => ("scene_global_color_tone", "scene_referred_v2", 1),
            Self::ColorPresence => ("color_presence", "scene_referred_v2", 1),
            Self::SceneCurve => ("scene_curve", "scene_referred_v2", 1),
            Self::ToneEqualizer => ("tone_equalizer", "scene_referred_v2", 1),
            Self::DisplayCreative => ("display_creative", "scene_referred_v2", 1),
            Self::FilmEmulation => ("film_emulation", "scene_referred_v2", 1),
            Self::DetailDenoiseDehaze => ("detail_denoise_dehaze", "scene_referred_v2", 1),
            Self::PointColor => ("point_color", "scene_referred_v2", 1),
            Self::ColorBalanceRgb => ("color_balance_rgb", "scene_referred_v2", 1),
            Self::SelectiveColorMixer => ("selective_color_mixer", "scene_referred_v2", 1),
            Self::BlackWhiteMixer => ("black_white_mixer", "scene_referred_v2", 1),
            Self::ChannelMixer => ("channel_mixer", "scene_referred_v2", 1),
            Self::LumaLevels => ("luma_levels", "scene_referred_v2", 1),
            Self::PerceptualGrading => ("perceptual_grading", "scene_referred_v2", 1),
            Self::CameraInput => ("camera_input", "scene_referred_v2", 1),
            Self::LensCorrection => ("lens_correction", "legacy_pipeline_v1", 1),
            Self::ColorCalibration => ("color_calibration", "scene_referred_v2", 1),
            Self::Layers => ("layers", "scene_referred_v2", 1),
            Self::SourceArtifacts => ("source_artifacts", "scene_referred_v2", 1),
        }
    }

    fn editor_section(self) -> Option<&'static str> {
        match self {
            Self::SceneGlobalColorTone | Self::ToneEqualizer => Some("basic"),
            Self::SceneCurve => Some("curves"),
            Self::DetailDenoiseDehaze => Some("details"),
            Self::DisplayCreative => Some("effects"),
            Self::PointColor
            | Self::ColorPresence
            | Self::ColorBalanceRgb
            | Self::SelectiveColorMixer
            | Self::BlackWhiteMixer
            | Self::ChannelMixer
            | Self::LumaLevels
            | Self::PerceptualGrading
            | Self::CameraInput
            | Self::ColorCalibration => Some("color"),
            Self::FilmEmulation
            | Self::LensCorrection
            | Self::Geometry
            | Self::Layers
            | Self::SourceArtifacts => None,
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
    // Optional only for V2 documents persisted before the Color Presence node.
    hue: Option<f64>,
    // Optional only for V2 documents persisted before the Color Presence node.
    saturation: Option<f64>,
    shadows: f64,
    // Optional only for V2 documents persisted before the Color Presence node.
    vibrance: Option<f64>,
    whites: f64,
}

impl SceneGlobalColorToneParamsV2 {
    fn compile(&self) -> Result<(), String> {
        validate_scene_tone_parameter("blacks", self.blacks, -100.0, 100.0)?;
        validate_scene_tone_parameter("brightness", self.brightness, -5.0, 5.0)?;
        validate_scene_tone_parameter("contrast", self.contrast, -100.0, 100.0)?;
        validate_scene_tone_parameter("exposure", self.exposure, -5.0, 5.0)?;
        validate_scene_tone_parameter("highlights", self.highlights, -100.0, 100.0)?;
        if let Some(hue) = self.hue {
            validate_scene_tone_parameter("hue", hue, -180.0, 180.0)?;
        }
        if let Some(saturation) = self.saturation {
            validate_scene_tone_parameter("saturation", saturation, -100.0, 100.0)?;
        }
        validate_scene_tone_parameter("shadows", self.shadows, -100.0, 100.0)?;
        if let Some(vibrance) = self.vibrance {
            validate_scene_tone_parameter("vibrance", vibrance, -100.0, 100.0)?;
        }
        validate_scene_tone_parameter("whites", self.whites, -100.0, 100.0)?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColorPresenceParamsV2 {
    hue: f64,
    saturation: f64,
    vibrance: f64,
}

impl ColorPresenceParamsV2 {
    fn compile(&self) -> Result<(), String> {
        validate_color_presence_parameter("hue", self.hue, -180.0, 180.0)?;
        validate_color_presence_parameter("saturation", self.saturation, -100.0, 100.0)?;
        validate_color_presence_parameter("vibrance", self.vibrance, -100.0, 100.0)
    }
}

fn validate_color_presence_parameter(
    field: &str,
    value: f64,
    minimum: f64,
    maximum: f64,
) -> Result<(), String> {
    if value.is_finite() && value >= minimum && value <= maximum {
        return Ok(());
    }
    Err(format!(
        "EditDocumentV2 node 'color_presence' field '{field}' must be finite and within [{minimum}, {maximum}]"
    ))
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
    #[serde(default)]
    perspective_correction: PerspectiveCorrectionSettingsV1,
    rotation: f64,
    #[serde(default)]
    transform_aspect: f64,
    #[serde(default)]
    transform_distortion: f64,
    #[serde(default)]
    transform_horizontal: f64,
    #[serde(default)]
    transform_rotate: f64,
    #[serde(default = "default_transform_scale")]
    transform_scale: f64,
    #[serde(default)]
    transform_vertical: f64,
    #[serde(default)]
    transform_x_offset: f64,
    #[serde(default)]
    transform_y_offset: f64,
}

fn default_transform_scale() -> f64 {
    100.0
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
        for (label, value, range) in [
            ("transformAspect", self.transform_aspect, -100.0..=100.0),
            (
                "transformDistortion",
                self.transform_distortion,
                -100.0..=100.0,
            ),
            (
                "transformHorizontal",
                self.transform_horizontal,
                -100.0..=100.0,
            ),
            ("transformRotate", self.transform_rotate, -45.0..=45.0),
            ("transformScale", self.transform_scale, 0.1..=150.0),
            ("transformVertical", self.transform_vertical, -100.0..=100.0),
            ("transformXOffset", self.transform_x_offset, -100.0..=100.0),
            ("transformYOffset", self.transform_y_offset, -100.0..=100.0),
        ] {
            if !value.is_finite() || !range.contains(&value) {
                return Err(format!(
                    "EditDocumentV2 geometry {label} is outside its supported range"
                ));
            }
        }
        if let Some(crop) = &self.crop {
            crop.validate()?;
        }
        validate_perspective_correction(&self.perspective_correction)?;
        Ok(())
    }
}

fn validate_perspective_correction(
    settings: &PerspectiveCorrectionSettingsV1,
) -> Result<(), String> {
    if !settings.amount.is_finite() || !(0.0..=100.0).contains(&settings.amount) {
        return Err(
            "EditDocumentV2 geometry perspectiveCorrection amount must be within 0..=100"
                .to_string(),
        );
    }
    if settings.guides.len() > 8 {
        return Err(
            "EditDocumentV2 geometry perspectiveCorrection supports at most 8 guides".to_string(),
        );
    }
    let mut guide_ids = std::collections::BTreeSet::new();
    for guide in &settings.guides {
        if guide.id.trim().is_empty()
            || !guide_ids.insert(&guide.id)
            || !guide.weight.is_finite()
            || guide.weight <= 0.0
            || !guide
                .endpoints_source_normalized
                .iter()
                .flatten()
                .all(|value| value.is_finite())
        {
            return Err(
                "EditDocumentV2 geometry perspectiveCorrection contains an invalid guide"
                    .to_string(),
            );
        }
    }
    if let Some(plan) = &settings.resolved_plan {
        if plan.implementation_version != PERSPECTIVE_IMPLEMENTATION_VERSION_V1
            || !plan.confidence.is_finite()
            || !(0.0..=1.0).contains(&plan.confidence)
            || !plan.retained_area.is_finite()
            || !(0.0..=1.0).contains(&plan.retained_area)
            || plan.valid_polygon.len() < 4
            || !plan
                .source_to_corrected
                .iter()
                .chain(plan.corrected_to_source.iter())
                .flatten()
                .all(|value| value.is_finite())
            || !plan
                .valid_polygon
                .iter()
                .flatten()
                .all(|value| value.is_finite())
        {
            return Err(
                "EditDocumentV2 geometry perspectiveCorrection resolvedPlan is invalid".to_string(),
            );
        }
        if plan.suggested_crop.as_ref().is_some_and(|crop| {
            !crop.x.is_finite()
                || !crop.y.is_finite()
                || !crop.width.is_finite()
                || !crop.height.is_finite()
                || crop.width <= 0.0
                || crop.height <= 0.0
        }) {
            return Err(
                "EditDocumentV2 geometry perspectiveCorrection suggestedCrop is invalid"
                    .to_string(),
            );
        }
        if plan.analysis_identity.as_ref().is_some_and(|identity| {
            identity.analysis_dimensions.contains(&0)
                || identity.implementation_version != PERSPECTIVE_IMPLEMENTATION_VERSION_V1
        }) {
            return Err(
                "EditDocumentV2 geometry perspectiveCorrection analysisIdentity is invalid"
                    .to_string(),
            );
        }
    }
    crate::geometry::perspective::compile_perspective_plan(settings)
        .map(|_| ())
        .map_err(|error| {
            format!("EditDocumentV2 geometry perspectiveCorrection cannot compile: {error}")
        })
}

fn validate_perspective_param_contract(params: &Map<String, Value>) -> Result<(), String> {
    let Some(value) = params.get("perspectiveCorrection") else {
        // V2 documents persisted before Perspective node ownership compile through
        // their quarantined legacy field until the frontend migration reopens them.
        return Ok(());
    };
    let object = value.as_object().ok_or_else(|| {
        "EditDocumentV2 geometry perspectiveCorrection must be an object".to_string()
    })?;
    let fields = ["amount", "cropPolicy", "guides", "mode", "resolvedPlan"];
    if let Some(field) = fields.iter().find(|field| !object.contains_key(**field)) {
        return Err(format!(
            "EditDocumentV2 geometry perspectiveCorrection is missing field '{field}'"
        ));
    }
    if let Some(field) = object
        .keys()
        .find(|field| !fields.contains(&field.as_str()))
    {
        return Err(format!(
            "EditDocumentV2 geometry perspectiveCorrection contains unknown field '{field}'"
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LensDistortionParamsV2 {
    k1: f64,
    k2: f64,
    k3: f64,
    model: u8,
    tca_vb: f64,
    tca_vr: f64,
    vig_k1: f64,
    vig_k2: f64,
    vig_k3: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LensCorrectionV2 {
    // Optional only for v2 documents persisted before manual CA ownership.
    chromatic_aberration_blue_yellow: Option<f64>,
    chromatic_aberration_red_cyan: Option<f64>,
    lens_correction_mode: String,
    lens_distortion_amount: u16,
    lens_distortion_enabled: bool,
    lens_distortion_params: Option<LensDistortionParamsV2>,
    lens_maker: Option<String>,
    lens_model: Option<String>,
    lens_tca_amount: u16,
    lens_tca_enabled: bool,
    lens_vignette_amount: u16,
    lens_vignette_enabled: bool,
}

impl LensCorrectionV2 {
    fn validate(&self) -> Result<(), String> {
        if !matches!(self.lens_correction_mode.as_str(), "auto" | "manual") {
            return Err("EditDocumentV2 lens_correction mode must be auto or manual".to_string());
        }
        for (field, value) in [
            ("lensDistortionAmount", self.lens_distortion_amount),
            ("lensTcaAmount", self.lens_tca_amount),
            ("lensVignetteAmount", self.lens_vignette_amount),
        ] {
            if value > 200 {
                return Err(format!(
                    "EditDocumentV2 lens_correction field '{field}' must be finite and within [0, 200]"
                ));
            }
        }
        for (field, value) in [
            (
                "chromaticAberrationBlueYellow",
                self.chromatic_aberration_blue_yellow,
            ),
            (
                "chromaticAberrationRedCyan",
                self.chromatic_aberration_red_cyan,
            ),
        ] {
            if value.is_some_and(|value| !value.is_finite() || !(-100.0..=100.0).contains(&value)) {
                return Err(format!(
                    "EditDocumentV2 lens_correction field '{field}' must be finite and within [-100, 100]"
                ));
            }
        }
        if self.lens_maker.as_ref().is_some_and(|value| {
            let length = value.trim().chars().count();
            length == 0 || length > 160
        }) {
            return Err(
                "EditDocumentV2 lens_correction maker must contain 1..=160 characters".to_string(),
            );
        }
        if self.lens_model.as_ref().is_some_and(|value| {
            let length = value.trim().chars().count();
            length == 0 || length > 240
        }) {
            return Err(
                "EditDocumentV2 lens_correction model must contain 1..=240 characters".to_string(),
            );
        }
        if self.lens_model.is_some() && self.lens_maker.is_none() {
            return Err("EditDocumentV2 lens_correction model requires a lens maker".to_string());
        }
        if let Some(params) = &self.lens_distortion_params {
            let values = [
                params.k1,
                params.k2,
                params.k3,
                params.tca_vb,
                params.tca_vr,
                params.vig_k1,
                params.vig_k2,
                params.vig_k3,
            ];
            if values
                .iter()
                .any(|value| !value.is_finite() || !(-10.0..=10.0).contains(value))
                || params.model > 10
            {
                return Err(
                    "EditDocumentV2 lens_correction profile coefficients must be within [-10, 10] and model within [0, 10]"
                        .to_string(),
                );
            }
        }
        let _ = (
            self.lens_distortion_enabled,
            self.lens_tca_enabled,
            self.lens_vignette_enabled,
        );
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
    // Optional only for v2 documents persisted before local-contrast ownership.
    centré: Option<f64>,
    clarity: f64,
    color_noise_reduction: f64,
    // Optional only for v2 documents persisted before Deblur joined this node.
    deblur_enabled: Option<bool>,
    deblur_sigma_px: Option<f64>,
    deblur_strength: Option<f64>,
    dehaze: f64,
    denoise_contrast_protection: f64,
    denoise_detail: f64,
    denoise_natural_grain: f64,
    denoise_shadow_bias: f64,
    luma_noise_reduction: f64,
    local_contrast_halo_guard: Option<f64>,
    local_contrast_midtone_mask: Option<f64>,
    local_contrast_radius_px: Option<f64>,
    sharpness: f64,
    // Optional only for v2 documents persisted before Sharpness Threshold ownership.
    sharpness_threshold: Option<f64>,
    structure: Option<f64>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmEmulationV2 {
    film_emulation: Value,
}

impl FilmEmulationV2 {
    fn validate(&self) -> Result<(), String> {
        crate::render::film_emulation::parse_node(&serde_json::json!({
            "filmEmulation": self.film_emulation
        }))
        .map(|_| ())
        .map_err(|error| format!("EditDocumentV2 film_emulation is invalid: {error}"))
    }
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct ColorBalanceRgbRangeV2 {
    blue: f64,
    green: f64,
    red: f64,
}

impl ColorBalanceRgbRangeV2 {
    fn validate(&self, range: &str) -> Result<(), String> {
        for (channel, value) in [
            ("blue", self.blue),
            ("green", self.green),
            ("red", self.red),
        ] {
            if !value.is_finite() || !(-100.0..=100.0).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 color_balance_rgb field '{range}.{channel}' must be finite and within [-100, 100]"
                ));
            }
        }
        Ok(())
    }

    fn is_identity(self) -> bool {
        self.blue == 0.0 && self.green == 0.0 && self.red == 0.0
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColorBalanceRgbSettingsV2 {
    enabled: bool,
    highlights: ColorBalanceRgbRangeV2,
    midtones: ColorBalanceRgbRangeV2,
    preserve_luminance: bool,
    shadows: ColorBalanceRgbRangeV2,
}

impl ColorBalanceRgbSettingsV2 {
    fn validate(&self) -> Result<(), String> {
        self.shadows.validate("shadows")?;
        self.midtones.validate("midtones")?;
        self.highlights.validate("highlights")?;
        if self.enabled
            && self.shadows.is_identity()
            && self.midtones.is_identity()
            && self.highlights.is_identity()
        {
            return Err(
                "EditDocumentV2 enabled color_balance_rgb requires a non-zero channel response"
                    .to_string(),
            );
        }
        let _ = self.preserve_luminance;
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColorBalanceRgbV2 {
    color_balance_rgb: ColorBalanceRgbSettingsV2,
}

impl ColorBalanceRgbV2 {
    fn validate(&self) -> Result<(), String> {
        self.color_balance_rgb.validate()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct SelectiveColorHslValueV2 {
    hue: f64,
    luminance: f64,
    saturation: f64,
}

impl SelectiveColorHslValueV2 {
    fn validate(&self, range: &str) -> Result<(), String> {
        for (field, value) in [
            ("hue", self.hue),
            ("luminance", self.luminance),
            ("saturation", self.saturation),
        ] {
            if !value.is_finite() || !(-100.0..=100.0).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 selective_color_mixer field 'hsl.{range}.{field}' must be finite and within [-100, 100]"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectiveColorRangeControlV2 {
    center_hue_degrees: f64,
    falloff_smoothness: f64,
    width_degrees: f64,
}

impl SelectiveColorRangeControlV2 {
    fn validate(&self, range: &str) -> Result<(), String> {
        for (field, value, minimum, maximum, maximum_is_exclusive) in [
            (
                "centerHueDegrees",
                self.center_hue_degrees,
                0.0,
                360.0,
                true,
            ),
            (
                "falloffSmoothness",
                self.falloff_smoothness,
                0.25,
                4.0,
                false,
            ),
            ("widthDegrees", self.width_degrees, 10.0, 180.0, false),
        ] {
            let in_range = value >= minimum
                && if maximum_is_exclusive {
                    value < maximum
                } else {
                    value <= maximum
                };
            if !value.is_finite() || !in_range {
                let upper = if maximum_is_exclusive { ")" } else { "]" };
                return Err(format!(
                    "EditDocumentV2 selective_color_mixer field 'selectiveColorRangeControls.{range}.{field}' must be finite and within [{minimum}, {maximum}{upper}"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct SelectiveColorHslV2 {
    aquas: SelectiveColorHslValueV2,
    blues: SelectiveColorHslValueV2,
    greens: SelectiveColorHslValueV2,
    magentas: SelectiveColorHslValueV2,
    oranges: SelectiveColorHslValueV2,
    purples: SelectiveColorHslValueV2,
    reds: SelectiveColorHslValueV2,
    yellows: SelectiveColorHslValueV2,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct SelectiveColorRangeControlsV2 {
    aquas: SelectiveColorRangeControlV2,
    blues: SelectiveColorRangeControlV2,
    greens: SelectiveColorRangeControlV2,
    magentas: SelectiveColorRangeControlV2,
    oranges: SelectiveColorRangeControlV2,
    purples: SelectiveColorRangeControlV2,
    reds: SelectiveColorRangeControlV2,
    yellows: SelectiveColorRangeControlV2,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectiveColorMixerV2 {
    hsl: SelectiveColorHslV2,
    selective_color_range_controls: SelectiveColorRangeControlsV2,
}

impl SelectiveColorMixerV2 {
    fn validate(&self) -> Result<(), String> {
        for (range, hsl, control) in [
            (
                "aquas",
                self.hsl.aquas,
                self.selective_color_range_controls.aquas,
            ),
            (
                "blues",
                self.hsl.blues,
                self.selective_color_range_controls.blues,
            ),
            (
                "greens",
                self.hsl.greens,
                self.selective_color_range_controls.greens,
            ),
            (
                "magentas",
                self.hsl.magentas,
                self.selective_color_range_controls.magentas,
            ),
            (
                "oranges",
                self.hsl.oranges,
                self.selective_color_range_controls.oranges,
            ),
            (
                "purples",
                self.hsl.purples,
                self.selective_color_range_controls.purples,
            ),
            (
                "reds",
                self.hsl.reds,
                self.selective_color_range_controls.reds,
            ),
            (
                "yellows",
                self.hsl.yellows,
                self.selective_color_range_controls.yellows,
            ),
        ] {
            hsl.validate(range)?;
            control.validate(range)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct ChannelMixerRowV2 {
    blue: f64,
    constant: f64,
    green: f64,
    red: f64,
}

impl ChannelMixerRowV2 {
    fn validate(&self) -> Result<(), String> {
        for (field, value, minimum, maximum) in [
            ("blue", self.blue, -200.0, 200.0),
            ("constant", self.constant, -100.0, 100.0),
            ("green", self.green, -200.0, 200.0),
            ("red", self.red, -200.0, 200.0),
        ] {
            if !value.is_finite() || value < minimum || value > maximum {
                return Err(format!(
                    "EditDocumentV2 channel_mixer field '{field}' must be finite and within [{minimum}, {maximum}]"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChannelMixerSettingsV2 {
    blue: ChannelMixerRowV2,
    enabled: bool,
    green: ChannelMixerRowV2,
    preserve_luminance: bool,
    red: ChannelMixerRowV2,
}

impl ChannelMixerSettingsV2 {
    fn validate(&self) -> Result<(), String> {
        self.red.validate()?;
        self.green.validate()?;
        self.blue.validate()?;
        let identity = [
            (self.red, [100.0, 0.0, 0.0, 0.0]),
            (self.green, [0.0, 100.0, 0.0, 0.0]),
            (self.blue, [0.0, 0.0, 100.0, 0.0]),
        ]
        .iter()
        .all(|(row, expected)| [row.red, row.green, row.blue, row.constant] == *expected);
        if self.enabled && identity {
            return Err("EditDocumentV2 enabled channel_mixer must not be identity".to_string());
        }
        let _ = self.preserve_luminance;
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChannelMixerV2 {
    channel_mixer: ChannelMixerSettingsV2,
}

impl ChannelMixerV2 {
    fn validate(&self) -> Result<(), String> {
        self.channel_mixer.validate()
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LumaLevelsSettingsV2 {
    enabled: bool,
    gamma: f64,
    input_black: f64,
    input_white: f64,
    output_black: f64,
    output_white: f64,
}

impl LumaLevelsSettingsV2 {
    fn validate(&self) -> Result<(), String> {
        for (field, value, minimum, maximum) in [
            ("gamma", self.gamma, 0.1, 5.0),
            ("inputBlack", self.input_black, 0.0, 1.0),
            ("inputWhite", self.input_white, 0.0, 1.0),
            ("outputBlack", self.output_black, 0.0, 1.0),
            ("outputWhite", self.output_white, 0.0, 1.0),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 luma_levels field '{field}' must be finite and within [{minimum}, {maximum}]"
                ));
            }
        }
        if self.input_black >= self.input_white {
            return Err(
                "EditDocumentV2 luma_levels inputBlack must be below inputWhite".to_string(),
            );
        }
        if self.output_black >= self.output_white {
            return Err(
                "EditDocumentV2 luma_levels outputBlack must be below outputWhite".to_string(),
            );
        }
        let _ = self.enabled;
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct LumaLevelsV2 {
    levels: LumaLevelsSettingsV2,
}

impl LumaLevelsV2 {
    fn validate(&self) -> Result<(), String> {
        self.levels.validate()
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum BlackWhiteMixerProcessV2 {
    LegacyFixedBandV1,
    NeutralPanchromaticV1,
    ContinuousSensitivityV1,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum BlackWhiteMixerPresetV2 {
    Manual,
    NeutralPanchromatic,
    YellowFilter,
    OrangeFilter,
    RedFilter,
    GreenFilter,
    BlueFilter,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum BlackWhiteMixerSourceClassV2 {
    ColorSource,
    MonochromeSensor,
    EncodedGrayscale,
    AlreadyMonochromeWorking,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct BlackWhiteMixerWeightsV2 {
    aquas: f64,
    blues: f64,
    greens: f64,
    magentas: f64,
    oranges: f64,
    purples: f64,
    reds: f64,
    yellows: f64,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlackWhiteMixerSettingsV2 {
    enabled: bool,
    preset_id: BlackWhiteMixerPresetV2,
    process: BlackWhiteMixerProcessV2,
    source_class: BlackWhiteMixerSourceClassV2,
    weights: BlackWhiteMixerWeightsV2,
}

impl BlackWhiteMixerSettingsV2 {
    fn validate(&self) -> Result<(), String> {
        let weights = [
            self.weights.aquas,
            self.weights.blues,
            self.weights.greens,
            self.weights.magentas,
            self.weights.oranges,
            self.weights.purples,
            self.weights.reds,
            self.weights.yellows,
        ];
        if weights
            .iter()
            .any(|value| !value.is_finite() || !(-100.0..=100.0).contains(value))
        {
            return Err(
                "EditDocumentV2 black_white_mixer weights must be finite within [-100, 100]"
                    .to_string(),
            );
        }
        if self.enabled
            && self.process == BlackWhiteMixerProcessV2::LegacyFixedBandV1
            && weights.iter().all(|value| *value == 0.0)
        {
            return Err(
                "EditDocumentV2 enabled legacy black_white_mixer requires a non-zero channel response"
                    .to_string(),
            );
        }
        let _ = (&self.preset_id, &self.source_class);
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlackWhiteMixerV2 {
    black_white_mixer: BlackWhiteMixerSettingsV2,
}

impl BlackWhiteMixerV2 {
    fn validate(&self) -> Result<(), String> {
        self.black_white_mixer.validate()
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColorCalibrationSettingsV2 {
    blue_hue: f64,
    blue_saturation: f64,
    green_hue: f64,
    green_saturation: f64,
    red_hue: f64,
    red_saturation: f64,
    shadows_tint: f64,
}

impl ColorCalibrationSettingsV2 {
    fn validate(&self) -> Result<(), String> {
        for (field, value) in [
            ("blueHue", self.blue_hue),
            ("blueSaturation", self.blue_saturation),
            ("greenHue", self.green_hue),
            ("greenSaturation", self.green_saturation),
            ("redHue", self.red_hue),
            ("redSaturation", self.red_saturation),
            ("shadowsTint", self.shadows_tint),
        ] {
            if !value.is_finite() || !(-100.0..=100.0).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 color_calibration field '{field}' must be finite and within [-100, 100]"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColorCalibrationV2 {
    color_calibration: ColorCalibrationSettingsV2,
}

impl ColorCalibrationV2 {
    fn validate(&self) -> Result<(), String> {
        self.color_calibration.validate()
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyColorGradingRangeV2 {
    hue: f64,
    luminance: f64,
    saturation: f64,
}

impl LegacyColorGradingRangeV2 {
    fn validate(&self) -> Result<(), String> {
        if point_color_in_range(self.hue, 0.0, 360.0)
            && point_color_in_range(self.luminance, -100.0, 100.0)
            && point_color_in_range(self.saturation, 0.0, 100.0)
        {
            return Ok(());
        }
        Err("EditDocumentV2 perceptual_grading wheel range is invalid".to_string())
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyColorGradingV2 {
    balance: f64,
    blending: f64,
    global: LegacyColorGradingRangeV2,
    highlights: LegacyColorGradingRangeV2,
    midtones: LegacyColorGradingRangeV2,
    shadows: LegacyColorGradingRangeV2,
}

impl LegacyColorGradingV2 {
    fn validate(&self) -> Result<(), String> {
        if !point_color_in_range(self.balance, -100.0, 100.0)
            || !point_color_in_range(self.blending, 0.0, 100.0)
        {
            return Err(
                "EditDocumentV2 perceptual_grading balance or blending is invalid".to_string(),
            );
        }
        self.global.validate()?;
        self.highlights.validate()?;
        self.midtones.validate()?;
        self.shadows.validate()
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PerceptualGradingV2 {
    color_grading: LegacyColorGradingV2,
    perceptual_grading_v1: PerceptualGradingSettingsV1,
}

impl PerceptualGradingV2 {
    fn validate(&self) -> Result<(), String> {
        self.color_grading.validate()?;
        PerceptualGradingPlanV1::compile(self.perceptual_grading_v1.clone())
            .map(|_| ())
            .map_err(|error| format!("EditDocumentV2 perceptual_grading is invalid: {error:?}"))
    }
}

impl PointColorV2 {
    fn validate(&self) -> Result<(), String> {
        self.point_color.validate()
    }
}

impl DetailDenoiseDehazeV2 {
    fn validate(&self) -> Result<(), String> {
        if self.deblur_strength.is_some_and(|value| {
            !value.is_finite() || value.fract() != 0.0 || !(0.0..=100.0).contains(&value)
        }) {
            return Err(
                "EditDocumentV2 detail_denoise_dehaze field 'deblurStrength' must be an integer within [0, 100]"
                    .to_string(),
            );
        }
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
        for (field, value, minimum, maximum) in [
            ("centré", self.centré, -100.0, 100.0),
            (
                "localContrastHaloGuard",
                self.local_contrast_halo_guard,
                0.0,
                100.0,
            ),
            (
                "localContrastMidtoneMask",
                self.local_contrast_midtone_mask,
                0.0,
                100.0,
            ),
            (
                "localContrastRadiusPx",
                self.local_contrast_radius_px,
                4.0,
                96.0,
            ),
            ("structure", self.structure, -100.0, 100.0),
            ("sharpnessThreshold", self.sharpness_threshold, 0.0, 80.0),
        ] {
            if value
                .is_some_and(|value| !value.is_finite() || !(minimum..=maximum).contains(&value))
            {
                return Err(format!(
                    "EditDocumentV2 detail_denoise_dehaze field '{field}' must be finite and within [{minimum}, {maximum}]"
                ));
            }
        }
        if self
            .deblur_sigma_px
            .is_some_and(|value| !value.is_finite() || !(0.45..=1.35).contains(&value))
        {
            return Err(
                "EditDocumentV2 detail_denoise_dehaze field 'deblurSigmaPx' must be finite and within [0.45, 1.35]"
                    .to_string(),
            );
        }
        let _ = self.deblur_enabled;
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
    #[serde(default = "default_mask_edit_nodes")]
    edit_nodes: BTreeMap<MaskEditNodeTypeV2, MaskEditNodeEnvelopeV2>,
    #[serde(default)]
    edit_node_quarantine: BTreeMap<String, Value>,
    #[serde(default = "mask_edit_node_schema_version")]
    edit_node_schema_version: u8,
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

#[derive(Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum MaskEditNodeTypeV2 {
    Basic,
    Color,
    Curves,
    Details,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaskEditNodeEnvelopeV2 {
    enabled: bool,
}

fn mask_edit_node_schema_version() -> u8 {
    1
}

fn default_mask_edit_nodes() -> BTreeMap<MaskEditNodeTypeV2, MaskEditNodeEnvelopeV2> {
    [
        MaskEditNodeTypeV2::Basic,
        MaskEditNodeTypeV2::Color,
        MaskEditNodeTypeV2::Curves,
        MaskEditNodeTypeV2::Details,
    ]
    .into_iter()
    .map(|node_type| (node_type, MaskEditNodeEnvelopeV2 { enabled: true }))
    .collect()
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

        let section_visibility = ["basic", "color", "curves", "details"]
            .into_iter()
            .map(|section| {
                let enabled = self
                    .nodes
                    .iter()
                    .filter(|(node_type, _)| node_type.editor_section() == Some(section))
                    .all(|(_, node)| node.enabled);
                (section.to_string(), Value::Bool(enabled))
            })
            .collect();
        adjustments.insert(
            "sectionVisibility".to_string(),
            Value::Object(section_visibility),
        );
        let effects_enabled = self
            .nodes
            .get(&EditNodeTypeV2::DisplayCreative)
            .is_none_or(|node| node.enabled);
        adjustments.insert("effectsEnabled".to_string(), Value::Bool(effects_enabled));

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
        if self.nodes.contains_key(&EditNodeTypeV2::ColorPresence)
            && self
                .nodes
                .get(&EditNodeTypeV2::SceneGlobalColorTone)
                .is_some_and(|node| {
                    ["hue", "saturation", "vibrance"]
                        .iter()
                        .any(|field| node.params.contains_key(*field))
                })
        {
            return Err(
                "EditDocumentV2 color_presence conflicts with legacy scene-global Color Presence fields"
                    .to_string(),
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

pub(crate) fn validate_edit_document_v2(value: &Value) -> Result<(), String> {
    let document: EditDocumentV2 = serde_json::from_value(value.clone())
        .map_err(|error| format!("EditDocumentV2 persistence payload is invalid: {error}"))?;
    document.validate_document_contract()
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
        EditNodeTypeV2::ColorPresence => {
            let params =
                serde_json::from_value::<ColorPresenceParamsV2>(Value::Object(node.params.clone()))
                    .map_err(|error| {
                        format!("EditDocumentV2 node 'color_presence' has invalid params: {error}")
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
        EditNodeTypeV2::ColorBalanceRgb => {
            parse_color_balance_rgb(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::SelectiveColorMixer => {
            parse_selective_color_mixer(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::BlackWhiteMixer => {
            parse_black_white_mixer(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::ChannelMixer => {
            parse_channel_mixer(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::LumaLevels => {
            parse_luma_levels(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::PerceptualGrading => {
            parse_perceptual_grading(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::ColorCalibration => {
            parse_color_calibration(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::DisplayCreative => {
            parse_display_creative(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::FilmEmulation => {
            let film: FilmEmulationV2 = serde_json::from_value(Value::Object(node.params.clone()))
                .map_err(|error| format!("EditDocumentV2 film_emulation is invalid: {error}"))?;
            film.validate()?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::Geometry => {
            parse_geometry(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::LensCorrection => {
            parse_lens_correction(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::SourceArtifacts => {
            parse_source_artifacts(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::Layers => {
            parse_layers(&node.params)?;
            compile_layers_legacy_projection(&node.params)
        }
    }
}

fn compile_layers_legacy_projection(
    params: &Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    let mut compiled = params.clone();
    let Some(masks) = compiled.get_mut("masks").and_then(Value::as_array_mut) else {
        return Err("EditDocumentV2 layers masks must be an array".to_string());
    };
    for mask in masks {
        let Some(mask_object) = mask.as_object_mut() else {
            return Err("EditDocumentV2 layer must be an object".to_string());
        };
        let edit_nodes = mask_object
            .remove("editNodes")
            .and_then(|nodes| nodes.as_object().cloned())
            .unwrap_or_else(|| {
                let legacy_visibility = mask_object
                    .get("adjustments")
                    .and_then(|adjustments| adjustments.get("sectionVisibility"))
                    .and_then(Value::as_object);
                ["basic", "color", "curves", "details"]
                    .into_iter()
                    .map(|node_type| {
                        let enabled = legacy_visibility
                            .and_then(|visibility| visibility.get(node_type))
                            .and_then(Value::as_bool)
                            .unwrap_or(true);
                        (
                            node_type.to_string(),
                            serde_json::json!({ "enabled": enabled }),
                        )
                    })
                    .collect()
            });
        let visibility = edit_nodes
            .into_iter()
            .map(|(node_type, envelope)| {
                let enabled = envelope
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| {
                        format!("EditDocumentV2 layer node '{node_type}' enabled must be boolean")
                    })?;
                Ok((node_type, Value::Bool(enabled)))
            })
            .collect::<Result<Map<String, Value>, String>>()?;
        let adjustments = mask_object
            .get_mut("adjustments")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| "EditDocumentV2 layer adjustments must be an object".to_string())?;
        adjustments.insert("sectionVisibility".to_string(), Value::Object(visibility));
        mask_object.remove("editNodeQuarantine");
        mask_object.remove("editNodeSchemaVersion");
    }
    Ok(compiled)
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

fn parse_color_balance_rgb(params: &Map<String, Value>) -> Result<ColorBalanceRgbV2, String> {
    let color_balance_rgb: ColorBalanceRgbV2 =
        serde_json::from_value(Value::Object(params.clone()))
            .map_err(|error| format!("EditDocumentV2 color_balance_rgb is invalid: {error}"))?;
    color_balance_rgb.validate()?;
    Ok(color_balance_rgb)
}

fn parse_selective_color_mixer(
    params: &Map<String, Value>,
) -> Result<SelectiveColorMixerV2, String> {
    let selective_color_mixer: SelectiveColorMixerV2 =
        serde_json::from_value(Value::Object(params.clone()))
            .map_err(|error| format!("EditDocumentV2 selective_color_mixer is invalid: {error}"))?;
    selective_color_mixer.validate()?;
    Ok(selective_color_mixer)
}

fn parse_black_white_mixer(params: &Map<String, Value>) -> Result<BlackWhiteMixerV2, String> {
    let black_white_mixer: BlackWhiteMixerV2 =
        serde_json::from_value(Value::Object(params.clone()))
            .map_err(|error| format!("EditDocumentV2 black_white_mixer is invalid: {error}"))?;
    black_white_mixer.validate()?;
    Ok(black_white_mixer)
}

fn parse_channel_mixer(params: &Map<String, Value>) -> Result<ChannelMixerV2, String> {
    let channel_mixer: ChannelMixerV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 channel_mixer is invalid: {error}"))?;
    channel_mixer.validate()?;
    Ok(channel_mixer)
}

fn parse_luma_levels(params: &Map<String, Value>) -> Result<LumaLevelsV2, String> {
    let levels: LumaLevelsV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 luma_levels is invalid: {error}"))?;
    levels.validate()?;
    Ok(levels)
}

fn parse_perceptual_grading(params: &Map<String, Value>) -> Result<PerceptualGradingV2, String> {
    let perceptual_grading: PerceptualGradingV2 =
        serde_json::from_value(Value::Object(params.clone()))
            .map_err(|error| format!("EditDocumentV2 perceptual_grading is invalid: {error}"))?;
    perceptual_grading.validate()?;
    Ok(perceptual_grading)
}

fn parse_color_calibration(params: &Map<String, Value>) -> Result<ColorCalibrationV2, String> {
    let color_calibration: ColorCalibrationV2 =
        serde_json::from_value(Value::Object(params.clone()))
            .map_err(|error| format!("EditDocumentV2 color_calibration is invalid: {error}"))?;
    color_calibration.validate()?;
    Ok(color_calibration)
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
    validate_perspective_param_contract(params)?;
    let geometry: GeometryV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 geometry is invalid: {error}"))?;
    geometry.validate()?;
    Ok(geometry)
}

fn parse_lens_correction(params: &Map<String, Value>) -> Result<LensCorrectionV2, String> {
    let lens_correction: LensCorrectionV2 =
        serde_json::from_value(Value::Object(params.clone()))
            .map_err(|error| format!("EditDocumentV2 lens_correction is invalid: {error}"))?;
    lens_correction.validate()?;
    Ok(lens_correction)
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
        if layer.edit_nodes.len() != 4 {
            return Err("EditDocumentV2 layer must contain every mask edit node".to_string());
        }
        if layer.edit_node_schema_version != 1 {
            return Err("EditDocumentV2 layer editNodeSchemaVersion must be 1".to_string());
        }
        let _ = &layer.edit_node_quarantine;
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
    use glam::Vec3;
    use serde_json::{Value, json};

    use super::super::parse::get_all_adjustments_from_json;
    use super::EditDocumentV2;
    use crate::color::mixer_render::{
        apply_black_white_mixer, apply_channel_mixer, apply_color_balance_rgb,
    };
    use crate::render::cpu_edit_graph::{
        apply_creative_color, apply_hsl_panel, apply_hue_shift, apply_local_contrast,
        apply_luma_levels,
    };
    use crate::render::film_emulation::{
        apply_pixel as apply_film_pixel, parse_node as parse_film_node,
    };

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
            "centré": -9,
            "clarity": 16,
            "colorNoiseReduction": 0,
            "deblurEnabled": true,
            "deblurSigmaPx": 0.8,
            "deblurStrength": 32,
            "dehaze": 8,
            "denoiseContrastProtection": 50,
            "denoiseDetail": 50,
            "denoiseNaturalGrain": 0,
            "denoiseShadowBias": 0,
            "localContrastHaloGuard": 62,
            "localContrastMidtoneMask": 44,
            "localContrastRadiusPx": 36,
            "lumaNoiseReduction": 5,
            "sharpness": 24,
            "sharpnessThreshold": 20,
            "structure": 21
        })
    }

    fn color_balance_rgb_params() -> Value {
        json!({
            "colorBalanceRgb": {
                "enabled": true,
                "highlights": { "blue": 8, "green": -10, "red": 20 },
                "midtones": { "blue": 8, "green": -10, "red": 20 },
                "preserveLuminance": false,
                "shadows": { "blue": 8, "green": -10, "red": 20 }
            }
        })
    }

    fn color_balance_rgb_node() -> Value {
        json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": color_balance_rgb_params(),
            "process": "scene_referred_v2",
            "type": "color_balance_rgb"
        })
    }

    fn selective_color_mixer_params() -> Value {
        json!({
            "hsl": {
                "aquas": { "hue": 0, "luminance": 0, "saturation": 0 },
                "blues": { "hue": 0, "luminance": 0, "saturation": 0 },
                "greens": { "hue": 0, "luminance": 0, "saturation": 0 },
                "magentas": { "hue": 0, "luminance": 0, "saturation": 0 },
                "oranges": { "hue": 0, "luminance": 0, "saturation": 0 },
                "purples": { "hue": 0, "luminance": 0, "saturation": 0 },
                "reds": { "hue": 20, "luminance": 12, "saturation": 30 },
                "yellows": { "hue": 0, "luminance": 0, "saturation": 0 }
            },
            "selectiveColorRangeControls": {
                "aquas": { "centerHueDegrees": 180, "falloffSmoothness": 1.5, "widthDegrees": 60 },
                "blues": { "centerHueDegrees": 225, "falloffSmoothness": 1.5, "widthDegrees": 60 },
                "greens": { "centerHueDegrees": 115, "falloffSmoothness": 1.5, "widthDegrees": 90 },
                "magentas": { "centerHueDegrees": 330, "falloffSmoothness": 1.5, "widthDegrees": 50 },
                "oranges": { "centerHueDegrees": 25, "falloffSmoothness": 1.5, "widthDegrees": 45 },
                "purples": { "centerHueDegrees": 280, "falloffSmoothness": 1.5, "widthDegrees": 55 },
                "reds": { "centerHueDegrees": 358, "falloffSmoothness": 1.5, "widthDegrees": 35 },
                "yellows": { "centerHueDegrees": 60, "falloffSmoothness": 1.5, "widthDegrees": 40 }
            }
        })
    }

    fn selective_color_mixer_node() -> Value {
        json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": selective_color_mixer_params(),
            "process": "scene_referred_v2",
            "type": "selective_color_mixer"
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

    fn film_emulation_params() -> Value {
        json!({
            "filmEmulation": {
                "contractVersion": 1,
                "enabled": true,
                "mix": 0.65,
                "nodeType": "film_emulation",
                "profileRef": {
                    "contentSha256": "sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef",
                    "id": "rapidraw.reference_film.v1",
                    "version": "1"
                },
                "seedPolicy": "source_stable_v1",
                "workingSpace": "acescg_linear_v1"
            }
        })
    }

    fn black_white_mixer_params() -> Value {
        json!({
            "blackWhiteMixer": {
                "enabled": true,
                "presetId": "orange_filter",
                "process": "continuous_sensitivity_v1",
                "sourceClass": "color_source",
                "weights": {
                    "aquas": -12,
                    "blues": -30,
                    "greens": 5,
                    "magentas": 8,
                    "oranges": 38,
                    "purples": -6,
                    "reds": 24,
                    "yellows": 20
                }
            }
        })
    }

    fn channel_mixer_params() -> Value {
        json!({
            "channelMixer": {
                "blue": { "blue": 100, "constant": 0, "green": 0, "red": 0 },
                "enabled": true,
                "green": { "blue": 0, "constant": 0, "green": 100, "red": 0 },
                "preserveLuminance": false,
                "red": { "blue": -8, "constant": 2, "green": 24, "red": 112 }
            }
        })
    }

    fn luma_levels_params() -> Value {
        json!({
            "levels": {
                "enabled": true,
                "gamma": 2,
                "inputBlack": 0.1,
                "inputWhite": 0.9,
                "outputBlack": 0.2,
                "outputWhite": 0.8
            }
        })
    }

    fn luma_levels_node() -> Value {
        json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": luma_levels_params(),
            "process": "scene_referred_v2",
            "type": "luma_levels"
        })
    }

    fn perceptual_grading_params() -> Value {
        let range = json!({
            "brilliance": 0,
            "chroma": 0,
            "hueDegrees": 0,
            "luminanceEv": 0,
            "saturation": 0
        });
        json!({
            "colorGrading": {
                "balance": 20,
                "blending": 50,
                "global": { "hue": 0, "luminance": 0, "saturation": 0 },
                "highlights": { "hue": 0, "luminance": 0, "saturation": 0 },
                "midtones": { "hue": 35, "luminance": 5, "saturation": 24 },
                "shadows": { "hue": 0, "luminance": 0, "saturation": 0 }
            },
            "perceptualGradingV1": {
                "balance": 0.2,
                "blending": 0.5,
                "falloff": 1,
                "global": range,
                "highlightFulcrumEv": 2,
                "highlights": range,
                "midtones": {
                    "brilliance": 0,
                    "chroma": 0.0576,
                    "hueDegrees": 35,
                    "luminanceEv": 0.1,
                    "saturation": 0
                },
                "neutralProtection": 0.5,
                "perceptualModel": "oklab_d65_from_acescg_v1",
                "shadowFulcrumEv": -2,
                "shadows": range,
                "skinProtection": 0
            }
        })
    }

    fn color_calibration_params() -> Value {
        json!({
            "colorCalibration": {
                "blueHue": -6,
                "blueSaturation": 9,
                "greenHue": 4,
                "greenSaturation": -3,
                "redHue": 12,
                "redSaturation": 18,
                "shadowsTint": -8
            }
        })
    }

    fn document_with_legacy(legacy: Value) -> Value {
        let mut document = json!({
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
                "black_white_mixer": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": black_white_mixer_params(),
                    "process": "scene_referred_v2",
                    "type": "black_white_mixer"
                },
                "channel_mixer": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": channel_mixer_params(),
                    "process": "scene_referred_v2",
                    "type": "channel_mixer"
                },
                "perceptual_grading": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": perceptual_grading_params(),
                    "process": "scene_referred_v2",
                    "type": "perceptual_grading"
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
                "color_calibration": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": color_calibration_params(),
                    "process": "scene_referred_v2",
                    "type": "color_calibration"
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
                "lens_correction": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": {
                        "chromaticAberrationBlueYellow": -8,
                        "chromaticAberrationRedCyan": 12,
                        "lensCorrectionMode": "manual",
                        "lensDistortionAmount": 100,
                        "lensDistortionEnabled": true,
                        "lensDistortionParams": null,
                        "lensMaker": null,
                        "lensModel": null,
                        "lensTcaAmount": 100,
                        "lensTcaEnabled": true,
                        "lensVignetteAmount": 100,
                        "lensVignetteEnabled": true
                    },
                    "process": "legacy_pipeline_v1",
                    "type": "lens_correction"
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
        });
        document["nodes"]["color_balance_rgb"] = color_balance_rgb_node();
        document["nodes"]["luma_levels"] = luma_levels_node();
        document["nodes"]["selective_color_mixer"] = selective_color_mixer_node();
        document
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
            "sectionVisibility": { "basic": true, "color": true, "curves": true, "details": true },
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
            "blackWhiteMixer": black_white_mixer_params()["blackWhiteMixer"].clone(),
            "brightness": 0.1,
            "cameraProfile": "camera_standard",
            "clarity": 16,
            "colorNoiseReduction": 0,
            "colorCalibration": color_calibration_params()["colorCalibration"].clone(),
            "contrast": 18,
            "crop": { "height": 80, "unit": "%", "width": 90, "x": 4, "y": 6 },
            "deblurEnabled": true,
            "deblurSigmaPx": 0.8,
            "deblurStrength": 32,
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
            "colorGrading": perceptual_grading_params()["colorGrading"].clone(),
            "perceptualGradingV1": perceptual_grading_params()["perceptualGradingV1"].clone(),
            "pointColor": point_color_params()["pointColor"].clone(),
            "rawEngineEditGraphVersion": 2,
            "rotation": 0.5,
            "saturation": 7,
            "effectsEnabled": true,
            "shadows": 14,
            "sharpness": 24,
            "temperature": 12,
            "tint": -3,
            "toneMapper": "basic",
            "vibrance": 11,
            "whites": 9
        });
        expected["colorBalanceRgb"] = color_balance_rgb_params()["colorBalanceRgb"].clone();
        expected["levels"] = luma_levels_params()["levels"].clone();
        expected["hsl"] = selective_color_mixer_params()["hsl"].clone();
        expected["selectiveColorRangeControls"] =
            selective_color_mixer_params()["selectiveColorRangeControls"].clone();
        expected["cameraProfileAmount"] = json!(100);
        expected["centré"] = json!(-9);
        expected["localContrastHaloGuard"] = json!(62);
        expected["localContrastMidtoneMask"] = json!(44);
        expected["localContrastRadiusPx"] = json!(36);
        expected["sharpnessThreshold"] = json!(20);
        expected["structure"] = json!(21);
        expected["effectsEnabled"] = json!(true);
        expected["sectionVisibility"] =
            json!({ "basic": true, "color": true, "curves": true, "details": true });
        expected["channelMixer"] = channel_mixer_params()["channelMixer"].clone();
        expected["chromaticAberrationBlueYellow"] = json!(-8);
        expected["chromaticAberrationRedCyan"] = json!(12);
        expected["lensCorrectionMode"] = json!("manual");
        expected["lensDistortionAmount"] = json!(100);
        expected["lensDistortionEnabled"] = json!(true);
        expected["lensDistortionParams"] = Value::Null;
        expected["lensMaker"] = Value::Null;
        expected["lensModel"] = Value::Null;
        expected["lensTcaAmount"] = json!(100);
        expected["lensTcaEnabled"] = json!(true);
        expected["lensVignetteAmount"] = json!(100);
        expected["lensVignetteEnabled"] = json!(true);
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
        let source = [4.0, 0.4, 0.08];
        let monochrome =
            apply_black_white_mixer(source, compiled_render.global.black_white_mixer, true);
        assert_eq!(monochrome, [monochrome[0]; 3]);
        assert_ne!(monochrome, source);
        assert!(monochrome[0].is_finite());
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
    fn editor_section_enablement_compiles_to_render_authority_once() {
        let mut value = document_with_legacy(json!({}));
        for node_type in [
            "scene_global_color_tone",
            "tone_equalizer",
            "scene_curve",
            "detail_denoise_dehaze",
            "point_color",
            "black_white_mixer",
            "channel_mixer",
            "perceptual_grading",
            "camera_input",
            "color_calibration",
            "display_creative",
        ] {
            value["nodes"][node_type]["enabled"] = json!(false);
        }
        let document: EditDocumentV2 = serde_json::from_value(value).expect("valid document");
        let compiled = document
            .into_render_adjustments()
            .expect("compiled disabled document");

        assert_eq!(
            compiled["sectionVisibility"],
            json!({ "basic": false, "color": false, "curves": false, "details": false })
        );
        assert_eq!(compiled["effectsEnabled"], false);
        assert!(compiled.get("exposure").is_none());
        assert!(compiled.get("sceneCurveV1").is_none());
        assert!(compiled.get("clarity").is_none());
        assert!(compiled.get("cameraProfile").is_none());
        assert!(compiled.get("grainAmount").is_none());
        assert_eq!(
            serde_json::to_string(&compiled)
                .expect("compiled JSON")
                .matches("effectsEnabled")
                .count(),
            1,
            "Effects render authority must project exactly once"
        );
    }

    #[test]
    fn pre_envelope_layer_visibility_compiles_without_losing_the_mask() {
        let legacy_layer = json!({
            "adjustments": {
                "exposure": 0.4,
                "sectionVisibility": { "basic": false, "color": true, "curves": false, "details": true }
            },
            "id": "legacy-layer",
            "invert": false,
            "name": "Legacy layer",
            "opacity": 72,
            "subMasks": [],
            "visible": true
        });
        let mut value = document_with_legacy(json!({}));
        value["layers"] = json!({ "masks": [legacy_layer] });
        value["nodes"]["layers"]["params"] = json!({ "masks": [legacy_layer] });
        let document: EditDocumentV2 =
            serde_json::from_value(value).expect("valid legacy document");
        let compiled = document
            .into_render_adjustments()
            .expect("compiled legacy layer");
        let layer = &compiled["masks"][0];

        assert_eq!(layer["id"], "legacy-layer");
        assert_eq!(layer["adjustments"]["exposure"], 0.4);
        assert_eq!(
            layer["adjustments"]["sectionVisibility"],
            json!({ "basic": false, "color": true, "curves": false, "details": true })
        );
        assert!(layer.get("editNodes").is_none());
        assert!(layer.get("editNodeSchemaVersion").is_none());
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
    fn color_presence_compiler_drives_native_pixel_output_and_preserves_legacy_parity() {
        let mut value = document_with_legacy(json!({}));
        value["nodes"]["scene_global_color_tone"]["params"]
            .as_object_mut()
            .expect("scene-global params")
            .remove("saturation");
        value["nodes"]["color_presence"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "hue": 36, "saturation": 7, "vibrance": 48 },
            "process": "scene_referred_v2",
            "type": "color_presence"
        });
        let compiled = serde_json::from_value::<EditDocumentV2>(value)
            .expect("valid Color Presence document")
            .into_render_adjustments()
            .expect("Color Presence node compiles");
        assert_eq!(compiled["hue"], json!(36));
        assert_eq!(compiled["saturation"], json!(7));
        assert_eq!(compiled["vibrance"], json!(48));
        let adjustments = get_all_adjustments_from_json(&compiled, false, None);
        assert!((adjustments.global.hue - 36.0).abs() <= f32::EPSILON);
        assert!((adjustments.global.saturation - 0.07).abs() <= f32::EPSILON);
        assert!((adjustments.global.vibrance - 0.48).abs() <= f32::EPSILON);
        let input = Vec3::new(0.78, 0.24, 0.09);
        let output = apply_creative_color(
            apply_hue_shift(input, adjustments.global.hue),
            adjustments.global.saturation,
            adjustments.global.vibrance,
        );
        assert!(
            output.distance(input) > 1.0e-3,
            "Color Presence node must alter a chromatic pixel: {output:?}"
        );

        let legacy = serde_json::from_value::<EditDocumentV2>(document_with_legacy(json!({
            "hue": 36,
            "vibrance": 48
        })))
        .expect("pre-Color-Presence V2 document remains parseable")
        .into_render_adjustments()
        .expect("legacy Color Presence fields compile");
        let legacy_adjustments = get_all_adjustments_from_json(&legacy, false, None);
        let legacy_output = apply_creative_color(
            apply_hue_shift(input, legacy_adjustments.global.hue),
            legacy_adjustments.global.saturation,
            legacy_adjustments.global.vibrance,
        );
        assert!(
            output.distance(legacy_output) <= 1.0e-6,
            "node and legacy Color Presence output must match"
        );

        let mut mixed_authority = document_with_legacy(json!({}));
        mixed_authority["nodes"]["color_presence"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "hue": 0, "saturation": 0, "vibrance": 0 },
            "process": "scene_referred_v2",
            "type": "color_presence"
        });
        let error = serde_json::from_value::<EditDocumentV2>(mixed_authority)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("mixed Color Presence ownership must fail");
        assert!(error.contains("conflicts with legacy scene-global"));

        let mut invalid_hue = document_with_legacy(json!({}));
        invalid_hue["nodes"]["scene_global_color_tone"]["params"]
            .as_object_mut()
            .expect("scene-global params")
            .remove("saturation");
        invalid_hue["nodes"]["color_presence"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "hue": 181, "saturation": 0, "vibrance": 0 },
            "process": "scene_referred_v2",
            "type": "color_presence"
        });
        let error = serde_json::from_value::<EditDocumentV2>(invalid_hue)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range hue must fail");
        assert!(error.contains("field 'hue'"));

        let mut invalid_vibrance = document_with_legacy(json!({}));
        invalid_vibrance["nodes"]["scene_global_color_tone"]["params"]
            .as_object_mut()
            .expect("scene-global params")
            .remove("saturation");
        invalid_vibrance["nodes"]["color_presence"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "hue": 0, "saturation": 0, "vibrance": -101 },
            "process": "scene_referred_v2",
            "type": "color_presence"
        });
        let error = serde_json::from_value::<EditDocumentV2>(invalid_vibrance)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range vibrance must fail");
        assert!(error.contains("field 'vibrance'"));
    }

    #[test]
    fn film_emulation_compiler_drives_native_pixel_output_and_preserves_legacy_parity() {
        let mut value = document_with_legacy(json!({}));
        value["nodes"]["film_emulation"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": film_emulation_params(),
            "process": "scene_referred_v2",
            "type": "film_emulation"
        });
        let compiled = serde_json::from_value::<EditDocumentV2>(value)
            .expect("valid Film Emulation document")
            .into_render_adjustments()
            .expect("Film Emulation node compiles");
        assert_eq!(compiled["filmEmulation"]["mix"], json!(0.65));
        let params = parse_film_node(&compiled)
            .expect("compiled Film node parses")
            .expect("compiled Film node is active");
        let input = Vec3::new(0.18, 0.42, 0.73);
        let output = apply_film_pixel(input, params);
        assert!(
            output.distance(input) > 1.0e-4,
            "Film node must alter a representative scene-linear pixel: {output:?}"
        );

        let legacy_compiled =
            serde_json::from_value::<EditDocumentV2>(document_with_legacy(film_emulation_params()))
                .expect("pre-Film-node V2 document remains parseable")
                .into_render_adjustments()
                .expect("legacy Film field compiles");
        let legacy_params = parse_film_node(&legacy_compiled)
            .expect("legacy Film node parses")
            .expect("legacy Film node is active");
        let legacy_output = apply_film_pixel(input, legacy_params);
        assert!(
            output.distance(legacy_output) <= f32::EPSILON,
            "node and legacy Film authority must remain pixel-identical"
        );

        let mut mixed = document_with_legacy(film_emulation_params());
        mixed["nodes"]["film_emulation"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": film_emulation_params(),
            "process": "scene_referred_v2",
            "type": "film_emulation"
        });
        let error = serde_json::from_value::<EditDocumentV2>(mixed)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("mixed Film authority must fail");
        assert!(error.contains("conflicts with quarantined legacy field 'filmEmulation'"));

        let mut invalid = document_with_legacy(json!({}));
        invalid["nodes"]["film_emulation"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "filmEmulation": { "mix": 2 } },
            "process": "scene_referred_v2",
            "type": "film_emulation"
        });
        let error = serde_json::from_value::<EditDocumentV2>(invalid)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("invalid Film node must fail");
        assert!(error.contains("film_emulation_invalid_node"));
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
        let mut pre_local_contrast = document_with_legacy(json!({}));
        let params = pre_local_contrast["nodes"]["detail_denoise_dehaze"]["params"]
            .as_object_mut()
            .expect("detail params object");
        for field in [
            "centré",
            "localContrastHaloGuard",
            "localContrastMidtoneMask",
            "localContrastRadiusPx",
            "structure",
        ] {
            params.remove(field);
        }
        serde_json::from_value::<EditDocumentV2>(pre_local_contrast)
            .expect("pre-local-contrast v2 document remains parseable")
            .into_render_adjustments()
            .expect("pre-local-contrast v2 document remains compilable");

        let mut pre_deblur = document_with_legacy(json!({}));
        let params = pre_deblur["nodes"]["detail_denoise_dehaze"]["params"]
            .as_object_mut()
            .expect("detail params object");
        params.remove("deblurEnabled");
        params.remove("deblurSigmaPx");
        params.remove("deblurStrength");
        serde_json::from_value::<EditDocumentV2>(pre_deblur)
            .expect("pre-Deblur v2 document remains parseable")
            .into_render_adjustments()
            .expect("pre-Deblur v2 document remains compilable");

        let mut pre_threshold = document_with_legacy(json!({ "sharpnessThreshold": 20 }));
        pre_threshold["nodes"]["detail_denoise_dehaze"]["params"]
            .as_object_mut()
            .expect("detail params object")
            .remove("sharpnessThreshold");
        serde_json::from_value::<EditDocumentV2>(pre_threshold)
            .expect("pre-threshold v2 document remains parseable")
            .into_render_adjustments()
            .expect("pre-threshold v2 document remains compilable");

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

        for invalid in [json!(-1), json!(81), json!("high")] {
            let mut invalid_threshold = document_with_legacy(json!({}));
            invalid_threshold["nodes"]["detail_denoise_dehaze"]["params"]["sharpnessThreshold"] =
                invalid;
            let error = serde_json::from_value::<EditDocumentV2>(invalid_threshold)
                .expect("document envelope remains parseable")
                .into_render_adjustments()
                .expect_err("invalid sharpness threshold must fail");
            assert!(
                error.contains("sharpnessThreshold") || error.contains("detail_denoise_dehaze")
            );
        }

        for (field, invalid) in [
            ("deblurSigmaPx", json!(0.44)),
            ("deblurSigmaPx", json!(1.36)),
            ("deblurStrength", json!(101)),
            ("deblurStrength", json!(32.5)),
        ] {
            let mut invalid_deblur = document_with_legacy(json!({}));
            invalid_deblur["nodes"]["detail_denoise_dehaze"]["params"][field] = invalid;
            let error = serde_json::from_value::<EditDocumentV2>(invalid_deblur)
                .expect("document envelope remains parseable")
                .into_render_adjustments()
                .expect_err("invalid deblur field must fail");
            assert!(error.contains(field) || error.contains("detail_denoise_dehaze"));
        }
        for (field, invalid) in [
            ("centré", json!(-101)),
            ("localContrastHaloGuard", json!(101)),
            ("localContrastMidtoneMask", json!(-1)),
            ("localContrastRadiusPx", json!(3.9)),
            ("localContrastRadiusPx", json!(96.1)),
            ("structure", json!(101)),
        ] {
            let mut invalid_local_contrast = document_with_legacy(json!({}));
            invalid_local_contrast["nodes"]["detail_denoise_dehaze"]["params"][field] = invalid;
            let error = serde_json::from_value::<EditDocumentV2>(invalid_local_contrast)
                .expect("document envelope remains parseable")
                .into_render_adjustments()
                .expect_err("invalid local-contrast field must fail");
            assert!(error.contains(field) || error.contains("detail_denoise_dehaze"));
        }
    }

    #[test]
    fn sharpness_threshold_node_drives_native_pixel_output_with_legacy_parity() {
        let document: EditDocumentV2 = serde_json::from_value(document_with_legacy(json!({})))
            .expect("valid sharpness-threshold document");
        let compiled = document
            .into_render_adjustments()
            .expect("sharpness-threshold document compiles");
        assert_eq!(compiled["sharpnessThreshold"], json!(20));
        let adjustments = get_all_adjustments_from_json(&compiled, false, None);
        assert!((adjustments.global.sharpness_threshold - 0.2).abs() <= f32::EPSILON);

        let input = Vec3::splat(0.5);
        let blurred = Vec3::splat(0.4);
        let output = apply_local_contrast(
            input,
            blurred,
            adjustments.global.sharpness,
            true,
            0,
            adjustments.global.sharpness_threshold,
        );
        assert!(
            output.distance(input) > 1.0e-4,
            "node threshold must admit and sharpen the synthetic edge: {output:?}"
        );
        let blocked =
            apply_local_contrast(input, blurred, adjustments.global.sharpness, true, 0, 0.8);
        assert_eq!(
            blocked, input,
            "a higher threshold must reject the same edge"
        );

        let mut legacy_document = document_with_legacy(json!({ "sharpnessThreshold": 20 }));
        legacy_document["nodes"]["detail_denoise_dehaze"]["params"]
            .as_object_mut()
            .expect("detail params object")
            .remove("sharpnessThreshold");
        let legacy: EditDocumentV2 = serde_json::from_value(legacy_document)
            .expect("pre-threshold-node v2 document remains parseable");
        let legacy_compiled = legacy
            .into_render_adjustments()
            .expect("legacy sharpness threshold compiles");
        let legacy_adjustments = get_all_adjustments_from_json(&legacy_compiled, false, None);
        let legacy_output = apply_local_contrast(
            input,
            blurred,
            legacy_adjustments.global.sharpness,
            true,
            0,
            legacy_adjustments.global.sharpness_threshold,
        );
        assert!(
            output.distance(legacy_output) <= f32::EPSILON,
            "node and legacy threshold authority must remain pixel-identical"
        );
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
    fn black_white_mixer_compiler_rejects_unowned_missing_and_invalid_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]["futureResponse"] =
            json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned monochrome field must fail");
        assert!(error.contains("unknown field `futureResponse`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]
            .as_object_mut()
            .expect("black-and-white settings object")
            .remove("sourceClass");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing source class must fail");
        assert!(error.contains("missing field `sourceClass`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]["weights"]["reds"] =
            json!(101);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range monochrome response must fail");
        assert!(error.contains("weights must be finite"));

        let mut legacy_zero = document_with_legacy(json!({}));
        legacy_zero["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"] = json!({
            "enabled": true,
            "presetId": "manual",
            "process": "legacy_fixed_band_v1",
            "sourceClass": "color_source",
            "weights": {
                "aquas": 0, "blues": 0, "greens": 0, "magentas": 0,
                "oranges": 0, "purples": 0, "reds": 0, "yellows": 0
            }
        });
        let error = serde_json::from_value::<EditDocumentV2>(legacy_zero)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("enabled legacy zero response must fail");
        assert!(error.contains("requires a non-zero channel response"));
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
    fn channel_mixer_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 = serde_json::from_value(document_with_legacy(json!({})))
            .expect("valid channel-mixer document");
        let compiled = document
            .into_render_adjustments()
            .expect("channel-mixer document compiles");
        let adjustments = get_all_adjustments_from_json(&compiled, false, None);
        let output =
            apply_channel_mixer([0.5, 0.25, 0.75], adjustments.global.channel_mixer, false);
        assert!(
            (output[0] - 0.58).abs() <= 1.0e-6,
            "unexpected red output: {output:?}"
        );
        assert!(
            (output[1] - 0.25).abs() <= 1.0e-6,
            "unexpected green output: {output:?}"
        );
        assert!(
            (output[2] - 0.75).abs() <= 1.0e-6,
            "unexpected blue output: {output:?}"
        );

        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["channel_mixer"]["params"]["channelMixer"]["futureMatrix"] = json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned channel-mixer field must fail");
        assert!(error.contains("unknown field `futureMatrix`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["channel_mixer"]["params"]["channelMixer"]["red"]
            .as_object_mut()
            .expect("red channel-mixer row")
            .remove("green");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing channel-mixer coefficient must fail");
        assert!(error.contains("missing field `green`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["channel_mixer"]["params"]["channelMixer"]["red"]["green"] =
            json!(201);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range channel-mixer coefficient must fail");
        assert!(error.contains("channel_mixer field 'green'"));

        let mut identity = document_with_legacy(json!({}));
        identity["nodes"]["channel_mixer"]["params"]["channelMixer"] = json!({
            "blue": { "blue": 100, "constant": 0, "green": 0, "red": 0 },
            "enabled": true,
            "green": { "blue": 0, "constant": 0, "green": 100, "red": 0 },
            "preserveLuminance": false,
            "red": { "blue": 0, "constant": 0, "green": 0, "red": 100 }
        });
        let error = serde_json::from_value::<EditDocumentV2>(identity)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("enabled identity channel mixer must fail");
        assert!(error.contains("must not be identity"));
    }

    #[test]
    fn color_balance_rgb_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 = serde_json::from_value(document_with_legacy(json!({})))
            .expect("valid color-balance document");
        let compiled = document
            .into_render_adjustments()
            .expect("color-balance document compiles");
        let adjustments = get_all_adjustments_from_json(&compiled, false, None);
        let output = apply_color_balance_rgb(
            [0.5, 0.25, 0.75],
            adjustments.global.color_balance_rgb,
            false,
        );
        assert!(
            (output[0] - 0.55).abs() <= 1.0e-6,
            "unexpected red output: {output:?}"
        );
        assert!(
            (output[1] - 0.225).abs() <= 1.0e-6,
            "unexpected green output: {output:?}"
        );
        assert!(
            (output[2] - 0.77).abs() <= 1.0e-6,
            "unexpected blue output: {output:?}"
        );

        let mut pre_color_balance_node = document_with_legacy(json!({
            "colorBalanceRgb": color_balance_rgb_params()["colorBalanceRgb"].clone()
        }));
        pre_color_balance_node["nodes"]
            .as_object_mut()
            .expect("node map")
            .remove("color_balance_rgb");
        serde_json::from_value::<EditDocumentV2>(pre_color_balance_node)
            .expect("pre-color-balance-node v2 document remains parseable")
            .into_render_adjustments()
            .expect("pre-color-balance-node v2 document remains compilable");

        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["color_balance_rgb"]["params"]["colorBalanceRgb"]["futureRange"] =
            json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned color-balance field must fail");
        assert!(error.contains("unknown field `futureRange`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["color_balance_rgb"]["params"]["colorBalanceRgb"]["midtones"]
            .as_object_mut()
            .expect("midtones object")
            .remove("green");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing color-balance channel must fail");
        assert!(error.contains("missing field `green`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["color_balance_rgb"]["params"]["colorBalanceRgb"]["highlights"]["blue"] =
            json!(101);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range color-balance channel must fail");
        assert!(error.contains("highlights.blue"));

        let mut identity = document_with_legacy(json!({}));
        identity["nodes"]["color_balance_rgb"]["params"]["colorBalanceRgb"] = json!({
            "enabled": true,
            "highlights": { "blue": 0, "green": 0, "red": 0 },
            "midtones": { "blue": 0, "green": 0, "red": 0 },
            "preserveLuminance": true,
            "shadows": { "blue": 0, "green": 0, "red": 0 }
        });
        let error = serde_json::from_value::<EditDocumentV2>(identity)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("enabled identity color balance must fail");
        assert!(error.contains("requires a non-zero channel response"));
    }

    #[test]
    fn luma_levels_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 =
            serde_json::from_value(document_with_legacy(json!({}))).expect("valid levels document");
        let compiled = document
            .into_render_adjustments()
            .expect("levels document compiles");
        let adjustments = get_all_adjustments_from_json(&compiled, false, None);
        let output = apply_luma_levels(Vec3::splat(0.5), adjustments.global.levels, false);
        let expected = 0.2 + 0.6 * 0.5_f32.sqrt();
        assert!(
            (output.x - expected).abs() <= 1.0e-6
                && (output.y - expected).abs() <= 1.0e-6
                && (output.z - expected).abs() <= 1.0e-6,
            "unexpected levels output: {output:?}"
        );

        let mut pre_levels_node = document_with_legacy(json!({
            "levels": luma_levels_params()["levels"].clone()
        }));
        pre_levels_node["nodes"]
            .as_object_mut()
            .expect("node map")
            .remove("luma_levels");
        serde_json::from_value::<EditDocumentV2>(pre_levels_node)
            .expect("pre-levels-node v2 document remains parseable")
            .into_render_adjustments()
            .expect("pre-levels-node v2 document remains compilable");

        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["luma_levels"]["params"]["levels"]["futurePivot"] = json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned levels field must fail");
        assert!(error.contains("unknown field `futurePivot`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["luma_levels"]["params"]["levels"]
            .as_object_mut()
            .expect("levels object")
            .remove("gamma");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing levels field must fail");
        assert!(error.contains("missing field `gamma`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["luma_levels"]["params"]["levels"]["gamma"] = json!(5.1);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range levels gamma must fail");
        assert!(error.contains("field 'gamma'"));

        let mut invalid_input = document_with_legacy(json!({}));
        invalid_input["nodes"]["luma_levels"]["params"]["levels"]["inputBlack"] = json!(0.9);
        invalid_input["nodes"]["luma_levels"]["params"]["levels"]["inputWhite"] = json!(0.9);
        let error = serde_json::from_value::<EditDocumentV2>(invalid_input)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("invalid levels input range must fail");
        assert!(error.contains("inputBlack must be below inputWhite"));

        let mut invalid_output = document_with_legacy(json!({}));
        invalid_output["nodes"]["luma_levels"]["params"]["levels"]["outputBlack"] = json!(0.8);
        invalid_output["nodes"]["luma_levels"]["params"]["levels"]["outputWhite"] = json!(0.2);
        let error = serde_json::from_value::<EditDocumentV2>(invalid_output)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("invalid levels output range must fail");
        assert!(error.contains("outputBlack must be below outputWhite"));
    }

    #[test]
    fn selective_color_mixer_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 = serde_json::from_value(document_with_legacy(json!({})))
            .expect("valid selective-color document");
        let compiled = document
            .into_render_adjustments()
            .expect("selective-color document compiles");
        let adjustments = get_all_adjustments_from_json(&compiled, false, None);
        let input = Vec3::new(0.8, 0.14, 0.08);
        let output = apply_hsl_panel(input, adjustments.global.hsl);
        assert!(
            output.distance(input) > 1.0e-4,
            "selective-color node must alter an in-range red pixel: {output:?}"
        );

        let mut legacy_document = document_with_legacy(selective_color_mixer_params());
        legacy_document["nodes"]
            .as_object_mut()
            .expect("node map")
            .remove("selective_color_mixer");
        let legacy: EditDocumentV2 = serde_json::from_value(legacy_document)
            .expect("pre-selective-color-node v2 document remains parseable");
        let legacy_compiled = legacy
            .into_render_adjustments()
            .expect("legacy selective-color fields compile");
        let legacy_adjustments = get_all_adjustments_from_json(&legacy_compiled, false, None);
        let legacy_output = apply_hsl_panel(input, legacy_adjustments.global.hsl);
        assert!(
            output.distance(legacy_output) <= 1.0e-6,
            "node and legacy selective-color authority must remain pixel-identical"
        );

        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["selective_color_mixer"]["params"]["futureMixer"] = json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned selective-color field must fail");
        assert!(error.contains("unknown field `futureMixer`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["selective_color_mixer"]["params"]["hsl"]
            .as_object_mut()
            .expect("hsl object")
            .remove("greens");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing selective-color range must fail");
        assert!(error.contains("missing field `greens`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["selective_color_mixer"]["params"]["hsl"]["reds"]["saturation"] =
            json!(101);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range selective-color value must fail");
        assert!(error.contains("hsl.reds.saturation"));

        let mut invalid_control = document_with_legacy(json!({}));
        invalid_control["nodes"]["selective_color_mixer"]["params"]["selectiveColorRangeControls"]
            ["reds"]["centerHueDegrees"] = json!(360);
        let error = serde_json::from_value::<EditDocumentV2>(invalid_control)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("invalid selective-color range control must fail");
        assert!(error.contains("selectiveColorRangeControls.reds.centerHueDegrees"));
    }

    #[test]
    fn lens_correction_compiler_rejects_unowned_malformed_and_out_of_range_params() {
        let mut pre_manual_ca = document_with_legacy(json!({}));
        let params = pre_manual_ca["nodes"]["lens_correction"]["params"]
            .as_object_mut()
            .expect("lens params object");
        params.remove("chromaticAberrationBlueYellow");
        params.remove("chromaticAberrationRedCyan");
        serde_json::from_value::<EditDocumentV2>(pre_manual_ca)
            .expect("pre-manual-CA v2 document remains parseable")
            .into_render_adjustments()
            .expect("pre-manual-CA v2 document remains compilable");

        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["lens_correction"]["params"]["futureOptic"] = json!(1);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned lens field must fail");
        assert!(error.contains("unknown field `futureOptic`"));

        let mut malformed = document_with_legacy(json!({}));
        malformed["nodes"]["lens_correction"]["params"]["lensDistortionParams"] =
            json!({ "k1": 0.1 });
        let error = serde_json::from_value::<EditDocumentV2>(malformed)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("incomplete lens profile must fail");
        assert!(error.contains("lens_correction is invalid"));

        for field in [
            "lensDistortionAmount",
            "lensTcaAmount",
            "lensVignetteAmount",
        ] {
            for invalid in [json!(201), json!(100.5)] {
                let mut out_of_range = document_with_legacy(json!({}));
                out_of_range["nodes"]["lens_correction"]["params"][field] = invalid;
                let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
                    .expect("document envelope remains parseable")
                    .into_render_adjustments()
                    .expect_err("non-integer or out-of-range lens amount must fail");
                assert!(error.contains(field) || error.contains("lens_correction is invalid"));
            }
        }

        for (field, invalid) in [
            ("chromaticAberrationBlueYellow", json!(-101)),
            ("chromaticAberrationRedCyan", json!(101)),
        ] {
            let mut out_of_range = document_with_legacy(json!({}));
            out_of_range["nodes"]["lens_correction"]["params"][field] = invalid;
            let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
                .expect("document envelope remains parseable")
                .into_render_adjustments()
                .expect_err("out-of-range manual CA must fail");
            assert!(error.contains(field));
        }

        for field in [
            "k1", "k2", "k3", "tca_vb", "tca_vr", "vig_k1", "vig_k2", "vig_k3",
        ] {
            let mut coefficient = document_with_legacy(json!({}));
            coefficient["nodes"]["lens_correction"]["params"]["lensDistortionParams"] = json!({
                "k1": 0, "k2": 0, "k3": 0, "model": 1, "tca_vb": 1, "tca_vr": 1,
                "vig_k1": 0, "vig_k2": 0, "vig_k3": 0
            });
            coefficient["nodes"]["lens_correction"]["params"]["lensDistortionParams"][field] =
                json!(10.1);
            let error = serde_json::from_value::<EditDocumentV2>(coefficient)
                .expect("document envelope remains parseable")
                .into_render_adjustments()
                .expect_err("out-of-range lens coefficient must fail");
            assert!(error.contains("[-10, 10]"));
        }

        for invalid_model in [json!(11), json!(1.5)] {
            let mut model = document_with_legacy(json!({}));
            model["nodes"]["lens_correction"]["params"]["lensDistortionParams"] = json!({
                "k1": 0, "k2": 0, "k3": 0, "model": invalid_model, "tca_vb": 1, "tca_vr": 1,
                "vig_k1": 0, "vig_k2": 0, "vig_k3": 0
            });
            let error = serde_json::from_value::<EditDocumentV2>(model)
                .expect("document envelope remains parseable")
                .into_render_adjustments()
                .expect_err("non-integer or out-of-range lens model must fail");
            assert!(error.contains("model") || error.contains("lens_correction is invalid"));
        }

        for (field, value) in [
            ("lensMaker", "x".repeat(161)),
            ("lensModel", "x".repeat(241)),
        ] {
            let mut identity = document_with_legacy(json!({}));
            identity["nodes"]["lens_correction"]["params"][field] = json!(value);
            if field == "lensModel" {
                identity["nodes"]["lens_correction"]["params"]["lensMaker"] = json!("maker");
            }
            let error = serde_json::from_value::<EditDocumentV2>(identity)
                .expect("document envelope remains parseable")
                .into_render_adjustments()
                .expect_err("oversized lens identity must fail");
            assert!(error.contains(if field == "lensMaker" {
                "maker"
            } else {
                "model"
            }));
        }
    }

    #[test]
    fn perceptual_grading_compiler_rejects_unowned_missing_and_invalid_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["perceptual_grading"]["params"]["futureGrading"] = json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned perceptual-grading field must fail");
        assert!(error.contains("unknown field `futureGrading`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["perceptual_grading"]["params"]
            .as_object_mut()
            .expect("perceptual-grading params object")
            .remove("perceptualGradingV1");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing perceptual-grading plan must fail");
        assert!(error.contains("missing field `perceptualGradingV1`"));

        let mut legacy_range = document_with_legacy(json!({}));
        legacy_range["nodes"]["perceptual_grading"]["params"]["colorGrading"]["midtones"]["saturation"] =
            json!(101);
        let error = serde_json::from_value::<EditDocumentV2>(legacy_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range legacy grading must fail");
        assert!(error.contains("wheel range is invalid"));

        let mut fulcrums = document_with_legacy(json!({}));
        fulcrums["nodes"]["perceptual_grading"]["params"]["perceptualGradingV1"]["highlightFulcrumEv"] =
            json!(-3);
        let error = serde_json::from_value::<EditDocumentV2>(fulcrums)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("invalid perceptual fulcrums must fail");
        assert!(error.contains("Fulcrums"));
    }

    #[test]
    fn color_calibration_compiler_rejects_unowned_missing_and_out_of_range_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["color_calibration"]["params"]["colorCalibration"]["futurePrimary"] =
            json!(true);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned color-calibration field must fail");
        assert!(error.contains("unknown field `futurePrimary`"));

        let mut missing = document_with_legacy(json!({}));
        missing["nodes"]["color_calibration"]["params"]["colorCalibration"]
            .as_object_mut()
            .expect("color-calibration settings object")
            .remove("blueHue");
        let error = serde_json::from_value::<EditDocumentV2>(missing)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("missing color-calibration field must fail");
        assert!(error.contains("missing field `blueHue`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["color_calibration"]["params"]["colorCalibration"]["redHue"] =
            json!(101);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range color calibration must fail");
        assert!(error.contains("redHue"));
    }

    #[test]
    fn geometry_compiler_rejects_unowned_out_of_range_and_out_of_bounds_params() {
        let mut transformed = document_with_legacy(json!({}));
        let transform_params = json!({
            "transformAspect": 12,
            "transformDistortion": -8,
            "transformHorizontal": 4,
            "transformRotate": 2,
            "transformScale": 104,
            "transformVertical": -3,
            "transformXOffset": 5,
            "transformYOffset": -6,
        });
        for (field, value) in transform_params
            .as_object()
            .expect("transform params must be an object")
        {
            transformed["nodes"]["geometry"]["params"][field] = value.clone();
            transformed["geometry"][field] = value.clone();
        }
        serde_json::from_value::<EditDocumentV2>(transformed)
            .expect("current transform geometry remains parseable")
            .into_render_adjustments()
            .expect("current transform geometry remains compilable");

        let valid_crop = json!({ "height": 1800, "unit": "px", "width": 2400, "x": 400, "y": 300 });
        let mut valid = document_with_legacy(json!({}));
        valid["nodes"]["geometry"]["params"]["crop"] = valid_crop.clone();
        valid["nodes"]["geometry"]["params"]["rotation"] = json!(-5.5);
        valid["geometry"]["crop"] = valid_crop.clone();
        valid["geometry"]["rotation"] = json!(-5.5);
        let compiled = serde_json::from_value::<EditDocumentV2>(valid)
            .expect("valid straighten geometry document")
            .into_render_adjustments()
            .expect("straighten geometry compiles into native render authority");
        assert_eq!(compiled["crop"], valid_crop);
        assert_eq!(compiled["rotation"], json!(-5.5));

        let perspective = json!({
            "amount": 100,
            "cropPolicy": "auto_crop",
            "guides": [
                { "class": "vertical", "endpointsSourceNormalized": [[0.22, 0.1], [0.12, 0.9]], "id": "left", "weight": 1 },
                { "class": "vertical", "endpointsSourceNormalized": [[0.78, 0.1], [0.88, 0.9]], "id": "right", "weight": 1 },
                { "class": "horizontal", "endpointsSourceNormalized": [[0.22, 0.1], [0.78, 0.1]], "id": "top", "weight": 1 },
                { "class": "horizontal", "endpointsSourceNormalized": [[0.12, 0.9], [0.88, 0.9]], "id": "bottom", "weight": 1 }
            ],
            "mode": "guided",
            "resolvedPlan": null
        });
        let mut perspective_document = document_with_legacy(json!({}));
        perspective_document["nodes"]["geometry"]["params"]["perspectiveCorrection"] =
            perspective.clone();
        perspective_document["geometry"]["perspectiveCorrection"] = perspective.clone();
        let compiled = serde_json::from_value::<EditDocumentV2>(perspective_document)
            .expect("valid perspective geometry document")
            .into_render_adjustments()
            .expect("perspective geometry compiles into native render authority");
        assert_eq!(compiled["perspectiveCorrection"], perspective);
        assert!(compiled["lensDistortionParams"].is_null());
        assert!(!crate::geometry::is_geometry_identity(
            &crate::geometry::get_geometry_params_from_json(&compiled)
        ));

        let mut missing_perspective = document_with_legacy(json!({}));
        let incomplete = json!({
            "amount": 50,
            "guides": [],
            "mode": "guided",
            "resolvedPlan": null
        });
        missing_perspective["nodes"]["geometry"]["params"]["perspectiveCorrection"] =
            incomplete.clone();
        missing_perspective["geometry"]["perspectiveCorrection"] = incomplete;
        let error = serde_json::from_value::<EditDocumentV2>(missing_perspective)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("incomplete perspective node state must fail");
        assert!(error.contains("missing field 'cropPolicy'"));

        let mut out_of_range_perspective = document_with_legacy(json!({}));
        let invalid = json!({
            "amount": 101,
            "cropPolicy": "auto_crop",
            "guides": [],
            "mode": "auto_full",
            "resolvedPlan": null
        });
        out_of_range_perspective["nodes"]["geometry"]["params"]["perspectiveCorrection"] =
            invalid.clone();
        out_of_range_perspective["geometry"]["perspectiveCorrection"] = invalid;
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range_perspective)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range perspective amount must fail");
        assert!(error.contains("amount must be within 0..=100"));

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

        let mut transform_scale = document_with_legacy(json!({}));
        transform_scale["nodes"]["geometry"]["params"]["transformScale"] = json!(151);
        transform_scale["geometry"]["transformScale"] = json!(151);
        let error = serde_json::from_value::<EditDocumentV2>(transform_scale)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range transform scale must fail");
        assert!(error.contains("transformScale"));

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
