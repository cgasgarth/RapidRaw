use rapidraw_color_reference::{
    ReferenceError,
    metrics::{
        COLOR_METRICS_CONTRACT_ID, DETAIL_METRICS_CONTRACT_ID, DetailMetricCondition,
        DetailSignalDomain, GAMUT_METRICS_CONTRACT_ID, GamutMetricCondition, GamutSample,
        LabReferenceCondition, StandardObserver, TONE_METRICS_CONTRACT_ID, ToneInputDomain,
        ToneMetricCondition, ToneOutputDomain, ToneSample, measure_detail_signal,
        measure_gamut_sample, measure_perceptual_color_error, measure_tone_curve,
    },
    types::{CieLab, WhitePointXyz},
};

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual={actual:.12} expected={expected:.12}"
    );
}

fn lab_condition() -> LabReferenceCondition {
    LabReferenceCondition::new(
        WhitePointXyz::new(0.96422, 1.0, 0.82521).unwrap(),
        StandardObserver::Cie1931TwoDegree,
        1e-9,
    )
    .unwrap()
}

#[test]
fn tone_metrics_detect_non_monotonicity_and_first_derivative_breaks() {
    let condition = ToneMetricCondition::new(
        ToneInputDomain::Normalized,
        ToneOutputDomain::SceneLinear,
        1e-12,
        0.2,
    )
    .unwrap();
    let clean = [
        ToneSample::new(0.0, 0.0).unwrap(),
        ToneSample::new(1.0, 0.5).unwrap(),
        ToneSample::new(2.0, 1.0).unwrap(),
        ToneSample::new(3.0, 1.5).unwrap(),
    ];
    assert_eq!(
        measure_tone_curve(&clean, condition).unwrap(),
        rapidraw_color_reference::metrics::ToneCurveMetrics {
            monotonicity_violations: 0,
            maximum_negative_step: 0.0,
            derivative_discontinuities: 0,
            maximum_derivative_jump: 0.0,
        }
    );
    let injected_defect = [
        ToneSample::new(0.0, 0.0).unwrap(),
        ToneSample::new(1.0, 0.5).unwrap(),
        ToneSample::new(2.0, 0.4).unwrap(),
        ToneSample::new(3.0, 1.0).unwrap(),
    ];
    let metrics = measure_tone_curve(&injected_defect, condition).unwrap();
    assert_eq!(metrics.monotonicity_violations, 1);
    close(metrics.maximum_negative_step, 0.1, 1e-15);
    assert_eq!(metrics.derivative_discontinuities, 2);
    close(metrics.maximum_derivative_jump, 0.7, 1e-15);
    assert_eq!(
        TONE_METRICS_CONTRACT_ID,
        "rapidraw.color-reference.metrics.tone.v1"
    );
}

#[test]
fn tone_metrics_reject_unsorted_or_insufficient_reference_samples() {
    let condition = ToneMetricCondition::new(
        ToneInputDomain::ExposureValue,
        ToneOutputDomain::Normalized,
        0.0,
        0.0,
    )
    .unwrap();
    assert_eq!(
        measure_tone_curve(&[], condition),
        Err(ReferenceError::InsufficientSamples)
    );
    assert_eq!(
        measure_tone_curve(
            &[
                ToneSample::new(1.0, 0.0).unwrap(),
                ToneSample::new(1.0, 1.0).unwrap(),
            ],
            condition,
        ),
        Err(ReferenceError::NonIncreasingInput)
    );
    assert!(
        ToneMetricCondition::new(
            ToneInputDomain::Normalized,
            ToneOutputDomain::Normalized,
            -1.0,
            0.0,
        )
        .is_err()
    );
}

#[test]
fn perceptual_metrics_report_typed_hue_chroma_and_lightness_errors() {
    let condition = lab_condition();
    let reference = CieLab::new(50.0, 40.0, 0.0).unwrap();
    let rotated_compressed = CieLab::new(52.0, 0.0, 30.0).unwrap();
    let error = measure_perceptual_color_error(reference, rotated_compressed, condition).unwrap();
    close(error.signed_hue_error_degrees.unwrap(), 90.0, 1e-14);
    close(error.signed_chroma_error, -10.0, 1e-14);
    close(error.signed_lightness_error, 2.0, 0.0);

    let near_wrap_reference = CieLab::new(
        50.0,
        20.0 * 179_f64.to_radians().cos(),
        20.0 * 179_f64.to_radians().sin(),
    )
    .unwrap();
    let near_wrap_candidate = CieLab::new(
        50.0,
        20.0 * (-179_f64).to_radians().cos(),
        20.0 * (-179_f64).to_radians().sin(),
    )
    .unwrap();
    close(
        measure_perceptual_color_error(near_wrap_reference, near_wrap_candidate, condition)
            .unwrap()
            .signed_hue_error_degrees
            .unwrap(),
        2.0,
        1e-12,
    );
    assert!(
        measure_perceptual_color_error(CieLab::new(50.0, 0.0, 0.0).unwrap(), reference, condition)
            .unwrap()
            .signed_hue_error_degrees
            .is_none()
    );
    assert_eq!(
        COLOR_METRICS_CONTRACT_ID,
        "rapidraw.color-reference.metrics.color.v1"
    );
}

