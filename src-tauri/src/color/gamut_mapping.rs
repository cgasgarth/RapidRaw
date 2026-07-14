#[cfg(test)]
pub(crate) const SRGB_OKLAB_CHROMA_REDUCE_V1: &str = "rawengine.gamut.srgb-oklab-chroma-reduce.v1";
#[cfg(test)]
pub(crate) const SRGB_OKLAB_CHROMA_REDUCE_V2: &str = "rawengine.gamut.srgb-oklab-chroma-reduce.v2";
#[cfg(test)]
pub(crate) const SRGB_OKLAB_CHROMA_REDUCE_V3: &str = "rawengine.gamut.srgb-oklab-chroma-reduce.v3";
pub(crate) const SRGB_OKLAB_CHROMA_REDUCE_V4: &str = "rawengine.gamut.srgb-oklab-chroma-reduce.v4";
pub(crate) const ACTIVE_SRGB_OKLAB_CHROMA_REDUCE: &str = SRGB_OKLAB_CHROMA_REDUCE_V4;
pub(crate) const SHARED_OKLAB_CUSP_COMPRESS_V1: &str =
    "rawengine.gamut.shared-oklab-cusp-compress.v1";

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{Arc, LazyLock};

const EPSILON: f32 = 1.0e-6;
#[cfg(test)]
const CHROMA_MONOTONIC_EPSILON: f32 = 1.0e-3;
const CHROMA_SAFE_CLIP_FALLBACK_RATIO: f32 = 0.8;

