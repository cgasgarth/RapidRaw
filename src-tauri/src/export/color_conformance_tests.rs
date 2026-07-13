use std::{fs, io::Cursor};

use image::{
    DynamicImage, ImageBuffer, ImageDecoder, ImageFormat, Rgba, codecs::tiff::TiffDecoder,
};
use lcms2::Profile as LcmsProfile;
use moxcms::{CicpColorPrimaries, ColorProfile, MatrixCoefficients, TransferCharacteristics};
use rapidraw_color_reference::{
    output::{ControlledOutputSpace, encode_ap1_to_controlled_output, quantize_rgb16},
    transfer::linear_to_srgb_channel,
};

use crate::{
    color::{
        controlled_profiles::{ControlledProfileKind, controlled_profiles, malformed_profiles},
        working_to_output_transform::WorkingColorState,
    },
    export::{
        export_color_policy::{
            ExportColorProfile, ExportRenderingIntent,
            export_rgb16_pixels_with_working_color_state, transform_rgb16_with_controlled_icc,
        },
        export_encoders::{encode_controlled_icc_tiff16, encode_image_with_working_color_state},
        export_processing::commit_color_conformance_bytes,
    },
};

const AP1_FIXTURE: [[f32; 3]; 4] = [
    [0.18, 0.18, 0.18],
    [0.40, 0.20, 0.10],
    [0.10, 0.30, 0.50],
    [0.60, 0.45, 0.20],
];
const MATRIX_OUTPUT_RGB16_TOLERANCE: u16 = 4;
// The synthetic narrow ICC crosses an additional quantized sRGB→PCS→RGB CMM boundary.
const NARROW_CMM_RGB16_TOLERANCE: u16 = 2_048;

fn fixture() -> DynamicImage {
    DynamicImage::ImageRgba32F(ImageBuffer::from_fn(2, 2, |x, y| {
        let rgb = AP1_FIXTURE[(y * 2 + x) as usize];
        Rgba([rgb[0], rgb[1], rgb[2], 1.0])
    }))
}

fn decoded_tiff_rgb16(bytes: &[u8]) -> Vec<u16> {
    image::load_from_memory_with_format(bytes, ImageFormat::Tiff)
        .unwrap()
        .to_rgb16()
        .into_raw()
}

fn embedded_tiff_icc(bytes: &[u8]) -> Vec<u8> {
    TiffDecoder::new(Cursor::new(bytes))
        .unwrap()
        .icc_profile()
        .unwrap()
        .unwrap()
}

fn normalized_creation_time(mut profile: Vec<u8>) -> Vec<u8> {
    profile[24..36].fill(0);
    profile
}

fn assert_pixels_within(actual: &[u16], expected: &[u16], tolerance: u16) {
    assert_eq!(actual.len(), expected.len());
    for (index, (&actual, &expected)) in actual.iter().zip(expected).enumerate() {
        assert!(
            actual.abs_diff(expected) <= tolerance,
            "component {index}: actual={actual} expected={expected} tolerance={tolerance}"
        );
    }
}

