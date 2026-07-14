//! Bounded, neutral-safe film dye-layer cross-talk and hue response.
//!
//! The profile is deliberately data-only. Both native and shader paths use the
//! same opponent decomposition, exposure interpolation, and periodic field.

use glam::Vec3;
use serde::{Deserialize, Serialize};

pub const MODEL_V1: &str = "opponent_coupler_v1";
pub const PERIODIC_BASIS_V1: &str = "periodic_cubic_bspline_v1";
const AP1_LUMINANCE: Vec3 = Vec3::new(0.272_228_72, 0.674_081_77, 0.053_689_52);
const EPSILON: f32 = 1.0e-8;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmHueWarpV1 {
    pub basis: String,
    pub knot_angles_deg: Vec<f32>,
    pub hue_delta_deg: Vec<f32>,
    pub log_chroma_delta: Vec<f32>,
    pub neutral_gate_c0: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmCouplerSafetyV1 {
    pub max_opponent_magnitude: f32,
    pub max_hue_delta_deg: f32,
    pub max_chroma_scale: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmColorCouplerV1 {
    pub model: String,
    pub exposure_anchors_ev: Vec<f32>,
    pub opponent_matrices: Vec<[[f32; 2]; 2]>,
    pub hue_warp: FilmHueWarpV1,
    pub safety: FilmCouplerSafetyV1,
}

impl FilmColorCouplerV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.model != MODEL_V1 {
            return Err("film_coupler_invalid_model");
        }
        if self.exposure_anchors_ev.len() < 2
            || self.exposure_anchors_ev.len() != self.opponent_matrices.len()
            || self
                .exposure_anchors_ev
                .windows(2)
                .any(|window| !window[0].is_finite() || window[0] >= window[1])
            || self
                .exposure_anchors_ev
                .last()
                .is_some_and(|value| !value.is_finite())
        {
            return Err("film_coupler_invalid_exposure_anchors");
        }
        for matrix in &self.opponent_matrices {
            if matrix
                .iter()
                .flatten()
                .any(|value| !value.is_finite() || value.abs() > 4.0)
            {
                return Err("film_coupler_invalid_matrix");
            }
            let determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
            let norm = matrix
                .iter()
                .flatten()
                .map(|value| value * value)
                .sum::<f32>()
                .sqrt();
            if determinant <= 0.0 || norm > 4.0 {
                return Err("film_coupler_matrix_out_of_bounds");
            }
        }
        let warp = &self.hue_warp;
        if warp.basis != PERIODIC_BASIS_V1
            || warp.knot_angles_deg.len() < 5
            || warp.knot_angles_deg.len() != warp.hue_delta_deg.len()
            || warp.knot_angles_deg.len() != warp.log_chroma_delta.len()
            || !warp.neutral_gate_c0.is_finite()
            || warp.neutral_gate_c0 <= 0.0
        {
            return Err("film_coupler_invalid_hue_warp");
        }
        if warp
            .knot_angles_deg
            .windows(2)
            .any(|window| !window[0].is_finite() || window[0] >= window[1])
            || warp.knot_angles_deg.first().copied() != Some(0.0)
            || warp.knot_angles_deg.last().copied() != Some(360.0)
            || warp
                .knot_angles_deg
                .windows(2)
                .map(|window| window[1] - window[0])
                .zip(
                    warp.knot_angles_deg
                        .windows(2)
                        .skip(1)
                        .map(|window| window[1] - window[0]),
                )
                .any(|(left, right)| (left - right).abs() > 1.0e-3)
            || warp.hue_delta_deg.iter().any(|value| !value.is_finite())
            || warp.log_chroma_delta.iter().any(|value| !value.is_finite())
            || warp.hue_delta_deg.first() != warp.hue_delta_deg.last()
            || warp.log_chroma_delta.first() != warp.log_chroma_delta.last()
        {
            return Err("film_coupler_non_periodic_hue_warp");
        }
        let safety = self.safety;
        if !safety.max_opponent_magnitude.is_finite()
            || !(0.01..=16.0).contains(&safety.max_opponent_magnitude)
            || !safety.max_hue_delta_deg.is_finite()
            || !(0.0..=180.0).contains(&safety.max_hue_delta_deg)
            || !safety.max_chroma_scale.is_finite()
            || !(1.0..=8.0).contains(&safety.max_chroma_scale)
        {
            return Err("film_coupler_invalid_safety");
        }
        if self
            .opponent_matrices
            .iter()
            .flat_map(|matrix| matrix.iter().flatten())
            .any(|value| !value.is_finite())
        {
            return Err("film_coupler_non_finite");
        }
        Ok(())
    }
}

