//! Versioned execution contract for the production edit pipeline.
//!
//! The graph is authoritative for ordering, domains, cache identity, and the
//! deliberate scene-linear and view/display GPU execution boundaries.

use std::sync::Arc;

use bytemuck::bytes_of;

use crate::adjustments::abi::{
    AllAdjustments, BlackWhiteMixerSettings, ChannelMixerSettings, ColorBalanceRgbSettings,
    ColorCalibrationSettings, ColorGradeSettings, GpuMat3, HslColor, LevelsSettings,
    MaskAdjustments, Point, ToneEqualizerGpuSettings,
};
use crate::render::film_emulation::FilmEmulationParams;
use crate::tone::curves::CompiledCurvePlanV1;
use crate::tone::output_curves::CompiledOutputCurvePlanV1;

pub const EDIT_GRAPH_SCHEMA_VERSION: u32 = 1;
pub const LEGACY_PIPELINE_VERSION: u32 = 1;
pub const SCENE_REFERRED_PIPELINE_VERSION: u32 = 2;
pub const SUPPORTED_PIPELINE_VERSIONS: &[u32] =
    &[LEGACY_PIPELINE_VERSION, SCENE_REFERRED_PIPELINE_VERSION];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ColorDomain {
    AcesCgSceneLinearExtended,
    ViewEncoded,
    RenderTransportEncoded,
}

impl ColorDomain {
    pub fn contract_id(self) -> &'static str {
        match self {
            Self::AcesCgSceneLinearExtended => "acescg_scene_linear_extended_v1",
            Self::ViewEncoded => "display_encoded_srgb_v1",
            Self::RenderTransportEncoded => "render_transport_encoded_v1",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum EditStageClass {
    InputTransform,
    SceneTechnical,
    SpatialDetail,
    SceneCreative,
    LocalComposition,
    ViewTransform,
    LegacyFusedSceneView,
    DisplayAdjustment,
    OutputTransform,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ValueRangePolicy {
    PreserveFiniteExtended,
    LegacyImplementationDefined,
    BoundForOutputEncoding,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum AlphaPolicy {
    PreserveStraight,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PrecisionPolicy {
    Float16OrBetter,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SpatialSupport {
    Pointwise,
    BoundedHalo { pixels: u16 },
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LocalAdjustmentPolicy {
    GlobalOnly,
    GlobalAndLocalSameDomain,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum EditNodeKind {
    CameraInputBoundary,
    GeometryRetouch,
    PreGpuSpatialDetail,
    SceneGlobalColorTone,
    SceneCurve,
    FilmEmulation,
    LocalSceneComposition,
    SceneToViewTransform,
    DisplayCreative,
    OutputCurve,
    LegacyGpuSceneViewPass,
    ClippingOverlay,
    RenderTransport,
}

impl EditNodeKind {
    pub fn stable_id(self) -> &'static str {
        match self {
            Self::CameraInputBoundary => "camera_input_boundary",
            Self::GeometryRetouch => "geometry_retouch",
            Self::PreGpuSpatialDetail => "pre_gpu_spatial_detail",
            Self::SceneGlobalColorTone => "scene_global_color_tone",
            Self::SceneCurve => "scene_curve_v1",
            Self::FilmEmulation => "film_emulation_v1",
            Self::LocalSceneComposition => "local_scene_composition",
            Self::SceneToViewTransform => "scene_to_view_transform",
            Self::DisplayCreative => "display_creative",
            Self::OutputCurve => "output_curve_v1",
            Self::LegacyGpuSceneViewPass => "legacy_gpu_scene_view_pass",
            Self::ClippingOverlay => "clipping_overlay",
            Self::RenderTransport => "render_transport",
        }
    }
}

/// Typed bind-group specialization owned by an executable node descriptor.
///
/// Curve modules have an executable storage-buffer layout. Fused production
/// modules retain phase-specific logical resource contracts even though the
/// current shader shares one physical bind group across its dispatches.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WgpuBindGroupLayoutKind {
    CurveStorageV1,
    FusedSceneSpatialV2,
    FusedSceneSpatialMaskV2,
    FusedViewLutV2,
    FusedDisplayLutMaskV2,
    FusedLegacySceneViewV1,
    ExternalPointwiseV1,
}

impl WgpuBindGroupLayoutKind {
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::CurveStorageV1 => "curve_storage_v1",
            Self::FusedSceneSpatialV2 => "fused_scene_spatial_v2",
            Self::FusedSceneSpatialMaskV2 => "fused_scene_spatial_mask_v2",
            Self::FusedViewLutV2 => "fused_view_lut_v2",
            Self::FusedDisplayLutMaskV2 => "fused_display_lut_mask_v2",
            Self::FusedLegacySceneViewV1 => "fused_legacy_scene_view_v1",
            Self::ExternalPointwiseV1 => "external_pointwise_v1",
        }
    }

    pub fn accepts_resources(self, resources: &[&str]) -> bool {
        match self {
            Self::CurveStorageV1 | Self::ExternalPointwiseV1 => resources.is_empty(),
            Self::FusedSceneSpatialV2 => resources == ["scene_guidance_v1"],
            Self::FusedSceneSpatialMaskV2 => resources == ["scene_guidance_v1", "mask_layers_v1"],
            Self::FusedViewLutV2 => resources == ["view_transform_lut_v1"],
            Self::FusedDisplayLutMaskV2 => resources == ["display_lut_v1", "mask_layers_v1"],
            Self::FusedLegacySceneViewV1 => resources == ["legacy_scene_blur_v1", "mask_layers_v1"],
        }
    }
}

/// Backend ownership and resource requirements for one executable graph node.
/// The descriptor is deliberately backend-neutral: the current WGPU runtime
/// may fuse several descriptors into one dispatch, but the graph still has one
/// inspectable owner for each node.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EditNodeRuntimeDescriptor {
    pub kind: EditNodeKind,
    pub schema_version: u32,
    pub implementation_version: u32,
    pub cpu_implementation: Option<&'static str>,
    pub wgpu_implementation: Option<&'static str>,
    pub wgpu_bind_group_layout: Option<WgpuBindGroupLayoutKind>,
    pub fused_phase: Option<&'static str>,
    pub resource_requirements: &'static [&'static str],
    pub supports_local: bool,
    pub legacy_compatibility: bool,
}

impl EditNodeRuntimeDescriptor {
    /// WGPU entry-point identity belongs to the node descriptor even when
    /// compatible nodes are fused into one production dispatch.
    pub const fn wgpu_entry_point(self) -> Option<&'static str> {
        match self.wgpu_implementation {
            Some(_) => Some("main"),
            None => None,
        }
    }

    /// Halo ownership follows the descriptor's spatial resource contract.
    /// Pointwise LUT/display modules intentionally retain a zero halo.
    pub const fn wgpu_halo_pixels(self) -> u16 {
        match self.kind {
            EditNodeKind::SceneGlobalColorTone
            | EditNodeKind::LocalSceneComposition
            | EditNodeKind::LegacyGpuSceneViewPass => 64,
            _ => 0,
        }
    }
}

macro_rules! runtime_descriptor {
    ($kind:ident, $cpu:expr, $wgpu:expr, $layout:expr, $phase:expr, $resources:expr, $local:expr, $legacy:expr) => {
        EditNodeRuntimeDescriptor {
            kind: EditNodeKind::$kind,
            schema_version: 1,
            implementation_version: 1,
            cpu_implementation: $cpu,
            wgpu_implementation: $wgpu,
            wgpu_bind_group_layout: $layout,
            fused_phase: $phase,
            resource_requirements: $resources,
            supports_local: $local,
            legacy_compatibility: $legacy,
        }
    };
}

const NO_RESOURCES: &[&str] = &[];
const SCENE_SPATIAL_RESOURCES: &[&str] = &["scene_guidance_v1"];
const LOCAL_SCENE_RESOURCES: &[&str] = &["scene_guidance_v1", "mask_layers_v1"];
const VIEW_RESOURCES: &[&str] = &["view_transform_lut_v1"];
const DISPLAY_RESOURCES: &[&str] = &["display_lut_v1", "mask_layers_v1"];

static CAMERA_INPUT_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    CameraInputBoundary,
    Some("camera_input_transform_v1"),
    None,
    None,
    None,
    NO_RESOURCES,
    false,
    false
);
static GEOMETRY_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    GeometryRetouch,
    Some("geometry_retouch_cpu_v2"),
    None,
    None,
    None,
    &["geometry_tiles_v1"],
    false,
    false
);
static PRE_GPU_DETAIL_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    PreGpuSpatialDetail,
    Some("pre_gpu_detail_cpu_v1"),
    None,
    None,
    None,
    &["detail_guidance_v1"],
    false,
    false
);
static SCENE_GLOBAL_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    SceneGlobalColorTone,
    Some("edit_graph_cpu_reference_v2"),
    Some("shader_wgsl_scene_phase_v2"),
    Some(WgpuBindGroupLayoutKind::FusedSceneSpatialV2),
    Some("scene"),
    SCENE_SPATIAL_RESOURCES,
    false,
    false
);
static SCENE_CURVE_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    SceneCurve,
    Some("scene_curve_cpu_v1"),
    Some("scene_curve_wgsl_v1"),
    Some(WgpuBindGroupLayoutKind::CurveStorageV1),
    Some("scene"),
    NO_RESOURCES,
    false,
    false
);
static FILM_EMULATION_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    FilmEmulation,
    Some("film_emulation_cpu_v1"),
    Some("film_emulation_wgsl_v1"),
    Some(WgpuBindGroupLayoutKind::ExternalPointwiseV1),
    Some("scene"),
    NO_RESOURCES,
    false,
    false
);
static LOCAL_SCENE_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    LocalSceneComposition,
    Some("edit_graph_cpu_reference_v2"),
    Some("shader_wgsl_scene_phase_v2"),
    Some(WgpuBindGroupLayoutKind::FusedSceneSpatialMaskV2),
    Some("scene"),
    LOCAL_SCENE_RESOURCES,
    true,
    false
);
static VIEW_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    SceneToViewTransform,
    Some("edit_graph_cpu_reference_v2"),
    Some("shader_wgsl_view_display_phase_v2"),
    Some(WgpuBindGroupLayoutKind::FusedViewLutV2),
    Some("view"),
    VIEW_RESOURCES,
    false,
    false
);
static DISPLAY_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    DisplayCreative,
    Some("edit_graph_cpu_reference_v2"),
    Some("shader_wgsl_view_display_phase_v2"),
    Some(WgpuBindGroupLayoutKind::FusedDisplayLutMaskV2),
    Some("display"),
    DISPLAY_RESOURCES,
    true,
    false
);
static OUTPUT_CURVE_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    OutputCurve,
    Some("output_curve_cpu_v1"),
    Some("output_curve_wgsl_v1"),
    Some(WgpuBindGroupLayoutKind::CurveStorageV1),
    Some("display"),
    NO_RESOURCES,
    false,
    false
);
static LEGACY_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    LegacyGpuSceneViewPass,
    Some("native_color_mixer_post_wgpu_v1"),
    Some("shader_wgsl_legacy_scene_view_v1"),
    Some(WgpuBindGroupLayoutKind::FusedLegacySceneViewV1),
    Some("legacy"),
    &["legacy_scene_blur_v1", "mask_layers_v1"],
    true,
    true
);
static CLIPPING_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    ClippingOverlay,
    None,
    Some("clipping_overlay_wgsl_v1"),
    Some(WgpuBindGroupLayoutKind::ExternalPointwiseV1),
    Some("display"),
    NO_RESOURCES,
    false,
    false
);
static TRANSPORT_RUNTIME: EditNodeRuntimeDescriptor = runtime_descriptor!(
    RenderTransport,
    None,
    Some("shader_transport_dither_v1"),
    Some(WgpuBindGroupLayoutKind::ExternalPointwiseV1),
    Some("transport"),
    NO_RESOURCES,
    false,
    false
);

