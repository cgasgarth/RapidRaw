//! Deterministic film-grain model evaluated in pseudo-density space.
//!
//! The profile is intentionally small and inspectable.  It is not a stock-film
//! claim; it supplies a stable, signal-dependent reference field that can be
//! shared by CPU and GPU paths without depending on display coordinates.

use glam::Vec3;
use serde::{Deserialize, Serialize};

const EPSILON: f32 = 1.0e-6;
const REFERENCE_SEED: u32 = 0x5241_5731;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmDensityGrainLayerV1 {
    pub radius_px_at_full_resolution: f32,
    pub weight: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmDensityGrainV1 {
    pub model: String,
    pub amount_default: f32,
    pub density_knots: Vec<f32>,
    pub sigma_by_channel: [Vec<f32>; 3],
    pub layers: Vec<FilmDensityGrainLayerV1>,
    pub channel_correlation: [[f32; 3]; 3],
    pub seed_policy: String,
    pub coordinate_space: String,
    pub preview_filter: String,
}

impl FilmDensityGrainV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.model != "layered_density_grain_v1"
            || self.seed_policy != "source_profile_user_v1"
            || self.coordinate_space != "oriented_source_full_resolution_v1"
            || self.preview_filter != "variance_preserving_mip_v1"
        {
            return Err("film_density_grain_invalid_contract");
        }
        if !self.amount_default.is_finite()
            || !(0.0..=2.0).contains(&self.amount_default)
            || self.density_knots.len() < 2
            || self.layers.is_empty()
        {
            return Err("film_density_grain_invalid_profile");
        }
        if self
            .density_knots
            .windows(2)
            .any(|pair| !pair[0].is_finite() || !pair[1].is_finite() || pair[1] <= pair[0])
        {
            return Err("film_density_grain_invalid_density_knots");
        }
        if self.sigma_by_channel.iter().any(|values| {
            values.len() != self.density_knots.len()
                || values.iter().any(|v| !v.is_finite() || *v < 0.0)
        }) {
            return Err("film_density_grain_invalid_sigma_curve");
        }
        if self.layers.iter().any(|layer| {
            !layer.radius_px_at_full_resolution.is_finite()
                || !(0.5..=1024.0).contains(&layer.radius_px_at_full_resolution)
                || !layer.weight.is_finite()
                || layer.weight < 0.0
        }) || self.layers.iter().all(|layer| layer.weight <= EPSILON)
        {
            return Err("film_density_grain_invalid_layers");
        }
        let mut diagonal = 0.0;
        for row in 0..3 {
            for column in 0..3 {
                let value = self.channel_correlation[row][column];
                if !value.is_finite() || value.abs() > 1.0 {
                    return Err("film_density_grain_invalid_correlation");
                }
                if (value - self.channel_correlation[column][row]).abs() > 1.0e-5 {
                    return Err("film_density_grain_invalid_correlation");
                }
            }
            if (self.channel_correlation[row][row] - 1.0).abs() > 1.0e-5 {
                return Err("film_density_grain_invalid_correlation");
            }
            diagonal += self.channel_correlation[row][row];
        }
        let determinant = self.channel_correlation[0][0]
            * (self.channel_correlation[1][1] * self.channel_correlation[2][2]
                - self.channel_correlation[1][2] * self.channel_correlation[2][1])
            - self.channel_correlation[0][1]
                * (self.channel_correlation[1][0] * self.channel_correlation[2][2]
                    - self.channel_correlation[1][2] * self.channel_correlation[2][0])
            + self.channel_correlation[0][2]
                * (self.channel_correlation[1][0] * self.channel_correlation[2][1]
                    - self.channel_correlation[1][1] * self.channel_correlation[2][0]);
        if diagonal <= EPSILON || determinant < -1.0e-5 {
            return Err("film_density_grain_invalid_correlation");
        }
        Ok(())
    }
}

pub fn reference() -> FilmDensityGrainV1 {
    FilmDensityGrainV1 {
        model: "layered_density_grain_v1".to_string(),
        amount_default: 0.24,
        density_knots: vec![0.0, 0.25, 0.75, 1.5, 2.5, 4.0],
        sigma_by_channel: [
            vec![0.18, 0.13, 0.09, 0.07, 0.1, 0.16],
            vec![0.16, 0.12, 0.085, 0.065, 0.095, 0.15],
            vec![0.2, 0.15, 0.1, 0.075, 0.11, 0.18],
        ],
        layers: vec![
            FilmDensityGrainLayerV1 {
                radius_px_at_full_resolution: 1.0,
                weight: 0.72,
            },
            FilmDensityGrainLayerV1 {
                radius_px_at_full_resolution: 3.5,
                weight: 0.28,
            },
        ],
        channel_correlation: [[1.0, 0.38, 0.22], [0.38, 1.0, 0.31], [0.22, 0.31, 1.0]],
        seed_policy: "source_profile_user_v1".to_string(),
        coordinate_space: "oriented_source_full_resolution_v1".to_string(),
        preview_filter: "variance_preserving_mip_v1".to_string(),
    }
}

