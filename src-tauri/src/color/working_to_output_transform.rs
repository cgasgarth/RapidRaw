use image::DynamicImage;

use crate::export::export_color_policy::{ExportColorProfile, ExportRenderingIntent};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkingColorState {
    AcesCgLinearV1,
    EncodedSrgbV1,
}

const AP1_TO_XYZ_D60: [[f64; 3]; 3] = [
    [0.662_454_181_1, 0.134_004_206_5, 0.156_187_687_0],
    [0.272_228_716_8, 0.674_081_765_8, 0.053_689_517_4],
    [-0.005_574_649_5, 0.004_060_733_5, 1.010_339_100_3],
];
const D60_XY: [f64; 2] = [0.32168, 0.33767];
const D65_XY: [f64; 2] = [0.3127, 0.3290];
const D50_XY: [f64; 2] = [0.34567, 0.35850];
const BRADFORD: [[f64; 3]; 3] = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];
const BRADFORD_INV: [[f64; 3]; 3] = [
    [0.986_992_9, -0.147_054_3, 0.159_962_7],
    [0.432_305_3, 0.518_360_3, 0.049_291_2],
    [-0.008_528_7, 0.040_042_8, 0.968_486_7],
];
const XYZ_D65_TO_SRGB: [[f64; 3]; 3] = [
    [3.240_969_942, -1.537_383_178, -0.498_610_760],
    [-0.969_243_636, 1.875_967_502, 0.041_555_057],
    [0.055_630_080, -0.203_976_959, 1.056_971_514],
];
const XYZ_D65_TO_DISPLAY_P3: [[f64; 3]; 3] = [
    [2.493_496_912, -0.931_383_618, -0.402_710_784],
    [-0.829_488_970, 1.762_664_060, 0.023_624_686],
    [0.035_845_830, -0.076_172_389, 0.956_884_524],
];
const XYZ_D65_TO_ADOBE_RGB: [[f64; 3]; 3] = [
    [2.041_369_000, -0.564_946_400, -0.344_694_400],
    [-0.969_266_000, 1.876_010_800, 0.041_556_000],
    [0.013_447_400, -0.118_389_700, 1.015_409_600],
];
const XYZ_D50_TO_PROPHOTO: [[f64; 3]; 3] = [
    [1.345_943_300, -0.255_607_500, -0.051_111_800],
    [-0.544_598_900, 1.508_167_300, 0.020_535_100],
    [0.000_000_000, 0.000_000_000, 1.211_812_800],
];

pub(crate) fn transform_acescg_image_to_output_rgb16(
    image: &DynamicImage,
    profile: &ExportColorProfile,
    intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u16>, u32, u32), String> {
    if black_point_compensation {
        return Err("working_output_bpc_unsupported_for_ap1_matrix_transform_v1".to_string());
    }
    if !(matches!(intent, ExportRenderingIntent::RelativeColorimetric)
        || matches!(profile, ExportColorProfile::Srgb)
            && matches!(intent, ExportRenderingIntent::Perceptual))
    {
        return Err("working_output_intent_unsupported_for_ap1_matrix_transform_v1".to_string());
    }
    let rgba = image.to_rgba32f();
    let (width, height) = rgba.dimensions();
    let d60_to_d65 = bradford(D60_XY, D65_XY);
    let d60_to_d50 = bradford(D60_XY, D50_XY);
    let mut output = Vec::with_capacity(width as usize * height as usize * 3);
    for pixel in rgba.as_raw().chunks_exact(4) {
        if !pixel[..3].iter().all(|value| value.is_finite()) {
            return Err("working_output_non_finite_ap1_source".to_string());
        }
        let source = [
            f64::from(pixel[0]),
            f64::from(pixel[1]),
            f64::from(pixel[2]),
        ];
        let xyz_d60 = mul(AP1_TO_XYZ_D60, source);
        let linear = match profile {
            ExportColorProfile::Srgb => mul(XYZ_D65_TO_SRGB, mul(d60_to_d65, xyz_d60)),
            ExportColorProfile::DisplayP3 => mul(XYZ_D65_TO_DISPLAY_P3, mul(d60_to_d65, xyz_d60)),
            ExportColorProfile::AdobeRgb1998 => mul(XYZ_D65_TO_ADOBE_RGB, mul(d60_to_d65, xyz_d60)),
            ExportColorProfile::ProPhotoRgb => mul(XYZ_D50_TO_PROPHOTO, mul(d60_to_d50, xyz_d60)),
            ExportColorProfile::SourceEmbedded => {
                return Err(
                    "working_output_source_embedded_requires_verified_source_domain".into(),
                );
            }
        };
        for value in linear {
            let encoded = match profile {
                ExportColorProfile::Srgb | ExportColorProfile::DisplayP3 => srgb_encode(value),
                ExportColorProfile::AdobeRgb1998 => value.max(0.0).powf(1.0 / 2.199_218_75),
                ExportColorProfile::ProPhotoRgb => prophoto_encode(value),
                ExportColorProfile::SourceEmbedded => unreachable!(),
            };
            output.push((encoded.clamp(0.0, 1.0) * 65_535.0).round() as u16);
        }
    }
    Ok((output, width, height))
}

