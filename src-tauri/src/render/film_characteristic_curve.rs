//! Versioned, monotone film exposure-response curves.
//!
//! The source payload is the profile contract. Tangents are derived with the
//! Fritsch-Carlson limiter at evaluation time, so persisted state cannot smuggle
//! executable coefficients into the render graph.

use glam::Vec3;
use serde::{Deserialize, Serialize};

pub const MODEL_V1: &str = "monotone_pchip_v1";
pub const REFERENCE_GRAY: f32 = 0.18;
pub const LUMINANCE_EPSILON: f32 = 1.0e-8;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilmCurvePolarity {
    DirectPositive,
    NegativeDensity,
    PositiveDensity,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmDensityRangeV1 {
    pub d_min: [f32; 3],
    pub d_max: [f32; 3],
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmCharacteristicCurveV1 {
    pub model: String,
    pub polarity: FilmCurvePolarity,
    pub reference_gray: f32,
    pub domain_ev: [f32; 2],
    pub exposure_knots_ev: Vec<f32>,
    pub response_knots: Vec<f32>,
    pub endpoint_slope: [f32; 2],
    pub density: Option<FilmDensityRangeV1>,
}

impl FilmCharacteristicCurveV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.model != MODEL_V1 {
            return Err("film_curve_invalid_model");
        }
        if !self.reference_gray.is_finite() || self.reference_gray <= 0.0 {
            return Err("film_curve_invalid_reference_gray");
        }
        if !self.domain_ev[0].is_finite()
            || !self.domain_ev[1].is_finite()
            || self.domain_ev[0] >= self.domain_ev[1]
            || self.exposure_knots_ev.len() < 5
            || self.exposure_knots_ev.len() != self.response_knots.len()
            || self.exposure_knots_ev.first().copied() != Some(self.domain_ev[0])
            || self.exposure_knots_ev.last().copied() != Some(self.domain_ev[1])
        {
            return Err("film_curve_invalid_domain_or_knots");
        }
        if self
            .exposure_knots_ev
            .iter()
            .chain(self.response_knots.iter())
            .chain(self.endpoint_slope.iter())
            .any(|value| !value.is_finite())
        {
            return Err("film_curve_non_finite");
        }
        if self
            .exposure_knots_ev
            .windows(2)
            .any(|window| window[0] >= window[1])
            || self
                .response_knots
                .windows(2)
                .any(|window| window[0] > window[1])
            || self.endpoint_slope.iter().any(|slope| *slope < 0.0)
        {
            return Err("film_curve_not_monotone");
        }
        let anchor_index = self
            .exposure_knots_ev
            .iter()
            .position(|exposure| exposure.abs() <= f32::EPSILON)
            .ok_or("film_curve_missing_gray_anchor")?;
        if (self.response_knots[anchor_index]).abs() > 1.0e-6 {
            return Err("film_curve_gray_anchor_mismatch");
        }
        if let Some(density) = &self.density
            && (density
                .d_min
                .iter()
                .chain(density.d_max.iter())
                .any(|value| !value.is_finite())
                || density
                    .d_min
                    .iter()
                    .zip(density.d_max.iter())
                    .any(|(min, max)| min >= max))
        {
            return Err("film_curve_invalid_density_range");
        }
        Ok(())
    }

    pub fn evaluate(&self, exposure_ev: f32) -> Result<f32, &'static str> {
        self.validate()?;
        if !exposure_ev.is_finite() {
            return Err("film_curve_non_finite");
        }
        let slopes = fritsch_carlson_slopes(&self.exposure_knots_ev, &self.response_knots)?;
        Ok(evaluate_with_slopes(
            exposure_ev,
            &self.exposure_knots_ev,
            &self.response_knots,
            &slopes,
        ))
    }

    #[allow(dead_code)]
    pub fn evaluate_density(
        &self,
        exposure_ev: f32,
    ) -> Result<FilmDensityDiagnosticV1, &'static str> {
        if self.polarity == FilmCurvePolarity::DirectPositive {
            return Err("film_curve_density_requires_density_polarity");
        }
        let normalized = self.evaluate(exposure_ev)?.clamp(0.0, 1.0);
        let density = self
            .density
            .as_ref()
            .ok_or("film_curve_missing_density_range")?;
        let density_value = density.d_min[0] + (density.d_max[0] - density.d_min[0]) * normalized;
        Ok(FilmDensityDiagnosticV1 {
            density: density_value,
            normalized,
            transmittance: 10.0_f32.powf(-density_value),
        })
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FilmDensityDiagnosticV1 {
    pub density: f32,
    pub normalized: f32,
    pub transmittance: f32,
}

pub fn apply_direct_positive(rgb_ap1: Vec3, curve: &FilmCharacteristicCurveV1) -> Vec3 {
    let luminance = Vec3::new(0.272_228_72, 0.674_081_77, 0.053_689_52).dot(rgb_ap1);
    if !luminance.is_finite() || luminance <= LUMINANCE_EPSILON {
        return rgb_ap1;
    }
    let exposure_ev = (luminance / REFERENCE_GRAY).max(LUMINANCE_EPSILON).log2();
    let output_ev = curve.evaluate(exposure_ev).unwrap_or(exposure_ev);
    let scale = 2.0_f32.powf(output_ev - exposure_ev);
    rgb_ap1 * scale
}