pub fn apply(rgb: Vec3, x: u32, y: u32, profile: &FilmDensityGrainV1) -> Vec3 {
    if profile.validate().is_err() || !rgb.is_finite() {
        return rgb;
    }
    let weights: f32 = profile.layers.iter().map(|layer| layer.weight).sum();
    if weights <= EPSILON {
        return rgb;
    }
    let density = rgb.map(|value| -(value.abs().max(EPSILON)).log10());
    let sigma = Vec3::new(
        interpolate(
            &profile.density_knots,
            &profile.sigma_by_channel[0],
            density.x,
        ),
        interpolate(
            &profile.density_knots,
            &profile.sigma_by_channel[1],
            density.y,
        ),
        interpolate(
            &profile.density_knots,
            &profile.sigma_by_channel[2],
            density.z,
        ),
    );
    let independent = Vec3::new(
        layered_noise(x, y, 0, profile),
        layered_noise(x, y, 1, profile),
        layered_noise(x, y, 2, profile),
    );
    let correlated = cholesky_multiply(independent, profile.channel_correlation);
    let perturbed_density = density + sigma * correlated * profile.amount_default;
    Vec3::new(
        signed_transmittance(perturbed_density.x, rgb.x),
        signed_transmittance(perturbed_density.y, rgb.y),
        signed_transmittance(perturbed_density.z, rgb.z),
    )
}

fn signed_transmittance(density: f32, original: f32) -> f32 {
    let value = 10.0_f32.powf(-density.clamp(-8.0, 8.0));
    value.copysign(original)
}

fn interpolate(knots: &[f32], values: &[f32], value: f32) -> f32 {
    if value <= knots[0] {
        return values[0];
    }
    for index in 1..knots.len() {
        if value <= knots[index] {
            let t = (value - knots[index - 1]) / (knots[index] - knots[index - 1]);
            return values[index - 1] * (1.0 - t) + values[index] * t;
        }
    }
    *values.last().unwrap_or(&0.0)
}

fn layered_noise(x: u32, y: u32, channel: u32, profile: &FilmDensityGrainV1) -> f32 {
    let weight_sum: f32 = profile
        .layers
        .iter()
        .map(|layer| layer.weight * layer.weight)
        .sum();
    let mut value = 0.0;
    for (layer_index, layer) in profile.layers.iter().enumerate() {
        let scale = layer.radius_px_at_full_resolution.max(0.5);
        let fx = x as f32 / scale;
        let fy = y as f32 / scale;
        value += bilinear_hash(fx, fy, REFERENCE_SEED, layer_index as u32, channel) * layer.weight;
    }
    value / weight_sum.max(EPSILON).sqrt()
}

fn bilinear_hash(x: f32, y: f32, seed: u32, layer: u32, channel: u32) -> f32 {
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let tx = smoothstep(x - x0 as f32);
    let ty = smoothstep(y - y0 as f32);
    let a = hash_noise(seed, x0, y0, layer, channel);
    let b = hash_noise(seed, x0 + 1, y0, layer, channel);
    let c = hash_noise(seed, x0, y0 + 1, layer, channel);
    let d = hash_noise(seed, x0 + 1, y0 + 1, layer, channel);
    a * (1.0 - tx) * (1.0 - ty) + b * tx * (1.0 - ty) + c * (1.0 - tx) * ty + d * tx * ty
}

fn smoothstep(value: f32) -> f32 {
    value * value * (3.0 - 2.0 * value)
}

fn hash_noise(seed: u32, x: i32, y: i32, layer: u32, channel: u32) -> f32 {
    let mut value = seed ^ (x as u32).wrapping_mul(0x9e37_79b9);
    value ^= (y as u32).wrapping_mul(0x85eb_ca6b);
    value ^= layer.wrapping_mul(0xc2b2_ae35);
    value ^= channel.wrapping_mul(0x27d4_eb2d);
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846c_a68b);
    value ^= value >> 16;
    (value as f32 / u32::MAX as f32) * 2.0 - 1.0
}

fn cholesky_multiply(noise: Vec3, correlation: [[f32; 3]; 3]) -> Vec3 {
    let l00 = correlation[0][0].sqrt();
    let l10 = correlation[1][0] / l00.max(EPSILON);
    let l20 = correlation[2][0] / l00.max(EPSILON);
    let l11 = (correlation[1][1] - l10 * l10).max(0.0).sqrt();
    let l21 = (correlation[2][1] - l20 * l10) / l11.max(EPSILON);
    let l22 = (correlation[2][2] - l20 * l20 - l21 * l21).max(0.0).sqrt();
    Vec3::new(
        l00 * noise.x,
        l10 * noise.x + l11 * noise.y,
        l20 * noise.x + l21 * noise.y + l22 * noise.z,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_density_grain_is_finite_and_coordinate_stable() {
        let profile = reference();
        let input = Vec3::splat(0.35);
        let first = apply(input, 120, 80, &profile);
        assert_eq!(first, apply(input, 120, 80, &profile));
        assert!(first.is_finite());
        assert_ne!(first, input);
        assert_ne!(first, apply(input, 121, 80, &profile));
    }

    #[test]
    fn invalid_profiles_fail_closed_without_nan() {
        let mut profile = reference();
        profile.channel_correlation[0][1] = 0.8;
        assert!(profile.validate().is_err());
        let input = Vec3::new(-10.0, 0.0, 10.0);
        assert_eq!(apply(input, 0, 0, &profile), input);
    }
}
