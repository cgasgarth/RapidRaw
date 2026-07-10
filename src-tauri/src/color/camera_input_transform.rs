use anyhow::{Result, anyhow};
use image::{ImageBuffer, Rgba};

pub const RAW_INPUT_TRANSFORM_CONTRACT: &str = "rapidraw.raw_input_transform.v1";
pub const XYZ_TO_AP1_MATRIX_VERSION: &str = "aces_ap1_xyz_d60_v1";
pub const NUMERIC_POLICY_VERSION: &str = "camera_input_f64_inverse_cond_1e6_v1";
pub const ACES_WHITE_XY: [f64; 2] = [0.32168, 0.33767];
pub const XYZ_D60_TO_AP1: [[f64; 3]; 3] = [
    [
        1.641_023_379_694_325_7,
        -0.324_803_294_184_79,
        -0.236_424_695_237_612_25,
    ],
    [
        -0.663_662_858_722_982_9,
        1.615_331_591_657_337_9,
        0.016_756_347_685_530_137,
    ],
    [
        0.011_721_894_328_375_376,
        -0.008_284_441_996_237_41,
        0.988_394_858_539_021_5,
    ],
];
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

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawInputTransformReceiptV1 {
    pub contract: &'static str,
    pub source_domain: &'static str,
    pub destination_domain: &'static str,
    pub camera_make_model_id: String,
    pub resolver_algorithm_id: &'static str,
    pub profile_source: &'static str,
    pub selected_matrix_direction: &'static str,
    pub selected_matrix_sha256: String,
    pub selected_calibration_white_xy: [f64; 2],
    pub as_shot_camera_wb_gains: [f64; 3],
    pub chromatic_adaptation: &'static str,
    pub destination_white_xy: [f64; 2],
    pub xyz_to_ap1_matrix_version: &'static str,
    pub numeric_policy_version: &'static str,
    pub sensor_floor_count: u64,
    pub negative_ap1_component_count: u64,
    pub greater_than_one_ap1_component_count: u64,
    pub non_finite_count: u64,
    pub transform_content_sha256: String,
    pub working_pixels_blake3: String,
    pub limitation_codes: Vec<&'static str>,
}

pub(crate) struct RawWorkingImageV1 {
    pub pixels: ImageBuffer<Rgba<f32>, Vec<f32>>,
    pub domain: AcesCgLinearV1,
    pub input_transform_receipt: RawInputTransformReceiptV1,
}
pub(crate) struct AcesCgLinearV1;

impl RawWorkingImageV1 {
    pub(crate) fn into_dynamic_image(self) -> image::DynamicImage {
        let _domain = self.domain;
        let _receipt = self.input_transform_receipt;
        image::DynamicImage::ImageRgba32F(self.pixels)
    }
}

pub(crate) struct CameraInputTransform<'a> {
    pub camera_make_model_id: &'a str,
    pub resolver_algorithm_id: &'static str,
    pub selected_matrix_sha256: &'a str,
    pub xyz_to_camera: &'a [f32],
    pub calibration_white_xy: [f64; 2],
    pub as_shot_wb: [f32; 3],
    pub sensor_floor_count: u64,
}