fn mul(matrix: [[f64; 3]; 3], value: [f64; 3]) -> [f64; 3] {
    [
        matrix[0][0] * value[0] + matrix[0][1] * value[1] + matrix[0][2] * value[2],
        matrix[1][0] * value[0] + matrix[1][1] * value[1] + matrix[1][2] * value[2],
        matrix[2][0] * value[0] + matrix[2][1] * value[1] + matrix[2][2] * value[2],
    ]
}

fn multiply(a: [[f64; 3]; 3], b: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| {
        std::array::from_fn(|column| (0..3).map(|k| a[row][k] * b[k][column]).sum())
    })
}

fn white_xyz(xy: [f64; 2]) -> [f64; 3] {
    [xy[0] / xy[1], 1.0, (1.0 - xy[0] - xy[1]) / xy[1]]
}

fn bradford(source: [f64; 2], destination: [f64; 2]) -> [[f64; 3]; 3] {
    let source_lms = mul(BRADFORD, white_xyz(source));
    let destination_lms = mul(BRADFORD, white_xyz(destination));
    multiply(
        BRADFORD_INV,
        multiply(
            [
                [destination_lms[0] / source_lms[0], 0.0, 0.0],
                [0.0, destination_lms[1] / source_lms[1], 0.0],
                [0.0, 0.0, destination_lms[2] / source_lms[2]],
            ],
            BRADFORD,
        ),
    )
}

fn srgb_encode(value: f64) -> f64 {
    if value <= 0.003_130_8 {
        12.92 * value
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

fn prophoto_encode(value: f64) -> f64 {
    if value <= 1.0 / 512.0 {
        value * 16.0
    } else {
        value.max(0.0).powf(1.0 / 1.8)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    fn fixture(pixel: [f32; 3]) -> DynamicImage {
        DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            1,
            1,
            Rgba([pixel[0], pixel[1], pixel[2], 1.0]),
        ))
    }

    #[test]
    fn ap1_neutral_is_neutral_in_every_supported_output() {
        for profile in [
            ExportColorProfile::Srgb,
            ExportColorProfile::DisplayP3,
            ExportColorProfile::AdobeRgb1998,
            ExportColorProfile::ProPhotoRgb,
        ] {
            let (pixels, _, _) = transform_acescg_image_to_output_rgb16(
                &fixture([0.18; 3]),
                &profile,
                &ExportRenderingIntent::RelativeColorimetric,
                false,
            )
            .unwrap();
            assert!(
                pixels.iter().max().unwrap() - pixels.iter().min().unwrap() <= 8,
                "{profile:?}: {pixels:?}"
            );
        }
    }

    #[test]
    fn saturated_ap1_is_not_interpreted_as_encoded_srgb() {
        let (pixels, _, _) = transform_acescg_image_to_output_rgb16(
            &fixture([0.9, 0.1, 0.05]),
            &ExportColorProfile::DisplayP3,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
        )
        .unwrap();
        let mislabeled = fixture([0.9, 0.1, 0.05]).to_rgb16().into_raw();
        assert_ne!(pixels, mislabeled);
        assert!(pixels[0] > pixels[1] && pixels[0] > pixels[2]);
    }

    #[test]
    fn unsupported_policy_and_non_finite_input_fail_closed() {
        assert!(
            transform_acescg_image_to_output_rgb16(
                &fixture([f32::NAN, 0.0, 0.0]),
                &ExportColorProfile::Srgb,
                &ExportRenderingIntent::RelativeColorimetric,
                false
            )
            .is_err()
        );
        assert!(
            transform_acescg_image_to_output_rgb16(
                &fixture([0.1; 3]),
                &ExportColorProfile::DisplayP3,
                &ExportRenderingIntent::Perceptual,
                false
            )
            .is_err()
        );
        assert!(
            transform_acescg_image_to_output_rgb16(
                &fixture([0.1; 3]),
                &ExportColorProfile::DisplayP3,
                &ExportRenderingIntent::RelativeColorimetric,
                true
            )
            .is_err()
        );
    }
}
