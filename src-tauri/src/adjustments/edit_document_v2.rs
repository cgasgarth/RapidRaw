use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::adjustments::abi::{
    AllAdjustments, BlackWhiteMixerSettings, ChannelMixerRow, ChannelMixerSettings,
    ColorBalanceRgbSettings, ColorCalibrationSettings, ColorGradeSettings, GlobalAdjustments,
    HslColor, LevelsSettings, MAX_POINT_COLOR_POINTS, MaskAdjustments, PointColorGpuPoint,
    PointColorGpuSettings, SkinToneUniformitySettings, ToneEqualizerGpuSettings,
};
use crate::adjustments::parse::assemble_all_adjustments;
use crate::adjustments::scales::SCALES;
use crate::color::perceptual_grading::{PerceptualGradingPlanV1, PerceptualGradingSettingsV1};
use crate::color::view_transform::{
    ViewTransformPlanV1, ViewTransformProcess, ViewTransformSettingsV1,
};
use crate::geometry::perspective::{
    PERSPECTIVE_IMPLEMENTATION_VERSION_V1, PerspectiveCorrectionSettingsV1,
};
use crate::image_processing::calculate_agx_matrices;
use crate::tone::curves::{CurveChannelMode, CurvePoint, compile_scene_curve};
use crate::tone::output_curves::{OutputCurvePoint, OutputCurveTargetV1, compile_output_curve};

const EDIT_DOCUMENT_V2_SCHEMA_VERSION: u8 = 2;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
enum EditNodeTypeV2 {
    SourceDecode,
    SceneGlobalColorTone,
    SceneToViewTransform,
    ColorPresence,
    SceneCurve,
    ToneEqualizer,
    DisplayCreative,
    FilmEmulation,
    DetailDenoiseDehaze,
    PointColor,
    ColorBalanceRgb,
    SelectiveColorMixer,
    SkinToneUniformity,
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
            Self::SourceDecode => ("source_decode", "scene_referred_v2", 1),
            Self::Geometry => ("geometry", "scene_referred_v2", 1),
            Self::SceneGlobalColorTone => ("scene_global_color_tone", "scene_referred_v2", 1),
            Self::SceneToViewTransform => ("scene_to_view_transform", "scene_referred_v2", 1),
            Self::ColorPresence => ("color_presence", "scene_referred_v2", 1),
            Self::SceneCurve => ("scene_curve", "scene_referred_v2", 1),
            Self::ToneEqualizer => ("tone_equalizer", "scene_referred_v2", 1),
            Self::DisplayCreative => ("display_creative", "scene_referred_v2", 1),
            Self::FilmEmulation => ("film_emulation", "scene_referred_v2", 1),
            Self::DetailDenoiseDehaze => ("detail_denoise_dehaze", "scene_referred_v2", 1),
            Self::PointColor => ("point_color", "scene_referred_v2", 1),
            Self::ColorBalanceRgb => ("color_balance_rgb", "scene_referred_v2", 1),
            Self::SelectiveColorMixer => ("selective_color_mixer", "scene_referred_v2", 1),
            Self::SkinToneUniformity => ("skin_tone_uniformity", "scene_referred_v2", 1),
            Self::BlackWhiteMixer => ("black_white_mixer", "scene_referred_v2", 1),
            Self::ChannelMixer => ("channel_mixer", "scene_referred_v2", 1),
            Self::LumaLevels => ("luma_levels", "scene_referred_v2", 1),
            Self::PerceptualGrading => ("perceptual_grading", "scene_referred_v2", 1),
            Self::CameraInput => ("camera_input", "scene_referred_v2", 1),
            Self::LensCorrection => ("lens_correction", "scene_referred_v2", 1),
            Self::ColorCalibration => ("color_calibration", "scene_referred_v2", 1),
            Self::Layers => ("layers", "scene_referred_v2", 1),
            Self::SourceArtifacts => ("source_artifacts", "scene_referred_v2", 1),
        }
    }

    fn editor_section(self) -> Option<&'static str> {
        match self {
            Self::SceneGlobalColorTone | Self::SceneToViewTransform | Self::ToneEqualizer => {
                Some("basic")
            }
            Self::SceneCurve => Some("curves"),
            Self::DetailDenoiseDehaze => Some("details"),
            Self::DisplayCreative => Some("effects"),
            Self::PointColor
            | Self::ColorPresence
            | Self::ColorBalanceRgb
            | Self::SelectiveColorMixer
            | Self::SkinToneUniformity
            | Self::BlackWhiteMixer
            | Self::ChannelMixer
            | Self::LumaLevels
            | Self::PerceptualGrading
            | Self::CameraInput
            | Self::ColorCalibration => Some("color"),
            Self::SourceDecode
            | Self::FilmEmulation
            | Self::LensCorrection
            | Self::Geometry
            | Self::Layers
            | Self::SourceArtifacts => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum RawProcessingModeV1 {
    Fast,
    Balanced,
    Maximum,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceDecodeV2 {
    raw_processing_mode_override: Option<RawProcessingModeV1>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UntypedEditNodeEnvelopeV2 {
    enabled: bool,
    implementation_version: u32,
    params: Map<String, Value>,
    process: String,
    #[serde(rename = "type")]
    node_type: EditNodeTypeV2,
}

/// Exact current wire envelope. Serde owns parameter decoding, so render code
/// never receives a string-keyed parameter bag for a current node.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditNodeEnvelopeV2<P> {
    enabled: bool,
    implementation_version: u32,
    params: P,
    process: String,
    #[serde(rename = "type")]
    node_type: EditNodeTypeV2,
}

impl<P> EditNodeEnvelopeV2<P> {
    fn validate_contract(&self, expected: EditNodeTypeV2) -> Result<(), String> {
        let (node_name, process, implementation_version) = expected.contract();
        if self.node_type != expected {
            return Err(format!(
                "EditDocumentV2 node envelope type must match '{node_name}'"
            ));
        }
        if self.process != process {
            return Err(format!(
                "EditDocumentV2 node '{node_name}' has incompatible process '{}'",
                self.process
            ));
        }
        if self.implementation_version != implementation_version {
            return Err(format!(
                "EditDocumentV2 node '{node_name}' has unsupported implementationVersion {}",
                self.implementation_version
            ));
        }
        if expected == EditNodeTypeV2::SourceDecode && !self.enabled {
            return Err("EditDocumentV2 node 'source_decode' cannot be disabled".to_string());
        }
        Ok(())
    }

    fn fingerprint(&self) -> u64
    where
        P: Serialize,
    {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"rapidraw.edit_node.v2\0");
        hasher.update(self.node_type.contract().0.as_bytes());
        hasher.update(&self.implementation_version.to_le_bytes());
        hasher.update(self.process.as_bytes());
        hasher.update(&[u8::from(self.enabled)]);
        hasher.update(
            &serde_json::to_vec(&self.params).expect("typed current node params serialize"),
        );
        u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneGlobalColorToneParamsV2 {
    blacks: f64,
    brightness: f64,
    contrast: f64,
    exposure: f64,
    highlights: f64,
    shadows: f64,
    whites: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ToneMapperV2 {
    Agx,
    Basic,
    RapidView,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ViewTransformControlsV2 {
    chroma_compression: f64,
    contrast: f64,
    latitude: f64,
    middle_grey: f64,
    shoulder: f64,
    source_black_ev: f64,
    source_white_ev: f64,
    toe: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneToViewTransformV2 {
    tone_mapper: ToneMapperV2,
    view_transform: ViewTransformControlsV2,
}

impl SceneToViewTransformV2 {
    fn compile(self) -> Result<ViewTransformPlanV1, String> {
        let controls = self.view_transform;
        let settings = ViewTransformSettingsV1 {
            chroma_compression: controls.chroma_compression,
            contrast: controls.contrast,
            latitude: controls.latitude,
            middle_grey: controls.middle_grey,
            process: ViewTransformProcess::RapidViewV1,
            shoulder: controls.shoulder,
            source_black_ev: controls.source_black_ev,
            source_white_ev: controls.source_white_ev,
            toe: controls.toe,
            ..ViewTransformSettingsV1::default()
        };
        let _ = self.tone_mapper;
        ViewTransformPlanV1::compile(settings)
    }
}

impl SceneGlobalColorToneParamsV2 {
    fn compile(&self) -> Result<(), String> {
        validate_scene_tone_parameter("blacks", self.blacks, -100.0, 100.0)?;
        validate_scene_tone_parameter("brightness", self.brightness, -5.0, 5.0)?;
        validate_scene_tone_parameter("contrast", self.contrast, -100.0, 100.0)?;
        validate_scene_tone_parameter("exposure", self.exposure, -5.0, 5.0)?;
        validate_scene_tone_parameter("highlights", self.highlights, -100.0, 100.0)?;
        validate_scene_tone_parameter("shadows", self.shadows, -100.0, 100.0)?;
        validate_scene_tone_parameter("whites", self.whites, -100.0, 100.0)?;
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
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
    #[serde(rename = "normalized")]
    Normalized,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
        if self.x + self.width > 1.0 || self.y + self.height > 1.0 {
            return Err("EditDocumentV2 geometry crop exceeds its unit bounds".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeometryV2 {
    aspect_ratio: Option<f64>,
    crop: Option<GeometryCropV2>,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    perspective_correction: PerspectiveCorrectionSettingsV1,
    rotation: f64,
    transform_aspect: f64,
    transform_distortion: f64,
    transform_horizontal: f64,
    transform_rotate: f64,
    transform_scale: f64,
    transform_vertical: f64,
    transform_x_offset: f64,
    transform_y_offset: f64,
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
        return Err("EditDocumentV2 geometry perspectiveCorrection is required".to_string());
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LensCorrectionV2 {
    chromatic_aberration_blue_yellow: f64,
    chromatic_aberration_red_cyan: f64,
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
            if !value.is_finite() || !(-100.0..=100.0).contains(&value) {
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DetailDenoiseDehazeV2 {
    centré: f64,
    clarity: f64,
    color_noise_reduction: f64,
    deblur_enabled: bool,
    deblur_sigma_px: f64,
    deblur_strength: f64,
    dehaze: f64,
    denoise_contrast_protection: f64,
    denoise_detail: f64,
    denoise_natural_grain: f64,
    denoise_shadow_bias: f64,
    dust_spot_min_radius_px: u8,
    dust_spot_overlay_enabled: bool,
    dust_spot_sensitivity: u8,
    luma_noise_reduction: f64,
    local_contrast_halo_guard: f64,
    local_contrast_midtone_mask: f64,
    local_contrast_radius_px: f64,
    sharpness: f64,
    sharpness_threshold: f64,
    structure: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmEmulationV2 {
    film_emulation: Option<crate::render::film_emulation::FilmEmulationNodeV1>,
}

impl FilmEmulationV2 {
    fn compile(
        &self,
    ) -> Result<Option<crate::render::film_emulation::FilmEmulationParams>, String> {
        self.film_emulation
            .as_ref()
            .map(crate::render::film_emulation::FilmEmulationNodeV1::validate)
            .transpose()
            .map_err(|error| format!("EditDocumentV2 film_emulation is invalid: {error}"))
    }

    fn validate(&self) -> Result<(), String> {
        self.compile().map(|_| ())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToneEqualizerV2 {
    tone_equalizer: ToneEqualizerSettingsV1,
}

impl ToneEqualizerV2 {
    fn validate(&self) -> Result<(), String> {
        self.tone_equalizer.validate()
    }
}

fn pack_point_color_point(point: &PointColorAdjustmentV1) -> PointColorGpuPoint {
    let mut packed = PointColorGpuPoint::default();
    for (index, sample) in point.samples.iter().take(4).enumerate() {
        packed.samples[index] = [
            sample.source_color.lightness as f32,
            sample.source_color.chroma as f32,
            sample.source_color.hue_degrees as f32,
            sample.confidence as f32,
        ];
    }
    packed.range = [
        point.hue_radius_degrees as f32,
        point.chroma_radius as f32,
        point.lightness_radius as f32,
        point.variance as f32,
    ];
    packed.edit = [
        point.feather as f32,
        point.hue_shift_degrees as f32,
        point.chroma_shift as f32,
        point.lightness_shift as f32,
    ];
    packed.control = [
        point.saturation_shift as f32,
        point.opacity as f32,
        point.samples.len().min(4) as f32,
        f32::from(point.enabled),
    ];
    packed
}

impl PointColorV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        let plan = &self.point_color;
        if !plan.enabled {
            return;
        }
        let mut output = PointColorGpuSettings::default();
        for (index, point) in plan.points.iter().take(MAX_POINT_COLOR_POINTS).enumerate() {
            output.points[index] = pack_point_color_point(point);
        }
        output.control = [
            plan.points.len().min(MAX_POINT_COLOR_POINTS) as u32,
            match plan.visualize_mode {
                PointColorVisualizeModeV1::Image => 0,
                PointColorVisualizeModeV1::Range => 1,
                PointColorVisualizeModeV1::Solo => 2,
            },
            1,
            0,
        ];
        if plan.skin_uniformity.enabled
            && let (Some(range), Some(target)) =
                (&plan.skin_uniformity.range, &plan.skin_uniformity.target)
        {
            output.skin_range = pack_point_color_point(range);
            output.skin_target = [
                target.lightness as f32,
                target.chroma as f32,
                target.hue_degrees as f32,
                1.0,
            ];
            output.skin_control = [
                plan.skin_uniformity.hue_uniformity as f32,
                plan.skin_uniformity.chroma_uniformity as f32,
                plan.skin_uniformity.lightness_uniformity as f32,
                plan.skin_uniformity.preserve_extremes as f32,
            ];
        }
        global.point_color = output;
    }
}

fn color_balance_range(range: ColorBalanceRgbRangeV2) -> [f32; 4] {
    [range.red as f32, range.green as f32, range.blue as f32, 0.0]
}

impl ColorBalanceRgbV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        let settings = &self.color_balance_rgb;
        global.color_balance_rgb = ColorBalanceRgbSettings {
            shadows: color_balance_range(settings.shadows),
            midtones: color_balance_range(settings.midtones),
            highlights: color_balance_range(settings.highlights),
            enabled: u32::from(settings.enabled),
            preserve_luminance: u32::from(settings.preserve_luminance),
            _pad1: 0,
            _pad2: 0,
        };
    }
}

fn hsl_value(value: SelectiveColorHslValueV2) -> HslColor {
    HslColor {
        hue: value.hue as f32 * SCALES.hsl_hue_multiplier,
        saturation: value.saturation as f32 / SCALES.hsl_saturation,
        luminance: value.luminance as f32 / SCALES.hsl_luminance,
        _pad: 0.0,
    }
}

impl SelectiveColorMixerV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        global.hsl = [
            hsl_value(self.hsl.reds),
            hsl_value(self.hsl.oranges),
            hsl_value(self.hsl.yellows),
            hsl_value(self.hsl.greens),
            hsl_value(self.hsl.aquas),
            hsl_value(self.hsl.blues),
            hsl_value(self.hsl.purples),
            hsl_value(self.hsl.magentas),
        ];
    }
}

impl SkinToneUniformityV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        let value = self.skin_tone_uniformity;
        global.skin_tone_uniformity = SkinToneUniformitySettings {
            enabled: u32::from(value.enabled),
            hue_uniformity: value.hue_uniformity as f32,
            luminance_uniformity: value.luminance_uniformity as f32,
            max_hue_shift_degrees: value.max_hue_shift_degrees as f32,
            saturation_uniformity: value.saturation_uniformity as f32,
            target_hue_degrees: value.target_hue_degrees as f32,
            target_luminance: value.target_luminance as f32,
            target_saturation: value.target_saturation as f32,
        };
    }
}

fn channel_row(value: ChannelMixerRowV2) -> ChannelMixerRow {
    ChannelMixerRow {
        red: value.red as f32 / 100.0,
        green: value.green as f32 / 100.0,
        blue: value.blue as f32 / 100.0,
        constant: value.constant as f32 / 100.0,
    }
}

impl ChannelMixerV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        let value = &self.channel_mixer;
        global.channel_mixer = ChannelMixerSettings {
            red: channel_row(value.red),
            green: channel_row(value.green),
            blue: channel_row(value.blue),
            enabled: u32::from(value.enabled),
            preserve_luminance: u32::from(value.preserve_luminance),
            _pad1: 0,
            _pad2: 0,
        };
    }
}

impl LumaLevelsV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        let value = &self.levels;
        global.levels = LevelsSettings {
            input_black: value.input_black as f32,
            input_white: value.input_white as f32,
            gamma: value.gamma as f32,
            output_black: value.output_black as f32,
            output_white: value.output_white as f32,
            enabled: u32::from(value.enabled),
            _pad1: 0,
            _pad2: 0,
        };
    }
}

impl ColorCalibrationV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        let value = &self.color_calibration;
        global.color_calibration = ColorCalibrationSettings {
            shadows_tint: value.shadows_tint as f32 / SCALES.color_calibration_hue,
            red_hue: value.red_hue as f32 / SCALES.color_calibration_hue,
            red_saturation: value.red_saturation as f32 / SCALES.color_calibration_saturation,
            green_hue: value.green_hue as f32 / SCALES.color_calibration_hue,
            green_saturation: value.green_saturation as f32 / SCALES.color_calibration_saturation,
            blue_hue: value.blue_hue as f32 / SCALES.color_calibration_hue,
            blue_saturation: value.blue_saturation as f32 / SCALES.color_calibration_saturation,
            _pad1: 0.0,
        };
    }
}

impl BlackWhiteMixerV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        let value = &self.black_white_mixer;
        global.black_white_mixer = BlackWhiteMixerSettings {
            reds: value.weights.reds as f32 / 100.0,
            oranges: value.weights.oranges as f32 / 100.0,
            yellows: value.weights.yellows as f32 / 100.0,
            greens: value.weights.greens as f32 / 100.0,
            aquas: value.weights.aquas as f32 / 100.0,
            blues: value.weights.blues as f32 / 100.0,
            purples: value.weights.purples as f32 / 100.0,
            magentas: value.weights.magentas as f32 / 100.0,
            enabled: u32::from(value.enabled),
            process: match value.process {
                BlackWhiteMixerProcessV2::NeutralPanchromaticV1 => {
                    crate::monochrome::NEUTRAL_PANCHROMATIC_V1
                }
                BlackWhiteMixerProcessV2::ContinuousSensitivityV1 => {
                    crate::monochrome::CONTINUOUS_SENSITIVITY_V1
                }
            },
            implementation_version: crate::monochrome::MONOCHROME_IMPLEMENTATION_VERSION,
            source_class: match value.source_class {
                BlackWhiteMixerSourceClassV2::ColorSource => crate::monochrome::COLOR_SOURCE,
                BlackWhiteMixerSourceClassV2::MonochromeSensor => {
                    crate::monochrome::MONOCHROME_SENSOR_SOURCE
                }
                BlackWhiteMixerSourceClassV2::EncodedGrayscale => {
                    crate::monochrome::ENCODED_GRAYSCALE_SOURCE
                }
                BlackWhiteMixerSourceClassV2::AlreadyMonochromeWorking => {
                    crate::monochrome::WORKING_MONOCHROME_SOURCE
                }
            },
        };
    }
}