#[test]
fn gamut_metrics_detect_containment_hue_and_compression_defects() {
    let condition = GamutMetricCondition::new(1e-12, lab_condition()).unwrap();
    let source = CieLab::new(50.0, 50.0, 0.0).unwrap();
    let preserved = measure_gamut_sample(
        GamutSample::new(source, CieLab::new(50.0, 30.0, 0.0).unwrap(), 40.0).unwrap(),
        condition,
    )
    .unwrap();
    assert!(preserved.contained);
    close(preserved.chroma_excess, 0.0, 0.0);
    close(preserved.compression_ratio.unwrap(), 0.6, 1e-15);
    close(preserved.signed_hue_deviation_degrees.unwrap(), 0.0, 0.0);

    let injected_defect = measure_gamut_sample(
        GamutSample::new(source, CieLab::new(50.0, 0.0, 50.0).unwrap(), 40.0).unwrap(),
        condition,
    )
    .unwrap();
    assert!(!injected_defect.contained);
    close(injected_defect.chroma_excess, 10.0, 0.0);
    close(injected_defect.compression_ratio.unwrap(), 1.0, 0.0);
    close(
        injected_defect.signed_hue_deviation_degrees.unwrap(),
        90.0,
        1e-14,
    );
    assert_eq!(
        GAMUT_METRICS_CONTRACT_ID,
        "rapidraw.color-reference.metrics.gamut.v1"
    );
}

#[test]
fn detail_metrics_detect_overshoot_halo_ringing_and_tile_seams() {
    let reference = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    let condition =
        DetailMetricCondition::new(DetailSignalDomain::LinearLight, 1.0, 3, 3, 0.01, vec![7])
            .unwrap();
    let clean = measure_detail_signal(&reference, &reference, &condition).unwrap();
    assert_eq!(
        clean,
        rapidraw_color_reference::metrics::DetailSignalMetrics {
            overshoot: 0.0,
            undershoot: 0.0,
            halo_amplitude: 0.0,
            ringing_sign_changes: 0,
            maximum_tile_seam_error: 0.0,
        }
    );
    let injected_defects = [-0.1, 0.1, -0.1, 1.2, 0.9, 1.1, 1.0, 1.3];
    let metrics = measure_detail_signal(&reference, &injected_defects, &condition).unwrap();
    close(metrics.overshoot, 0.3, 1e-15);
    close(metrics.undershoot, 0.1, 1e-15);
    close(metrics.halo_amplitude, 0.2, 1e-15);
    assert_eq!(metrics.ringing_sign_changes, 5);
    close(metrics.maximum_tile_seam_error, 0.3, 1e-15);
    assert_eq!(
        DETAIL_METRICS_CONTRACT_ID,
        "rapidraw.color-reference.metrics.detail.v1"
    );
}

#[test]
fn detail_metrics_reject_mismatched_nonfinite_and_invalid_boundaries() {
    let condition =
        DetailMetricCondition::new(DetailSignalDomain::Encoded, 0.5, 1, 1, 0.0, vec![1]).unwrap();
    assert_eq!(
        measure_detail_signal(&[0.0, 1.0], &[0.0], &condition),
        Err(ReferenceError::MismatchedSampleLength)
    );
    assert_eq!(
        measure_detail_signal(&[0.0, 1.0], &[0.0, f64::NAN], &condition),
        Err(ReferenceError::NonFiniteInput)
    );
    let invalid =
        DetailMetricCondition::new(DetailSignalDomain::LinearLight, 1.0, 2, 1, 0.0, vec![0])
            .unwrap();
    assert_eq!(
        measure_detail_signal(&[0.0, 1.0], &[0.0, 1.0], &invalid),
        Err(ReferenceError::InvalidMetricCondition)
    );
}
