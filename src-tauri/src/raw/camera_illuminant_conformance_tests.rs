use super::{
    bayer_hq::demosaic_bayer_hq, raw_processing::*, xtrans_hq::demosaic_xtrans_hq_with_cancel,
};
use crate::color::camera_input_transform::{
    CameraInputTransform, CameraRgbWhiteBalanceGains, XyzToCameraMatrix,
    apply_camera_input_transform,
};
use rawler::{
    cfa::{CFA, CFA_COLOR_B, CFA_COLOR_G, CFA_COLOR_R},
    imgop::xyz::Illuminant,
    imgop::{Dim2, Point, Rect},
    pixarray::PixF32,
    rawimage::{RawImageData, RawPhotometricInterpretation},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::Path,
};

const CONTRACT: &str = "rapidraw.camera-illuminant-conformance.v1";
const XTRANS_PATTERN: &str = "GGRGGBGGBGGRBRGRGGGGRGGBGGBGGRBRGRGG";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateRawProof {
    source_basename: String,
    source_sha256: String,
    camera_id: String,
    lens_id: String,
    reference_lens_id: String,
    lens_metadata_matches_reference: bool,
    dimensions: [usize; 2],
    cfa: String,
    illuminants: Vec<String>,
    black_levels: Vec<f32>,
    white_levels: Vec<u32>,
    metadata_wb_normalized_to_green: [f32; 3],
    wb_red_blue_ratio: f32,
    profile_matrix_hash: String,
    profile_status: String,
    profile_estimated_cct_kelvin: Option<f32>,
    neutral_axis_max_error: f32,
    sensor_sample_max_error: f32,
    highlight_sample_max_delta: f32,
    highlight_candidate_pixels: usize,
    highlight_reconstructed_pixels: usize,
    highlight_reconstructed_channels: usize,
    highlight_sensor_content_changed: bool,
    negative_output_components: usize,
    over_one_output_components: usize,
    non_finite_output_components: usize,
    stage_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceRawIdentity {
    source_basename: String,
    make: String,
    model: String,
    lens_model: String,
    dimensions: [usize; 2],
    cfa: String,
    black_levels: Vec<f32>,
    white_levels: Vec<u32>,
    wb_rgb_normalized: [f32; 3],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyntheticProof {
    cfa: &'static str,
    rgb_mae: f32,
    rgb_max_error: f32,
    neutral_max_channel_skew: f32,
    non_finite_components: usize,
}

struct ExpectedProfile {
    matrix: Vec<f32>,
    white_xy: [f64; 2],
    estimated_cct_kelvin: f32,
    matrix_hash: String,
}

fn illuminant_reference(illuminant: Illuminant) -> Option<(f32, [f64; 2])> {
    match illuminant {
        Illuminant::A | Illuminant::Tungsten | Illuminant::IsoStudioTungsten => {
            Some((2_856.0, [0.44757, 0.40745]))
        }
        Illuminant::D50 => Some((5_003.0, [0.34567, 0.35850])),
        Illuminant::D55 => Some((5_503.0, [0.33242, 0.34743])),
        Illuminant::Daylight | Illuminant::FineWeather | Illuminant::Flash | Illuminant::D65 => {
            Some((6_504.0, [0.31271, 0.32902]))
        }
        Illuminant::CloudyWeather | Illuminant::D75 => Some((7_504.0, [0.29902, 0.31485])),
        _ => None,
    }
}

fn independent_cct_to_xy(cct: f32) -> [f64; 2] {
    let temperature = f64::from(cct);
    assert!((1_667.0..=25_000.0).contains(&temperature));
    let x = if temperature <= 4_000.0 {
        -0.266_123_9e9 / temperature.powi(3) - 0.234_358_0e6 / temperature.powi(2)
            + 0.877_695_6e3 / temperature
            + 0.179_910
    } else {
        -3.025_846_9e9 / temperature.powi(3)
            + 2.107_037_9e6 / temperature.powi(2)
            + 0.222_634_7e3 / temperature
            + 0.240_390
    };
    let y = if temperature <= 2_222.0 {
        -1.106_381_4 * x.powi(3) - 1.348_110_20 * x.powi(2) + 2.185_558_32 * x - 0.202_196_83
    } else if temperature <= 4_000.0 {
        -0.954_947_6 * x.powi(3) - 1.374_185_93 * x.powi(2) + 2.091_370_15 * x - 0.167_488_67
    } else {
        3.081_758_0 * x.powi(3) - 5.873_386_70 * x.powi(2) + 3.751_129_97 * x - 0.370_014_83
    };
    [x, y]
}

fn independent_camera_white_chroma(matrix: &[f32], white: [f64; 2]) -> [f64; 2] {
    let xyz = [
        white[0] / white[1],
        1.0,
        (1.0 - white[0] - white[1]) / white[1],
    ];
    let response = [
        f64::from(matrix[0]) * xyz[0]
            + f64::from(matrix[1]) * xyz[1]
            + f64::from(matrix[2]) * xyz[2],
        f64::from(matrix[3]) * xyz[0]
            + f64::from(matrix[4]) * xyz[1]
            + f64::from(matrix[5]) * xyz[2],
        f64::from(matrix[6]) * xyz[0]
            + f64::from(matrix[7]) * xyz[1]
            + f64::from(matrix[8]) * xyz[2],
    ];
    [
        (response[0] / response[1]).abs().ln(),
        (response[2] / response[1]).abs().ln(),
    ]
}

fn expected_profile(
    color_matrices: &std::collections::HashMap<Illuminant, Vec<f32>>,
    wb: [f32; 4],
) -> ExpectedProfile {
    let mut candidates = color_matrices
        .iter()
        .filter(|(_, matrix)| matrix.len() == 9 && matrix.iter().all(|value| value.is_finite()))
        .filter_map(|(illuminant, matrix)| {
            illuminant_reference(*illuminant)
                .map(|(cct, white)| (*illuminant, cct, white, matrix.as_slice()))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.1.total_cmp(&right.1));
    assert!(!candidates.is_empty(), "metadata color profile candidates");
    let warm_endpoint = candidates[0];
    let cool_endpoint = *candidates.last().expect("nonempty candidates");
    let observed = [f64::from(wb[1] / wb[0]).ln(), f64::from(wb[1] / wb[2]).ln()];
    let warm_chroma = independent_camera_white_chroma(warm_endpoint.3, warm_endpoint.2);
    let cool_chroma = independent_camera_white_chroma(cool_endpoint.3, cool_endpoint.2);
    let axis = [
        cool_chroma[0] - warm_chroma[0],
        cool_chroma[1] - warm_chroma[1],
    ];
    let denominator = axis[0].mul_add(axis[0], axis[1] * axis[1]);
    let cool_endpoint_weight = (((observed[0] - warm_chroma[0]) * axis[0]
        + (observed[1] - warm_chroma[1]) * axis[1])
        / denominator)
        .clamp(0.0, 1.0);
    let target_cct = (1.0
        / ((1.0 - cool_endpoint_weight) / f64::from(warm_endpoint.1)
            + cool_endpoint_weight / f64::from(cool_endpoint.1))) as f32;
    let warm = candidates
        .iter()
        .rev()
        .find(|candidate| candidate.1 <= target_cct)
        .copied()
        .unwrap_or(candidates[0]);
    let cool = candidates
        .iter()
        .find(|candidate| candidate.1 >= target_cct)
        .copied()
        .unwrap_or(*candidates.last().expect("nonempty candidates"));
    let weight = if warm.0 == cool.0 {
        1.0
    } else {
        let inverse_target = 1.0 / target_cct;
        let inverse_warm = 1.0 / warm.1;
        let inverse_cool = 1.0 / cool.1;
        ((inverse_target - inverse_warm) / (inverse_cool - inverse_warm)).clamp(0.0, 1.0)
    };
    let matrix = if warm.0 == cool.0 {
        warm.3.to_vec()
    } else {
        warm.3
            .iter()
            .zip(cool.3)
            .map(|(warm, cool)| warm.mul_add(1.0 - weight, cool * weight))
            .collect()
    };
    let white_xy = independent_cct_to_xy(target_cct);
    let mut hasher = blake3::Hasher::new();
    for value in &matrix {
        hasher.update(&value.to_le_bytes());
    }
    ExpectedProfile {
        matrix,
        white_xy,
        estimated_cct_kelvin: target_cct,
        matrix_hash: format!("blake3:{}", hasher.finalize().to_hex()),
    }
}

fn trace_indices(length: usize) -> [usize; 5] {
    [0, length / 4, length / 2, length * 3 / 4, length - 1]
}

fn max_abs_delta(left: &[[f32; 4]], right: &[[f32; 4]]) -> f32 {
    left.iter()
        .zip(right)
        .flat_map(|(left, right)| left.iter().zip(right))
        .map(|(left, right)| (left - right).abs())
        .fold(0.0, f32::max)
}

fn privacy_safe_source(path: &str, bytes: &[u8]) -> (String, String) {
    (
        Path::new(path)
            .file_name()
            .expect("source path must have a basename")
            .to_string_lossy()
            .into_owned(),
        format!("sha256:{}", hex::encode(Sha256::digest(bytes))),
    )
}

fn raw_sensor_content_hash(data: &RawImageData) -> blake3::Hash {
    let mut hasher = blake3::Hasher::new();
    match data {
        RawImageData::Integer(values) => {
            for value in values {
                hasher.update(&value.to_le_bytes());
            }
        }
        RawImageData::Float(values) => {
            for value in values {
                hasher.update(&value.to_le_bytes());
            }
        }
    }
    hasher.finalize()
}

fn neutral_axis_error(matrix: &[f32], white: [f64; 2], wb: [f32; 4]) -> f32 {
    let normalized = [wb[0] / wb[1], 1.0, wb[2] / wb[1]];
    let mut neutral = [[1.0 / normalized[0], 1.0, 1.0 / normalized[2]]];
    apply_camera_input_transform(
        &mut neutral,
        CameraInputTransform {
            camera_make_model_id: "conformance-neutral",
            resolver_algorithm_id: "independent_neutral_fixture_v1",
            selected_matrix_sha256: "fixture",
            xyz_to_camera: XyzToCameraMatrix::from_row_major(matrix).expect("valid matrix"),
            calibration_white_xy: white,
            as_shot_wb: CameraRgbWhiteBalanceGains::from_rawler(wb).expect("valid WB"),
            sensor_floor_count: 0,
        },
    )
    .expect("metadata matrix must preserve the calibration neutral axis");
    let [red, green, blue] = neutral[0];
    red.max(green).max(blue) - red.min(green).min(blue)
}

#[test]
fn private_multi_illuminant_raws_execute_full_camera_pipeline_when_enabled() {
    let Ok(paths) = std::env::var("RAWENGINE_CAMERA_CONFORMANCE_RAW_PATHS") else {
        eprintln!("skipped: set RAWENGINE_CAMERA_CONFORMANCE_RAW_PATHS to private RAW paths");
        return;
    };
    let paths = paths
        .split(':')
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    assert!(
        paths.len() >= 3,
        "proof requires at least three illuminant samples"
    );
    let reference_path = std::env::var("RAWENGINE_CAMERA_CONFORMANCE_REFERENCE_MANIFEST")
        .expect("private proof requires an ignored independent ExifTool reference manifest");
    let references = serde_json::from_slice::<Vec<ReferenceRawIdentity>>(
        &fs::read(reference_path).expect("read independent reference manifest"),
    )
    .expect("parse independent reference manifest")
    .into_iter()
    .map(|reference| (reference.source_basename.clone(), reference))
    .collect::<HashMap<_, _>>();

    let mut proofs = Vec::with_capacity(paths.len());
    let mut camera_ids = BTreeSet::new();
    let mut lens_ids = BTreeSet::new();
    let mut wb_buckets = BTreeSet::new();
    let mut total_reconstructed_highlights = 0;
    let mut lens_reference_mismatches = 0;

    for path in paths {
        let bytes = fs::read(path).expect("read private RAW");
        let decoded = decode_raw_sensor_image(&bytes).expect("decode sensor RAW");
        let raw = &decoded.raw_image;
        let black_levels = raw
            .blacklevel
            .levels
            .iter()
            .map(|level| level.as_f32())
            .collect::<Vec<_>>();
        let white_levels = raw.whitelevel.0.clone();
        assert!(black_levels.iter().all(|level| level.is_finite()));
        assert!(white_levels.iter().all(|level| *level > 0));
        assert!(black_levels[0] < white_levels[0] as f32);
        assert_eq!(raw.data.as_f32().len(), raw.width * raw.height * raw.cpp);

        let cfa = match &raw.photometric {
            RawPhotometricInterpretation::Cfa(config) => config.cfa.name.clone(),
            other => panic!("expected CFA RAW, got {other:?}"),
        };
        let camera_id = format!("{} {}", raw.clean_make.trim(), raw.clean_model.trim());
        let basename = Path::new(path)
            .file_name()
            .expect("source basename")
            .to_string_lossy();
        let reference = references
            .get(basename.as_ref())
            .expect("reference manifest entry for every private RAW");
        assert_eq!(raw.clean_make.to_uppercase(), reference.make);
        assert_eq!(raw.clean_model, reference.model);
        assert_eq!([raw.width, raw.height], reference.dimensions);
        assert_eq!(cfa, reference.cfa);
        assert_eq!(black_levels, reference.black_levels);
        assert!(
            white_levels
                .iter()
                .all(|level| *level == reference.white_levels[0])
        );
        assert!(
            reference
                .white_levels
                .iter()
                .all(|level| *level == white_levels[0])
        );
        for (actual, expected) in raw.wb_coeffs[..3].iter().zip(reference.wb_rgb_normalized) {
            assert!((actual - expected).abs() <= f32::EPSILON);
        }
        let lens_id = decoded
            .metadata
            .lens
            .as_ref()
            .map(|lens| lens.lens_name.trim().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "metadata_unavailable".to_owned());
        let decoded_lens_model = decoded
            .metadata
            .lens
            .as_ref()
            .map(|lens| lens.lens_model.trim())
            .filter(|name| !name.is_empty())
            .unwrap_or("metadata_unavailable");
        let lens_metadata_matches_reference = decoded_lens_model == reference.lens_model;
        lens_reference_mismatches += usize::from(!lens_metadata_matches_reference);
        camera_ids.insert(camera_id.clone());
        lens_ids.insert(lens_id.clone());
        let wb_ratio = raw.wb_coeffs[0] / raw.wb_coeffs[2];
        let metadata_wb = raw.wb_coeffs;
        let sensor_dimensions = [raw.width, raw.height];
        wb_buckets.insert((wb_ratio * 100.0).round() as i32);

        let values = raw.data.as_f32();
        let denominator = white_levels[0] as f32 - black_levels[0];
        let independently_normalized = trace_indices(values.len())
            .map(|index| {
                let value = (values[index] - black_levels[0]) / denominator;
                [value, value, value, 1.0]
            })
            .to_vec();
        let color_matrices = raw.color_matrix.clone();
        let independently_resolved = expected_profile(&color_matrices, raw.wb_coeffs);
        let selected_white = independently_resolved.white_xy;
        let neutral_error = neutral_axis_error(
            &independently_resolved.matrix,
            selected_white,
            raw.wb_coeffs,
        );
        assert!(
            neutral_error <= 2.0e-5,
            "neutral axis error {neutral_error}"
        );

        let mut highlight_decode = decode_raw_sensor_image(&bytes).expect("decode highlight proof");
        let highlight_before = raw_sensor_content_hash(&highlight_decode.raw_image.data);
        let (highlight_candidates, highlight_pixels, highlight_channels) =
            reconstruct_raw_sensor_highlights_for_test(&mut highlight_decode.raw_image);
        let highlight_after = raw_sensor_content_hash(&highlight_decode.raw_image.data);
        let highlight_changed = highlight_before != highlight_after;
        assert_eq!(highlight_changed, highlight_pixels > 0);
        assert_eq!(highlight_channels > 0, highlight_pixels > 0);
        assert!(highlight_candidates >= highlight_pixels);
        total_reconstructed_highlights += highlight_pixels;

        drop(values);
        drop(decoded);
        let (developed, report) = develop_raw_image_with_report(
            &bytes,
            false,
            RawProcessingProfile::Balanced,
            2.5,
            "default".to_owned(),
            None,
        )
        .expect("develop private RAW through calibrated pipeline");
        assert_eq!(report.stage_samples.len(), 4);
        let expected_stage_ids = [
            "sensor_decode",
            "highlight_reconstruction",
            "demosaic_rescale",
            "white_balance_profile_input",
        ];
        assert_eq!(
            report
                .stage_samples
                .iter()
                .map(|stage| stage.node_id)
                .collect::<Vec<_>>(),
            expected_stage_ids
        );
        assert!(report.stage_samples.iter().all(|stage| {
            stage.version == 1
                && stage.elapsed_ms.is_finite()
                && stage
                    .samples
                    .iter()
                    .flatten()
                    .all(|component| component.is_finite())
        }));
        let sensor_error =
            max_abs_delta(&independently_normalized, &report.stage_samples[0].samples);
        assert!(sensor_error <= f32::EPSILON);
        let highlight_delta = max_abs_delta(
            &report.stage_samples[0].samples,
            &report.stage_samples[1].samples,
        );
        let receipt = report.input_transform.as_ref().expect("calibrated receipt");
        let expected_wb = [
            f64::from(metadata_wb[0] / metadata_wb[1]),
            1.0,
            f64::from(metadata_wb[2] / metadata_wb[1]),
        ];
        for (actual, expected) in receipt.as_shot_camera_wb_gains.iter().zip(expected_wb) {
            assert!((actual - expected).abs() <= 1.0e-6);
        }
        assert_eq!(receipt.outcome, "primary_calibrated_ap1");
        assert_eq!(receipt.non_finite_count, 0);
        assert_eq!(
            report.camera_profile.matrix_hash.as_deref(),
            Some(independently_resolved.matrix_hash.as_str())
        );
        assert_eq!(receipt.selected_calibration_white_xy, selected_white);
        assert!(
            (report
                .camera_profile
                .estimated_cct_kelvin
                .expect("estimated CCT")
                - independently_resolved.estimated_cct_kelvin)
                .abs()
                <= f32::EPSILON
        );

        let rgba = developed.to_rgba32f();
        let stride = (rgba.as_raw().len() / 32_768).max(4).next_multiple_of(4);
        let mut negative = 0;
        let mut over_one = 0;
        let mut non_finite = 0;
        for component in rgba.as_raw().iter().step_by(stride) {
            non_finite += usize::from(!component.is_finite());
            negative += usize::from(*component < 0.0);
            over_one += usize::from(*component > 1.0);
        }
        assert_eq!(non_finite, 0);

        let illuminants = color_matrices
            .keys()
            .map(|illuminant| format!("{illuminant:?}"))
            .collect::<Vec<_>>();
        let (source_basename, source_sha256) = privacy_safe_source(path, &bytes);
        proofs.push(PrivateRawProof {
            source_basename,
            source_sha256,
            camera_id,
            lens_id,
            reference_lens_id: reference.lens_model.clone(),
            lens_metadata_matches_reference,
            dimensions: sensor_dimensions,
            cfa,
            illuminants,
            black_levels,
            white_levels,
            metadata_wb_normalized_to_green: [
                metadata_wb[0] / metadata_wb[1],
                1.0,
                metadata_wb[2] / metadata_wb[1],
            ],
            wb_red_blue_ratio: wb_ratio,
            profile_matrix_hash: receipt.selected_matrix_sha256.clone(),
            profile_status: report.camera_profile.status.to_owned(),
            profile_estimated_cct_kelvin: report.camera_profile.estimated_cct_kelvin,
            neutral_axis_max_error: neutral_error,
            sensor_sample_max_error: sensor_error,
            highlight_sample_max_delta: highlight_delta,
            highlight_candidate_pixels: highlight_candidates,
            highlight_reconstructed_pixels: highlight_pixels,
            highlight_reconstructed_channels: highlight_channels,
            highlight_sensor_content_changed: highlight_changed,
            negative_output_components: negative,
            over_one_output_components: over_one,
            non_finite_output_components: non_finite,
            stage_ids: report
                .stage_samples
                .iter()
                .map(|stage| stage.node_id.to_owned())
                .collect(),
        });
    }

    assert!(
        wb_buckets.len() >= 3,
        "private proof needs distinct illuminants"
    );
    assert!(
        lens_ids.len() >= 2,
        "private proof needs known and unknown lens identities"
    );
    assert!(
        total_reconstructed_highlights > 0,
        "private proof needs at least one real reconstructed highlight"
    );
    let synthetic = synthetic_proofs();
    let report = serde_json::json!({
        "contract": CONTRACT,
        "privateSources": proofs,
        "coverage": {
            "cameraModels": camera_ids,
            "lensIdentities": lens_ids,
            "wbProxyBucketCount": wb_buckets.len(),
            "lensReferenceMismatchCount": lens_reference_mismatches,
            "limitations": [
                "private_capture_one_root_has_single_camera_model",
                "synthetic_xtrans_used_for_missing_private_cfa_type"
            ]
        },
        "syntheticKnownGroundTruth": synthetic
    });
    let report_path = std::env::var("RAWENGINE_CAMERA_CONFORMANCE_REPORT")
        .unwrap_or_else(|_| "/tmp/rapidraw-camera-illuminant-conformance.json".to_owned());
    fs::write(
        report_path,
        serde_json::to_vec_pretty(&report).expect("serialize report"),
    )
    .expect("write ignored conformance report");
}

#[test]
fn invalid_camera_matrices_profiles_and_white_balance_fail_safe_atomically() {
    for (matrix, expected) in [
        (vec![1.0; 8], "invalid_matrix_shape"),
        (
            vec![1.0, 0.0, 0.0, 0.0, f32::NAN, 0.0, 0.0, 0.0, 1.0],
            "non_finite_matrix",
        ),
        (
            vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.5, 0.5, 0.0],
            "rank_deficient",
        ),
        (
            vec![0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            "invalid_matrix_orientation",
        ),
    ] {
        let mut pixels = [[0.25, 0.5, 0.75]];
        let original = pixels;
        let result = XyzToCameraMatrix::from_row_major(&matrix).and_then(|matrix| {
            apply_camera_input_transform(
                &mut pixels,
                CameraInputTransform {
                    camera_make_model_id: "invalid-fixture",
                    resolver_algorithm_id: "invalid_fixture_v1",
                    selected_matrix_sha256: "invalid",
                    xyz_to_camera: matrix,
                    calibration_white_xy: [0.31271, 0.32902],
                    as_shot_wb: CameraRgbWhiteBalanceGains::from_rawler([1.0; 4])?,
                    sensor_floor_count: 0,
                },
            )
        });
        assert!(
            result
                .expect_err("invalid profile must fail")
                .to_string()
                .contains(expected),
            "expected {expected}"
        );
        assert_eq!(pixels, original, "failure must not partially mutate pixels");
    }

    for wb in [
        [0.0, 1.0, 1.0, 1.0],
        [f32::NAN, 1.0, 1.0, 1.0],
        [9.0, 1.0, 1.0, 1.0],
    ] {
        assert!(CameraRgbWhiteBalanceGains::from_rawler(wb).is_err());
    }
}

#[test]
fn dual_illuminant_extremes_match_independent_reference_and_hashes() {
    let matrices = HashMap::from([
        (
            Illuminant::A,
            vec![0.8, 0.0, 0.0, 0.0, 1.1, 0.0, 0.0, 0.0, 0.7],
        ),
        (
            Illuminant::D65,
            vec![0.7, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.8],
        ),
    ]);
    for wb in [
        [1.0, 1.0, 8.0, f32::NAN],
        [2.0, 1.0, 1.0, f32::NAN],
        [8.0, 1.0, 1.0, f32::NAN],
    ] {
        let expected = expected_profile(&matrices, wb);
        let (matrix, white, report) = resolve_camera_color_profile_for_test(&matrices, wb);
        let matrix = matrix.expect("dual-illuminant matrix");
        assert_eq!(matrix, expected.matrix);
        assert_eq!(white, Some(expected.white_xy));
        assert_eq!(
            report.matrix_hash.as_deref(),
            Some(expected.matrix_hash.as_str())
        );
        assert_eq!(
            report.estimated_cct_kelvin,
            Some(expected.estimated_cct_kelvin)
        );
        assert!(neutral_axis_error(&matrix, expected.white_xy, wb) <= 2.0e-5);
    }

    let (_, _, warm_clamped) =
        resolve_camera_color_profile_for_test(&matrices, [1.0, 1.0, 8.0, f32::NAN]);
    let (_, _, cool_clamped) =
        resolve_camera_color_profile_for_test(&matrices, [8.0, 1.0, 1.0, f32::NAN]);
    assert_eq!(warm_clamped.cct_clamped, Some(true));
    assert_eq!(cool_clamped.cct_clamped, Some(true));
}

#[test]
fn conformance_report_identity_is_deterministic_and_private_paths_are_absent() {
    let bytes = b"synthetic-private-raw-identity";
    let private_path = "/Users/example/Pictures/private/session/image.ARW";
    let first = privacy_safe_source(private_path, bytes);
    let second = privacy_safe_source(private_path, bytes);
    assert_eq!(first, second);
    assert_eq!(first.0, "image.ARW");
    assert!(first.1.starts_with("sha256:"));
    assert_eq!(first.1.len(), "sha256:".len() + 64);

    let report = serde_json::json!({
        "contract": CONTRACT,
        "sourceBasename": first.0,
        "sourceSha256": first.1,
        "coverageLimitations": ["synthetic_xtrans_used_for_missing_private_cfa_type"]
    });
    let encoded = serde_json::to_vec(&report).expect("serialize privacy fixture");
    let report_hash = hex::encode(Sha256::digest(&encoded));
    assert_eq!(report_hash, hex::encode(Sha256::digest(&encoded)));
    let text = String::from_utf8(encoded).expect("JSON utf8");
    assert!(!text.contains("/Users/"));
    assert!(!text.contains("Pictures/private"));
}

#[test]
fn synthetic_bayer_and_xtrans_known_ground_truth_conformance() {
    for proof in synthetic_proofs() {
        assert_eq!(proof.non_finite_components, 0, "{} finite", proof.cfa);
        assert!(proof.rgb_mae < 0.035, "{} MAE {}", proof.cfa, proof.rgb_mae);
        assert!(
            proof.rgb_max_error < 0.18,
            "{} max {}",
            proof.cfa,
            proof.rgb_max_error
        );
        assert!(
            proof.neutral_max_channel_skew < 1.0e-5,
            "{} neutral skew {}",
            proof.cfa,
            proof.neutral_max_channel_skew
        );
    }
}

fn synthetic_proofs() -> Vec<SyntheticProof> {
    [
        ("bayer_rggb", CFA::new("RGGB")),
        ("xtrans_6x6", CFA::new(XTRANS_PATTERN)),
    ]
    .into_iter()
    .map(|(name, cfa)| synthetic_proof(name, &cfa))
    .collect()
}

fn synthetic_proof(name: &'static str, cfa: &CFA) -> SyntheticProof {
    let (width, height) = (96, 96);
    let truth = (0..height)
        .flat_map(|row| {
            (0..width).map(move |col| {
                let x = col as f32 / (width - 1) as f32;
                let y = row as f32 / (height - 1) as f32;
                [0.2 + 0.45 * x, 0.25 + 0.35 * y, 0.3 + 0.25 * (x + y) * 0.5]
            })
        })
        .collect::<Vec<_>>();
    let synthetic_mosaic = mosaic(cfa, &truth, width, height);
    let roi = Rect::new(Point::new(0, 0), Dim2::new(width, height));
    let demosaiced = if name == "bayer_rggb" {
        demosaic_bayer_hq(&synthetic_mosaic, cfa, roi)
    } else {
        demosaic_xtrans_hq_with_cancel(&synthetic_mosaic, cfa, roi, || Ok(()))
            .expect("demosaic synthetic X-Trans")
            .0
    };

    let mut absolute_error = 0.0;
    let mut max_error = 0.0_f32;
    let mut count = 0;
    let mut non_finite = 0;
    for row in 8..height - 8 {
        for col in 8..width - 8 {
            let index = row * width + col;
            for (value, expected) in demosaiced.data[index].iter().zip(truth[index]) {
                non_finite += usize::from(!value.is_finite());
                let error = (value - expected).abs();
                absolute_error += error;
                max_error = max_error.max(error);
                count += 1;
            }
        }
    }

    let neutral_truth = vec![[0.42; 3]; width * height];
    let neutral_mosaic = mosaic(cfa, &neutral_truth, width, height);
    let neutral = if name == "bayer_rggb" {
        demosaic_bayer_hq(&neutral_mosaic, cfa, roi)
    } else {
        demosaic_xtrans_hq_with_cancel(&neutral_mosaic, cfa, roi, || Ok(()))
            .expect("demosaic neutral X-Trans")
            .0
    };
    let neutral_skew = neutral
        .data
        .iter()
        .map(|pixel| {
            pixel.iter().copied().fold(f32::NEG_INFINITY, f32::max)
                - pixel.iter().copied().fold(f32::INFINITY, f32::min)
        })
        .fold(0.0, f32::max);

    SyntheticProof {
        cfa: name,
        rgb_mae: absolute_error / count as f32,
        rgb_max_error: max_error,
        neutral_max_channel_skew: neutral_skew,
        non_finite_components: non_finite,
    }
}

fn mosaic(cfa: &CFA, truth: &[[f32; 3]], width: usize, height: usize) -> PixF32 {
    let pixels = (0..height)
        .flat_map(|row| {
            (0..width).map(move |col| {
                let channel = match cfa.color_at(row, col) {
                    CFA_COLOR_R => 0,
                    CFA_COLOR_G => 1,
                    CFA_COLOR_B => 2,
                    _ => panic!("synthetic fixture must be RGB CFA"),
                };
                truth[row * width + col][channel]
            })
        })
        .collect();
    PixF32::new_with(pixels, width, height)
}
