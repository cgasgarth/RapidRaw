use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};

pub const TONE_EQ_BANDS: usize = 9;
pub const TONE_EQUALIZER_IMPLEMENTATION_VERSION: u32 = 1;
pub const AP1_LUMINANCE: [f32; 3] = [0.272_228_72, 0.674_081_74, 0.053_689_52];
const BASE_BAND_CENTERS_EV: [f32; TONE_EQ_BANDS] =
    [-8.0, -6.0, -4.0, -2.0, 0.0, 2.0, 4.0, 6.0, 8.0];
const MIN_LUMINANCE: f32 = 1.0e-8;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToneEqualizerSettingsV1 {
    pub enabled: bool,
    pub band_ev: [f32; TONE_EQ_BANDS],
    pub pivot_ev: f32,
    pub range_ev: f32,
    pub detail_preservation: f32,
    pub edge_refinement: f32,
    pub smoothing_radius: f32,
    pub mask_exposure_compensation: f32,
    pub auto_placement: bool,
    pub selected_band: u32,
    pub preview_mode: u32,
}

impl Default for ToneEqualizerSettingsV1 {
    fn default() -> Self {
        Self {
            enabled: false,
            band_ev: [0.0; TONE_EQ_BANDS],
            pivot_ev: 0.0,
            range_ev: 16.0,
            detail_preservation: 0.65,
            edge_refinement: 2.0,
            smoothing_radius: 32.0,
            mask_exposure_compensation: 0.0,
            auto_placement: false,
            selected_band: 4,
            preview_mode: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BasicToneMacros {
    pub brightness: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToneEqualizerPlacementV1 {
    pub pivot_ev: f32,
    pub range_ev: f32,
    pub scene_black_ev: f32,
    pub scene_white_ev: f32,
    pub confidence: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToneEqualizerPickerSampleV1 {
    pub exposure_ev: f32,
    pub contributing_weights: [f32; TONE_EQ_BANDS],
    pub primary_band: u32,
}

#[derive(Clone, Debug)]
pub struct ToneEqualizerPlanV1 {
    pub settings: ToneEqualizerSettingsV1,
    pub compiled_band_ev: [f32; TONE_EQ_BANDS],
    pub fingerprint: u64,
    pub implementation_version: u32,
}

impl ToneEqualizerPlanV1 {
    pub fn compile(settings: ToneEqualizerSettingsV1, macros: BasicToneMacros) -> Self {
        let macro_bands = compile_basic_tone_macros(macros);
        let compiled_band_ev = std::array::from_fn(|index| {
            (if settings.enabled {
                settings.band_ev[index]
            } else {
                0.0
            } + macro_bands[index])
                .clamp(-4.0, 4.0)
        });
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        TONE_EQUALIZER_IMPLEMENTATION_VERSION.hash(&mut hasher);
        for value in compiled_band_ev.iter().chain(
            [
                settings.pivot_ev,
                settings.range_ev,
                settings.detail_preservation,
                settings.edge_refinement,
                settings.smoothing_radius,
                settings.mask_exposure_compensation,
            ]
            .iter(),
        ) {
            value.to_bits().hash(&mut hasher);
        }
        settings.enabled.hash(&mut hasher);
        settings.auto_placement.hash(&mut hasher);
        settings.selected_band.hash(&mut hasher);
        settings.preview_mode.hash(&mut hasher);
        Self {
            settings,
            compiled_band_ev,
            fingerprint: hasher.finish(),
            implementation_version: TONE_EQUALIZER_IMPLEMENTATION_VERSION,
        }
    }

    pub fn compensation_at_ev(&self, exposure_ev: f32) -> f32 {
        interpolate_bands(
            self.compiled_band_ev,
            exposure_ev,
            self.settings.pivot_ev,
            self.settings.range_ev,
        ) + self.settings.mask_exposure_compensation.clamp(-4.0, 4.0)
    }

    pub fn apply_rgb(
        &self,
        rgb: [f32; 3],
        coordinate_rgb: [f32; 3],
        guidance_rgb: [f32; 3],
        middle_grey: f32,
    ) -> [f32; 3] {
        debug_assert_eq!(
            self.implementation_version,
            TONE_EQUALIZER_IMPLEMENTATION_VERSION
        );
        debug_assert_ne!(self.fingerprint, 0);
        let luminance = scene_luminance(coordinate_rgb);
        let active = self
            .compiled_band_ev
            .iter()
            .any(|compensation| compensation.abs() > f32::EPSILON)
            || self.settings.mask_exposure_compensation.abs() > f32::EPSILON;
        if !active || !luminance.is_finite() || luminance <= MIN_LUMINANCE {
            return rgb;
        }
        let guidance_ev = edge_aware_exposure_ev(
            luminance,
            scene_luminance(guidance_rgb),
            middle_grey,
            self.settings.detail_preservation,
            self.settings.edge_refinement,
        );
        let scale = 2.0_f32.powf(self.compensation_at_ev(guidance_ev));
        rgb.map(|channel| channel * scale)
    }
}

pub fn scene_luminance(rgb: [f32; 3]) -> f32 {
    rgb[0] * AP1_LUMINANCE[0] + rgb[1] * AP1_LUMINANCE[1] + rgb[2] * AP1_LUMINANCE[2]
}

pub fn compile_basic_tone_macros(macros: BasicToneMacros) -> [f32; TONE_EQ_BANDS] {
    let mut bands = [0.0; TONE_EQ_BANDS];
    let supports = [
        [0.9, 0.65, 0.25, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0],
        [0.0, 0.1, 0.45, 1.0, 0.55, 0.1, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 0.1, 0.45, 1.0, 0.55, 0.1, 0.0],
        [0.0, 0.0, 0.0, 0.0, 0.0, 0.05, 0.25, 0.65, 0.9],
    ];
    let values = [
        macros.blacks,
        macros.shadows,
        macros.highlights,
        macros.whites,
    ];
    for (support, value) in supports.iter().zip(values) {
        for (band, weight) in bands.iter_mut().zip(support) {
            *band += value.clamp(-1.0, 1.0) * weight * 2.0;
        }
    }
    let contrast = macros.contrast.clamp(-1.0, 1.0);
    let contrast_shape = [-1.0, -0.85, -0.6, -0.3, 0.0, 0.3, 0.6, 0.85, 1.0];
    let brightness_shape = [0.05, 0.15, 0.4, 0.8, 1.0, 0.8, 0.4, 0.15, 0.05];
    for index in 0..TONE_EQ_BANDS {
        bands[index] += contrast * contrast_shape[index] * 1.25;
        bands[index] += macros.brightness.clamp(-5.0, 5.0) * brightness_shape[index];
    }
    bands
}

pub fn interpolate_bands(
    band_ev: [f32; TONE_EQ_BANDS],
    exposure_ev: f32,
    pivot_ev: f32,
    range_ev: f32,
) -> f32 {
    let weights = band_weights(exposure_ev, pivot_ev, range_ev);
    band_ev
        .iter()
        .zip(weights)
        .map(|(compensation, weight)| compensation * weight)
        .sum()
}

pub fn band_weights(exposure_ev: f32, pivot_ev: f32, range_ev: f32) -> [f32; TONE_EQ_BANDS] {
    let scale = range_ev.clamp(4.0, 24.0) / 16.0;
    let sigma = (2.0 * scale).max(0.5);
    let bounded_ev = exposure_ev.clamp(pivot_ev - 8.0 * scale, pivot_ev + 8.0 * scale);
    let unnormalized = BASE_BAND_CENTERS_EV.map(|center| {
        let distance = (bounded_ev - (pivot_ev + center * scale)) / sigma;
        (-0.5 * distance * distance).exp()
    });
    let total: f32 = unnormalized.iter().sum();
    if total > 0.0 {
        unnormalized.map(|weight| weight / total)
    } else {
        [0.0; TONE_EQ_BANDS]
    }
}

pub fn edge_aware_exposure_ev(
    source_luminance: f32,
    smoothed_luminance: f32,
    middle_grey: f32,
    detail_preservation: f32,
    edge_refinement: f32,
) -> f32 {
    let middle_grey = middle_grey.max(MIN_LUMINANCE);
    let source_ev = (source_luminance.max(MIN_LUMINANCE) / middle_grey).log2();
    let smoothed_ev = (smoothed_luminance.max(MIN_LUMINANCE) / middle_grey).log2();
    let edge_delta = (source_ev - smoothed_ev).abs();
    let edge_weight = 1.0 - (-edge_delta * edge_refinement.clamp(0.0, 8.0)).exp();
    let source_weight = detail_preservation.clamp(0.0, 1.0)
        + edge_weight * (1.0 - detail_preservation.clamp(0.0, 1.0));
    smoothed_ev + (source_ev - smoothed_ev) * source_weight
}

pub fn auto_place_from_luminance(
    luminance: &[f32],
    middle_grey: f32,
) -> Option<ToneEqualizerPlacementV1> {
    let mut ev: Vec<f32> = luminance
        .iter()
        .copied()
        .filter(|value| value.is_finite() && *value > MIN_LUMINANCE)
        .map(|value| (value / middle_grey.max(MIN_LUMINANCE)).log2())
        .collect();
    if ev.len() < 16 {
        return None;
    }
    ev.sort_by(f32::total_cmp);
    let percentile = |fraction: f32| ev[((ev.len() - 1) as f32 * fraction).round() as usize];
    let black = percentile(0.01);
    let white = percentile(0.99);
    let median = percentile(0.5);
    let span = (white - black).max(4.0);
    Some(ToneEqualizerPlacementV1 {
        pivot_ev: median.clamp(-8.0, 8.0),
        range_ev: span.clamp(4.0, 24.0),
        scene_black_ev: black,
        scene_white_ev: white,
        confidence: ((ev.len() as f32 / 4096.0).min(1.0)
            * ((white - black) / 8.0).clamp(0.25, 1.0)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(bands: [f32; TONE_EQ_BANDS]) -> ToneEqualizerPlanV1 {
        ToneEqualizerPlanV1::compile(
            ToneEqualizerSettingsV1 {
                enabled: true,
                band_ev: bands,
                ..Default::default()
            },
            BasicToneMacros {
                brightness: 0.0,
                contrast: 0.0,
                highlights: 0.0,
                shadows: 0.0,
                whites: 0.0,
                blacks: 0.0,
            },
        )
    }

    #[test]
    fn zero_bands_are_exact_identity_for_extended_scene_values() {
        let plan = plan([0.0; TONE_EQ_BANDS]);
        let input = [-0.05, 0.18, 2.0];
        assert_eq!(plan.apply_rgb(input, input, input, 0.18), input);
        assert_eq!(
            plan.apply_rgb([-1.0, -0.5, -0.25], [-1.0, -0.5, -0.25], [0.0; 3], 0.18,),
            [-1.0, -0.5, -0.25]
        );
    }

    #[test]
    fn interpolation_is_continuous_bounded_and_hits_an_ev_shift() {
        let plan = plan([1.0; TONE_EQ_BANDS]);
        let mut previous = plan.compensation_at_ev(-12.0);
        for step in -119..=120 {
            let current = plan.compensation_at_ev(step as f32 / 10.0);
            assert!((current - previous).abs() < 0.05);
            assert!((-4.0..=4.0).contains(&current));
            previous = current;
        }
        let output = plan.apply_rgb([0.18; 3], [0.18; 3], [0.18; 3], 0.18);
        assert!((output[0] - 0.36).abs() < 1.0e-5);
    }

    #[test]
    fn exposure_scaling_preserves_color_ratios_and_extended_scene_values() {
        let plan = plan([1.0; TONE_EQ_BANDS]);
        let input = [0.09, 0.36, 2.5];
        let output = plan.apply_rgb(input, [0.18; 3], [0.18; 3], 0.18);
        for channel in 0..3 {
            assert!((output[channel] - input[channel] * 2.0).abs() < 1.0e-5);
        }
        assert!(
            output[2] > 1.0,
            "scene highlights must not be output-clamped"
        );
        assert!((output[1] / output[0] - input[1] / input[0]).abs() < 1.0e-6);
    }

    #[test]
    fn band_weights_form_a_partition_of_unity_and_peak_at_zone_centers() {
        for range_ev in [4.0, 16.0, 24.0] {
            let scale = range_ev / 16.0;
            for (index, center) in BASE_BAND_CENTERS_EV.iter().enumerate() {
                let weights = band_weights(center * scale, 0.0, range_ev);
                let total: f32 = weights.iter().sum();
                assert!((total - 1.0).abs() < 1.0e-6, "weights={weights:?}");
                assert_eq!(
                    weights
                        .iter()
                        .enumerate()
                        .max_by(|left, right| left.1.total_cmp(right.1))
                        .map(|(band, _)| band),
                    Some(index)
                );
            }
        }
    }

    #[test]
    fn basic_macros_have_stable_zone_support() {
        let bands = compile_basic_tone_macros(BasicToneMacros {
            brightness: 0.0,
            contrast: 0.0,
            highlights: -1.0,
            shadows: 1.0,
            whites: 0.0,
            blacks: 0.0,
        });
        assert!((bands[3] - 1.8).abs() < 1.0e-6);
        assert!((bands[5] + 1.8).abs() < 1.0e-6);
        assert_eq!(bands[8], 0.0);
    }

    #[test]
    fn basic_macros_execute_without_enabling_advanced_bands() {
        let plan = ToneEqualizerPlanV1::compile(
            ToneEqualizerSettingsV1::default(),
            BasicToneMacros {
                brightness: 1.0,
                contrast: 0.0,
                highlights: 0.0,
                shadows: 0.0,
                whites: 0.0,
                blacks: 0.0,
            },
        );
        let output = plan.apply_rgb([0.18; 3], [0.18; 3], [0.18; 3], 0.18);
        let expected = 0.18 * 2.0_f32.powf(plan.compensation_at_ev(0.0));
        assert!((output[0] - expected).abs() < 1.0e-6, "output={output:?}");
        assert!(
            output[0] > 0.31,
            "brightness macro did not lift the midtone"
        );
    }

    #[test]
    fn edge_guidance_suppresses_cross_edge_halo_without_flattening_texture() {
        let source_ev = (0.02_f32 / 0.18).log2();
        let blurred_ev = (1.0_f32 / 0.18).log2();
        let guided = edge_aware_exposure_ev(0.02, 1.0, 0.18, 0.25, 3.0);
        assert!((guided - source_ev).abs() < (blurred_ev - source_ev).abs() * 0.05);
        let textured = edge_aware_exposure_ev(0.20, 0.18, 0.18, 0.25, 3.0);
        assert!(textured > 0.0);
        assert!(textured < (0.20_f32 / 0.18).log2());
    }

    #[test]
    fn robust_auto_placement_ignores_extreme_outliers() {
        let mut luminance = vec![0.045; 200];
        luminance.extend(vec![0.18; 600]);
        luminance.extend(vec![1.44; 200]);
        luminance.extend([1.0e-9, 10_000.0]);
        let placement = auto_place_from_luminance(&luminance, 0.18).unwrap();
        assert!(placement.pivot_ev.abs() < 0.01);
        assert!(placement.scene_white_ev < 4.0);
        assert!(placement.scene_black_ev > -3.0);
    }
}