const SRGB_TO_XYZ_D65: [[f64; 3]; 3] = [
    [0.412_390_799_3, 0.357_584_339_4, 0.180_480_788_4],
    [0.212_639_005_9, 0.715_168_678_8, 0.072_192_315_4],
    [0.019_330_818_7, 0.119_194_779_8, 0.950_532_152_2],
];
const XYZ_D65_TO_SRGB: [[f64; 3]; 3] = [
    [3.240_969_941_9, -1.537_383_177_6, -0.498_610_760_3],
    [-0.969_243_636_3, 1.875_967_501_5, 0.041_555_057_4],
    [0.055_630_079_7, -0.203_976_958_9, 1.056_971_514_2],
];
const DISPLAY_P3_TO_XYZ_D65: [[f64; 3]; 3] = [
    [0.486_570_948_6, 0.265_667_693_2, 0.198_217_285_2],
    [0.228_974_564_1, 0.691_738_521_8, 0.079_286_914_1],
    [0.0, 0.045_113_381_9, 1.043_944_368_9],
];
const XYZ_D65_TO_DISPLAY_P3: [[f64; 3]; 3] = [
    [2.493_496_911_9, -0.931_383_617_9, -0.402_710_784_5],
    [-0.829_488_969_6, 1.762_664_060_3, 0.023_624_685_8],
    [0.035_845_830_2, -0.076_172_389_3, 0.956_884_524_0],
];
const ADOBE_RGB_TO_XYZ_D65: [[f64; 3]; 3] = [
    [0.576_730_9, 0.185_554_0, 0.188_185_2],
    [0.297_376_9, 0.627_349_1, 0.075_274_1],
    [0.027_034_3, 0.070_687_2, 0.991_108_5],
];
const XYZ_D65_TO_ADOBE_RGB: [[f64; 3]; 3] = [
    [2.041_369_0, -0.564_946_4, -0.344_694_4],
    [-0.969_266_0, 1.876_010_8, 0.041_556_0],
    [0.013_447_4, -0.118_389_7, 1.015_409_6],
];
const REC2020_TO_XYZ_D65: [[f64; 3]; 3] = [
    [0.636_958_048_3, 0.144_616_903_6, 0.168_880_975_2],
    [0.262_700_212_0, 0.677_998_071_5, 0.059_301_716_5],
    [0.0, 0.028_072_693_0, 1.060_985_057_7],
];
const XYZ_D65_TO_REC2020: [[f64; 3]; 3] = [
    [1.716_651_188_0, -0.355_670_783_8, -0.253_366_281_4],
    [-0.666_684_351_8, 1.616_481_236_6, 0.015_768_545_8],
    [0.017_639_857_4, -0.042_770_613_3, 0.942_103_121_2],
];
const PROPHOTO_TO_XYZ_D50: [[f64; 3]; 3] = [
    [0.797_674_9, 0.135_191_7, 0.031_353_4],
    [0.288_040_2, 0.711_874_1, 0.000_085_7],
    [0.0, 0.0, 0.825_210_0],
];
const XYZ_D50_TO_PROPHOTO: [[f64; 3]; 3] = [
    [1.345_943_3, -0.255_607_5, -0.051_111_8],
    [-0.544_598_9, 1.508_167_3, 0.020_535_1],
    [0.0, 0.0, 1.211_812_8],
];
const D50_TO_D65: [[f64; 3]; 3] = [
    [0.955_473_4, -0.023_098_5, 0.063_259_3],
    [-0.028_369_7, 1.009_995_5, 0.021_041_4],
    [0.012_314_0, -0.020_507_7, 1.330_365_9],
];
const D65_TO_D50: [[f64; 3]; 3] = [
    [1.047_929_8, 0.022_946_8, -0.050_192_2],
    [0.029_627_8, 0.990_434_5, -0.017_073_8],
    [-0.009_243_0, 0.015_055_2, 0.751_874_3],
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GamutTarget {
    Srgb,
    DisplayP3,
    #[serde(rename = "adobe_rgb_1998")]
    AdobeRgb1998,
    #[serde(rename = "prophoto_rgb")]
    ProPhotoRgb,
    Rec2020,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GamutPlanMode {
    WorkingGuard,
    ViewDisplay,
    Output,
    Warning,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GamutRenderingIntent {
    Perceptual,
    RelativeColorimetric,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GamutTargetIdentity {
    pub(crate) target_id: GamutTarget,
    pub(crate) primaries_xy: [[f64; 2]; 3],
    pub(crate) white_xy: [f64; 2],
    pub(crate) transfer: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) profile_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) absolute_white_nits: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GamutCompressionParameters {
    pub(crate) onset_ratio: f64,
    pub(crate) knee_softness: f64,
    pub(crate) near_neutral_chroma: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GamutBoundaryLut {
    pub(crate) fingerprint: String,
    pub(crate) hue_samples: u16,
    pub(crate) lightness_samples: u16,
    #[serde(skip)]
    maximum_chroma: Arc<[f32]>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompiledGamutPlanV1 {
    pub(crate) target: GamutTargetIdentity,
    #[serde(skip)]
    pub(crate) target_id: GamutTarget,
    pub(crate) mode: GamutPlanMode,
    pub(crate) perceptual_model: &'static str,
    pub(crate) implementation_id: &'static str,
    pub(crate) compression: GamutCompressionParameters,
    pub(crate) boundary: Arc<GamutBoundaryLut>,
    pub(crate) rendering_intent: GamutRenderingIntent,
    pub(crate) black_point_compensation: bool,
    pub(crate) fingerprint: String,
    pub(crate) implementation_version: u32,
    #[serde(skip)]
    target_to_xyz_d65: [[f64; 3]; 3],
    #[serde(skip)]
    xyz_d65_to_target: [[f64; 3]; 3],
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GamutMapReceipt {
    pub(crate) input_was_out_of_gamut: bool,
    pub(crate) compressed: bool,
    pub(crate) hard_clipped: bool,
    pub(crate) maximum_boundary_excess: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GamutMapResult {
    pub(crate) linear_rgb: [f64; 3],
    pub(crate) receipt: GamutMapReceipt,
}

static FIXED_GAMUT_PLANS: LazyLock<Vec<CompiledGamutPlanV1>> = LazyLock::new(|| {
    [
        GamutTarget::Srgb,
        GamutTarget::DisplayP3,
        GamutTarget::AdobeRgb1998,
        GamutTarget::ProPhotoRgb,
        GamutTarget::Rec2020,
    ]
    .into_iter()
    .flat_map(|target| {
        [
            GamutPlanMode::WorkingGuard,
            GamutPlanMode::ViewDisplay,
            GamutPlanMode::Output,
            GamutPlanMode::Warning,
        ]
        .into_iter()
        .flat_map(move |mode| {
            [
                GamutRenderingIntent::Perceptual,
                GamutRenderingIntent::RelativeColorimetric,
            ]
            .into_iter()
            .map(move |intent| compile_fixed_plan(target, mode, intent, false))
        })
    })
    .collect()
});

static FIXED_GAMUT_BOUNDARIES: LazyLock<Vec<(GamutTarget, Arc<GamutBoundaryLut>)>> =
    LazyLock::new(|| {
        [
            GamutTarget::Srgb,
            GamutTarget::DisplayP3,
            GamutTarget::AdobeRgb1998,
            GamutTarget::ProPhotoRgb,
            GamutTarget::Rec2020,
        ]
        .into_iter()
        .map(|target| (target, Arc::new(build_fixed_boundary(target))))
        .collect()
    });

#[cfg(test)]
pub(crate) fn fixed_gamut_plan(
    target: GamutTarget,
    mode: GamutPlanMode,
) -> &'static CompiledGamutPlanV1 {
    let intent = if mode == GamutPlanMode::ViewDisplay {
        GamutRenderingIntent::Perceptual
    } else {
        GamutRenderingIntent::RelativeColorimetric
    };
    fixed_gamut_plan_for_intent(target, mode, intent, false)
        .expect("the default fixed gamut plan must be available")
}

pub(crate) fn fixed_gamut_plan_for_intent(
    target: GamutTarget,
    mode: GamutPlanMode,
    rendering_intent: GamutRenderingIntent,
    black_point_compensation: bool,
) -> Result<&'static CompiledGamutPlanV1, &'static str> {
    if black_point_compensation {
        return Err("gamut_plan.black_point_compensation_requires_icc_cmm");
    }
    FIXED_GAMUT_PLANS
        .iter()
        .find(|plan| {
            plan.target_id == target
                && plan.mode == mode
                && plan.rendering_intent == rendering_intent
                && !plan.black_point_compensation
        })
        .ok_or("gamut_plan.fixed_identity_missing")
}

fn compile_fixed_plan(
    target_id: GamutTarget,
    mode: GamutPlanMode,
    rendering_intent: GamutRenderingIntent,
    black_point_compensation: bool,
) -> CompiledGamutPlanV1 {
    let (target, target_to_xyz_d65, xyz_d65_to_target) = match target_id {
        GamutTarget::Srgb => (
            GamutTargetIdentity {
                target_id,
                primaries_xy: [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]],
                white_xy: [0.3127, 0.3290],
                transfer: "srgb_v1",
                profile_hash: None,
                absolute_white_nits: None,
            },
            SRGB_TO_XYZ_D65,
            XYZ_D65_TO_SRGB,
        ),
        GamutTarget::DisplayP3 => (
            GamutTargetIdentity {
                target_id,
                primaries_xy: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]],
                white_xy: [0.3127, 0.3290],
                transfer: "srgb_v1",
                profile_hash: None,
                absolute_white_nits: None,
            },
            DISPLAY_P3_TO_XYZ_D65,
            XYZ_D65_TO_DISPLAY_P3,
        ),
        GamutTarget::AdobeRgb1998 => (
            GamutTargetIdentity {
                target_id,
                primaries_xy: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]],
                white_xy: [0.3127, 0.3290],
                transfer: "gamma_2_19921875_v1",
                profile_hash: None,
                absolute_white_nits: None,
            },
            ADOBE_RGB_TO_XYZ_D65,
            XYZ_D65_TO_ADOBE_RGB,
        ),
        GamutTarget::ProPhotoRgb => (
            GamutTargetIdentity {
                target_id,
                primaries_xy: [[0.7347, 0.2653], [0.1596, 0.8404], [0.0366, 0.0001]],
                white_xy: [0.34567, 0.35850],
                transfer: "prophoto_v1",
                profile_hash: None,
                absolute_white_nits: None,
            },
            multiply_matrix(D50_TO_D65, PROPHOTO_TO_XYZ_D50),
            multiply_matrix(XYZ_D50_TO_PROPHOTO, D65_TO_D50),
        ),
        GamutTarget::Rec2020 => (
            GamutTargetIdentity {
                target_id,
                primaries_xy: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],
                white_xy: [0.3127, 0.3290],
                transfer: "linear_v1",
                profile_hash: None,
                absolute_white_nits: Some(1_000.0),
            },
            REC2020_TO_XYZ_D65,
            XYZ_D65_TO_REC2020,
        ),
    };
    let compression = GamutCompressionParameters {
        onset_ratio: 0.82,
        knee_softness: 1.0,
        near_neutral_chroma: 1.0e-7,
    };
    let boundary = FIXED_GAMUT_BOUNDARIES
        .iter()
        .find(|(target, _)| *target == target_id)
        .map(|(_, boundary)| Arc::clone(boundary))
        .expect("every fixed gamut target must have one shared boundary LUT");
    let canonical = serde_json::to_vec(&(
        target_id,
        mode,
        rendering_intent,
        black_point_compensation,
        &target,
        &boundary.fingerprint,
        compression,
        SHARED_OKLAB_CUSP_COMPRESS_V1,
        1_u32,
    ))
    .expect("fixed gamut plan identity should serialize");
    let fingerprint = format!("sha256:{}", hex::encode(Sha256::digest(canonical)));
    CompiledGamutPlanV1 {
        target,
        target_id,
        mode,
        perceptual_model: "oklab_d65_v1",
        implementation_id: SHARED_OKLAB_CUSP_COMPRESS_V1,
        compression,
        boundary,
        rendering_intent,
        black_point_compensation,
        fingerprint,
        implementation_version: 1,
        target_to_xyz_d65,
        xyz_d65_to_target,
    }
}

