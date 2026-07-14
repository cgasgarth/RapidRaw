use std::collections::VecDeque;
use std::sync::{Arc, LazyLock, Mutex};

use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};

use crate::adjustments::abi::{AllAdjustments, MAX_MASKS};

pub const DEHAZE_ANALYSIS_IMPLEMENTATION_VERSION: u32 = 2;
pub const DEHAZE_RENDER_IMPLEMENTATION_VERSION: u32 = 2;

const MAX_ANALYSIS_SAMPLES: usize = 512 * 512;
const TRANSMISSION_FLOOR: f32 = 0.08;
const HAZE_STRENGTH: f32 = 0.95;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HazeAnalysisIdentityV1 {
    pub source_revision: u64,
    pub decode_fingerprint: u64,
    pub geometry_fingerprint: u64,
    pub width: u32,
    pub height: u32,
    pub implementation_version: u32,
}

impl HazeAnalysisIdentityV1 {
    pub fn new(
        source_revision: u64,
        decode_fingerprint: u64,
        geometry_fingerprint: u64,
        width: u32,
        height: u32,
    ) -> Self {
        Self {
            source_revision,
            decode_fingerprint,
            geometry_fingerprint,
            width,
            height,
            implementation_version: DEHAZE_ANALYSIS_IMPLEMENTATION_VERSION,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HazeWarningCode {
    InsufficientEvidence,
    LowConfidence,
    NonFiniteInput,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HazeAnalysisPlanV1 {
    pub identity: HazeAnalysisIdentityV1,
    pub atmospheric_light: [f32; 3],
    pub atmospheric_light_confidence: f32,
    pub haze_fraction: f32,
    pub transmission_percentiles: [f32; 5],
    pub sampled_pixels: u32,
    pub warning_codes: Vec<HazeWarningCode>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AtmosphericLightMode {
    Auto,
    Sampled,
    Manual,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DehazeSettingsV1 {
    pub amount: f32,
    pub atmospheric_light_mode: AtmosphericLightMode,
    pub manual_atmospheric_light: [f32; 3],
    pub highlight_protection: f32,
    pub color_preservation: f32,
    pub minimum_transmission: f32,
}

impl Default for DehazeSettingsV1 {
    fn default() -> Self {
        Self {
            amount: 0.0,
            atmospheric_light_mode: AtmosphericLightMode::Auto,
            manual_atmospheric_light: [1.0; 3],
            highlight_protection: 0.5,
            color_preservation: 0.75,
            minimum_transmission: TRANSMISSION_FLOOR,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledDehazePlanV1 {
    pub analysis_identity: HazeAnalysisIdentityV1,
    pub atmospheric_light: [f32; 3],
    pub confidence: f32,
    pub settings: DehazeSettingsV1,
    pub fingerprint: u64,
    pub implementation_version: u32,
}

pub fn compile_dehaze_plan(
    analysis: &HazeAnalysisPlanV1,
    settings: DehazeSettingsV1,
) -> CompiledDehazePlanV1 {
    let atmospheric_light = match settings.atmospheric_light_mode {
        AtmosphericLightMode::Auto => analysis.atmospheric_light,
        AtmosphericLightMode::Sampled | AtmosphericLightMode::Manual => {
            settings.manual_atmospheric_light
        }
    };
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"dehaze-plan-v1");
    hasher.update(&analysis.identity.source_revision.to_le_bytes());
    hasher.update(&analysis.identity.decode_fingerprint.to_le_bytes());
    hasher.update(&analysis.identity.geometry_fingerprint.to_le_bytes());
    hasher.update(&analysis.identity.implementation_version.to_le_bytes());
    for value in analysis
        .atmospheric_light
        .into_iter()
        .chain([
            analysis.atmospheric_light_confidence,
            analysis.haze_fraction,
        ])
        .chain(analysis.transmission_percentiles)
    {
        hasher.update(&value.to_bits().to_le_bytes());
    }
    for warning in &analysis.warning_codes {
        hasher.update(&[*warning as u8]);
    }
    for value in [
        settings.amount,
        settings.highlight_protection,
        settings.color_preservation,
        settings.minimum_transmission,
        atmospheric_light[0],
        atmospheric_light[1],
        atmospheric_light[2],
    ] {
        hasher.update(&value.to_bits().to_le_bytes());
    }
    hasher.update(&[settings.atmospheric_light_mode as u8]);
    let fingerprint = u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap());
    CompiledDehazePlanV1 {
        analysis_identity: analysis.identity,
        atmospheric_light,
        confidence: analysis.atmospheric_light_confidence,
        settings,
        fingerprint,
        implementation_version: DEHAZE_RENDER_IMPLEMENTATION_VERSION,
    }
}

pub fn scene_dehaze_is_active(adjustments: &AllAdjustments) -> bool {
    if adjustments.global.edit_graph_version < 2.0 {
        return false;
    }
    let mask_count = (adjustments.mask_count as usize).min(MAX_MASKS);
    adjustments.global.dehaze != 0.0
        || adjustments.mask_adjustments[..mask_count]
            .iter()
            .any(|mask| mask.dehaze != 0.0)
}

pub fn apply_analysis_to_adjustments(
    analysis: &HazeAnalysisPlanV1,
    adjustments: &mut AllAdjustments,
) -> CompiledDehazePlanV1 {
    let plan = compile_dehaze_plan(
        analysis,
        DehazeSettingsV1 {
            amount: (adjustments.global.dehaze * 7.5).clamp(-1.0, 1.0),
            atmospheric_light_mode: AtmosphericLightMode::Auto,
            ..Default::default()
        },
    );
    adjustments.global.dehaze_atmosphere_r = plan.atmospheric_light[0];
    adjustments.global.dehaze_atmosphere_g = plan.atmospheric_light[1];
    adjustments.global.dehaze_atmosphere_b = plan.atmospheric_light[2];
    adjustments.global.dehaze_atmosphere_confidence = plan.confidence;
    plan
}

static CPU_HAZE_ANALYSIS_CACHE: LazyLock<Mutex<HazeAnalysisCache>> =
    LazyLock::new(|| Mutex::new(HazeAnalysisCache::new(4)));

pub fn prepare_cpu_dehaze(image: &DynamicImage, adjustments: &mut AllAdjustments) {
    if !scene_dehaze_is_active(adjustments) {
        return;
    }
    let (width, height) = image.dimensions();
    let digest = blake3::hash(image.as_bytes());
    let fingerprint = u64::from_le_bytes(digest.as_bytes()[..8].try_into().unwrap());
    let identity = HazeAnalysisIdentityV1::new(fingerprint, fingerprint, 0, width, height);
    let (analysis, _) = CPU_HAZE_ANALYSIS_CACHE
        .lock()
        .unwrap()
        .get_or_analyze(image, identity);
    apply_analysis_to_adjustments(&analysis, adjustments);
}

pub fn analyze_haze(image: &DynamicImage, identity: HazeAnalysisIdentityV1) -> HazeAnalysisPlanV1 {
    let rgba = image.to_rgba32f();
    let (width, height) = rgba.dimensions();
    let stride = (((u64::from(width) * u64::from(height)) as f64 / MAX_ANALYSIS_SAMPLES as f64)
        .sqrt()
        .ceil() as u32)
        .max(1);
    let mut samples = Vec::with_capacity(
        ((width / stride + 1) as usize * (height / stride + 1) as usize).min(MAX_ANALYSIS_SAMPLES),
    );
    let mut saw_non_finite = false;
    for y in (0..height).step_by(stride as usize) {
        for x in (0..width).step_by(stride as usize) {
            let pixel = rgba.get_pixel(x, y).0;
            let rgb = [pixel[0], pixel[1], pixel[2]];
            if !rgb.iter().all(|value| value.is_finite()) {
                saw_non_finite = true;
                continue;
            }
            let min_channel = rgb[0].min(rgb[1]).min(rgb[2]);
            let max_channel = rgb[0].max(rgb[1]).max(rgb[2]);
            let luma = scene_luma(rgb);
            let chroma = (max_channel - min_channel) / max_channel.abs().max(0.05);
            let right = rgba
                .get_pixel((x + stride).min(width.saturating_sub(1)), y)
                .0;
            let below = rgba
                .get_pixel(x, (y + stride).min(height.saturating_sub(1)))
                .0;
            let texture = (scene_luma([right[0], right[1], right[2]]) - luma)
                .abs()
                .max((scene_luma([below[0], below[1], below[2]]) - luma).abs());
            let unclipped = 1.0 - smoothstep(1.0, 2.0, max_channel);
            let low_texture = 1.0 - smoothstep(0.01, 0.12, texture);
            let score =
                luma.max(0.0) * (1.0 - chroma.clamp(0.0, 1.0)).powi(2) * unclipped * low_texture;
            samples.push((rgb, score));
        }
    }

    samples.sort_by(|left, right| right.1.total_cmp(&left.1));
    let eligible_candidates = samples.iter().take_while(|sample| sample.1 > 0.0).count();
    let candidate_count = (samples.len() / 50).clamp(1, 512).min(eligible_candidates);
    let candidates = &samples[..candidate_count];
    let mut atmospheric_light = [1.0; 3];
    if !candidates.is_empty() {
        for (channel, atmosphere_channel) in atmospheric_light.iter_mut().enumerate() {
            let mut values: Vec<f32> = candidates.iter().map(|sample| sample.0[channel]).collect();
            values.sort_by(f32::total_cmp);
            *atmosphere_channel = values[values.len() / 2].max(0.01);
        }
    }

    let atmosphere_luma = scene_luma(atmospheric_light).max(0.01);
    let dispersion = if candidates.is_empty() {
        1.0
    } else {
        candidates
            .iter()
            .map(|sample| {
                ((sample.0[0] - atmospheric_light[0]).abs()
                    + (sample.0[1] - atmospheric_light[1]).abs()
                    + (sample.0[2] - atmospheric_light[2]).abs())
                    / 3.0
            })
            .sum::<f32>()
            / candidates.len() as f32
    };
    let evidence = (candidates.len() as f32 / 16.0).clamp(0.0, 1.0);
    let candidate_confidence =
        (evidence * (1.0 - dispersion / (atmosphere_luma + 0.05))).clamp(0.0, 1.0);

    let mut transmissions: Vec<f32> = samples
        .iter()
        .map(|sample| estimate_transmission(sample.0, atmospheric_light, TRANSMISSION_FLOOR))
        .collect();
    transmissions.sort_by(f32::total_cmp);
    let transmission_percentiles =
        [0.05, 0.25, 0.5, 0.75, 0.95].map(|quantile| percentile(&transmissions, quantile));
    let haze_fraction = if transmissions.is_empty() {
        0.0
    } else {
        transmissions.iter().filter(|value| **value < 0.85).count() as f32
            / transmissions.len() as f32
    };
    // Clear-air and ambiguous scenes must abstain instead of applying a minimum-strength guess.
    let haze_evidence = smoothstep(0.08, 0.35, haze_fraction);
    let measured_confidence = candidate_confidence * haze_evidence;
    let confidence = if measured_confidence < 0.35 {
        0.0
    } else {
        measured_confidence
    };
    let mut warning_codes = Vec::new();
    if samples.len() < 16 {
        warning_codes.push(HazeWarningCode::InsufficientEvidence);
    }
    if confidence < 0.35 {
        warning_codes.push(HazeWarningCode::LowConfidence);
    }
    if saw_non_finite {
        warning_codes.push(HazeWarningCode::NonFiniteInput);
    }
    HazeAnalysisPlanV1 {
        identity,
        atmospheric_light,
        atmospheric_light_confidence: confidence,
        haze_fraction,
        transmission_percentiles,
        sampled_pixels: samples.len().try_into().unwrap_or(u32::MAX),
        warning_codes,
    }
}

pub fn estimate_transmission(color: [f32; 3], atmospheric_light: [f32; 3], floor: f32) -> f32 {
    if !color
        .iter()
        .chain(atmospheric_light.iter())
        .all(|value| value.is_finite())
    {
        return 1.0;
    }
    let normalized_dark = (color[0] / atmospheric_light[0].max(0.01))
        .min(color[1] / atmospheric_light[1].max(0.01))
        .min(color[2] / atmospheric_light[2].max(0.01));
    (1.0 - HAZE_STRENGTH * normalized_dark.max(0.0)).clamp(floor.clamp(0.01, 1.0), 1.0)
}

#[cfg(test)]
fn apply_atmosphere_model(
    color: [f32; 3],
    atmospheric_light: [f32; 3],
    transmission: f32,
    amount: f32,
) -> [f32; 3] {
    if amount == 0.0 {
        return color;
    }
    let strength = amount.abs().clamp(0.0, 1.0);
    let effective_transmission = 1.0 + (transmission.clamp(0.01, 1.0) - 1.0) * strength;
    if amount > 0.0 {
        std::array::from_fn(|channel| {
            (color[channel] - atmospheric_light[channel]) / effective_transmission
                + atmospheric_light[channel]
        })
    } else {
        std::array::from_fn(|channel| {
            color[channel] * effective_transmission
                + atmospheric_light[channel] * (1.0 - effective_transmission)
        })
    }
}

#[derive(Debug)]
pub struct HazeAnalysisCache {
    capacity: usize,
    entries: VecDeque<(HazeAnalysisIdentityV1, Arc<HazeAnalysisPlanV1>)>,
    hits: u64,
    misses: u64,
}

impl HazeAnalysisCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            entries: VecDeque::new(),
            hits: 0,
            misses: 0,
        }
    }

    #[cfg(test)]
    pub fn counters(&self) -> (u64, u64) {
        (self.hits, self.misses)
    }

    pub fn get_or_analyze(
        &mut self,
        image: &DynamicImage,
        identity: HazeAnalysisIdentityV1,
    ) -> (Arc<HazeAnalysisPlanV1>, bool) {
        if let Some(index) = self.entries.iter().position(|entry| entry.0 == identity) {
            self.hits += 1;
            let entry = self.entries.remove(index).unwrap();
            let result = Arc::clone(&entry.1);
            self.entries.push_front(entry);
            return (result, true);
        }
        self.misses += 1;
        let result = Arc::new(analyze_haze(image, identity));
        self.entries.push_front((identity, Arc::clone(&result)));
        self.entries.truncate(self.capacity);
        (result, false)
    }
}

fn scene_luma(color: [f32; 3]) -> f32 {
    // ACES AP1 luminance coefficients; haze analysis runs in the scene working domain.
    0.272_228_72 * color[0] + 0.674_081_74 * color[1] + 0.053_689_52 * color[2]
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn percentile(values: &[f32], quantile: f32) -> f32 {
    if values.is_empty() {
        return 1.0;
    }
    let index = ((values.len() - 1) as f32 * quantile).round() as usize;
    values[index]
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, ImageBuffer, Rgba};

    use super::*;

    fn identity(revision: u64) -> HazeAnalysisIdentityV1 {
        HazeAnalysisIdentityV1::new(revision, 2, 3, 32, 16)
    }

    #[test]
    fn zero_amount_is_bit_exact_for_negative_and_over_range_scene_values() {
        let color = [-0.12, 0.5, 2.4];
        assert_eq!(
            apply_atmosphere_model(color, [0.8, 0.9, 1.1], 0.2, 0.0),
            color
        );
    }

    #[test]
    fn synthetic_haze_removal_recovers_radiance_and_negative_amount_adds_the_same_atmosphere() {
        let radiance = [0.12, 0.31, 0.72];
        let atmosphere = [0.86, 0.91, 1.04];
        let transmission = 0.37;
        let observed = apply_atmosphere_model(radiance, atmosphere, transmission, -1.0);
        let recovered = apply_atmosphere_model(observed, atmosphere, transmission, 1.0);
        for channel in 0..3 {
            assert!((recovered[channel] - radiance[channel]).abs() < 1e-6);
        }
    }

    #[test]
    fn analysis_estimates_source_atmosphere_and_transmission_without_a_fixed_color() {
        let atmosphere = [0.78, 0.86, 1.08];
        let image = ImageBuffer::from_fn(32, 16, |x, y| {
            let clean = if y < 4 {
                atmosphere
            } else {
                [0.04 + x as f32 / 160.0, 0.08, 0.12]
            };
            let transmission = if y < 4 { 0.05 } else { 0.35 + y as f32 / 40.0 };
            let observed = apply_atmosphere_model(clean, atmosphere, transmission, -1.0);
            Rgba([observed[0], observed[1], observed[2], 1.0])
        });
        let plan = analyze_haze(&DynamicImage::ImageRgba32F(image), identity(1));
        for (actual, expected) in plan.atmospheric_light.iter().zip(atmosphere) {
            assert!((*actual - expected).abs() < 0.05);
        }
        assert!(plan.atmospheric_light_confidence > 0.5);
        assert!(plan.haze_fraction > 0.25);
        assert_eq!(plan.identity, identity(1));
    }

    #[test]
    fn cache_identity_reuses_analysis_across_amount_only_compilation_and_invalidates_source_changes()
     {
        let image =
            DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(32, 16, Rgba([0.5, 0.6, 0.7, 1.0])));
        let mut cache = HazeAnalysisCache::new(2);
        let (first, first_hit) = cache.get_or_analyze(&image, identity(1));
        let (second, second_hit) = cache.get_or_analyze(&image, identity(1));
        assert!(!first_hit);
        assert!(second_hit);
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(cache.counters(), (1, 1));

        let low = compile_dehaze_plan(
            &first,
            DehazeSettingsV1 {
                amount: 0.2,
                ..Default::default()
            },
        );
        let high = compile_dehaze_plan(
            &first,
            DehazeSettingsV1 {
                amount: 0.8,
                ..Default::default()
            },
        );
        assert_eq!(low.analysis_identity, high.analysis_identity);
        assert_ne!(low.fingerprint, high.fingerprint);

        let (_, changed_source_hit) = cache.get_or_analyze(&image, identity(2));
        assert!(!changed_source_hit);
        assert_eq!(cache.counters(), (1, 2));
    }

    #[test]
    fn clear_air_and_invalid_samples_abstain_instead_of_forcing_a_dehaze_guess() {
        let clear = ImageBuffer::from_fn(32, 16, |x, y| {
            let checker = if (x + y) % 2 == 0 { 0.0 } else { 1.0 };
            Rgba([0.02 + checker * 0.7, 0.03 + checker * 0.15, 0.04, 1.0])
        });
        let plan = analyze_haze(&DynamicImage::ImageRgba32F(clear), identity(4));
        assert!(plan.atmospheric_light_confidence < 0.1, "{plan:?}");
        assert!(plan.warning_codes.contains(&HazeWarningCode::LowConfidence));
        assert_eq!(
            estimate_transmission([f32::NAN, 0.2, 0.3], [1.0; 3], 0.08),
            1.0
        );
        assert_eq!(
            estimate_transmission([-0.5, -0.2, -0.1], [1.0; 3], 0.08),
            1.0
        );
    }

    #[test]
    fn render_fingerprint_includes_analysis_evidence_not_only_source_identity() {
        let image =
            DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(32, 16, Rgba([0.5, 0.6, 0.7, 1.0])));
        let analysis = analyze_haze(&image, identity(7));
        let first = compile_dehaze_plan(&analysis, DehazeSettingsV1::default());
        let mut changed = analysis;
        changed.atmospheric_light_confidence =
            (changed.atmospheric_light_confidence + 0.25).min(1.0);
        let second = compile_dehaze_plan(&changed, DehazeSettingsV1::default());
        assert_ne!(first.fingerprint, second.fingerprint);
    }

    #[test]
    fn source_analysis_is_opt_in_for_scene_graph_v2_and_legacy_never_builds_it() {
        let mut adjustments = AllAdjustments::default();
        adjustments.global.dehaze = 0.1;
        adjustments.global.edit_graph_version = 1.0;
        assert!(!scene_dehaze_is_active(&adjustments));
        adjustments.global.edit_graph_version = 2.0;
        assert!(scene_dehaze_is_active(&adjustments));
    }
}
