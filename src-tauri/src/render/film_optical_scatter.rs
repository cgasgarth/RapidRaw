//! Bounded, scene-linear film halation and bloom reference stage.

use glam::Vec3;
use serde::{Deserialize, Serialize};

const AP1_LUMA: Vec3 = Vec3::new(0.27222872, 0.67408177, 0.05368952);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FilmBloomPlacementV1 {
    CapturePreResponse,
    PrintPrePaper,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmOpticalScatterV1 {
    pub model: String,
    pub halation: FilmOpticalHalationV1,
    pub bloom: Option<FilmOpticalBloomV1>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmOpticalHalationV1 {
    pub source_threshold_ev: [f32; 2],
    pub source_power: f32,
    pub radii_px_full_res: Vec<f32>,
    pub weights: Vec<f32>,
    pub core_radius_px_full_res: f32,
    pub core_rejection: f32,
    pub spectral_matrix: [[f32; 3]; 3],
    pub amount_default: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmOpticalBloomV1 {
    pub placement: FilmBloomPlacementV1,
    pub source_threshold_ev: [f32; 2],
    pub radii_px_full_res: Vec<f32>,
    pub weights: Vec<f32>,
    pub spectral_matrix: [[f32; 3]; 3],
    pub amount_default: f32,
}

impl FilmOpticalScatterV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.model != "multiscale_optical_scatter_v1" {
            return Err("film_optical_scatter_invalid_model");
        }
        validate_kernel(&self.halation.radii_px_full_res, &self.halation.weights)?;
        if !self.halation.source_threshold_ev[0].is_finite()
            || !self.halation.source_threshold_ev[1].is_finite()
            || self.halation.source_threshold_ev[1] <= self.halation.source_threshold_ev[0]
            || !self.halation.source_power.is_finite()
            || !(0.1..=4.0).contains(&self.halation.source_power)
            || !self.halation.core_radius_px_full_res.is_finite()
            || !(0.5..=256.0).contains(&self.halation.core_radius_px_full_res)
            || !self.halation.core_rejection.is_finite()
            || !(0.0..=1.0).contains(&self.halation.core_rejection)
            || !self.halation.amount_default.is_finite()
            || !(0.0..=1.0).contains(&self.halation.amount_default)
        {
            return Err("film_optical_scatter_invalid_halation");
        }
        validate_matrix(self.halation.spectral_matrix)?;
        if let Some(bloom) = &self.bloom {
            validate_kernel(&bloom.radii_px_full_res, &bloom.weights)?;
            if bloom.placement == FilmBloomPlacementV1::PrintPrePaper {
                return Err("film_optical_scatter_print_bloom_requires_print_stage");
            }
            if !bloom.source_threshold_ev[0].is_finite()
                || !bloom.source_threshold_ev[1].is_finite()
                || bloom.source_threshold_ev[1] <= bloom.source_threshold_ev[0]
                || !bloom.amount_default.is_finite()
                || !(0.0..=1.0).contains(&bloom.amount_default)
            {
                return Err("film_optical_scatter_invalid_bloom");
            }
            validate_matrix(bloom.spectral_matrix)?;
        }
        Ok(())
    }
}

pub fn reference() -> FilmOpticalScatterV1 {
    FilmOpticalScatterV1 {
        model: "multiscale_optical_scatter_v1".to_string(),
        halation: FilmOpticalHalationV1 {
            source_threshold_ev: [1.0, 3.0],
            source_power: 1.2,
            radii_px_full_res: vec![2.0, 6.0, 16.0],
            weights: vec![0.62, 0.28, 0.1],
            core_radius_px_full_res: 1.5,
            core_rejection: 0.75,
            spectral_matrix: [[1.0, 0.03, 0.0], [0.08, 0.72, 0.02], [0.02, 0.04, 0.42]],
            amount_default: 0.18,
        },
        bloom: Some(FilmOpticalBloomV1 {
            placement: FilmBloomPlacementV1::CapturePreResponse,
            source_threshold_ev: [2.0, 4.0],
            radii_px_full_res: vec![8.0, 24.0],
            weights: vec![0.75, 0.25],
            spectral_matrix: [[0.92, 0.02, 0.0], [0.02, 0.9, 0.02], [0.0, 0.02, 0.86]],
            amount_default: 0.06,
        }),
    }
}

pub fn apply(
    source: Vec3,
    halation_blur: Vec3,
    bloom_blur: Vec3,
    profile: &FilmOpticalScatterV1,
) -> Vec3 {
    if profile.validate().is_err()
        || !source.is_finite()
        || !halation_blur.is_finite()
        || !bloom_blur.is_finite()
    {
        return source;
    }
    let source_luma = AP1_LUMA.dot(source.max(Vec3::ZERO));
    let halation_gate = threshold_gate(source_luma, profile.halation.source_threshold_ev);
    let core_luma = source_luma * 0.2;
    let halo_luma = (AP1_LUMA.dot(halation_blur.max(Vec3::ZERO))
        - core_luma * profile.halation.core_rejection)
        .max(0.0);
    let halo_energy = halation_gate
        * halo_luma.powf(profile.halation.source_power)
        * profile.halation.amount_default;
    let halation = matrix_apply(profile.halation.spectral_matrix, Vec3::splat(halo_energy));
    let bloom = profile.bloom.as_ref().map_or(Vec3::ZERO, |bloom_profile| {
        let gate = threshold_gate(source_luma, bloom_profile.source_threshold_ev);
        matrix_apply(
            bloom_profile.spectral_matrix,
            bloom_blur.max(Vec3::ZERO) * gate * bloom_profile.amount_default,
        )
    });
    (source + halation + bloom).map(|value| if value.is_finite() { value } else { 0.0 })
}

fn threshold_gate(luma: f32, thresholds_ev: [f32; 2]) -> f32 {
    let ev = (luma.max(1.0e-6) / 0.18).log2();
    let t = ((ev - thresholds_ev[0]) / (thresholds_ev[1] - thresholds_ev[0])).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn validate_kernel(radii: &[f32], weights: &[f32]) -> Result<(), &'static str> {
    if radii.is_empty()
        || radii.len() != weights.len()
        || radii
            .iter()
            .any(|r| !r.is_finite() || !(0.5..=512.0).contains(r))
        || weights.iter().any(|w| !w.is_finite() || *w < 0.0)
        || weights.iter().all(|w| *w <= 1.0e-6)
    {
        return Err("film_optical_scatter_invalid_kernel");
    }
    Ok(())
}

fn validate_matrix(matrix: [[f32; 3]; 3]) -> Result<(), &'static str> {
    if matrix
        .iter()
        .flatten()
        .any(|value| !value.is_finite() || *value < 0.0 || *value > 2.0)
    {
        return Err("film_optical_scatter_invalid_matrix");
    }
    Ok(())
}

