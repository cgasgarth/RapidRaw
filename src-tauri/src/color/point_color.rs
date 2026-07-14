//! Scene-referred perceptual Point Color reference engine.
//!
//! Coordinates are OKLab/OKLCh after an explicit ACEScg AP1 (D60) to linear
//! sRGB (D65) chromatic adaptation. The scalar evaluator is the contract oracle
//! for GPU, visualization, and color-range mask implementations.

use crate::adjustments::abi::{PointColorGpuPoint, PointColorGpuSettings};

#[cfg(test)]
pub const MAX_POINT_COLOR_ADJUSTMENTS: usize = 16;
#[cfg(test)]
pub const MAX_POINT_COLOR_SAMPLES: usize = 8;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PerceptualColorCoordinate {
    pub lightness: f32,
    pub chroma: f32,
    pub hue_degrees: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointColorSampleV1 {
    pub color: PerceptualColorCoordinate,
    pub confidence: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PointColorAdjustmentV1 {
    pub samples: Vec<PointColorSampleV1>,
    pub hue_radius_degrees: f32,
    pub chroma_radius: f32,
    pub lightness_radius: f32,
    pub variance: f32,
    pub feather: f32,
    pub hue_shift_degrees: f32,
    pub chroma_shift: f32,
    pub saturation_shift: f32,
    pub lightness_shift: f32,
    pub opacity: f32,
    pub enabled: bool,
}

#[cfg(test)]
#[derive(Clone, Debug, PartialEq)]
pub struct SkinUniformityV1 {
    pub samples: Vec<PointColorSampleV1>,
    pub target: PerceptualColorCoordinate,
    pub hue_uniformity: f32,
    pub chroma_uniformity: f32,
    pub lightness_uniformity: f32,
    pub preserve_extremes: f32,
    pub range: PointColorAdjustmentV1,
    pub enabled: bool,
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    if edge0 == edge1 {
        return (value >= edge1) as u8 as f32;
    }
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

pub fn circular_hue_distance_degrees(left: f32, right: f32) -> f32 {
    let distance = (left - right).abs().rem_euclid(360.0);
    distance.min(360.0 - distance)
}

fn sample_membership(
    color: PerceptualColorCoordinate,
    sample: PointColorSampleV1,
    point: &PointColorAdjustmentV1,
) -> f32 {
    let chroma_gate = smoothstep(0.003, 0.02, color.chroma.min(sample.color.chroma));
    let hue_distance = circular_hue_distance_degrees(color.hue_degrees, sample.color.hue_degrees)
        / point.hue_radius_degrees.max(0.1);
    let chroma_distance =
        (color.chroma - sample.color.chroma).abs() / point.chroma_radius.max(0.001);
    let lightness_distance =
        (color.lightness - sample.color.lightness).abs() / point.lightness_radius.max(0.001);
    let normalized = (hue_distance * hue_distance
        + chroma_distance * chroma_distance
        + lightness_distance * lightness_distance)
        .sqrt()
        / point.variance.clamp(0.25, 4.0);
    let feather_start = (1.0 - point.feather.clamp(0.0, 1.0)).max(0.0);
    let weight = 1.0 - smoothstep(feather_start, 1.0, normalized);
    weight * chroma_gate * sample.confidence.clamp(0.0, 1.0)
}

/// Deterministic probabilistic union: duplicate samples never reduce membership.
#[cfg(test)]
pub fn membership_weight(color: PerceptualColorCoordinate, point: &PointColorAdjustmentV1) -> f32 {
    if !point.enabled || point.samples.is_empty() {
        return 0.0;
    }
    point
        .samples
        .iter()
        .take(MAX_POINT_COLOR_SAMPLES)
        .fold(0.0, |union, sample| {
            let weight = sample_membership(color, *sample, point);
            1.0 - (1.0 - union) * (1.0 - weight)
        })
        * point.opacity.clamp(0.0, 1.0)
}

fn oklch_to_oklab(color: PerceptualColorCoordinate) -> [f32; 3] {
    let hue = color.hue_degrees.to_radians();
    [
        color.lightness,
        color.chroma * hue.cos(),
        color.chroma * hue.sin(),
    ]
}

fn oklab_to_oklch(lab: [f32; 3]) -> PerceptualColorCoordinate {
    let chroma = lab[1].hypot(lab[2]);
    let hue = if chroma < 1e-7 {
        0.0
    } else {
        lab[2].atan2(lab[1]).to_degrees().rem_euclid(360.0)
    };
    PerceptualColorCoordinate {
        lightness: lab[0],
        chroma,
        hue_degrees: hue,
    }
}

fn mul3(matrix: [[f32; 3]; 3], value: [f32; 3]) -> [f32; 3] {
    matrix.map(|row| row[0].mul_add(value[0], row[1].mul_add(value[1], row[2] * value[2])))
}

pub fn ap1_to_oklch(rgb: [f32; 3]) -> PerceptualColorCoordinate {
    const AP1_TO_LINEAR_SRGB_D65: [[f32; 3]; 3] = [
        [1.705_051_5, -0.621_790_7, -0.083_258_4],
        [-0.130_257_1, 1.140_802_7, -0.010_548_5],
        [-0.024_003_3, -0.128_968_8, 1.152_971_5],
    ];
    let rgb = mul3(AP1_TO_LINEAR_SRGB_D65, rgb);
    let l = 0.412_221_46 * rgb[0] + 0.536_332_55 * rgb[1] + 0.051_445_995 * rgb[2];
    let m = 0.211_903_5 * rgb[0] + 0.680_699_5 * rgb[1] + 0.107_396_96 * rgb[2];
    let s = 0.088_302_46 * rgb[0] + 0.281_718_85 * rgb[1] + 0.629_978_7 * rgb[2];
    let [l, m, s] = [l.cbrt(), m.cbrt(), s.cbrt()];
    oklab_to_oklch([
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ])
}

pub fn oklch_to_ap1(color: PerceptualColorCoordinate) -> [f32; 3] {
    const LINEAR_SRGB_D65_TO_AP1: [[f32; 3]; 3] = [
        [0.613_097_4, 0.339_523_1, 0.047_379_5],
        [0.070_193_7, 0.916_353_9, 0.013_452_4],
        [0.020_615_6, 0.109_569_8, 0.869_814_6],
    ];
    let lab = oklch_to_oklab(color);
    let l = (lab[0] + 0.396_337_78 * lab[1] + 0.215_803_76 * lab[2]).powi(3);
    let m = (lab[0] - 0.105_561_346 * lab[1] - 0.063_854_17 * lab[2]).powi(3);
    let s = (lab[0] - 0.089_484_18 * lab[1] - 1.291_485_5 * lab[2]).powi(3);
    mul3(
        LINEAR_SRGB_D65_TO_AP1,
        [
            4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s,
            -1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s,
            -0.004_196_086 * l - 0.703_418_6 * m + 1.707_614_7 * s,
        ],
    )
}

#[cfg(test)]
pub fn apply_point(
    color: PerceptualColorCoordinate,
    point: &PointColorAdjustmentV1,
) -> PerceptualColorCoordinate {
    let weight = membership_weight(color, point);
    if weight <= 0.0 {
        return color;
    }
    let saturation = color.chroma / color.lightness.max(0.01);
    let next_saturation = (saturation * (1.0 + point.saturation_shift * weight)).max(0.0);
    let shifted_chroma = (color.chroma + point.chroma_shift * weight).max(0.0);
    PerceptualColorCoordinate {
        lightness: color.lightness + point.lightness_shift * weight,
        chroma: shifted_chroma.max(next_saturation * color.lightness.max(0.01)),
        hue_degrees: (color.hue_degrees + point.hue_shift_degrees * weight).rem_euclid(360.0),
    }
}

#[cfg(test)]
pub fn apply_plan_ap1(rgb: [f32; 3], points: &[PointColorAdjustmentV1]) -> [f32; 3] {
    let mut color = ap1_to_oklch(rgb);
    for point in points.iter().take(MAX_POINT_COLOR_ADJUSTMENTS) {
        color = apply_point(color, point);
    }
    oklch_to_ap1(color)
}

fn packed_membership(color: PerceptualColorCoordinate, point: &PointColorGpuPoint) -> f32 {
    if point.control[3] < 0.5 {
        return 0.0;
    }
    let mut union = 0.0;
    for sample in point
        .samples
        .iter()
        .take(point.control[2].max(0.0) as usize)
    {
        let sample = PointColorSampleV1 {
            color: PerceptualColorCoordinate {
                lightness: sample[0],
                chroma: sample[1],
                hue_degrees: sample[2],
            },
            confidence: sample[3],
        };
        let proxy = PointColorAdjustmentV1 {
            samples: Vec::new(),
            hue_radius_degrees: point.range[0],
            chroma_radius: point.range[1],
            lightness_radius: point.range[2],
            variance: point.range[3],
            feather: point.edit[0],
            hue_shift_degrees: point.edit[1],
            chroma_shift: point.edit[2],
            saturation_shift: point.control[0],
            lightness_shift: point.edit[3],
            opacity: point.control[1],
            enabled: true,
        };
        let weight = sample_membership(color, sample, &proxy);
        union = 1.0 - (1.0 - union) * (1.0 - weight);
    }
    union * point.control[1].clamp(0.0, 1.0)
}

/// Allocation-free packed evaluator shared by CPU fallback and WGPU parity tests.
pub fn apply_gpu_plan_ap1(rgb: [f32; 3], settings: &PointColorGpuSettings) -> [f32; 3] {
    let mut color = ap1_to_oklch(rgb);
    let mut visualization_weight: f32 = 0.0;
    for point in settings.points.iter().take(settings.control[0] as usize) {
        let weight = packed_membership(color, point);
        visualization_weight = visualization_weight.max(weight);
        if weight <= 0.0 {
            continue;
        }
        let saturation = color.chroma / color.lightness.max(0.01);
        color = PerceptualColorCoordinate {
            lightness: color.lightness + point.edit[3] * weight,
            chroma: (color.chroma + point.edit[2] * weight).max(
                (saturation * (1.0 + point.control[0] * weight)).max(0.0)
                    * color.lightness.max(0.01),
            ),
            hue_degrees: (color.hue_degrees + point.edit[1] * weight).rem_euclid(360.0),
        };
    }
    if settings.skin_target[3] > 0.5 {
        let membership = packed_membership(color, &settings.skin_range);
        let shadow_extreme = 1.0 - smoothstep(0.0, 0.12, color.lightness);
        let highlight_extreme = smoothstep(0.82, 1.0, color.lightness);
        let guard = 1.0
            - settings.skin_control[3].clamp(0.0, 1.0)
                * (shadow_extreme + highlight_extreme).clamp(0.0, 1.0);
        let influence = membership * guard;
        let hue_delta =
            (settings.skin_target[2] - color.hue_degrees + 180.0).rem_euclid(360.0) - 180.0;
        color = PerceptualColorCoordinate {
            lightness: color.lightness
                + (settings.skin_target[0] - color.lightness)
                    * settings.skin_control[2].clamp(0.0, 1.0)
                    * influence,
            chroma: color.chroma
                + (settings.skin_target[1] - color.chroma)
                    * settings.skin_control[1].clamp(0.0, 1.0)
                    * influence,
            hue_degrees: (color.hue_degrees
                + hue_delta * settings.skin_control[0].clamp(0.0, 1.0) * influence)
                .rem_euclid(360.0),
        };
    }
    let edited = oklch_to_ap1(color);
    match settings.control[1] {
        1 => [visualization_weight; 3],
        2 => {
            let luma =
                0.272_228_72 * edited[0] + 0.674_081_74 * edited[1] + 0.053_689_52 * edited[2];
            edited.map(|channel| luma + (channel - luma) * visualization_weight)
        }
        _ => edited,
    }
}

#[cfg(test)]
pub fn apply_skin_uniformity(
    color: PerceptualColorCoordinate,
    skin: &SkinUniformityV1,
) -> PerceptualColorCoordinate {
    if !skin.enabled {
        return color;
    }
    let weight = membership_weight(color, &skin.range);
    let extreme_guard = 1.0
        - skin.preserve_extremes.clamp(0.0, 1.0)
            * (smoothstep(0.0, 0.12, color.lightness) + 1.0
                - smoothstep(0.82, 1.0, color.lightness))
            .clamp(0.0, 1.0);
    let influence = weight * extreme_guard;
    let hue_delta = ((skin.target.hue_degrees - color.hue_degrees + 180.0).rem_euclid(360.0)
        - 180.0)
        * skin.hue_uniformity.clamp(0.0, 1.0)
        * influence;
    PerceptualColorCoordinate {
        hue_degrees: (color.hue_degrees + hue_delta).rem_euclid(360.0),
        chroma: color.chroma
            + (skin.target.chroma - color.chroma)
                * skin.chroma_uniformity.clamp(0.0, 1.0)
                * influence,
        lightness: color.lightness
            + (skin.target.lightness - color.lightness)
                * skin.lightness_uniformity.clamp(0.0, 1.0)
                * influence,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(center: PerceptualColorCoordinate) -> PointColorAdjustmentV1 {
        PointColorAdjustmentV1 {
            samples: vec![PointColorSampleV1 {
                color: center,
                confidence: 1.0,
            }],
            hue_radius_degrees: 25.0,
            chroma_radius: 0.08,
            lightness_radius: 0.2,
            variance: 1.0,
            feather: 0.4,
            hue_shift_degrees: 20.0,
            chroma_shift: 0.0,
            saturation_shift: 0.0,
            lightness_shift: 0.0,
            opacity: 1.0,
            enabled: true,
        }
    }

    #[test]
    fn hue_distance_wraps_at_red() {
        assert!((circular_hue_distance_degrees(359.0, 1.0) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn membership_is_continuous_monotone_and_neutral_safe() {
        let p = point(PerceptualColorCoordinate {
            lightness: 0.6,
            chroma: 0.15,
            hue_degrees: 359.0,
        });
        let weights = [0.0, 5.0, 10.0, 15.0, 20.0].map(|d| {
            membership_weight(
                PerceptualColorCoordinate {
                    lightness: 0.6,
                    chroma: 0.15,
                    hue_degrees: d,
                },
                &p,
            )
        });
        assert!(weights.windows(2).all(|pair| pair[0] >= pair[1]));
        assert_eq!(
            membership_weight(
                PerceptualColorCoordinate {
                    lightness: 0.6,
                    chroma: 0.0,
                    hue_degrees: 359.0
                },
                &p
            ),
            0.0
        );
    }

    #[test]
    fn multiple_samples_union_without_order_dependence() {
        let mut p = point(PerceptualColorCoordinate {
            lightness: 0.55,
            chroma: 0.12,
            hue_degrees: 20.0,
        });
        p.samples.push(PointColorSampleV1 {
            color: PerceptualColorCoordinate {
                lightness: 0.62,
                chroma: 0.14,
                hue_degrees: 28.0,
            },
            confidence: 0.8,
        });
        let color = PerceptualColorCoordinate {
            lightness: 0.6,
            chroma: 0.13,
            hue_degrees: 25.0,
        };
        let forward = membership_weight(color, &p);
        p.samples.reverse();
        assert!((forward - membership_weight(color, &p)).abs() < 1e-6);
    }

    #[test]
    fn ap1_round_trip_preserves_extended_scene_values() {
        for rgb in [[0.18, 0.18, 0.18], [1.4, 0.2, 0.05], [0.02, 0.3, 1.2]] {
            let round_trip = oklch_to_ap1(ap1_to_oklch(rgb));
            assert!(
                rgb.into_iter()
                    .zip(round_trip)
                    .all(|(a, b)| (a - b).abs() < 2e-5)
            );
        }
    }

    #[test]
    fn zero_edit_is_identity_and_visualization_uses_exact_weight() {
        let rgb = [0.7, 0.2, 0.1];
        let center = ap1_to_oklch(rgb);
        let mut p = point(center);
        p.hue_shift_degrees = 0.0;
        let output = apply_plan_ap1(rgb, &[p.clone()]);
        assert!(
            rgb.into_iter()
                .zip(output)
                .all(|(a, b)| (a - b).abs() < 2e-5)
        );
        assert_eq!(membership_weight(center, &p), 1.0);
    }

    #[test]
    fn packed_cpu_execution_matches_reference_plan() {
        let rgb = [0.7, 0.2, 0.1];
        let center = ap1_to_oklch(rgb);
        let p = point(center);
        let mut packed = PointColorGpuSettings {
            control: [1, 0, 1, 0],
            ..Default::default()
        };
        packed.points[0].samples[0] = [center.lightness, center.chroma, center.hue_degrees, 1.0];
        packed.points[0].range = [
            p.hue_radius_degrees,
            p.chroma_radius,
            p.lightness_radius,
            p.variance,
        ];
        packed.points[0].edit = [
            p.feather,
            p.hue_shift_degrees,
            p.chroma_shift,
            p.lightness_shift,
        ];
        packed.points[0].control = [p.saturation_shift, p.opacity, 1.0, 1.0];
        let expected = apply_plan_ap1(rgb, &[p]);
        let actual = apply_gpu_plan_ap1(rgb, &packed);
        assert!(
            expected
                .into_iter()
                .zip(actual)
                .all(|(left, right)| (left - right).abs() < 2e-5)
        );
    }

    #[test]
    fn skin_axes_are_independent_and_do_not_spatially_smooth() {
        let color = PerceptualColorCoordinate {
            lightness: 0.5,
            chroma: 0.12,
            hue_degrees: 30.0,
        };
        let range = point(color);
        let skin = SkinUniformityV1 {
            samples: range.samples.clone(),
            target: PerceptualColorCoordinate {
                lightness: 0.7,
                chroma: 0.2,
                hue_degrees: 50.0,
            },
            hue_uniformity: 1.0,
            chroma_uniformity: 0.0,
            lightness_uniformity: 0.0,
            preserve_extremes: 0.0,
            range,
            enabled: true,
        };
        let output = apply_skin_uniformity(color, &skin);
        assert!((output.hue_degrees - 50.0).abs() < 1e-5);
        assert_eq!(output.chroma, color.chroma);
        assert_eq!(output.lightness, color.lightness);
    }

    #[test]
    fn packed_skin_execution_matches_reference_and_preserves_independent_axes() {
        let rgb = [0.45, 0.2, 0.12];
        let color = ap1_to_oklch(rgb);
        let range = point(color);
        let target = PerceptualColorCoordinate {
            lightness: color.lightness + 0.1,
            chroma: color.chroma + 0.03,
            hue_degrees: color.hue_degrees + 12.0,
        };
        let skin = SkinUniformityV1 {
            samples: range.samples.clone(),
            target,
            hue_uniformity: 1.0,
            chroma_uniformity: 0.0,
            lightness_uniformity: 0.0,
            preserve_extremes: 0.0,
            range: range.clone(),
            enabled: true,
        };
        let expected = oklch_to_ap1(apply_skin_uniformity(color, &skin));
        let mut packed = PointColorGpuSettings::default();
        packed.skin_range.samples[0] = [color.lightness, color.chroma, color.hue_degrees, 1.0];
        packed.skin_range.range = [
            range.hue_radius_degrees,
            range.chroma_radius,
            range.lightness_radius,
            range.variance,
        ];
        packed.skin_range.edit[0] = range.feather;
        packed.skin_range.control = [0.0, 1.0, 1.0, 1.0];
        packed.skin_target = [target.lightness, target.chroma, target.hue_degrees, 1.0];
        packed.skin_control = [1.0, 0.0, 0.0, 0.0];
        let actual = apply_gpu_plan_ap1(rgb, &packed);
        assert!(
            expected
                .into_iter()
                .zip(actual)
                .all(|(left, right)| (left - right).abs() < 2e-5)
        );
    }
}
