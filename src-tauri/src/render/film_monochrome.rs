//! Honest RGB-tristimulus monochrome response: sensitivity/filter weighting,
//! shared monotone characteristic response, and bounded paper endpoints.

#![allow(dead_code)]

use glam::Vec3;
use serde::{Deserialize, Serialize};

use super::film_characteristic_curve::{FilmCharacteristicCurveV1, REFERENCE_GRAY};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilmMonochromeFilterV1 {
    pub id: String,
    pub gains_rgb: [f32; 3],
    pub filter_factor_stops: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilmMonochromePaperToneV1 {
    pub black_ap1: [f32; 3],
    pub white_ap1: [f32; 3],
    pub paper_white_xy: [f32; 2],
    pub black_density: f32,
    pub amount: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilmMonochromeResponseV1 {
    pub model: String,
    pub sensitivity_rgb: [f32; 3],
    pub calibration_illuminant: String,
    pub limitation_statement: String,
    pub default_filter: FilmMonochromeFilterV1,
    pub characteristic_curve: FilmCharacteristicCurveV1,
    pub paper_tone: Option<FilmMonochromePaperToneV1>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FilmMonochromeDiagnostics {
    pub scalar_floor_count: u32,
    pub filter_factor_stops: f32,
}

fn normalized_nonnegative(values: [f32; 3]) -> Option<Vec3> {
    if values
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0)
    {
        return None;
    }
    let norm = (values[0] * values[0] + values[1] * values[1] + values[2] * values[2]).sqrt();
    (norm > f32::EPSILON).then(|| Vec3::from_array(values) / norm)
}

pub fn apply_film_monochrome(
    rgb_ap1: Vec3,
    response: &FilmMonochromeResponseV1,
    filter: &FilmMonochromeFilterV1,
) -> Result<(Vec3, FilmMonochromeDiagnostics), &'static str> {
    if response.model != "rgb_tristimulus_monochrome_v1" {
        return Err("film_monochrome_invalid_model");
    }
    let sensitivity = normalized_nonnegative(response.sensitivity_rgb)
        .ok_or("film_monochrome_invalid_sensitivity")?;
    let gains = normalized_nonnegative(filter.gains_rgb).ok_or("film_monochrome_invalid_filter")?;
    let product = sensitivity * gains;
    let neutral = sensitivity.dot(gains).max(f32::EPSILON);
    let mut diagnostics = FilmMonochromeDiagnostics {
        filter_factor_stops: filter.filter_factor_stops,
        ..Default::default()
    };
    let irradiance = product.dot(rgb_ap1) / neutral * 2.0_f32.powf(-filter.filter_factor_stops);
    let scalar = irradiance.max(f32::EPSILON);
    if irradiance < f32::EPSILON {
        diagnostics.scalar_floor_count = 1;
    }
    let exposure_ev = (scalar / REFERENCE_GRAY).log2();
    let response_ev = response.characteristic_curve.evaluate(exposure_ev)?;
    let reflectance = (REFERENCE_GRAY * 2.0_f32.powf(response_ev)).max(0.0);
    let mono = Vec3::splat(reflectance);
    let output = if let Some(paper) = &response.paper_tone {
        let amount = paper.amount.clamp(0.0, 1.0);
        let black = Vec3::from_array(paper.black_ap1);
        let white = Vec3::from_array(paper.white_ap1);
        mono.lerp(
            black + reflectance.clamp(0.0, 1.0) * (white - black),
            amount,
        )
    } else {
        mono
    };
    Ok((output, diagnostics))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::film_characteristic_curve::reference_curve;

    fn fixture() -> FilmMonochromeResponseV1 {
        FilmMonochromeResponseV1 {
            model: "rgb_tristimulus_monochrome_v1".into(),
            sensitivity_rgb: [0.65, 1.0, 0.45],
            calibration_illuminant: "D65".into(),
            limitation_statement: "Engineered RGB approximation; not spectral reconstruction."
                .into(),
            default_filter: FilmMonochromeFilterV1 {
                id: "none".into(),
                gains_rgb: [1.0, 1.0, 1.0],
                filter_factor_stops: 0.0,
            },
            characteristic_curve: reference_curve(),
            paper_tone: None,
        }
    }
    #[test]
    fn neutral_is_exposure_invariant_across_filter_normalization() {
        let response = fixture();
        let none = apply_film_monochrome(Vec3::splat(0.18), &response, &response.default_filter)
            .unwrap()
            .0;
        let yellow = FilmMonochromeFilterV1 {
            id: "yellow".into(),
            gains_rgb: [1.0, 0.8, 0.2],
            filter_factor_stops: 0.0,
        };
        let filtered = apply_film_monochrome(Vec3::splat(0.18), &response, &yellow)
            .unwrap()
            .0;
        assert!((none.x - filtered.x).abs() < 1.0e-5);
        assert!(
            (filtered.x - filtered.y).abs() < 1.0e-6 && (filtered.y - filtered.z).abs() < 1.0e-6
        );
    }
    #[test]
    fn negative_components_floor_scalar_without_chromatic_leakage() {
        let response = fixture();
        let (output, diagnostics) = apply_film_monochrome(
            Vec3::new(-2.0, -1.0, -0.5),
            &response,
            &response.default_filter,
        )
        .unwrap();
        assert_eq!(diagnostics.scalar_floor_count, 1);
        assert!((output.x - output.y).abs() < 1.0e-6 && (output.y - output.z).abs() < 1.0e-6);
    }
    #[test]
    fn paper_tone_stays_between_declared_endpoints() {
        let mut response = fixture();
        response.paper_tone = Some(FilmMonochromePaperToneV1 {
            black_ap1: [0.01, 0.008, 0.006],
            white_ap1: [0.9, 0.92, 0.95],
            paper_white_xy: [0.31, 0.33],
            black_density: 1.6,
            amount: 1.0,
        });
        let output = apply_film_monochrome(Vec3::splat(0.18), &response, &response.default_filter)
            .unwrap()
            .0;
        assert!(output.min_element() >= 0.0 && output.max_element() <= 1.0);
    }
}