/// Single ownership table for executable graph nodes.
///
/// The graph compiler and backend runtimes resolve descriptors through this
/// table instead of maintaining separate CPU/WGPU ordering lists.  Fused
/// implementations may share an implementation id, but each graph kind has
/// exactly one descriptor and therefore one inspectable owner.
pub const EDIT_NODE_RUNTIME_REGISTRY: &[&EditNodeRuntimeDescriptor] = &[
    &CAMERA_INPUT_RUNTIME,
    &GEOMETRY_RUNTIME,
    &PRE_GPU_DETAIL_RUNTIME,
    &SCENE_GLOBAL_RUNTIME,
    &SCENE_CURVE_RUNTIME,
    &FILM_EMULATION_RUNTIME,
    &LOCAL_SCENE_RUNTIME,
    &VIEW_RUNTIME,
    &DISPLAY_RUNTIME,
    &OUTPUT_CURVE_RUNTIME,
    &LEGACY_RUNTIME,
    &CLIPPING_RUNTIME,
    &TRANSPORT_RUNTIME,
];

pub fn runtime_descriptor(kind: EditNodeKind) -> &'static EditNodeRuntimeDescriptor {
    EDIT_NODE_RUNTIME_REGISTRY
        .iter()
        .copied()
        .find(|descriptor| descriptor.kind == kind)
        .expect("every EditNodeKind must have one runtime descriptor")
}

pub const ALL_EDIT_NODE_KINDS: &[EditNodeKind] = &[
    EditNodeKind::CameraInputBoundary,
    EditNodeKind::GeometryRetouch,
    EditNodeKind::PreGpuSpatialDetail,
    EditNodeKind::SceneGlobalColorTone,
    EditNodeKind::SceneCurve,
    EditNodeKind::FilmEmulation,
    EditNodeKind::LocalSceneComposition,
    EditNodeKind::SceneToViewTransform,
    EditNodeKind::DisplayCreative,
    EditNodeKind::OutputCurve,
    EditNodeKind::LegacyGpuSceneViewPass,
    EditNodeKind::ClippingOverlay,
    EditNodeKind::RenderTransport,
];

