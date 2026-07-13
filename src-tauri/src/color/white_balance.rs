use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};

pub(crate) const WHITE_BALANCE_CONTRACT: &str = "rapidraw.white_balance.v1";
pub const D60_XY: [f64; 2] = [0.32168, 0.33767];

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WhiteBalanceModeV1 {
    AsShot,
    Auto,
    KelvinTint,
    Chromaticity,
    Preset,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WhiteBalanceInputSemanticsV1 {
    /// Camera-referred scene-linear RGB after the camera input transform.
    #[default]
    RawSceneLinear,
    /// Scene-linear RGB decoded from a rendered (JPEG/TIFF/PNG) source. This is
    /// useful but cannot reconstruct the camera illuminant removed in-camera.
    RenderedSceneLinearApproximation,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WhiteBalancePlanInputV1 {
    pub mode: WhiteBalanceModeV1,
    #[serde(default = "default_kelvin")]
    pub kelvin: f64,
    #[serde(default)]
    pub duv: f64,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub input_semantics: WhiteBalanceInputSemanticsV1,
    #[serde(default)]
    pub camera_channel_gains: Option<[f64; 3]>,
}

fn default_kelvin() -> f64 {
    6_504.0
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WhiteBalancePlanV1 {
    pub contract: &'static str,
    pub algorithm: &'static str,
    pub mode: WhiteBalanceModeV1,
    pub implementation_version: u32,
    pub input_semantics: WhiteBalanceInputSemanticsV1,
    pub source_illuminant: IlluminantCoordinates,
    pub destination_xy: [f64; 2],
    pub camera_channel_gains: Option<[f64; 3]>,
    pub adaptation: &'static str,
    pub ap1_matrix: [[f32; 3]; 3],
    pub limitation_codes: Vec<&'static str>,
    pub fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WhiteBalanceFingerprintV1 {
    contract: &'static str,
    algorithm: &'static str,
    mode: WhiteBalanceModeV1,
    implementation_version: u32,
    input_semantics: WhiteBalanceInputSemanticsV1,
    source_illuminant: IlluminantCoordinates,
    destination_xy: [f64; 2],
    camera_channel_gains: Option<[f64; 3]>,
    adaptation: &'static str,
    ap1_matrix: [[f32; 3]; 3],
    limitation_codes: Vec<&'static str>,
}

pub(crate) fn compile_white_balance_plan(
    input: WhiteBalancePlanInputV1,
) -> Result<WhiteBalancePlanV1> {
    let source_illuminant = match input.mode {
        WhiteBalanceModeV1::AsShot => estimate_cct_duv_from_xy(D60_XY)?,
        WhiteBalanceModeV1::Chromaticity => estimate_cct_duv_from_xy([
            input
                .x
                .ok_or_else(|| anyhow!("white_balance_missing_chromaticity_x"))?,
            input
                .y
                .ok_or_else(|| anyhow!("white_balance_missing_chromaticity_y"))?,
        ])?,
        WhiteBalanceModeV1::Auto | WhiteBalanceModeV1::KelvinTint | WhiteBalanceModeV1::Preset => {
            cct_duv_to_coordinates(input.kelvin, input.duv)?
        }
    };
    let ap1_matrix = if input.mode == WhiteBalanceModeV1::AsShot {
        [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    } else {
        technical_ap1_matrix_from_xy(source_illuminant.xy)?
    };
    let limitation_codes = match input.input_semantics {
        WhiteBalanceInputSemanticsV1::RawSceneLinear => Vec::new(),
        WhiteBalanceInputSemanticsV1::RenderedSceneLinearApproximation => {
            vec!["rendered_source_camera_illuminant_not_recoverable"]
        }
    };
    let fingerprint_input = WhiteBalanceFingerprintV1 {
        contract: WHITE_BALANCE_CONTRACT,
        algorithm: "cat16_ap1_illuminant_v1",
        mode: input.mode,
        implementation_version: 1,
        input_semantics: input.input_semantics,
        source_illuminant,
        destination_xy: D60_XY,
        camera_channel_gains: input.camera_channel_gains,
        adaptation: "cat16_v1",
        ap1_matrix,
        limitation_codes: limitation_codes.clone(),
    };
    let canonical = serde_json::to_vec(&fingerprint_input)?;
    Ok(WhiteBalancePlanV1 {
        contract: WHITE_BALANCE_CONTRACT,
        algorithm: "cat16_ap1_illuminant_v1",
        mode: input.mode,
        implementation_version: 1,
        input_semantics: input.input_semantics,
        source_illuminant,
        destination_xy: D60_XY,
        camera_channel_gains: input.camera_channel_gains,
        adaptation: "cat16_v1",
        ap1_matrix,
        limitation_codes,
        fingerprint: format!("blake3:{}", blake3::hash(&canonical).to_hex()),
    })
}

const CAT16: [[f64; 3]; 3] = [
    [0.401_288, 0.650_173, -0.051_461],
    [-0.250_268, 1.204_414, 0.045_854],
    [-0.002_079, 0.048_952, 0.953_127],
];
const CAT16_INV: [[f64; 3]; 3] = [
    [1.862_067_86, -1.011_254_63, 0.149_186_77],
    [0.387_526_54, 0.621_447_44, -0.008_973_98],
    [-0.015_841_50, -0.034_122_94, 1.049_964_44],
];
const XYZ_TO_AP1: [[f64; 3]; 3] = [
    [1.641_023_38, -0.324_803_29, -0.236_424_70],
    [-0.663_662_86, 1.615_331_59, 0.016_756_35],
    [0.011_721_89, -0.008_284_44, 0.988_394_86],
];
const AP1_TO_XYZ: [[f64; 3]; 3] = [
    [0.662_454_18, 0.134_004_21, 0.156_187_69],
    [0.272_228_72, 0.674_081_77, 0.053_689_52],
    [-0.005_574_65, 0.004_060_73, 1.010_339_10],
];

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IlluminantCoordinates {
    pub xy: [f64; 2],
    pub uv1960: [f64; 2],
    pub cct_kelvin: f64,
    pub duv: f64,
}

pub(crate) fn cct_duv_to_coordinates(cct_kelvin: f64, duv: f64) -> Result<IlluminantCoordinates> {
    if !(1_667.0..=25_000.0).contains(&cct_kelvin) || !(-0.05..=0.05).contains(&duv) {
        return Err(anyhow!("white_balance_illuminant_out_of_range"));
    }
    let locus_xy = cct_to_xy(cct_kelvin)?;
    let [u, v] = xy_to_uv1960(locus_xy)?;
    // Duv is defined in UCS. The local normal is found from two nearby points
    // on the Planckian locus, avoiding a display-RGB temperature heuristic.
    let step = (cct_kelvin * 0.002).max(1.0);
    let lo = xy_to_uv1960(cct_to_xy((cct_kelvin - step).max(1_667.0))?)?;
    let hi = xy_to_uv1960(cct_to_xy((cct_kelvin + step).min(25_000.0))?)?;
    let tangent = [hi[0] - lo[0], hi[1] - lo[1]];
    let length = tangent[0].hypot(tangent[1]);
    if length <= 1e-12 {
        return Err(anyhow!("white_balance_degenerate_planckian_tangent"));
    }
    let uv1960 = [u - tangent[1] / length * duv, v + tangent[0] / length * duv];
    Ok(IlluminantCoordinates {
        xy: uv1960_to_xy(uv1960)?,
        uv1960,
        cct_kelvin,
        duv,
    })
}

pub(crate) fn technical_ap1_matrix_from_xy(source: [f64; 2]) -> Result<[[f32; 3]; 3]> {
    let cat = chromatic_adaptation_cat16(source, D60_XY)?;
    let ap1 = multiply(XYZ_TO_AP1, multiply(cat, AP1_TO_XYZ));
    if !ap1.into_iter().flatten().all(f64::is_finite) {
        return Err(anyhow!("white_balance_non_finite_ap1_matrix"));
    }
    Ok(ap1.map(|row| row.map(|value| value as f32)))
}

pub(crate) fn neutral_chroma_from_wb(wb: [f32; 4]) -> Option<[f64; 2]> {
    let [red, green, blue, _] = wb;
    if ![red, green, blue]
        .into_iter()
        .all(|value| value.is_finite() && value > 0.0)
    {
        return None;
    }
    Some([
        (f64::from(green / red)).ln(),
        (f64::from(green / blue)).ln(),
    ])
}

pub(crate) fn camera_white_chroma(xyz_to_camera: &[f32], white_xy: [f64; 2]) -> Option<[f64; 2]> {
    if xyz_to_camera.len() != 9 || !xyz_to_camera.iter().all(|value| value.is_finite()) {
        return None;
    }
    let xyz = xy_to_xyz(white_xy).ok()?;
    let response = [
        f64::from(xyz_to_camera[0]) * xyz[0]
            + f64::from(xyz_to_camera[1]) * xyz[1]
            + f64::from(xyz_to_camera[2]) * xyz[2],
        f64::from(xyz_to_camera[3]) * xyz[0]
            + f64::from(xyz_to_camera[4]) * xyz[1]
            + f64::from(xyz_to_camera[5]) * xyz[2],
        f64::from(xyz_to_camera[6]) * xyz[0]
            + f64::from(xyz_to_camera[7]) * xyz[1]
            + f64::from(xyz_to_camera[8]) * xyz[2],
    ];
    if !response
        .into_iter()
        .all(|value| value.is_finite() && value.abs() > 1e-12)
    {
        return None;
    }
    Some([
        (response[0] / response[1]).abs().ln(),
        (response[2] / response[1]).abs().ln(),
    ])
}

pub(crate) fn project_neutral_mired_weight(
    observed: [f64; 2],
    warm: [f64; 2],
    cool: [f64; 2],
) -> Option<f64> {
    let axis = [cool[0] - warm[0], cool[1] - warm[1]];
    let denominator = axis[0].mul_add(axis[0], axis[1] * axis[1]);
    if denominator <= 1e-12 {
        return None;
    }
    Some(
        (((observed[0] - warm[0]) * axis[0] + (observed[1] - warm[1]) * axis[1]) / denominator)
            .clamp(0.0, 1.0),
    )
}

pub(crate) fn cct_to_xy(cct: f64) -> Result<[f64; 2]> {
    if !(1_667.0..=25_000.0).contains(&cct) {
        return Err(anyhow!("white_balance_cct_out_of_range"));
    }
    let x = if cct <= 4_000.0 {
        -0.266_123_9e9 / cct.powi(3) - 0.234_358_0e6 / cct.powi(2) + 0.877_695_6e3 / cct + 0.179_910
    } else {
        -3.025_846_9e9 / cct.powi(3) + 2.107_037_9e6 / cct.powi(2) + 0.222_634_7e3 / cct + 0.240_390
    };
    let y = if cct <= 2_222.0 {
        -1.106_381_4 * x.powi(3) - 1.348_110_20 * x.powi(2) + 2.185_558_32 * x - 0.202_196_83
    } else if cct <= 4_000.0 {
        -0.954_947_6 * x.powi(3) - 1.374_185_93 * x.powi(2) + 2.091_370_15 * x - 0.167_488_67
    } else {
        3.081_758 * x.powi(3) - 5.873_386_70 * x.powi(2) + 3.751_129_97 * x - 0.370_014_83
    };
    Ok([x, y])
}

pub(crate) fn estimate_cct_duv_from_xy(xy: [f64; 2]) -> Result<IlluminantCoordinates> {
    let uv = xy_to_uv1960(xy)?;
    let mut best = (6_504.0, f64::INFINITY, xy_to_uv1960(cct_to_xy(6_504.0)?)?);
    let mut kelvin = 1_667.0;
    while kelvin <= 25_000.0 {
        let candidate_uv = xy_to_uv1960(cct_to_xy(kelvin)?)?;
        let distance = (uv[0] - candidate_uv[0]).hypot(uv[1] - candidate_uv[1]);
        if distance < best.1 {
            best = (kelvin, distance, candidate_uv);
        }
        kelvin += if kelvin < 5_000.0 { 10.0 } else { 25.0 };
    }
    let step = (best.0 * 0.002_f64).max(1.0_f64);
    let lo = xy_to_uv1960(cct_to_xy((best.0 - step).max(1_667.0))?)?;
    let hi = xy_to_uv1960(cct_to_xy((best.0 + step).min(25_000.0))?)?;
    let tangent = [hi[0] - lo[0], hi[1] - lo[1]];
    let cross = tangent[0] * (uv[1] - best.2[1]) - tangent[1] * (uv[0] - best.2[0]);
    Ok(IlluminantCoordinates {
        xy,
        uv1960: uv,
        cct_kelvin: best.0,
        duv: best.1.copysign(cross).clamp(-0.05, 0.05),
    })
}

fn xy_to_xyz([x, y]: [f64; 2]) -> Result<[f64; 3]> {
    if !x.is_finite() || !y.is_finite() || x <= 0.0 || y <= 0.0 || x + y >= 1.0 {
        return Err(anyhow!("white_balance_invalid_chromaticity"));
    }
    Ok([x / y, 1.0, (1.0 - x - y) / y])
}

fn xy_to_uv1960(xy: [f64; 2]) -> Result<[f64; 2]> {
    let [x, y] = xy;
    let d = -2.0 * x + 12.0 * y + 3.0;
    if !d.is_finite() || d.abs() <= 1e-12 {
        return Err(anyhow!("white_balance_invalid_uv_denominator"));
    }
    Ok([4.0 * x / d, 6.0 * y / d])
}

fn uv1960_to_xy([u, v]: [f64; 2]) -> Result<[f64; 2]> {
    let d = 2.0 * u - 8.0 * v + 4.0;
    if !d.is_finite() || d.abs() <= 1e-12 {
        return Err(anyhow!("white_balance_invalid_xy_denominator"));
    }
    let xy = [3.0 * u / d, 2.0 * v / d];
    xy_to_xyz(xy)?;
    Ok(xy)
}

fn chromatic_adaptation_cat16(source: [f64; 2], destination: [f64; 2]) -> Result<[[f64; 3]; 3]> {
    let source_lms = multiply_vector(CAT16, xy_to_xyz(source)?);
    let destination_lms = multiply_vector(CAT16, xy_to_xyz(destination)?);
    if source_lms.into_iter().any(|value| value.abs() <= 1e-12) {
        return Err(anyhow!("white_balance_cat16_singular_source"));
    }
    let scale = [
        [destination_lms[0] / source_lms[0], 0.0, 0.0],
        [0.0, destination_lms[1] / source_lms[1], 0.0],
        [0.0, 0.0, destination_lms[2] / source_lms[2]],
    ];
    Ok(multiply(CAT16_INV, multiply(scale, CAT16)))
}

fn multiply(left: [[f64; 3]; 3], right: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| {
        std::array::from_fn(|column| (0..3).map(|i| left[row][i] * right[i][column]).sum())
    })
}

fn multiply_vector(matrix: [[f64; 3]; 3], value: [f64; 3]) -> [f64; 3] {
    matrix.map(|row| row[0] * value[0] + row[1] * value[1] + row[2] * value[2])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn d60_technical_matrix_is_identity() {
        let matrix = technical_ap1_matrix_from_xy(D60_XY).unwrap();
        for row in 0..3 {
            for column in 0..3 {
                let expected = f32::from(row == column);
                assert!((matrix[row][column] - expected).abs() < 0.006, "{matrix:?}");
            }
        }
    }

    #[test]
    fn standard_illuminants_and_off_locus_tint_are_finite() {
        for cct in [2_856.0, 5_003.0, 5_503.0, 6_504.0, 7_504.0] {
            for duv in [-0.02, 0.0, 0.02] {
                let coordinates = cct_duv_to_coordinates(cct, duv).unwrap();
                assert!(coordinates.xy.into_iter().all(f64::is_finite));
                assert!((coordinates.duv - duv).abs() < 1e-12);
                assert!(
                    technical_ap1_matrix_from_xy(coordinates.xy)
                        .unwrap()
                        .into_iter()
                        .flatten()
                        .all(f32::is_finite)
                );
            }
        }
    }

    #[test]
    fn camera_neutral_projection_recovers_intermediate_weight() {
        let warm = [-0.3, 0.4];
        let cool = [0.5, -0.2];
        let observed = [
            warm[0] * 0.75 + cool[0] * 0.25,
            warm[1] * 0.75 + cool[1] * 0.25,
        ];
        assert!((project_neutral_mired_weight(observed, warm, cool).unwrap() - 0.25).abs() < 1e-12);
    }

    #[test]
    fn invalid_illuminants_fail_closed() {
        assert!(cct_duv_to_coordinates(1_000.0, 0.0).is_err());
        assert!(cct_duv_to_coordinates(6_500.0, 0.2).is_err());
        assert!(neutral_chroma_from_wb([f32::NAN, 1.0, 1.0, 1.0]).is_none());
    }

    #[test]
    fn compiled_plan_has_stable_fingerprint_and_explicit_input_semantics() {
        let input = WhiteBalancePlanInputV1 {
            mode: WhiteBalanceModeV1::KelvinTint,
            kelvin: 5_500.0,
            duv: 0.004,
            x: None,
            y: None,
            input_semantics: WhiteBalanceInputSemanticsV1::RenderedSceneLinearApproximation,
            camera_channel_gains: None,
        };
        let first = compile_white_balance_plan(input.clone()).unwrap();
        let second = compile_white_balance_plan(input).unwrap();
        assert_eq!(first.fingerprint, second.fingerprint);
        assert!(first.fingerprint.starts_with("blake3:"));
        assert_eq!(
            first.limitation_codes,
            vec!["rendered_source_camera_illuminant_not_recoverable"]
        );
        assert!(first.ap1_matrix.into_iter().flatten().all(f32::is_finite));
    }

    #[test]
    fn as_shot_plan_is_an_identity_without_double_adaptation() {
        let plan = compile_white_balance_plan(WhiteBalancePlanInputV1 {
            mode: WhiteBalanceModeV1::AsShot,
            kelvin: 2_856.0,
            duv: 0.01,
            x: None,
            y: None,
            input_semantics: WhiteBalanceInputSemanticsV1::RawSceneLinear,
            camera_channel_gains: Some([2.0, 1.0, 1.5]),
        })
        .unwrap();
        assert_eq!(
            plan.ap1_matrix,
            [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
        );
        assert!(plan.limitation_codes.is_empty());
        assert_eq!(plan.camera_channel_gains, Some([2.0, 1.0, 1.5]));
    }
}