fn fixed_target_matrices(target: GamutTarget) -> ([[f64; 3]; 3], [[f64; 3]; 3]) {
    match target {
        GamutTarget::Srgb => (SRGB_TO_XYZ_D65, XYZ_D65_TO_SRGB),
        GamutTarget::DisplayP3 => (DISPLAY_P3_TO_XYZ_D65, XYZ_D65_TO_DISPLAY_P3),
        GamutTarget::AdobeRgb1998 => (ADOBE_RGB_TO_XYZ_D65, XYZ_D65_TO_ADOBE_RGB),
        GamutTarget::ProPhotoRgb => (
            multiply_matrix(D50_TO_D65, PROPHOTO_TO_XYZ_D50),
            multiply_matrix(XYZ_D50_TO_PROPHOTO, D65_TO_D50),
        ),
        GamutTarget::Rec2020 => (REC2020_TO_XYZ_D65, XYZ_D65_TO_REC2020),
    }
}

fn build_fixed_boundary(target: GamutTarget) -> GamutBoundaryLut {
    const LIGHTNESS_SAMPLES: usize = 65;
    const HUE_SAMPLES: usize = 180;
    let (_, xyz_d65_to_target) = fixed_target_matrices(target);
    let mut maximum_chroma = Vec::with_capacity(LIGHTNESS_SAMPLES * HUE_SAMPLES);
    for lightness_index in 0..LIGHTNESS_SAMPLES {
        let lightness = lightness_index as f64 / (LIGHTNESS_SAMPLES - 1) as f64;
        for hue_index in 0..HUE_SAMPLES {
            let hue = hue_index as f64 / HUE_SAMPLES as f64 * std::f64::consts::TAU;
            maximum_chroma.push(maximum_chroma_exact(
                lightness,
                [hue.cos(), hue.sin()],
                xyz_d65_to_target,
            ) as f32);
        }
    }
    let bytes = bytemuck::cast_slice::<f32, u8>(&maximum_chroma);
    let fingerprint = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
    GamutBoundaryLut {
        fingerprint,
        hue_samples: HUE_SAMPLES as u16,
        lightness_samples: LIGHTNESS_SAMPLES as u16,
        maximum_chroma: maximum_chroma.into(),
    }
}

impl GamutBoundaryLut {
    fn sample(&self, lightness: f64, hue_unit: [f64; 2]) -> f64 {
        let lightness_position = lightness.clamp(0.0, 1.0) * f64::from(self.lightness_samples - 1);
        let lightness_low = lightness_position.floor() as usize;
        let lightness_high = (lightness_low + 1).min(self.lightness_samples as usize - 1);
        let lightness_mix = lightness_position - lightness_low as f64;
        let hue = hue_unit[1]
            .atan2(hue_unit[0])
            .rem_euclid(std::f64::consts::TAU);
        let hue_position = hue / std::f64::consts::TAU * f64::from(self.hue_samples);
        let hue_low = hue_position.floor() as usize % self.hue_samples as usize;
        let hue_high = (hue_low + 1) % self.hue_samples as usize;
        let hue_mix = hue_position - hue_position.floor();
        let at = |lightness_index: usize, hue_index: usize| {
            f64::from(self.maximum_chroma[lightness_index * self.hue_samples as usize + hue_index])
        };
        let low =
            at(lightness_low, hue_low) * (1.0 - hue_mix) + at(lightness_low, hue_high) * hue_mix;
        let high =
            at(lightness_high, hue_low) * (1.0 - hue_mix) + at(lightness_high, hue_high) * hue_mix;
        (low * (1.0 - lightness_mix) + high * lightness_mix) * 0.995
    }
}

fn maximum_chroma_exact(
    lightness: f64,
    hue_unit: [f64; 2],
    xyz_d65_to_target: [[f64; 3]; 3],
) -> f64 {
    let contains = |chroma: f64| {
        let linear_srgb =
            oklab_to_linear_srgb_f64([lightness, hue_unit[0] * chroma, hue_unit[1] * chroma]);
        let rgb = multiply_vector(
            xyz_d65_to_target,
            multiply_vector(SRGB_TO_XYZ_D65, linear_srgb),
        );
        rgb.iter()
            .all(|value| value.is_finite() && (-1.0e-8..=1.0 + 1.0e-8).contains(value))
    };
    let mut low = 0.0;
    let mut high = 0.5;
    while high < 4.0 && contains(high) {
        low = high;
        high *= 2.0;
    }
    for _ in 0..24 {
        let mid = (low + high) * 0.5;
        if contains(mid) {
            low = mid;
        } else {
            high = mid;
        }
    }
    low * (1.0 - 2.0e-7)
}

impl CompiledGamutPlanV1 {
    pub(crate) fn contains(&self, rgb: [f64; 3]) -> bool {
        rgb.iter()
            .all(|value| value.is_finite() && (-1.0e-8..=1.0 + 1.0e-8).contains(value))
    }