fn validate_runtime_registry(registry: &[&EditNodeRuntimeDescriptor]) -> Result<(), &'static str> {
    if registry.is_empty() {
        return Err("edit_graph.empty_runtime_registry");
    }
    for (index, descriptor) in registry.iter().enumerate() {
        if descriptor.schema_version == 0 || descriptor.implementation_version == 0 {
            return Err("edit_graph.invalid_runtime_descriptor_version");
        }
        if descriptor.cpu_implementation.is_none() && descriptor.wgpu_implementation.is_none() {
            return Err("edit_graph.missing_runtime_backend_owner");
        }
        if descriptor.wgpu_implementation.is_some() != descriptor.wgpu_bind_group_layout.is_some() {
            return Err("edit_graph.wgpu_bind_group_layout_ownership_mismatch");
        }
        if descriptor
            .wgpu_bind_group_layout
            .is_some_and(|layout| !layout.accepts_resources(descriptor.resource_requirements))
        {
            return Err("edit_graph.wgpu_bind_group_layout_resource_mismatch");
        }
        if registry[..index]
            .iter()
            .any(|previous| previous.kind == descriptor.kind)
        {
            return Err("edit_graph.duplicate_runtime_descriptor");
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub struct NodeDependencies {
    pub source: bool,
    pub adjustments: bool,
    pub geometry: bool,
    pub masks: bool,
    pub view: bool,
    pub output: bool,
}

#[derive(Clone, Debug)]
pub struct CompiledEditNode {
    pub kind: EditNodeKind,
    pub schema_version: u32,
    pub implementation_version: u32,
    pub input_domain: ColorDomain,
    pub output_domain: ColorDomain,
    pub stage_class: EditStageClass,
    pub range_policy: ValueRangePolicy,
    pub alpha_policy: AlphaPolicy,
    pub precision: PrecisionPolicy,
    pub dependencies: NodeDependencies,
    pub spatial_support: SpatialSupport,
    pub local_adjustment_policy: LocalAdjustmentPolicy,
    pub cpu_implementation: Option<&'static str>,
    pub wgpu_implementation: Option<&'static str>,
    pub payload_fingerprint: u64,
    pub payload: CompiledNodePayload,
}

#[derive(Clone, Debug)]
pub enum CompiledNodePayload {
    InputBoundary { source_fingerprint: u64 },
    GeometryRetouch { geometry: u64, retouch: u64 },
    PreGpuSpatialDetail { detail_fingerprint: u64 },
    LegacyShaderAbi(Box<AllAdjustments>),
    SceneGlobal(Box<SceneGlobalPayload>),
    SceneCurve(CompiledCurvePlanV1),
    FilmEmulation(FilmEmulationParams),
    LocalScene(LocalScenePayload),
    ViewTransform(ViewTransformPayload),
    DisplayCreative(Box<DisplayCreativePayload>),
    OutputCurve(CompiledOutputCurvePlanV1),
    ClippingOverlay { enabled: bool },
    RenderTransport { output_fingerprint: u64 },
}

impl CompiledNodePayload {
    pub fn kind_id(&self) -> &'static str {
        match self {
            Self::InputBoundary { .. } => "input_boundary_v1",
            Self::GeometryRetouch { .. } => "geometry_retouch_v1",
            Self::PreGpuSpatialDetail { .. } => "pre_gpu_spatial_detail_v1",
            Self::LegacyShaderAbi(_) => "legacy_all_adjustments_shader_abi_v1",
            Self::SceneGlobal(_) => "scene_global_typed_v2",
            Self::SceneCurve(_) => "scene_curve_typed_v1",
            Self::FilmEmulation(_) => "film_emulation_typed_v1",
            Self::LocalScene(_) => "local_scene_typed_v2",
            Self::ViewTransform(_) => "view_transform_typed_v2",
            Self::DisplayCreative(_) => "display_creative_typed_v2",
            Self::OutputCurve(_) => "output_curve_typed_v1",
            Self::ClippingOverlay { .. } => "clipping_overlay_v1",
            Self::RenderTransport { .. } => "render_transport_v1",
        }
    }

    fn belongs_to(&self, kind: EditNodeKind) -> bool {
        matches!(
            (self, kind),
            (
                Self::InputBoundary { .. },
                EditNodeKind::CameraInputBoundary
            ) | (Self::GeometryRetouch { .. }, EditNodeKind::GeometryRetouch)
                | (
                    Self::PreGpuSpatialDetail { .. },
                    EditNodeKind::PreGpuSpatialDetail
                )
                | (
                    Self::LegacyShaderAbi(_),
                    EditNodeKind::LegacyGpuSceneViewPass
                )
                | (Self::SceneGlobal(_), EditNodeKind::SceneGlobalColorTone)
                | (Self::SceneCurve(_), EditNodeKind::SceneCurve)
                | (Self::FilmEmulation(_), EditNodeKind::FilmEmulation)
                | (Self::LocalScene(_), EditNodeKind::LocalSceneComposition)
                | (Self::ViewTransform(_), EditNodeKind::SceneToViewTransform)
                | (Self::DisplayCreative(_), EditNodeKind::DisplayCreative)
                | (Self::OutputCurve(_), EditNodeKind::OutputCurve)
                | (Self::ClippingOverlay { .. }, EditNodeKind::ClippingOverlay)
                | (Self::RenderTransport { .. }, EditNodeKind::RenderTransport)
        )
    }

    fn diagnostic(&self) -> serde_json::Value {
        match self {
            Self::InputBoundary { source_fingerprint } => serde_json::json!({
                "sourceFingerprint": format!("{source_fingerprint:016x}"),
            }),
            Self::GeometryRetouch { geometry, retouch } => serde_json::json!({
                "geometryFingerprint": format!("{geometry:016x}"),
                "retouchFingerprint": format!("{retouch:016x}"),
            }),
            Self::PreGpuSpatialDetail { detail_fingerprint } => serde_json::json!({
                "detailFingerprint": format!("{detail_fingerprint:016x}"),
            }),
            Self::LegacyShaderAbi(adjustments) => serde_json::json!({
                "compatibilityAbiBytes": bytes_of(adjustments.as_ref()).len(),
            }),
            Self::SceneGlobal(scene) => serde_json::json!({
                "exposure": scene.exposure, "brightness": scene.brightness,
                "contrast": scene.contrast, "highlights": scene.highlights,
                "shadows": scene.shadows, "whites": scene.whites,
                "blacks": scene.blacks, "saturation": scene.saturation,
                "temperature": scene.temperature, "tint": scene.tint,
                "vibrance": scene.vibrance, "hue": scene.hue,
                "sharpness": scene.sharpness, "sharpnessThreshold": scene.sharpness_threshold,
                "lumaNoiseReduction": scene.luma_noise_reduction,
                "colorNoiseReduction": scene.color_noise_reduction,
                "clarity": scene.clarity, "dehaze": scene.dehaze,
                "structure": scene.structure, "centre": scene.centre,
                "chromaticAberration": scene.chromatic_aberration,
                "glow": scene.glow, "halation": scene.halation, "flare": scene.flare,
                "vignette": scene.vignette,
                "colorCalibration": scene.color_calibration,
                "colorBalanceRgb": scene.color_balance_rgb,
                "channelMixer": scene.channel_mixer,
                "blackWhiteMixer": scene.black_white_mixer,
                "levels": scene.levels, "hsl": scene.hsl, "grading": scene.grading,
                "gradingBlending": scene.grading_blending,
                "gradingBalance": scene.grading_balance,
                "toneEqualizer": scene.tone_equalizer,
            }),
            Self::SceneCurve(curve) => serde_json::json!({
                "domain": format!("{:?}", curve.domain),
                "channelMode": format!("{:?}", curve.channel_mode),
                "middleGrey": curve.middle_grey,
                "points": curve.points.iter().map(|point| [point.x_ev, point.y_ev]).collect::<Vec<_>>(),
                "fingerprint": format!("{:016x}", curve.fingerprint),
                "implementationVersion": curve.implementation_version,
            }),
            Self::FilmEmulation(params) => serde_json::json!({
                "enabled": params.enabled,
                "mix": params.mix,
                "shaperP": params.shaper_p,
                "profile": crate::render::film_emulation::REFERENCE_PROFILE_ID,
                "receipt": crate::render::film_emulation::runtime_receipt(*params, "uncomputed"),
            }),
            Self::LocalScene(local) => serde_json::json!({
                "layerCount": local.layers.len(),
                "layers": local.layers.iter().map(LocalSceneLayerPayload::diagnostic).collect::<Vec<_>>(),
            }),
            Self::ViewTransform(view) => serde_json::json!({
                "tonemapperMode": view.tonemapper_mode, "isRaw": view.is_raw,
                "pipeToRendering": view.pipe_to_rendering,
                "renderingToPipe": view.rendering_to_pipe,
                "rapidViewParameters": view.rapid_view_parameters,
            }),
            Self::DisplayCreative(display) => serde_json::json!({
                "curves": display.curves, "curveCounts": display.curve_counts,
                "lutEnabled": display.lut_enabled, "lutIntensity": display.lut_intensity,
                "grain": display.grain,
                "localDisplayLayers": display.local_layers.iter()
                    .map(LocalDisplayLayerPayload::diagnostic).collect::<Vec<_>>(),
            }),
            Self::OutputCurve(curve) => serde_json::json!({
                "domain": format!("{:?}", curve.target.domain),
                "sdrReferenceWhiteNits": curve.target.sdr_reference_white_nits,
                "peakNits": curve.target.peak_nits,
                "points": curve.points.iter().map(|point| [point.input, point.output]).collect::<Vec<_>>(),
                "fingerprint": format!("{:016x}", curve.fingerprint),
                "implementationVersion": curve.implementation_version,
            }),
            Self::ClippingOverlay { enabled } => serde_json::json!({ "enabled": enabled }),
            Self::RenderTransport { output_fingerprint } => serde_json::json!({
                "outputFingerprint": format!("{output_fingerprint:016x}"),
            }),
        }
    }

    fn fingerprint(&self) -> u64 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"rapidraw.compiled-edit-node-payload.v1");
        hasher.update(self.kind_id().as_bytes());
        match self {
            Self::LegacyShaderAbi(adjustments) => {
                hasher.update(bytes_of(adjustments.as_ref()));
            }
            _ => {
                let diagnostic = serde_json::to_vec(&self.diagnostic())
                    .expect("compiled edit-node diagnostics are serializable");
                hasher.update(&diagnostic);
            }
        }
        u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SceneGlobalPayload {
    pub exposure: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub vibrance: f32,
    pub hue: f32,
    pub sharpness: f32,
    pub sharpness_threshold: f32,
    pub luma_noise_reduction: f32,
    pub color_noise_reduction: f32,
    pub clarity: f32,
    pub dehaze: f32,
    pub structure: f32,
    pub centre: f32,
    pub chromatic_aberration: [f32; 2],
    pub glow: f32,
    pub halation: f32,
    pub flare: f32,
    pub vignette: [f32; 4],
    pub color_calibration: ColorCalibrationSettings,
    pub color_balance_rgb: ColorBalanceRgbSettings,
    pub channel_mixer: ChannelMixerSettings,
    pub black_white_mixer: BlackWhiteMixerSettings,
    pub levels: LevelsSettings,
    pub hsl: [HslColor; 8],
    pub grading: [ColorGradeSettings; 4],
    pub grading_blending: f32,
    pub grading_balance: f32,
    pub tone_equalizer: ToneEqualizerGpuSettings,
}

#[derive(Clone, Copy, Debug)]
pub struct LocalSceneLayerPayload {
    pub exposure: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub vibrance: f32,
    pub sharpness: f32,
    pub sharpness_threshold: f32,
    pub luma_noise_reduction: f32,
    pub color_noise_reduction: f32,
    pub clarity: f32,
    pub dehaze: f32,
    pub structure: f32,
    pub glow: f32,
    pub halation: f32,
    pub flare: f32,
    pub hue: f32,
    pub blend_mode: f32,
    pub hsl: [HslColor; 8],
    pub grading: [ColorGradeSettings; 4],
    pub grading_blending: f32,
    pub grading_balance: f32,
    pub tone_equalizer: ToneEqualizerGpuSettings,
}

impl LocalSceneLayerPayload {
    fn from_abi(layer: MaskAdjustments) -> Self {
        Self {
            exposure: layer.exposure,
            brightness: layer.brightness,
            contrast: layer.contrast,
            highlights: layer.highlights,
            shadows: layer.shadows,
            whites: layer.whites,
            blacks: layer.blacks,
            saturation: layer.saturation,
            temperature: layer.temperature,
            tint: layer.tint,
            vibrance: layer.vibrance,
            sharpness: layer.sharpness,
            sharpness_threshold: layer.sharpness_threshold,
            luma_noise_reduction: layer.luma_noise_reduction,
            color_noise_reduction: layer.color_noise_reduction,
            clarity: layer.clarity,
            dehaze: layer.dehaze,
            structure: layer.structure,
            glow: layer.glow_amount,
            halation: layer.halation_amount,
            flare: layer.flare_amount,
            hue: layer.hue,
            blend_mode: layer.blend_mode,
            hsl: layer.hsl,
            grading: [
                layer.color_grading_shadows,
                layer.color_grading_midtones,
                layer.color_grading_highlights,
                layer.color_grading_global,
            ],
            grading_blending: layer.color_grading_blending,
            grading_balance: layer.color_grading_balance,
            tone_equalizer: layer.tone_equalizer,
        }
    }

    fn diagnostic(&self) -> serde_json::Value {
        serde_json::json!({
            "exposure": self.exposure, "brightness": self.brightness,
            "contrast": self.contrast, "highlights": self.highlights,
            "shadows": self.shadows, "whites": self.whites, "blacks": self.blacks,
            "saturation": self.saturation, "temperature": self.temperature,
            "tint": self.tint, "vibrance": self.vibrance, "hue": self.hue,
            "sharpness": self.sharpness, "sharpnessThreshold": self.sharpness_threshold,
            "lumaNoiseReduction": self.luma_noise_reduction,
            "colorNoiseReduction": self.color_noise_reduction,
            "clarity": self.clarity, "dehaze": self.dehaze,
            "structure": self.structure, "glow": self.glow,
            "halation": self.halation, "flare": self.flare,
            "blendMode": self.blend_mode, "hsl": self.hsl,
            "grading": self.grading, "gradingBlending": self.grading_blending,
            "gradingBalance": self.grading_balance,
            "toneEqualizer": self.tone_equalizer,
        })
    }
}

#[derive(Clone, Debug)]
pub struct LocalScenePayload {
    pub layers: Arc<[LocalSceneLayerPayload]>,
}

#[derive(Clone, Copy, Debug)]
pub struct ViewTransformPayload {
    pub tonemapper_mode: u32,
    pub is_raw: bool,
    pub pipe_to_rendering: GpuMat3,
    pub rendering_to_pipe: GpuMat3,
    pub rapid_view_parameters: [[f32; 4]; 3],
}

#[derive(Clone, Copy, Debug)]
pub struct LocalDisplayLayerPayload {
    pub curves: [[Point; 16]; 4],
    pub curve_counts: [u32; 4],
    pub blend_mode: f32,
}

impl LocalDisplayLayerPayload {
    fn from_abi(layer: MaskAdjustments) -> Self {
        Self {
            curves: [
                layer.luma_curve,
                layer.red_curve,
                layer.green_curve,
                layer.blue_curve,
            ],
            curve_counts: [
                layer.luma_curve_count,
                layer.red_curve_count,
                layer.green_curve_count,
                layer.blue_curve_count,
            ],
            blend_mode: layer.blend_mode,
        }
    }

    fn diagnostic(&self) -> serde_json::Value {
        serde_json::json!({
            "curves": self.curves,
            "curveCounts": self.curve_counts,
            "blendMode": self.blend_mode,
        })
    }
}

#[derive(Clone, Debug)]
pub struct DisplayCreativePayload {
    pub curves: [[Point; 16]; 4],
    pub curve_counts: [u32; 4],
    pub lut_enabled: bool,
    pub lut_intensity: f32,
    pub grain: [f32; 3],
    pub local_layers: Arc<[LocalDisplayLayerPayload]>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EditGraphReceipt {
    pub schema_version: u32,
    pub pipeline_version: u32,
    pub migration: EditGraphMigration,
    pub ordered_node_ids: Arc<[&'static str]>,
    pub omitted_no_op_node_ids: Arc<[&'static str]>,
    pub fused_gpu_groups: Arc<[Arc<[&'static str]>]>,
    pub input_domain: ColorDomain,
    pub output_domain: ColorDomain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EditGraphMigration {
    LegacyV1Defaulted,
    LegacyV1Explicit,
    SceneReferredV2Explicit,
}

#[derive(Clone, Debug)]
pub struct CompiledEditGraph {
    pub schema_version: u32,
    pub pipeline_version: u32,
    pub nodes: Arc<[CompiledEditNode]>,
    pub fingerprint: u64,
    pub execution_abi_fingerprint: u64,
    pub has_user_edits: bool,
    pub receipt: EditGraphReceipt,
    compiled_shader_abi: AllAdjustments,
}

#[derive(Clone, Copy)]
pub struct EditGraphCompileInputs<'a> {
    pub pipeline_version: u32,
    pub version_was_explicit: bool,
    pub source_fingerprint: u64,
    pub geometry_fingerprint: u64,
    pub retouch_fingerprint: u64,
    pub detail_fingerprint: u64,
    pub color_fingerprint: u64,
    pub output_fingerprint: u64,
    pub adjustments: &'a AllAdjustments,
    pub neutral_adjustments: &'a AllAdjustments,
    pub scene_curve: Option<&'a CompiledCurvePlanV1>,
    pub film_emulation: Option<FilmEmulationParams>,
    pub output_curve: Option<&'a CompiledOutputCurvePlanV1>,
    pub has_geometry_or_retouch: bool,
    pub has_detail: bool,
    pub has_masks: bool,
    pub has_lut: bool,
    pub show_clipping: bool,
}

impl CompiledEditGraph {
    pub fn compile(inputs: EditGraphCompileInputs<'_>) -> Self {
        let mut nodes = Vec::with_capacity(7);
        let mut omitted = Vec::new();
        nodes.push(node(
            EditNodeKind::CameraInputBoundary,
            ColorDomain::AcesCgSceneLinearExtended,
            ColorDomain::AcesCgSceneLinearExtended,
            EditStageClass::InputTransform,
            ValueRangePolicy::PreserveFiniteExtended,
            SpatialSupport::Pointwise,
            LocalAdjustmentPolicy::GlobalOnly,
            NodeDependencies {
                source: true,
                ..NodeDependencies::default()
            },
            Some("camera_input_transform_v1"),
            None,
            inputs.source_fingerprint,
        ));
        if inputs.has_geometry_or_retouch {
            nodes.push(node(
                EditNodeKind::GeometryRetouch,
                ColorDomain::AcesCgSceneLinearExtended,
                ColorDomain::AcesCgSceneLinearExtended,
                EditStageClass::SceneTechnical,
                ValueRangePolicy::PreserveFiniteExtended,
                SpatialSupport::BoundedHalo { pixels: 32 },
                LocalAdjustmentPolicy::GlobalOnly,
                NodeDependencies {
                    source: true,
                    geometry: true,
                    adjustments: true,
                    ..NodeDependencies::default()
                },
                Some("geometry_retouch_cpu_v2"),
                None,
                combine(&[inputs.geometry_fingerprint, inputs.retouch_fingerprint]),
            ));
        } else {
            omitted.push(EditNodeKind::GeometryRetouch.stable_id());
        }
        if inputs.has_detail {
            nodes.push(node(
                EditNodeKind::PreGpuSpatialDetail,
                ColorDomain::AcesCgSceneLinearExtended,
                ColorDomain::AcesCgSceneLinearExtended,
                EditStageClass::SpatialDetail,
                ValueRangePolicy::PreserveFiniteExtended,
                SpatialSupport::BoundedHalo { pixels: 64 },
                LocalAdjustmentPolicy::GlobalOnly,
                NodeDependencies {
                    adjustments: true,
                    source: true,
                    ..NodeDependencies::default()
                },
                Some("pre_gpu_detail_cpu_v1"),
                None,
                inputs.detail_fingerprint,
            ));
        } else {
            omitted.push(EditNodeKind::PreGpuSpatialDetail.stable_id());
        }
        let gpu_adjustments_active = bytes_of(inputs.adjustments)
            != bytes_of(inputs.neutral_adjustments)
            || inputs.has_masks
            || inputs.has_lut;
        if inputs.pipeline_version == LEGACY_PIPELINE_VERSION {
            nodes.push(node(
                EditNodeKind::LegacyGpuSceneViewPass,
                ColorDomain::AcesCgSceneLinearExtended,
                ColorDomain::ViewEncoded,
                EditStageClass::LegacyFusedSceneView,
                ValueRangePolicy::LegacyImplementationDefined,
                SpatialSupport::BoundedHalo { pixels: 64 },
                LocalAdjustmentPolicy::GlobalAndLocalSameDomain,
                NodeDependencies {
                    source: true,
                    masks: inputs.has_masks,
                    view: true,
                    adjustments: true,
                    ..NodeDependencies::default()
                },
                Some("native_color_mixer_post_wgpu_v1"),
                Some("shader_wgsl_legacy_scene_view_v1"),
                combine(&[
                    inputs.color_fingerprint,
                    inputs.output_fingerprint,
                    u64::from(gpu_adjustments_active),
                ]),
            ));
        } else {
            if gpu_adjustments_active {
                nodes.push(node(
                    EditNodeKind::SceneGlobalColorTone,
                    ColorDomain::AcesCgSceneLinearExtended,
                    ColorDomain::AcesCgSceneLinearExtended,
                    EditStageClass::SceneCreative,
                    ValueRangePolicy::PreserveFiniteExtended,
                    SpatialSupport::BoundedHalo { pixels: 64 },
                    LocalAdjustmentPolicy::GlobalOnly,
                    NodeDependencies {
                        source: true,
                        adjustments: true,
                        ..NodeDependencies::default()
                    },
                    Some("edit_graph_cpu_reference_v2"),
                    Some("shader_wgsl_scene_phase_v2"),
                    inputs.color_fingerprint,
                ));
            } else {
                omitted.push(EditNodeKind::SceneGlobalColorTone.stable_id());
            }
            if inputs.has_masks {
                nodes.push(node(
                    EditNodeKind::LocalSceneComposition,
                    ColorDomain::AcesCgSceneLinearExtended,
                    ColorDomain::AcesCgSceneLinearExtended,
                    EditStageClass::LocalComposition,
                    ValueRangePolicy::PreserveFiniteExtended,
                    SpatialSupport::BoundedHalo { pixels: 64 },
                    LocalAdjustmentPolicy::GlobalAndLocalSameDomain,
                    NodeDependencies {
                        source: true,
                        adjustments: true,
                        masks: true,
                        ..NodeDependencies::default()
                    },
                    Some("edit_graph_cpu_reference_v2"),
                    Some("shader_wgsl_scene_phase_v2"),
                    combine(&[inputs.color_fingerprint, u64::from(inputs.has_masks)]),
                ));
            } else {
                omitted.push(EditNodeKind::LocalSceneComposition.stable_id());
            }
            if let Some(scene_curve) = inputs.scene_curve {
                nodes.push(node(
                    EditNodeKind::SceneCurve,
                    ColorDomain::AcesCgSceneLinearExtended,
                    ColorDomain::AcesCgSceneLinearExtended,
                    EditStageClass::LocalComposition,
                    ValueRangePolicy::PreserveFiniteExtended,
                    SpatialSupport::Pointwise,
                    LocalAdjustmentPolicy::GlobalOnly,
                    NodeDependencies {
                        adjustments: true,
                        ..NodeDependencies::default()
                    },
                    Some("scene_curve_cpu_v1"),
                    Some("scene_curve_wgsl_v1"),
                    scene_curve.fingerprint,
                ));
            } else {
                omitted.push(EditNodeKind::SceneCurve.stable_id());
            }
            if let Some(film) = inputs.film_emulation.filter(|film| film.enabled) {
                nodes.push(node(
                    EditNodeKind::FilmEmulation,
                    ColorDomain::AcesCgSceneLinearExtended,
                    ColorDomain::AcesCgSceneLinearExtended,
                    EditStageClass::SceneCreative,
                    ValueRangePolicy::PreserveFiniteExtended,
                    SpatialSupport::Pointwise,
                    LocalAdjustmentPolicy::GlobalOnly,
                    NodeDependencies {
                        source: true,
                        adjustments: true,
                        ..NodeDependencies::default()
                    },
                    Some("film_emulation_cpu_v1"),
                    Some("film_emulation_wgsl_v1"),
                    film_fingerprint(film),
                ));
            } else {
                omitted.push(EditNodeKind::FilmEmulation.stable_id());
            }
            nodes.push(node(
                EditNodeKind::SceneToViewTransform,
                ColorDomain::AcesCgSceneLinearExtended,
                ColorDomain::ViewEncoded,
                EditStageClass::ViewTransform,
                ValueRangePolicy::BoundForOutputEncoding,
                SpatialSupport::Pointwise,
                LocalAdjustmentPolicy::GlobalOnly,
                NodeDependencies {
                    view: true,
                    adjustments: true,
                    ..NodeDependencies::default()
                },
                Some("edit_graph_cpu_reference_v2"),
                Some("shader_wgsl_view_display_phase_v2"),
                inputs.output_fingerprint,
            ));
            if display_creative_active(
                inputs.adjustments,
                inputs.neutral_adjustments,
                inputs.has_lut,
            ) {
                nodes.push(node(
                    EditNodeKind::DisplayCreative,
                    ColorDomain::ViewEncoded,
                    ColorDomain::ViewEncoded,
                    EditStageClass::DisplayAdjustment,
                    ValueRangePolicy::PreserveFiniteExtended,
                    SpatialSupport::Pointwise,
                    LocalAdjustmentPolicy::GlobalAndLocalSameDomain,
                    NodeDependencies {
                        adjustments: true,
                        masks: inputs.has_masks,
                        view: true,
                        ..NodeDependencies::default()
                    },
                    Some("edit_graph_cpu_reference_v2"),
                    Some("shader_wgsl_view_display_phase_v2"),
                    combine(&[inputs.color_fingerprint, u64::from(inputs.has_lut)]),
                ));
            } else {
                omitted.push(EditNodeKind::DisplayCreative.stable_id());
            }
            if let Some(output_curve) = inputs.output_curve {
                nodes.push(node(
                    EditNodeKind::OutputCurve,
                    ColorDomain::ViewEncoded,
                    ColorDomain::ViewEncoded,
                    EditStageClass::DisplayAdjustment,
                    ValueRangePolicy::PreserveFiniteExtended,
                    SpatialSupport::Pointwise,
                    LocalAdjustmentPolicy::GlobalOnly,
                    NodeDependencies {
                        adjustments: true,
                        view: true,
                        output: true,
                        ..NodeDependencies::default()
                    },
                    Some("output_curve_cpu_v1"),
                    Some("output_curve_wgsl_v1"),
                    output_curve.fingerprint,
                ));
            } else {
                omitted.push(EditNodeKind::OutputCurve.stable_id());
            }
        }
        if inputs.show_clipping {
            nodes.push(node(
                EditNodeKind::ClippingOverlay,
                ColorDomain::ViewEncoded,
                ColorDomain::ViewEncoded,
                EditStageClass::DisplayAdjustment,
                ValueRangePolicy::LegacyImplementationDefined,
                SpatialSupport::Pointwise,
                LocalAdjustmentPolicy::GlobalOnly,
                NodeDependencies {
                    view: true,
                    output: true,
                    ..NodeDependencies::default()
                },
                None,
                Some("clipping_overlay_wgsl_v1"),
                inputs.output_fingerprint,
            ));
        } else {
            omitted.push(EditNodeKind::ClippingOverlay.stable_id());
        }
        nodes.push(node(
            EditNodeKind::RenderTransport,
            ColorDomain::ViewEncoded,
            ColorDomain::RenderTransportEncoded,
            EditStageClass::OutputTransform,
            ValueRangePolicy::BoundForOutputEncoding,
            SpatialSupport::Pointwise,
            LocalAdjustmentPolicy::GlobalOnly,
            NodeDependencies {
                output: true,
                view: true,
                ..NodeDependencies::default()
            },
            None,
            Some("shader_transport_dither_v1"),
            inputs.output_fingerprint,
        ));
        debug_assert!(
            nodes
                .windows(2)
                .all(|pair| pair[0].stage_class <= pair[1].stage_class)
        );
        for node in &mut nodes {
            node.payload = compile_node_payload(node.kind, &inputs);
            node.payload_fingerprint = node.payload.fingerprint();
        }
        let fingerprint = graph_fingerprint(inputs.pipeline_version, &nodes);
        let ordered_node_ids: Arc<[_]> = nodes.iter().map(|node| node.kind.stable_id()).collect();
        let fused_gpu_groups: Arc<[Arc<[&'static str]>]> =
            if inputs.pipeline_version == SCENE_REFERRED_PIPELINE_VERSION {
                [
                    nodes
                        .iter()
                        .filter(|node| {
                            node.wgpu_implementation.is_some()
                                && node.stage_class <= EditStageClass::LocalComposition
                        })
                        .map(|node| node.kind.stable_id())
                        .collect::<Vec<_>>(),
                    nodes
                        .iter()
                        .filter(|node| {
                            node.wgpu_implementation.is_some()
                                && node.stage_class == EditStageClass::ViewTransform
                        })
                        .map(|node| node.kind.stable_id())
                        .collect::<Vec<_>>(),
                    nodes
                        .iter()
                        .filter(|node| {
                            node.wgpu_implementation.is_some()
                                && node.stage_class >= EditStageClass::DisplayAdjustment
                        })
                        .map(|node| node.kind.stable_id())
                        .collect::<Vec<_>>(),
                ]
                .into_iter()
                .filter(|group| !group.is_empty())
                .map(Arc::from)
                .collect::<Vec<_>>()
                .into()
            } else {
                vec![Arc::from(
                    nodes
                        .iter()
                        .filter(|node| node.wgpu_implementation.is_some())
                        .map(|node| node.kind.stable_id())
                        .collect::<Vec<_>>(),
                )]
                .into()
            };
        Self {
            schema_version: EDIT_GRAPH_SCHEMA_VERSION,
            pipeline_version: inputs.pipeline_version,
            nodes: nodes.into(),
            fingerprint,
            execution_abi_fingerprint: gpu_execution_fingerprint(
                inputs.adjustments,
                inputs.has_lut,
            ),
            has_user_edits: inputs.has_geometry_or_retouch
                || inputs.has_detail
                || gpu_adjustments_active
                || inputs.scene_curve.is_some()
                || inputs.film_emulation.is_some_and(|film| film.enabled)
                || inputs.output_curve.is_some()
                || inputs.show_clipping
                // Choosing the scene-referred process is itself a persisted,
                // render-authoritative edit even when every numeric control is
                // neutral. Cleanup must not discard that process choice.
                || (inputs.version_was_explicit
                    && inputs.pipeline_version == SCENE_REFERRED_PIPELINE_VERSION),
            receipt: EditGraphReceipt {
                schema_version: EDIT_GRAPH_SCHEMA_VERSION,
                pipeline_version: inputs.pipeline_version,
                migration: match (inputs.pipeline_version, inputs.version_was_explicit) {
                    (SCENE_REFERRED_PIPELINE_VERSION, true) => {
                        EditGraphMigration::SceneReferredV2Explicit
                    }
                    (LEGACY_PIPELINE_VERSION, true) => EditGraphMigration::LegacyV1Explicit,
                    (LEGACY_PIPELINE_VERSION, false) => EditGraphMigration::LegacyV1Defaulted,
                    _ => unreachable!("render-plan validation admits supported explicit versions"),
                },
                ordered_node_ids,
                omitted_no_op_node_ids: omitted.into(),
                fused_gpu_groups,
                input_domain: ColorDomain::AcesCgSceneLinearExtended,
                output_domain: ColorDomain::RenderTransportEncoded,
            },
            compiled_shader_abi: *inputs.adjustments,
        }
    }

    pub fn shader_abi(&self) -> AllAdjustments {
        let mut abi = self.compiled_shader_abi;
        if let Some(curve) = self.scene_curve() {
            for (destination, source) in abi
                .global
                .scene_curve_knots
                .iter_mut()
                .zip(curve.gpu_knots())
            {
                *destination = source;
            }
            abi.global.scene_curve_parameters = curve.gpu_parameters();
        }
        if let Some(curve) = self.output_curve() {
            for (destination, source) in abi
                .global
                .output_curve_knots
                .iter_mut()
                .zip(curve.gpu_knots())
            {
                *destination = source;
            }
            abi.global.output_curve_parameters = curve.gpu_parameters();
        }
        abi
    }

    pub fn scene_curve(&self) -> Option<&CompiledCurvePlanV1> {
        self.nodes.iter().find_map(|node| match &node.payload {
            CompiledNodePayload::SceneCurve(curve) => Some(curve),
            _ => None,
        })
    }

    pub fn film_emulation(&self) -> Option<FilmEmulationParams> {
        self.nodes.iter().find_map(|node| match &node.payload {
            CompiledNodePayload::FilmEmulation(params) => Some(*params),
            _ => None,
        })
    }

    pub fn output_curve(&self) -> Option<&CompiledOutputCurvePlanV1> {
        self.nodes.iter().find_map(|node| match &node.payload {
            CompiledNodePayload::OutputCurve(curve) => Some(curve),
            _ => None,
        })
    }

    #[cfg(test)]
    pub fn has_typed_curves(&self) -> bool {
        self.scene_curve().is_some() || self.output_curve().is_some()
    }

    pub fn validate_gpu_execution(
        &self,
        adjustments: &AllAdjustments,
        has_lut: bool,
        mask_count: usize,
    ) -> Result<(), &'static str> {
        self.validate_contract()?;
        let has_legacy_fused = self
            .nodes
            .iter()
            .any(|node| node.kind == EditNodeKind::LegacyGpuSceneViewPass);
        let has_local = self
            .nodes
            .iter()
            .any(|node| node.kind == EditNodeKind::LocalSceneComposition);
        let has_display_creative = self
            .nodes
            .iter()
            .any(|node| node.kind == EditNodeKind::DisplayCreative);
        if mask_count > 0 && !has_legacy_fused && !has_local {
            return Err("edit_graph.missing_legacy_gpu_scene_view_pass");
        }
        if has_lut && !has_legacy_fused && !has_display_creative {
            return Err("edit_graph.missing_display_creative");
        }
        if self.execution_abi_fingerprint != gpu_execution_fingerprint(adjustments, has_lut) {
            return Err("edit_graph.stale_gpu_execution_abi");
        }
        if self.nodes.first().map(|node| node.input_domain)
            != Some(ColorDomain::AcesCgSceneLinearExtended)
        {
            return Err("edit_graph.invalid_input_domain");
        }
        if self.nodes.last().map(|node| node.output_domain)
            != Some(ColorDomain::RenderTransportEncoded)
        {
            return Err("edit_graph.invalid_output_domain");
        }
        Ok(())
    }

    pub fn validate_contract(&self) -> Result<(), &'static str> {
        validate_runtime_registry(EDIT_NODE_RUNTIME_REGISTRY)?;
        debug_assert_eq!(EDIT_NODE_RUNTIME_REGISTRY.len(), ALL_EDIT_NODE_KINDS.len());
        debug_assert!(
            ALL_EDIT_NODE_KINDS
                .iter()
                .all(|kind| runtime_descriptor(*kind).kind == *kind)
        );
        if self.schema_version == 0
            || self
                .nodes
                .iter()
                .any(|node| node.schema_version == 0 || node.implementation_version == 0)
        {
            return Err("edit_graph.invalid_node_version");
        }
        if self.nodes.is_empty() {
            return Err("edit_graph.empty");
        }
        if self
            .nodes
            .iter()
            .any(|node| node.cpu_implementation.is_none() && node.wgpu_implementation.is_none())
        {
            return Err("edit_graph.missing_node_implementation");
        }
        if self
            .nodes
            .iter()
            .any(|node| !node.payload.belongs_to(node.kind))
        {
            return Err("edit_graph.node_payload_kind_mismatch");
        }
        if self.nodes.iter().any(|node| {
            let descriptor = runtime_descriptor(node.kind);
            node.schema_version != descriptor.schema_version
                || node.implementation_version != descriptor.implementation_version
                || node.cpu_implementation != descriptor.cpu_implementation
                || node.wgpu_implementation != descriptor.wgpu_implementation
        }) {
            return Err("edit_graph.runtime_ownership_mismatch");
        }
        if self
            .nodes
            .windows(2)
            .any(|pair| pair[0].stage_class > pair[1].stage_class)
        {
            return Err("edit_graph.invalid_stage_order");
        }
        if self
            .nodes
            .windows(2)
            .any(|pair| pair[0].output_domain != pair[1].input_domain)
        {
            return Err("edit_graph.invalid_domain_transition");
        }
        Ok(())
    }

    pub fn diagnostic_receipt(&self) -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": self.schema_version,
            "pipelineVersion": self.pipeline_version,
            "migration": format!("{:?}", self.receipt.migration),
            "fingerprint": format!("{:016x}", self.fingerprint),
            "executionAbiFingerprint": format!("{:016x}", self.execution_abi_fingerprint),
            "inputDomain": self.receipt.input_domain.contract_id(),
            "outputDomain": self.receipt.output_domain.contract_id(),
            "nodes": self.nodes.iter().map(|node| serde_json::json!({
                "id": node.kind.stable_id(),
                "schemaVersion": node.schema_version,
                "implementationVersion": node.implementation_version,
                "inputDomain": node.input_domain.contract_id(),
                "outputDomain": node.output_domain.contract_id(),
                "stageClass": format!("{:?}", node.stage_class),
                "rangePolicy": format!("{:?}", node.range_policy),
                "alphaPolicy": format!("{:?}", node.alpha_policy),
                "precision": format!("{:?}", node.precision),
                "spatialSupport": format!("{:?}", node.spatial_support),
                "localAdjustmentPolicy": format!("{:?}", node.local_adjustment_policy),
                "dependencies": {
                    "source": node.dependencies.source,
                    "adjustments": node.dependencies.adjustments,
                    "geometry": node.dependencies.geometry,
                    "masks": node.dependencies.masks,
                    "view": node.dependencies.view,
                    "output": node.dependencies.output,
                },
                "cpuImplementation": node.cpu_implementation,
                "wgpuImplementation": node.wgpu_implementation,
                "runtime": {
                    "fusedPhase": runtime_descriptor(node.kind).fused_phase,
                    "resourceRequirements": runtime_descriptor(node.kind).resource_requirements,
                    "supportsLocal": runtime_descriptor(node.kind).supports_local,
                    "legacyCompatibility": runtime_descriptor(node.kind).legacy_compatibility,
                },
                "payloadType": node.payload.kind_id(),
                "payload": node.payload.diagnostic(),
                "payloadFingerprint": format!("{:016x}", node.payload_fingerprint),
            })).collect::<Vec<_>>(),
            "omittedNoOpNodes": self.receipt.omitted_no_op_node_ids.as_ref(),
            "fusedGpuGroups": self.receipt.fused_gpu_groups.iter()
                .map(|group| group.as_ref()).collect::<Vec<_>>(),
            "wgpuRuntime": crate::render::wgpu_nodes::WgpuNodeRuntime::from_graph(self)
                .ok()
                .map(|runtime| runtime.diagnostic_receipt()),
            "cpuRuntime": crate::render::cpu_nodes::CpuNodeRuntime::from_graph(self)
                .ok()
                .map(|runtime| runtime.diagnostic_receipt()),
        })
    }
}

fn display_creative_active(
    adjustments: &AllAdjustments,
    neutral: &AllAdjustments,
    has_lut: bool,
) -> bool {
    let global = &adjustments.global;
    let neutral = &neutral.global;
    has_lut
        || global.grain_amount != neutral.grain_amount
        || global.grain_size != neutral.grain_size
        || global.grain_roughness != neutral.grain_roughness
        || global.luma_curve_count != neutral.luma_curve_count
        || global.red_curve_count != neutral.red_curve_count
        || global.green_curve_count != neutral.green_curve_count
        || global.blue_curve_count != neutral.blue_curve_count
        || bytes_of(&global.luma_curve) != bytes_of(&neutral.luma_curve)
        || bytes_of(&global.red_curve) != bytes_of(&neutral.red_curve)
        || bytes_of(&global.green_curve) != bytes_of(&neutral.green_curve)
        || bytes_of(&global.blue_curve) != bytes_of(&neutral.blue_curve)
        || adjustments.mask_adjustments[..adjustments.mask_count as usize]
            .iter()
            .any(|layer| {
                layer.luma_curve_count > 0
                    || layer.red_curve_count > 0
                    || layer.green_curve_count > 0
                    || layer.blue_curve_count > 0
            })
}

fn compile_node_payload(
    kind: EditNodeKind,
    inputs: &EditGraphCompileInputs<'_>,
) -> CompiledNodePayload {
    let global = inputs.adjustments.global;
    match kind {
        EditNodeKind::CameraInputBoundary => CompiledNodePayload::InputBoundary {
            source_fingerprint: inputs.source_fingerprint,
        },
        EditNodeKind::GeometryRetouch => CompiledNodePayload::GeometryRetouch {
            geometry: inputs.geometry_fingerprint,
            retouch: inputs.retouch_fingerprint,
        },
        EditNodeKind::PreGpuSpatialDetail => CompiledNodePayload::PreGpuSpatialDetail {
            detail_fingerprint: inputs.detail_fingerprint,
        },
        EditNodeKind::LegacyGpuSceneViewPass => {
            CompiledNodePayload::LegacyShaderAbi(Box::new(*inputs.adjustments))
        }
        EditNodeKind::SceneGlobalColorTone => {
            CompiledNodePayload::SceneGlobal(Box::new(SceneGlobalPayload {
                exposure: global.exposure,
                brightness: global.brightness,
                contrast: global.contrast,
                highlights: global.highlights,
                shadows: global.shadows,
                whites: global.whites,
                blacks: global.blacks,
                saturation: global.saturation,
                temperature: global.temperature,
                tint: global.tint,
                vibrance: global.vibrance,
                hue: global.hue,
                sharpness: global.sharpness,
                sharpness_threshold: global.sharpness_threshold,
                luma_noise_reduction: global.luma_noise_reduction,
                color_noise_reduction: global.color_noise_reduction,
                clarity: global.clarity,
                dehaze: global.dehaze,
                structure: global.structure,
                centre: global.centré,
                chromatic_aberration: [
                    global.chromatic_aberration_red_cyan,
                    global.chromatic_aberration_blue_yellow,
                ],
                glow: global.glow_amount,
                halation: global.halation_amount,
                flare: global.flare_amount,
                vignette: [
                    global.vignette_amount,
                    global.vignette_midpoint,
                    global.vignette_roundness,
                    global.vignette_feather,
                ],
                color_calibration: global.color_calibration,
                color_balance_rgb: global.color_balance_rgb,
                channel_mixer: global.channel_mixer,
                black_white_mixer: global.black_white_mixer,
                levels: global.levels,
                hsl: global.hsl,
                grading: [
                    global.color_grading_shadows,
                    global.color_grading_midtones,
                    global.color_grading_highlights,
                    global.color_grading_global,
                ],
                grading_blending: global.color_grading_blending,
                grading_balance: global.color_grading_balance,
                tone_equalizer: global.tone_equalizer,
            }))
        }
        EditNodeKind::SceneCurve => CompiledNodePayload::SceneCurve(
            inputs
                .scene_curve
                .expect("scene curve node requires compiled payload")
                .clone(),
        ),
        EditNodeKind::FilmEmulation => CompiledNodePayload::FilmEmulation(
            inputs
                .film_emulation
                .expect("film node requires compiled payload"),
        ),
        EditNodeKind::LocalSceneComposition => CompiledNodePayload::LocalScene(LocalScenePayload {
            layers: inputs.adjustments.mask_adjustments[..inputs.adjustments.mask_count as usize]
                .iter()
                .copied()
                .map(LocalSceneLayerPayload::from_abi)
                .collect::<Vec<_>>()
                .into(),
        }),
        EditNodeKind::SceneToViewTransform => {
            CompiledNodePayload::ViewTransform(ViewTransformPayload {
                tonemapper_mode: global.tonemapper_mode,
                is_raw: global.is_raw_image != 0,
                pipe_to_rendering: global.agx_pipe_to_rendering_matrix,
                rendering_to_pipe: global.agx_rendering_to_pipe_matrix,
                rapid_view_parameters: [
                    global.rapid_view_parameters0,
                    global.rapid_view_parameters1,
                    global.rapid_view_parameters2,
                ],
            })
        }
        EditNodeKind::DisplayCreative => {
            CompiledNodePayload::DisplayCreative(Box::new(DisplayCreativePayload {
                curves: [
                    global.luma_curve,
                    global.red_curve,
                    global.green_curve,
                    global.blue_curve,
                ],
                curve_counts: [
                    global.luma_curve_count,
                    global.red_curve_count,
                    global.green_curve_count,
                    global.blue_curve_count,
                ],
                lut_enabled: inputs.has_lut,
                lut_intensity: global.lut_intensity,
                grain: [
                    global.grain_amount,
                    global.grain_size,
                    global.grain_roughness,
                ],
                local_layers: inputs.adjustments.mask_adjustments
                    [..inputs.adjustments.mask_count as usize]
                    .iter()
                    .copied()
                    .map(LocalDisplayLayerPayload::from_abi)
                    .collect::<Vec<_>>()
                    .into(),
            }))
        }
        EditNodeKind::OutputCurve => CompiledNodePayload::OutputCurve(
            inputs
                .output_curve
                .expect("output curve node requires compiled payload")
                .clone(),
        ),
        EditNodeKind::ClippingOverlay => CompiledNodePayload::ClippingOverlay {
            enabled: inputs.show_clipping,
        },
        EditNodeKind::RenderTransport => CompiledNodePayload::RenderTransport {
            output_fingerprint: inputs.output_fingerprint,
        },
    }
}

pub fn gpu_execution_fingerprint(adjustments: &AllAdjustments, has_lut: bool) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"rapidraw.edit-graph.gpu-execution-abi.v1");
    hasher.update(bytes_of(adjustments));
    hasher.update(&[u8::from(has_lut)]);
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

#[allow(clippy::too_many_arguments)]
fn node(
    kind: EditNodeKind,
    _input_domain: ColorDomain,
    _output_domain: ColorDomain,
    _stage_class: EditStageClass,
    _range_policy: ValueRangePolicy,
    _spatial_support: SpatialSupport,
    _local_adjustment_policy: LocalAdjustmentPolicy,
    dependencies: NodeDependencies,
    _cpu_implementation: Option<&'static str>,
    _wgpu_implementation: Option<&'static str>,
    payload_fingerprint: u64,
) -> CompiledEditNode {
    let descriptor = runtime_descriptor(kind);
    CompiledEditNode {
        kind,
        schema_version: descriptor.schema_version,
        implementation_version: descriptor.implementation_version,
        input_domain: _input_domain,
        output_domain: _output_domain,
        stage_class: _stage_class,
        range_policy: _range_policy,
        alpha_policy: AlphaPolicy::PreserveStraight,
        precision: PrecisionPolicy::Float16OrBetter,
        dependencies,
        spatial_support: _spatial_support,
        local_adjustment_policy: _local_adjustment_policy,
        cpu_implementation: descriptor.cpu_implementation,
        wgpu_implementation: descriptor.wgpu_implementation,
        payload_fingerprint,
        payload: CompiledNodePayload::InputBoundary {
            source_fingerprint: 0,
        },
    }
}

fn combine(values: &[u64]) -> u64 {
    let mut hasher = blake3::Hasher::new();
    for value in values {
        hasher.update(&value.to_le_bytes());
    }
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

fn film_fingerprint(params: FilmEmulationParams) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"rapidraw.film-emulation-node.v1");
    hasher.update(&[u8::from(params.enabled)]);
    hasher.update(&params.mix.to_le_bytes());
    hasher.update(&params.shaper_p.to_le_bytes());
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

fn graph_fingerprint(pipeline_version: u32, nodes: &[CompiledEditNode]) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"rapidraw.compiled-edit-graph.v1");
    hasher.update(&EDIT_GRAPH_SCHEMA_VERSION.to_le_bytes());
    hasher.update(&pipeline_version.to_le_bytes());
    for node in nodes {
        hasher.update(node.kind.stable_id().as_bytes());
        hasher.update(&node.schema_version.to_le_bytes());
        hasher.update(&node.implementation_version.to_le_bytes());
        hasher.update(node.payload.kind_id().as_bytes());
        hasher.update(&node.payload_fingerprint.to_le_bytes());
        hasher.update(node.input_domain.contract_id().as_bytes());
        hasher.update(node.output_domain.contract_id().as_bytes());
        hasher.update(format!("{:?}", node.stage_class).as_bytes());
    }
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

#[cfg(test)]
mod runtime_registry_tests {
    use super::*;

    #[test]
    fn every_edit_node_kind_has_one_stable_runtime_descriptor_and_backend_owner() {
        validate_runtime_registry(EDIT_NODE_RUNTIME_REGISTRY).expect("runtime registry is valid");
        assert_eq!(EDIT_NODE_RUNTIME_REGISTRY.len(), ALL_EDIT_NODE_KINDS.len());
        let mut stable_ids = std::collections::HashSet::new();
        for kind in ALL_EDIT_NODE_KINDS {
            let descriptor = runtime_descriptor(*kind);
            assert_eq!(descriptor.kind, *kind);
            assert!(descriptor.schema_version > 0);
            assert!(descriptor.implementation_version > 0);
            assert!(
                descriptor.cpu_implementation.is_some() || descriptor.wgpu_implementation.is_some(),
                "{} must declare at least one backend owner",
                kind.stable_id()
            );
            assert!(
                stable_ids.insert(kind.stable_id()),
                "duplicate node id {}",
                kind.stable_id()
            );
        }
        assert_eq!(stable_ids.len(), ALL_EDIT_NODE_KINDS.len());
    }

    #[test]
    fn registry_validation_allows_a_test_node_without_backend_ordering_changes() {
        static TEST_NODE: EditNodeRuntimeDescriptor = EditNodeRuntimeDescriptor {
            kind: EditNodeKind::RenderTransport,
            schema_version: 99,
            implementation_version: 1,
            cpu_implementation: Some("test_only_cpu_node_v1"),
            wgpu_implementation: None,
            wgpu_bind_group_layout: None,
            fused_phase: None,
            resource_requirements: &[],
            supports_local: false,
            legacy_compatibility: false,
        };
        let test_registry = [&TEST_NODE];
        validate_runtime_registry(&test_registry)
            .expect("test node can be registered in isolation");
    }

    #[test]
    fn registry_rejects_wgpu_layout_ownership_and_resource_drift() {
        let mut missing_layout = *runtime_descriptor(EditNodeKind::SceneCurve);
        missing_layout.wgpu_bind_group_layout = None;
        assert_eq!(
            validate_runtime_registry(&[&missing_layout]),
            Err("edit_graph.wgpu_bind_group_layout_ownership_mismatch")
        );

        let mut wrong_resources = *runtime_descriptor(EditNodeKind::SceneCurve);
        wrong_resources.resource_requirements = &["scene_guidance_v1"];
        assert_eq!(
            validate_runtime_registry(&[&wrong_resources]),
            Err("edit_graph.wgpu_bind_group_layout_resource_mismatch")
        );
    }

    #[test]
    fn compiled_graph_uses_registry_ownership_and_fused_resource_receipts() {
        let adjustments = AllAdjustments::default();
        let graph = CompiledEditGraph::compile(EditGraphCompileInputs {
            pipeline_version: SCENE_REFERRED_PIPELINE_VERSION,
            version_was_explicit: true,
            source_fingerprint: 1,
            geometry_fingerprint: 2,
            retouch_fingerprint: 3,
            detail_fingerprint: 4,
            color_fingerprint: 5,
            output_fingerprint: 6,
            adjustments: &adjustments,
            neutral_adjustments: &adjustments,
            scene_curve: None,
            film_emulation: None,
            output_curve: None,
            has_geometry_or_retouch: false,
            has_detail: false,
            has_masks: false,
            has_lut: false,
            show_clipping: false,
        });
        graph
            .validate_contract()
            .expect("registry-backed graph is valid");
        let receipt = graph.diagnostic_receipt();
        let scene = receipt["nodes"]
            .as_array()
            .expect("node diagnostics are an array")
            .iter()
            .find(|node| node["id"] == EditNodeKind::SceneToViewTransform.stable_id())
            .expect("view node is present");
        assert_eq!(scene["runtime"]["fusedPhase"], "view");
        assert!(scene["runtime"]["resourceRequirements"].is_array());
        let cpu_bindings = receipt["cpuRuntime"]["bindings"]
            .as_array()
            .expect("CPU runtime ownership is diagnostic");
        assert!(cpu_bindings.iter().any(|binding| {
            binding["id"] == EditNodeKind::SceneToViewTransform.stable_id()
                && binding["typedExecutor"] == false
        }));
    }
}
