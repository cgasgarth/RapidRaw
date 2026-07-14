use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};

use crate::adjustments::abi::{PerceptualGradingGpuRange, PerceptualGradingGpuSettings};

pub const PERCEPTUAL_GRADING_IMPLEMENTATION_VERSION: u32 = 1;
const MIDDLE_GREY: f32 = 0.18;
const AP1_LUMA: [f32; 3] = [0.272_228_72, 0.674_081_74, 0.053_689_52];

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GradingRangeSettingsV1 {
    pub brilliance: f32,
    pub chroma: f32,
    pub hue_degrees: f32,
    pub luminance_ev: f32,
    pub saturation: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PerceptualColorModelV1 {
    OklabD65FromAcescgV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PerceptualGradingSettingsV1 {
    pub balance: f32,
    pub blending: f32,
    pub falloff: f32,
    pub global: GradingRangeSettingsV1,
    pub highlight_fulcrum_ev: f32,
    pub highlights: GradingRangeSettingsV1,
    pub midtones: GradingRangeSettingsV1,
    pub neutral_protection: f32,
    pub perceptual_model: PerceptualColorModelV1,
    pub shadow_fulcrum_ev: f32,
    pub shadows: GradingRangeSettingsV1,
    pub skin_protection: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PerceptualGradingValidationError {
    Fulcrums,
    GlobalControl,
    RangeControl,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PerceptualGradingPlanV1 {
    pub fingerprint: u64,
    pub implementation_version: u32,
    pub settings: PerceptualGradingSettingsV1,
}

impl PerceptualGradingPlanV1 {
    pub fn compile(
        settings: PerceptualGradingSettingsV1,
    ) -> Result<Self, PerceptualGradingValidationError> {
        validate(&settings)?;
        let fingerprint = fingerprint(&settings);
        Ok(Self {
            fingerprint,
            implementation_version: PERCEPTUAL_GRADING_IMPLEMENTATION_VERSION,
            settings,
        })
    }

    pub fn is_identity(&self) -> bool {
        [
            self.settings.shadows,
            self.settings.midtones,
            self.settings.highlights,
            self.settings.global,
        ]
        .iter()
        .all(range_is_identity)
    }

    pub fn gpu_settings(&self) -> PerceptualGradingGpuSettings {
        PerceptualGradingGpuSettings {
            shadows: gpu_range(self.settings.shadows),
            midtones: gpu_range(self.settings.midtones),
            highlights: gpu_range(self.settings.highlights),
            global: gpu_range(self.settings.global),
            range: [
                self.settings.shadow_fulcrum_ev,
                self.settings.highlight_fulcrum_ev,
                self.settings.falloff,
                self.settings.balance,
            ],
            policy: [
                self.settings.blending,
                self.settings.neutral_protection,
                self.settings.skin_protection,
                1.0,
            ],
        }
    }

    #[cfg(test)]
    pub fn apply_rgb(&self, rgb: [f32; 3]) -> [f32; 3] {
        if self.is_identity() {
            rgb
        } else {
            apply_settings(rgb, &self.settings)
        }
    }
}

pub fn apply_gpu_settings(rgb: [f32; 3], gpu: &PerceptualGradingGpuSettings) -> [f32; 3] {
    if gpu.policy[3] <= 0.5 || !rgb.iter().all(|value| value.is_finite()) {
        return rgb;
    }
    let settings = settings_from_gpu(gpu);
    apply_settings(rgb, &settings)
}

fn apply_settings(rgb: [f32; 3], settings: &PerceptualGradingSettingsV1) -> [f32; 3] {
    if !rgb.iter().all(|value| value.is_finite()) {
        return rgb;
    }
    let ev = scene_exposure_ev(rgb);
    let weights = range_weights(ev, settings);
    if has_only_luminance_controls(settings) {
        let luminance_ev = settings.shadows.luminance_ev * weights[0]
            + settings.midtones.luminance_ev * weights[1]
            + settings.highlights.luminance_ev * weights[2]
            + settings.global.luminance_ev;
        return rgb.map(|channel| channel * 2.0_f32.powf(luminance_ev));
    }
    let mut lab = linear_srgb_to_oklab(mul3(AP1_TO_LINEAR_SRGB_D65, rgb));
    for (range, weight) in [settings.shadows, settings.midtones, settings.highlights]
        .into_iter()
        .zip(weights)
    {
        lab = apply_range(lab, range, weight, settings);
    }
    lab = apply_range(lab, settings.global, 1.0, settings);
    mul3(LINEAR_SRGB_D65_TO_AP1, oklab_to_linear_srgb(lab))
}

fn gpu_range(settings: GradingRangeSettingsV1) -> PerceptualGradingGpuRange {
    PerceptualGradingGpuRange {
        color: [
            settings.hue_degrees,
            settings.chroma,
            settings.saturation,
            settings.brilliance,
        ],
        tone: [settings.luminance_ev, 0.0, 0.0, 0.0],
    }
}

fn range_from_gpu(range: PerceptualGradingGpuRange) -> GradingRangeSettingsV1 {
    GradingRangeSettingsV1 {
        hue_degrees: range.color[0],
        chroma: range.color[1],
        saturation: range.color[2],
        brilliance: range.color[3],
        luminance_ev: range.tone[0],
    }
}

fn settings_from_gpu(gpu: &PerceptualGradingGpuSettings) -> PerceptualGradingSettingsV1 {
    PerceptualGradingSettingsV1 {
        shadows: range_from_gpu(gpu.shadows),
        midtones: range_from_gpu(gpu.midtones),
        highlights: range_from_gpu(gpu.highlights),
        global: range_from_gpu(gpu.global),
        shadow_fulcrum_ev: gpu.range[0],
        highlight_fulcrum_ev: gpu.range[1],
        falloff: gpu.range[2],
        balance: gpu.range[3],
        blending: gpu.policy[0],
        neutral_protection: gpu.policy[1],
        skin_protection: gpu.policy[2],
        perceptual_model: PerceptualColorModelV1::OklabD65FromAcescgV1,
    }
}

pub fn range_weights(ev: f32, settings: &PerceptualGradingSettingsV1) -> [f32; 3] {
    let shift = settings.balance * 2.0;
    let width = settings.falloff * (0.5 + settings.blending * 1.5);
    let shadow = 1.0
        - smoothstep(
            settings.shadow_fulcrum_ev + shift - width,
            settings.shadow_fulcrum_ev + shift + width,
            ev,
        );
    let highlight = smoothstep(
        settings.highlight_fulcrum_ev + shift - width,
        settings.highlight_fulcrum_ev + shift + width,
        ev,
    );
    let midtone = (1.0 - shadow - highlight).max(0.0);
    let total = shadow + midtone + highlight;
    if total <= f32::EPSILON {
        [0.0, 1.0, 0.0]
    } else {
        [shadow / total, midtone / total, highlight / total]
    }
}

fn validate(
    settings: &PerceptualGradingSettingsV1,
) -> Result<(), PerceptualGradingValidationError> {
    if !settings.shadow_fulcrum_ev.is_finite()
        || !settings.highlight_fulcrum_ev.is_finite()
        || settings.shadow_fulcrum_ev >= settings.highlight_fulcrum_ev
        || !(-12.0..=4.0).contains(&settings.shadow_fulcrum_ev)
        || !(-4.0..=12.0).contains(&settings.highlight_fulcrum_ev)
    {
        return Err(PerceptualGradingValidationError::Fulcrums);
    }
    if !(-1.0..=1.0).contains(&settings.balance)
        || !unit(settings.blending)
        || !settings.falloff.is_finite()
        || !(0.1..=4.0).contains(&settings.falloff)
        || !unit(settings.neutral_protection)
        || !unit(settings.skin_protection)
    {
        return Err(PerceptualGradingValidationError::GlobalControl);
    }
    if [
        settings.shadows,
        settings.midtones,
        settings.highlights,
        settings.global,
    ]
    .iter()
    .any(|range| {
        !range.hue_degrees.is_finite()
            || !(-360.0..=360.0).contains(&range.hue_degrees)
            || !bounded(range.chroma, 1.0)
            || !bounded(range.saturation, 2.0)
            || !bounded(range.brilliance, 1.0)
            || !bounded(range.luminance_ev, 4.0)
    }) {
        return Err(PerceptualGradingValidationError::RangeControl);
    }
    Ok(())
}

fn apply_range(
    mut lab: [f32; 3],
    range: GradingRangeSettingsV1,
    weight: f32,
    settings: &PerceptualGradingSettingsV1,
) -> [f32; 3] {
    if weight <= f32::EPSILON || range_is_identity(&range) {
        return lab;
    }
    let chroma = lab[1].hypot(lab[2]);
    let hue = lab[2].atan2(lab[1]);
    let neutral_guard = 1.0 - settings.neutral_protection * (-chroma / 0.035).exp();
    let skin_distance = circular_distance_degrees(hue.to_degrees(), 50.0);
    let skin_guard = 1.0 - settings.skin_protection * (1.0 - smoothstep(20.0, 65.0, skin_distance));
    let color_weight = weight * neutral_guard * skin_guard;
    let rotated_hue = hue + canonical_hue_degrees(range.hue_degrees).to_radians() * color_weight;
    let saturated = chroma * 2.0_f32.powf(range.saturation * color_weight);
    let target_chroma = (saturated + range.chroma * 0.12 * color_weight).max(0.0);
    lab[0] *= 2.0_f32.powf(range.luminance_ev * weight / 3.0);
    lab[0] += range.brilliance * target_chroma * weight * 0.22;
    let brilliant_chroma = target_chroma * (1.0 + range.brilliance * weight * 0.18).max(0.0);
    lab[1] = brilliant_chroma * rotated_hue.cos();
    lab[2] = brilliant_chroma * rotated_hue.sin();
    lab
}

fn scene_exposure_ev(rgb: [f32; 3]) -> f32 {
    let luma = (rgb[0] * AP1_LUMA[0] + rgb[1] * AP1_LUMA[1] + rgb[2] * AP1_LUMA[2]).max(1e-8);
    (luma / MIDDLE_GREY).log2().clamp(-24.0, 24.0)
}

fn range_is_identity(range: &GradingRangeSettingsV1) -> bool {
    canonical_hue_degrees(range.hue_degrees).abs() <= f32::EPSILON
        && range.chroma.abs() <= f32::EPSILON
        && range.saturation.abs() <= f32::EPSILON
        && range.brilliance.abs() <= f32::EPSILON
        && range.luminance_ev.abs() <= f32::EPSILON
}

fn has_only_luminance_controls(settings: &PerceptualGradingSettingsV1) -> bool {
    [
        settings.shadows,
        settings.midtones,
        settings.highlights,
        settings.global,
    ]
    .iter()
    .all(|range| {
        canonical_hue_degrees(range.hue_degrees).abs() <= f32::EPSILON
            && range.chroma.abs() <= f32::EPSILON
            && range.saturation.abs() <= f32::EPSILON
            && range.brilliance.abs() <= f32::EPSILON
    })
}

fn canonical_hue_degrees(degrees: f32) -> f32 {
    (degrees + 180.0).rem_euclid(360.0) - 180.0
}

fn unit(value: f32) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn bounded(value: f32, limit: f32) -> bool {
    value.is_finite() && (-limit..=limit).contains(&value)
}

fn smoothstep(low: f32, high: f32, value: f32) -> f32 {
    let t = ((value - low) / (high - low)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn circular_distance_degrees(left: f32, right: f32) -> f32 {
    let distance = (left - right).abs() % 360.0;
    distance.min(360.0 - distance)
}

fn fingerprint(settings: &PerceptualGradingSettingsV1) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    PERCEPTUAL_GRADING_IMPLEMENTATION_VERSION.hash(&mut hasher);
    serde_json::to_string(settings)
        .expect("perceptual grading settings serialize")
        .hash(&mut hasher);
    hasher.finish()
}

fn mul3(matrix: [[f32; 3]; 3], value: [f32; 3]) -> [f32; 3] {
    matrix.map(|row| row[0] * value[0] + row[1] * value[1] + row[2] * value[2])
}

fn linear_srgb_to_oklab(rgb: [f32; 3]) -> [f32; 3] {
    let l = (0.412_221_46 * rgb[0] + 0.536_332_55 * rgb[1] + 0.051_445_995 * rgb[2]).cbrt();
    let m = (0.211_903_5 * rgb[0] + 0.680_699_5 * rgb[1] + 0.107_396_96 * rgb[2]).cbrt();
    let s = (0.088_302_46 * rgb[0] + 0.281_718_85 * rgb[1] + 0.629_978_7 * rgb[2]).cbrt();
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

fn oklab_to_linear_srgb(lab: [f32; 3]) -> [f32; 3] {
    let l = (lab[0] + 0.396_337_78 * lab[1] + 0.215_803_76 * lab[2]).powi(3);
    let m = (lab[0] - 0.105_561_346 * lab[1] - 0.063_854_17 * lab[2]).powi(3);
    let s = (lab[0] - 0.089_484_18 * lab[1] - 1.291_485_5 * lab[2]).powi(3);
    [
        4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s,
        -1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s,
        -0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s,
    ]
}

const AP1_TO_LINEAR_SRGB_D65: [[f32; 3]; 3] = [
    [1.705_051_5, -0.621_790_7, -0.083_258_4],
    [-0.130_257_1, 1.140_802_9, -0.010_548_5],
    [-0.024_003_3, -0.128_968_8, 1.152_971_7],
];
const LINEAR_SRGB_D65_TO_AP1: [[f32; 3]; 3] = [
    [0.613_132_4, 0.339_538, 0.047_416_7],
    [0.070_124_4, 0.916_394, 0.013_451_5],
    [0.020_587_7, 0.109_574_6, 0.869_785_4],
];

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> PerceptualGradingSettingsV1 {
        PerceptualGradingSettingsV1 {
            balance: 0.0,
            blending: 0.5,
            falloff: 1.0,
            global: GradingRangeSettingsV1::default(),
            highlight_fulcrum_ev: 2.0,
            highlights: GradingRangeSettingsV1::default(),
            midtones: GradingRangeSettingsV1::default(),
            neutral_protection: 0.75,
            perceptual_model: PerceptualColorModelV1::OklabD65FromAcescgV1,
            shadow_fulcrum_ev: -2.0,
            shadows: GradingRangeSettingsV1::default(),
            skin_protection: 0.0,
        }
    }

    #[test]
    fn range_weights_are_continuous_bounded_and_normalized() {
        let settings = settings();
        let mut previous = range_weights(-12.0, &settings);
        for step in -119..=120 {
            let current = range_weights(step as f32 / 10.0, &settings);
            assert!(current.iter().all(|weight| (0.0..=1.0).contains(weight)));
            assert!((current.iter().sum::<f32>() - 1.0).abs() < 1e-6);
            assert!(
                current
                    .iter()
                    .zip(previous)
                    .all(|(left, right)| (left - right).abs() < 0.2)
            );
            previous = current;
        }
    }

    #[test]
    fn zero_settings_are_exact_identity_and_round_trip_is_finite() {
        let plan = PerceptualGradingPlanV1::compile(settings()).unwrap();
        for rgb in [[0.18, 0.18, 0.18], [1.4, 0.2, 0.05], [-0.02, 0.3, 2.0]] {
            assert_eq!(plan.apply_rgb(rgb), rgb);
        }
    }

    #[test]
    fn luminance_only_keeps_neutral_axis_without_clamping_hdr() {
        let mut settings = settings();
        settings.global.luminance_ev = 1.0;
        let output = PerceptualGradingPlanV1::compile(settings)
            .unwrap()
            .apply_rgb([1.5; 3]);
        assert!((output[0] - output[1]).abs() < 2e-5);
        assert!((output[1] - output[2]).abs() < 2e-5);
        assert!(output[0] > 1.5);
    }

    #[test]
    fn chroma_saturation_and_brilliance_have_distinct_math() {
        let source = [0.55, 0.24, 0.12];
        let render = |field: &str| {
            let mut settings = settings();
            match field {
                "chroma" => settings.global.chroma = 0.5,
                "saturation" => settings.global.saturation = 0.5,
                "brilliance" => settings.global.brilliance = 0.5,
                _ => unreachable!(),
            }
            PerceptualGradingPlanV1::compile(settings)
                .unwrap()
                .apply_rgb(source)
        };
        assert_ne!(render("chroma"), render("saturation"));
        assert_ne!(render("saturation"), render("brilliance"));
    }

    #[test]
    fn strict_serialization_and_hue_wrap_are_stable() {
        let mut first = settings();
        first.global.hue_degrees = 360.0;
        let mut second = settings();
        second.global.hue_degrees = 0.0;
        let source = [0.2, 0.5, 0.8];
        let first = PerceptualGradingPlanV1::compile(first)
            .unwrap()
            .apply_rgb(source);
        let second = PerceptualGradingPlanV1::compile(second)
            .unwrap()
            .apply_rgb(source);
        assert!(
            first
                .iter()
                .zip(second)
                .all(|(left, right)| (left - right).abs() < 2e-5)
        );
        assert!(
            serde_json::from_value::<PerceptualGradingSettingsV1>(serde_json::json!({})).is_err()
        );
    }
}

#[cfg(all(test, feature = "tauri-test"))]
mod gpu_runtime_tests {
    use std::sync::Arc;

    use image::{DynamicImage, GrayImage, ImageBuffer, Luma, Rgba};
    use serde_json::json;
    use tauri::Manager;

    use crate::AppState;
    use crate::gpu_processing::{
        RenderRequest, acquire_gpu_test_lock, get_or_init_compute_gpu_context_for_tests,
        process_and_get_unclamped_dynamic_image,
    };

    fn grading_settings(hue: f32, chroma: f32, brilliance: f32) -> serde_json::Value {
        json!({
            "shadows": {"hueDegrees": hue + 160.0, "chroma": chroma, "saturation": 0.1, "brilliance": 0.0, "luminanceEv": -0.1},
            "midtones": {"hueDegrees": hue, "chroma": chroma * 0.5, "saturation": 0.25, "brilliance": brilliance, "luminanceEv": 0.0},
            "highlights": {"hueDegrees": hue - 35.0, "chroma": chroma * 0.7, "saturation": 0.0, "brilliance": brilliance * 0.5, "luminanceEv": 0.15},
            "global": {"hueDegrees": 8.0, "chroma": 0.02, "saturation": 0.05, "brilliance": 0.05, "luminanceEv": 0.0},
            "shadowFulcrumEv": -2.0,
            "highlightFulcrumEv": 2.0,
            "falloff": 1.1,
            "balance": 0.1,
            "blending": 0.65,
            "perceptualModel": "oklab_d65_from_acescg_v1",
            "neutralProtection": 0.55,
            "skinProtection": 0.25
        })
    }

    fn max_rgb_delta(left: &DynamicImage, right: &DynamicImage) -> f32 {
        left.to_rgba32f()
            .into_raw()
            .chunks_exact(4)
            .zip(right.to_rgba32f().into_raw().chunks_exact(4))
            .map(|(left, right)| {
                (0..3)
                    .map(|channel| (left[channel] - right[channel]).abs())
                    .fold(0.0_f32, f32::max)
            })
            .fold(0.0_f32, f32::max)
    }

    #[test]
    fn production_grading_matches_cpu_wgpu_preview_export_batch_and_local_mask() {
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(6, 4, |x, y| {
            let exposure = 2.0_f32.powf((x as f32 - 2.0) * 0.8 + y as f32 * 0.25);
            Rgba([0.42 * exposure, 0.19 * exposure, 0.08 * exposure, 0.76])
        }));
        let raw = json!({
            "rawEngineEditGraphVersion": 2,
            "perceptualGradingV1": grading_settings(38.0, 0.16, 0.25),
            "masks": [{
                "id": "local-grade",
                "name": "Local grade",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "blendMode": "normal",
                "adjustments": {"perceptualGradingV1": grading_settings(160.0, 0.22, -0.15)},
                "subMasks": []
            }]
        });
        let plan = crate::render_plan::compile_render_plan(
            &raw,
            crate::render_plan::CompileRenderPlanContext {
                revision: crate::render_plan::content_revision(&raw, 31, 32, 33),
                is_raw: true,
                tonemapper_override: Some(0),
            },
            None,
        )
        .expect("perceptual grading plan compiles");
        assert!(plan.adjustments.global.perceptual_grading.policy[3] > 0.5);
        assert_eq!(plan.adjustments.mask_count, 1);
        assert!(
            plan.adjustments.mask_adjustments[0]
                .perceptual_grading
                .policy[3]
                > 0.5
        );

        let mask: GrayImage = ImageBuffer::from_fn(6, 4, |x, _| Luma([u8::from(x < 3) * 255]));
        let cpu = crate::cpu_edit_graph::execute_cpu_edit_graph(
            &source,
            &plan.adjustments,
            std::slice::from_ref(&mask),
            None,
            &plan.edit_graph,
        )
        .expect("CPU perceptual grading render succeeds");

        let _gpu_test_guard = acquire_gpu_test_lock();
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");
        let render = |consumer: &str| {
            process_and_get_unclamped_dynamic_image(
                &context,
                &state,
                &source,
                crate::gpu_processing::PreGpuImageIdentity::for_test_source(&source, consumer),
                RenderRequest {
                    adjustments: plan.adjustments,
                    mask_bitmaps: std::slice::from_ref(&mask),
                    lut: None,
                    roi: None,
                    edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(
                        Arc::clone(&plan.edit_graph),
                    ),
                },
                consumer,
            )
            .expect("WGPU perceptual grading render succeeds")
        };
        let preview = render("perceptual_grading_preview");
        let export = render("perceptual_grading_export");
        let batch = render("perceptual_grading_batch");

        let parity_delta = max_rgb_delta(&cpu, &preview);
        assert!(
            parity_delta <= 0.012,
            "CPU/WGPU grading delta {parity_delta}"
        );
        assert!(max_rgb_delta(&preview, &export) <= 0.001);
        assert!(max_rgb_delta(&export, &batch) <= 0.001);
        assert!(preview.to_rgba32f().pixels().all(|pixel| {
            pixel.0.iter().all(|channel| channel.is_finite()) && (pixel[3] - 0.76).abs() <= 0.002
        }));
        assert!(
            preview
                .to_rgba32f()
                .pixels()
                .any(|pixel| pixel.0[..3].iter().any(|channel| *channel > 1.0)),
            "unclamped export path must preserve scene headroom"
        );
    }
}