    pub(crate) fn map_target_linear(&self, input: [f64; 3]) -> GamutMapResult {
        if self.mode == GamutPlanMode::WorkingGuard {
            let finite = input.map(|value| if value.is_finite() { value } else { 0.0 });
            return GamutMapResult {
                linear_rgb: finite,
                receipt: GamutMapReceipt {
                    hard_clipped: input != finite,
                    ..GamutMapReceipt::default()
                },
            };
        }
        let safe_input = input.map(|value| if value.is_finite() { value } else { 0.0 });
        let input_was_out_of_gamut = !self.contains(input);
        if self.mode == GamutPlanMode::Warning {
            return GamutMapResult {
                linear_rgb: safe_input,
                receipt: GamutMapReceipt {
                    input_was_out_of_gamut,
                    hard_clipped: input != safe_input,
                    maximum_boundary_excess: boundary_excess(safe_input),
                    ..GamutMapReceipt::default()
                },
            };
        }
        let input_min = safe_input.into_iter().fold(f64::INFINITY, f64::min);
        let input_max = safe_input.into_iter().fold(f64::NEG_INFINITY, f64::max);
        if input_max - input_min <= self.compression.near_neutral_chroma {
            let neutral = ((safe_input[0] + safe_input[1] + safe_input[2]) / 3.0).clamp(0.0, 1.0);
            return GamutMapResult {
                linear_rgb: [neutral; 3],
                receipt: GamutMapReceipt {
                    input_was_out_of_gamut,
                    compressed: input_was_out_of_gamut,
                    hard_clipped: input != safe_input,
                    maximum_boundary_excess: boundary_excess(safe_input),
                },
            };
        }

        let xyz = multiply_vector(self.target_to_xyz_d65, safe_input);
        let linear_srgb = multiply_vector(XYZ_D65_TO_SRGB, xyz);
        let lab = linear_srgb_to_oklab_f64(linear_srgb);
        let lightness = lab[0].clamp(0.0, 1.0);
        let chroma = lab[1].hypot(lab[2]);
        let hue_unit = if chroma > self.compression.near_neutral_chroma {
            [lab[1] / chroma, lab[2] / chroma]
        } else {
            [1.0, 0.0]
        };
        let maximum_chroma = self.maximum_chroma(lightness, hue_unit);
        let onset = maximum_chroma * self.compression.onset_ratio;
        if !input_was_out_of_gamut && chroma <= onset && lab[0] == lightness {
            return GamutMapResult {
                linear_rgb: input,
                receipt: GamutMapReceipt::default(),
            };
        }
        let span = (maximum_chroma - onset).max(1.0e-12);
        let mapped_chroma = if chroma <= onset {
            chroma
        } else {
            let normalized = (chroma - onset) / span;
            onset + span * (1.0 - (-normalized / self.compression.knee_softness).exp())
        };
        let mapped_lab = [
            lightness,
            hue_unit[0] * mapped_chroma,
            hue_unit[1] * mapped_chroma,
        ];
        let mapped_srgb = oklab_to_linear_srgb_f64(mapped_lab);
        let mapped_xyz = multiply_vector(SRGB_TO_XYZ_D65, mapped_srgb);
        let mut mapped = multiply_vector(self.xyz_d65_to_target, mapped_xyz);
        let mut hard_clipped = input != safe_input;
        if !self.contains(mapped) {
            mapped = mapped.map(|value| value.clamp(0.0, 1.0));
            hard_clipped = true;
        }
        GamutMapResult {
            linear_rgb: mapped,
            receipt: GamutMapReceipt {
                input_was_out_of_gamut,
                compressed: chroma > mapped_chroma + 1.0e-10 || lab[0] != lightness,
                hard_clipped,
                maximum_boundary_excess: boundary_excess(safe_input),
            },
        }
    }

    fn maximum_chroma(&self, lightness: f64, hue_unit: [f64; 2]) -> f64 {
        self.boundary.sample(lightness, hue_unit)
    }

    #[cfg(test)]
    fn lab_to_target(&self, lab: [f64; 3]) -> [f64; 3] {
        let linear_srgb = oklab_to_linear_srgb_f64(lab);
        multiply_vector(
            self.xyz_d65_to_target,
            multiply_vector(SRGB_TO_XYZ_D65, linear_srgb),
        )
    }

    #[cfg(test)]
    fn target_to_lab(&self, rgb: [f64; 3]) -> [f64; 3] {
        linear_srgb_to_oklab_f64(multiply_vector(
            XYZ_D65_TO_SRGB,
            multiply_vector(self.target_to_xyz_d65, rgb),
        ))
    }
}

fn boundary_excess(rgb: [f64; 3]) -> f64 {
    rgb.into_iter()
        .map(|value| {
            if value < 0.0 {
                -value
            } else {
                (value - 1.0).max(0.0)
            }
        })
        .fold(0.0, f64::max)
}

fn multiply_vector(matrix: [[f64; 3]; 3], value: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|row| {
        (0..3)
            .map(|column| matrix[row][column] * value[column])
            .sum()
    })
}

fn multiply_matrix(left: [[f64; 3]; 3], right: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| {
        std::array::from_fn(|column| (0..3).map(|k| left[row][k] * right[k][column]).sum())
    })
}

fn linear_srgb_to_oklab_f64(rgb: [f64; 3]) -> [f64; 3] {
    let l = 0.412_221_470_8 * rgb[0] + 0.536_332_536_3 * rgb[1] + 0.051_445_992_9 * rgb[2];
    let m = 0.211_903_498_2 * rgb[0] + 0.680_699_545_1 * rgb[1] + 0.107_396_956_6 * rgb[2];
    let s = 0.088_302_461_9 * rgb[0] + 0.281_718_837_6 * rgb[1] + 0.629_978_700_5 * rgb[2];
    let [l_, m_, s_] = [l.cbrt(), m.cbrt(), s.cbrt()];
    [
        0.210_454_255_3 * l_ + 0.793_617_785_0 * m_ - 0.004_072_046_8 * s_,
        1.977_998_495_1 * l_ - 2.428_592_205_0 * m_ + 0.450_593_709_9 * s_,
        0.025_904_037_1 * l_ + 0.782_771_766_2 * m_ - 0.808_675_766_0 * s_,
    ]
}