pub(crate) fn apply_camera_input_transform(
    pixels: &mut [[f32; 3]],
    input: CameraInputTransform<'_>,
) -> Result<RawInputTransformReceiptV1> {
    if input.xyz_to_camera.len() != 9 {
        return Err(anyhow!("raw_input_transform_invalid_matrix_shape"));
    }
    if !input.xyz_to_camera.iter().all(|v| v.is_finite())
        || !input.as_shot_wb.iter().all(|v| v.is_finite() && *v > 0.0)
        || !valid_xy(input.calibration_white_xy)
    {
        return Err(anyhow!("raw_input_transform_non_finite_or_invalid_input"));
    }
    let m = input.xyz_to_camera;
    let camera_to_xyz = inverse_checked([
        [m[0] as f64, m[1] as f64, m[2] as f64],
        [m[3] as f64, m[4] as f64, m[5] as f64],
        [m[6] as f64, m[7] as f64, m[8] as f64],
    ])?;
    let same_white = max_xy_delta(input.calibration_white_xy, ACES_WHITE_XY) <= 1e-7;
    let cat = if same_white {
        identity()
    } else {
        bradford_adaptation(input.calibration_white_xy, ACES_WHITE_XY)?
    };
    let camera_to_ap1 = multiply(XYZ_D60_TO_AP1, multiply(cat, camera_to_xyz));
    let (mut negative, mut over_one, mut non_finite) = (0_u64, 0_u64, 0_u64);
    let mut pixel_hasher = blake3::Hasher::new();
    for pixel in pixels {
        let ap1 = multiply_vector(
            camera_to_ap1,
            [
                pixel[0] as f64 * input.as_shot_wb[0] as f64,
                pixel[1] as f64 * input.as_shot_wb[1] as f64,
                pixel[2] as f64 * input.as_shot_wb[2] as f64,
            ],
        );
        for (destination, value) in pixel.iter_mut().zip(ap1) {
            if !value.is_finite() {
                non_finite += 1;
                continue;
            }
            *destination = value as f32;
            negative += u64::from(*destination < 0.0);
            over_one += u64::from(*destination > 1.0);
            pixel_hasher.update(&destination.to_le_bytes());
        }
    }
    if non_finite != 0 {
        return Err(anyhow!("raw_input_transform_non_finite_output"));
    }
    Ok(RawInputTransformReceiptV1 {
        contract: RAW_INPUT_TRANSFORM_CONTRACT,
        source_domain: "linear_camera_rgb_v1",
        destination_domain: "acescg_linear_v1",
        camera_make_model_id: input.camera_make_model_id.to_owned(),
        resolver_algorithm_id: input.resolver_algorithm_id,
        profile_source: "raw_metadata",
        selected_matrix_direction: "xyz_to_camera",
        selected_matrix_sha256: input.selected_matrix_sha256.to_owned(),
        selected_calibration_white_xy: input.calibration_white_xy,
        as_shot_camera_wb_gains: input.as_shot_wb.map(f64::from),
        chromatic_adaptation: if same_white {
            "none_same_white"
        } else {
            "bradford_v1"
        },
        destination_white_xy: ACES_WHITE_XY,
        xyz_to_ap1_matrix_version: XYZ_TO_AP1_MATRIX_VERSION,
        numeric_policy_version: NUMERIC_POLICY_VERSION,
        sensor_floor_count: input.sensor_floor_count,
        negative_ap1_component_count: negative,
        greater_than_one_ap1_component_count: over_one,
        non_finite_count: non_finite,
        transform_content_sha256: transform_hash(&input, camera_to_ap1),
        working_pixels_blake3: format!("blake3:{}", pixel_hasher.finalize().to_hex()),
        limitation_codes: Vec::new(),
    })
}

