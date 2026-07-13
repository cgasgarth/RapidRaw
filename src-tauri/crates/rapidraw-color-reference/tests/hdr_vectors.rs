use rapidraw_color_reference::{
    ReferenceError, difference::delta_e_itp, hdr::rec2100_linear_nits_to_ictcp,
    transfer::pq_inverse_eotf, types::AbsoluteLuminanceNits,
};

#[test]
fn rec2100_neutral_axis_maps_to_pq_intensity_without_opponent_color() {
    for nits in [0.0, 0.1, 100.0, 1_000.0, 10_000.0] {
        let actual = rec2100_linear_nits_to_ictcp([nits; 3]).unwrap();
        let expected = pq_inverse_eotf(AbsoluteLuminanceNits::new(nits).unwrap())
            .unwrap()
            .value();
        assert!((actual.intensity - expected).abs() <= 2.0e-15);
        assert!(actual.tritan.abs() <= 2.0e-15);
        assert!(actual.protan.abs() <= 2.0e-15);
    }
}

#[test]
fn absolute_nit_changes_and_channel_defects_are_visible_to_delta_e_itp() {
    let reference = rec2100_linear_nits_to_ictcp([120.0, 80.0, 25.0]).unwrap();
    let brighter = rec2100_linear_nits_to_ictcp([121.0, 81.0, 26.0]).unwrap();
    let swapped = rec2100_linear_nits_to_ictcp([80.0, 120.0, 25.0]).unwrap();
    let brightness_error = delta_e_itp(reference, brighter).unwrap().value();
    let channel_swap_error = delta_e_itp(reference, swapped).unwrap().value();
    assert!(brightness_error > 0.0);
    assert!(channel_swap_error > brightness_error * 10.0);
}

#[test]
fn rec2100_ictcp_reference_rejects_negative_and_nonfinite_absolute_light() {
    assert_eq!(
        rec2100_linear_nits_to_ictcp([-0.01, 0.0, 0.0]),
        Err(ReferenceError::NegativeLuminance)
    );
    assert_eq!(
        rec2100_linear_nits_to_ictcp([f64::NAN, 0.0, 0.0]),
        Err(ReferenceError::NonFiniteInput)
    );
}