fn oklab_to_linear_srgb_f64(oklab: [f64; 3]) -> [f64; 3] {
    let l_ = oklab[0] + 0.396_337_777_4 * oklab[1] + 0.215_803_757_3 * oklab[2];
    let m_ = oklab[0] - 0.105_561_345_8 * oklab[1] - 0.063_854_172_8 * oklab[2];
    let s_ = oklab[0] - 0.089_484_177_5 * oklab[1] - 1.291_485_548_0 * oklab[2];
    let [l, m, s] = [l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_];
    [
        4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
        -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
        -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701_0 * s,
    ]
}

#[cfg(test)]
pub(crate) fn map_srgb_oklab_chroma_reduce_v1(rgb: [f32; 3]) -> [f32; 3] {
    if rgb
        .iter()
        .all(|component| component.is_finite() && (0.0..=1.0).contains(component))
    {
        return rgb;
    }

    let safe_rgb = [
        finite_or_zero(rgb[0]),
        finite_or_zero(rgb[1]),
        finite_or_zero(rgb[2]),
    ];
    let oklab = linear_srgb_to_oklab(safe_rgb);
    let neutral = oklab_to_linear_srgb([oklab[0], 0.0, 0.0]);

    if !is_in_srgb_gamut(neutral) {
        return clamp_rgb(safe_rgb);
    }

    let mut low = 0.0_f32;
    let mut high = 1.0_f32;
    let mut best = neutral;

    for _ in 0..24 {
        let mid = (low + high) * 0.5;
        let candidate = oklab_to_linear_srgb([oklab[0], oklab[1] * mid, oklab[2] * mid]);

        if is_in_srgb_gamut(candidate) {
            best = candidate;
            low = mid;
        } else {
            high = mid;
        }
    }

    clamp_rgb(best)
}

pub(crate) fn map_srgb_oklab_chroma_reduce_v2(rgb: [f32; 3]) -> [f32; 3] {
    if rgb
        .iter()
        .all(|component| component.is_finite() && (0.0..=1.0).contains(component))
    {
        return rgb;
    }

    let safe_rgb = [
        finite_or_zero(rgb[0]),
        finite_or_zero(rgb[1]),
        finite_or_zero(rgb[2]),
    ];
    let oklab = linear_srgb_to_oklab(safe_rgb);
    let fitted_lightness = fit_oklab_lightness_to_srgb_neutral(oklab[0]);
    let neutral = oklab_to_linear_srgb([fitted_lightness, 0.0, 0.0]);

    if !is_in_srgb_gamut(neutral) {
        return clamp_rgb(neutral);
    }

    let mut low = 0.0_f32;
    let mut high = 1.0_f32;
    let mut best = neutral;

    for _ in 0..28 {
        let mid = (low + high) * 0.5;
        let candidate = oklab_to_linear_srgb([fitted_lightness, oklab[1] * mid, oklab[2] * mid]);

        if is_in_srgb_gamut(candidate) {
            best = candidate;
            low = mid;
        } else {
            high = mid;
        }
    }

    clamp_rgb(best)
}

#[cfg(test)]
pub(crate) fn map_srgb_oklab_chroma_reduce_v3(rgb: [f32; 3]) -> [f32; 3] {
    if rgb
        .iter()
        .all(|component| component.is_finite() && (0.0..=1.0).contains(component))
    {
        return rgb;
    }

    let fitted = map_srgb_oklab_chroma_reduce_v2(rgb);
    let clipped = clamp_rgb([
        finite_or_zero(rgb[0]),
        finite_or_zero(rgb[1]),
        finite_or_zero(rgb[2]),
    ]);
    let fitted_oklab = linear_srgb_to_oklab(fitted);
    let clipped_oklab = linear_srgb_to_oklab(clipped);
    let fitted_chroma = oklab_chroma(fitted_oklab);
    let clipped_chroma = oklab_chroma(clipped_oklab);

    if fitted_chroma <= clipped_chroma + CHROMA_MONOTONIC_EPSILON {
        return fitted;
    }

    clipped
}

pub(crate) fn map_srgb_oklab_chroma_reduce_v4(rgb: [f32; 3]) -> [f32; 3] {
    if rgb
        .iter()
        .all(|component| component.is_finite() && (0.0..=1.0).contains(component))
    {
        return rgb;
    }

    let fitted = map_srgb_oklab_chroma_reduce_v2(rgb);
    let clipped = clamp_rgb([
        finite_or_zero(rgb[0]),
        finite_or_zero(rgb[1]),
        finite_or_zero(rgb[2]),
    ]);
    let clipped_chroma = oklab_chroma(linear_srgb_to_oklab(clipped));
    let fitted_chroma = oklab_chroma(linear_srgb_to_oklab(fitted));

    if fitted_chroma <= clipped_chroma * CHROMA_SAFE_CLIP_FALLBACK_RATIO {
        return fitted;
    }

    clipped
}

pub(crate) fn map_srgb_oklab_chroma_reduce_rgb16_pixels(pixels: &[f32]) -> Vec<u16> {
    pixels
        .chunks_exact(3)
        .flat_map(|pixel| {
            let mapped = map_srgb_oklab_chroma_reduce_v4([pixel[0], pixel[1], pixel[2]]);
            mapped.map(quantize_linear_component_to_u16)
        })
        .collect()
}

fn fit_oklab_lightness_to_srgb_neutral(lightness: f32) -> f32 {
    if !lightness.is_finite() {
        return 0.0;
    }

    let clamped = lightness.clamp(0.0, 1.0);
    if is_in_srgb_gamut(oklab_to_linear_srgb([clamped, 0.0, 0.0])) {
        clamped
    } else if lightness < 0.0 {
        0.0
    } else {
        1.0
    }
}

fn finite_or_zero(value: f32) -> f32 {
    if value.is_finite() { value } else { 0.0 }
}

fn is_in_srgb_gamut(rgb: [f32; 3]) -> bool {
    rgb.iter().all(|component| {
        component.is_finite() && *component >= -EPSILON && *component <= 1.0 + EPSILON
    })
}

fn clamp_rgb(rgb: [f32; 3]) -> [f32; 3] {
    [
        rgb[0].clamp(0.0, 1.0),
        rgb[1].clamp(0.0, 1.0),
        rgb[2].clamp(0.0, 1.0),
    ]
}