#[test]
fn committed_standard_profile_outputs_match_independent_ap1_oracle_and_metadata() {
    let directory = tempfile::tempdir().unwrap();
    for generated in controlled_profiles() {
        let (profile, oracle, tolerance) = match generated.kind {
            ControlledProfileKind::Srgb => (
                ExportColorProfile::Srgb,
                ControlledOutputSpace::SrgbD65,
                MATRIX_OUTPUT_RGB16_TOLERANCE,
            ),
            ControlledProfileKind::DisplayP3 => (
                ExportColorProfile::DisplayP3,
                ControlledOutputSpace::DisplayP3D65,
                MATRIX_OUTPUT_RGB16_TOLERANCE,
            ),
            ControlledProfileKind::ProPhoto => (
                ExportColorProfile::ProPhotoRgb,
                ControlledOutputSpace::ProPhotoD50,
                MATRIX_OUTPUT_RGB16_TOLERANCE,
            ),
            ControlledProfileKind::NarrowD65 => continue,
        };
        let encoded = encode_image_with_working_color_state(
            &fixture(),
            WorkingColorState::AcesCgLinearV1,
            "tiff",
            100,
            &profile,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            None,
        )
        .unwrap();
        let output_path = directory.path().join(format!("{profile:?}.tiff"));
        commit_color_conformance_bytes(&output_path, &encoded.bytes).unwrap();
        let committed = fs::read(&output_path).unwrap();
        assert_eq!(committed, encoded.bytes);
        let actual = decoded_tiff_rgb16(&committed);
        let expected = AP1_FIXTURE
            .iter()
            .flat_map(|rgb| {
                quantize_rgb16(encode_ap1_to_controlled_output(rgb.map(f64::from), oracle).unwrap())
            })
            .collect::<Vec<_>>();
        assert_pixels_within(&actual, &expected, tolerance);

        let embedded = embedded_tiff_icc(&committed);
        assert_eq!(
            normalized_creation_time(embedded.clone()),
            normalized_creation_time(generated.bytes)
        );
        let parsed = ColorProfile::new_from_slice(&embedded).unwrap();
        match profile {
            ExportColorProfile::Srgb => {
                let cicp = parsed.cicp.unwrap();
                assert_eq!(cicp.color_primaries, CicpColorPrimaries::Bt709);
                assert_eq!(cicp.transfer_characteristics, TransferCharacteristics::Srgb);
                assert_eq!(cicp.matrix_coefficients, MatrixCoefficients::Identity);
                assert!(cicp.full_range);
            }
            ExportColorProfile::DisplayP3 => {
                let cicp = parsed.cicp.unwrap();
                assert_eq!(cicp.color_primaries, CicpColorPrimaries::Smpte432);
                assert_eq!(cicp.transfer_characteristics, TransferCharacteristics::Srgb);
                assert_eq!(cicp.matrix_coefficients, MatrixCoefficients::Identity);
                assert!(cicp.full_range);
            }
            ExportColorProfile::ProPhotoRgb => assert!(parsed.cicp.is_none()),
            _ => unreachable!(),
        }
        let metadata = encoded.color_policy.unwrap();
        assert_eq!(metadata.requested_rendering_intent, "Relative colorimetric");
        assert_eq!(metadata.effective_rendering_intent, "Relative colorimetric");
        if profile == ExportColorProfile::Srgb {
            assert_eq!(
                metadata.black_point_compensation,
                "Unavailable for this export path"
            );
        } else {
            assert_eq!(metadata.black_point_compensation, "Available but disabled");
        }
        assert!(metadata.icc_embedded);
        assert!(metadata.transform_policy_fingerprint.starts_with("sha256:"));
    }
}

#[test]
fn committed_srgb_output_is_single_encoded_not_double_transferred() {
    let encoded = encode_image_with_working_color_state(
        &fixture(),
        WorkingColorState::AcesCgLinearV1,
        "tiff",
        100,
        &ExportColorProfile::Srgb,
        &ExportRenderingIntent::RelativeColorimetric,
        false,
        None,
    )
    .unwrap();
    let actual = decoded_tiff_rgb16(&encoded.bytes);
    let single = encode_ap1_to_controlled_output(
        AP1_FIXTURE[0].map(f64::from),
        ControlledOutputSpace::SrgbD65,
    )
    .unwrap();
    let expected = quantize_rgb16(single);
    let double = quantize_rgb16(single.map(linear_to_srgb_channel));
    for channel in 0..3 {
        assert!(actual[channel].abs_diff(expected[channel]) <= MATRIX_OUTPUT_RGB16_TOLERANCE);
        assert!(actual[channel].abs_diff(double[channel]) > 10_000);
    }
}

#[test]
fn controlled_narrow_profile_roundtrips_committed_bytes_against_oracle() {
    let generated = controlled_profiles()
        .into_iter()
        .find(|profile| profile.kind == ControlledProfileKind::NarrowD65)
        .unwrap();
    let (srgb, width, height, _) = export_rgb16_pixels_with_working_color_state(
        &fixture(),
        WorkingColorState::AcesCgLinearV1,
        &ExportColorProfile::Srgb,
        &ExportRenderingIntent::RelativeColorimetric,
        false,
    )
    .unwrap();
    let narrow = transform_rgb16_with_controlled_icc(
        &srgb,
        &generated.bytes,
        &ExportRenderingIntent::RelativeColorimetric,
        false,
    )
    .unwrap();
    let encoded =
        encode_controlled_icc_tiff16(&narrow, width, height, generated.bytes.clone()).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let output = directory.path().join("narrow.tiff");
    commit_color_conformance_bytes(&output, &encoded).unwrap();
    let committed = fs::read(output).unwrap();
    assert_eq!(embedded_tiff_icc(&committed), generated.bytes);
    assert!(ColorProfile::new_from_slice(&generated.bytes).is_ok());
    let expected = AP1_FIXTURE
        .iter()
        .flat_map(|rgb| {
            quantize_rgb16(
                encode_ap1_to_controlled_output(
                    rgb.map(f64::from),
                    ControlledOutputSpace::NarrowD65Gamma22,
                )
                .unwrap(),
            )
        })
        .collect::<Vec<_>>();
    let decoded = decoded_tiff_rgb16(&committed);
    assert_pixels_within(&decoded, &expected, NARROW_CMM_RGB16_TOLERANCE);
    assert_ne!(
        decoded, srgb,
        "narrow output must transform pixels, not only retag them"
    );
}