fn fritsch_carlson_slopes(x: &[f32], y: &[f32]) -> Result<Vec<f32>, &'static str> {
    if x.len() < 2 || x.len() != y.len() {
        return Err("film_curve_invalid_knots");
    }
    let h: Vec<f32> = x.windows(2).map(|window| window[1] - window[0]).collect();
    let delta: Vec<f32> = y
        .windows(2)
        .zip(h.iter())
        .map(|(window, step)| (window[1] - window[0]) / step)
        .collect();
    let mut slopes = vec![0.0; x.len()];
    slopes[0] = delta[0];
    slopes[x.len() - 1] = delta[delta.len() - 1];
    for index in 1..x.len() - 1 {
        if delta[index - 1] * delta[index] <= 0.0 {
            slopes[index] = 0.0;
            continue;
        }
        let w1 = 2.0 * h[index] + h[index - 1];
        let w2 = h[index] + 2.0 * h[index - 1];
        slopes[index] = (w1 + w2) / (w1 / delta[index - 1] + w2 / delta[index]);
    }
    Ok(slopes)
}

fn evaluate_with_slopes(value: f32, x: &[f32], y: &[f32], slopes: &[f32]) -> f32 {
    let segment = if value <= x[0] {
        0
    } else if value >= x[x.len() - 1] {
        x.len() - 2
    } else {
        x.windows(2)
            .position(|window| value <= window[1])
            .unwrap_or(x.len() - 2)
    };
    let h = x[segment + 1] - x[segment];
    if value < x[0] {
        return y[0] + slopes[0] * (value - x[0]);
    }
    if value > x[x.len() - 1] {
        return y[y.len() - 1] + slopes[slopes.len() - 1] * (value - x[x.len() - 1]);
    }
    let t = (value - x[segment]) / h;
    let h00 = (1.0 + 2.0 * t) * (1.0 - t) * (1.0 - t);
    let h10 = t * (1.0 - t) * (1.0 - t);
    let h01 = t * t * (3.0 - 2.0 * t);
    let h11 = t * t * (t - 1.0);
    h00 * y[segment]
        + h10 * h * slopes[segment]
        + h01 * y[segment + 1]
        + h11 * h * slopes[segment + 1]
}

pub fn reference_curve() -> FilmCharacteristicCurveV1 {
    FilmCharacteristicCurveV1 {
        model: MODEL_V1.to_string(),
        polarity: FilmCurvePolarity::DirectPositive,
        reference_gray: REFERENCE_GRAY,
        domain_ev: [-12.0, 8.0],
        exposure_knots_ev: vec![-12.0, -6.0, -2.0, 0.0, 2.0, 5.0, 8.0],
        response_knots: vec![-10.8, -5.7, -1.8, 0.0, 1.75, 3.9, 5.6],
        endpoint_slope: [0.84, 0.48],
        density: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_curve_is_finite_monotone_and_gray_anchored() {
        let curve = reference_curve();
        curve.validate().unwrap();
        let mut previous = f32::NEG_INFINITY;
        for index in 0..4096 {
            let exposure = -16.0 + 28.0 * index as f32 / 4095.0;
            let value = curve.evaluate(exposure).unwrap();
            assert!(value.is_finite() && value >= previous);
            previous = value;
        }
        assert!(curve.evaluate(0.0).unwrap().abs() <= 1.0e-6);
    }

    #[test]
    fn malformed_curves_are_rejected() {
        let mut curve = reference_curve();
        curve.exposure_knots_ev[2] = curve.exposure_knots_ev[1];
        assert_eq!(curve.validate(), Err("film_curve_not_monotone"));
        let mut curve = reference_curve();
        curve.response_knots[3] = 0.2;
        assert_eq!(curve.validate(), Err("film_curve_gray_anchor_mismatch"));
    }

    #[test]
    fn direct_positive_preserves_neutral_and_extended_components() {
        let curve = reference_curve();
        let neutral = apply_direct_positive(Vec3::splat(0.18), &curve);
        assert!((neutral.x - neutral.y).abs() <= 1.0e-6);
        let extended = apply_direct_positive(Vec3::new(-0.2, 2.0, 0.5), &curve);
        assert!(extended.is_finite() && extended.x < 0.0 && extended.y > 1.0);
    }

    #[test]
    fn density_modes_emit_typed_finite_diagnostics() {
        let mut curve = reference_curve();
        curve.polarity = FilmCurvePolarity::PositiveDensity;
        curve.density = Some(FilmDensityRangeV1 {
            d_min: [0.1, 0.1, 0.1],
            d_max: [2.0, 2.0, 2.0],
        });
        let diagnostic = curve.evaluate_density(0.0).unwrap();
        assert!(diagnostic.density.is_finite() && diagnostic.transmittance.is_finite());
    }
}
