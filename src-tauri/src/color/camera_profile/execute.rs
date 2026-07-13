use anyhow::{Result, ensure};
use serde::Serialize;

use super::{
    CAMERA_PROFILE_CONTRACT, CameraIdentityMatch, CameraProfileReceiptV1, CameraProfileSource,
    DcpProfileV1, HsvDelta, ProfileTable, ProfileTableEncoding, ToneCurvePoint,
};
use crate::color::white_balance::ProfileIlluminantV1;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CompiledCameraProfilePlanV1 {
    pub matrix: [[f64; 3]; 3],
    pub analog_balance: [f64; 3],
    pub camera_calibration: [[f64; 3]; 3],
    pub color_matrix: [[f64; 3]; 3],
    pub forward_matrix: Option<[[f64; 3]; 3]>,
    pub technical_table: Option<ProfileTable>,
    pub creative_table: Option<ProfileTable>,
    pub tone_curve: Vec<ToneCurvePoint>,
    pub baseline_exposure_ev: f32,
    pub creative_amount: f32,
    pub receipt: CameraProfileReceiptV1,
}

pub(crate) fn compile_camera_profile(
    profile: &DcpProfileV1,
    source: CameraProfileSource,
    camera_model: Option<&str>,
    camera_calibration_signature: Option<&str>,
    illuminant: Option<ProfileIlluminantV1<'_>>,
    creative_amount: f32,
) -> Result<CompiledCameraProfilePlanV1> {
    ensure!(
        (0.0..=1.0).contains(&creative_amount),
        "camera_profile_creative_amount_out_of_bounds"
    );
    let camera_match = match (&profile.camera_model, camera_model, source) {
        (_, _, CameraProfileSource::MatrixFallback) => CameraIdentityMatch::MatrixFallback,
        (Some(expected), Some(actual), _)
            if normalize_camera(expected) == normalize_camera(actual) =>
        {
            CameraIdentityMatch::Exact
        }
        (None, _, _) => CameraIdentityMatch::Unrestricted,
        _ => return Err(anyhow::anyhow!("camera_profile_camera_mismatch")),
    };
    let weight = illuminant.map_or(0.0, |value| {
        interpolation_weight(profile.calibration_illuminants, value.cct_kelvin)
    });
    let color_matrix = interpolate_optional_matrices(profile.color_matrices, weight)
        .expect("parser requires primary matrix");
    let calibration_signature_matches = profile
        .calibration_signature
        .as_deref()
        .zip(camera_calibration_signature)
        .is_some_and(|(profile_signature, camera_signature)| profile_signature == camera_signature);
    let camera_calibration = if calibration_signature_matches {
        interpolate_optional_matrices(profile.camera_calibrations, weight)
            .unwrap_or(IDENTITY_MATRIX)
    } else {
        IDENTITY_MATRIX
    };
    let forward_matrix = interpolate_optional_matrices(profile.forward_matrices, weight);
    let calibrated_camera = multiply(diagonal(profile.analog_balance), camera_calibration);
    let matrix = if let Some(forward) = forward_matrix {
        multiply(forward, invert(calibrated_camera)?)
    } else {
        invert(multiply(calibrated_camera, color_matrix))?
    };
    let technical_table = interpolate_table(
        profile.hue_sat_maps[0].as_ref(),
        profile.hue_sat_maps[1].as_ref(),
        weight,
    )?;
    let creative_table = profile.look_table.clone();
    Ok(CompiledCameraProfilePlanV1 {
        matrix,
        analog_balance: profile.analog_balance,
        camera_calibration,
        color_matrix,
        forward_matrix,
        technical_table: technical_table.clone(),
        creative_table: creative_table.clone(),
        tone_curve: profile.tone_curve.clone(),
        baseline_exposure_ev: profile.baseline_exposure_ev,
        creative_amount,
        receipt: CameraProfileReceiptV1 {
            contract: CAMERA_PROFILE_CONTRACT,
            implementation_version: 1,
            profile_name: profile.name.clone(),
            profile_sha256: profile.content_sha256.clone(),
            source,
            camera_match,
            illuminant_weight: weight,
            technical_table_applied: technical_table.is_some(),
            creative_table_applied: creative_table.is_some() && creative_amount > 0.0,
            tone_curve_applied: !profile.tone_curve.is_empty() && creative_amount > 0.0,
            creative_amount,
            baseline_exposure_ev: profile.baseline_exposure_ev,
            default_black_render: profile.default_black_render,
            embed_policy: profile.embed_policy,
            unsupported_tag_ids: profile.unsupported_tag_ids.clone(),
            limitation_codes: {
                let mut codes = Vec::new();
                if illuminant.is_none()
                    && (profile.color_matrices[1].is_some()
                        || profile.forward_matrices[1].is_some())
                {
                    codes.push("profile_illuminant_unresolved_primary_used");
                }
                if profile.reduction_matrices.iter().any(Option::is_some) {
                    codes.push("profile_reduction_matrix_not_required_for_three_channels");
                }
                if profile.camera_calibrations.iter().any(Option::is_some)
                    && !calibration_signature_matches
                {
                    codes.push("profile_camera_calibration_signature_mismatch_ignored");
                }
                codes
            },
        },
    })
}