#[test]
fn rendering_intent_and_bpc_are_part_of_policy_identity_and_fail_closed_for_ap1() {
    let image = fixture();
    let relative = encode_image_with_working_color_state(
        &image,
        WorkingColorState::EncodedSrgbV1,
        "tiff",
        100,
        &ExportColorProfile::DisplayP3,
        &ExportRenderingIntent::RelativeColorimetric,
        false,
        None,
    )
    .unwrap()
    .color_policy
    .unwrap();
    let with_bpc = encode_image_with_working_color_state(
        &image,
        WorkingColorState::EncodedSrgbV1,
        "tiff",
        100,
        &ExportColorProfile::DisplayP3,
        &ExportRenderingIntent::RelativeColorimetric,
        true,
        None,
    )
    .unwrap()
    .color_policy
    .unwrap();
    assert_ne!(
        relative.transform_policy_fingerprint,
        with_bpc.transform_policy_fingerprint
    );
    assert_eq!(with_bpc.cmm, "lcms2");
    assert!(with_bpc.black_point_compensation.contains("Enabled"));

    let bpc_error = encode_image_with_working_color_state(
        &image,
        WorkingColorState::AcesCgLinearV1,
        "tiff",
        100,
        &ExportColorProfile::DisplayP3,
        &ExportRenderingIntent::RelativeColorimetric,
        true,
        None,
    )
    .unwrap_err();
    assert!(bpc_error.contains("working_output_bpc_unsupported"));
    let intent_error = encode_image_with_working_color_state(
        &image,
        WorkingColorState::AcesCgLinearV1,
        "tiff",
        100,
        &ExportColorProfile::DisplayP3,
        &ExportRenderingIntent::Perceptual,
        false,
        None,
    )
    .unwrap_err();
    assert!(intent_error.contains("working_output_intent_unsupported"));
}

#[test]
fn generated_corrupt_profiles_are_rejected_without_export_fallback() {
    let seed = controlled_profiles()
        .into_iter()
        .find(|profile| profile.kind == ControlledProfileKind::DisplayP3)
        .unwrap()
        .bytes;
    let source = vec![0_u16, 32_768, u16::MAX];
    for malformed in malformed_profiles(&seed) {
        assert!(ColorProfile::new_from_slice(&malformed).is_err());
        assert!(LcmsProfile::new_icc(&malformed).is_err());
        assert!(
            transform_rgb16_with_controlled_icc(
                &source,
                &malformed,
                &ExportRenderingIntent::RelativeColorimetric,
                false,
            )
            .is_err()
        );
    }
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
#[test]
fn generated_corrupt_display_profiles_fall_back_to_safe_srgb_identity() {
    use crate::color::display_profile::{
        ActiveDisplayProfileStatus, display_preview_transform_snapshot_from_capture,
    };

    let seed = controlled_profiles()
        .into_iter()
        .find(|profile| profile.kind == ControlledProfileKind::DisplayP3)
        .unwrap()
        .bytes;
    for malformed in malformed_profiles(&seed) {
        let snapshot =
            display_preview_transform_snapshot_from_capture(Ok((Some(77), malformed.clone())));
        assert!(matches!(
            snapshot.profile.status,
            ActiveDisplayProfileStatus::FallbackNoActiveProfile
        ));
        assert_ne!(snapshot.icc_bytes, malformed);
        let gray = snapshot.lut.sample_rgb([0.5; 3]);
        assert!((gray[0] - gray[1]).abs() < 0.001 && (gray[1] - gray[2]).abs() < 0.001);
        let fallback = ColorProfile::new_from_slice(&snapshot.icc_bytes).unwrap();
        assert_eq!(
            fallback.cicp.unwrap().color_primaries,
            CicpColorPrimaries::Bt709
        );
    }
}