fn oklab_chroma(oklab: [f32; 3]) -> f32 {
    oklab[1].hypot(oklab[2])
}

fn quantize_linear_component_to_u16(value: f32) -> u16 {
    (value.clamp(0.0, 1.0) * u16::MAX as f32).round() as u16
}

fn linear_srgb_to_oklab(rgb: [f32; 3]) -> [f32; 3] {
    let l = 0.412_221_46 * rgb[0] + 0.536_332_55 * rgb[1] + 0.051_445_995 * rgb[2];
    let m = 0.211_903_5 * rgb[0] + 0.680_699_5 * rgb[1] + 0.107_396_96 * rgb[2];
    let s = 0.088_302_46 * rgb[0] + 0.281_718_85 * rgb[1] + 0.629_978_7 * rgb[2];

    let l_ = cbrt_signed(l);
    let m_ = cbrt_signed(m);
    let s_ = cbrt_signed(s);

    [
        0.210_454_26 * l_ + 0.793_617_8 * m_ - 0.004_072_047 * s_,
        1.977_998_5 * l_ - 2.428_592_2 * m_ + 0.450_593_7 * s_,
        0.025_904_037 * l_ + 0.782_771_77 * m_ - 0.808_675_77 * s_,
    ]
}

fn oklab_to_linear_srgb(oklab: [f32; 3]) -> [f32; 3] {
    let l_ = oklab[0] + 0.396_337_78 * oklab[1] + 0.215_803_76 * oklab[2];
    let m_ = oklab[0] - 0.105_561_346 * oklab[1] - 0.063_854_17 * oklab[2];
    let s_ = oklab[0] - 0.089_484_18 * oklab[1] - 1.291_485_5 * oklab[2];

    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;

    [
        4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s,
        -1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s,
        -0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s,
    ]
}

