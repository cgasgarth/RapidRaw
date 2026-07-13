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
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::geometry::{Crop, GeometryParams, get_geometry_params_from_json};
use crate::lut_processing::Lut;
use crate::mask_generation::MaskDefinition;

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
    ("filmLook", RenderStage::Color, "disabled"),
    ("lutPath/lutIntensity", RenderStage::Color, "none/100"),
    ("showClipping", RenderStage::Output, "false"),
    ("toneMapper", RenderStage::Output, "basic"),
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
    let adjustments = get_all_adjustments_from_json_with_masks(
        &effective,
        context.is_raw,
        context.tonemapper_override,
        &masks,
    );
    let geometry = get_geometry_params_from_json(&effective);
    let fingerprints = fingerprints(
        context.revision.source_revision,
        &effective,
        &adjustments,
        &geometry,
        crop,
        &masks,
        lut.as_deref(),
    );
    Ok(CompiledRenderPlan {
        revision: context.revision,
        adjustments,
        geometry,
        crop,
        masks: masks.into(),
        lut,
        fingerprints,
        effective_json: Arc::new(effective),
        compile_time: started.elapsed(),
    })
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
    ]);
    let geometry = hash_parts(&[
        b"geometry",
        &FINGERPRINT_VERSION.to_le_bytes(),
        &geometry_bytes(geometry, crop),
    ]);
    let masks_fingerprint = hash_json(effective.get("masks").unwrap_or(&Value::Null));
    let retouch = hash_json(effective.get("aiPatches").unwrap_or(&Value::Null));
    let detail = hash_selected(effective, DETAIL_FINGERPRINT_FIELDS);
    let color = color_fingerprint(adjustments, lut);
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
        masks: masks_fingerprint,
        retouch,
        detail,
        color,
        output,
        full,
    }
}

fn color_fingerprint(adjustments: &AllAdjustments, lut: Option<&Lut>) -> u64 {
    let mut color_hasher = blake3::Hasher::new();
    color_hasher.update(b"color");
    color_hasher.update(&FINGERPRINT_VERSION.to_le_bytes());
    crate::render::color_node_registry::update_contract_hash(&mut color_hasher);
    color_hasher.update(bytes_of(adjustments));
    if let Some(lut) = lut {
        color_hasher.update(&(lut.size as u64).to_le_bytes());
        color_hasher.update(&lut.abi_version.to_le_bytes());
        color_hasher.update(&lut.content_hash);
    }
    first_u64(color_hasher.finalize())
}

#[cfg(all(test, feature = "tauri-test"))]
pub(super) fn color_fingerprint_for_test(adjustments: &AllAdjustments, lut: Option<&Lut>) -> u64 {
    color_fingerprint(adjustments, lut)
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
        assert_ne!(base.fingerprints.color, exposure.fingerprints.color);
        let crop = compile_render_plan(
            &json!({"crop":{"x":0.1,"y":0.0,"width":0.9,"height":1.0}}),
            context(3),
            None,
        )
        .unwrap();
        assert_ne!(base.fingerprints.geometry, crop.fingerprints.geometry);

        let detail = compile_render_plan(&json!({"sharpness": 30}), context(4), None).unwrap();
        assert_ne!(base.fingerprints.detail, detail.fingerprints.detail);
        assert_eq!(base.fingerprints.geometry, detail.fingerprints.geometry);

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
        let baseline_fingerprint = color_fingerprint(&baseline, None);
        for byte_index in 0..bytes_of(&baseline).len() {
            let mut changed = baseline;
            bytemuck::bytes_of_mut(&mut changed)[byte_index] ^= 1;
            assert_ne!(
                color_fingerprint(&changed, None),
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
        let legacy = crate::adjustments::parse::get_all_adjustments_from_json(&raw, true, Some(1));
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
