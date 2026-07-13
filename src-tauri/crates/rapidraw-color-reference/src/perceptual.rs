//! CIE perceptual reference transforms.

use crate::{
    ReferenceError,
    types::{CieLab, CieXyz, WhitePointXyz},
};

const DELTA: f64 = 6.0 / 29.0;
const DELTA_CUBED: f64 = DELTA * DELTA * DELTA;

fn lab_forward(value: f64) -> f64 {
    if value > DELTA_CUBED {
        value.cbrt()
    } else {
        value / (3.0 * DELTA * DELTA) + 4.0 / 29.0
    }
}

fn lab_inverse(value: f64) -> f64 {
    if value > DELTA {
        value.powi(3)
    } else {
        3.0 * DELTA * DELTA * (value - 4.0 / 29.0)
    }
}

/// CIE 1976 XYZ to Lab under an explicit reference white.
///
/// The linear toe is preserved for negative tristimulus components; no clamp is
/// applied, so scene-referred conformance tests can detect premature clipping.
pub fn xyz_to_lab(xyz: CieXyz, white: WhitePointXyz) -> Result<CieLab, ReferenceError> {
    let white = white.xyz();
    let fx = lab_forward(xyz.x / white.x);
    let fy = lab_forward(xyz.y / white.y);
    let fz = lab_forward(xyz.z / white.z);
    CieLab::new(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))
}

/// Inverse CIE 1976 Lab to XYZ under the same explicit reference white.
pub fn lab_to_xyz(lab: CieLab, white: WhitePointXyz) -> Result<CieXyz, ReferenceError> {
    let white = white.xyz();
    let fy = (lab.lightness + 16.0) / 116.0;
    let fx = fy + lab.a / 500.0;
    let fz = fy - lab.b / 200.0;
    CieXyz::new(
        white.x * lab_inverse(fx),
        white.y * lab_inverse(fy),
        white.z * lab_inverse(fz),
    )
}