impl CompiledCameraProfilePlanV1 {
    pub(crate) fn xyz_to_camera_row_major(&self) -> Result<Vec<f32>> {
        Ok(invert(self.matrix)?
            .into_iter()
            .flatten()
            .map(|value| value as f32)
            .collect())
    }

    pub(crate) fn apply_technical(&self, rgb: [f32; 3]) -> [f32; 3] {
        let mapped = self
            .technical_table
            .as_ref()
            .map_or(rgb, |table| apply_table(table, rgb));
        let exposure = 2.0_f32.powf(self.baseline_exposure_ev);
        mapped.map(|channel| channel * exposure)
    }

    pub(crate) fn apply_creative(&self, rgb: [f32; 3]) -> [f32; 3] {
        if self.creative_amount == 0.0 {
            return rgb;
        }
        let looked = self
            .creative_table
            .as_ref()
            .map_or(rgb, |table| apply_table(table, rgb));
        let mixed = std::array::from_fn(|index| {
            rgb[index] + (looked[index] - rgb[index]) * self.creative_amount
        });
        if self.tone_curve.is_empty() {
            mixed
        } else {
            mixed.map(|channel| apply_curve(&self.tone_curve, channel))
        }
    }
}

fn normalize_camera(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}
fn interpolation_weight(illuminants: [Option<u16>; 2], cct: f64) -> f64 {
    let temperatures = illuminants.map(|value| value.and_then(illuminant_kelvin));
    match temperatures {
        [Some(first), Some(second)] if (first - second).abs() > 1.0 => {
            ((1.0 / cct - 1.0 / first) / (1.0 / second - 1.0 / first)).clamp(0.0, 1.0)
        }
        _ => 0.0,
    }
}
fn illuminant_kelvin(code: u16) -> Option<f64> {
    match code {
        17 => Some(2856.0),
        18 => Some(4874.0),
        19 => Some(6774.0),
        20 => Some(5503.0),
        21 => Some(6504.0),
        22 => Some(7504.0),
        23 => Some(5003.0),
        24 => Some(3200.0),
        _ => None,
    }
}
fn interpolate_matrix(first: [[f64; 3]; 3], second: [[f64; 3]; 3], weight: f64) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| {
        std::array::from_fn(|column| {
            first[row][column] + (second[row][column] - first[row][column]) * weight
        })
    })
}
const IDENTITY_MATRIX: [[f64; 3]; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
fn interpolate_optional_matrices(
    matrices: [Option<[[f64; 3]; 3]>; 2],
    weight: f64,
) -> Option<[[f64; 3]; 3]> {
    match matrices {
        [Some(first), Some(second)] => Some(interpolate_matrix(first, second, weight)),
        [Some(first), None] => Some(first),
        [None, Some(second)] => Some(second),
        [None, None] => None,
    }
}
fn diagonal(values: [f64; 3]) -> [[f64; 3]; 3] {
    [
        [values[0], 0.0, 0.0],
        [0.0, values[1], 0.0],
        [0.0, 0.0, values[2]],
    ]
}
fn multiply(left: [[f64; 3]; 3], right: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| {
        std::array::from_fn(|column| {
            (0..3)
                .map(|inner| left[row][inner] * right[inner][column])
                .sum()
        })
    })
}
fn invert(matrix: [[f64; 3]; 3]) -> Result<[[f64; 3]; 3]> {
    let [a, b, c] = matrix[0];
    let [d, e, f] = matrix[1];
    let [g, h, i] = matrix[2];
    let determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    ensure!(
        determinant.is_finite() && determinant.abs() > 1e-10,
        "camera_profile_singular_matrix"
    );
    let inverse = [
        [e * i - f * h, c * h - b * i, b * f - c * e],
        [f * g - d * i, a * i - c * g, c * d - a * f],
        [d * h - e * g, b * g - a * h, a * e - b * d],
    ]
    .map(|row| row.map(|value| value / determinant));
    let norm = matrix.into_iter().flatten().map(f64::abs).sum::<f64>();
    let inverse_norm = inverse.into_iter().flatten().map(f64::abs).sum::<f64>();
    ensure!(
        norm * inverse_norm < 1e8,
        "camera_profile_ill_conditioned_matrix"
    );
    Ok(inverse)
}
fn interpolate_table(
    first: Option<&ProfileTable>,
    second: Option<&ProfileTable>,
    weight: f64,
) -> Result<Option<ProfileTable>> {
    let Some(first) = first else { return Ok(None) };
    let Some(second) = second else {
        return Ok(Some(first.clone()));
    };
    ensure!(
        first.dimensions == second.dimensions && first.encoding == second.encoding,
        "camera_profile_dual_table_shape_mismatch"
    );
    Ok(Some(ProfileTable {
        dimensions: first.dimensions,
        encoding: first.encoding,
        entries: first
            .entries
            .iter()
            .zip(&second.entries)
            .map(|(a, b)| HsvDelta {
                hue_shift_degrees: lerp_hue_degrees(
                    a.hue_shift_degrees,
                    b.hue_shift_degrees,
                    weight as f32,
                ),
                saturation_scale: a.saturation_scale
                    + (b.saturation_scale - a.saturation_scale) * weight as f32,
                value_scale: a.value_scale + (b.value_scale - a.value_scale) * weight as f32,
            })
            .collect(),
    }))
}