fn transform_hash(input: &CameraInputTransform<'_>, matrix: [[f64; 3]; 3]) -> String {
    let mut hasher = blake3::Hasher::new();
    for bytes in [
        RAW_INPUT_TRANSFORM_CONTRACT.as_bytes(),
        input.camera_make_model_id.as_bytes(),
        input.selected_matrix_sha256.as_bytes(),
        XYZ_TO_AP1_MATRIX_VERSION.as_bytes(),
        NUMERIC_POLICY_VERSION.as_bytes(),
    ] {
        hasher.update(bytes);
    }
    for value in input
        .calibration_white_xy
        .into_iter()
        .chain(input.as_shot_wb.map(f64::from))
        .chain(matrix.into_iter().flatten())
    {
        hasher.update(&value.to_le_bytes());
    }
    format!("blake3:{}", hasher.finalize().to_hex())
}
fn valid_xy(xy: [f64; 2]) -> bool {
    xy[0].is_finite() && xy[1].is_finite() && xy[0] > 0.0 && xy[1] > 0.0 && xy[0] + xy[1] < 1.0
}
fn max_xy_delta(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).abs().max((a[1] - b[1]).abs())
}
fn xy_to_xyz(xy: [f64; 2]) -> [f64; 3] {
    [xy[0] / xy[1], 1.0, (1.0 - xy[0] - xy[1]) / xy[1]]
}
fn bradford_adaptation(source: [f64; 2], destination: [f64; 2]) -> Result<[[f64; 3]; 3]> {
    let src = multiply_vector(BRADFORD, xy_to_xyz(source));
    let dst = multiply_vector(BRADFORD, xy_to_xyz(destination));
    if src.iter().any(|v| !v.is_finite() || v.abs() < 1e-12) {
        return Err(anyhow!("raw_input_transform_invalid_calibration_white"));
    }
    Ok(multiply(
        BRADFORD_INV,
        multiply(
            [
                [dst[0] / src[0], 0.0, 0.0],
                [0.0, dst[1] / src[1], 0.0],
                [0.0, 0.0, dst[2] / src[2]],
            ],
            BRADFORD,
        ),
    ))
}
fn inverse_checked(m: [[f64; 3]; 3]) -> Result<[[f64; 3]; 3]> {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if !det.is_finite() || det.abs() < 1e-12 {
        return Err(anyhow!("raw_input_transform_rank_deficient_matrix"));
    }
    let inv = [
        [
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det,
        ],
        [
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det,
        ],
        [
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det,
        ],
    ];
    let condition = infinity_norm(m) * infinity_norm(inv);
    if !condition.is_finite() || condition > 1e6 {
        return Err(anyhow!("raw_input_transform_ill_conditioned_matrix"));
    }
    Ok(inv)
}
fn infinity_norm(m: [[f64; 3]; 3]) -> f64 {
    m.into_iter()
        .map(|r| r.into_iter().map(f64::abs).sum::<f64>())
        .fold(0.0, f64::max)
}
fn identity() -> [[f64; 3]; 3] {
    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
}
fn multiply(a: [[f64; 3]; 3], b: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    std::array::from_fn(|r| std::array::from_fn(|c| (0..3).map(|i| a[r][i] * b[i][c]).sum()))
}
fn multiply_vector(m: [[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|r| (0..3).map(|c| m[r][c] * v[c]).sum())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input<'a>(matrix: &'a [f32], white: [f64; 2], wb: [f32; 3]) -> CameraInputTransform<'a> {
        CameraInputTransform {
            camera_make_model_id: "test camera",
            resolver_algorithm_id: "dual_illuminant_mired_v1",
            selected_matrix_sha256: "blake3:test",
            xyz_to_camera: matrix,
            calibration_white_xy: white,
            as_shot_wb: wb,
            sensor_floor_count: 0,
        }
    }
    #[test]
    fn camera_input_transform_preserves_extended_ap1_and_applies_wb_once() {
        let matrix = [1., 0., 0., 0., 1., 0., 0., 0., 1.];
        let mut pixels = [[1., 0.25, 0.], [-0.1, 0.5, 2.]];
        let receipt =
            apply_camera_input_transform(&mut pixels, input(&matrix, ACES_WHITE_XY, [2., 1., 1.5]))
                .unwrap();
        assert_eq!(receipt.chromatic_adaptation, "none_same_white");
        assert!(receipt.negative_ap1_component_count > 0);
        assert!(receipt.greater_than_one_ap1_component_count > 0);
        let expected = multiply_vector(XYZ_D60_TO_AP1, [2., 0.25, 0.]);
        for i in 0..3 {
            assert!((pixels[0][i] as f64 - expected[i]).abs() < 2e-6);
        }
    }
    #[test]
    fn camera_input_transform_adapts_d50_to_d60_once() {
        let matrix = [1., 0., 0., 0., 1., 0., 0., 0., 1.];
        let mut once = [[0.4, 0.5, 0.6]];
        let receipt =
            apply_camera_input_transform(&mut once, input(&matrix, [0.34567, 0.35850], [1.; 3]))
                .unwrap();
        assert_eq!(receipt.chromatic_adaptation, "bradford_v1");
        let mut no_cat = [[0.4, 0.5, 0.6]];
        apply_camera_input_transform(&mut no_cat, input(&matrix, ACES_WHITE_XY, [1.; 3])).unwrap();
        assert_ne!(once, no_cat);
    }
    #[test]
    fn camera_input_transform_rejects_invalid_domains() {
        let mut pixels = [[0.; 3]];
        assert!(
            apply_camera_input_transform(&mut pixels, input(&[1.; 8], ACES_WHITE_XY, [1.; 3]))
                .is_err()
        );
        assert!(
            apply_camera_input_transform(
                &mut pixels,
                input(
                    &[1., 0., 0., 0., 0., 0., 0., 0., 1.],
                    ACES_WHITE_XY,
                    [1.; 3]
                )
            )
            .is_err()
        );
    }
}