fn interpolate_matrix(curve: &FilmColorCouplerV1, exposure_ev: f32) -> [[f32; 2]; 2] {
    let anchors = &curve.exposure_anchors_ev;
    let matrices = &curve.opponent_matrices;
    let segment = if exposure_ev <= anchors[0] {
        0
    } else if exposure_ev >= anchors[anchors.len() - 1] {
        anchors.len() - 2
    } else {
        anchors
            .windows(2)
            .position(|window| exposure_ev <= window[1])
            .unwrap_or(anchors.len() - 2)
    };
    let denominator = anchors[segment + 1] - anchors[segment];
    let t = ((exposure_ev - anchors[segment]) / denominator).clamp(0.0, 1.0);
    let left = matrices[segment];
    let right = matrices[segment + 1];
    [
        [
            left[0][0] + t * (right[0][0] - left[0][0]),
            left[0][1] + t * (right[0][1] - left[0][1]),
        ],
        [
            left[1][0] + t * (right[1][0] - left[1][0]),
            left[1][1] + t * (right[1][1] - left[1][1]),
        ],
    ]
}

fn periodic_cubic(values: &[f32], angle_deg: f32) -> f32 {
    let effective_len = values.len() - 1;
    let angle = angle_deg.rem_euclid(360.0);
    let segment = ((angle / 360.0) * effective_len as f32).floor() as usize % effective_len;
    let segment_start = 360.0 * segment as f32 / effective_len as f32;
    let segment_end = 360.0 * (segment + 1) as f32 / effective_len as f32;
    let t = ((angle - segment_start) / (segment_end - segment_start)).clamp(0.0, 1.0);
    let at = |index: usize| values[index % effective_len];
    let p0 = at(segment + effective_len - 1);
    let p1 = at(segment);
    let p2 = at(segment + 1);
    let p3 = at(segment + 2);
    0.5 * ((2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t)
}

pub fn apply(rgb_ap1: Vec3, exposure_ev: f32, curve: &FilmColorCouplerV1) -> Vec3 {
    if curve.validate().is_err() || !exposure_ev.is_finite() {
        return rgb_ap1;
    }
    let luminance = AP1_LUMINANCE.dot(rgb_ap1);
    if !luminance.is_finite() || luminance.abs() <= EPSILON {
        return rgb_ap1;
    }
    if (rgb_ap1 - Vec3::splat(luminance)).abs().max_element() <= 1.0e-6 {
        return rgb_ap1;
    }
    let normalized = (rgb_ap1 - Vec3::splat(luminance)) / luminance.abs();
    let opponent = [normalized.x - normalized.y, normalized.z - normalized.y];
    let matrix = interpolate_matrix(curve, exposure_ev);
    let transformed = [
        matrix[0][0] * opponent[0] + matrix[0][1] * opponent[1],
        matrix[1][0] * opponent[0] + matrix[1][1] * opponent[1],
    ];
    let chroma = transformed[0].hypot(transformed[1]);
    if !chroma.is_finite() || chroma <= EPSILON {
        return rgb_ap1;
    }
    let gate = chroma / (chroma + curve.hue_warp.neutral_gate_c0);
    let hue = transformed[1].atan2(transformed[0]);
    let hue_deg = hue.to_degrees().rem_euclid(360.0);
    let hue_delta = (gate * periodic_cubic(&curve.hue_warp.hue_delta_deg, hue_deg))
        .clamp(
            -curve.safety.max_hue_delta_deg,
            curve.safety.max_hue_delta_deg,
        )
        .to_radians();
    let chroma_scale = (gate * periodic_cubic(&curve.hue_warp.log_chroma_delta, hue_deg))
        .exp()
        .clamp(
            1.0 / curve.safety.max_chroma_scale,
            curve.safety.max_chroma_scale,
        );
    let output_chroma = (chroma * chroma_scale).min(curve.safety.max_opponent_magnitude);
    let output_hue = hue + hue_delta;
    let output_opponent = [
        output_chroma * output_hue.cos(),
        output_chroma * output_hue.sin(),
    ];
    let q_y = -(AP1_LUMINANCE.x * output_opponent[0] + AP1_LUMINANCE.z * output_opponent[1]);
    let q = Vec3::new(q_y + output_opponent[0], q_y, q_y + output_opponent[1]);
    let output = Vec3::splat(luminance) + q * luminance.abs();
    if output.is_finite() { output } else { rgb_ap1 }
}

pub fn reference() -> FilmColorCouplerV1 {
    FilmColorCouplerV1 {
        model: MODEL_V1.to_string(),
        exposure_anchors_ev: vec![-12.0, -4.0, 0.0, 4.0, 8.0],
        opponent_matrices: vec![
            [[1.02, 0.03], [-0.02, 0.98]],
            [[1.01, 0.02], [-0.015, 1.01]],
            [[1.0, 0.015], [-0.01, 1.02]],
            [[0.98, -0.01], [0.02, 1.03]],
            [[0.96, -0.02], [0.03, 1.04]],
        ],
        hue_warp: FilmHueWarpV1 {
            basis: PERIODIC_BASIS_V1.to_string(),
            knot_angles_deg: vec![0.0, 60.0, 120.0, 180.0, 240.0, 300.0, 360.0],
            hue_delta_deg: vec![0.0, 4.0, 7.0, 3.0, -2.0, -1.0, 0.0],
            log_chroma_delta: vec![0.0, 0.05, 0.08, -0.04, -0.06, 0.02, 0.0],
            neutral_gate_c0: 0.08,
        },
        safety: FilmCouplerSafetyV1 {
            max_opponent_magnitude: 1.5,
            max_hue_delta_deg: 12.0,
            max_chroma_scale: 1.35,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_axis_is_exact_and_finite_across_exposure() {
        let curve = reference();
        curve.validate().unwrap();
        for index in 0..=240 {
            let exposure = -12.0 + index as f32 / 12.0;
            let value = 2.0_f32.powf(exposure / 4.0 - 1.0);
            let output = apply(Vec3::splat(value), exposure, &curve);
            assert!((output - Vec3::splat(value)).abs().max_element() <= 1.0e-6);
        }
    }

    #[test]
    fn periodic_hue_field_is_continuous_at_wrap() {
        let curve = reference();
        let a = periodic_cubic(&curve.hue_warp.hue_delta_deg, 360.0 - 1.0e-4);
        let b = periodic_cubic(&curve.hue_warp.hue_delta_deg, 1.0e-4);
        assert!((a - b).abs() <= 1.0e-3);
    }

    #[test]
    fn malformed_profiles_and_extreme_values_fail_safe() {
        let mut curve = reference();
        curve.hue_warp.knot_angles_deg[1] = 70.0;
        assert_eq!(curve.validate(), Err("film_coupler_non_periodic_hue_warp"));
        let curve = reference();
        let output = apply(Vec3::new(-10.0, 1.0e5, 2.0), 8.0, &curve);
        assert!(output.is_finite());
    }
}