fn cbrt_signed(value: f32) -> f32 {
    value.signum() * value.abs().cbrt()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{
        ACTIVE_SRGB_OKLAB_CHROMA_REDUCE, CHROMA_MONOTONIC_EPSILON, GamutPlanMode,
        GamutRenderingIntent, GamutTarget, SHARED_OKLAB_CUSP_COMPRESS_V1,
        SRGB_OKLAB_CHROMA_REDUCE_V1, SRGB_OKLAB_CHROMA_REDUCE_V2, SRGB_OKLAB_CHROMA_REDUCE_V3,
        SRGB_OKLAB_CHROMA_REDUCE_V4, fixed_gamut_plan, fixed_gamut_plan_for_intent,
        is_in_srgb_gamut, linear_srgb_to_oklab, map_srgb_oklab_chroma_reduce_v1,
        map_srgb_oklab_chroma_reduce_v2, map_srgb_oklab_chroma_reduce_v3,
        map_srgb_oklab_chroma_reduce_v4, oklab_chroma,
    };

    fn assert_in_gamut(rgb: [f32; 3]) {
        for component in rgb {
            assert!(
                (0.0..=1.0).contains(&component),
                "component {component} should be in gamut"
            );
        }
    }

    #[test]
    fn mapper_has_stable_version_id() {
        assert_eq!(
            SRGB_OKLAB_CHROMA_REDUCE_V1,
            "rawengine.gamut.srgb-oklab-chroma-reduce.v1"
        );
        let relative = fixed_gamut_plan_for_intent(
            GamutTarget::Srgb,
            GamutPlanMode::Output,
            GamutRenderingIntent::RelativeColorimetric,
            false,
        )
        .unwrap();
        let perceptual = fixed_gamut_plan_for_intent(
            GamutTarget::Srgb,
            GamutPlanMode::Output,
            GamutRenderingIntent::Perceptual,
            false,
        )
        .unwrap();
        assert_ne!(relative.fingerprint, perceptual.fingerprint);
        assert!(Arc::ptr_eq(&relative.boundary, &perceptual.boundary));
        assert_eq!(relative.boundary.hue_samples, 180);
        assert_eq!(relative.boundary.lightness_samples, 65);
        let serialized = serde_json::to_value(relative).unwrap();
        assert!(
            serialized["boundary"]["fingerprint"]
                .as_str()
                .unwrap()
                .starts_with("sha256:")
        );
        assert!(serialized["boundary"].get("maximumChroma").is_none());
        assert!(serialized["target"].get("profileHash").is_none());
        assert_eq!(
            fixed_gamut_plan_for_intent(
                GamutTarget::Srgb,
                GamutPlanMode::Output,
                GamutRenderingIntent::RelativeColorimetric,
                true,
            ),
            Err("gamut_plan.black_point_compensation_requires_icc_cmm")
        );
        assert_eq!(
            SRGB_OKLAB_CHROMA_REDUCE_V2,
            "rawengine.gamut.srgb-oklab-chroma-reduce.v2"
        );
        assert_eq!(
            SRGB_OKLAB_CHROMA_REDUCE_V3,
            "rawengine.gamut.srgb-oklab-chroma-reduce.v3"
        );
        assert_eq!(
            SRGB_OKLAB_CHROMA_REDUCE_V4,
            "rawengine.gamut.srgb-oklab-chroma-reduce.v4"
        );
        assert_eq!(ACTIVE_SRGB_OKLAB_CHROMA_REDUCE, SRGB_OKLAB_CHROMA_REDUCE_V4);
    }

    #[test]
    fn mapper_preserves_in_gamut_values_exactly() {
        let rgb = [0.25, 0.5, 0.75];

        assert_eq!(map_srgb_oklab_chroma_reduce_v4(rgb), rgb);
    }

    #[test]
    fn mapper_reduces_high_component_without_channel_clip_shape() {
        let mapped = map_srgb_oklab_chroma_reduce_v4([1.35, 0.05, 0.0]);

        assert_in_gamut(mapped);
        assert!(
            mapped[1] > 0.05 || mapped[2] > 0.0,
            "perceptual mapping should reduce chroma, not only hard-clip red"
        );
    }

    #[test]
    fn mapper_handles_negative_components() {
        let mapped = map_srgb_oklab_chroma_reduce_v4([0.1, -0.2, 0.8]);

        assert_in_gamut(mapped);
    }

    #[test]
    fn mapper_v2_fits_hdr_neutral_without_channel_clip_shape() {
        let mapped = map_srgb_oklab_chroma_reduce_v4([1.8, 1.8, 1.8]);

        assert_in_gamut(mapped);
        assert!(
            (mapped[0] - mapped[1]).abs() <= 1.0e-5 && (mapped[1] - mapped[2]).abs() <= 1.0e-5,
            "v2 should preserve neutral-axis balance while fitting HDR values"
        );
    }

    #[test]
    fn mapper_v1_remains_available_as_historical_id() {
        assert_in_gamut(map_srgb_oklab_chroma_reduce_v1([1.35, 0.05, 0.0]));
    }

    #[test]
    fn mapper_v3_caps_chroma_against_relative_clip_reference() {
        let rgb = [1.35, 0.05, 0.0];
        let mapped = map_srgb_oklab_chroma_reduce_v3(rgb);
        let clipped = [1.0, 0.05, 0.0];
        let mapped_chroma = oklab_chroma(linear_srgb_to_oklab(mapped));
        let clipped_chroma = oklab_chroma(linear_srgb_to_oklab(clipped));

        assert_in_gamut(mapped);
        assert!(
            mapped_chroma <= clipped_chroma + CHROMA_MONOTONIC_EPSILON + 1.0e-5,
            "v3 should not increase OKLab chroma beyond relative clipping"
        );
    }

    #[test]
    fn mapper_v2_remains_available_as_historical_id() {
        assert_in_gamut(map_srgb_oklab_chroma_reduce_v2([0.1, -0.2, 0.8]));
    }

    #[test]
    fn mapper_v4_falls_back_to_clip_for_risky_chroma() {
        let rgb = [1.35, 0.05, 0.0];
        let mapped = map_srgb_oklab_chroma_reduce_v4(rgb);
        let clipped = [1.0, 0.05, 0.0];
        let mapped_chroma = oklab_chroma(linear_srgb_to_oklab(mapped));
        let clipped_chroma = oklab_chroma(linear_srgb_to_oklab(clipped));

        assert_in_gamut(mapped);
        assert!(
            mapped_chroma <= clipped_chroma,
            "v4 should avoid fitted chroma when it risks exceeding relative clipping"
        );
    }

    #[test]
    fn active_mapper_contains_a_wide_rgb_lattice_and_preserves_neutrals() {
        let samples = [-0.5, -0.1, 0.0, 0.1, 0.5, 0.9, 1.0, 1.1, 2.0];
        for red in samples {
            for green in samples {
                for blue in samples {
                    let mapped = map_srgb_oklab_chroma_reduce_v4([red, green, blue]);
                    assert!(
                        is_in_srgb_gamut(mapped),
                        "mapped [{red}, {green}, {blue}] outside sRGB: {mapped:?}"
                    );
                }
            }
        }

        for neutral in samples {
            let mapped = map_srgb_oklab_chroma_reduce_v4([neutral; 3]);
            assert!((mapped[0] - mapped[1]).abs() <= 1.0e-5);
            assert!((mapped[1] - mapped[2]).abs() <= 1.0e-5);
        }

        assert!(
            !is_in_srgb_gamut([1.01, 0.5, 0.5]),
            "containment predicate must reject an injected overflow"
        );
    }

    #[test]
    fn shared_plans_are_target_and_mode_keyed_and_cached() {
        let mut fingerprints = std::collections::BTreeSet::new();
        for target in [
            GamutTarget::Srgb,
            GamutTarget::DisplayP3,
            GamutTarget::AdobeRgb1998,
            GamutTarget::ProPhotoRgb,
            GamutTarget::Rec2020,
        ] {
            for mode in [
                GamutPlanMode::WorkingGuard,
                GamutPlanMode::ViewDisplay,
                GamutPlanMode::Output,
                GamutPlanMode::Warning,
            ] {
                let plan = fixed_gamut_plan(target, mode);
                assert_eq!(plan.implementation_version, 1);
                assert_eq!(plan.perceptual_model, "oklab_d65_v1");
                assert!(plan.fingerprint.starts_with("sha256:"));
                assert!(fingerprints.insert(plan.fingerprint.clone()));
                assert!(std::ptr::eq(plan, fixed_gamut_plan(target, mode)));
            }
        }
        assert_eq!(fingerprints.len(), 20);
        assert_eq!(
            SHARED_OKLAB_CUSP_COMPRESS_V1,
            "rawengine.gamut.shared-oklab-cusp-compress.v1"
        );
    }

    #[test]
    fn shared_mapping_is_identity_inside_every_fixed_target() {
        for target in [
            GamutTarget::Srgb,
            GamutTarget::DisplayP3,
            GamutTarget::AdobeRgb1998,
            GamutTarget::ProPhotoRgb,
            GamutTarget::Rec2020,
        ] {
            let plan = fixed_gamut_plan(target, GamutPlanMode::Output);
            let input = [0.18, 0.31, 0.07];
            let result = plan.map_target_linear(input);
            assert_eq!(result.linear_rgb, input, "{target:?}");
            assert_eq!(result.receipt, Default::default(), "{target:?}");
        }
    }

    #[test]
    fn shared_mapping_contains_saturated_colors_without_clip_fallback() {
        for target in [
            GamutTarget::Srgb,
            GamutTarget::DisplayP3,
            GamutTarget::AdobeRgb1998,
            GamutTarget::ProPhotoRgb,
            GamutTarget::Rec2020,
        ] {
            let plan = fixed_gamut_plan(target, GamutPlanMode::Output);
            for input in [[1.35, 0.02, -0.08], [-0.15, 0.35, 1.4], [0.2, 1.3, 0.05]] {
                let result = plan.map_target_linear(input);
                assert!(plan.contains(result.linear_rgb), "{target:?}: {result:?}");
                assert!(result.receipt.input_was_out_of_gamut);
                assert!(result.receipt.compressed);
                assert!(!result.receipt.hard_clipped, "{target:?}: {result:?}");
            }
        }
    }

    #[test]
    fn shared_mapping_preserves_neutral_axis_and_hue() {
        for target in [
            GamutTarget::Srgb,
            GamutTarget::DisplayP3,
            GamutTarget::AdobeRgb1998,
            GamutTarget::ProPhotoRgb,
            GamutTarget::Rec2020,
        ] {
            let plan = fixed_gamut_plan(target, GamutPlanMode::Output);
            let neutral = plan.map_target_linear([1.8, 1.8, 1.8]);
            assert!(plan.contains(neutral.linear_rgb));
            assert!(neutral.linear_rgb[0] - neutral.linear_rgb[1] < 2.0e-6);
            assert!(neutral.linear_rgb[1] - neutral.linear_rgb[2] < 2.0e-6);

            let input = plan.lab_to_target([0.63, 0.55, -0.31]);
            let output = plan.map_target_linear(input).linear_rgb;
            let input_lab = plan.target_to_lab(input);
            let output_lab = plan.target_to_lab(output);
            let input_hue = input_lab[2].atan2(input_lab[1]);
            let output_hue = output_lab[2].atan2(output_lab[1]);
            assert!((input_hue - output_hue).abs() < 2.0e-6, "{target:?}");
        }
    }

    #[test]
    fn shared_mapping_materially_beats_channel_clipping_hue_and_plateaus() {
        for target in [
            GamutTarget::Srgb,
            GamutTarget::DisplayP3,
            GamutTarget::AdobeRgb1998,
            GamutTarget::ProPhotoRgb,
            GamutTarget::Rec2020,
        ] {
            let plan = fixed_gamut_plan(target, GamutPlanMode::Output);
            let mut mapped_plateaus = 0;
            let mut clipped_plateaus = 0;
            for hue_degrees in (0..360).step_by(15) {
                let hue = f64::from(hue_degrees).to_radians();
                let input = plan.lab_to_target([0.62, hue.cos() * 0.72, hue.sin() * 0.72]);
                let mapped = plan.map_target_linear(input).linear_rgb;
                let clipped = input.map(|value| value.clamp(0.0, 1.0));
                let source_lab = plan.target_to_lab(input);
                let mapped_lab = plan.target_to_lab(mapped);
                let clipped_lab = plan.target_to_lab(clipped);
                let source_hue = source_lab[2].atan2(source_lab[1]);
                let mapped_hue = mapped_lab[2].atan2(mapped_lab[1]);
                let clipped_hue = clipped_lab[2].atan2(clipped_lab[1]);
                let mapped_error = angular_distance(source_hue, mapped_hue);
                let clipped_error = angular_distance(source_hue, clipped_hue);
                assert!(mapped_error <= 2.0e-5, "{target:?} hue={hue_degrees}");
                assert!(
                    mapped_error <= clipped_error + 1.0e-8,
                    "{target:?} hue={hue_degrees}"
                );
                mapped_plateaus += mapped
                    .into_iter()
                    .filter(|value| *value == 0.0 || *value == 1.0)
                    .count();
                clipped_plateaus += clipped
                    .into_iter()
                    .filter(|value| *value == 0.0 || *value == 1.0)
                    .count();
            }
            assert!(mapped_plateaus < clipped_plateaus, "{target:?}");
        }
    }

    #[test]
    fn shared_chroma_mapping_is_continuous_and_monotonic() {
        let plan = fixed_gamut_plan(GamutTarget::DisplayP3, GamutPlanMode::Output);
        let hue = 137.0_f64.to_radians();
        let mut previous = 0.0;
        for step in 1..=160 {
            let chroma = f64::from(step) * 0.01;
            let input = plan.lab_to_target([0.58, hue.cos() * chroma, hue.sin() * chroma]);
            let mapped = plan.target_to_lab(plan.map_target_linear(input).linear_rgb);
            let mapped_chroma = mapped[1].hypot(mapped[2]);
            assert!(mapped_chroma + 2.0e-6 >= previous, "step={step}");
            assert!(mapped_chroma - previous < 0.011, "step={step}");
            previous = mapped_chroma;
        }
    }

    #[test]
    fn working_guard_and_warning_do_not_output_map_scene_values() {
        let input = [-0.4, 0.7, 2.3];
        let guard = fixed_gamut_plan(GamutTarget::Srgb, GamutPlanMode::WorkingGuard)
            .map_target_linear(input);
        assert_eq!(guard.linear_rgb, input);
        assert!(!guard.receipt.input_was_out_of_gamut);

        let warning =
            fixed_gamut_plan(GamutTarget::Srgb, GamutPlanMode::Warning).map_target_linear(input);
        assert_eq!(warning.linear_rgb, input);
        assert!(warning.receipt.input_was_out_of_gamut);
        assert!(!warning.receipt.compressed);
        assert!(!warning.receipt.hard_clipped);
    }

    #[test]
    fn warning_and_output_paths_share_the_exact_boundary_classification() {
        for target in [
            GamutTarget::Srgb,
            GamutTarget::DisplayP3,
            GamutTarget::AdobeRgb1998,
            GamutTarget::ProPhotoRgb,
            GamutTarget::Rec2020,
        ] {
            let warning = fixed_gamut_plan(target, GamutPlanMode::Warning);
            let output = fixed_gamut_plan(target, GamutPlanMode::Output);
            assert!(
                Arc::ptr_eq(&warning.boundary, &output.boundary),
                "{target:?}"
            );

            for lightness_step in 1..10 {
                let lightness = f64::from(lightness_step) / 10.0;
                for hue_degrees in (0..360).step_by(30) {
                    let hue = f64::from(hue_degrees).to_radians();
                    for chroma in [0.01, 0.15, 0.4, 0.8] {
                        let input = output.lab_to_target([
                            lightness,
                            hue.cos() * chroma,
                            hue.sin() * chroma,
                        ]);
                        let classified = warning.map_target_linear(input);
                        let mapped = output.map_target_linear(input);
                        assert_eq!(classified.linear_rgb, input, "{target:?}");
                        assert_eq!(
                            classified.receipt.input_was_out_of_gamut,
                            mapped.receipt.input_was_out_of_gamut,
                            "{target:?} L={lightness} h={hue_degrees} C={chroma}"
                        );
                        assert_eq!(
                            classified.receipt.maximum_boundary_excess,
                            mapped.receipt.maximum_boundary_excess,
                            "{target:?} L={lightness} h={hue_degrees} C={chroma}"
                        );
                    }
                }
            }
        }
    }

    fn angular_distance(left: f64, right: f64) -> f64 {
        let distance = (left - right).abs() % std::f64::consts::TAU;
        distance.min(std::f64::consts::TAU - distance)
    }
}