fn legacy_grade(value: &LegacyColorGradingRangeV2) -> ColorGradeSettings {
    ColorGradeSettings {
        hue: value.hue as f32,
        saturation: value.saturation as f32 / SCALES.color_grading_saturation,
        luminance: value.luminance as f32 / SCALES.color_grading_luminance,
        _pad: 0.0,
    }
}

impl PerceptualGradingV2 {
    fn apply(&self, global: &mut GlobalAdjustments) -> Result<(), String> {
        let plan = PerceptualGradingPlanV1::compile(self.perceptual_grading_v1.clone()).map_err(
            |error| format!("EditDocumentV2 perceptual grading cannot compile: {error:?}"),
        )?;
        global.perceptual_grading = if plan.is_identity() {
            Default::default()
        } else {
            plan.gpu_settings()
        };
        let legacy = &self.color_grading;
        global.color_grading_shadows = legacy_grade(&legacy.shadows);
        global.color_grading_midtones = legacy_grade(&legacy.midtones);
        global.color_grading_highlights = legacy_grade(&legacy.highlights);
        global.color_grading_global = legacy_grade(&legacy.global);
        global.color_grading_blending = legacy.blending as f32 / SCALES.color_grading_blending;
        global.color_grading_balance = legacy.balance as f32 / SCALES.color_grading_balance;
        if global.perceptual_grading.policy[3] > 0.5 {
            global.color_grading_shadows = Default::default();
            global.color_grading_midtones = Default::default();
            global.color_grading_highlights = Default::default();
            global.color_grading_global = Default::default();
        }
        Ok(())
    }
}

fn legacy_curve_points(
    points: &[SceneCurveLegacyPointV2],
) -> ([crate::adjustments::abi::Point; 16], u32) {
    let mut output = [crate::adjustments::abi::Point::default(); 16];
    for (target, point) in output.iter_mut().zip(points.iter()) {
        *target = crate::adjustments::abi::Point {
            x: point.x as f32,
            y: point.y as f32,
            _pad1: 0.0,
            _pad2: 0.0,
        };
    }
    (output, points.len().min(16) as u32)
}

impl SceneCurveV2 {
    fn apply_legacy_curves(&self, global: &mut GlobalAdjustments) {
        let (luma, luma_count) = legacy_curve_points(&self.curves.luma);
        let (red, red_count) = legacy_curve_points(&self.curves.red);
        let (green, green_count) = legacy_curve_points(&self.curves.green);
        let (blue, blue_count) = legacy_curve_points(&self.curves.blue);
        global.luma_curve = luma;
        global.red_curve = red;
        global.green_curve = green;
        global.blue_curve = blue;
        global.luma_curve_count = luma_count;
        global.red_curve_count = red_count;
        global.green_curve_count = green_count;
        global.blue_curve_count = blue_count;
    }