fn matrix_apply(matrix: [[f32; 3]; 3], value: Vec3) -> Vec3 {
    Vec3::new(
        matrix[0][0] * value.x + matrix[0][1] * value.y + matrix[0][2] * value.z,
        matrix[1][0] * value.x + matrix[1][1] * value.y + matrix[1][2] * value.z,
        matrix[2][0] * value.x + matrix[2][1] * value.y + matrix[2][2] * value.z,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_subthreshold_is_unchanged_and_highlight_is_bounded() {
        let profile = reference();
        let flat = Vec3::splat(0.18);
        assert_eq!(apply(flat, flat, flat, &profile), flat);
        let output = apply(
            Vec3::splat(20.0),
            Vec3::splat(5.0),
            Vec3::splat(5.0),
            &profile,
        );
        assert!(output.is_finite());
        assert!(output.x > 20.0 && output.x < 30.0);
        assert!(output.x > output.y && output.y > output.z);
    }

    #[test]
    fn invalid_print_bloom_fails_closed() {
        let mut profile = reference();
        profile.bloom.as_mut().unwrap().placement = FilmBloomPlacementV1::PrintPrePaper;
        assert!(profile.validate().is_err());
        let input = Vec3::splat(2.0);
        assert_eq!(apply(input, input, input, &profile), input);
    }
}