fn apply_table(table: &ProfileTable, rgb: [f32; 3]) -> [f32; 3] {
    let encoded = if table.encoding == ProfileTableEncoding::Srgb {
        rgb.map(linear_to_srgb)
    } else {
        rgb
    };
    let (hue, saturation, value) = rgb_to_hsv(encoded);
    let delta = sample_table(table, hue, saturation, value);
    let adjusted = hsv_to_rgb(
        (hue + delta.hue_shift_degrees / 360.0).rem_euclid(1.0),
        (saturation * delta.saturation_scale).clamp(0.0, 1.0),
        (value * delta.value_scale).max(0.0),
    );
    if table.encoding == ProfileTableEncoding::Srgb {
        adjusted.map(srgb_to_linear)
    } else {
        adjusted
    }
}

fn sample_table(table: &ProfileTable, hue: f32, saturation: f32, value: f32) -> HsvDelta {
    let [h_count, s_count, v_count] = table.dimensions;
    let h = hue.rem_euclid(1.0) * h_count as f32;
    let h0 = h.floor() as usize % h_count;
    let h1 = (h0 + 1) % h_count;
    let ht = h.fract();
    let s = saturation.clamp(0.0, 1.0) * (s_count - 1) as f32;
    let s0 = s.floor() as usize;
    let s1 = (s0 + 1).min(s_count - 1);
    let st = s.fract();
    let v = value.clamp(0.0, 1.0) * (v_count - 1) as f32;
    let v0 = v.floor() as usize;
    let v1 = (v0 + 1).min(v_count - 1);
    let vt = v.fract();
    // DCP table storage is value-major, then hue, with saturation contiguous.
    let at = |hi, si, vi| table.entries[(vi * h_count + hi) * s_count + si];
    let blend = |a: HsvDelta, b: HsvDelta, t| HsvDelta {
        hue_shift_degrees: lerp_hue_degrees(a.hue_shift_degrees, b.hue_shift_degrees, t),
        saturation_scale: a.saturation_scale + (b.saturation_scale - a.saturation_scale) * t,
        value_scale: a.value_scale + (b.value_scale - a.value_scale) * t,
    };
    let layer = |hi| {
        blend(
            blend(at(hi, s0, v0), at(hi, s0, v1), vt),
            blend(at(hi, s1, v0), at(hi, s1, v1), vt),
            st,
        )
    };
    blend(layer(h0), layer(h1), ht)
}
fn lerp_hue_degrees(first: f32, second: f32, weight: f32) -> f32 {
    first + ((second - first + 180.0).rem_euclid(360.0) - 180.0) * weight
}
fn rgb_to_hsv(rgb: [f32; 3]) -> (f32, f32, f32) {
    let max = rgb.into_iter().fold(f32::NEG_INFINITY, f32::max);
    let min = rgb.into_iter().fold(f32::INFINITY, f32::min);
    let delta = max - min;
    let hue = if delta <= 1e-12 {
        0.0
    } else if max == rgb[0] {
        ((rgb[1] - rgb[2]) / delta / 6.0).rem_euclid(1.0)
    } else if max == rgb[1] {
        (rgb[2] - rgb[0]) / delta / 6.0 + 1.0 / 3.0
    } else {
        (rgb[0] - rgb[1]) / delta / 6.0 + 2.0 / 3.0
    };
    (hue, if max <= 0.0 { 0.0 } else { delta / max }, max)
}
fn hsv_to_rgb(h: f32, s: f32, v: f32) -> [f32; 3] {
    let h = h.rem_euclid(1.0) * 6.0;
    let i = h.floor() as i32;
    let f = h - i as f32;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    match i {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}
fn apply_curve(curve: &[ToneCurvePoint], value: f32) -> f32 {
    let value = value.clamp(0.0, 1.0);
    let upper = curve.partition_point(|point| point.input < value);
    if upper == 0 {
        return curve[0].output;
    }
    if upper >= curve.len() {
        return curve.last().expect("non-empty").output;
    }
    let a = &curve[upper - 1];
    let b = &curve[upper];
    a.output + (b.output - a.output) * (value - a.input) / (b.input - a.input)
}
fn linear_to_srgb(v: f32) -> f32 {
    if v <= 0.0031308 {
        12.92 * v
    } else {
        1.055 * v.max(0.0).powf(1.0 / 2.4) - 0.055
    }
}
fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile() -> DcpProfileV1 {
        DcpProfileV1 {
            name: "test".into(),
            camera_model: Some("Sony ILCE 7RM4".into()),
            calibration_illuminants: [Some(17), Some(21)],
            color_matrices: [
                Some([[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]]),
                Some([[2., 0., 0.], [0., 2., 0.], [0., 0., 2.]]),
            ],
            camera_calibrations: [None, None],
            reduction_matrices: [None, None],
            analog_balance: [1.0; 3],
            forward_matrices: [None, None],
            hue_sat_maps: [None, None],
            look_table: None,
            tone_curve: Vec::new(),
            baseline_exposure_ev: 1.0,
            default_black_render: None,
            calibration_signature: None,
            copyright: None,
            embed_policy: None,
            content_sha256: "sha256:test".into(),
            unsupported_tag_ids: Vec::new(),
        }
    }
    #[test]
    fn amount_zero_is_exact_creative_identity() {
        let plan = compile_camera_profile(
            &profile(),
            CameraProfileSource::User,
            Some("SONY_ILCE-7RM4"),
            None,
            None,
            0.0,
        )
        .unwrap();
        let rgb = [0.2, 0.4, 0.8];
        assert_eq!(plan.apply_creative(rgb), rgb);
        assert_eq!(plan.apply_technical(rgb), [0.4, 0.8, 1.6]);
        assert_eq!(plan.receipt.implementation_version, 1);
        assert_eq!(plan.receipt.profile_name, "test");
        assert_eq!(plan.receipt.creative_amount, 0.0);
        assert!(!plan.receipt.tone_curve_applied);
    }
    #[test]
    fn rejects_wrong_camera_and_amount() {
        assert!(
            compile_camera_profile(
                &profile(),
                CameraProfileSource::User,
                Some("NIKON Z 8"),
                None,
                None,
                0.5
            )
            .is_err()
        );
        assert!(
            compile_camera_profile(
                &profile(),
                CameraProfileSource::User,
                Some("Sony ILCE 7RM4"),
                None,
                None,
                1.1
            )
            .is_err()
        );
    }

    #[test]
    fn camera_calibration_requires_exact_signature_match() {
        let mut profile = profile();
        profile.camera_calibrations[0] = Some([[1.1, 0.0, 0.0], [0.0, 0.9, 0.0], [0.0, 0.0, 1.0]]);
        profile.calibration_signature = Some("reference-camera-v1".into());

        let ignored = compile_camera_profile(
            &profile,
            CameraProfileSource::User,
            Some("Sony ILCE 7RM4"),
            Some("different-reference-camera"),
            None,
            0.0,
        )
        .unwrap();
        assert_eq!(ignored.camera_calibration, IDENTITY_MATRIX);
        assert!(
            ignored
                .receipt
                .limitation_codes
                .contains(&"profile_camera_calibration_signature_mismatch_ignored")
        );

        let applied = compile_camera_profile(
            &profile,
            CameraProfileSource::User,
            Some("Sony ILCE 7RM4"),
            Some("reference-camera-v1"),
            None,
            0.0,
        )
        .unwrap();
        assert_eq!(
            applied.camera_calibration,
            profile.camera_calibrations[0].unwrap()
        );
        assert!(
            !applied
                .receipt
                .limitation_codes
                .contains(&"profile_camera_calibration_signature_mismatch_ignored")
        );
    }
    #[test]
    fn hue_table_wraps_without_seam() {
        let table = ProfileTable {
            dimensions: [2, 2, 1],
            encoding: ProfileTableEncoding::Linear,
            entries: vec![
                HsvDelta {
                    hue_shift_degrees: 0.,
                    saturation_scale: 1.,
                    value_scale: 1.
                };
                4
            ],
        };
        let left = apply_table(&table, hsv_to_rgb(0.9999, 0.8, 0.7));
        let right = apply_table(&table, hsv_to_rgb(0.0001, 0.8, 0.7));
        assert!((left[0] - right[0]).abs() < 0.002);
    }

    #[test]
    fn table_addressing_matches_dcp_value_hue_saturation_order() {
        let table = ProfileTable {
            dimensions: [2, 2, 2],
            encoding: ProfileTableEncoding::Linear,
            entries: (0..8)
                .map(|index| HsvDelta {
                    hue_shift_degrees: index as f32,
                    saturation_scale: 1.0,
                    value_scale: 1.0,
                })
                .collect(),
        };
        assert_eq!(sample_table(&table, 0.0, 0.0, 1.0).hue_shift_degrees, 4.0);
        assert_eq!(sample_table(&table, 0.5, 1.0, 0.0).hue_shift_degrees, 3.0);
        assert!((lerp_hue_degrees(179.0, -179.0, 0.5) - 180.0).abs() < 1e-6);
    }

    #[test]
    fn reciprocal_temperature_interpolation_reaches_both_calibration_endpoints() {
        let profile = profile();
        let warm = ProfileIlluminantV1 {
            cct_kelvin: 2856.0,
            duv: 0.0,
            fingerprint: "warm",
            xy: [0.4, 0.4],
        };
        let cool = ProfileIlluminantV1 {
            cct_kelvin: 6504.0,
            duv: 0.0,
            fingerprint: "cool",
            xy: [0.31, 0.33],
        };
        let warm_plan = compile_camera_profile(
            &profile,
            CameraProfileSource::User,
            Some("Sony ILCE 7RM4"),
            None,
            Some(warm),
            0.0,
        )
        .unwrap();
        let cool_plan = compile_camera_profile(
            &profile,
            CameraProfileSource::User,
            Some("Sony ILCE 7RM4"),
            None,
            Some(cool),
            0.0,
        )
        .unwrap();
        assert_eq!(warm_plan.matrix[0][0], 1.0);
        assert!((cool_plan.matrix[0][0] - 0.5).abs() < 1e-12);
        assert_eq!(warm_plan.receipt.illuminant_weight, 0.0);
        assert!((cool_plan.receipt.illuminant_weight - 1.0).abs() < 1e-12);
    }

    #[test]
    fn technical_and_creative_domains_execute_separately() {
        let mut profile = profile();
        profile.baseline_exposure_ev = 0.0;
        profile.look_table = Some(ProfileTable {
            dimensions: [2, 2, 1],
            encoding: ProfileTableEncoding::Linear,
            entries: vec![
                HsvDelta {
                    hue_shift_degrees: 0.0,
                    saturation_scale: 0.0,
                    value_scale: 1.0
                };
                4
            ],
        });
        profile.tone_curve = vec![
            ToneCurvePoint {
                input: 0.0,
                output: 0.0,
            },
            ToneCurvePoint {
                input: 1.0,
                output: 0.5,
            },
        ];
        let plan = compile_camera_profile(
            &profile,
            CameraProfileSource::User,
            Some("Sony ILCE 7RM4"),
            None,
            None,
            1.0,
        )
        .unwrap();
        let source = [0.8, 0.4, 0.2];
        assert_eq!(plan.apply_technical(source), source);
        let creative = plan.apply_creative(source);
        assert!(
            (creative[0] - creative[1]).abs() < 1e-6 && (creative[1] - creative[2]).abs() < 1e-6
        );
        assert!((creative[0] - 0.4).abs() < 1e-6);
    }

    #[test]
    fn profile_compile_and_scalar_execution_stay_interactive() {
        let profile = profile();
        let started = std::time::Instant::now();
        let mut checksum = 0.0;
        for index in 0..10_000 {
            let plan = compile_camera_profile(
                &profile,
                CameraProfileSource::User,
                Some("Sony ILCE 7RM4"),
                None,
                None,
                (index % 101) as f32 / 100.0,
            )
            .unwrap();
            checksum += f64::from(plan.apply_creative([0.1, 0.2, 0.3])[0]);
        }
        assert!(checksum.is_finite());
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }
}
