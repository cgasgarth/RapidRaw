//! Typed compilation boundary between JSON sidecars/IPC and the native renderer.
//!
//! Field ownership is intentionally explicit. Source owns RAW development inputs;
//! geometry owns orientation, crop, flip, warp, and lens correction; masks owns
//! mask shape/raster inputs; retouch owns AI patches; detail owns pre-GPU detail;
//! color owns global/local shader controls, Film, and LUT; output owns clipping,
//! proof, analytics, and view policy. Request-only ROI, dimensions, backend, and
//! quality never participate in plan compilation.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use bytemuck::bytes_of;
use serde::Deserialize;
use serde_json::Value;

use crate::adjustments::abi::AllAdjustments;
use crate::adjustments::parse::get_all_adjustments_from_json_with_masks;
use crate::edit_graph::{CompiledEditGraph, EditGraphCompileInputs};
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::geometry::{Crop, GeometryParams, get_geometry_params_from_json};
use crate::lut_processing::Lut;
use crate::mask_generation::MaskDefinition;
use crate::tone::curves::{CompiledCurvePlanV1, CurveChannelMode, CurvePoint, compile_scene_curve};
use crate::tone::output_curves::{
    CompiledOutputCurvePlanV1, OutputCurvePoint, OutputCurveTargetV1, compile_output_curve,
};

