//! Scene-log/opponent residual CLUT support for the film node.
//!
//! Residuals are stored as deltas in exposure/opponent coordinates. The
//! parametric film model remains authoritative: the residual fades at the
//! calibrated boundary and its chromatic contribution is zero on neutral.

#![allow(dead_code)]

use glam::Vec3;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const RESIDUAL_MODEL: &str = "scene_log_opponent_residual_tetrahedral_v1";
pub const WORKING_SPACE: &str = "acescg_linear_v1";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilmResidualLutStorageV1 {
    F16Le,
    F32Le,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmResidualLutManifestV1 {
    pub model: String,
    pub working_space: String,
    pub grid_size: u32,
    pub exposure_domain_ev: [f32; 2],
    pub opponent_domain: [[f32; 2]; 2],
    pub edge_fade_fraction: f32,
    pub neutral_gate_c0: f32,
    pub storage: FilmResidualLutStorageV1,
    pub asset_path: String,
    pub asset_sha256: String,
    pub decoded_value_sha256: String,
}

impl FilmResidualLutManifestV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.model != RESIDUAL_MODEL || self.working_space != WORKING_SPACE {
            return Err("film_residual_lut_invalid_domain");
        }
        if !matches!(self.grid_size, 17 | 33) {
            return Err("film_residual_lut_invalid_grid_size");
        }
        if !ordered(self.exposure_domain_ev)
            || !ordered(self.opponent_domain[0])
            || !ordered(self.opponent_domain[1])
            || !self.edge_fade_fraction.is_finite()
            || !(0.01..=0.5).contains(&self.edge_fade_fraction)
            || !self.neutral_gate_c0.is_finite()
            || !(0.0..=1.0).contains(&self.neutral_gate_c0)
            || self.asset_path.trim().is_empty()
            || !is_sha256(&self.asset_sha256)
            || !is_sha256(&self.decoded_value_sha256)
        {
            return Err("film_residual_lut_invalid_manifest");
        }
        Ok(())
    }
}

fn ordered(bounds: [f32; 2]) -> bool {
    bounds[0].is_finite() && bounds[1].is_finite() && bounds[0] < bounds[1]
}

fn is_sha256(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

#[derive(Clone, Debug, PartialEq)]
pub struct FilmResidualLutV1 {
    pub manifest: FilmResidualLutManifestV1,
    pub values: Vec<[f32; 3]>,
}

impl FilmResidualLutV1 {
    pub fn from_f32_le_bytes(
        manifest: FilmResidualLutManifestV1,
        bytes: &[u8],
    ) -> Result<Self, &'static str> {
        manifest.validate()?;
        if manifest.storage != FilmResidualLutStorageV1::F32Le {
            return Err("film_residual_lut_storage_not_supported");
        }
        let expected_values = (manifest.grid_size as usize).pow(3);
        if bytes.len() != expected_values * 3 * 4 {
            return Err("film_residual_lut_byte_length_mismatch");
        }
        let decoded_hash = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
        if decoded_hash != manifest.decoded_value_sha256 {
            return Err("film_residual_lut_decoded_hash_mismatch");
        }
        let values = bytes
            .chunks_exact(12)
            .map(|chunk| {
                [
                    f32::from_le_bytes(chunk[0..4].try_into().unwrap()),
                    f32::from_le_bytes(chunk[4..8].try_into().unwrap()),
                    f32::from_le_bytes(chunk[8..12].try_into().unwrap()),
                ]
            })
            .collect();
        Ok(Self { manifest, values })
    }

    fn value(&self, x: usize, y: usize, z: usize) -> [f32; 3] {
        let size = self.manifest.grid_size as usize;
        self.values[z * size * size + y * size + x]
    }
}

fn lerp(a: [f32; 3], b: [f32; 3], amount: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * amount,
        a[1] + (b[1] - a[1]) * amount,
        a[2] + (b[2] - a[2]) * amount,
    ]
}

/// Normative six-case tetrahedral interpolation over normalized [0,1]^3.
pub fn sample_tetrahedral(lut: &FilmResidualLutV1, coordinates: [f32; 3]) -> [f32; 3] {
    let max_index = lut.manifest.grid_size as usize - 1;
    let scaled = coordinates.map(|value| value.clamp(0.0, 1.0) * max_index as f32);
    let base = scaled
        .map(|value| value.floor() as usize)
        .map(|value| value.min(max_index));
    let fraction = scaled.map(|value| value.fract());
    let upper = base.map(|value| (value + 1).min(max_index));
    let c000 = lut.value(base[0], base[1], base[2]);
    let c111 = lut.value(upper[0], upper[1], upper[2]);
    if fraction[0] >= fraction[1] {
        if fraction[1] >= fraction[2] {
            mix4(
                c000,
                lut.value(upper[0], base[1], base[2]),
                lut.value(upper[0], upper[1], base[2]),
                c111,
                fraction[0],
                fraction[1],
                fraction[2],
            )
        } else if fraction[0] >= fraction[2] {
            mix4(
                c000,
                lut.value(upper[0], base[1], base[2]),
                lut.value(upper[0], base[1], upper[2]),
                c111,
                fraction[0],
                fraction[2],
                fraction[1],
            )
        } else {
            mix4(
                c000,
                lut.value(base[0], base[1], upper[2]),
                lut.value(upper[0], base[1], upper[2]),
                c111,
                fraction[2],
                fraction[0],
                fraction[1],
            )
        }
    } else if fraction[2] >= fraction[1] {
        mix4(
            c000,
            lut.value(base[0], base[1], upper[2]),
            lut.value(base[0], upper[1], upper[2]),
            c111,
            fraction[2],
            fraction[1],
            fraction[0],
        )
    } else if fraction[2] >= fraction[0] {
        mix4(
            c000,
            lut.value(base[0], upper[1], base[2]),
            lut.value(base[0], upper[1], upper[2]),
            c111,
            fraction[1],
            fraction[2],
            fraction[0],
        )
    } else {
        mix4(
            c000,
            lut.value(base[0], upper[1], base[2]),
            lut.value(upper[0], upper[1], base[2]),
            c111,
            fraction[1],
            fraction[0],
            fraction[2],
        )
    }
}

