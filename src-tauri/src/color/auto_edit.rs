use std::collections::{BTreeSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::color::dehaze::{HazeAnalysisIdentityV1, analyze_haze};
use crate::color::white_balance::{
    WhiteBalanceInputSemanticsV1, WhiteBalanceModeV1, WhiteBalancePlanInputV1,
    compile_white_balance_plan, estimate_cct_duv_from_xy,
};
use crate::image_processing::downscale_f32_image;
use crate::render::artifact_identity::stable_hash;

pub const AUTO_EDIT_CONTRACT: &str = "rapidraw.auto_edit.v1";
pub const AUTO_EDIT_IMPLEMENTATION_VERSION: u32 = 1;
const ANALYSIS_LONG_EDGE: u32 = 1024;
const MIDDLE_GREY: f32 = 0.18;
const AP1_LUMA: [f32; 3] = [0.272_228_72, 0.674_081_77, 0.053_689_52];
const MIN_SCENE_SAMPLES: usize = 256;
const MIN_NEUTRAL_SAMPLES: usize = 32;
const DEFAULT_ENABLE_CONFIDENCE: f32 = 0.68;
const BATCH_SAFE_CONFIDENCE: f32 = 0.82;

static ANALYSIS_GENERATION: AtomicU64 = AtomicU64::new(0);
static ANALYSIS_CACHE: LazyLock<Mutex<VecDeque<AutoEditAnalysisV1>>> =
    LazyLock::new(|| Mutex::new(VecDeque::with_capacity(4)));

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoEditGroup {
    TechnicalWhiteBalance,
    Light,
    Color,
    Atmosphere,
    Detail,
    Geometry,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoRecommendationState {
    Recommended,
    DisabledLowConfidence,
    NotApplicable,
    UnsupportedSource,
    BlockedByCurrentProcess,
    AnalysisFailed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoExpectedEffect {
    TechnicalCorrection,
    SceneLight,
    ConservativeColor,
    AtmosphericCorrection,
    DetailRecovery,
    GeometryCorrection,
    None,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoEditWarningCode {
    InsufficientSceneSamples,
    InsufficientNeutralSamples,
    NonFiniteSamplesRejected,
    SceneClippingUncertain,
    RenderedSourceIlluminantApproximation,
    AtmosphereLowConfidence,
    DetailCapabilityUnavailable,
    GeometryCapabilityUnavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoEditAnalysisIdentityV1 {
    pub source_revision: String,
    pub source_identity: String,
    pub decode_plan_fingerprint: String,
    pub camera_profile_fingerprint: Option<String>,
    pub white_balance_fingerprint: Option<String>,
    pub geometry_fingerprint: String,
    pub analysis_domain: String,
    pub analysis_resolution: [u32; 2],
    pub implementation_version: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneEvPercentilesV1 {
    pub p01: f32,
    pub p05: f32,
    pub p25: f32,
    pub p50: f32,
    pub p75: f32,
    pub p95: f32,
    pub p99: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeutralCandidateStatsV1 {
    pub accepted_samples: u32,
    pub rejected_samples: u32,
    pub median_ap1: [f32; 3],
    pub chroma_spread: f32,
    pub spatial_tile_coverage: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClippingStatsV1 {
    pub sensor_clipped_fraction: Option<f32>,
    pub reconstructed_fraction: Option<f32>,
    pub scene_overrange_fraction: f32,
    pub bright_valid_fraction: f32,
    pub specular_candidate_fraction: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromaDistributionStatsV1 {
    pub p50: f32,
    pub p90: f32,
    pub low_chroma_fraction: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialIlluminationStatsV1 {
    pub center_ev: f32,
    pub edge_ev: f32,
    pub center_edge_delta_ev: f32,
    pub occupied_tiles: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoEditEvidenceV1 {
    pub scene_ev_percentiles: SceneEvPercentilesV1,
    pub neutral_candidate_stats: NeutralCandidateStatsV1,
    pub clipping_stats: ClippingStatsV1,
    pub chroma_stats: ChromaDistributionStatsV1,
    pub spatial_illumination_stats: SpatialIlluminationStatsV1,
    pub local_contrast: f32,
    pub dynamic_range_ev: f32,
    pub valid_samples: u32,
    pub rejected_non_finite_samples: u32,
    pub warning_codes: Vec<AutoEditWarningCode>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoEditAnalysisV1 {
    pub contract: String,
    pub identity: AutoEditAnalysisIdentityV1,
    pub evidence: AutoEditEvidenceV1,
    pub elapsed_micros: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRecommendationV1 {
    pub group: AutoEditGroup,
    pub target: String,
    pub proposed_parameters: Value,
    pub confidence: f32,
    pub evidence_codes: Vec<String>,
    pub expected_effect: AutoExpectedEffect,
    pub safe_to_batch: bool,
    pub state: AutoRecommendationState,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoEditProposalV1 {
    pub contract: String,
    pub analysis_identity: AutoEditAnalysisIdentityV1,
    pub proposal_id: String,
    pub image_session_id: String,
    pub base_graph_revision: String,
    pub base_graph_fingerprint: String,
    pub recommendations: Vec<AutoRecommendationV1>,
    pub default_enabled_groups: BTreeSet<AutoEditGroup>,
    pub impact: f32,
    pub implementation_version: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoParameterDiffV1 {
    pub key: String,
    pub before: Value,
    pub after: Value,
    pub group: AutoEditGroup,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoEditApplicationReceiptV1 {
    pub contract: String,
    pub proposal_id: String,
    pub source_revision: String,
    pub base_graph_revision: String,
    pub resulting_graph_revision: String,
    pub before_graph_fingerprint: String,
    pub after_graph_fingerprint: String,
    pub history_transaction_id: String,
    pub applied_groups: BTreeSet<AutoEditGroup>,
    pub skipped_groups: BTreeSet<AutoEditGroup>,
    pub parameter_diffs: Vec<AutoParameterDiffV1>,
    pub impact: f32,
    pub implementation_version: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeAutoEditRequestV1 {
    pub expected_image_path: String,
    pub image_session_id: String,
    pub graph_revision: String,
    pub current_adjustments: Value,
    #[serde(default)]
    pub camera_profile_identity: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileAutoEditRequestV1 {
    pub expected_image_path: String,
    pub expected_image_session_id: String,
    pub expected_graph_revision: String,
    pub resulting_graph_revision: String,
    pub current_adjustments: Value,
    pub proposal: AutoEditProposalV1,
    pub selected_groups: BTreeSet<AutoEditGroup>,
    pub impact: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoEditPreviewV1 {
    pub proposal_id: String,
    pub preview_identity: String,
    pub source_revision: String,
    pub graph_revision: String,
    pub adjustments: Value,
    pub selected_groups: BTreeSet<AutoEditGroup>,
    pub impact: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedAutoEditV1 {
    pub adjustments: Value,
    pub receipt: AutoEditApplicationReceiptV1,
}

fn hash_serializable(value: &impl Serialize) -> Result<String, String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    Ok(format!("blake3:{}", blake3::hash(&bytes).to_hex()))
}

fn lossless_u64_fingerprint(value: u64) -> String {
    format!("u64:{value:016x}")
}

fn hash_json_field(value: Option<&Value>) -> Option<String> {
    value.map(|value| {
        let bytes = serde_json::to_vec(value).unwrap_or_default();
        lossless_u64_fingerprint(u64::from_le_bytes(
            blake3::hash(&bytes).as_bytes()[..8].try_into().unwrap(),
        ))
    })
}

fn geometry_fingerprint(adjustments: &Value) -> String {
    const KEYS: &[&str] = &[
        "aspectRatio",
        "crop",
        "flipHorizontal",
        "flipVertical",
        "orientationSteps",
        "rotation",
        "transformAspect",
        "transformDistortion",
        "transformHorizontal",
        "transformRotate",
        "transformScale",
        "transformVertical",
        "transformXOffset",
        "transformYOffset",
    ];
    let geometry = KEYS.iter().fold(Map::new(), |mut map, key| {
        if let Some(value) = adjustments.get(key) {
            map.insert((*key).to_string(), value.clone());
        }
        map
    });
    let bytes = serde_json::to_vec(&geometry).unwrap_or_default();
    lossless_u64_fingerprint(u64::from_le_bytes(
        blake3::hash(&bytes).as_bytes()[..8].try_into().unwrap(),
    ))
}

fn percentile(sorted: &[f32], fraction: f32) -> f32 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f32 * fraction).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn median_rgb(samples: &[[f32; 3]]) -> [f32; 3] {
    std::array::from_fn(|channel| {
        let mut values: Vec<f32> = samples.iter().map(|sample| sample[channel]).collect();
        values.sort_by(f32::total_cmp);
        percentile(&values, 0.5)
    })
}

fn robust_mean(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f32::total_cmp);
    let trim = sorted.len() / 20;
    let kept = &sorted[trim..sorted.len().saturating_sub(trim).max(trim + 1)];
    kept.iter().sum::<f32>() / kept.len() as f32
}

fn analyze_scene(
    image: &DynamicImage,
    identity: AutoEditAnalysisIdentityV1,
    generation: u64,
) -> Result<AutoEditAnalysisV1, String> {
    let started = std::time::Instant::now();
    let rgba = image.to_rgba32f();
    let (width, height) = rgba.dimensions();
    let stride = (((u64::from(width) * u64::from(height)) as f64 / (512 * 512) as f64)
        .sqrt()
        .ceil() as u32)
        .max(1);
    let mut ev = Vec::new();
    let mut chroma = Vec::new();
    let mut neutral = Vec::new();
    let mut neutral_tiles = BTreeSet::new();
    let mut center_ev = Vec::new();
    let mut edge_ev = Vec::new();
    let mut local_deltas = Vec::new();
    let mut non_finite = 0_u32;
    let mut overrange = 0_u32;
    let mut bright_valid = 0_u32;
    let mut specular = 0_u32;
    let mut previous_luma: Option<f32> = None;

    for y in (0..height).step_by(stride as usize) {
        if generation != 0 && ANALYSIS_GENERATION.load(Ordering::Acquire) != generation {
            return Err("auto_edit_analysis_cancelled".into());
        }
        for x in (0..width).step_by(stride as usize) {
            let [r, g, b, _] = rgba.get_pixel(x, y).0;
            if ![r, g, b].into_iter().all(f32::is_finite) {
                non_finite += 1;
                continue;
            }
            let luma = AP1_LUMA[0].mul_add(r, AP1_LUMA[1].mul_add(g, AP1_LUMA[2] * b));
            let scene_ev = (luma.max(1e-8) / MIDDLE_GREY).log2();
            let max_channel = r.max(g).max(b);
            let min_channel = r.min(g).min(b);
            let sample_chroma = (max_channel - min_channel) / max_channel.abs().max(0.02);
            ev.push(scene_ev);
            chroma.push(sample_chroma.max(0.0));
            if luma > 1.0 {
                overrange += 1;
            } else if luma > 0.8 {
                bright_valid += 1;
            }
            if luma > 1.0 && sample_chroma < 0.08 {
                specular += 1;
            }
            if (-3.0..=2.5).contains(&scene_ev) && sample_chroma < 0.12 && min_channel > 0.0 {
                neutral.push([r, g, b]);
                neutral_tiles.insert((
                    (x * 4 / width.max(1)).min(3),
                    (y * 4 / height.max(1)).min(3),
                ));
            }
            let central =
                x >= width / 4 && x < width * 3 / 4 && y >= height / 4 && y < height * 3 / 4;
            if central {
                center_ev.push(scene_ev);
            } else {
                edge_ev.push(scene_ev);
            }
            if let Some(previous) = previous_luma {
                local_deltas.push((luma - previous).abs());
            }
            previous_luma = Some(luma);
        }
    }

    ev.sort_by(f32::total_cmp);
    chroma.sort_by(f32::total_cmp);
    if ev.len() < MIN_SCENE_SAMPLES {
        return Err("auto_edit_insufficient_scene_samples".into());
    }
    let neutral_median = median_rgb(&neutral);
    let neutral_chromas: Vec<f32> = neutral
        .iter()
        .map(|rgb| {
            let max = rgb[0].max(rgb[1]).max(rgb[2]);
            let min = rgb[0].min(rgb[1]).min(rgb[2]);
            (max - min) / max.max(0.02)
        })
        .collect();
    let valid = ev.len() as f32;
    let mut warnings = vec![AutoEditWarningCode::SceneClippingUncertain];
    if non_finite > 0 {
        warnings.push(AutoEditWarningCode::NonFiniteSamplesRejected);
    }
    if neutral.len() < MIN_NEUTRAL_SAMPLES {
        warnings.push(AutoEditWarningCode::InsufficientNeutralSamples);
    }
    if identity.analysis_domain != "raw_scene_linear" {
        warnings.push(AutoEditWarningCode::RenderedSourceIlluminantApproximation);
    }
    warnings.push(AutoEditWarningCode::DetailCapabilityUnavailable);
    warnings.push(AutoEditWarningCode::GeometryCapabilityUnavailable);
    let evidence = AutoEditEvidenceV1 {
        scene_ev_percentiles: SceneEvPercentilesV1 {
            p01: percentile(&ev, 0.01),
            p05: percentile(&ev, 0.05),
            p25: percentile(&ev, 0.25),
            p50: percentile(&ev, 0.50),
            p75: percentile(&ev, 0.75),
            p95: percentile(&ev, 0.95),
            p99: percentile(&ev, 0.99),
        },
        neutral_candidate_stats: NeutralCandidateStatsV1 {
            accepted_samples: neutral.len() as u32,
            rejected_samples: ev.len().saturating_sub(neutral.len()) as u32,
            median_ap1: neutral_median,
            chroma_spread: robust_mean(&neutral_chromas),
            spatial_tile_coverage: neutral_tiles.len() as f32 / 16.0,
        },
        clipping_stats: ClippingStatsV1 {
            sensor_clipped_fraction: None,
            reconstructed_fraction: None,
            scene_overrange_fraction: overrange as f32 / valid,
            bright_valid_fraction: bright_valid as f32 / valid,
            specular_candidate_fraction: specular as f32 / valid,
        },
        chroma_stats: ChromaDistributionStatsV1 {
            p50: percentile(&chroma, 0.5),
            p90: percentile(&chroma, 0.9),
            low_chroma_fraction: chroma.partition_point(|value| *value < 0.12) as f32 / valid,
        },
        spatial_illumination_stats: SpatialIlluminationStatsV1 {
            center_ev: robust_mean(&center_ev),
            edge_ev: robust_mean(&edge_ev),
            center_edge_delta_ev: robust_mean(&center_ev) - robust_mean(&edge_ev),
            occupied_tiles: 16,
        },
        local_contrast: robust_mean(&local_deltas),
        dynamic_range_ev: percentile(&ev, 0.99) - percentile(&ev, 0.01),
        valid_samples: ev.len() as u32,
        rejected_non_finite_samples: non_finite,
        warning_codes: warnings,
    };
    Ok(AutoEditAnalysisV1 {
        contract: AUTO_EDIT_CONTRACT.into(),
        identity,
        evidence,
        elapsed_micros: started.elapsed().as_micros().min(u128::from(u64::MAX)) as u64,
    })
}

fn recommendation(
    group: AutoEditGroup,
    target: &str,
    proposed_parameters: Value,
    confidence: f32,
    evidence_codes: &[&str],
    expected_effect: AutoExpectedEffect,
    available: bool,
) -> AutoRecommendationV1 {
    let confidence = confidence.clamp(0.0, 1.0);
    let state = if !available {
        AutoRecommendationState::NotApplicable
    } else if confidence >= DEFAULT_ENABLE_CONFIDENCE {
        AutoRecommendationState::Recommended
    } else {
        AutoRecommendationState::DisabledLowConfidence
    };
    AutoRecommendationV1 {
        group,
        target: target.into(),
        proposed_parameters,
        confidence,
        evidence_codes: evidence_codes
            .iter()
            .map(|code| (*code).to_string())
            .collect(),
        expected_effect,
        safe_to_batch: state == AutoRecommendationState::Recommended
            && confidence >= BATCH_SAFE_CONFIDENCE,
        state,
    }
}

fn white_balance_recommendation(analysis: &AutoEditAnalysisV1) -> AutoRecommendationV1 {
    let neutral = &analysis.evidence.neutral_candidate_stats;
    let coverage_confidence = (neutral.accepted_samples as f32 / 512.0).min(1.0)
        * (neutral.spatial_tile_coverage / 0.5).min(1.0)
        * (1.0 - neutral.chroma_spread / 0.12).clamp(0.0, 1.0);
    let [r, g, b] = neutral.median_ap1;
    let xyz = [
        0.662_454_2 * r + 0.134_004_2 * g + 0.156_187_7 * b,
        0.272_228_7 * r + 0.674_081_8 * g + 0.053_689_5 * b,
        -0.005_574_65 * r + 0.004_060_73 * g + 1.010_339_1 * b,
    ];
    let sum = xyz.iter().sum::<f32>();
    let coordinates = (sum > 1e-6)
        .then(|| estimate_cct_duv_from_xy([f64::from(xyz[0] / sum), f64::from(xyz[1] / sum)]))
        .transpose()
        .ok()
        .flatten();
    let planned = coordinates.and_then(|coordinates| {
        let input_semantics = if analysis.identity.analysis_domain == "raw_scene_linear" {
            WhiteBalanceInputSemanticsV1::RawSceneLinear
        } else {
            WhiteBalanceInputSemanticsV1::RenderedSceneLinearApproximation
        };
        compile_white_balance_plan(WhiteBalancePlanInputV1 {
            mode: WhiteBalanceModeV1::Auto,
            kelvin: coordinates.cct_kelvin,
            duv: coordinates.duv,
            x: Some(coordinates.xy[0]),
            y: Some(coordinates.xy[1]),
            input_semantics,
            camera_channel_gains: None,
        })
        .ok()
        .map(|plan| (coordinates, input_semantics, plan))
    });
    let proposed_parameters =
        planned.map_or(Value::Null, |(coordinates, input_semantics, _plan)| {
            json!({
                "contract": "rapidraw.white_balance.v1",
                "mode": "auto",
                "kelvin": coordinates.cct_kelvin,
                "duv": coordinates.duv,
                "x": coordinates.xy[0],
                "y": coordinates.xy[1],
                "adaptation": "cat16_v1",
                "source": "auto",
                "confidence": coverage_confidence,
                "sampleCount": neutral.accepted_samples,
                "inputSemantics": input_semantics,
                "presetId": null,
                "synchronization": {"mode": "per_image", "referenceSourceIdentity": null}
            })
        });
    recommendation(
        AutoEditGroup::TechnicalWhiteBalance,
        "whiteBalanceTechnical",
        proposed_parameters,
        coverage_confidence,
        &[
            "neutral_candidates",
            "spatial_neutral_coverage",
            "white_balance_plan_v1",
        ],
        AutoExpectedEffect::TechnicalCorrection,
        neutral.accepted_samples as usize >= MIN_NEUTRAL_SAMPLES,
    )
}

fn compile_proposal(
    analysis: &AutoEditAnalysisV1,
    image_session_id: String,
    graph_revision: String,
    current_adjustments: &Value,
    image: &DynamicImage,
) -> Result<AutoEditProposalV1, String> {
    let ev = &analysis.evidence.scene_ev_percentiles;
    let clipping = &analysis.evidence.clipping_stats;
    let midpoint_exposure = (-ev.p50).clamp(-2.0, 2.0);
    let highlight_guard = ((ev.p99 - 2.5).max(0.0) * 0.45).min(1.5);
    let exposure = if clipping.specular_candidate_fraction < 0.02 {
        midpoint_exposure - highlight_guard
    } else {
        midpoint_exposure.min(0.0)
    };
    let light_confidence = ((analysis.evidence.valid_samples as f32 / 2048.0).min(1.0)
        * (analysis.evidence.dynamic_range_ev / 4.0).clamp(0.35, 1.0))
    .clamp(0.0, 1.0);
    let shadows = ((-2.0 - ev.p25).max(0.0) * 12.0).clamp(0.0, 35.0);
    let highlights = (-((ev.p95 - 2.0).max(0.0) * 18.0)).clamp(-45.0, 0.0);
    let light = recommendation(
        AutoEditGroup::Light,
        "sceneToneV1",
        json!({
            "exposure": exposure,
            "highlights": highlights,
            "shadows": shadows,
            "whites": 0.0,
            "blacks": 0.0,
            "contrast": 0.0,
            "rawEngineEditGraphVersion": 2
        }),
        light_confidence,
        &[
            "scene_ev_percentiles",
            "bright_valid_fraction",
            "specular_fraction",
        ],
        AutoExpectedEffect::SceneLight,
        true,
    );
    let chroma = &analysis.evidence.chroma_stats;
    let color_amount = ((0.18 - chroma.p50).max(0.0) * 45.0).clamp(0.0, 8.0);
    let color_confidence = if color_amount > 0.0 && chroma.p90 < 0.65 {
        0.72
    } else {
        0.45
    };
    let color = recommendation(
        AutoEditGroup::Color,
        "vibrance",
        json!({"vibrance": color_amount}),
        color_confidence,
        &["scene_chroma_distribution", "target_gamut_guard"],
        AutoExpectedEffect::ConservativeColor,
        color_amount > 0.0,
    );
    let haze_identity = HazeAnalysisIdentityV1::new(
        stable_hash(&analysis.identity.source_revision),
        stable_hash(&analysis.identity.decode_plan_fingerprint),
        stable_hash(&analysis.identity.geometry_fingerprint),
        analysis.identity.analysis_resolution[0],
        analysis.identity.analysis_resolution[1],
    );
    let haze = analyze_haze(image, haze_identity);
    let haze_confidence =
        haze.atmospheric_light_confidence * ((haze.haze_fraction - 0.18) / 0.32).clamp(0.0, 1.0);
    let atmosphere = recommendation(
        AutoEditGroup::Atmosphere,
        "dehazeV1",
        json!({"dehaze": (haze.haze_fraction * 18.0).clamp(0.0, 12.0)}),
        haze_confidence,
        &["dehaze_service_v1", "transmission_distribution"],
        AutoExpectedEffect::AtmosphericCorrection,
        haze.haze_fraction > 0.18,
    );
    let detail = recommendation(
        AutoEditGroup::Detail,
        "detailCapability",
        Value::Null,
        0.0,
        &["detail_capability_unavailable"],
        AutoExpectedEffect::DetailRecovery,
        false,
    );
    let geometry = recommendation(
        AutoEditGroup::Geometry,
        "geometryCapability",
        Value::Null,
        0.0,
        &["geometry_capability_unavailable"],
        AutoExpectedEffect::GeometryCorrection,
        false,
    );
    let recommendations = vec![
        white_balance_recommendation(analysis),
        light,
        color,
        atmosphere,
        detail,
        geometry,
    ];
    let default_enabled_groups = recommendations
        .iter()
        .filter(|item| item.state == AutoRecommendationState::Recommended)
        .map(|item| item.group)
        .collect();
    let base_graph_fingerprint = hash_serializable(current_adjustments)?;
    let proposal_seed = json!({
        "identity": analysis.identity,
        "imageSessionId": image_session_id,
        "graphRevision": graph_revision,
        "baseGraphFingerprint": base_graph_fingerprint,
        "recommendations": recommendations,
        "implementationVersion": AUTO_EDIT_IMPLEMENTATION_VERSION
    });
    Ok(AutoEditProposalV1 {
        contract: AUTO_EDIT_CONTRACT.into(),
        analysis_identity: analysis.identity.clone(),
        proposal_id: hash_serializable(&proposal_seed)?,
        image_session_id,
        base_graph_revision: graph_revision,
        base_graph_fingerprint,
        recommendations,
        default_enabled_groups,
        impact: 1.0,
        implementation_version: AUTO_EDIT_IMPLEMENTATION_VERSION,
    })
}

fn validate_compile_request(
    request: &CompileAutoEditRequestV1,
    loaded_path: &str,
    source_revision: &str,
) -> Result<(), String> {
    if request.expected_image_path != loaded_path
        || request.proposal.analysis_identity.source_identity != loaded_path
    {
        return Err("auto_edit_stale_source_identity".into());
    }
    if request.expected_image_session_id.is_empty() {
        return Err("auto_edit_missing_image_session_identity".into());
    }
    if request.expected_image_session_id != request.proposal.image_session_id {
        return Err("auto_edit_stale_image_session_identity".into());
    }
    if request.expected_graph_revision != request.proposal.base_graph_revision {
        return Err("auto_edit_stale_graph_revision".into());
    }
    if request.proposal.analysis_identity.source_revision != source_revision {
        return Err("auto_edit_stale_source_revision".into());
    }
    if request.proposal.base_graph_fingerprint != hash_serializable(&request.current_adjustments)? {
        return Err("auto_edit_base_graph_fingerprint_mismatch".into());
    }
    if !request.impact.is_finite() || !(0.0..=1.0).contains(&request.impact) {
        return Err("auto_edit_invalid_impact".into());
    }
    Ok(())
}

fn blend_number(before: Option<&Value>, proposed: f64, impact: f32) -> Value {
    let before = before.and_then(Value::as_f64).unwrap_or(0.0);
    json!(before + (proposed - before) * f64::from(impact))
}

fn compile_adjustments(
    request: &CompileAutoEditRequestV1,
) -> Result<(Value, Vec<AutoParameterDiffV1>, BTreeSet<AutoEditGroup>), String> {
    let mut adjustments = request.current_adjustments.clone();
    let object = adjustments
        .as_object_mut()
        .ok_or_else(|| "auto_edit_adjustments_not_object".to_string())?;
    let mut diffs = Vec::new();
    let mut applied = BTreeSet::new();
    for item in &request.proposal.recommendations {
        if !request.selected_groups.contains(&item.group)
            || item.state != AutoRecommendationState::Recommended
        {
            continue;
        }
        if item.target == "whiteBalanceTechnical" {
            if !item.proposed_parameters.is_null() && request.impact >= 0.999 {
                let key = "whiteBalanceTechnical".to_string();
                let before = object.get(&key).cloned().unwrap_or(Value::Null);
                let after = item.proposed_parameters.clone();
                if before != after {
                    object.insert(key.clone(), after.clone());
                    object.insert("whiteBalanceMigration".into(), json!("native_v1"));
                    diffs.push(AutoParameterDiffV1 {
                        key,
                        before,
                        after,
                        group: item.group,
                    });
                    applied.insert(item.group);
                }
            }
            continue;
        }
        let Some(parameters) = item.proposed_parameters.as_object() else {
            continue;
        };
        for (key, proposed) in parameters {
            let before = object.get(key).cloned().unwrap_or(Value::Null);
            let after = if key == "rawEngineEditGraphVersion" {
                proposed.clone()
            } else if let Some(proposed_number) = proposed.as_f64() {
                blend_number(object.get(key), proposed_number, request.impact)
            } else if request.impact >= 0.999 {
                proposed.clone()
            } else {
                continue;
            };
            if before != after {
                object.insert(key.clone(), after.clone());
                diffs.push(AutoParameterDiffV1 {
                    key: key.clone(),
                    before,
                    after,
                    group: item.group,
                });
                applied.insert(item.group);
            }
        }
    }
    Ok((adjustments, diffs, applied))
}

fn preview_compiled_request(
    request: CompileAutoEditRequestV1,
    loaded_path: &str,
    source_revision: &str,
) -> Result<AutoEditPreviewV1, String> {
    validate_compile_request(&request, loaded_path, source_revision)?;
    let (adjustments, _, applied) = compile_adjustments(&request)?;
    let preview_identity = hash_serializable(&json!({
        "proposalId": request.proposal.proposal_id,
        "sourceRevision": source_revision,
        "graphRevision": request.expected_graph_revision,
        "imageSessionId": request.expected_image_session_id,
        "selectedGroups": applied,
        "impact": request.impact,
        "adjustments": adjustments,
    }))?;
    Ok(AutoEditPreviewV1 {
        proposal_id: request.proposal.proposal_id,
        preview_identity,
        source_revision: source_revision.into(),
        graph_revision: request.expected_graph_revision,
        adjustments,
        selected_groups: applied,
        impact: request.impact,
    })
}

fn apply_compiled_request(
    request: CompileAutoEditRequestV1,
    loaded_path: &str,
    source_revision: &str,
) -> Result<AppliedAutoEditV1, String> {
    validate_compile_request(&request, loaded_path, source_revision)?;
    let before_fingerprint = hash_serializable(&request.current_adjustments)?;
    let (adjustments, parameter_diffs, applied_groups) = compile_adjustments(&request)?;
    let after_fingerprint = hash_serializable(&adjustments)?;
    let skipped_groups = request
        .selected_groups
        .difference(&applied_groups)
        .copied()
        .collect();
    let transaction_seed = json!({
        "proposalId": request.proposal.proposal_id,
        "sourceRevision": source_revision,
        "baseGraphRevision": request.expected_graph_revision,
        "resultingGraphRevision": request.resulting_graph_revision,
        "afterGraphFingerprint": after_fingerprint,
    });
    let receipt = AutoEditApplicationReceiptV1 {
        contract: AUTO_EDIT_CONTRACT.into(),
        proposal_id: request.proposal.proposal_id,
        source_revision: source_revision.into(),
        base_graph_revision: request.expected_graph_revision,
        resulting_graph_revision: request.resulting_graph_revision,
        before_graph_fingerprint: before_fingerprint,
        after_graph_fingerprint: after_fingerprint,
        history_transaction_id: hash_serializable(&transaction_seed)?,
        applied_groups,
        skipped_groups,
        parameter_diffs,
        impact: request.impact,
        implementation_version: AUTO_EDIT_IMPLEMENTATION_VERSION,
    };
    Ok(AppliedAutoEditV1 {
        adjustments,
        receipt,
    })
}

#[tauri::command]
pub async fn analyze_auto_edit(
    request: AnalyzeAutoEditRequestV1,
    state: tauri::State<'_, AppState>,
) -> Result<AutoEditProposalV1, String> {
    let generation = ANALYSIS_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    let loaded = state
        .original_image
        .lock()
        .unwrap()
        .as_ref()
        .cloned()
        .ok_or_else(|| "auto_edit_no_image_loaded".to_string())?;
    if loaded.path != request.expected_image_path {
        return Err("auto_edit_stale_source_identity".into());
    }
    if request.image_session_id.is_empty() {
        return Err("auto_edit_missing_image_session_identity".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let preview = downscale_f32_image(&loaded.image, ANALYSIS_LONG_EDGE, ANALYSIS_LONG_EDGE);
        let (width, height) = preview.dimensions();
        let identity = AutoEditAnalysisIdentityV1 {
            source_revision: loaded.artifact_source.revision.identity(),
            source_identity: loaded.path.clone(),
            decode_plan_fingerprint: lossless_u64_fingerprint(
                loaded.artifact_source.decode_fingerprint(),
            ),
            camera_profile_fingerprint: hash_json_field(request.camera_profile_identity.as_ref()),
            white_balance_fingerprint: hash_json_field(
                request.current_adjustments.get("whiteBalanceTechnical"),
            ),
            geometry_fingerprint: geometry_fingerprint(&request.current_adjustments),
            analysis_domain: if loaded.is_raw {
                "raw_scene_linear"
            } else {
                "rendered_scene_linear_approximation"
            }
            .into(),
            analysis_resolution: [width, height],
            implementation_version: AUTO_EDIT_IMPLEMENTATION_VERSION,
        };
        if let Some(cached) = ANALYSIS_CACHE
            .lock()
            .unwrap()
            .iter()
            .find(|analysis| analysis.identity == identity)
            .cloned()
        {
            return compile_proposal(
                &cached,
                request.image_session_id,
                request.graph_revision,
                &request.current_adjustments,
                &preview,
            );
        }
        let analysis = analyze_scene(&preview, identity, generation)?;
        let proposal = compile_proposal(
            &analysis,
            request.image_session_id,
            request.graph_revision,
            &request.current_adjustments,
            &preview,
        )?;
        let mut cache = ANALYSIS_CACHE.lock().unwrap();
        cache.push_front(analysis);
        cache.truncate(4);
        Ok(proposal)
    })
    .await
    .map_err(|error| format!("auto_edit_analysis_task_failed:{error}"))?
}

#[tauri::command]
pub fn preview_auto_edit_proposal(
    request: CompileAutoEditRequestV1,
    state: tauri::State<AppState>,
) -> Result<AutoEditPreviewV1, String> {
    let loaded = state.original_image.lock().unwrap();
    let loaded = loaded
        .as_ref()
        .ok_or_else(|| "auto_edit_no_image_loaded".to_string())?;
    let source_revision = loaded.artifact_source.revision.identity();
    preview_compiled_request(request, &loaded.path, &source_revision)
}

#[tauri::command]
pub fn apply_auto_edit_proposal(
    request: CompileAutoEditRequestV1,
    state: tauri::State<AppState>,
) -> Result<AppliedAutoEditV1, String> {
    let loaded = state.original_image.lock().unwrap();
    let loaded = loaded
        .as_ref()
        .ok_or_else(|| "auto_edit_no_image_loaded".to_string())?;
    let source_revision = loaded.artifact_source.revision.identity();
    apply_compiled_request(request, &loaded.path, &source_revision)
}

#[tauri::command]
pub fn cancel_auto_edit_analysis() {
    ANALYSIS_GENERATION.fetch_add(1, Ordering::AcqRel);
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    #[cfg(feature = "tauri-test")]
    use tauri::Manager;

    #[cfg(feature = "tauri-test")]
    use crate::cpu_edit_graph::execute_cpu_edit_graph;
    #[cfg(feature = "tauri-test")]
    use crate::gpu_context::acquire_gpu_test_lock;
    #[cfg(feature = "tauri-test")]
    use crate::gpu_processing::{
        EditGraphExecutionAuthority, PreGpuImageIdentity, RenderRequest,
        get_or_init_compute_gpu_context_for_tests, process_and_get_unclamped_dynamic_image,
    };
    #[cfg(feature = "tauri-test")]
    use crate::render_plan::{CompileRenderPlanContext, RenderPlanRevision, compile_render_plan};

    fn identity(width: u32, height: u32) -> AutoEditAnalysisIdentityV1 {
        AutoEditAnalysisIdentityV1 {
            source_revision: "source-revision-v1:test".into(),
            source_identity: "/test/input.raw".into(),
            decode_plan_fingerprint: "u64:0000000000000001".into(),
            camera_profile_fingerprint: Some("u64:0000000000000002".into()),
            white_balance_fingerprint: Some("u64:0000000000000003".into()),
            geometry_fingerprint: "u64:0000000000000004".into(),
            analysis_domain: "raw_scene_linear".into(),
            analysis_resolution: [width, height],
            implementation_version: AUTO_EDIT_IMPLEMENTATION_VERSION,
        }
    }

    fn ramp(offset_ev: f32) -> DynamicImage {
        let image = ImageBuffer::from_fn(128, 64, |x, y| {
            let base_ev = -4.0 + 7.0 * x as f32 / 127.0 + 0.08 * (y % 5) as f32;
            let value = MIDDLE_GREY * 2.0_f32.powf(base_ev + offset_ev);
            Rgba([value, value, value, 1.0])
        });
        DynamicImage::ImageRgba32F(image)
    }

    #[test]
    fn scene_analysis_is_deterministic_and_tracks_known_ev_offset() {
        let base = analyze_scene(&ramp(0.0), identity(128, 64), 0).unwrap();
        let shifted = analyze_scene(&ramp(1.0), identity(128, 64), 0).unwrap();
        let repeat = analyze_scene(&ramp(0.0), identity(128, 64), 0).unwrap();
        assert_eq!(base.evidence, repeat.evidence);
        assert!(
            (shifted.evidence.scene_ev_percentiles.p50
                - base.evidence.scene_ev_percentiles.p50
                - 1.0)
                .abs()
                < 0.03
        );
        assert!(
            base.evidence
                .clipping_stats
                .sensor_clipped_fraction
                .is_none()
        );
    }

    #[test]
    fn proposal_abstains_for_unsupported_groups_and_never_infers_vignette_or_centre() {
        let image = ramp(0.0);
        let analysis = analyze_scene(&image, identity(128, 64), 0).unwrap();
        let proposal = compile_proposal(
            &analysis,
            "session-1".into(),
            "history_0".into(),
            &json!({}),
            &image,
        )
        .unwrap();
        for group in [AutoEditGroup::Detail, AutoEditGroup::Geometry] {
            assert_eq!(
                proposal
                    .recommendations
                    .iter()
                    .find(|item| item.group == group)
                    .unwrap()
                    .state,
                AutoRecommendationState::NotApplicable
            );
        }
        let serialized = serde_json::to_string(&proposal).unwrap();
        assert!(!serialized.contains("vignette"));
        assert!(!serialized.contains("centré"));
    }

    #[test]
    fn preview_is_non_mutating_and_apply_receipt_selects_only_supported_recommendations() {
        let image = ramp(-1.0);
        let analysis = analyze_scene(&image, identity(128, 64), 0).unwrap();
        let base = json!({"exposure": 0.0, "contrast": 0.0});
        let proposal = compile_proposal(
            &analysis,
            "session-1".into(),
            "history_3".into(),
            &base,
            &image,
        )
        .unwrap();
        let request = CompileAutoEditRequestV1 {
            expected_image_path: "/test/input.raw".into(),
            expected_image_session_id: "session-1".into(),
            expected_graph_revision: "history_3".into(),
            resulting_graph_revision: "history_4".into(),
            current_adjustments: base.clone(),
            proposal,
            selected_groups: [AutoEditGroup::Light, AutoEditGroup::Geometry]
                .into_iter()
                .collect(),
            impact: 1.0,
        };
        let (preview, diffs, applied) = compile_adjustments(&request).unwrap();
        assert_eq!(base["exposure"], 0.0);
        assert_ne!(preview["exposure"], base["exposure"]);
        assert!(diffs.iter().all(|diff| diff.group == AutoEditGroup::Light));
        assert_eq!(applied, [AutoEditGroup::Light].into_iter().collect());
        let preview_receipt = preview_compiled_request(
            request.clone(),
            "/test/input.raw",
            "source-revision-v1:test",
        )
        .unwrap();
        let applied_receipt = apply_compiled_request(
            request.clone(),
            "/test/input.raw",
            "source-revision-v1:test",
        )
        .unwrap();
        assert_eq!(preview_receipt.adjustments, applied_receipt.adjustments);
        assert_eq!(
            applied_receipt.receipt.applied_groups,
            [AutoEditGroup::Light].into_iter().collect()
        );
        assert_eq!(
            applied_receipt.receipt.skipped_groups,
            [AutoEditGroup::Geometry].into_iter().collect()
        );
        assert_eq!(
            applied_receipt.receipt.resulting_graph_revision,
            "history_4"
        );
        let mut stale = request;
        stale.expected_graph_revision = "history_2".into();
        assert_eq!(
            apply_compiled_request(stale, "/test/input.raw", "source-revision-v1:test")
                .unwrap_err(),
            "auto_edit_stale_graph_revision"
        );
    }

    #[test]
    fn low_sample_and_non_finite_inputs_fail_closed() {
        let tiny = DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            4,
            4,
            Rgba([f32::NAN, 0.2, 0.2, 1.0]),
        ));
        assert_eq!(
            analyze_scene(&tiny, identity(4, 4), 0).unwrap_err(),
            "auto_edit_insufficient_scene_samples"
        );
    }

    #[test]
    #[cfg(feature = "tauri-test")]
    #[ignore = "requires a native WGPU adapter; run as the Auto Edit output-parity proof"]
    fn accepted_proposal_has_pixel_effect_and_cpu_wgpu_output_parity() {
        let _gpu_lock = acquire_gpu_test_lock();
        let image = ramp(-1.0);
        let analysis = analyze_scene(&image, identity(128, 64), 0).unwrap();
        let base = json!({"rawEngineEditGraphVersion": 2, "exposure": 0.0});
        let proposal = compile_proposal(
            &analysis,
            "session-1".into(),
            "history_0".into(),
            &base,
            &image,
        )
        .unwrap();
        let request = CompileAutoEditRequestV1 {
            expected_image_path: "/test/input.raw".into(),
            expected_image_session_id: "session-1".into(),
            expected_graph_revision: "history_0".into(),
            resulting_graph_revision: "history_1".into(),
            current_adjustments: base,
            proposal,
            selected_groups: [AutoEditGroup::Light].into_iter().collect(),
            impact: 1.0,
        };
        let (adjustments, diffs, _) = compile_adjustments(&request).unwrap();
        assert!(diffs.iter().any(|diff| diff.key == "exposure"));
        let plan = compile_render_plan(
            &adjustments,
            CompileRenderPlanContext {
                revision: RenderPlanRevision {
                    image_session: 1,
                    source_revision: 1,
                    adjustment_revision: 1,
                    schema_version: 1,
                    settings_revision: 0,
                },
                is_raw: true,
                tonemapper_override: None,
            },
            None,
        )
        .unwrap();
        let cpu =
            execute_cpu_edit_graph(&image, &plan.adjustments, &[], None, &plan.edit_graph).unwrap();
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state).unwrap();
        let wgpu = process_and_get_unclamped_dynamic_image(
            &context,
            &state,
            &image,
            PreGpuImageIdentity::for_source(&image, "auto_edit_output_parity"),
            RenderRequest {
                adjustments: plan.adjustments,
                mask_bitmaps: &[],
                lut: None,
                roi: None,
                edit_graph: EditGraphExecutionAuthority::Compiled(plan.edit_graph),
            },
            "auto_edit_output_parity",
        )
        .unwrap();
        let cpu = cpu.to_rgba32f();
        let wgpu = wgpu.to_rgba32f();
        let max_delta = cpu
            .as_raw()
            .iter()
            .zip(wgpu.as_raw())
            .map(|(left, right)| (left - right).abs())
            .fold(0.0_f32, f32::max);
        assert!(max_delta < 0.02, "Auto Edit CPU/WGPU max delta {max_delta}");
        let source = image.to_rgba32f();
        let effect = source
            .as_raw()
            .iter()
            .zip(cpu.as_raw())
            .map(|(left, right)| (left - right).abs())
            .fold(0.0_f32, f32::max);
        assert!(effect > 0.01, "accepted Auto proposal had no pixel effect");
    }
}