const PLAN_SCHEMA_VERSION: u32 = 1;
const FINGERPRINT_VERSION: u32 = 1;
const MAX_CACHED_PLANS: usize = 24;
const DETAIL_FINGERPRINT_FIELDS: &[&str] = &[
    "deblurEnabled",
    "deblurStrength",
    "deblurSigmaPx",
    "waveletDetailEnabled",
    "waveletDetailCoarse",
    "waveletDetailFine",
    "waveletDetailMedium",
    "waveletDetailEdgeThreshold",
    "waveletDetailHaloSuppression",
    "sharpness",
    "sharpnessThreshold",
    "lumaNoiseReduction",
    "colorNoiseReduction",
    "denoiseContrastProtection",
    "denoiseDetail",
    "denoiseNaturalGrain",
    "denoiseShadowBias",
    "clarity",
    "dehaze",
    "structure",
    "centré",
    "chromaticAberrationRedCyan",
    "chromaticAberrationBlueYellow",
];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct RenderPlanRevision {
    pub image_session: u64,
    pub source_revision: u64,
    pub adjustment_revision: u64,
    pub schema_version: u32,
    pub settings_revision: u64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct StageFingerprints {
    pub source: u64,
    pub geometry: u64,
    pub pre_gpu_base: u64,
    pub masks: u64,
    pub retouch: u64,
    pub detail: u64,
    pub color: u64,
    pub output: u64,
    pub full: u64,
}

pub struct CompiledRenderPlan {
    pub revision: RenderPlanRevision,
    pub adjustments: AllAdjustments,
    pub geometry: GeometryParams,
    pub crop: Option<Crop>,
    pub masks: Arc<[MaskDefinition]>,
    pub lut: Option<Arc<Lut>>,
    pub edit_graph: Arc<CompiledEditGraph>,
    pub fingerprints: StageFingerprints,
    /// Compatibility input for transformation and patch executors not yet typed.
    pub effective_json: Arc<Value>,
    pub compile_time: Duration,
}

#[derive(Clone, Copy)]
pub struct CompileRenderPlanContext {
    pub revision: RenderPlanRevision,
    pub is_raw: bool,
    pub tonemapper_override: Option<u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RenderPlanError {
    pub code: &'static str,
    pub field: &'static str,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurveInputV1 {
    middle_grey: f32,
    channel_mode: SceneCurveChannelInput,
    points: Vec<SceneCurvePointInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum SceneCurveChannelInput {
    LuminancePreserving,
    LinkedRgb,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneCurvePointInput {
    x_ev: f32,
    y_ev: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutputCurveInputV1 {
    domain: OutputCurveDomainInput,
    target_identity: String,
    sdr_reference_white_nits: f32,
    peak_nits: f32,
    points: Vec<OutputCurvePointInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum OutputCurveDomainInput {
    ViewEncoded,
    OutputEncoded,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutputCurvePointInput {
    input: f32,
    output: f32,
}

impl std::fmt::Display for RenderPlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}: {}", self.code, self.field, self.message)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderStage {
    Source,
    Geometry,
    Masks,
    Retouch,
    Detail,
    Color,
    Output,
}

pub const FIELD_OWNERSHIP: &[(&str, RenderStage, &str)] = &[
    (
        "rawEngineArtifacts",
        RenderStage::Source,
        "camera/default RAW policy",
    ),
    ("orientationSteps", RenderStage::Geometry, "0"),
    ("rotation", RenderStage::Geometry, "0"),
    ("flipHorizontal", RenderStage::Geometry, "false"),
    ("flipVertical", RenderStage::Geometry, "false"),
    ("crop", RenderStage::Geometry, "none"),
    ("transform*", RenderStage::Geometry, "identity"),
    ("lens*", RenderStage::Geometry, "profile/identity"),
    ("masks", RenderStage::Masks, "empty"),
    ("aiPatches", RenderStage::Retouch, "empty"),
    ("details section", RenderStage::Detail, "neutral"),
    ("basic/color/effects/curves", RenderStage::Color, "neutral"),
    ("sceneCurveV1", RenderStage::Color, "identity/absent"),
    ("filmLook", RenderStage::Color, "disabled"),
    ("lutPath/lutIntensity", RenderStage::Color, "none/100"),
    ("showClipping", RenderStage::Output, "false"),
    ("toneMapper", RenderStage::Output, "basic"),
    ("viewTransform", RenderStage::Output, "Rapid View defaults"),
    ("outputCurveV1", RenderStage::Output, "identity/absent"),
];

#[derive(Default)]
struct PlanCache {
    entries: VecDeque<(RenderPlanRevision, Arc<CompiledRenderPlan>)>,
    compilation_count: u64,
    hits: u64,
    misses: u64,
    evictions: u64,
}

static PLAN_CACHE: OnceLock<Mutex<PlanCache>> = OnceLock::new();

fn cache() -> &'static Mutex<PlanCache> {
    PLAN_CACHE.get_or_init(|| Mutex::new(PlanCache::default()))
}

pub fn compile_render_plan_cached(
    raw: &Value,
    context: CompileRenderPlanContext,
    lut: Option<Arc<Lut>>,
) -> Result<Arc<CompiledRenderPlan>, RenderPlanError> {
    if let Some(plan) = {
        let mut cache = cache().lock().unwrap();
        let hit = cache
            .entries
            .iter()
            .position(|(revision, _)| *revision == context.revision);
        hit.map(|index| {
            cache.hits += 1;
            let entry = cache.entries.remove(index).unwrap();
            let plan = Arc::clone(&entry.1);
            cache.entries.push_front(entry);
            plan
        })
    } {
        return Ok(plan);
    }
    cache().lock().unwrap().misses += 1;
    let compiled = Arc::new(compile_render_plan(raw, context, lut)?);
    let mut cache = cache().lock().unwrap();
    if let Some((_, existing)) = cache
        .entries
        .iter()
        .find(|(revision, _)| *revision == context.revision)
    {
        return Ok(Arc::clone(existing));
    }
    cache.compilation_count += 1;
    cache
        .entries
        .push_front((context.revision, Arc::clone(&compiled)));
    while cache.entries.len() > MAX_CACHED_PLANS {
        cache.entries.pop_back();
        cache.evictions += 1;
    }
    Ok(compiled)
}

pub fn compile_render_plan(
    raw: &Value,
    context: CompileRenderPlanContext,
    lut: Option<Arc<Lut>>,
) -> Result<CompiledRenderPlan, RenderPlanError> {
    debug_assert!(!FIELD_OWNERSHIP.is_empty());
    let started = Instant::now();
    if !raw.is_object() {
        return Err(RenderPlanError {
            code: "render_plan.invalid_type",
            field: "$",
            message: "adjustments must be an object".into(),
        });
    }
    validate_finite(raw, "$")?;
    let effective = normalize_film_look_adjustments_for_render(raw).into_owned();
    let version_was_explicit = effective.get("rawEngineEditGraphVersion").is_some();
    let pipeline_version = match effective.get("rawEngineEditGraphVersion") {
        None => crate::edit_graph::LEGACY_PIPELINE_VERSION,
        Some(Value::Number(version)) => {
            u32::try_from(version.as_u64().ok_or_else(|| RenderPlanError {
                code: "render_plan.invalid_edit_graph_version",
                field: "rawEngineEditGraphVersion",
                message: "edit graph version must be an unsigned integer".into(),
            })?)
            .map_err(|_| RenderPlanError {
                code: "render_plan.invalid_edit_graph_version",
                field: "rawEngineEditGraphVersion",
                message: "edit graph version exceeds u32".into(),
            })?
        }
        Some(_) => {
            return Err(RenderPlanError {
                code: "render_plan.invalid_edit_graph_version",
                field: "rawEngineEditGraphVersion",
                message: "edit graph version must be an unsigned integer".into(),
            });
        }
    };
    if !crate::edit_graph::SUPPORTED_PIPELINE_VERSIONS.contains(&pipeline_version) {
        return Err(RenderPlanError {
            code: "render_plan.unsupported_edit_graph_version",
            field: "rawEngineEditGraphVersion",
            message: format!("unsupported edit graph version {pipeline_version}"),
        });
    }
    let masks = match effective.get("masks") {
        Some(value) => {
            Vec::<MaskDefinition>::deserialize(value).map_err(|error| RenderPlanError {
                code: "render_plan.invalid_field",
                field: "masks",
                message: error.to_string(),
            })?
        }
        None => Vec::new(),
    };
    let crop = match effective.get("crop").filter(|value| !value.is_null()) {
        Some(value) => Some(Crop::deserialize(value).map_err(|error| RenderPlanError {
            code: "render_plan.invalid_field",
            field: "crop",
            message: error.to_string(),
        })?),
        None => None,
    };
    if let Some(crop) = crop
        && (!(0.0..=1.0).contains(&crop.x)
            || !(0.0..=1.0).contains(&crop.y)
            || !(0.0..=1.0).contains(&crop.width)
            || !(0.0..=1.0).contains(&crop.height))
    {
        return Err(RenderPlanError {
            code: "render_plan.out_of_range",
            field: "crop",
            message: "crop coordinates and dimensions must be in 0..=1".into(),
        });
    }
    let mut adjustments = get_all_adjustments_from_json_with_masks(
        &effective,
        context.is_raw,
        context.tonemapper_override,
        &masks,
    );
    adjustments.global.edit_graph_version = pipeline_version as f32;
    validate_perspective_analysis_currentness(&effective, context.revision.source_revision)?;
    let geometry = get_geometry_params_from_json(&effective);
    let mut fingerprints = fingerprints(
        context.revision.source_revision,
        &effective,
        &adjustments,
        &geometry,
        crop,
        &masks,
        lut.as_deref(),
    );
    let (scene_curve, output_curve) = compile_typed_curves(&effective, pipeline_version)?;
    if let Some(curve) = &scene_curve {
        fingerprints.color = hash_parts(&[
            &fingerprints.color.to_le_bytes(),
            &curve.fingerprint.to_le_bytes(),
        ]);
    }
    if let Some(curve) = &output_curve {
        fingerprints.output = hash_parts(&[
            &fingerprints.output.to_le_bytes(),
            &curve.fingerprint.to_le_bytes(),
        ]);
    }
    let neutral_json = Value::Object(serde_json::Map::new());
    let mut neutral_adjustments = get_all_adjustments_from_json_with_masks(
        &neutral_json,
        context.is_raw,
        context.tonemapper_override,
        &[],
    );
    neutral_adjustments.global.edit_graph_version = pipeline_version as f32;
    let neutral_detail = hash_selected(&neutral_json, DETAIL_FINGERPRINT_FIELDS);
    let default_geometry = GeometryParams::default();
    let has_geometry = geometry_bytes(&geometry, crop) != geometry_bytes(&default_geometry, None);
    let has_retouch = effective
        .get("aiPatches")
        .and_then(Value::as_array)
        .is_some_and(|patches| !patches.is_empty());
    let edit_graph = Arc::new(CompiledEditGraph::compile(EditGraphCompileInputs {
        pipeline_version,
        version_was_explicit,
        source_fingerprint: fingerprints.source,
        geometry_fingerprint: fingerprints.geometry,
        retouch_fingerprint: fingerprints.retouch,
        detail_fingerprint: fingerprints.detail,
        color_fingerprint: fingerprints.color,
        output_fingerprint: fingerprints.output,
        adjustments: &adjustments,
        neutral_adjustments: &neutral_adjustments,
        scene_curve: scene_curve.as_ref(),
        output_curve: output_curve.as_ref(),
        has_geometry_or_retouch: has_geometry || has_retouch,
        has_detail: fingerprints.detail != neutral_detail,
        has_masks: !masks.is_empty(),
        has_lut: lut.is_some(),
        show_clipping: adjustments.global.show_clipping != 0,
    }));
    fingerprints.full = edit_graph.fingerprint;
    log::debug!("compiled_edit_graph {}", edit_graph.diagnostic_receipt());
    Ok(CompiledRenderPlan {
        revision: context.revision,
        adjustments,
        geometry,
        crop,
        masks: masks.into(),
        lut,
        edit_graph,
        fingerprints,
        effective_json: Arc::new(effective),
        compile_time: started.elapsed(),
    })
}

fn compile_typed_curves(
    effective: &Value,
    pipeline_version: u32,
) -> Result<
    (
        Option<CompiledCurvePlanV1>,
        Option<CompiledOutputCurvePlanV1>,
    ),
    RenderPlanError,
> {
    let scene_input = effective
        .get("sceneCurveV1")
        .filter(|value| !value.is_null())
        .map(SceneCurveInputV1::deserialize)
        .transpose()
        .map_err(|error| RenderPlanError {
            code: "render_plan.invalid_scene_curve",
            field: "sceneCurveV1",
            message: error.to_string(),
        })?;
    let output_input = effective
        .get("outputCurveV1")
        .filter(|value| !value.is_null())
        .map(OutputCurveInputV1::deserialize)
        .transpose()
        .map_err(|error| RenderPlanError {
            code: "render_plan.invalid_output_curve",
            field: "outputCurveV1",
            message: error.to_string(),
        })?;
    if pipeline_version != crate::edit_graph::SCENE_REFERRED_PIPELINE_VERSION
        && (scene_input.is_some() || output_input.is_some())
    {
        return Err(RenderPlanError {
            code: "render_plan.curve_requires_scene_pipeline",
            field: "rawEngineEditGraphVersion",
            message: "typed curves require the explicit scene-referred pipeline".to_string(),
        });
    }

    let scene_curve = scene_input
        .map(|input| {
            let points = input
                .points
                .into_iter()
                .map(|point| CurvePoint::new(point.x_ev, point.y_ev))
                .collect::<Vec<_>>();
            let channel_mode = match input.channel_mode {
                SceneCurveChannelInput::LuminancePreserving => {
                    CurveChannelMode::LuminancePreserving
                }
                SceneCurveChannelInput::LinkedRgb => CurveChannelMode::LinkedRgb,
            };
            compile_scene_curve(&points, input.middle_grey, channel_mode).map_err(|error| {
                RenderPlanError {
                    code: "render_plan.invalid_scene_curve",
                    field: "sceneCurveV1",
                    message: format!("{error:?}"),
                }
            })
        })
        .transpose()?;
    let output_curve = output_input
        .map(|input| {
            if input.target_identity.is_empty() || input.target_identity.len() > 128 {
                return Err(RenderPlanError {
                    code: "render_plan.invalid_output_curve",
                    field: "outputCurveV1.targetIdentity",
                    message: "target identity must contain 1..=128 bytes".to_string(),
                });
            }
            let target_fingerprint = hash_json(&Value::String(input.target_identity));
            let target = match input.domain {
                OutputCurveDomainInput::ViewEncoded => OutputCurveTargetV1::view_encoded(
                    target_fingerprint,
                    input.sdr_reference_white_nits,
                    input.peak_nits,
                ),
                OutputCurveDomainInput::OutputEncoded => OutputCurveTargetV1::output_encoded(
                    target_fingerprint,
                    input.sdr_reference_white_nits,
                    input.peak_nits,
                ),
            };
            let points = input
                .points
                .into_iter()
                .map(|point| OutputCurvePoint::new(point.input, point.output))
                .collect::<Vec<_>>();
            compile_output_curve(target, &points).map_err(|error| RenderPlanError {
                code: "render_plan.invalid_output_curve",
                field: "outputCurveV1",
                message: format!("{error:?}"),
            })
        })
        .transpose()?;
    Ok((scene_curve, output_curve))
}

fn validate_perspective_analysis_currentness(
    effective: &Value,
    source_revision: u64,
) -> Result<(), RenderPlanError> {
    let Some(identity) = effective
        .get("perspectiveCorrection")
        .and_then(|settings| settings.get("resolvedPlan"))
        .and_then(|plan| plan.get("analysisIdentity"))
        .filter(|identity| !identity.is_null())
    else {
        return Ok(());
    };
    let orientation = effective
        .get("orientationSteps")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let lens_contract = serde_json::to_string(
        effective
            .get("lensDistortionParams")
            .unwrap_or(&Value::Null),
    )
    .unwrap_or_default();
    let current = [
        source_revision,
        crate::render::artifact_identity::stable_hash(&orientation),
        crate::render::artifact_identity::stable_hash(&lens_contract),
    ];
    let persisted = [
        identity.get("sourceRevision").and_then(Value::as_u64),
        identity
            .get("orientationFingerprint")
            .and_then(Value::as_u64),
        identity
            .get("lensGeometryFingerprint")
            .and_then(Value::as_u64),
    ];
    if persisted != current.map(Some) {
        return Err(RenderPlanError {
            code: "render_plan.stale_perspective_analysis",
            field: "perspectiveCorrection.resolvedPlan.analysisIdentity",
            message: "perspective evidence does not match source, orientation, or lens geometry"
                .to_string(),
        });
    }
    Ok(())
}

pub fn content_revision(
    raw: &Value,
    image_session: u64,
    source_revision: u64,
    settings_revision: u64,
) -> RenderPlanRevision {
    RenderPlanRevision {
        image_session,
        source_revision,
        adjustment_revision: hash_json(raw),
        schema_version: PLAN_SCHEMA_VERSION,
        settings_revision,
    }
}

fn fingerprints(
    source_revision: u64,
    effective: &Value,
    adjustments: &AllAdjustments,
    geometry: &GeometryParams,
    crop: Option<Crop>,
    masks: &[MaskDefinition],
    lut: Option<&Lut>,
) -> StageFingerprints {
    let source = hash_parts(&[
        b"source",
        &FINGERPRINT_VERSION.to_le_bytes(),
        &source_revision.to_le_bytes(),
        &hash_json(effective.get("cameraProfile").unwrap_or(&Value::Null)).to_le_bytes(),
    ]);
    let geometry = hash_parts(&[
        b"geometry",
        &FINGERPRINT_VERSION.to_le_bytes(),
        &geometry_bytes(geometry, crop),
    ]);
    let pre_gpu_color = hash_selected(
        effective,
        crate::adjustment_fields::CPU_COLOR_RENDER_HASH_KEYS,
    );
    let color_section_visibility = hash_json(
        effective
            .get("sectionVisibility")
            .and_then(|visibility| visibility.get("color"))
            .unwrap_or(&Value::Bool(true)),
    );
    let pre_gpu_base = hash_parts(&[
        b"pre-gpu-base",
        &FINGERPRINT_VERSION.to_le_bytes(),
        &geometry.to_le_bytes(),
        &pre_gpu_color.to_le_bytes(),
        &color_section_visibility.to_le_bytes(),
    ]);
    let masks_fingerprint = hash_json(effective.get("masks").unwrap_or(&Value::Null));
    let retouch = pre_gpu_retouch_fingerprint(effective);
    let detail = hash_selected(effective, DETAIL_FINGERPRINT_FIELDS);
    let color = color_fingerprint(
        adjustments,
        lut,
        effective.get("cameraProfileAmount").unwrap_or(&Value::Null),
    );
    let output = hash_parts(&[
        b"output",
        &FINGERPRINT_VERSION.to_le_bytes(),
        &adjustments.global.show_clipping.to_le_bytes(),
        &adjustments.global.tonemapper_mode.to_le_bytes(),
    ]);
    let full = hash_parts(&[
        &source.to_le_bytes(),
        &geometry.to_le_bytes(),
        &masks_fingerprint.to_le_bytes(),
        &retouch.to_le_bytes(),
        &detail.to_le_bytes(),
        &color.to_le_bytes(),
        &output.to_le_bytes(),
    ]);
    let _ = masks.len();
    StageFingerprints {
        source,
        geometry,
        pre_gpu_base,
        masks: masks_fingerprint,
        retouch,
        detail,
        color,
        output,
        full,
    }
}

fn pre_gpu_retouch_fingerprint(effective: &Value) -> u64 {
    let mut cpu_retouch_layers = effective
        .get("masks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|layer| {
            layer
                .get("retouchCloneSource")
                .is_some_and(|value| !value.is_null())
                || layer
                    .get("retouchRemoveSource")
                    .is_some_and(|value| !value.is_null())
        })
        .cloned()
        .collect::<Vec<_>>();
    if let Some(legacy_patches) = effective.get("aiPatches")
        && !legacy_patches.is_null()
    {
        cpu_retouch_layers.push(legacy_patches.clone());
    }
    let content = hash_json(&Value::Array(cpu_retouch_layers));
    hash_parts(&[
        b"pre-gpu-retouch",
        &FINGERPRINT_VERSION.to_le_bytes(),
        &content.to_le_bytes(),
    ])
}

fn color_fingerprint(
    adjustments: &AllAdjustments,
    lut: Option<&Lut>,
    camera_profile_amount: &Value,
) -> u64 {
    let mut color_hasher = blake3::Hasher::new();
    color_hasher.update(b"color");
    color_hasher.update(&FINGERPRINT_VERSION.to_le_bytes());
    crate::render::color_node_registry::update_contract_hash(&mut color_hasher);
    color_hasher.update(bytes_of(adjustments));
    color_hasher.update(&hash_json(camera_profile_amount).to_le_bytes());
    if let Some(lut) = lut {
        color_hasher.update(&(lut.size as u64).to_le_bytes());
        color_hasher.update(&lut.abi_version.to_le_bytes());
        color_hasher.update(&lut.content_hash);
    }
    first_u64(color_hasher.finalize())
}

#[cfg(all(test, feature = "tauri-test"))]
pub(super) fn color_fingerprint_for_test(adjustments: &AllAdjustments, lut: Option<&Lut>) -> u64 {
    color_fingerprint(adjustments, lut, &Value::Null)
}

fn geometry_bytes(params: &GeometryParams, crop: Option<Crop>) -> Vec<u8> {
    let mut out = Vec::with_capacity(160);
    macro_rules! f {
        ($value:expr) => {
            out.extend_from_slice(&canonical_f32($value).to_le_bytes())
        };
    }
    f!(params.distortion);
    f!(params.vertical);
    f!(params.horizontal);
    f!(params.rotate);
    f!(params.aspect);
    f!(params.scale);
    f!(params.x_offset);
    f!(params.y_offset);
    f!(params.lens_distortion_amount);
    f!(params.lens_vignette_amount);
    f!(params.lens_tca_amount);
    out.extend_from_slice(&[
        params.lens_distortion_enabled as u8,
        params.lens_tca_enabled as u8,
        params.lens_vignette_enabled as u8,
    ]);
    f!(params.lens_dist_k1);
    f!(params.lens_dist_k2);
    f!(params.lens_dist_k3);
    out.extend_from_slice(&params.lens_model.to_le_bytes());
    f!(params.tca_vr);
    f!(params.tca_vb);
    f!(params.vig_k1);
    f!(params.vig_k2);
    f!(params.vig_k3);
    for value in params.perspective_source_to_corrected {
        f!(value);
    }
    if let Some(crop) = crop {
        for value in [crop.x, crop.y, crop.width, crop.height] {
            out.extend_from_slice(&canonical_f64(value).to_le_bytes());
        }
    }
    out
}

fn canonical_f32(value: f32) -> u32 {
    if value == 0.0 { 0 } else { value.to_bits() }
}
fn canonical_f64(value: f64) -> u64 {
    if value == 0.0 { 0 } else { value.to_bits() }
}

fn hash_parts(parts: &[&[u8]]) -> u64 {
    let mut hasher = blake3::Hasher::new();
    for part in parts {
        hasher.update(&(part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    first_u64(hasher.finalize())
}

fn first_u64(hash: blake3::Hash) -> u64 {
    u64::from_le_bytes(hash.as_bytes()[..8].try_into().unwrap())
}

fn hash_json(value: &Value) -> u64 {
    fn update(hasher: &mut blake3::Hasher, value: &Value) {
        match value {
            Value::Null => {
                hasher.update(&[0]);
            }
            Value::Bool(value) => {
                hasher.update(&[1, *value as u8]);
            }
            Value::Number(value) => {
                hasher.update(&[2]);
                if let Some(value) = value.as_i64() {
                    hasher.update(&[0]);
                    hasher.update(&value.to_le_bytes());
                } else if let Some(value) = value.as_u64() {
                    hasher.update(&[1]);
                    hasher.update(&value.to_le_bytes());
                } else if let Some(value) = value.as_f64() {
                    hasher.update(&[2]);
                    hasher.update(&canonical_f64(value).to_le_bytes());
                }
            }
            Value::String(value) => {
                hasher.update(&[3]);
                hasher.update(&(value.len() as u64).to_le_bytes());
                hasher.update(value.as_bytes());
            }
            Value::Array(values) => {
                hasher.update(&[4]);
                hasher.update(&(values.len() as u64).to_le_bytes());
                for value in values {
                    update(hasher, value);
                }
            }
            Value::Object(values) => {
                hasher.update(&[5]);
                let mut keys: Vec<_> = values.keys().collect();
                keys.sort_unstable();
                for key in keys {
                    hasher.update(&(key.len() as u64).to_le_bytes());
                    hasher.update(key.as_bytes());
                    update(hasher, &values[key]);
                }
            }
        }
    }
    let mut hasher = blake3::Hasher::new();
    update(&mut hasher, value);
    first_u64(hasher.finalize())
}

fn hash_selected(value: &Value, keys: &[&str]) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&FINGERPRINT_VERSION.to_le_bytes());
    for key in keys {
        hasher.update(key.as_bytes());
        hasher.update(&hash_json(value.get(*key).unwrap_or(&Value::Null)).to_le_bytes());
    }
    first_u64(hasher.finalize())
}

fn validate_finite(value: &Value, path: &str) -> Result<(), RenderPlanError> {
    match value {
        Value::Number(number) if number.as_f64().is_some_and(|value| !value.is_finite()) => {
            Err(RenderPlanError {
                code: "render_plan.non_finite",
                field: "$",
                message: format!("non-finite number at {path}"),
            })
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_finite(value, &format!("{path}[{index}]"))?;
            }
            Ok(())
        }
        Value::Object(values) => {
            for (key, value) in values {
                validate_finite(value, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    fn context(revision: u64) -> CompileRenderPlanContext {
        CompileRenderPlanContext {
            revision: RenderPlanRevision {
                image_session: 7,
                source_revision: 19,
                adjustment_revision: revision,
                schema_version: 1,
                settings_revision: 0,
            },
            is_raw: false,
            tonemapper_override: None,
        }
    }

    #[test]
    fn object_order_and_negative_zero_are_canonical() {
        let a = json!({"rotation": -0.0, "exposure": 1, "crop": {"x":0.0,"y":0.0,"width":1.0,"height":1.0}});
        let b = json!({"crop": {"height":1.0,"width":1.0,"y":-0.0,"x":-0.0}, "exposure": 1, "rotation": 0.0});
        let a = compile_render_plan(&a, context(1), None).unwrap();
        let b = compile_render_plan(&b, context(2), None).unwrap();
        assert_eq!(a.fingerprints, b.fingerprints);
    }

    #[test]
    fn stage_invalidation_is_scoped() {
        let base = compile_render_plan(&json!({}), context(1), None).unwrap();
        let exposure = compile_render_plan(&json!({"exposure": 20}), context(2), None).unwrap();
        assert_eq!(base.fingerprints.geometry, exposure.fingerprints.geometry);
        assert_eq!(
            base.fingerprints.pre_gpu_base,
            exposure.fingerprints.pre_gpu_base
        );
        assert_eq!(base.fingerprints.detail, exposure.fingerprints.detail);
        assert_eq!(base.fingerprints.retouch, exposure.fingerprints.retouch);
        assert_ne!(base.fingerprints.color, exposure.fingerprints.color);
        let cpu_color = compile_render_plan(
            &json!({"channelMixer":{"red":[100,0,0],"green":[0,100,0],"blue":[0,0,100]}}),
            context(7),
            None,
        )
        .unwrap();
        assert_ne!(
            base.fingerprints.pre_gpu_base,
            cpu_color.fingerprints.pre_gpu_base
        );
        let crop = compile_render_plan(
            &json!({"crop":{"x":0.1,"y":0.0,"width":0.9,"height":1.0}}),
            context(3),
            None,
        )
        .unwrap();
        assert_ne!(base.fingerprints.geometry, crop.fingerprints.geometry);
        assert_ne!(
            base.fingerprints.pre_gpu_base,
            crop.fingerprints.pre_gpu_base
        );

        let detail = compile_render_plan(&json!({"sharpness": 30}), context(4), None).unwrap();
        assert_ne!(base.fingerprints.detail, detail.fingerprints.detail);
        assert_eq!(base.fingerprints.geometry, detail.fingerprints.geometry);
        assert_eq!(
            base.fingerprints.pre_gpu_base,
            detail.fingerprints.pre_gpu_base
        );

        let patches = compile_render_plan(
            &json!({"aiPatches":[{"id":"heal-1","visible":true,"patchDataBase64":"abc"}]}),
            context(5),
            None,
        )
        .unwrap();
        assert_ne!(base.fingerprints.retouch, patches.fingerprints.retouch);
        assert_eq!(base.fingerprints.geometry, patches.fingerprints.geometry);

        let clipping =
            compile_render_plan(&json!({"showClipping":true}), context(6), None).unwrap();
        assert_ne!(base.fingerprints.output, clipping.fingerprints.output);

        let rapid_view = compile_render_plan(
            &json!({
                "toneMapper": "rapidView",
                "viewTransform": {"contrast": 1.15, "shoulder": 0.5, "toe": 0.35}
            }),
            context(7),
            None,
        )
        .unwrap();
        let adjusted_rapid_view = compile_render_plan(
            &json!({
                "toneMapper": "rapidView",
                "viewTransform": {"contrast": 1.35, "shoulder": 0.5, "toe": 0.35}
            }),
            context(8),
            None,
        )
        .unwrap();
        assert_ne!(
            rapid_view.fingerprints.color,
            adjusted_rapid_view.fingerprints.color
        );
        assert_ne!(
            rapid_view.fingerprints.full,
            adjusted_rapid_view.fingerprints.full
        );
        assert_eq!(
            rapid_view.fingerprints.geometry,
            adjusted_rapid_view.fingerprints.geometry
        );
    }

    #[test]
    fn gpu_only_masks_do_not_invalidate_pre_gpu_pixels_but_retouch_masks_do() {
        let ordinary_a = json!({"masks":[{
            "id":"local","visible":true,"opacity":100,"adjustments":{"exposure":10},
            "subMasks":[]
        }]});
        let ordinary_b = json!({"masks":[{
            "id":"local","visible":true,"opacity":100,"adjustments":{"exposure":30},
            "subMasks":[]
        }]});
        assert_eq!(
            pre_gpu_retouch_fingerprint(&ordinary_a),
            pre_gpu_retouch_fingerprint(&ordinary_b),
            "a mask consumed only as GPU uniforms must preserve uploaded pixels"
        );

        let retouch_a = json!({"masks":[{
            "id":"clone","visible":true,"opacity":100,"adjustments":{},
            "retouchCloneSource":{"retouchMode":"clone","sourcePoint":{"x":0.1,"y":0.2},
                "targetPoint":{"x":0.8,"y":0.7},"radiusPx":12},"subMasks":[]
        }]});
        let mut retouch_b = retouch_a.clone();
        retouch_b["masks"][0]["retouchCloneSource"]["sourcePoint"]["x"] = json!(0.3);
        assert_ne!(
            pre_gpu_retouch_fingerprint(&retouch_a),
            pre_gpu_retouch_fingerprint(&retouch_b),
            "a CPU retouch source change must invalidate uploaded pixels"
        );
    }

    #[test]
    fn compiled_edit_graph_omits_neutral_nodes_and_executes_active_legacy_fusion() {
        let neutral = compile_render_plan(&json!({}), context(70), None).unwrap();
        assert_eq!(neutral.edit_graph.pipeline_version, 1);
        assert_eq!(
            neutral.edit_graph.receipt.input_domain.contract_id(),
            "acescg_scene_linear_extended_v1"
        );
        assert_eq!(
            neutral.edit_graph.receipt.ordered_node_ids.as_ref(),
            [
                "camera_input_boundary",
                "legacy_gpu_scene_view_pass",
                "render_transport"
            ]
        );
        assert_eq!(
            neutral.edit_graph.receipt.fused_gpu_groups[0].as_ref(),
            ["legacy_gpu_scene_view_pass", "render_transport"]
        );

        let active = compile_render_plan(
            &json!({
                "rawEngineEditGraphVersion": 1,
                "exposure": 20,
                "masks": [{
                    "id":"m1", "name":"Local", "visible":true, "invert":false,
                    "opacity":100, "blendMode":"normal", "adjustments":{"contrast":15},
                    "subMasks":[]
                }]
            }),
            context(71),
            None,
        )
        .unwrap();
        assert!(
            active
                .edit_graph
                .receipt
                .ordered_node_ids
                .contains(&"legacy_gpu_scene_view_pass")
        );
        active
            .edit_graph
            .validate_gpu_execution(&active.adjustments, false, active.masks.len())
            .unwrap();
        let mut stale_adjustments = active.adjustments;
        stale_adjustments.global.exposure += 0.1;
        assert_eq!(
            active
                .edit_graph
                .validate_gpu_execution(&stale_adjustments, false, active.masks.len()),
            Err("edit_graph.stale_gpu_execution_abi")
        );
        assert_eq!(active.fingerprints.full, active.edit_graph.fingerprint);
        let diagnostic = active.edit_graph.diagnostic_receipt();
        assert_eq!(diagnostic["pipelineVersion"], 1);
        assert_eq!(
            diagnostic["nodes"][0]["inputDomain"],
            "acescg_scene_linear_extended_v1"
        );
        assert_eq!(
            diagnostic["nodes"].as_array().unwrap().last().unwrap()["outputDomain"],
            "render_transport_encoded_v1"
        );
        assert_ne!(
            neutral.edit_graph.fingerprint,
            active.edit_graph.fingerprint
        );
    }

    #[test]
    fn typed_curves_compile_at_scene_and_output_boundaries_and_render_pixels() {
        use image::{DynamicImage, ImageBuffer, Rgba};

        let scene_curve = json!({
            "middleGrey": 0.18,
            "channelMode": "luminance_preserving",
            "points": [
                {"xEv": -16.0, "yEv": -16.0},
                {"xEv": 0.0, "yEv": 1.0},
                {"xEv": 16.0, "yEv": 16.0}
            ]
        });
        let output_curve = json!({
            "domain": "output_encoded",
            "targetIdentity": "output-profile-77",
            "sdrReferenceWhiteNits": 203.0,
            "peakNits": 1000.0,
            "points": [
                {"input": 0.0, "output": 0.0},
                {"input": 1.0, "output": 0.7},
                {"input": 4.0, "output": 3.2}
            ]
        });
        let combined_json = json!({
            "rawEngineEditGraphVersion": 2,
            "sceneCurveV1": scene_curve,
            "outputCurveV1": output_curve,
        });
        let combined = compile_render_plan(&combined_json, context(701), None).unwrap();
        let ordered = combined.edit_graph.receipt.ordered_node_ids.as_ref();
        let scene_index = ordered
            .iter()
            .position(|id| *id == "scene_curve_v1")
            .unwrap();
        let view_index = ordered
            .iter()
            .position(|id| *id == "scene_to_view_transform")
            .unwrap();
        let output_index = ordered
            .iter()
            .position(|id| *id == "output_curve_v1")
            .unwrap();
        let transport_index = ordered
            .iter()
            .position(|id| *id == "render_transport")
            .unwrap();
        assert!(scene_index < view_index);
        assert!(view_index < output_index && output_index < transport_index);
        assert!(combined.edit_graph.has_typed_curves());
        assert!(combined.edit_graph.has_user_edits);
        assert_eq!(combined.edit_graph.scene_curve().unwrap().middle_grey, 0.18);
        assert_eq!(
            combined.edit_graph.output_curve().unwrap().target.peak_nits,
            1000.0
        );

        let neutral_json = json!({"rawEngineEditGraphVersion": 2});
        let neutral = compile_render_plan(&neutral_json, context(702), None).unwrap();
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            2,
            2,
            Rgba([0.18, 0.18, 0.18, 0.75]),
        ));
        let render = |plan: &CompiledRenderPlan| {
            crate::cpu_edit_graph::execute_cpu_edit_graph(
                &source,
                &plan.adjustments,
                &[],
                None,
                &plan.edit_graph,
            )
            .unwrap()
            .to_rgba32f()
            .get_pixel(0, 0)
            .0
        };
        let curved = render(&combined);
        let baseline = render(&neutral);
        assert_ne!(curved[..3], baseline[..3]);
        assert_eq!(curved[3], baseline[3]);
        assert!(curved.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn typed_curve_fingerprints_are_stage_local_and_legacy_process_rejects_them() {
        let scene = json!({
            "rawEngineEditGraphVersion": 2,
            "sceneCurveV1": {
                "middleGrey": 0.18,
                "channelMode": "linked_rgb",
                "points": [{"xEv": -16, "yEv": -16}, {"xEv": 16, "yEv": 16}]
            }
        });
        let output = json!({
            "rawEngineEditGraphVersion": 2,
            "outputCurveV1": {
                "domain": "view_encoded",
                "targetIdentity": "rapid-view-default",
                "sdrReferenceWhiteNits": 203,
                "peakNits": 203,
                "points": [{"input": 0, "output": 0}, {"input": 1, "output": 1}]
            }
        });
        let neutral =
            compile_render_plan(&json!({"rawEngineEditGraphVersion": 2}), context(710), None)
                .unwrap();
        let scene = compile_render_plan(&scene, context(711), None).unwrap();
        let output = compile_render_plan(&output, context(712), None).unwrap();
        assert_ne!(scene.fingerprints.color, neutral.fingerprints.color);
        assert_eq!(scene.fingerprints.output, neutral.fingerprints.output);
        assert_eq!(output.fingerprints.color, neutral.fingerprints.color);
        assert_ne!(output.fingerprints.output, neutral.fingerprints.output);

        let legacy = json!({
            "rawEngineEditGraphVersion": 1,
            "sceneCurveV1": {
                "middleGrey": 0.18,
                "channelMode": "linked_rgb",
                "points": [{"xEv": -16, "yEv": -16}, {"xEv": 16, "yEv": 16}]
            }
        });
        let error = compile_render_plan(&legacy, context(713), None)
            .err()
            .expect("legacy process rejects typed curve");
        assert_eq!(error.code, "render_plan.curve_requires_scene_pipeline");
    }

    #[test]
    fn edit_graph_contract_rejects_unversioned_unimplemented_and_illegal_ordering() {
        let plan = compile_render_plan(&json!({"showClipping": true}), context(75), None).unwrap();
        plan.edit_graph.validate_contract().unwrap();
        assert_eq!(
            plan.edit_graph.receipt.fused_gpu_groups[0].as_ref(),
            [
                "legacy_gpu_scene_view_pass",
                "clipping_overlay",
                "render_transport"
            ]
        );

        let mut invalid = (*plan.edit_graph).clone();
        Arc::make_mut(&mut invalid.nodes)[0].implementation_version = 0;
        assert_eq!(
            invalid.validate_contract(),
            Err("edit_graph.invalid_node_version")
        );

        let mut invalid = (*plan.edit_graph).clone();
        let node = &mut Arc::make_mut(&mut invalid.nodes)[0];
        node.cpu_implementation = None;
        node.wgpu_implementation = None;
        assert_eq!(
            invalid.validate_contract(),
            Err("edit_graph.missing_node_implementation")
        );

        let mut invalid = (*plan.edit_graph).clone();
        Arc::make_mut(&mut invalid.nodes).swap(0, 1);
        assert_eq!(
            invalid.validate_contract(),
            Err("edit_graph.invalid_stage_order")
        );

        let mut invalid = (*plan.edit_graph).clone();
        Arc::make_mut(&mut invalid.nodes)[1].input_domain =
            crate::edit_graph::ColorDomain::ViewEncoded;
        assert_eq!(
            invalid.validate_contract(),
            Err("edit_graph.invalid_domain_transition")
        );
    }

    #[test]
    fn persisted_edit_graph_version_defaults_to_legacy_and_requires_explicit_v2() {
        let implicit = compile_render_plan(&json!({"exposure": 10}), context(72), None).unwrap();
        let explicit = compile_render_plan(
            &json!({"exposure": 10, "rawEngineEditGraphVersion": 1}),
            context(73),
            None,
        )
        .unwrap();
        assert_eq!(
            implicit.edit_graph.fingerprint,
            explicit.edit_graph.fingerprint
        );
        assert_eq!(
            implicit.edit_graph.receipt.migration,
            crate::edit_graph::EditGraphMigration::LegacyV1Defaulted
        );
        assert_eq!(
            explicit.edit_graph.receipt.migration,
            crate::edit_graph::EditGraphMigration::LegacyV1Explicit
        );
        assert_eq!(explicit.effective_json["rawEngineEditGraphVersion"], 1);

        let implicit_dehaze =
            compile_render_plan(&json!({"dehaze": 20}), context(76), None).unwrap();
        let explicit_dehaze = compile_render_plan(
            &json!({"dehaze": 20, "rawEngineEditGraphVersion": 1}),
            context(77),
            None,
        )
        .unwrap();
        assert_eq!(
            implicit_dehaze.edit_graph.fingerprint,
            explicit_dehaze.edit_graph.fingerprint
        );

        let v2 = compile_render_plan(
            &json!({"rawEngineEditGraphVersion": 2, "exposure": 10}),
            context(74),
            None,
        )
        .unwrap();
        assert_eq!(
            v2.edit_graph.receipt.migration,
            crate::edit_graph::EditGraphMigration::SceneReferredV2Explicit
        );
        assert_eq!(
            v2.edit_graph.receipt.ordered_node_ids.as_ref(),
            [
                "camera_input_boundary",
                "scene_global_color_tone",
                "scene_to_view_transform",
                "render_transport"
            ]
        );
        assert_ne!(v2.edit_graph.fingerprint, explicit.edit_graph.fingerprint);

        let error =
            compile_render_plan(&json!({"rawEngineEditGraphVersion": 3}), context(75), None)
                .err()
                .unwrap();
        assert_eq!(error.code, "render_plan.unsupported_edit_graph_version");
    }

    #[test]
    fn dcp_identity_and_creative_amount_invalidate_their_owning_domains() {
        let first = format!("dcp:{}", "a".repeat(64));
        let second = format!("dcp:{}", "b".repeat(64));
        let compile = |profile: &str, amount: u32| {
            compile_render_plan(
                &json!({
                    "rawEngineEditGraphVersion": 2,
                    "cameraProfile": profile,
                    "cameraProfileAmount": amount,
                }),
                context(79),
                None,
            )
            .unwrap()
        };
        let base = compile(&first, 100);
        let changed_profile = compile(&second, 100);
        let changed_amount = compile(&first, 40);
        assert_ne!(
            base.fingerprints.source,
            changed_profile.fingerprints.source
        );
        assert_eq!(base.fingerprints.source, changed_amount.fingerprints.source);
        assert_ne!(base.fingerprints.color, changed_amount.fingerprints.color);
        assert_eq!(
            base.fingerprints.geometry,
            changed_profile.fingerprints.geometry
        );
        assert_eq!(base.fingerprints.output, changed_amount.fingerprints.output);
    }

    #[test]
    fn v2_owns_masked_scene_and_display_payloads_in_their_physical_domains() {
        let raw = json!({
            "rawEngineEditGraphVersion": 2,
            "masks": [{
                "id": "owned-local", "name": "Owned local", "visible": true,
                "invert": false, "opacity": 100, "blendMode": "screen",
                "subMasks": [],
                "adjustments": {
                    "exposure": 12,
                    "curves": {
                        "luma": [
                            {"x": 0, "y": 0},
                            {"x": 128, "y": 144},
                            {"x": 255, "y": 255}
                        ]
                    }
                }
            }]
        });
        let plan = compile_render_plan(&raw, context(76), None).unwrap();
        assert_eq!(
            bytes_of(&plan.edit_graph.shader_abi()),
            bytes_of(&plan.adjustments),
            "the graph owns an immutable execution ABI snapshot"
        );
        assert_eq!(
            plan.edit_graph.receipt.ordered_node_ids.as_ref(),
            [
                "camera_input_boundary",
                "scene_global_color_tone",
                "local_scene_composition",
                "scene_to_view_transform",
                "display_creative",
                "render_transport"
            ]
        );
        let diagnostic = plan.edit_graph.diagnostic_receipt();
        let nodes = diagnostic["nodes"].as_array().unwrap();
        let local_scene = nodes
            .iter()
            .find(|node| node["id"] == "local_scene_composition")
            .unwrap();
        let local_display = nodes
            .iter()
            .find(|node| node["id"] == "display_creative")
            .unwrap();
        assert_eq!(
            local_scene["inputDomain"],
            "acescg_scene_linear_extended_v1"
        );
        assert_eq!(local_scene["payload"]["layers"][0]["exposure"], 15.0);
        assert!(local_scene["payload"]["layers"][0].get("curves").is_none());
        assert_eq!(local_display["inputDomain"], "display_encoded_srgb_v1");
        assert_eq!(
            local_display["payload"]["localDisplayLayers"][0]["curveCounts"][0],
            3
        );
        assert!(
            local_display["payload"]["localDisplayLayers"][0]
                .get("exposure")
                .is_none()
        );
    }

    #[test]
    fn v2_payload_fingerprints_invalidate_only_the_owning_physical_domain() {
        let base = json!({
            "rawEngineEditGraphVersion": 2,
            "exposure": 10,
            "curves": {
                "luma": [
                    {"x": 0, "y": 0},
                    {"x": 128, "y": 136},
                    {"x": 255, "y": 255}
                ]
            }
        });
        let exposure = json!({
            "rawEngineEditGraphVersion": 2,
            "exposure": 14,
            "curves": base["curves"].clone()
        });
        let display_curve = json!({
            "rawEngineEditGraphVersion": 2,
            "exposure": 10,
            "curves": {
                "luma": [
                    {"x": 0, "y": 0},
                    {"x": 128, "y": 148},
                    {"x": 255, "y": 255}
                ]
            }
        });
        let rapid_default = json!({
            "rawEngineEditGraphVersion": 2,
            "toneMapper": "rapidView",
            "exposure": 10,
            "curves": base["curves"].clone()
        });
        let rapid_custom = json!({
            "rawEngineEditGraphVersion": 2,
            "toneMapper": "rapidView",
            "viewTransform": {"contrast": 1.6, "shoulder": 0.8, "toe": 0.7},
            "exposure": 10,
            "curves": base["curves"].clone()
        });
        let compile = |raw: &serde_json::Value| {
            compile_render_plan(raw, context(77), None)
                .unwrap()
                .edit_graph
        };
        let base = compile(&base);
        let exposure = compile(&exposure);
        let display_curve = compile(&display_curve);
        let rapid_default = compile(&rapid_default);
        let rapid_custom = compile(&rapid_custom);
        let fingerprint = |graph: &crate::edit_graph::CompiledEditGraph, id| {
            graph
                .nodes
                .iter()
                .find(|node| node.kind.stable_id() == id)
                .unwrap()
                .payload_fingerprint
        };

        for stable in [
            "scene_to_view_transform",
            "display_creative",
            "render_transport",
        ] {
            assert_eq!(fingerprint(&base, stable), fingerprint(&exposure, stable));
        }
        assert_ne!(
            fingerprint(&base, "scene_global_color_tone"),
            fingerprint(&exposure, "scene_global_color_tone")
        );
        for stable in [
            "scene_global_color_tone",
            "scene_to_view_transform",
            "render_transport",
        ] {
            assert_eq!(
                fingerprint(&base, stable),
                fingerprint(&display_curve, stable)
            );
        }
        assert_ne!(
            fingerprint(&base, "display_creative"),
            fingerprint(&display_curve, "display_creative")
        );
        for stable in [
            "scene_global_color_tone",
            "display_creative",
            "render_transport",
        ] {
            assert_eq!(
                fingerprint(&rapid_default, stable),
                fingerprint(&rapid_custom, stable)
            );
        }
        assert_ne!(
            fingerprint(&rapid_default, "scene_to_view_transform"),
            fingerprint(&rapid_custom, "scene_to_view_transform")
        );
    }

    #[test]
    fn source_fingerprint_scopes_plan_cache_and_full_fingerprint() {
        let raw = json!({"exposure": 12});
        let first = compile_render_plan_cached(&raw, context(90), None).unwrap();
        let mut other_context = context(90);
        other_context.revision.source_revision += 1;
        let second = compile_render_plan_cached(&raw, other_context, None).unwrap();
        assert!(!Arc::ptr_eq(&first, &second));
        assert_ne!(first.fingerprints.source, second.fingerprints.source);
        assert_ne!(first.fingerprints.full, second.fingerprints.full);
    }

    #[test]
    fn perspective_analysis_rejects_stale_source_orientation_or_lens_identity() {
        let source_revision = 77;
        let orientation = 2_u64;
        let lens = json!({"k1": 0.1});
        let lens_contract = serde_json::to_string(&lens).unwrap();
        let effective = json!({
            "orientationSteps": orientation,
            "lensDistortionParams": lens,
            "perspectiveCorrection": {
                "resolvedPlan": {
                    "analysisIdentity": {
                        "sourceRevision": source_revision,
                        "orientationFingerprint": crate::render::artifact_identity::stable_hash(&orientation),
                        "lensGeometryFingerprint": crate::render::artifact_identity::stable_hash(&lens_contract)
                    }
                }
            }
        });
        validate_perspective_analysis_currentness(&effective, source_revision).unwrap();
        assert_eq!(
            validate_perspective_analysis_currentness(&effective, source_revision + 1)
                .unwrap_err()
                .code,
            "render_plan.stale_perspective_analysis"
        );
        let mut changed_orientation = effective.clone();
        changed_orientation["orientationSteps"] = json!(3);
        assert!(
            validate_perspective_analysis_currentness(&changed_orientation, source_revision)
                .is_err()
        );
        let mut changed_lens = effective;
        changed_lens["lensDistortionParams"] = json!({"k1": 0.2});
        assert!(validate_perspective_analysis_currentness(&changed_lens, source_revision).is_err());
    }

    #[test]
    fn every_pre_gpu_detail_parameter_invalidates_detail_and_full_fingerprints() {
        let base = compile_render_plan(&json!({}), context(7_701), None).unwrap();
        for &field in DETAIL_FINGERPRINT_FIELDS {
            let value = if field.ends_with("Enabled") {
                Value::Bool(true)
            } else {
                json!(17)
            };
            let changed = compile_render_plan(
                &Value::Object(serde_json::Map::from_iter([(field.to_owned(), value)])),
                context(7_702),
                None,
            )
            .unwrap();
            assert_ne!(
                base.fingerprints.detail, changed.fingerprints.detail,
                "{field} must invalidate the pre-GPU detail fingerprint"
            );
            assert_ne!(
                base.fingerprints.full, changed.fingerprints.full,
                "{field} must invalidate the full render fingerprint"
            );
        }
    }

    #[test]
    fn every_gpu_adjustment_abi_byte_invalidates_the_color_fingerprint() {
        let baseline = AllAdjustments::default();
        let baseline_fingerprint = color_fingerprint(&baseline, None, &Value::Null);
        for byte_index in 0..bytes_of(&baseline).len() {
            let mut changed = baseline;
            bytemuck::bytes_of_mut(&mut changed)[byte_index] ^= 1;
            assert_ne!(
                color_fingerprint(&changed, None, &Value::Null),
                baseline_fingerprint,
                "GPU adjustment ABI byte {byte_index} escaped the color fingerprint"
            );
        }
    }

    #[test]
    fn compiled_gpu_abi_matches_legacy_parser() {
        let raw = json!({
            "exposure": 25, "temperature": -8, "sharpness": 12,
            "crop":{"x":0.1,"y":0.2,"width":0.8,"height":0.7},
            "masks":[{"id":"m1","name":"Local","visible":true,"invert":false,"opacity":80,
                "blendMode":"multiply","adjustments":{"contrast":15},"subMasks":[]}]
        });
        let mut legacy =
            crate::adjustments::parse::get_all_adjustments_from_json(&raw, true, Some(1));
        legacy.global.edit_graph_version = crate::edit_graph::LEGACY_PIPELINE_VERSION as f32;
        let compiled = compile_render_plan(
            &raw,
            CompileRenderPlanContext {
                is_raw: true,
                tonemapper_override: Some(1),
                ..context(77)
            },
            None,
        )
        .unwrap();
        assert_eq!(bytes_of(&legacy), bytes_of(&compiled.adjustments));
        assert_eq!(compiled.masks[0].id, "m1");
        assert_eq!(compiled.crop.unwrap().width, 0.8);
    }

    #[test]
    fn cache_returns_same_arc_and_compiles_outside_lock() {
        let raw = json!({"exposure": 12});
        let first = compile_render_plan_cached(&raw, context(91), None).unwrap();
        let second = compile_render_plan_cached(&raw, context(91), None).unwrap();
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn every_supported_field_family_has_exactly_one_owner() {
        let names: HashSet<_> = FIELD_OWNERSHIP.iter().map(|entry| entry.0).collect();
        assert_eq!(names.len(), FIELD_OWNERSHIP.len());
        assert!(FIELD_OWNERSHIP.iter().all(|entry| !entry.2.is_empty()));
    }

    #[test]
    #[ignore = "manual release-mode microbenchmark"]
    fn benchmark_repeated_plan_build_against_cached_revision() {
        use std::hint::black_box;
        use std::time::Instant;

        let masks: Vec<_> = (0..24)
            .map(|index| json!({
                "id": format!("mask-{index}"), "name": "Gradient", "visible": true,
                "invert": false, "opacity": 100, "adjustments": {"exposure": index},
                "subMasks": [{"id": format!("sub-{index}"), "type": "linearGradient", "visible": true,
                    "invert": false, "opacity": 100, "mode": "additive", "parameters": {"startX":0.1,"startY":0.2,"endX":0.8,"endY":0.9}}]
            }))
            .collect();
        let raw = json!({"exposure": 20, "masks": masks, "aiPatches": [{"id":"p", "visible":true, "patchDataBase64":"x".repeat(8192)}]});
        const ITERATIONS: usize = 500;
        let legacy_started = Instant::now();
        for _ in 0..ITERATIONS {
            black_box(raw.to_string());
            black_box(crate::adjustments::parse::get_all_adjustments_from_json(
                &raw, false, None,
            ));
            black_box(Vec::<MaskDefinition>::deserialize(&raw["masks"]).unwrap());
        }
        let legacy = legacy_started.elapsed();
        let revision = context(8_181);
        let warm = compile_render_plan_cached(&raw, revision, None).unwrap();
        let cached_started = Instant::now();
        for _ in 0..ITERATIONS {
            black_box(compile_render_plan_cached(&raw, revision, None).unwrap());
        }
        let cached = cached_started.elapsed();
        assert_eq!(warm.masks.len(), 24);
        assert!(cached < legacy, "cached={cached:?} legacy={legacy:?}");
        println!(
            "render_plan_benchmark iterations={ITERATIONS} legacy_clone_hash_build_us={} cached_arc_lookup_us={} reduction={:.1}x",
            legacy.as_micros(),
            cached.as_micros(),
            legacy.as_secs_f64() / cached.as_secs_f64()
        );
    }
}
