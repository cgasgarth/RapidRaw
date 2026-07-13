//! Independent AP1 working-space to controlled output-space reference transforms.

use crate::{
    ReferenceError,
    adaptation::bradford_adaptation,
    matrix::Matrix3,
    transfer::linear_to_srgb_channel,
    types::{CieXyz, WhitePointXyz},
};

const AP1_TO_XYZ_D60: Matrix3 = Matrix3([
    [0.662_454_181_1, 0.134_004_206_5, 0.156_187_687_0],
    [0.272_228_716_8, 0.674_081_765_8, 0.053_689_517_4],
    [-0.005_574_649_5, 0.004_060_733_5, 1.010_339_100_3],
]);
const XYZ_D65_TO_SRGB: Matrix3 = Matrix3([
    [3.240_969_942, -1.537_383_178, -0.498_610_760],
    [-0.969_243_636, 1.875_967_502, 0.041_555_057],
    [0.055_630_080, -0.203_976_959, 1.056_971_514],
]);
const XYZ_D65_TO_DISPLAY_P3: Matrix3 = Matrix3([
    [2.493_496_912, -0.931_383_618, -0.402_710_784],
    [-0.829_488_970, 1.762_664_060, 0.023_624_686],
    [0.035_845_830, -0.076_172_389, 0.956_884_524],
]);
const XYZ_D50_TO_PROPHOTO: Matrix3 = Matrix3([
    [1.345_943_300, -0.255_607_500, -0.051_111_800],
    [-0.544_598_900, 1.508_167_300, 0.020_535_100],
    [0.0, 0.0, 1.211_812_800],
]);

pub const NARROW_D65_PRIMARIES: [[f64; 2]; 3] = [[0.50, 0.35], [0.30, 0.50], [0.20, 0.15]];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ControlledOutputSpace {
    SrgbD65,
    DisplayP3D65,
    ProPhotoD50,
    NarrowD65Gamma22,
}

pub fn encode_ap1_to_controlled_output(
    ap1: [f64; 3],
    output: ControlledOutputSpace,
) -> Result<[f64; 3], ReferenceError> {
    let xyz_d60 = AP1_TO_XYZ_D60.transform(ap1);
    let xyz_d60 = CieXyz::new(xyz_d60[0], xyz_d60[1], xyz_d60[2])?;
    let (destination_white, xyz_to_rgb) = match output {
        ControlledOutputSpace::SrgbD65 => (white_from_xy([0.3127, 0.3290])?, XYZ_D65_TO_SRGB),
        ControlledOutputSpace::DisplayP3D65 => {
            (white_from_xy([0.3127, 0.3290])?, XYZ_D65_TO_DISPLAY_P3)
        }
        ControlledOutputSpace::ProPhotoD50 => {
            (white_from_xy([0.34567, 0.35850])?, XYZ_D50_TO_PROPHOTO)
        }
        ControlledOutputSpace::NarrowD65Gamma22 => (
            white_from_xy([0.3127, 0.3290])?,
            rgb_to_xyz_from_primaries(NARROW_D65_PRIMARIES, [0.3127, 0.3290])?.inverse()?,
        ),
    };
    let xyz = bradford_adaptation(white_from_xy([0.32168, 0.33767])?, destination_white)?
        .adapt(xyz_d60)?;
    let linear = xyz_to_rgb.transform(xyz.components());
    Ok(linear.map(|value| match output {
        ControlledOutputSpace::SrgbD65 | ControlledOutputSpace::DisplayP3D65 => {
            linear_to_srgb_channel(value)
        }
        ControlledOutputSpace::ProPhotoD50 => {
            if value <= 1.0 / 512.0 {
                value * 16.0
            } else {
                value.max(0.0).powf(1.0 / 1.8)
            }
        }
        ControlledOutputSpace::NarrowD65Gamma22 => value.max(0.0).powf(1.0 / 2.2),
    }))
}

#[must_use]
pub fn quantize_rgb16(encoded: [f64; 3]) -> [u16; 3] {
    encoded.map(|value| (value.clamp(0.0, 1.0) * 65_535.0).round() as u16)
}

fn white_from_xy(xy: [f64; 2]) -> Result<WhitePointXyz, ReferenceError> {
    WhitePointXyz::new(xy[0] / xy[1], 1.0, (1.0 - xy[0] - xy[1]) / xy[1])
}

fn rgb_to_xyz_from_primaries(
    primaries: [[f64; 2]; 3],
    white_xy: [f64; 2],
) -> Result<Matrix3, ReferenceError> {
    let columns = primaries.map(|xy| [xy[0] / xy[1], 1.0, (1.0 - xy[0] - xy[1]) / xy[1]]);
    let unscaled = Matrix3::new([
        [columns[0][0], columns[1][0], columns[2][0]],
        [columns[0][1], columns[1][1], columns[2][1]],
        [columns[0][2], columns[1][2], columns[2][2]],
    ])?;
    let white = white_from_xy(white_xy)?.xyz().components();
    let scale = unscaled.inverse()?.transform(white);
    Matrix3::new([
        [
            unscaled.0[0][0] * scale[0],
            unscaled.0[0][1] * scale[1],
            unscaled.0[0][2] * scale[2],
        ],
        [
            unscaled.0[1][0] * scale[0],
            unscaled.0[1][1] * scale[1],
            unscaled.0[1][2] * scale[2],
        ],
        [
            unscaled.0[2][0] * scale[0],
            unscaled.0[2][1] * scale[1],
            unscaled.0[2][2] * scale[2],
        ],
    ])
}
