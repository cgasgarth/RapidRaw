#![allow(dead_code)]

use serde::{Deserialize, Serialize};

const ALGORITHM_VERSION: u8 = 1;

fn default_transition_width() -> f32 {
    0.15
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegativeLabCmyTimingParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub global_c: f32,
    #[serde(default)]
    pub global_m: f32,
    #[serde(default)]
    pub global_y: f32,
    #[serde(default)]
    pub shadow_c: f32,
    #[serde(default)]
    pub shadow_m: f32,
    #[serde(default)]
    pub shadow_y: f32,
    #[serde(default)]
    pub highlight_c: f32,
    #[serde(default)]
    pub highlight_m: f32,
    #[serde(default)]
    pub highlight_y: f32,
    #[serde(default = "default_transition_width")]
    pub transition_width: f32,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub sign_convention: String,
    #[serde(default = "default_algorithm_version")]
    pub algorithm_version: u8,
}

fn default_algorithm_version() -> u8 {
    ALGORITHM_VERSION
}

impl Default for NegativeLabCmyTimingParams {
    fn default() -> Self {
        Self {
            enabled: false,
            global_c: 0.0,
            global_m: 0.0,
            global_y: 0.0,
            shadow_c: 0.0,
            shadow_m: 0.0,
            shadow_y: 0.0,
            highlight_c: 0.0,
            highlight_m: 0.0,
            highlight_y: 0.0,
            transition_width: default_transition_width(),
            source: "manual_global_v1".into(),
            sign_convention: "positive_density_reduces_channel_exposure_v1".into(),
            algorithm_version: ALGORITHM_VERSION,
        }
    }
}

impl NegativeLabCmyTimingParams {
    pub(crate) fn sanitized(self) -> Self {
        let finite = |v: f32| {
            if v.is_finite() {
                v.clamp(-1.0, 1.0)
            } else {
                0.0
            }
        };
        Self {
            enabled: self.enabled,
            global_c: finite(self.global_c),
            global_m: finite(self.global_m),
            global_y: finite(self.global_y),
            shadow_c: finite(self.shadow_c),
            shadow_m: finite(self.shadow_m),
            shadow_y: finite(self.shadow_y),
            highlight_c: finite(self.highlight_c),
            highlight_m: finite(self.highlight_m),
            highlight_y: finite(self.highlight_y),
            transition_width: if self.transition_width.is_finite() {
                self.transition_width.clamp(0.02, 0.5)
            } else {
                default_transition_width()
            },
            source: if self.source.trim().is_empty() {
                "manual_global_v1".into()
            } else {
                self.source
            },
            sign_convention: "positive_density_reduces_channel_exposure_v1".into(),
            algorithm_version: ALGORITHM_VERSION,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegativeLabCmyTimingMetrics {
    pub changed_pixel_ratio: f32,
    pub shadow_mask_ratio: f32,
    pub highlight_mask_ratio: f32,
    pub max_density_delta: f32,
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    let x = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

pub(crate) fn apply_cmy_timing(
    density: &mut [[f32; 3]],
    requested: &NegativeLabCmyTimingParams,
) -> NegativeLabCmyTimingMetrics {
    let params = requested.clone().sanitized();
    if !params.enabled {
        return NegativeLabCmyTimingMetrics::default();
    }
    let width = params.transition_width;
    let mut changed = 0usize;
    let mut shadow_count = 0usize;
    let mut highlight_count = 0usize;
    let mut max_delta = 0.0f32;
    for pixel in density.iter_mut() {
        let anchor = (pixel[0] + pixel[1] + pixel[2]) / 3.0;
        let shadow = smoothstep(0.5 - width, 0.5 + width, anchor);
        let highlight = 1.0 - shadow;
        if shadow > 0.01 {
            shadow_count += 1;
        }
        if highlight > 0.01 {
            highlight_count += 1;
        }
        let deltas = [
            params.global_c + shadow * params.shadow_c + highlight * params.highlight_c,
            params.global_m + shadow * params.shadow_m + highlight * params.highlight_m,
            params.global_y + shadow * params.shadow_y + highlight * params.highlight_y,
        ];
        for channel in 0..3 {
            max_delta = max_delta.max(deltas[channel].abs());
            pixel[channel] += deltas[channel];
        }
        if deltas.iter().any(|delta| delta.abs() > 1.0e-7) {
            changed += 1;
        }
    }
    let total = density.len().max(1) as f32;
    NegativeLabCmyTimingMetrics {
        changed_pixel_ratio: changed as f32 / total,
        shadow_mask_ratio: shadow_count as f32 / total,
        highlight_mask_ratio: highlight_count as f32 / total,
        max_density_delta: max_delta,
    }
}

pub(crate) fn apply_cmy_timing_pixel(
    mut density: [f32; 3],
    requested: &NegativeLabCmyTimingParams,
) -> [f32; 3] {
    let params = requested.clone().sanitized();
    if !params.enabled {
        return density;
    }
    let width = params.transition_width;
    let anchor = (density[0] + density[1] + density[2]) / 3.0;
    let shadow = smoothstep(0.5 - width, 0.5 + width, anchor);
    let highlight = 1.0 - shadow;
    let deltas = [
        params.global_c + shadow * params.shadow_c + highlight * params.highlight_c,
        params.global_m + shadow * params.shadow_m + highlight * params.highlight_m,
        params.global_y + shadow * params.shadow_y + highlight * params.highlight_y,
    ];
    for channel in 0..3 {
        density[channel] += deltas[channel];
    }
    density
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_is_exact_identity() {
        let mut density = vec![[0.2, 0.4, 0.6], [0.8, 0.7, 0.1]];
        let original = density.clone();
        let metrics = apply_cmy_timing(&mut density, &NegativeLabCmyTimingParams::default());
        assert_eq!(density, original);
        assert_eq!(metrics.changed_pixel_ratio, 0.0);
    }

    #[test]
    fn regional_filtering_targets_shadow_and_highlight_sides() {
        let mut density = vec![[0.9, 0.9, 0.9], [0.1, 0.1, 0.1]];
        let params = NegativeLabCmyTimingParams {
            enabled: true,
            shadow_c: 0.2,
            highlight_y: -0.2,
            ..Default::default()
        };
        let metrics = apply_cmy_timing(&mut density, &params);
        assert!(density[0][0] > 0.9 && (density[0][2] - 0.9).abs() < 1.0e-6);
        assert!(density[1][2] < 0.1 && (density[1][0] - 0.1).abs() < 1.0e-6);
        assert!(metrics.shadow_mask_ratio > 0.0 && metrics.highlight_mask_ratio > 0.0);
    }
}