fn mix4(
    c000: [f32; 3],
    c1: [f32; 3],
    c2: [f32; 3],
    c111: [f32; 3],
    major: f32,
    middle: f32,
    minor: f32,
) -> [f32; 3] {
    lerp(
        lerp(lerp(c000, c1, major - middle), c2, middle - minor),
        c111,
        minor,
    )
}

/// Applies a residual in scene-log/opponent coordinates. Outside the calibrated
/// cube, the residual fades to zero instead of repeating the edge voxel.
pub fn apply_scene_log_residual(rgb: Vec3, lut: &FilmResidualLutV1) -> Vec3 {
    let luminance = (Vec3::new(0.2722287, 0.6740818, 0.0536895).dot(rgb)).max(1.0e-6);
    let exposure = (luminance / 0.18).log2();
    let opponent = [rgb.x - rgb.y, rgb.y - rgb.z];
    let domains = [
        lut.manifest.exposure_domain_ev,
        lut.manifest.opponent_domain[0],
        lut.manifest.opponent_domain[1],
    ];
    let values = [exposure, opponent[0], opponent[1]];
    let normalized = [
        (values[0] - domains[0][0]) / (domains[0][1] - domains[0][0]),
        (values[1] - domains[1][0]) / (domains[1][1] - domains[1][0]),
        (values[2] - domains[2][0]) / (domains[2][1] - domains[2][0]),
    ];
    let residual = sample_tetrahedral(lut, normalized);
    let distance = normalized
        .iter()
        .map(|value| (value - 0.5).abs() * 2.0)
        .fold(0.0, f32::max);
    let fade_start = (1.0 - lut.manifest.edge_fade_fraction).clamp(0.0, 1.0);
    let fade = 1.0 - ((distance - fade_start) / (1.0 - fade_start).max(1.0e-6)).clamp(0.0, 1.0);
    let chroma = opponent[0].abs() + opponent[1].abs();
    let neutral_gate = chroma / (chroma + lut.manifest.neutral_gate_c0.max(1.0e-6));
    let shaped = Vec3::new(
        exposure + residual[0] * fade,
        opponent[0] + residual[1] * fade * neutral_gate,
        opponent[1] + residual[2] * fade * neutral_gate,
    );
    let luminance_delta = 2.0_f32.powf(shaped.x) * 0.18 / luminance;
    Vec3::new(
        rgb.x * luminance_delta + shaped.y * 0.02,
        rgb.y * luminance_delta - shaped.y * 0.01 + shaped.z * 0.01,
        rgb.z * luminance_delta - shaped.z * 0.02,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(values: Vec<[f32; 3]>) -> FilmResidualLutV1 {
        FilmResidualLutV1 {
            manifest: FilmResidualLutManifestV1 {
                model: RESIDUAL_MODEL.into(),
                working_space: WORKING_SPACE.into(),
                grid_size: 2,
                exposure_domain_ev: [-1.0, 1.0],
                opponent_domain: [[-1.0, 1.0], [-1.0, 1.0]],
                edge_fade_fraction: 0.2,
                neutral_gate_c0: 0.02,
                storage: FilmResidualLutStorageV1::F32Le,
                asset_path: "fixture".into(),
                asset_sha256: format!("sha256:{}", "a".repeat(64)),
                decoded_value_sha256: format!("sha256:{}", "b".repeat(64)),
            },
            values,
        }
    }

    #[test]
    fn zero_lattice_is_identity_and_neutral_axis_has_no_chroma() {
        let lut = fixture(vec![[0.0; 3]; 8]);
        assert_eq!(sample_tetrahedral(&lut, [0.2, 0.4, 0.7]), [0.0; 3]);
        let output = apply_scene_log_residual(Vec3::splat(0.18), &lut);
        assert!((output.x - output.y).abs() < 1.0e-6 && (output.y - output.z).abs() < 1.0e-6);
    }

    #[test]
    fn tetrahedral_cases_and_domain_fade_are_bounded() {
        let lut = fixture((0..8).map(|index| [index as f32, 0.0, 0.0]).collect());
        for coordinates in [
            [0.1, 0.2, 0.3],
            [0.9, 0.2, 0.1],
            [0.1, 0.9, 0.2],
            [0.2, 0.1, 0.9],
            [0.8, 0.7, 0.9],
            [0.9, 0.9, 0.8],
        ] {
            assert!(sample_tetrahedral(&lut, coordinates)[0].is_finite());
        }
        let faded = apply_scene_log_residual(Vec3::splat(100.0), &lut);
        assert!(faded.is_finite() && faded.max_element() < 1000.0);
    }
}