    fn compile_curves(
        &self,
    ) -> Result<
        (
            Option<crate::tone::curves::CompiledCurvePlanV1>,
            Option<crate::tone::output_curves::CompiledOutputCurvePlanV1>,
        ),
        String,
    > {
        let scene = self
            .scene_curve_v1
            .as_ref()
            .map(|settings| {
                let points = settings
                    .points
                    .iter()
                    .map(|point| CurvePoint::new(point.x_ev, point.y_ev))
                    .collect::<Vec<_>>();
                let mode = match settings.channel_mode {
                    SceneCurveChannelModeV1::LuminancePreserving => {
                        CurveChannelMode::LuminancePreserving
                    }
                    SceneCurveChannelModeV1::LinkedRgb => CurveChannelMode::LinkedRgb,
                };
                compile_scene_curve(&points, settings.middle_grey, mode)
                    .map_err(|error| format!("scene curve cannot compile: {error:?}"))
            })
            .transpose()?;
        let output = self
            .output_curve_v1
            .as_ref()
            .map(|settings| {
                let target_fingerprint =
                    crate::render::artifact_identity::stable_hash(&settings.target_identity);
                let target = match settings.domain {
                    OutputCurveDomainV1::ViewEncoded => OutputCurveTargetV1::view_encoded(
                        target_fingerprint,
                        settings.sdr_reference_white_nits,
                        settings.peak_nits,
                    ),
                    OutputCurveDomainV1::OutputEncoded => OutputCurveTargetV1::output_encoded(
                        target_fingerprint,
                        settings.sdr_reference_white_nits,
                        settings.peak_nits,
                    ),
                };
                let points = settings
                    .points
                    .iter()
                    .map(|point| OutputCurvePoint::new(point.input, point.output))
                    .collect::<Vec<_>>();
                compile_output_curve(target, &points)
                    .map_err(|error| format!("output curve cannot compile: {error:?}"))
            })
            .transpose()?;
        Ok((scene, output))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum PointColorVisualizeModeV1 {
    Image,
    Range,
    Solo,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PointColorV2 {
    point_color: PointColorPlanV1,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColorBalanceRgbV2 {
    color_balance_rgb: ColorBalanceRgbSettingsV2,
}

impl ColorBalanceRgbV2 {
    fn validate(&self) -> Result<(), String> {
        self.color_balance_rgb.validate()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkinToneUniformitySettingsV1 {
    enabled: bool,
    hue_uniformity: f64,
    luminance_uniformity: f64,
    max_hue_shift_degrees: f64,
    saturation_uniformity: f64,
    target_hue_degrees: f64,
    target_luminance: f64,
    target_saturation: f64,
}

impl SkinToneUniformitySettingsV1 {
    fn validate(self) -> Result<(), String> {
        for (field, value, minimum, maximum, exclusive_maximum) in [
            ("hueUniformity", self.hue_uniformity, 0.0, 0.75, false),
            (
                "luminanceUniformity",
                self.luminance_uniformity,
                0.0,
                0.75,
                false,
            ),
            (
                "maxHueShiftDegrees",
                self.max_hue_shift_degrees,
                0.0,
                30.0,
                false,
            ),
            (
                "saturationUniformity",
                self.saturation_uniformity,
                0.0,
                0.75,
                false,
            ),
            (
                "targetHueDegrees",
                self.target_hue_degrees,
                0.0,
                360.0,
                true,
            ),
            ("targetLuminance", self.target_luminance, 0.0, 1.0, false),
            ("targetSaturation", self.target_saturation, 0.0, 1.0, false),
        ] {
            let in_range = value >= minimum
                && if exclusive_maximum {
                    value < maximum
                } else {
                    value <= maximum
                };
            if !value.is_finite() || !in_range {
                return Err(format!(
                    "EditDocumentV2 skin_tone_uniformity field '{field}' is outside its supported range"
                ));
            }
        }
        let _ = self.enabled;
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkinToneUniformityV2 {
    skin_tone_uniformity: SkinToneUniformitySettingsV1,
}

fn parse_skin_tone_uniformity(params: &Map<String, Value>) -> Result<SkinToneUniformityV2, String> {
    let parsed = serde_json::from_value::<SkinToneUniformityV2>(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 skin_tone_uniformity is invalid: {error}"))?;
    parsed.skin_tone_uniformity.validate()?;
    Ok(parsed)
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChannelMixerV2 {
    channel_mixer: ChannelMixerSettingsV2,
}

impl ChannelMixerV2 {
    fn validate(&self) -> Result<(), String> {
        self.channel_mixer.validate()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct LumaLevelsV2 {
    levels: LumaLevelsSettingsV2,
}

impl LumaLevelsV2 {
    fn validate(&self) -> Result<(), String> {
        self.levels.validate()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum BlackWhiteMixerProcessV2 {
    NeutralPanchromaticV1,
    ContinuousSensitivityV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum BlackWhiteMixerSourceClassV2 {
    ColorSource,
    MonochromeSensor,
    EncodedGrayscale,
    AlreadyMonochromeWorking,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
        let _ = (
            &self.enabled,
            &self.preset_id,
            &self.process,
            &self.source_class,
        );
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlackWhiteMixerV2 {
    black_white_mixer: BlackWhiteMixerSettingsV2,
}

impl BlackWhiteMixerV2 {
    fn validate(&self) -> Result<(), String> {
        self.black_white_mixer.validate()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColorCalibrationV2 {
    color_calibration: ColorCalibrationSettingsV2,
}

impl ColorCalibrationV2 {
    fn validate(&self) -> Result<(), String> {
        self.color_calibration.validate()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
        if !self.deblur_strength.is_finite()
            || self.deblur_strength.fract() != 0.0
            || !(0.0..=100.0).contains(&self.deblur_strength)
        {
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
            if !value.is_finite() || !(minimum..=maximum).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 detail_denoise_dehaze field '{field}' must be finite and within [{minimum}, {maximum}]"
                ));
            }
        }
        if !self.deblur_sigma_px.is_finite() || !(0.45..=1.35).contains(&self.deblur_sigma_px) {
            return Err(
                "EditDocumentV2 detail_denoise_dehaze field 'deblurSigmaPx' must be finite and within [0.45, 1.35]"
                    .to_string(),
            );
        }
        if !(1..=12).contains(&self.dust_spot_min_radius_px) || self.dust_spot_sensitivity > 100 {
            return Err(
                "EditDocumentV2 detail_denoise_dehaze dust-spot controls are out of range"
                    .to_string(),
            );
        }
        let _ = (self.deblur_enabled, self.dust_spot_overlay_enabled);
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum SceneCurveModeV2 {
    Point,
    Parametric,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum SceneCurveToneCurveV2 {
    AutoFilmic,
    Linear,
    SoftContrast,
    HighContrast,
    ShadowLift,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurveLegacyPointV2 {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum SceneCurveChannelModeV1 {
    LuminancePreserving,
    LinkedRgb,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurvePointV1 {
    x_ev: f32,
    y_ev: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum OutputCurveDomainV1 {
    ViewEncoded,
    OutputEncoded,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutputCurvePointV1 {
    input: f32,
    output: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceModeV2 {
    AsShot,
    Auto,
    KelvinTint,
    Chromaticity,
    Preset,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSourceV2 {
    AsShot,
    Auto,
    Picker,
    Preset,
    User,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalancePresetV2 {
    Tungsten,
    Daylight,
    Flash,
    Cloudy,
    Shade,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSemanticsV2 {
    RawSceneLinear,
    RenderedSceneLinearApproximation,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSynchronizationModeV2 {
    PerImage,
    LockedReference,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CameraInputWhiteBalanceSynchronizationV2 {
    mode: CameraInputWhiteBalanceSynchronizationModeV2,
    reference_source_identity: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CameraInputV2 {
    camera_profile: String,
    camera_profile_amount: f64,
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
        let source_matches_mode = matches!(
            (&white_balance.mode, &white_balance.source),
            (
                CameraInputWhiteBalanceModeV2::AsShot,
                CameraInputWhiteBalanceSourceV2::AsShot
            ) | (
                CameraInputWhiteBalanceModeV2::Auto,
                CameraInputWhiteBalanceSourceV2::Auto
            ) | (
                CameraInputWhiteBalanceModeV2::Preset,
                CameraInputWhiteBalanceSourceV2::Preset
            ) | (
                CameraInputWhiteBalanceModeV2::Chromaticity,
                CameraInputWhiteBalanceSourceV2::Picker | CameraInputWhiteBalanceSourceV2::User
            ) | (
                CameraInputWhiteBalanceModeV2::KelvinTint,
                CameraInputWhiteBalanceSourceV2::Preset | CameraInputWhiteBalanceSourceV2::User
            )
        );
        if !source_matches_mode {
            return Err(
                "EditDocumentV2 camera_input whiteBalanceTechnical mode/source is incompatible"
                    .to_string(),
            );
        }
        if matches!(white_balance.mode, CameraInputWhiteBalanceModeV2::Preset)
            != white_balance.preset_id.is_some()
        {
            return Err(
                "EditDocumentV2 camera_input whiteBalanceTechnical preset identity is invalid"
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
        if matches!(
            white_balance.synchronization.mode,
            CameraInputWhiteBalanceSynchronizationModeV2::LockedReference
        ) != white_balance
            .synchronization
            .reference_source_identity
            .is_some()
        {
            return Err(
                "EditDocumentV2 camera_input synchronization mode/reference is incompatible"
                    .to_string(),
            );
        }
        let _ = (&white_balance.input_semantics, white_balance.sample_count);
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SourceArtifactMaskTypeV2 {
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceArtifactSubMaskModeV2 {
    Additive,
    Intersect,
    Subtractive,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

impl LayerV2 {
    fn mask_definition(&self) -> crate::mask_generation::MaskDefinition {
        crate::mask_generation::MaskDefinition {
            id: self.id.clone(),
            name: self.name.clone(),
            visible: self.visible,
            invert: self.invert,
            blend_mode: self.blend_mode_name().to_string(),
            opacity: self.opacity as f32,
            adjustments: Value::Null,
            sub_masks: self
                .sub_masks
                .iter()
                .map(|mask| crate::mask_generation::SubMask {
                    id: mask.id.clone(),
                    mask_type: match mask.mask_type {
                        SourceArtifactMaskTypeV2::AiDepth => "ai-depth",
                        SourceArtifactMaskTypeV2::AiForeground => "ai-foreground",
                        SourceArtifactMaskTypeV2::AiObject => "ai-object",
                        SourceArtifactMaskTypeV2::AiPerson => "ai-person",
                        SourceArtifactMaskTypeV2::AiSky => "ai-sky",
                        SourceArtifactMaskTypeV2::AiSubject => "ai-subject",
                        SourceArtifactMaskTypeV2::All => "all",
                        SourceArtifactMaskTypeV2::Brush => "brush",
                        SourceArtifactMaskTypeV2::Color => "color",
                        SourceArtifactMaskTypeV2::Flow => "flow",
                        SourceArtifactMaskTypeV2::Linear => "linear",
                        SourceArtifactMaskTypeV2::Luminance => "luminance",
                        SourceArtifactMaskTypeV2::QuickEraser => "quick-eraser",
                        SourceArtifactMaskTypeV2::Radial => "radial",
                    }
                    .to_string(),
                    visible: mask.visible,
                    invert: mask.invert,
                    opacity: mask.opacity as f32,
                    mode: match mask.mode {
                        SourceArtifactSubMaskModeV2::Additive => {
                            crate::mask_generation::SubMaskMode::Additive
                        }
                        SourceArtifactSubMaskModeV2::Intersect => {
                            crate::mask_generation::SubMaskMode::Intersect
                        }
                        SourceArtifactSubMaskModeV2::Subtractive => {
                            crate::mask_generation::SubMaskMode::Subtractive
                        }
                    },
                    parameters: mask
                        .parameters
                        .clone()
                        .map(|parameters| Value::Object(parameters.into_iter().collect()))
                        .unwrap_or_else(|| Value::Object(Default::default())),
                })
                .collect(),
        }
    }

    fn blend_mode_name(&self) -> &'static str {
        match self
            .blend_mode
            .as_ref()
            .unwrap_or(&LayerBlendModeV2::Normal)
        {
            LayerBlendModeV2::Normal => "normal",
            LayerBlendModeV2::Multiply => "multiply",
            LayerBlendModeV2::Screen => "screen",
            LayerBlendModeV2::Overlay => "overlay",
            LayerBlendModeV2::SoftLight => "soft_light",
            LayerBlendModeV2::Hue => "hue",
            LayerBlendModeV2::Saturation => "saturation",
            LayerBlendModeV2::Luminosity => "luminosity",
            LayerBlendModeV2::Color => "color",
        }
    }

    fn node_enabled(&self, node_type: MaskEditNodeTypeV2) -> bool {
        self.edit_nodes
            .get(&node_type)
            .is_some_and(|node| node.enabled)
    }

    fn compile_mask(&self) -> MaskAdjustments {
        let values = &self.adjustments;
        let basic = self.node_enabled(MaskEditNodeTypeV2::Basic);
        let color = self.node_enabled(MaskEditNodeTypeV2::Color);
        let curves = self.node_enabled(MaskEditNodeTypeV2::Curves);
        let details = self.node_enabled(MaskEditNodeTypeV2::Details);
        let scalar = |enabled: bool, value: f64, scale: f32| {
            if enabled { value as f32 / scale } else { 0.0 }
        };
        let (luma_curve, luma_curve_count) = if curves {
            legacy_curve_points(&values.curves.luma)
        } else {
            Default::default()
        };
        let (red_curve, red_curve_count) = if curves {
            legacy_curve_points(&values.curves.red)
        } else {
            Default::default()
        };
        let (green_curve, green_curve_count) = if curves {
            legacy_curve_points(&values.curves.green)
        } else {
            Default::default()
        };
        let (blue_curve, blue_curve_count) = if curves {
            legacy_curve_points(&values.curves.blue)
        } else {
            Default::default()
        };
        let grade = &values.color_grading;
        let perceptual_grading = if color {
            PerceptualGradingPlanV1::compile(values.perceptual_grading_v1.clone())
                .ok()
                .filter(|plan| !plan.is_identity())
                .map_or(Default::default(), |plan| plan.gpu_settings())
        } else {
            Default::default()
        };
        let mut mask = MaskAdjustments {
            exposure: scalar(basic, values.exposure, SCALES.exposure),
            brightness: scalar(basic, values.brightness, SCALES.brightness),
            contrast: scalar(basic, values.contrast, SCALES.contrast),
            highlights: scalar(basic, values.highlights, SCALES.highlights),
            shadows: scalar(basic, values.shadows, SCALES.shadows),
            whites: scalar(basic, values.whites, SCALES.whites),
            blacks: scalar(basic, values.blacks, SCALES.blacks),
            saturation: scalar(color, values.saturation, SCALES.saturation),
            temperature: scalar(color, values.temperature, SCALES.temperature),
            tint: scalar(color, values.tint, SCALES.tint),
            vibrance: scalar(color, values.vibrance, SCALES.vibrance),
            sharpness: scalar(details, values.sharpness, SCALES.sharpness),
            luma_noise_reduction: scalar(
                details,
                values.luma_noise_reduction,
                SCALES.luma_noise_reduction,
            ),
            color_noise_reduction: scalar(
                details,
                values.color_noise_reduction,
                SCALES.color_noise_reduction,
            ),
            clarity: scalar(details, values.clarity, SCALES.clarity),
            dehaze: scalar(details, values.dehaze, SCALES.dehaze),
            structure: scalar(details, values.structure, SCALES.structure),
            glow_amount: values.glow_amount as f32 / SCALES.glow,
            halation_amount: values.halation_amount as f32 / SCALES.halation,
            flare_amount: values.flare_amount as f32 / SCALES.flares,
            sharpness_threshold: scalar(
                details,
                values.sharpness_threshold,
                SCALES.sharpness_threshold,
            ),
            hue: scalar(color, values.hue, 1.0),
            blend_mode: match self.blend_mode_name() {
                "multiply" => 1.0,
                "screen" => 2.0,
                _ => 0.0,
            },
            color_grading_shadows: if color {
                legacy_grade(&grade.shadows)
            } else {
                Default::default()
            },
            color_grading_midtones: if color {
                legacy_grade(&grade.midtones)
            } else {
                Default::default()
            },
            color_grading_highlights: if color {
                legacy_grade(&grade.highlights)
            } else {
                Default::default()
            },
            color_grading_global: if color {
                legacy_grade(&grade.global)
            } else {
                Default::default()
            },
            color_grading_blending: if color {
                grade.blending as f32 / SCALES.color_grading_blending
            } else {
                0.5
            },
            color_grading_balance: if color {
                grade.balance as f32 / SCALES.color_grading_balance
            } else {
                0.0
            },
            hsl: if color {
                [
                    hsl_value(values.hsl.reds),
                    hsl_value(values.hsl.oranges),
                    hsl_value(values.hsl.yellows),
                    hsl_value(values.hsl.greens),
                    hsl_value(values.hsl.aquas),
                    hsl_value(values.hsl.blues),
                    hsl_value(values.hsl.purples),
                    hsl_value(values.hsl.magentas),
                ]
            } else {
                [Default::default(); 8]
            },
            luma_curve,
            red_curve,
            green_curve,
            blue_curve,
            luma_curve_count,
            red_curve_count,
            green_curve_count,
            blue_curve_count,
            tone_equalizer: if basic {
                tone_equalizer_gpu(&values.tone_equalizer)
            } else {
                Default::default()
            },
            perceptual_grading,
            ..Default::default()
        };
        if mask.perceptual_grading.policy[3] > 0.5 {
            mask.color_grading_shadows = Default::default();
            mask.color_grading_midtones = Default::default();
            mask.color_grading_highlights = Default::default();
            mask.color_grading_global = Default::default();
        }
        mask
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayerAdjustmentsV2 {
    blacks: f64,
    brightness: f64,
    clarity: f64,
    color_grading: LegacyColorGradingV2,
    perceptual_grading_v1: PerceptualGradingSettingsV1,
    color_noise_reduction: f64,
    contrast: f64,
    curves: SceneCurveLegacyChannelsV2,
    point_curves: SceneCurveLegacyChannelsV2,
    parametric_curve: SceneCurveParametricChannelsV2,
    curve_mode: SceneCurveModeV2,
    dehaze: f64,
    effects_enabled: bool,
    exposure: f64,
    flare_amount: f64,
    glow_amount: f64,
    halation_amount: f64,
    highlights: f64,
    hue: f64,
    hsl: SelectiveColorHslV2,
    selective_color_range_controls: SelectiveColorRangeControlsV2,
    luma_noise_reduction: f64,
    saturation: f64,
    shadows: f64,
    sharpness: f64,
    sharpness_threshold: f64,
    structure: f64,
    temperature: f64,
    tint: f64,
    tone_equalizer: ToneEqualizerSettingsV1,
    vibrance: f64,
    whites: f64,
}

impl LayerAdjustmentsV2 {
    fn validate(&self) -> Result<(), String> {
        self.color_grading.validate()?;
        PerceptualGradingPlanV1::compile(self.perceptual_grading_v1.clone()).map_err(|error| {
            format!("EditDocumentV2 layer perceptual grading is invalid: {error:?}")
        })?;
        self.curves.validate()?;
        self.point_curves.validate()?;
        self.parametric_curve.validate()?;
        self.tone_equalizer.validate()?;
        for (name, value, minimum, maximum) in [
            ("blacks", self.blacks, -100.0, 100.0),
            ("brightness", self.brightness, -5.0, 5.0),
            ("clarity", self.clarity, -100.0, 100.0),
            (
                "colorNoiseReduction",
                self.color_noise_reduction,
                0.0,
                100.0,
            ),
            ("contrast", self.contrast, -100.0, 100.0),
            ("dehaze", self.dehaze, -100.0, 100.0),
            ("exposure", self.exposure, -5.0, 5.0),
            ("flareAmount", self.flare_amount, 0.0, 100.0),
            ("glowAmount", self.glow_amount, 0.0, 100.0),
            ("halationAmount", self.halation_amount, 0.0, 100.0),
            ("highlights", self.highlights, -100.0, 100.0),
            ("hue", self.hue, -180.0, 180.0),
            ("lumaNoiseReduction", self.luma_noise_reduction, 0.0, 100.0),
            ("saturation", self.saturation, -100.0, 100.0),
            ("shadows", self.shadows, -100.0, 100.0),
            ("sharpness", self.sharpness, -100.0, 100.0),
            ("sharpnessThreshold", self.sharpness_threshold, 0.0, 80.0),
            ("structure", self.structure, -100.0, 100.0),
            ("temperature", self.temperature, -100.0, 100.0),
            ("tint", self.tint, -100.0, 100.0),
            ("vibrance", self.vibrance, -100.0, 100.0),
            ("whites", self.whites, -100.0, 100.0),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(&value) {
                return Err(format!(
                    "EditDocumentV2 layer field '{name}' is out of range"
                ));
            }
        }
        let _ = (
            self.effects_enabled,
            &self.curve_mode,
            &self.selective_color_range_controls,
        );
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayerV2 {
    adjustments: LayerAdjustmentsV2,
    blend_mode: Option<LayerBlendModeV2>,
    edit_nodes: BTreeMap<MaskEditNodeTypeV2, MaskEditNodeEnvelopeV2>,
    edit_node_schema_version: u8,
    id: String,
    invert: bool,
    layer_group_id: Option<String>,
    layer_group_name: Option<String>,
    name: String,
    opacity: f64,
    reference_match_application_receipt: Option<Map<String, Value>>,
    retouch_clone_source: Option<crate::retouch_render::CurrentRetouchCloneSource>,
    retouch_remove_source: Option<crate::retouch_render::CurrentRetouchRemoveSource>,
    sub_masks: Vec<SourceArtifactSubMaskV2>,
    visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
enum MaskEditNodeTypeV2 {
    Basic,
    Color,
    Curves,
    Details,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaskEditNodeEnvelopeV2 {
    enabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayersV2 {
    masks: Vec<LayerV2>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceArtifactSubMaskV2 {
    pub(crate) id: String,
    pub(crate) invert: bool,
    pub(crate) mode: SourceArtifactSubMaskModeV2,
    pub(crate) name: Option<String>,
    pub(crate) opacity: f64,
    pub(crate) parameters: Option<BTreeMap<String, Value>>,
    #[serde(rename = "type")]
    pub(crate) mask_type: SourceArtifactMaskTypeV2,
    pub(crate) visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceArtifactAiPatchV2 {
    pub(crate) id: String,
    pub(crate) invert: bool,
    pub(crate) is_loading: bool,
    pub(crate) name: String,
    pub(crate) patch_data: Value,
    pub(crate) prompt: String,
    pub(crate) sub_masks: Vec<SourceArtifactSubMaskV2>,
    pub(crate) visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceArtifactsV2 {
    pub(crate) ai_patches: Vec<SourceArtifactAiPatchV2>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditDocumentProvenanceV2 {
    reference_match_application_receipt: Option<Map<String, Value>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditDocumentExtensionsV2 {
    quarantined_nodes: Option<BTreeMap<String, Value>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct EditNodesV2 {
    source_decode: EditNodeEnvelopeV2<SourceDecodeV2>,
    scene_global_color_tone: EditNodeEnvelopeV2<SceneGlobalColorToneParamsV2>,
    scene_to_view_transform: EditNodeEnvelopeV2<SceneToViewTransformV2>,
    color_presence: EditNodeEnvelopeV2<ColorPresenceParamsV2>,
    scene_curve: EditNodeEnvelopeV2<SceneCurveV2>,
    tone_equalizer: EditNodeEnvelopeV2<ToneEqualizerV2>,
    display_creative: EditNodeEnvelopeV2<DisplayCreativeV2>,
    film_emulation: EditNodeEnvelopeV2<FilmEmulationV2>,
    detail_denoise_dehaze: EditNodeEnvelopeV2<DetailDenoiseDehazeV2>,
    point_color: EditNodeEnvelopeV2<PointColorV2>,
    color_balance_rgb: EditNodeEnvelopeV2<ColorBalanceRgbV2>,
    selective_color_mixer: EditNodeEnvelopeV2<SelectiveColorMixerV2>,
    skin_tone_uniformity: EditNodeEnvelopeV2<SkinToneUniformityV2>,
    black_white_mixer: EditNodeEnvelopeV2<BlackWhiteMixerV2>,
    channel_mixer: EditNodeEnvelopeV2<ChannelMixerV2>,
    luma_levels: EditNodeEnvelopeV2<LumaLevelsV2>,
    perceptual_grading: EditNodeEnvelopeV2<PerceptualGradingV2>,
    camera_input: EditNodeEnvelopeV2<CameraInputV2>,
    lens_correction: EditNodeEnvelopeV2<LensCorrectionV2>,
    color_calibration: EditNodeEnvelopeV2<ColorCalibrationV2>,
    geometry: EditNodeEnvelopeV2<GeometryV2>,
    layers: EditNodeEnvelopeV2<LayersV2>,
    source_artifacts: EditNodeEnvelopeV2<SourceArtifactsV2>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EditDocumentV2 {
    extensions: EditDocumentExtensionsV2,
    geometry: GeometryV2,
    graph_process: String,
    layers: LayersV2,
    nodes: EditNodesV2,
    provenance: EditDocumentProvenanceV2,
    schema_version: u8,
    source_decode: SourceDecodeV2,
    source_artifacts: SourceArtifactsV2,
}

impl SceneGlobalColorToneParamsV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        global.blacks = self.blacks as f32 / SCALES.blacks;
        global.brightness = self.brightness as f32 / SCALES.brightness;
        global.contrast = self.contrast as f32 / SCALES.contrast;
        global.exposure = self.exposure as f32 / SCALES.exposure;
        global.highlights = self.highlights as f32 / SCALES.highlights;
        global.shadows = self.shadows as f32 / SCALES.shadows;
        global.whites = self.whites as f32 / SCALES.whites;
    }
}

impl ColorPresenceParamsV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        global.hue = self.hue as f32;
        global.saturation = self.saturation as f32 / SCALES.saturation;
        global.vibrance = self.vibrance as f32 / SCALES.vibrance;
    }
}

impl SceneToViewTransformV2 {
    fn apply(&self, global: &mut GlobalAdjustments) -> Result<(), String> {
        let plan = (*self).compile()?;
        let parameters = plan.gpu_parameters();
        global.rapid_view_parameters0 = parameters[0];
        global.rapid_view_parameters1 = parameters[1];
        global.rapid_view_parameters2 = parameters[2];
        global.tonemapper_mode = match self.tone_mapper {
            ToneMapperV2::Basic => 0,
            ToneMapperV2::Agx => 1,
            ToneMapperV2::RapidView => 2,
        };
        Ok(())
    }
}

impl CameraInputV2 {
    fn technical_white_balance(
        &self,
    ) -> crate::color::white_balance::CurrentTechnicalWhiteBalanceV1 {
        use crate::color::white_balance::{
            CurrentTechnicalWhiteBalanceV1, CurrentWhiteBalancePresetV1,
            CurrentWhiteBalanceSourceV1, CurrentWhiteBalanceSynchronizationModeV1,
            CurrentWhiteBalanceSynchronizationV1, WhiteBalanceInputSemanticsV1, WhiteBalanceModeV1,
        };
        let white_balance = &self.white_balance_technical;
        let mode = match white_balance.mode {
            CameraInputWhiteBalanceModeV2::AsShot => WhiteBalanceModeV1::AsShot,
            CameraInputWhiteBalanceModeV2::Auto => WhiteBalanceModeV1::Auto,
            CameraInputWhiteBalanceModeV2::KelvinTint => WhiteBalanceModeV1::KelvinTint,
            CameraInputWhiteBalanceModeV2::Chromaticity => WhiteBalanceModeV1::Chromaticity,
            CameraInputWhiteBalanceModeV2::Preset => WhiteBalanceModeV1::Preset,
        };
        let source = match white_balance.source {
            CameraInputWhiteBalanceSourceV2::AsShot => CurrentWhiteBalanceSourceV1::AsShot,
            CameraInputWhiteBalanceSourceV2::Auto => CurrentWhiteBalanceSourceV1::Auto,
            CameraInputWhiteBalanceSourceV2::Picker => CurrentWhiteBalanceSourceV1::Picker,
            CameraInputWhiteBalanceSourceV2::Preset => CurrentWhiteBalanceSourceV1::Preset,
            CameraInputWhiteBalanceSourceV2::User => CurrentWhiteBalanceSourceV1::User,
        };
        let input_semantics = match white_balance.input_semantics {
            CameraInputWhiteBalanceSemanticsV2::RawSceneLinear => {
                WhiteBalanceInputSemanticsV1::RawSceneLinear
            }
            CameraInputWhiteBalanceSemanticsV2::RenderedSceneLinearApproximation => {
                WhiteBalanceInputSemanticsV1::RenderedSceneLinearApproximation
            }
        };
        let synchronization_mode = match white_balance.synchronization.mode {
            CameraInputWhiteBalanceSynchronizationModeV2::PerImage => {
                CurrentWhiteBalanceSynchronizationModeV1::PerImage
            }
            CameraInputWhiteBalanceSynchronizationModeV2::LockedReference => {
                CurrentWhiteBalanceSynchronizationModeV1::LockedReference
            }
        };
        let preset = white_balance.preset_id.as_ref().map(|preset| match preset {
            CameraInputWhiteBalancePresetV2::Tungsten => CurrentWhiteBalancePresetV1::Tungsten,
            CameraInputWhiteBalancePresetV2::Daylight => CurrentWhiteBalancePresetV1::Daylight,
            CameraInputWhiteBalancePresetV2::Flash => CurrentWhiteBalancePresetV1::Flash,
            CameraInputWhiteBalancePresetV2::Cloudy => CurrentWhiteBalancePresetV1::Cloudy,
            CameraInputWhiteBalancePresetV2::Shade => CurrentWhiteBalancePresetV1::Shade,
        });
        CurrentTechnicalWhiteBalanceV1 {
            adaptation: white_balance.adaptation.clone(),
            confidence: white_balance.confidence,
            contract: white_balance.contract.clone(),
            duv: white_balance.duv,
            input_semantics,
            kelvin: white_balance.kelvin,
            mode,
            preset_id: preset,
            sample_count: white_balance.sample_count,
            source,
            synchronization: CurrentWhiteBalanceSynchronizationV1 {
                mode: synchronization_mode,
                reference_source_identity: white_balance
                    .synchronization
                    .reference_source_identity
                    .clone(),
            },
            x: white_balance.x,
            y: white_balance.y,
        }
    }

    fn apply(&self, global: &mut GlobalAdjustments) -> Result<(), String> {
        let rows = crate::color::white_balance::compile_current_technical_white_balance_typed(
            &self.technical_white_balance(),
        )
        .map_err(|error| format!("EditDocumentV2 white balance cannot compile: {error}"))?
        .ap1_matrix;
        global.technical_white_balance = crate::adjustments::abi::GpuMat3 {
            col0: [rows[0][0], rows[1][0], rows[2][0], 0.0],
            col1: [rows[0][1], rows[1][1], rows[2][1], 0.0],
            col2: [rows[0][2], rows[1][2], rows[2][2], 0.0],
        };
        Ok(())
    }
}

impl DetailDenoiseDehazeV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        global.sharpness = self.sharpness as f32 / SCALES.sharpness;
        global.luma_noise_reduction =
            self.luma_noise_reduction as f32 / SCALES.luma_noise_reduction;
        global.color_noise_reduction =
            self.color_noise_reduction as f32 / SCALES.color_noise_reduction;
        global.clarity = self.clarity as f32 / SCALES.clarity;
        global.dehaze = self.dehaze as f32 / SCALES.dehaze;
        global.structure = self.structure as f32 / SCALES.structure;
        global.centré = self.centré as f32 / SCALES.centré;
        global.sharpness_threshold = self.sharpness_threshold as f32 / SCALES.sharpness_threshold;
    }
}

impl DisplayCreativeV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        global.vignette_amount = self.vignette_amount as f32 / SCALES.vignette_amount;
        global.vignette_midpoint = self.vignette_midpoint as f32 / SCALES.vignette_midpoint;
        global.vignette_roundness = self.vignette_roundness as f32 / SCALES.vignette_roundness;
        global.vignette_feather = self.vignette_feather as f32 / SCALES.vignette_feather;
        global.grain_amount = self.grain_amount as f32 / SCALES.grain_amount;
        global.grain_size = self.grain_size as f32 / SCALES.grain_size;
        global.grain_roughness = self.grain_roughness as f32 / SCALES.grain_roughness;
        global.glow_amount = self.glow_amount as f32 / SCALES.glow;
        global.halation_amount = self.halation_amount as f32 / SCALES.halation;
        global.flare_amount = self.flare_amount as f32 / SCALES.flares;
        global.has_lut = u32::from(self.lut_path.is_some());
        global.lut_intensity = self.lut_intensity as f32 / 100.0;
    }
}

impl FilmEmulationV2 {
    fn apply(&self, global: &mut GlobalAdjustments) -> Result<(), String> {
        if let Some(film) = self.compile()? {
            global._pad_cg1 = film.mix;
            global._pad_cg2 = film.shaper_p;
            global._pad_cg3 = f32::from(film.enabled);
        }
        Ok(())
    }
}

impl ToneEqualizerV2 {
    fn apply(&self, global: &mut GlobalAdjustments) {
        global.tone_equalizer = tone_equalizer_gpu(&self.tone_equalizer);
    }
}

fn tone_equalizer_gpu(tone: &ToneEqualizerSettingsV1) -> ToneEqualizerGpuSettings {
    ToneEqualizerGpuSettings {
        bands0: [
            tone.band_ev[0] as f32,
            tone.band_ev[1] as f32,
            tone.band_ev[2] as f32,
            tone.band_ev[3] as f32,
        ],
        bands1: [
            tone.band_ev[4] as f32,
            tone.band_ev[5] as f32,
            tone.band_ev[6] as f32,
            tone.band_ev[7] as f32,
        ],
        bands2: [tone.band_ev[8] as f32, tone.selected_band as f32, 0.0, 0.0],
        params0: [
            f32::from(tone.enabled),
            tone.pivot_ev as f32,
            tone.range_ev as f32,
            tone.detail_preservation as f32,
        ],
        params1: [
            tone.edge_refinement as f32,
            tone.smoothing_radius as f32,
            tone.mask_exposure_compensation as f32,
            tone.preview_mode as f32,
        ],
    }
}

/// Validated, non-serializable render authority for one current EditDocumentV2.
/// Every render-affecting field has one named typed owner; no enum map, broad
/// value bag, or reconstructed flat adjustment document exists on this path.
pub(crate) struct CompiledCurrentEditDocument {
    nodes: EditNodesV2,
    retouch_layers: Vec<crate::retouch_render::CurrentRetouchLayer>,
}
impl CompiledCurrentEditDocument {
    fn camera_input(&self) -> &CameraInputV2 {
        &self.nodes.camera_input.params
    }

    pub(crate) fn raw_processing_mode_override(&self) -> Option<&'static str> {
        let node = &self.nodes.source_decode;
        if !node.enabled {
            return None;
        }
        node.params
            .raw_processing_mode_override
            .map(|mode| match mode {
                RawProcessingModeV1::Fast => "fast",
                RawProcessingModeV1::Balanced => "balanced",
                RawProcessingModeV1::Maximum => "maximum",
            })
    }

    #[allow(dead_code)]
    pub(crate) fn source_artifacts(&self) -> &SourceArtifactsV2 {
        &self.nodes.source_artifacts.params
    }

    pub(crate) fn camera_profile(&self) -> (&str, f32) {
        let input = self.camera_input();
        (
            &input.camera_profile,
            input.camera_profile_amount as f32 / 100.0,
        )
    }

    pub(crate) fn technical_white_balance_plan(
        &self,
    ) -> Result<crate::color::white_balance::WhiteBalancePlanV1, String> {
        crate::color::white_balance::compile_current_technical_white_balance_typed(
            &self.camera_input().technical_white_balance(),
        )
        .map_err(|error| format!("EditDocumentV2 white balance cannot compile: {error}"))
    }

    pub(crate) fn lut_path(&self) -> Option<&str> {
        let node = &self.nodes.display_creative;
        if !node.enabled {
            return None;
        }
        node.params.lut_path.as_deref()
    }

    pub(crate) fn film_parameters(
        &self,
    ) -> Result<Option<crate::render::film_emulation::FilmEmulationParams>, String> {
        let node = &self.nodes.film_emulation;
        if !node.enabled {
            return Ok(None);
        }
        node.params.compile()
    }

    #[allow(dead_code)]
    pub(crate) fn film_profile_content_sha256(&self) -> Option<&str> {
        self.nodes
            .film_emulation
            .params
            .film_emulation
            .as_ref()
            .map(|film| film.profile_ref.content_sha256.as_str())
    }

    fn geometry_node(&self) -> &GeometryV2 {
        &self.nodes.geometry.params
    }

    pub(crate) fn orientation_steps(&self) -> u8 {
        self.geometry_node().orientation_steps
    }

    pub(crate) fn rotation(&self) -> f32 {
        self.geometry_node().rotation as f32
    }

    pub(crate) fn flip_horizontal(&self) -> bool {
        self.geometry_node().flip_horizontal
    }

    pub(crate) fn flip_vertical(&self) -> bool {
        self.geometry_node().flip_vertical
    }

    pub(crate) fn content_fingerprint(&self) -> u64 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"rapidraw.current_edit_document.v2");
        macro_rules! hash_node {
            ($node:expr) => {{
                let node = $node;
                hasher.update(node.node_type.contract().0.as_bytes());
                hasher.update(&[u8::from(node.enabled)]);
                hasher.update(&node.fingerprint().to_le_bytes());
            }};
        }
        hash_node!(&self.nodes.source_decode);
        hash_node!(&self.nodes.scene_global_color_tone);
        hash_node!(&self.nodes.scene_to_view_transform);
        hash_node!(&self.nodes.color_presence);
        hash_node!(&self.nodes.scene_curve);
        hash_node!(&self.nodes.tone_equalizer);
        hash_node!(&self.nodes.display_creative);
        hash_node!(&self.nodes.film_emulation);
        hash_node!(&self.nodes.detail_denoise_dehaze);
        hash_node!(&self.nodes.point_color);
        hash_node!(&self.nodes.color_balance_rgb);
        hash_node!(&self.nodes.selective_color_mixer);
        hash_node!(&self.nodes.skin_tone_uniformity);
        hash_node!(&self.nodes.black_white_mixer);
        hash_node!(&self.nodes.channel_mixer);
        hash_node!(&self.nodes.luma_levels);
        hash_node!(&self.nodes.perceptual_grading);
        hash_node!(&self.nodes.camera_input);
        hash_node!(&self.nodes.lens_correction);
        hash_node!(&self.nodes.color_calibration);
        hash_node!(&self.nodes.geometry);
        hash_node!(&self.nodes.layers);
        hash_node!(&self.nodes.source_artifacts);
        u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
    }

    pub(crate) fn compiled_curves(
        &self,
    ) -> Result<
        (
            Option<crate::tone::curves::CompiledCurvePlanV1>,
            Option<crate::tone::output_curves::CompiledOutputCurvePlanV1>,
        ),
        String,
    > {
        let node = &self.nodes.scene_curve;
        if !node.enabled {
            return Ok((None, None));
        }
        node.params.compile_curves()
    }

    pub(crate) fn has_retouch(&self) -> bool {
        self.layers().masks.iter().any(|layer| {
            layer.visible
                && (layer.retouch_clone_source.is_some() || layer.retouch_remove_source.is_some())
        })
    }

    pub(crate) fn has_detail_edits(&self) -> bool {
        let node = &self.nodes.detail_denoise_dehaze;
        if !node.enabled {
            return false;
        }
        let detail = &node.params;
        detail.clarity != 0.0
            || detail.color_noise_reduction != 0.0
            || (detail.deblur_enabled && detail.deblur_strength != 0.0)
            || detail.dehaze != 0.0
            || detail.luma_noise_reduction != 0.0
            || detail.sharpness != 0.0
            || detail.structure != 0.0
    }

    fn detail_node(&self) -> Option<&DetailDenoiseDehazeV2> {
        let node = &self.nodes.detail_denoise_dehaze;
        if !node.enabled {
            return None;
        }
        Some(&node.params)
    }

    pub(crate) fn deblur_render_controls(&self) -> crate::deblur_render::DeblurRenderControls {
        let Some(detail) = self.detail_node() else {
            return crate::deblur_render::DeblurRenderControls {
                enabled: false,
                sigma_px: 0.8,
                strength: 0.0,
            };
        };
        crate::deblur_render::DeblurRenderControls {
            enabled: detail.deblur_enabled,
            sigma_px: detail.deblur_sigma_px as f32,
            strength: if detail.deblur_enabled {
                detail.deblur_strength as f32 / 100.0
            } else {
                0.0
            },
        }
    }

    pub(crate) fn denoise_render_controls(&self) -> crate::denoise_render::DenoiseRenderControls {
        let Some(detail) = self.detail_node() else {
            return crate::denoise_render::DenoiseRenderControls {
                chroma_strength: 0.0,
                contrast_protection: 0.5,
                detail: 0.5,
                luma_strength: 0.0,
                natural_grain: 0.0,
                shadow_bias: 0.0,
            };
        };
        crate::denoise_render::DenoiseRenderControls {
            chroma_strength: detail.color_noise_reduction as f32 / 100.0,
            contrast_protection: detail.denoise_contrast_protection as f32 / 100.0,
            detail: detail.denoise_detail as f32 / 100.0,
            luma_strength: detail.luma_noise_reduction as f32 / 100.0,
            natural_grain: detail.denoise_natural_grain as f32 / 100.0,
            shadow_bias: detail.denoise_shadow_bias as f32 / 100.0,
        }
    }

    pub(crate) fn detail_macro_controls(&self) -> [f32; 3] {
        self.detail_node().map_or([0.0; 3], |detail| {
            [
                detail.sharpness as f32 / 100.0,
                detail.clarity as f32 / 100.0,
                detail.structure as f32 / 100.0,
            ]
        })
    }

    pub(crate) fn all_adjustments(
        &self,
        is_raw: bool,
        tonemapper_override: Option<u32>,
    ) -> Result<AllAdjustments, String> {
        let mut global = neutral_current_global_adjustments(is_raw, tonemapper_override);
        macro_rules! apply {
            ($field:ident) => {
                if self.nodes.$field.enabled {
                    self.nodes.$field.params.apply(&mut global);
                }
            };
            ($field:ident ?) => {
                if self.nodes.$field.enabled {
                    self.nodes.$field.params.apply(&mut global)?;
                }
            };
        }
        apply!(scene_global_color_tone);
        apply!(color_presence);
        apply!(scene_to_view_transform?);
        apply!(camera_input?);
        apply!(detail_denoise_dehaze);
        apply!(display_creative);
        apply!(film_emulation?);
        apply!(tone_equalizer);
        apply!(point_color);
        apply!(color_balance_rgb);
        apply!(selective_color_mixer);
        apply!(skin_tone_uniformity);
        apply!(black_white_mixer);
        apply!(channel_mixer);
        apply!(luma_levels);
        apply!(color_calibration);
        apply!(perceptual_grading?);
        if self.nodes.scene_curve.enabled {
            self.nodes
                .scene_curve
                .params
                .apply_legacy_curves(&mut global);
        }
        // Current RAW decoding applies the typed technical WB plan before the
        // render graph. Keep the GPU stage neutral so preview/export cannot
        // adapt the same source twice. Rendered sources still need this matrix.
        if is_raw {
            global.technical_white_balance = identity_gpu_mat3();
        }
        let masks = self
            .layers()
            .masks
            .iter()
            .filter(|layer| layer.visible)
            .map(LayerV2::compile_mask);
        Ok(assemble_all_adjustments(global, masks))
    }

    pub(crate) fn neutral_adjustments(
        &self,
        is_raw: bool,
        tonemapper_override: Option<u32>,
    ) -> AllAdjustments {
        let _ = self;
        assemble_all_adjustments(
            neutral_current_global_adjustments(is_raw, tonemapper_override),
            std::iter::empty(),
        )
    }

    pub(crate) fn crop(&self) -> Option<crate::geometry::Crop> {
        self.geometry_node()
            .crop
            .as_ref()
            .map(|crop| crate::geometry::Crop {
                x: crop.x,
                y: crop.y,
                width: crop.width,
                height: crop.height,
                unit: crate::geometry::CropUnit::Normalized,
            })
    }

    pub(crate) fn geometry(&self) -> crate::geometry::GeometryParams {
        let geometry = self.geometry_node();
        let lens = &self.nodes.lens_correction.params;
        let perspective_source_to_corrected =
            crate::geometry::perspective::compile_perspective_plan(
                &geometry.perspective_correction,
            )
            .map(|receipt| {
                std::array::from_fn(|index| {
                    receipt.plan.source_to_corrected[index / 3][index % 3] as f32
                })
            })
            .unwrap_or([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
        let distortion = lens.lens_distortion_params.as_ref();
        crate::geometry::GeometryParams {
            distortion: geometry.transform_distortion as f32,
            vertical: geometry.transform_vertical as f32,
            horizontal: geometry.transform_horizontal as f32,
            rotate: geometry.transform_rotate as f32,
            aspect: geometry.transform_aspect as f32,
            scale: geometry.transform_scale as f32,
            x_offset: geometry.transform_x_offset as f32,
            y_offset: geometry.transform_y_offset as f32,
            lens_distortion_amount: f32::from(lens.lens_distortion_amount) / 100.0,
            lens_vignette_amount: f32::from(lens.lens_vignette_amount) / 100.0,
            lens_tca_amount: f32::from(lens.lens_tca_amount) / 100.0,
            lens_distortion_enabled: lens.lens_distortion_enabled,
            lens_tca_enabled: lens.lens_tca_enabled,
            lens_vignette_enabled: lens.lens_vignette_enabled,
            lens_dist_k1: distortion.map_or(0.0, |value| value.k1 as f32),
            lens_dist_k2: distortion.map_or(0.0, |value| value.k2 as f32),
            lens_dist_k3: distortion.map_or(0.0, |value| value.k3 as f32),
            lens_model: distortion.map_or(0, |value| u32::from(value.model)),
            tca_vr: distortion.map_or(1.0, |value| value.tca_vr as f32),
            tca_vb: distortion.map_or(1.0, |value| value.tca_vb as f32),
            vig_k1: distortion.map_or(0.0, |value| value.vig_k1 as f32),
            vig_k2: distortion.map_or(0.0, |value| value.vig_k2 as f32),
            vig_k3: distortion.map_or(0.0, |value| value.vig_k3 as f32),
            perspective_source_to_corrected,
        }
    }

    pub(crate) fn masks(&self) -> Result<Vec<crate::mask_generation::MaskDefinition>, String> {
        Ok(self
            .layers()
            .masks
            .iter()
            .map(LayerV2::mask_definition)
            .collect())
    }

    pub(crate) fn retouch_layers(&self) -> &[crate::retouch_render::CurrentRetouchLayer] {
        &self.retouch_layers
    }

    fn layers(&self) -> &LayersV2 {
        &self.nodes.layers.params
    }

    #[cfg(test)]
    pub(crate) fn scheduler_test_stub() -> Self {
        serde_json::from_str::<EditDocumentV2>(include_str!(
            "../../../fixtures/edit-document/current-neutral-v2.json"
        ))
        .expect("neutral current document fixture parses")
        .compile()
        .expect("neutral current document fixture compiles")
    }
}

fn neutral_current_global_adjustments(
    is_raw: bool,
    tonemapper_override: Option<u32>,
) -> GlobalAdjustments {
    let (pipe_to_rendering, rendering_to_pipe) = calculate_agx_matrices();
    GlobalAdjustments {
        edit_graph_version: 2.0,
        technical_white_balance: identity_gpu_mat3(),
        is_raw_image: u32::from(is_raw),
        vignette_midpoint: 0.5,
        vignette_feather: 0.5,
        grain_size: 0.25,
        grain_roughness: 0.5,
        lut_intensity: 1.0,
        agx_pipe_to_rendering_matrix: pipe_to_rendering,
        agx_rendering_to_pipe_matrix: rendering_to_pipe,
        rapid_view_parameters0: [0.18, -10.0, 6.5, 1.15],
        rapid_view_parameters1: [0.55, 0.35, 0.5, 0.25],
        rapid_view_parameters2: [0.0; 4],
        levels: Default::default(),
        tone_equalizer: Default::default(),
        tonemapper_mode: tonemapper_override.unwrap_or_default(),
        ..Default::default()
    }
}

fn identity_gpu_mat3() -> crate::adjustments::abi::GpuMat3 {
    crate::adjustments::abi::GpuMat3 {
        col0: [1.0, 0.0, 0.0, 0.0],
        col1: [0.0, 1.0, 0.0, 0.0],
        col2: [0.0, 0.0, 1.0, 0.0],
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditDocumentV2CopyPayload {
    nodes: BTreeMap<EditNodeTypeV2, UntypedEditNodeEnvelopeV2>,
    schema_version: u8,
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
struct FlatNodeProjectionV2 {
    nodes: BTreeMap<EditNodeTypeV2, UntypedEditNodeEnvelopeV2>,
}

impl EditNodesV2 {
    fn validate(&self) -> Result<(), String> {
        macro_rules! contract {
            ($field:ident, $kind:ident) => {
                self.$field.validate_contract(EditNodeTypeV2::$kind)?;
            };
        }
        contract!(source_decode, SourceDecode);
        contract!(scene_global_color_tone, SceneGlobalColorTone);
        contract!(scene_to_view_transform, SceneToViewTransform);
        contract!(color_presence, ColorPresence);
        contract!(scene_curve, SceneCurve);
        contract!(tone_equalizer, ToneEqualizer);
        contract!(display_creative, DisplayCreative);
        contract!(film_emulation, FilmEmulation);
        contract!(detail_denoise_dehaze, DetailDenoiseDehaze);
        contract!(point_color, PointColor);
        contract!(color_balance_rgb, ColorBalanceRgb);
        contract!(selective_color_mixer, SelectiveColorMixer);
        contract!(skin_tone_uniformity, SkinToneUniformity);
        contract!(black_white_mixer, BlackWhiteMixer);
        contract!(channel_mixer, ChannelMixer);
        contract!(luma_levels, LumaLevels);
        contract!(perceptual_grading, PerceptualGrading);
        contract!(camera_input, CameraInput);
        contract!(lens_correction, LensCorrection);
        contract!(color_calibration, ColorCalibration);
        contract!(geometry, Geometry);
        contract!(layers, Layers);
        contract!(source_artifacts, SourceArtifacts);

        self.scene_global_color_tone.params.compile()?;
        self.scene_to_view_transform.params.compile()?;
        self.color_presence.params.compile()?;
        self.scene_curve.params.validate()?;
        self.tone_equalizer.params.validate()?;
        self.display_creative.params.validate()?;
        self.film_emulation.params.validate()?;
        self.detail_denoise_dehaze.params.validate()?;
        self.point_color.params.validate()?;
        self.color_balance_rgb.params.validate()?;
        self.selective_color_mixer.params.validate()?;
        self.skin_tone_uniformity
            .params
            .skin_tone_uniformity
            .validate()?;
        self.black_white_mixer.params.validate()?;
        self.channel_mixer.params.validate()?;
        self.luma_levels.params.validate()?;
        self.perceptual_grading.params.validate()?;
        self.camera_input.params.validate()?;
        self.lens_correction.params.validate()?;
        self.color_calibration.params.validate()?;
        self.geometry.params.validate()?;
        validate_layers(&self.layers.params)?;
        validate_source_artifacts(&self.source_artifacts.params)?;
        Ok(())
    }
}

impl EditDocumentV2 {
    #[cfg(test)]
    fn into_render_adjustments(self) -> Result<Value, String> {
        let mut value = serde_json::to_value(self)
            .map_err(|error| format!("EditDocumentV2 test adapter cannot serialize: {error}"))?;
        normalize_test_numbers(&mut value);
        compile_edit_document_v2(&value)
    }

    pub(crate) fn compile(self) -> Result<CompiledCurrentEditDocument, String> {
        self.validate_document_contract()?;
        let _ = self.extensions.quarantined_nodes;
        let retouch_layers = self
            .nodes
            .layers
            .params
            .masks
            .iter()
            .map(|layer| crate::retouch_render::CurrentRetouchLayer {
                opacity: layer.opacity as f32,
                retouch_clone_source: layer.retouch_clone_source.clone(),
                retouch_remove_source: layer.retouch_remove_source.clone(),
                visible: layer.visible,
            })
            .collect();
        Ok(CompiledCurrentEditDocument {
            nodes: self.nodes,
            retouch_layers,
        })
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
        self.nodes.validate()?;
        if self.nodes.geometry.params != self.geometry {
            return Err(
                "EditDocumentV2 geometry domain disagrees with its node params".to_string(),
            );
        }
        if self.nodes.layers.params != self.layers {
            return Err("EditDocumentV2 layers domain disagrees with its node params".to_string());
        }
        if self.nodes.source_decode.params != self.source_decode {
            return Err(
                "EditDocumentV2 source_decode domain disagrees with its node params".to_string(),
            );
        }
        if self.nodes.source_artifacts.params != self.source_artifacts {
            return Err(
                "EditDocumentV2 source_artifacts domain disagrees with its node params".to_string(),
            );
        }
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

#[cfg(test)]
fn normalize_test_numbers(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(normalize_test_numbers),
        Value::Object(values) => values.values_mut().for_each(normalize_test_numbers),
        Value::Number(number) if number.is_f64() => {
            let rounded = (number.as_f64().unwrap() * 1_000_000.0).round() / 1_000_000.0;
            *number = if rounded.fract() == 0.0 {
                serde_json::Number::from(rounded as i64)
            } else {
                serde_json::Number::from_f64(rounded).unwrap()
            };
        }
        _ => {}
    }
}

pub(crate) fn validate_edit_document_v2(value: &Value) -> Result<(), String> {
    let document: EditDocumentV2 = serde_json::from_value(value.clone())
        .map_err(|error| format!("EditDocumentV2 persistence payload is invalid: {error}"))?;
    document.validate_document_contract()
}

pub(crate) fn validate_edit_document_v2_copy_payload(value: &Value) -> Result<(), String> {
    let payload: EditDocumentV2CopyPayload = serde_json::from_value(value.clone())
        .map_err(|error| format!("EditDocumentV2 preset payload is invalid: {error}"))?;
    if payload.schema_version != EDIT_DOCUMENT_V2_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported EditDocumentV2 preset schemaVersion: {}",
            payload.schema_version
        ));
    }
    if payload.nodes.is_empty() {
        return Err("EditDocumentV2 preset payload must contain at least one node".to_string());
    }
    for (node_type, node) in payload.nodes {
        if matches!(
            node_type,
            EditNodeTypeV2::SourceDecode | EditNodeTypeV2::Layers | EditNodeTypeV2::SourceArtifacts
        ) {
            return Err(format!(
                "EditDocumentV2 node '{}' is not transferable in presets",
                node_type.contract().0
            ));
        }
        validate_node_contract(node_type, &node)?;
        compile_node_params(node_type, &node)?;
    }
    Ok(())
}

pub(crate) fn compile_edit_document_v2(value: &Value) -> Result<Value, String> {
    let document: EditDocumentV2 = serde_json::from_value(value.clone())
        .map_err(|error| format!("EditDocumentV2 render payload is invalid: {error}"))?;
    document.validate_document_contract()?;
    let projection: FlatNodeProjectionV2 = serde_json::from_value(value.clone())
        .map_err(|error| format!("EditDocumentV2 flat adapter is invalid: {error}"))?;
    let mut adjustments = Map::new();
    let section_visibility = ["basic", "color", "curves", "details"]
        .into_iter()
        .map(|section| {
            let enabled = projection
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
    let effects_enabled = projection
        .nodes
        .get(&EditNodeTypeV2::DisplayCreative)
        .is_none_or(|node| node.enabled);
    adjustments.insert("effectsEnabled".to_string(), Value::Bool(effects_enabled));
    for (node_key, node) in projection.nodes {
        validate_node_contract(node_key, &node)?;
        compile_node_params(node_key, &node)?;
        if node.enabled {
            adjustments.extend(node.params);
        }
    }
    Ok(Value::Object(adjustments))
}

/// Resolve the single source-decode projection persisted beside a V2 document.
/// Mixed flat/node authority fails closed instead of silently decoding different
/// pixels on preview, reopen, and export paths.
pub(crate) fn resolve_source_decode_adjustments(
    adjustments: &Value,
    edit_document_v2: Option<&Value>,
) -> Result<Value, String> {
    let mut resolved = adjustments
        .as_object()
        .cloned()
        .ok_or_else(|| "Source-decode adjustments must be an object".to_string())?;
    let Some(value) = edit_document_v2 else {
        return Ok(Value::Object(resolved));
    };
    let document: EditDocumentV2 = serde_json::from_value(value.clone())
        .map_err(|error| format!("EditDocumentV2 source-decode authority is invalid: {error}"))?;
    document.validate_document_contract()?;
    let source_decode = &document.nodes.source_decode.params;
    let authoritative = serde_json::to_value(source_decode.raw_processing_mode_override)
        .map_err(|error| format!("Source-decode authority cannot serialize: {error}"))?;
    match resolved.get("rawProcessingModeOverride") {
        Some(legacy) if legacy != &authoritative => {
            return Err(
                "Source-decode node conflicts with flat rawProcessingModeOverride authority"
                    .to_string(),
            );
        }
        None if !authoritative.is_null() => {
            return Err(
                "Source-decode node is missing its flat rawProcessingModeOverride projection"
                    .to_string(),
            );
        }
        _ => {}
    }
    resolved.insert("rawProcessingModeOverride".to_string(), authoritative);
    Ok(Value::Object(resolved))
}

/// Transitional adapter result used only by copy/flat compatibility APIs.
/// Current preview and render compilation never constructs this enum.
#[allow(dead_code)]
enum LegacyCompiledNodeParamsV2 {
    BlackWhiteMixer(BlackWhiteMixerV2),
    CameraInput(CameraInputV2),
    ChannelMixer(ChannelMixerV2),
    ColorBalanceRgb(ColorBalanceRgbV2),
    ColorCalibration(ColorCalibrationV2),
    ColorPresence(ColorPresenceParamsV2),
    DetailDenoiseDehaze(DetailDenoiseDehazeV2),
    DisplayCreative(DisplayCreativeV2),
    FilmEmulation(FilmEmulationV2),
    Geometry(GeometryV2),
    Layers(LayersV2),
    LensCorrection(LensCorrectionV2),
    LumaLevels(LumaLevelsV2),
    PerceptualGrading(PerceptualGradingV2),
    PointColor(PointColorV2),
    SceneCurve(SceneCurveV2),
    SceneGlobalColorTone(SceneGlobalColorToneParamsV2),
    SceneToViewTransform(SceneToViewTransformV2),
    SelectiveColorMixer(SelectiveColorMixerV2),
    SkinToneUniformity(SkinToneUniformityV2),
    SourceArtifacts(SourceArtifactsV2),
    SourceDecode(SourceDecodeV2),
    ToneEqualizer(ToneEqualizerV2),
}

fn compile_node_params(
    node_key: EditNodeTypeV2,
    node: &UntypedEditNodeEnvelopeV2,
) -> Result<LegacyCompiledNodeParamsV2, String> {
    match node_key {
        EditNodeTypeV2::SourceDecode => Ok(LegacyCompiledNodeParamsV2::SourceDecode(
            parse_source_decode(&node.params)?,
        )),
        EditNodeTypeV2::CameraInput => Ok(LegacyCompiledNodeParamsV2::CameraInput(
            parse_camera_input(&node.params)?,
        )),
        EditNodeTypeV2::SceneGlobalColorTone => {
            let params = serde_json::from_value::<SceneGlobalColorToneParamsV2>(Value::Object(
                node.params.clone(),
            ))
            .map_err(|error| {
                format!("EditDocumentV2 node 'scene_global_color_tone' has invalid params: {error}")
            })?;
            params.compile()?;
            Ok(LegacyCompiledNodeParamsV2::SceneGlobalColorTone(params))
        }
        EditNodeTypeV2::SceneToViewTransform => {
            let params = serde_json::from_value::<SceneToViewTransformV2>(Value::Object(
                node.params.clone(),
            ))
            .map_err(|error| {
                format!("EditDocumentV2 node 'scene_to_view_transform' has invalid params: {error}")
            })?;
            params.compile()?;
            Ok(LegacyCompiledNodeParamsV2::SceneToViewTransform(params))
        }
        EditNodeTypeV2::ColorPresence => {
            let params =
                serde_json::from_value::<ColorPresenceParamsV2>(Value::Object(node.params.clone()))
                    .map_err(|error| {
                        format!("EditDocumentV2 node 'color_presence' has invalid params: {error}")
                    })?;
            params.compile()?;
            Ok(LegacyCompiledNodeParamsV2::ColorPresence(params))
        }
        EditNodeTypeV2::SceneCurve => Ok(LegacyCompiledNodeParamsV2::SceneCurve(
            parse_scene_curve(&node.params)?,
        )),
        EditNodeTypeV2::ToneEqualizer => Ok(LegacyCompiledNodeParamsV2::ToneEqualizer(
            parse_tone_equalizer(&node.params)?,
        )),
        EditNodeTypeV2::DetailDenoiseDehaze => Ok(LegacyCompiledNodeParamsV2::DetailDenoiseDehaze(
            parse_detail_denoise_dehaze(&node.params)?,
        )),
        EditNodeTypeV2::PointColor => Ok(LegacyCompiledNodeParamsV2::PointColor(
            parse_point_color(&node.params)?,
        )),
        EditNodeTypeV2::ColorBalanceRgb => Ok(LegacyCompiledNodeParamsV2::ColorBalanceRgb(
            parse_color_balance_rgb(&node.params)?,
        )),
        EditNodeTypeV2::SelectiveColorMixer => Ok(LegacyCompiledNodeParamsV2::SelectiveColorMixer(
            parse_selective_color_mixer(&node.params)?,
        )),
        EditNodeTypeV2::SkinToneUniformity => Ok(LegacyCompiledNodeParamsV2::SkinToneUniformity(
            parse_skin_tone_uniformity(&node.params)?,
        )),
        EditNodeTypeV2::BlackWhiteMixer => Ok(LegacyCompiledNodeParamsV2::BlackWhiteMixer(
            parse_black_white_mixer(&node.params)?,
        )),
        EditNodeTypeV2::ChannelMixer => Ok(LegacyCompiledNodeParamsV2::ChannelMixer(
            parse_channel_mixer(&node.params)?,
        )),
        EditNodeTypeV2::LumaLevels => Ok(LegacyCompiledNodeParamsV2::LumaLevels(
            parse_luma_levels(&node.params)?,
        )),
        EditNodeTypeV2::PerceptualGrading => Ok(LegacyCompiledNodeParamsV2::PerceptualGrading(
            parse_perceptual_grading(&node.params)?,
        )),
        EditNodeTypeV2::ColorCalibration => Ok(LegacyCompiledNodeParamsV2::ColorCalibration(
            parse_color_calibration(&node.params)?,
        )),
        EditNodeTypeV2::DisplayCreative => Ok(LegacyCompiledNodeParamsV2::DisplayCreative(
            parse_display_creative(&node.params)?,
        )),
        EditNodeTypeV2::FilmEmulation => {
            let film: FilmEmulationV2 = serde_json::from_value(Value::Object(node.params.clone()))
                .map_err(|error| format!("EditDocumentV2 film_emulation is invalid: {error}"))?;
            film.validate()?;
            Ok(LegacyCompiledNodeParamsV2::FilmEmulation(film))
        }
        EditNodeTypeV2::Geometry => Ok(LegacyCompiledNodeParamsV2::Geometry(parse_geometry(
            &node.params,
        )?)),
        EditNodeTypeV2::LensCorrection => Ok(LegacyCompiledNodeParamsV2::LensCorrection(
            parse_lens_correction(&node.params)?,
        )),
        EditNodeTypeV2::SourceArtifacts => Ok(LegacyCompiledNodeParamsV2::SourceArtifacts(
            parse_source_artifacts(&node.params)?,
        )),
        EditNodeTypeV2::Layers => Ok(LegacyCompiledNodeParamsV2::Layers(parse_layers(
            &node.params,
        )?)),
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
    node: &UntypedEditNodeEnvelopeV2,
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
    if node_key == EditNodeTypeV2::SourceDecode && !node.enabled {
        return Err("EditDocumentV2 node 'source_decode' cannot be disabled".to_string());
    }
    Ok(())
}

fn parse_source_decode(params: &Map<String, Value>) -> Result<SourceDecodeV2, String> {
    serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 source_decode is invalid: {error}"))
}

fn parse_source_artifacts(params: &Map<String, Value>) -> Result<SourceArtifactsV2, String> {
    let artifacts: SourceArtifactsV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 source artifacts are invalid: {error}"))?;
    validate_source_artifacts(&artifacts)?;
    Ok(artifacts)
}

fn validate_source_artifacts(artifacts: &SourceArtifactsV2) -> Result<(), String> {
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
    Ok(())
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

fn parse_layers(params: &Map<String, Value>) -> Result<LayersV2, String> {
    let layers: LayersV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 layers are invalid: {error}"))?;
    validate_layers(&layers)?;
    Ok(layers)
}

fn validate_layers(layers: &LayersV2) -> Result<(), String> {
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
        layer.adjustments.validate()?;
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use glam::Vec3;
    use serde_json::{Value, json};

    use super::super::parse::get_all_adjustments_from_json;
    use super::{EditDocumentV2, resolve_source_decode_adjustments};
    use crate::color::mixer_render::{
        apply_black_white_mixer, apply_channel_mixer, apply_color_balance_rgb,
    };
    use crate::render::cpu_edit_graph::{
        apply_creative_color, apply_hsl_panel, apply_hue_shift, apply_local_contrast,
        apply_luma_levels, apply_skin_tone_uniformity,
    };
    use crate::render::film_emulation::{
        apply_pixel as apply_film_pixel, parse_node as parse_film_node,
    };

    fn compile_test_document(value: Value) -> Result<Value, String> {
        super::compile_edit_document_v2(&value)
    }

    #[test]
    fn typed_current_fingerprint_is_serialization_stable_and_parameter_sensitive() {
        let document = current_document();
        let compact = serde_json::to_string(&document).unwrap();
        let pretty = serde_json::to_string_pretty(&document).unwrap();
        let compact_fingerprint = serde_json::from_str::<EditDocumentV2>(&compact)
            .unwrap()
            .compile()
            .unwrap()
            .content_fingerprint();
        let pretty_fingerprint = serde_json::from_str::<EditDocumentV2>(&pretty)
            .unwrap()
            .compile()
            .unwrap()
            .content_fingerprint();
        assert_eq!(compact_fingerprint, pretty_fingerprint);

        let mut changed = document;
        changed["nodes"]["scene_global_color_tone"]["params"]["exposure"] = json!(0.25);
        let changed_fingerprint = serde_json::from_value::<EditDocumentV2>(changed)
            .unwrap()
            .compile()
            .unwrap()
            .content_fingerprint();
        assert_ne!(compact_fingerprint, changed_fingerprint);
    }

    #[test]
    fn typed_raw_decode_white_balance_is_not_reapplied_by_render_graph() {
        let mut document = current_document();
        let technical = &mut document["nodes"]["camera_input"]["params"]["whiteBalanceTechnical"];
        technical["mode"] = json!("chromaticity");
        technical["source"] = json!("user");
        technical["x"] = json!(0.4);
        technical["y"] = json!(0.35);
        let compiled = serde_json::from_value::<EditDocumentV2>(document)
            .unwrap()
            .compile()
            .unwrap();
        let raw = compiled.all_adjustments(true, None).unwrap();
        let rendered = compiled.all_adjustments(false, None).unwrap();
        assert_eq!(
            raw.global.technical_white_balance.col0,
            [1.0, 0.0, 0.0, 0.0]
        );
        assert_eq!(
            raw.global.technical_white_balance.col1,
            [0.0, 1.0, 0.0, 0.0]
        );
        assert_eq!(
            raw.global.technical_white_balance.col2,
            [0.0, 0.0, 1.0, 0.0]
        );
        assert_ne!(
            rendered.global.technical_white_balance.col0,
            raw.global.technical_white_balance.col0
        );
    }

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
            "dustSpotMinRadiusPx": 2,
            "dustSpotOverlayEnabled": false,
            "dustSpotSensitivity": 50,
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

    fn skin_tone_uniformity_params() -> Value {
        json!({
            "skinToneUniformity": {
                "enabled": true,
                "hueUniformity": 0.42,
                "luminanceUniformity": 0.18,
                "maxHueShiftDegrees": 16,
                "saturationUniformity": 0.31,
                "targetHueDegrees": 24,
                "targetLuminance": 0.56,
                "targetSaturation": 0.38
            }
        })
    }

    fn skin_tone_uniformity_node() -> Value {
        json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": skin_tone_uniformity_params(),
            "process": "scene_referred_v2",
            "type": "skin_tone_uniformity"
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

    fn current_document() -> Value {
        let mut document = json!({
            "extensions": {},
            "geometry": {
                "aspectRatio": null,
                "crop": { "height": 0.8, "unit": "normalized", "width": 0.9, "x": 0.04, "y": 0.06 },
                "flipHorizontal": false,
                "flipVertical": true,
                "orientationSteps": 1,
                "perspectiveCorrection": {
                    "amount": 100,
                    "cropPolicy": "auto_crop",
                    "guides": [],
                    "mode": "off",
                    "resolvedPlan": null
                },
                "rotation": 0.5,
                "transformAspect": 0,
                "transformDistortion": 0,
                "transformHorizontal": 0,
                "transformRotate": 0,
                "transformScale": 100,
                "transformVertical": 0,
                "transformXOffset": 0,
                "transformYOffset": 0
            },
            "graphProcess": "scene_referred_v2",
            "layers": { "masks": [] },
            "nodes": {
                "source_decode": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "rawProcessingModeOverride": null },
                    "process": "scene_referred_v2",
                    "type": "source_decode"
                },
                "scene_global_color_tone": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": {
                        "blacks": -4,
                        "brightness": 0.1,
                        "contrast": 18,
                        "exposure": 0.75,
                        "highlights": -22,
                        "shadows": 14,
                        "whites": 9
                    },
                    "process": "scene_referred_v2",
                    "type": "scene_global_color_tone"
                },
                "scene_to_view_transform": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": {
                        "toneMapper": "rapidView",
                        "viewTransform": {
                            "chromaCompression": 0.25,
                            "contrast": 1.15,
                            "latitude": 0.55,
                            "middleGrey": 0.18,
                            "shoulder": 0.5,
                            "sourceBlackEv": -10,
                            "sourceWhiteEv": 6.5,
                            "toe": 0.35
                        }
                    },
                    "process": "scene_referred_v2",
                    "type": "scene_to_view_transform"
                },
                "color_presence": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "hue": 0, "saturation": 7, "vibrance": 0 },
                    "process": "scene_referred_v2",
                    "type": "color_presence"
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
                "film_emulation": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "filmEmulation": null },
                    "process": "scene_referred_v2",
                    "type": "film_emulation"
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
                        "crop": { "height": 0.8, "unit": "normalized", "width": 0.9, "x": 0.04, "y": 0.06 },
                        "flipHorizontal": false,
                        "flipVertical": true,
                        "orientationSteps": 1,
                        "perspectiveCorrection": {
                            "amount": 100,
                            "cropPolicy": "auto_crop",
                            "guides": [],
                            "mode": "off",
                            "resolvedPlan": null
                        },
                        "rotation": 0.5,
                        "transformAspect": 0,
                        "transformDistortion": 0,
                        "transformHorizontal": 0,
                        "transformRotate": 0,
                        "transformScale": 100,
                        "transformVertical": 0,
                        "transformXOffset": 0,
                        "transformYOffset": 0
                    },
                    "process": "scene_referred_v2",
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
                    "process": "scene_referred_v2",
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
            "provenance": { "referenceMatchApplicationReceipt": null },
            "schemaVersion": 2,
            "sourceDecode": { "rawProcessingModeOverride": null },
            "sourceArtifacts": { "aiPatches": [] }
        });
        document["nodes"]["color_balance_rgb"] = color_balance_rgb_node();
        document["nodes"]["luma_levels"] = luma_levels_node();
        document["nodes"]["selective_color_mixer"] = selective_color_mixer_node();
        document["nodes"]["skin_tone_uniformity"] = skin_tone_uniformity_node();
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

    fn document_with_source_decode(mode: Value) -> Value {
        let mut document = current_document();
        document["sourceDecode"] = json!({ "rawProcessingModeOverride": mode });
        document["nodes"]["source_decode"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "rawProcessingModeOverride": mode },
            "process": "scene_referred_v2",
            "type": "source_decode"
        });
        document
    }

    fn document_with_scene_to_view_transform(contrast: f64) -> Value {
        let mut document = current_document();
        document["nodes"]["scene_to_view_transform"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": {
                "toneMapper": "rapidView",
                "viewTransform": {
                    "chromaCompression": 0.25,
                    "contrast": contrast,
                    "latitude": 0.55,
                    "middleGrey": 0.18,
                    "shoulder": 0.8,
                    "sourceBlackEv": -10,
                    "sourceWhiteEv": 6.5,
                    "toe": 0.7
                }
            },
            "process": "scene_referred_v2",
            "type": "scene_to_view_transform"
        });
        document
    }

    fn layer() -> Value {
        let document = current_document();
        let scene = &document["nodes"]["scene_global_color_tone"]["params"];
        let presence = &document["nodes"]["color_presence"]["params"];
        let curves = &document["nodes"]["scene_curve"]["params"];
        let detail = &document["nodes"]["detail_denoise_dehaze"]["params"];
        let creative = &document["nodes"]["display_creative"]["params"];
        let selective = &document["nodes"]["selective_color_mixer"]["params"];
        let grading = &document["nodes"]["perceptual_grading"]["params"];
        let tone_equalizer = &document["nodes"]["tone_equalizer"]["params"];
        json!({
            "adjustments": {
                "blacks": scene["blacks"],
                "brightness": scene["brightness"],
                "clarity": detail["clarity"],
                "colorGrading": grading["colorGrading"],
                "perceptualGradingV1": grading["perceptualGradingV1"],
                "colorNoiseReduction": detail["colorNoiseReduction"],
                "contrast": scene["contrast"],
                "curves": curves["curves"],
                "pointCurves": curves["pointCurves"],
                "parametricCurve": curves["parametricCurve"],
                "curveMode": curves["curveMode"],
                "dehaze": detail["dehaze"],
                "effectsEnabled": true,
                "exposure": 0.4,
                "flareAmount": creative["flareAmount"],
                "glowAmount": creative["glowAmount"],
                "halationAmount": creative["halationAmount"],
                "highlights": scene["highlights"],
                "hue": presence["hue"],
                "hsl": selective["hsl"],
                "selectiveColorRangeControls": selective["selectiveColorRangeControls"],
                "lumaNoiseReduction": detail["lumaNoiseReduction"],
                "saturation": presence["saturation"],
                "shadows": scene["shadows"],
                "sharpness": detail["sharpness"],
                "sharpnessThreshold": detail["sharpnessThreshold"],
                "structure": detail["structure"],
                "temperature": 0,
                "tint": 0,
                "toneEqualizer": tone_equalizer["toneEqualizer"],
                "vibrance": presence["vibrance"],
                "whites": scene["whites"]
            },
            "blendMode": "overlay",
            "editNodes": {
                "basic": { "enabled": false },
                "color": { "enabled": true },
                "curves": { "enabled": false },
                "details": { "enabled": true }
            },
            "editNodeSchemaVersion": 1,
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
    fn source_decode_compiler_and_flat_projection_fail_closed() {
        for mode in [
            json!(null),
            json!("fast"),
            json!("balanced"),
            json!("maximum"),
        ] {
            let document = document_with_source_decode(mode.clone());
            let compiled = compile_test_document(document.clone()).expect("source-decode compiles");
            assert_eq!(compiled["rawProcessingModeOverride"], mode);
            let resolved = resolve_source_decode_adjustments(
                &json!({ "rawProcessingModeOverride": mode }),
                Some(&document),
            )
            .expect("matching projection resolves");
            assert_eq!(resolved["rawProcessingModeOverride"], mode);
        }

        let document = document_with_source_decode(json!("maximum"));
        assert!(
            resolve_source_decode_adjustments(
                &json!({ "rawProcessingModeOverride": "fast" }),
                Some(&document),
            )
            .unwrap_err()
            .contains("conflicts")
        );
        assert!(
            resolve_source_decode_adjustments(&json!({}), Some(&document))
                .unwrap_err()
                .contains("missing")
        );

        let mut invalid = document_with_source_decode(json!("ultra"));
        assert!(serde_json::from_value::<EditDocumentV2>(invalid.clone()).is_err());
        invalid = document_with_source_decode(json!("fast"));
        invalid["nodes"]["source_decode"]["enabled"] = json!(false);
        assert!(
            compile_test_document(invalid)
                .unwrap_err()
                .contains("cannot be disabled")
        );

        let mut split = document_with_source_decode(json!("fast"));
        split["sourceDecode"]["rawProcessingModeOverride"] = json!("maximum");
        assert!(
            compile_test_document(split)
                .unwrap_err()
                .contains("domain disagrees")
        );
    }

    #[test]
    fn scene_to_view_node_compiles_into_the_native_render_projection_and_fails_closed() {
        let document = document_with_scene_to_view_transform(1.6);
        let compiled = super::compile_edit_document_v2(&document)
            .expect("scene-to-view document compiles through preview/export authority");

        assert_eq!(compiled["toneMapper"], json!("rapidView"));
        assert_eq!(compiled["viewTransform"]["contrast"], json!(1.6));
        assert_eq!(compiled["viewTransform"]["shoulder"], json!(0.8));
        let rendered = get_all_adjustments_from_json(&compiled, true, None);
        let defaults =
            get_all_adjustments_from_json(&json!({ "toneMapper": "rapidView" }), true, None);
        assert_eq!(rendered.global.tonemapper_mode, 2);
        assert_eq!(rendered.global.rapid_view_parameters0[0], 0.18);
        assert_ne!(
            rendered.global.rapid_view_parameters1,
            defaults.global.rapid_view_parameters1
        );
        assert_ne!(
            rendered.global.rapid_view_parameters2[2].to_bits(),
            defaults.global.rapid_view_parameters2[2].to_bits()
        );

        let mut malformed = document_with_scene_to_view_transform(1.6);
        malformed["nodes"]["scene_to_view_transform"]["params"]["viewTransform"]["sourceBlackEv"] =
            json!(-4);
        malformed["nodes"]["scene_to_view_transform"]["params"]["viewTransform"]["sourceWhiteEv"] =
            json!(1.5);
        let malformed_error =
            compile_test_document(malformed).expect_err("invalid EV span must fail");
        assert!(malformed_error.contains("view_transform_invalid_source_ev_bounds"));

        let mut split_authority = document_with_scene_to_view_transform(1.6);
        split_authority["extensions"]["legacyAdjustments"] = json!({ "toneMapper": "basic" });
        let conflict = serde_json::from_value::<EditDocumentV2>(split_authority)
            .expect_err("legacy extension authority must be rejected");
        assert!(
            conflict
                .to_string()
                .contains("unknown field `legacyAdjustments`")
        );
    }

    #[test]
    fn current_render_document_accepts_only_current_quarantine_extensions() {
        let mut document = current_document();
        document["extensions"] = json!({
            "quarantinedNodes": {
                "future_node": { "implementationVersion": 3 }
            }
        });
        let parsed = serde_json::from_value::<EditDocumentV2>(document)
            .expect("current quarantine extension must deserialize");
        let serialized = serde_json::to_value(parsed).expect("current render document serializes");
        assert_eq!(
            serialized["extensions"],
            json!({
                "quarantinedNodes": {
                    "future_node": { "implementationVersion": 3 }
                }
            })
        );
        assert!(serialized.get("migration").is_none());
    }

    #[test]
    fn compiles_node_keyed_document_to_render_parity_adjustments() {
        let document: EditDocumentV2 =
            serde_json::from_value(current_document()).expect("valid document");
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
            "crop": { "height": 0.8, "unit": "normalized", "width": 0.9, "x": 0.04, "y": 0.06 },
            "deblurEnabled": true,
            "deblurSigmaPx": 0.8,
            "deblurStrength": 32,
            "dehaze": 8,
            "denoiseContrastProtection": 50,
            "denoiseDetail": 50,
            "denoiseNaturalGrain": 0,
            "denoiseShadowBias": 0,
            "dustSpotMinRadiusPx": 2,
            "dustSpotOverlayEnabled": false,
            "dustSpotSensitivity": 50,
            "exposure": 0.75,
            "flipHorizontal": false,
            "flipVertical": true,
            "highlights": -22,
            "lumaNoiseReduction": 5,
            "masks": [],
            "orientationSteps": 1,
            "colorGrading": perceptual_grading_params()["colorGrading"].clone(),
            "perceptualGradingV1": perceptual_grading_params()["perceptualGradingV1"].clone(),
            "pointColor": point_color_params()["pointColor"].clone(),
            "rawProcessingModeOverride": null,
            "rotation": 0.5,
            "saturation": 7,
            "effectsEnabled": true,
            "shadows": 14,
            "sharpness": 24,
            "toneMapper": "rapidView",
            "vibrance": 0,
            "whites": 9
        });
        expected["filmEmulation"] = Value::Null;
        expected["hue"] = json!(0);
        expected["perspectiveCorrection"] =
            current_document()["geometry"]["perspectiveCorrection"].clone();
        expected["transformAspect"] = json!(0);
        expected["transformDistortion"] = json!(0);
        expected["transformHorizontal"] = json!(0);
        expected["transformRotate"] = json!(0);
        expected["transformScale"] = json!(100);
        expected["transformVertical"] = json!(0);
        expected["transformXOffset"] = json!(0);
        expected["transformYOffset"] = json!(0);
        expected["viewTransform"] =
            current_document()["nodes"]["scene_to_view_transform"]["params"]["viewTransform"]
                .clone();
        expected["colorBalanceRgb"] = color_balance_rgb_params()["colorBalanceRgb"].clone();
        expected["levels"] = luma_levels_params()["levels"].clone();
        expected["hsl"] = selective_color_mixer_params()["hsl"].clone();
        expected["selectiveColorRangeControls"] =
            selective_color_mixer_params()["selectiveColorRangeControls"].clone();
        expected["skinToneUniformity"] =
            skin_tone_uniformity_params()["skinToneUniformity"].clone();
        expected["cameraProfileAmount"] = json!(100);
        expected["centré"] = json!(-9);
        expected["localContrastHaloGuard"] = json!(62);
        expected["localContrastMidtoneMask"] = json!(44);
        expected["localContrastRadiusPx"] = json!(36);
        expected["sharpnessThreshold"] = json!(20);
        expected["skinToneUniformity"] =
            skin_tone_uniformity_params()["skinToneUniformity"].clone();
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
        let mut unknown = current_document();
        unknown["nodes"]["future_node"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": {},
            "process": "scene_referred_v2",
            "type": "future_node"
        });
        assert!(serde_json::from_value::<EditDocumentV2>(unknown).is_err());

        let mut mismatch = current_document();
        mismatch["nodes"]["geometry"]["type"] = json!("layers");
        let error = compile_test_document(mismatch).expect_err("mismatched node must fail");
        assert!(error.contains("must match 'geometry'"));
    }

    #[test]
    fn rejects_unsupported_versions_processes_and_ambiguous_domains() {
        let mut unsupported = current_document();
        unsupported["nodes"]["geometry"]["implementationVersion"] = json!(2);
        let error =
            compile_test_document(unsupported).expect_err("unsupported node version must fail");
        assert!(error.contains("unsupported implementationVersion 2"));

        let mut incompatible = current_document();
        incompatible["nodes"]["geometry"]["process"] = json!("legacy_pipeline_v1");
        let error =
            compile_test_document(incompatible).expect_err("incompatible node process must fail");
        assert!(error.contains("incompatible process"));

        let mut ambiguous = current_document();
        ambiguous["geometry"]["rotation"] = json!(90);
        let error = compile_test_document(ambiguous).expect_err("ambiguous geometry must fail");
        assert!(error.contains("geometry domain disagrees"));
    }

    #[test]
    fn disabled_nodes_do_not_reenter_the_render_bag() {
        let mut value = current_document();
        value["nodes"]["color_presence"]["params"]["vibrance"] = json!(12);
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
        let mut value = current_document();
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
    fn current_layer_envelope_compiles_without_losing_render_or_document_authority() {
        let current_layer = layer();
        let mut value = current_document();
        value["layers"] = json!({ "masks": [current_layer] });
        value["nodes"]["layers"]["params"] = json!({ "masks": [current_layer] });
        let document: EditDocumentV2 =
            serde_json::from_value(value).expect("valid current document");
        let compiled = document.compile().expect("compiled current layer");
        let definitions = compiled.masks().expect("compiled current mask definitions");
        let render = compiled
            .all_adjustments(true, None)
            .expect("compiled current render ABI");

        assert_eq!(definitions[0].id, "layer-1");
        assert_eq!(definitions[0].adjustments, Value::Null);
        assert_eq!(render.mask_count, 1);
        assert_eq!(render.mask_adjustments[0].exposure, 0.0);
    }

    #[test]
    fn rejects_missing_malformed_wrong_version_and_legacy_layer_envelopes() {
        let current = layer();
        let assert_rejected = |candidate: Value| {
            let mut value = current_document();
            value["layers"] = json!({ "masks": [candidate] });
            value["nodes"]["layers"]["params"] = value["layers"].clone();
            let error = compile_test_document(value)
                .expect_err("invalid layer envelope must fail before render");
            assert!(
                error.contains("EditDocumentV2 layers are invalid")
                    || error.contains("missing field")
                    || error.contains("unknown field")
                    || error.contains("expected a boolean"),
                "{error}"
            );
        };

        let mut missing_nodes = current.clone();
        missing_nodes.as_object_mut().unwrap().remove("editNodes");
        assert_rejected(missing_nodes);

        let mut missing_version = current.clone();
        missing_version
            .as_object_mut()
            .unwrap()
            .remove("editNodeSchemaVersion");
        assert_rejected(missing_version);

        let mut malformed = current.clone();
        malformed["editNodes"]["basic"]["enabled"] = json!("not-boolean");
        assert_rejected(malformed);

        let mut wrong_version = current.clone();
        wrong_version["editNodeSchemaVersion"] = json!(0);
        let mut value = current_document();
        value["layers"] = json!({ "masks": [wrong_version] });
        value["nodes"]["layers"]["params"] = value["layers"].clone();
        let error =
            compile_test_document(value).expect_err("wrong layer envelope version must fail");
        assert!(error.contains("editNodeSchemaVersion must be 1"));

        let mut legacy_visibility = current;
        legacy_visibility["adjustments"]["sectionVisibility"] =
            json!({ "basic": false, "color": true, "curves": true, "details": true });
        let mut value = current_document();
        value["layers"] = json!({ "masks": [legacy_visibility] });
        value["nodes"]["layers"]["params"] = value["layers"].clone();
        let error = compile_test_document(value).expect_err("legacy layer visibility must fail");
        assert!(error.contains("sectionVisibility"));
    }

    #[test]
    fn invalid_layer_sidecar_is_byte_preserved_and_quarantined_as_one_render_authority() {
        let mut invalid_layer = layer();
        invalid_layer.as_object_mut().unwrap().remove("editNodes");
        let mut document = current_document();
        document["layers"] = json!({ "masks": [invalid_layer] });
        document["nodes"]["layers"]["params"] = document["layers"].clone();

        let temp_dir = tempfile::tempdir().expect("tempdir");
        let sidecar_path = temp_dir.path().join("head-project.arw.rrdata");
        let invalid_document = document.clone();
        let edit_revision = crate::exif_processing::render_state_revision(&document, None)
            .expect("invalid document remains serializable");
        let sidecar = json!({
            "contract": "rapidraw.sidecar.v1",
            "editDocumentV2": document,
            "editRevision": edit_revision,
            "rating": 5,
            "schemaVersion": 1,
            "sourceIdentity": "/photos/head-project.arw"
        });
        let original_bytes = serde_json::to_vec_pretty(&sidecar).expect("serialize sidecar");

        let invalid_save_path = temp_dir.path().join("invalid-save.arw.rrdata");
        let invalid_metadata = crate::image_processing::ImageMetadata {
            adjustments: json!({ "exposure": 0.4, "masks": [layer()] }),
            edit_document_v2: Some(invalid_document),
            ..Default::default()
        };
        let save_error = crate::exif_processing::save_sidecar_metadata_atomic(
            &invalid_save_path,
            &invalid_metadata,
        )
        .expect_err("invalid layer authority must not be persisted");
        assert!(save_error.contains("editDocumentV2"));
        assert!(!invalid_save_path.exists());

        std::fs::write(&sidecar_path, &original_bytes).expect("write sidecar");

        let loaded = crate::exif_processing::load_sidecar_recovering(
            &sidecar_path,
            Some("/photos/head-project.arw"),
        )
        .expect("quarantine invalid current layer authority");
        assert_eq!(
            loaded.outcome,
            crate::exif_processing::PersistedStateOutcome::Quarantined
        );
        assert!(loaded.metadata.adjustments.is_object());
        assert!(loaded.metadata.edit_document_v2.is_some());
        assert_eq!(
            std::fs::read(loaded.backup_path.expect("byte-preserving backup")).unwrap(),
            original_bytes
        );
        assert!(!sidecar_path.exists());
    }

    #[test]
    fn scene_global_color_tone_compiler_rejects_unowned_and_out_of_range_params() {
        let mut unowned = current_document();
        unowned["nodes"]["scene_global_color_tone"]["params"]["futureTone"] = json!(1);
        let error = compile_test_document(unowned).expect_err("unowned scene-tone field must fail");
        assert!(error.contains("unknown field `futureTone`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["scene_global_color_tone"]["params"]["exposure"] = json!(6);
        let error =
            compile_test_document(out_of_range).expect_err("out-of-range exposure must fail");
        assert!(error.contains("field 'exposure'"));
        assert!(error.contains("[-5, 5]"));
    }

    #[test]
    fn color_presence_compiler_drives_native_pixel_output_and_rejects_stale_ownership() {
        let mut value = current_document();
        value["nodes"]["color_presence"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "hue": 36, "saturation": 7, "vibrance": 48 },
            "process": "scene_referred_v2",
            "type": "color_presence"
        });
        let compiled = compile_test_document(value).expect("Color Presence node compiles");
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

        let mut mixed_authority = current_document();
        mixed_authority["nodes"]["scene_global_color_tone"]["params"]["saturation"] = json!(0);
        let error = compile_test_document(mixed_authority)
            .expect_err("mixed Color Presence ownership must fail");
        assert!(error.contains("unknown field `saturation`"));

        let mut invalid_hue = current_document();
        invalid_hue["nodes"]["color_presence"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "hue": 181, "saturation": 0, "vibrance": 0 },
            "process": "scene_referred_v2",
            "type": "color_presence"
        });
        let error = compile_test_document(invalid_hue).expect_err("out-of-range hue must fail");
        assert!(error.contains("field 'hue'"));

        let mut invalid_vibrance = current_document();
        invalid_vibrance["nodes"]["color_presence"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "hue": 0, "saturation": 0, "vibrance": -101 },
            "process": "scene_referred_v2",
            "type": "color_presence"
        });
        let error =
            compile_test_document(invalid_vibrance).expect_err("out-of-range vibrance must fail");
        assert!(error.contains("field 'vibrance'"));
    }

    #[test]
    fn film_emulation_compiler_drives_exact_native_pixel_output_and_rejects_flat_authority() {
        let mut value = current_document();
        value["nodes"]["film_emulation"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": film_emulation_params(),
            "process": "scene_referred_v2",
            "type": "film_emulation"
        });
        let compiled = compile_test_document(value).expect("Film Emulation node compiles");
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
        let repeated = apply_film_pixel(input, params);
        assert_eq!(output.to_array(), repeated.to_array());

        let mut mixed = current_document();
        mixed["extensions"]["legacyAdjustments"] = film_emulation_params();
        let error = serde_json::from_value::<EditDocumentV2>(mixed)
            .expect_err("legacy Film authority must fail");
        assert!(
            error
                .to_string()
                .contains("unknown field `legacyAdjustments`")
        );

        let mut invalid = current_document();
        invalid["nodes"]["film_emulation"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": { "filmEmulation": { "mix": 2 } },
            "process": "scene_referred_v2",
            "type": "film_emulation"
        });
        let error = compile_test_document(invalid).expect_err("invalid Film node must fail");
        assert!(error.contains("film_emulation_invalid_node") || error.contains("missing field"));
    }

    #[test]
    fn camera_input_compiler_rejects_unowned_and_malformed_render_authority() {
        for field in [
            "creativeTemperature",
            "creativeTint",
            "temperature",
            "tint",
            "whiteBalance",
            "whiteBalanceMigration",
        ] {
            let mut obsolete = current_document();
            obsolete["nodes"]["camera_input"]["params"][field] = json!(0);
            let error = compile_test_document(obsolete)
                .expect_err("obsolete white-balance authority must fail");
            assert!(error.contains("unknown field"), "{field}: {error}");
        }

        let mut unowned = current_document();
        unowned["nodes"]["camera_input"]["params"]["futureInput"] = json!(1);
        let error =
            compile_test_document(unowned).expect_err("unowned camera-input field must fail");
        assert!(error.contains("unknown field `futureInput`"));

        let mut invalid_profile = current_document();
        invalid_profile["nodes"]["camera_input"]["params"]["cameraProfile"] =
            json!("unknown_profile");
        let error =
            compile_test_document(invalid_profile).expect_err("unknown camera profile must fail");
        assert!(error.contains("cameraProfile is invalid"));

        let mut invalid_amount = current_document();
        invalid_amount["nodes"]["camera_input"]["params"]["cameraProfileAmount"] = json!(101);
        let error = compile_test_document(invalid_amount)
            .expect_err("out-of-range camera profile amount must fail");
        assert!(error.contains("cameraProfileAmount"));
        assert!(error.contains("[0, 100]"));

        let mut invalid_chromaticity = current_document();
        invalid_chromaticity["nodes"]["camera_input"]["params"]["whiteBalanceTechnical"]["x"] =
            json!(0.8);
        let error = compile_test_document(invalid_chromaticity)
            .expect_err("invalid white-balance chromaticity must fail");
        assert!(error.contains("chromaticity is invalid"));

        let mut incompatible_source = current_document();
        incompatible_source["nodes"]["camera_input"]["params"]["whiteBalanceTechnical"]["source"] =
            json!("auto");
        let error = compile_test_document(incompatible_source)
            .expect_err("incompatible white-balance mode/source must fail");
        assert!(error.contains("mode/source is incompatible"));

        let mut invalid_reference_lock = current_document();
        invalid_reference_lock["nodes"]["camera_input"]["params"]["whiteBalanceTechnical"]["synchronization"]
            ["mode"] = json!("locked_reference");
        let error = compile_test_document(invalid_reference_lock)
            .expect_err("locked reference without source identity must fail");
        assert!(error.contains("mode/reference is incompatible"));
    }

    #[test]
    fn scene_curve_compiler_rejects_unowned_and_malformed_render_authority() {
        let mut unowned = current_document();
        unowned["nodes"]["scene_curve"]["params"]["futureCurve"] = json!(true);
        let error =
            compile_test_document(unowned).expect_err("unowned scene-curve field must fail");
        assert!(error.contains("unknown field `futureCurve`"));

        let mut too_many_points = current_document();
        too_many_points["nodes"]["scene_curve"]["params"]["curves"]["luma"] = Value::Array(
            (0..17)
                .map(|index| json!({ "x": index, "y": index }))
                .collect(),
        );
        let error =
            compile_test_document(too_many_points).expect_err("oversized legacy curve must fail");
        assert!(error.contains("requires 2..=16 points"));

        let mut non_monotone_scene = current_document();
        non_monotone_scene["nodes"]["scene_curve"]["params"]["sceneCurveV1"]["points"] =
            json!([{ "xEv": -1, "yEv": 1 }, { "xEv": 1, "yEv": 0 }]);
        let error = compile_test_document(non_monotone_scene)
            .expect_err("non-monotone scene curve must fail");
        assert!(error.contains("OutputNotMonotone"));

        let mut invalid_headroom = current_document();
        invalid_headroom["nodes"]["scene_curve"]["params"]["outputCurveV1"]["peakNits"] =
            json!(100);
        let error = compile_test_document(invalid_headroom)
            .expect_err("output curve below reference white must fail");
        assert!(error.contains("InvalidTargetLuminance"));
    }

    #[test]
    fn detail_compiler_rejects_unowned_missing_and_out_of_range_params() {
        for field in [
            "centré",
            "localContrastHaloGuard",
            "localContrastMidtoneMask",
            "localContrastRadiusPx",
            "structure",
            "deblurEnabled",
            "deblurSigmaPx",
            "deblurStrength",
            "sharpnessThreshold",
        ] {
            let mut missing_current_field = current_document();
            missing_current_field["nodes"]["detail_denoise_dehaze"]["params"]
                .as_object_mut()
                .expect("detail params object")
                .remove(field);
            let error = compile_test_document(missing_current_field)
                .expect_err("missing current detail field must fail");
            assert!(error.contains(&format!("missing field `{field}`")));
        }

        let mut unowned = current_document();
        unowned["nodes"]["detail_denoise_dehaze"]["params"]["futureDetail"] = json!(true);
        let error = compile_test_document(unowned).expect_err("unowned detail field must fail");
        assert!(error.contains("unknown field `futureDetail`"));

        let mut missing = current_document();
        missing["nodes"]["detail_denoise_dehaze"]["params"]
            .as_object_mut()
            .expect("detail params object")
            .remove("sharpness");
        let error = compile_test_document(missing).expect_err("missing detail field must fail");
        assert!(error.contains("missing field `sharpness`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["detail_denoise_dehaze"]["params"]["lumaNoiseReduction"] = json!(-1);
        let error =
            compile_test_document(out_of_range).expect_err("out-of-range detail field must fail");
        assert!(error.contains("lumaNoiseReduction"));

        for invalid in [json!(-1), json!(81), json!("high")] {
            let mut invalid_threshold = current_document();
            invalid_threshold["nodes"]["detail_denoise_dehaze"]["params"]["sharpnessThreshold"] =
                invalid;
            let error = compile_test_document(invalid_threshold)
                .expect_err("invalid sharpness threshold must fail");
            assert!(
                error.contains("sharpnessThreshold")
                    || error.contains("detail_denoise_dehaze")
                    || error.contains("invalid type")
            );
        }

        for (field, invalid) in [
            ("deblurSigmaPx", json!(0.44)),
            ("deblurSigmaPx", json!(1.36)),
            ("deblurStrength", json!(101)),
            ("deblurStrength", json!(32.5)),
        ] {
            let mut invalid_deblur = current_document();
            invalid_deblur["nodes"]["detail_denoise_dehaze"]["params"][field] = invalid;
            let error =
                compile_test_document(invalid_deblur).expect_err("invalid deblur field must fail");
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
            let mut invalid_local_contrast = current_document();
            invalid_local_contrast["nodes"]["detail_denoise_dehaze"]["params"][field] = invalid;
            let error = compile_test_document(invalid_local_contrast)
                .expect_err("invalid local-contrast field must fail");
            assert!(error.contains(field) || error.contains("detail_denoise_dehaze"));
        }
    }

    #[test]
    fn sharpness_threshold_node_drives_native_pixel_output() {
        let document: EditDocumentV2 =
            serde_json::from_value(current_document()).expect("valid sharpness-threshold document");
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
    }

    #[test]
    fn display_creative_compiler_rejects_stale_missing_and_out_of_range_params() {
        let mut stale = current_document();
        stale["nodes"]["display_creative"]["params"]["filmCurve"] = json!({ "legacy": true });
        let error = compile_test_document(stale).expect_err("stale display field must fail");
        assert!(error.contains("unknown field `filmCurve`"));

        let mut missing = current_document();
        missing["nodes"]["display_creative"]["params"]
            .as_object_mut()
            .expect("display params object")
            .remove("lutIntensity");
        let error = compile_test_document(missing).expect_err("missing display field must fail");
        assert!(error.contains("missing field `lutIntensity`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["display_creative"]["params"]["vignetteAmount"] = json!(101);
        let error =
            compile_test_document(out_of_range).expect_err("out-of-range display field must fail");
        assert!(error.contains("vignetteAmount"));
    }

    #[test]
    fn tone_equalizer_compiler_rejects_unowned_missing_and_malformed_params() {
        let mut unowned = current_document();
        unowned["nodes"]["tone_equalizer"]["params"]["toneEqualizer"]["futureBand"] = json!(true);
        let error =
            compile_test_document(unowned).expect_err("unowned tone-equalizer field must fail");
        assert!(error.contains("unknown field `futureBand`"));

        let mut missing = current_document();
        missing["nodes"]["tone_equalizer"]["params"]["toneEqualizer"]
            .as_object_mut()
            .expect("tone-equalizer settings object")
            .remove("smoothingRadius");
        let error =
            compile_test_document(missing).expect_err("missing tone-equalizer field must fail");
        assert!(error.contains("missing field `smoothingRadius`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["tone_equalizer"]["params"]["toneEqualizer"]["bandEv"][4] =
            json!(4.1);
        let error = compile_test_document(out_of_range)
            .expect_err("out-of-range tone-equalizer band must fail");
        assert!(error.contains("bandEv"));

        let mut wrong_band_count = current_document();
        wrong_band_count["nodes"]["tone_equalizer"]["params"]["toneEqualizer"]["bandEv"] =
            json!([0, 0, 0, 0, 0, 0, 0, 0]);
        let error = compile_test_document(wrong_band_count)
            .expect_err("wrong tone-equalizer band count must fail");
        assert!(error.contains("array of length 9"));
    }

    #[test]
    fn black_white_mixer_compiler_rejects_unowned_missing_and_invalid_params() {
        let mut unowned = current_document();
        unowned["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]["futureResponse"] =
            json!(true);
        let error = compile_test_document(unowned).expect_err("unowned monochrome field must fail");
        assert!(error.contains("unknown field `futureResponse`"));

        let mut missing = current_document();
        missing["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]
            .as_object_mut()
            .expect("black-and-white settings object")
            .remove("sourceClass");
        let error = compile_test_document(missing).expect_err("missing source class must fail");
        assert!(error.contains("missing field `sourceClass`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]["weights"]["reds"] =
            json!(101);
        let error = compile_test_document(out_of_range)
            .expect_err("out-of-range monochrome response must fail");
        assert!(error.contains("weights must be finite"));

        let mut legacy_process = current_document();
        legacy_process["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"] = json!({
            "enabled": true,
            "presetId": "manual",
            "process": "legacy_fixed_band_v1",
            "sourceClass": "color_source",
            "weights": {
                "aquas": 0, "blues": 0, "greens": 0, "magentas": 0,
                "oranges": 0, "purples": 0, "reds": 0, "yellows": 0
            }
        });
        let error = compile_test_document(legacy_process)
            .expect_err("legacy monochrome process must fail typed node compilation");
        assert!(error.contains("unknown variant `legacy_fixed_band_v1`"));
    }

    #[test]
    fn point_color_compiler_rejects_unowned_missing_oversized_and_out_of_range_params() {
        let mut unowned = current_document();
        unowned["nodes"]["point_color"]["params"]["pointColor"]["futureRange"] = json!(true);
        let error =
            compile_test_document(unowned).expect_err("unowned point-color field must fail");
        assert!(error.contains("unknown field `futureRange`"));

        let mut missing = current_document();
        missing["nodes"]["point_color"]["params"]["pointColor"]
            .as_object_mut()
            .expect("point-color plan object")
            .remove("process");
        let error =
            compile_test_document(missing).expect_err("missing point-color field must fail");
        assert!(error.contains("missing field `process`"));

        let point = point_color_params()["pointColor"]["points"][0].clone();
        let mut too_many_points = current_document();
        too_many_points["nodes"]["point_color"]["params"]["pointColor"]["points"] =
            Value::Array((0..17).map(|_| point.clone()).collect());
        let error = compile_test_document(too_many_points)
            .expect_err("oversized point-color plan must fail");
        assert!(error.contains("point count is invalid"));

        let sample = point_color_params()["pointColor"]["points"][0]["samples"][0].clone();
        let mut too_many_samples = current_document();
        too_many_samples["nodes"]["point_color"]["params"]["pointColor"]["points"][0]["samples"] =
            Value::Array((0..9).map(|_| sample.clone()).collect());
        let error = compile_test_document(too_many_samples)
            .expect_err("oversized point-color samples must fail");
        assert!(error.contains("adjustment identity or samples are invalid"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["point_color"]["params"]["pointColor"]["points"][0]["hueRadiusDegrees"] =
            json!(181);
        let error = compile_test_document(out_of_range)
            .expect_err("out-of-range point-color control must fail");
        assert!(error.contains("hueRadiusDegrees"));

        let mut invalid_process = current_document();
        invalid_process["nodes"]["point_color"]["params"]["pointColor"]["process"] =
            json!("legacy.point-color");
        let error = compile_test_document(invalid_process)
            .expect_err("unknown point-color process must fail");
        assert!(error.contains("process or point count is invalid"));
    }

    #[test]
    fn channel_mixer_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 =
            serde_json::from_value(current_document()).expect("valid channel-mixer document");
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

        let mut unowned = current_document();
        unowned["nodes"]["channel_mixer"]["params"]["channelMixer"]["futureMatrix"] = json!(true);
        let error =
            compile_test_document(unowned).expect_err("unowned channel-mixer field must fail");
        assert!(error.contains("unknown field `futureMatrix`"));

        let mut missing = current_document();
        missing["nodes"]["channel_mixer"]["params"]["channelMixer"]["red"]
            .as_object_mut()
            .expect("red channel-mixer row")
            .remove("green");
        let error = compile_test_document(missing)
            .expect_err("missing channel-mixer coefficient must fail");
        assert!(error.contains("missing field `green`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["channel_mixer"]["params"]["channelMixer"]["red"]["green"] =
            json!(201);
        let error = compile_test_document(out_of_range)
            .expect_err("out-of-range channel-mixer coefficient must fail");
        assert!(error.contains("channel_mixer field 'green'"));

        let mut identity = current_document();
        identity["nodes"]["channel_mixer"]["params"]["channelMixer"] = json!({
            "blue": { "blue": 100, "constant": 0, "green": 0, "red": 0 },
            "enabled": true,
            "green": { "blue": 0, "constant": 0, "green": 100, "red": 0 },
            "preserveLuminance": false,
            "red": { "blue": 0, "constant": 0, "green": 0, "red": 100 }
        });
        let error =
            compile_test_document(identity).expect_err("enabled identity channel mixer must fail");
        assert!(error.contains("must not be identity"));
    }

    #[test]
    fn color_balance_rgb_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 =
            serde_json::from_value(current_document()).expect("valid color-balance document");
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

        let mut missing_current_node = current_document();
        missing_current_node["nodes"]
            .as_object_mut()
            .expect("node map")
            .remove("color_balance_rgb");
        let error = compile_test_document(missing_current_node)
            .expect_err("missing current color-balance node must fail");
        assert!(
            error.contains("missing current node 'color_balance_rgb'")
                || error.contains("missing field `color_balance_rgb`")
        );

        let mut unowned = current_document();
        unowned["nodes"]["color_balance_rgb"]["params"]["colorBalanceRgb"]["futureRange"] =
            json!(true);
        let error =
            compile_test_document(unowned).expect_err("unowned color-balance field must fail");
        assert!(error.contains("unknown field `futureRange`"));

        let mut missing = current_document();
        missing["nodes"]["color_balance_rgb"]["params"]["colorBalanceRgb"]["midtones"]
            .as_object_mut()
            .expect("midtones object")
            .remove("green");
        let error =
            compile_test_document(missing).expect_err("missing color-balance channel must fail");
        assert!(error.contains("missing field `green`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["color_balance_rgb"]["params"]["colorBalanceRgb"]["highlights"]["blue"] =
            json!(101);
        let error = compile_test_document(out_of_range)
            .expect_err("out-of-range color-balance channel must fail");
        assert!(error.contains("highlights.blue"));

        let mut identity = current_document();
        identity["nodes"]["color_balance_rgb"]["params"]["colorBalanceRgb"] = json!({
            "enabled": true,
            "highlights": { "blue": 0, "green": 0, "red": 0 },
            "midtones": { "blue": 0, "green": 0, "red": 0 },
            "preserveLuminance": true,
            "shadows": { "blue": 0, "green": 0, "red": 0 }
        });
        let error =
            compile_test_document(identity).expect_err("enabled identity color balance must fail");
        assert!(error.contains("requires a non-zero channel response"));
    }

    #[test]
    fn luma_levels_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 =
            serde_json::from_value(current_document()).expect("valid levels document");
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

        let mut missing_current_node = current_document();
        missing_current_node["nodes"]
            .as_object_mut()
            .expect("node map")
            .remove("luma_levels");
        let error = compile_test_document(missing_current_node)
            .expect_err("missing current levels node must fail");
        assert!(
            error.contains("missing current node 'luma_levels'")
                || error.contains("missing field `luma_levels`")
        );

        let mut unowned = current_document();
        unowned["nodes"]["luma_levels"]["params"]["levels"]["futurePivot"] = json!(true);
        let error = compile_test_document(unowned).expect_err("unowned levels field must fail");
        assert!(error.contains("unknown field `futurePivot`"));

        let mut missing = current_document();
        missing["nodes"]["luma_levels"]["params"]["levels"]
            .as_object_mut()
            .expect("levels object")
            .remove("gamma");
        let error = compile_test_document(missing).expect_err("missing levels field must fail");
        assert!(error.contains("missing field `gamma`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["luma_levels"]["params"]["levels"]["gamma"] = json!(5.1);
        let error =
            compile_test_document(out_of_range).expect_err("out-of-range levels gamma must fail");
        assert!(error.contains("field 'gamma'"));

        let mut invalid_input = current_document();
        invalid_input["nodes"]["luma_levels"]["params"]["levels"]["inputBlack"] = json!(0.9);
        invalid_input["nodes"]["luma_levels"]["params"]["levels"]["inputWhite"] = json!(0.9);
        let error =
            compile_test_document(invalid_input).expect_err("invalid levels input range must fail");
        assert!(error.contains("inputBlack must be below inputWhite"));

        let mut invalid_output = current_document();
        invalid_output["nodes"]["luma_levels"]["params"]["levels"]["outputBlack"] = json!(0.8);
        invalid_output["nodes"]["luma_levels"]["params"]["levels"]["outputWhite"] = json!(0.2);
        let error = compile_test_document(invalid_output)
            .expect_err("invalid levels output range must fail");
        assert!(error.contains("outputBlack must be below outputWhite"));
    }

    #[test]
    fn selective_color_mixer_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 =
            serde_json::from_value(current_document()).expect("valid selective-color document");
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

        let mut unowned = current_document();
        unowned["nodes"]["selective_color_mixer"]["params"]["futureMixer"] = json!(true);
        let error =
            compile_test_document(unowned).expect_err("unowned selective-color field must fail");
        assert!(error.contains("unknown field `futureMixer`"));

        let mut missing = current_document();
        missing["nodes"]["selective_color_mixer"]["params"]["hsl"]
            .as_object_mut()
            .expect("hsl object")
            .remove("greens");
        let error =
            compile_test_document(missing).expect_err("missing selective-color range must fail");
        assert!(error.contains("missing field `greens`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["selective_color_mixer"]["params"]["hsl"]["reds"]["saturation"] =
            json!(101);
        let error = compile_test_document(out_of_range)
            .expect_err("out-of-range selective-color value must fail");
        assert!(error.contains("hsl.reds.saturation"));

        let mut invalid_control = current_document();
        invalid_control["nodes"]["selective_color_mixer"]["params"]["selectiveColorRangeControls"]
            ["reds"]["centerHueDegrees"] = json!(360);
        let error = compile_test_document(invalid_control)
            .expect_err("invalid selective-color range control must fail");
        assert!(error.contains("selectiveColorRangeControls.reds.centerHueDegrees"));
    }

    #[test]
    fn skin_tone_uniformity_compiler_is_strict_and_drives_native_pixel_output() {
        let document: EditDocumentV2 =
            serde_json::from_value(current_document()).expect("valid skin-tone document");
        let compiled = document
            .into_render_adjustments()
            .expect("skin-tone document compiles");
        let adjustments = get_all_adjustments_from_json(&compiled, false, None);
        let input = Vec3::new(0.42, 0.12, 0.045);
        let output = apply_skin_tone_uniformity(input, adjustments.global.skin_tone_uniformity);
        assert!(
            output.distance(input) > 1.0e-4,
            "skin-tone node must alter a representative warm pixel: {output:?}"
        );

        let mut unowned = current_document();
        unowned["nodes"]["skin_tone_uniformity"]["params"]["futureUniformity"] = json!(true);
        let error = compile_test_document(unowned).expect_err("unowned skin-tone field must fail");
        assert!(error.contains("unknown field `futureUniformity`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["skin_tone_uniformity"]["params"]["skinToneUniformity"]["targetHueDegrees"] =
            json!(360);
        let error =
            compile_test_document(out_of_range).expect_err("out-of-range skin-tone hue must fail");
        assert!(error.contains("targetHueDegrees"));

        let mut conflict = current_document();
        conflict["extensions"]["legacyAdjustments"] = skin_tone_uniformity_params();
        let error = serde_json::from_value::<EditDocumentV2>(conflict)
            .expect_err("legacy skin-tone authority must fail");
        assert!(
            error
                .to_string()
                .contains("unknown field `legacyAdjustments`")
        );
    }

    #[test]
    fn lens_correction_compiler_rejects_unowned_malformed_and_out_of_range_params() {
        let mut pre_manual_ca = current_document();
        let params = pre_manual_ca["nodes"]["lens_correction"]["params"]
            .as_object_mut()
            .expect("lens params object");
        params.remove("chromaticAberrationBlueYellow");
        params.remove("chromaticAberrationRedCyan");
        let error = compile_test_document(pre_manual_ca)
            .expect_err("missing current chromatic-aberration controls must fail");
        assert!(error.contains("missing field `chromaticAberrationBlueYellow`"));

        let mut unowned = current_document();
        unowned["nodes"]["lens_correction"]["params"]["futureOptic"] = json!(1);
        let error = compile_test_document(unowned).expect_err("unowned lens field must fail");
        assert!(error.contains("unknown field `futureOptic`"));

        let mut malformed = current_document();
        malformed["nodes"]["lens_correction"]["params"]["lensDistortionParams"] =
            json!({ "k1": 0.1 });
        let error =
            compile_test_document(malformed).expect_err("incomplete lens profile must fail");
        assert!(error.contains("lens_correction is invalid") || error.contains("missing field"));

        for field in [
            "lensDistortionAmount",
            "lensTcaAmount",
            "lensVignetteAmount",
        ] {
            for invalid in [json!(201), json!(100.5)] {
                let mut out_of_range = current_document();
                out_of_range["nodes"]["lens_correction"]["params"][field] = invalid;
                let error = compile_test_document(out_of_range)
                    .expect_err("non-integer or out-of-range lens amount must fail");
                assert!(
                    error.contains(field)
                        || error.contains("lens_correction is invalid")
                        || error.contains("expected u16"),
                    "{error}"
                );
            }
        }

        for (field, invalid) in [
            ("chromaticAberrationBlueYellow", json!(-101)),
            ("chromaticAberrationRedCyan", json!(101)),
        ] {
            let mut out_of_range = current_document();
            out_of_range["nodes"]["lens_correction"]["params"][field] = invalid;
            let error =
                compile_test_document(out_of_range).expect_err("out-of-range manual CA must fail");
            assert!(error.contains(field));
        }

        for field in [
            "k1", "k2", "k3", "tca_vb", "tca_vr", "vig_k1", "vig_k2", "vig_k3",
        ] {
            let mut coefficient = current_document();
            coefficient["nodes"]["lens_correction"]["params"]["lensDistortionParams"] = json!({
                "k1": 0, "k2": 0, "k3": 0, "model": 1, "tca_vb": 1, "tca_vr": 1,
                "vig_k1": 0, "vig_k2": 0, "vig_k3": 0
            });
            coefficient["nodes"]["lens_correction"]["params"]["lensDistortionParams"][field] =
                json!(10.1);
            let error = compile_test_document(coefficient)
                .expect_err("out-of-range lens coefficient must fail");
            assert!(error.contains("[-10, 10]"));
        }

        for invalid_model in [json!(11), json!(1.5)] {
            let mut model = current_document();
            model["nodes"]["lens_correction"]["params"]["lensDistortionParams"] = json!({
                "k1": 0, "k2": 0, "k3": 0, "model": invalid_model, "tca_vb": 1, "tca_vr": 1,
                "vig_k1": 0, "vig_k2": 0, "vig_k3": 0
            });
            let error = compile_test_document(model)
                .expect_err("non-integer or out-of-range lens model must fail");
            assert!(
                error.contains("model")
                    || error.contains("lens_correction is invalid")
                    || error.contains("expected u8")
            );
        }

        for (field, value) in [
            ("lensMaker", "x".repeat(161)),
            ("lensModel", "x".repeat(241)),
        ] {
            let mut identity = current_document();
            identity["nodes"]["lens_correction"]["params"][field] = json!(value);
            if field == "lensModel" {
                identity["nodes"]["lens_correction"]["params"]["lensMaker"] = json!("maker");
            }
            let error =
                compile_test_document(identity).expect_err("oversized lens identity must fail");
            assert!(error.contains(if field == "lensMaker" {
                "maker"
            } else {
                "model"
            }));
        }
    }

    #[test]
    fn perceptual_grading_compiler_rejects_unowned_missing_and_invalid_params() {
        let mut unowned = current_document();
        unowned["nodes"]["perceptual_grading"]["params"]["futureGrading"] = json!(true);
        let error =
            compile_test_document(unowned).expect_err("unowned perceptual-grading field must fail");
        assert!(error.contains("unknown field `futureGrading`"));

        let mut missing = current_document();
        missing["nodes"]["perceptual_grading"]["params"]
            .as_object_mut()
            .expect("perceptual-grading params object")
            .remove("perceptualGradingV1");
        let error =
            compile_test_document(missing).expect_err("missing perceptual-grading plan must fail");
        assert!(error.contains("missing field `perceptualGradingV1`"));

        let mut legacy_range = current_document();
        legacy_range["nodes"]["perceptual_grading"]["params"]["colorGrading"]["midtones"]["saturation"] =
            json!(101);
        let error =
            compile_test_document(legacy_range).expect_err("out-of-range legacy grading must fail");
        assert!(error.contains("wheel range is invalid"));

        let mut fulcrums = current_document();
        fulcrums["nodes"]["perceptual_grading"]["params"]["perceptualGradingV1"]["highlightFulcrumEv"] =
            json!(-3);
        let error =
            compile_test_document(fulcrums).expect_err("invalid perceptual fulcrums must fail");
        assert!(error.contains("Fulcrums"));
    }

    #[test]
    fn color_calibration_compiler_rejects_unowned_missing_and_out_of_range_params() {
        let mut unowned = current_document();
        unowned["nodes"]["color_calibration"]["params"]["colorCalibration"]["futurePrimary"] =
            json!(true);
        let error =
            compile_test_document(unowned).expect_err("unowned color-calibration field must fail");
        assert!(error.contains("unknown field `futurePrimary`"));

        let mut missing = current_document();
        missing["nodes"]["color_calibration"]["params"]["colorCalibration"]
            .as_object_mut()
            .expect("color-calibration settings object")
            .remove("blueHue");
        let error =
            compile_test_document(missing).expect_err("missing color-calibration field must fail");
        assert!(error.contains("missing field `blueHue`"));

        let mut out_of_range = current_document();
        out_of_range["nodes"]["color_calibration"]["params"]["colorCalibration"]["redHue"] =
            json!(101);
        let error = compile_test_document(out_of_range)
            .expect_err("out-of-range color calibration must fail");
        assert!(error.contains("redHue"));
    }

    #[test]
    fn geometry_compiler_rejects_unowned_out_of_range_and_out_of_bounds_params() {
        let mut transformed = current_document();
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
        compile_test_document(transformed).expect("current transform geometry remains compilable");

        let valid_crop =
            json!({ "height": 0.6, "unit": "normalized", "width": 0.6, "x": 0.1, "y": 0.1 });
        let mut valid = current_document();
        valid["nodes"]["geometry"]["params"]["crop"] = valid_crop.clone();
        valid["nodes"]["geometry"]["params"]["rotation"] = json!(-5.5);
        valid["geometry"]["crop"] = valid_crop.clone();
        valid["geometry"]["rotation"] = json!(-5.5);
        let compiled = compile_test_document(valid)
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
        let mut perspective_document = current_document();
        perspective_document["nodes"]["geometry"]["params"]["perspectiveCorrection"] =
            perspective.clone();
        perspective_document["geometry"]["perspectiveCorrection"] = perspective.clone();
        let compiled = compile_test_document(perspective_document)
            .expect("perspective geometry compiles into native render authority");
        assert_eq!(compiled["perspectiveCorrection"], perspective);
        assert!(compiled["lensDistortionParams"].is_null());
        assert!(!crate::geometry::is_geometry_identity(
            &crate::geometry::get_geometry_params_from_json(&compiled)
        ));

        let mut missing_perspective = current_document();
        let incomplete = json!({
            "amount": 50,
            "guides": [],
            "mode": "guided",
            "resolvedPlan": null
        });
        missing_perspective["nodes"]["geometry"]["params"]["perspectiveCorrection"] =
            incomplete.clone();
        missing_perspective["geometry"]["perspectiveCorrection"] = incomplete;
        let error = compile_test_document(missing_perspective)
            .expect_err("incomplete perspective node state must fail");
        assert!(error.contains("missing field 'cropPolicy'"));

        let mut out_of_range_perspective = current_document();
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
        let error = compile_test_document(out_of_range_perspective)
            .expect_err("out-of-range perspective amount must fail");
        assert!(error.contains("amount must be within 0..=100"));

        let mut unowned = current_document();
        unowned["nodes"]["geometry"]["params"]["futureWarp"] = json!(1);
        let error = compile_test_document(unowned).expect_err("unowned geometry field must fail");
        assert!(error.contains("unknown field `futureWarp`"));

        let mut rotation = current_document();
        rotation["nodes"]["geometry"]["params"]["rotation"] = json!(46);
        rotation["geometry"]["rotation"] = json!(46);
        let error = compile_test_document(rotation).expect_err("out-of-range rotation must fail");
        assert!(error.contains("rotation must be within -45..=45"));

        let mut transform_scale = current_document();
        transform_scale["nodes"]["geometry"]["params"]["transformScale"] = json!(151);
        transform_scale["geometry"]["transformScale"] = json!(151);
        let error = compile_test_document(transform_scale)
            .expect_err("out-of-range transform scale must fail");
        assert!(error.contains("transformScale"));

        let invalid_crop =
            json!({ "height": 0.8, "unit": "normalized", "width": 0.8, "x": 0.3, "y": 0.3 });
        let mut crop = current_document();
        crop["nodes"]["geometry"]["params"]["crop"] = invalid_crop.clone();
        crop["geometry"]["crop"] = invalid_crop;
        let error = compile_test_document(crop).expect_err("out-of-bounds crop must fail");
        assert!(error.contains("crop exceeds its unit bounds"));

        let mut unknown_domain = current_document();
        unknown_domain["geometry"]["futureWarp"] = json!(1);
        assert!(serde_json::from_value::<EditDocumentV2>(unknown_domain).is_err());
    }

    #[test]
    fn compiles_strict_source_artifacts_without_legacy_extension_state() {
        let patch = source_patch();
        let mut value = current_document();
        value["nodes"]["color_presence"]["params"]["vibrance"] = json!(12);
        value["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch] });
        value["sourceArtifacts"] = json!({ "aiPatches": [patch] });
        let compiled = compile_test_document(value).expect("compiled source document");

        assert_eq!(compiled["aiPatches"][0]["id"], json!("patch-1"));
        assert_eq!(compiled["vibrance"], json!(12));
        assert!(compiled.get("referenceMatchApplicationReceipt").is_none());
    }

    #[test]
    fn rejects_malformed_duplicate_ambiguous_and_legacy_owned_source_state() {
        let patch = source_patch();
        let mut malformed = current_document();
        malformed["nodes"]["source_artifacts"]["params"] =
            json!({ "aiPatches": [{ "id": "patch-1", "unsupported": true }] });
        let error = compile_test_document(malformed).expect_err("malformed source node must fail");
        assert!(error.contains("source artifacts are invalid") || error.contains("unknown field"));

        let mut duplicate = current_document();
        duplicate["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch, patch] });
        duplicate["sourceArtifacts"] = json!({ "aiPatches": [patch, patch] });
        let error = compile_test_document(duplicate).expect_err("duplicate source IDs must fail");
        assert!(error.contains("non-empty and unique"));

        let mut ambiguous = current_document();
        ambiguous["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch] });
        let error =
            compile_test_document(ambiguous).expect_err("ambiguous source domains must fail");
        assert!(error.contains("domain disagrees"));

        let mut legacy_owned = current_document();
        legacy_owned["extensions"]["legacyAdjustments"] = json!({
            "referenceMatchApplicationReceipt": { "schemaVersion": 1 }
        });
        let error = serde_json::from_value::<EditDocumentV2>(legacy_owned)
            .expect_err("legacy-owned provenance must fail");
        assert!(
            error
                .to_string()
                .contains("unknown field `legacyAdjustments`")
        );
    }

    #[test]
    fn compiles_strict_layers_and_rejects_duplicate_or_ambiguous_layer_state() {
        let layer = layer();
        let mut value = current_document();
        value["nodes"]["layers"]["params"] = json!({ "masks": [layer] });
        value["layers"] = json!({ "masks": [layer] });
        let compiled = compile_test_document(value).expect("compiled layers document");
        assert_eq!(compiled["masks"][0]["id"], json!("layer-1"));

        let mut duplicate = current_document();
        duplicate["nodes"]["layers"]["params"] = json!({ "masks": [layer, layer] });
        duplicate["layers"] = json!({ "masks": [layer, layer] });
        let error = compile_test_document(duplicate).expect_err("duplicate layer IDs must fail");
        assert!(error.contains("non-empty and unique"));

        let mut ambiguous = current_document();
        ambiguous["nodes"]["layers"]["params"] = json!({ "masks": [layer] });
        let error = compile_test_document(ambiguous).expect_err("ambiguous layers must fail");
        assert!(error.contains("layers domain disagrees"));
    }
}
