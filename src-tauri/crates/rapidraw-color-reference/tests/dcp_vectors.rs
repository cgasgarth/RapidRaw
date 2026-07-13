use rapidraw_color_reference::{
    ReferenceError,
    dcp::{
        BoundaryPolicy, ColorTemperatureKelvin, DCP_REFERENCE_CONTRACT_ID, HueSatCoordinates,
        HueSatMap, HueSatMapDimensions, HueSatMapEntry, interpolate_dual_illuminant_matrix,
    },
    matrix::Matrix3,
};

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual={actual:.12} expected={expected:.12}"
    );
}

fn entry(hue_shift_degrees: f64, saturation_scale: f64, value_scale: f64) -> HueSatMapEntry {
    HueSatMapEntry::new(hue_shift_degrees, saturation_scale, value_scale).unwrap()
}

#[test]
fn dng_dual_illuminant_interpolation_uses_reciprocal_temperature() {
    // DNG 1.7.1 dual-illuminant profiles interpolate in reciprocal color temperature. The
    // harmonic mean is therefore the exact 50% point, unlike the arithmetic Kelvin midpoint.
    let warm = ColorTemperatureKelvin::new(2_850.0).unwrap();
    let cool = ColorTemperatureKelvin::new(6_500.0).unwrap();
    let harmonic_midpoint =
        ColorTemperatureKelvin::new(2.0 / (2_850_f64.recip() + 6_500_f64.recip())).unwrap();
    let warm_matrix = Matrix3::new([[0.0, 1.0, 2.0], [3.0, 4.0, 5.0], [6.0, 7.0, 8.0]]).unwrap();
    let cool_matrix = Matrix3::new([[2.0, 3.0, 4.0], [5.0, 6.0, 7.0], [8.0, 9.0, 10.0]]).unwrap();
    let midpoint = interpolate_dual_illuminant_matrix(
        warm,
        warm_matrix,
        cool,
        cool_matrix,
        harmonic_midpoint,
        BoundaryPolicy::Reject,
    )
    .unwrap();
    for (actual_row, expected_row) in
        midpoint
            .0
            .into_iter()
            .zip([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.0]])
    {
        for (actual, expected) in actual_row.into_iter().zip(expected_row) {
            close(actual, expected, 2e-15);
        }
    }
    let arithmetic_midpoint = ColorTemperatureKelvin::new((2_850.0 + 6_500.0) / 2.0).unwrap();
    let arithmetic = interpolate_dual_illuminant_matrix(
        warm,
        warm_matrix,
        cool,
        cool_matrix,
        arithmetic_midpoint,
        BoundaryPolicy::Reject,
    )
    .unwrap();
    assert!((arithmetic.0[0][0] - 1.0).abs() > 0.1);
}

#[test]
fn dual_illuminant_boundary_policy_is_explicit_and_detects_degenerate_profiles() {
    let warm = ColorTemperatureKelvin::new(2_850.0).unwrap();
    let cool = ColorTemperatureKelvin::new(6_500.0).unwrap();
    let outside = ColorTemperatureKelvin::new(2_000.0).unwrap();
    let first = Matrix3::identity();
    let second = Matrix3::new([[2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 2.0]]).unwrap();
    assert_eq!(
        interpolate_dual_illuminant_matrix(
            warm,
            first,
            cool,
            second,
            outside,
            BoundaryPolicy::Reject
        ),
        Err(ReferenceError::OutOfDomain)
    );
    assert_eq!(
        interpolate_dual_illuminant_matrix(
            warm,
            first,
            cool,
            second,
            outside,
            BoundaryPolicy::Clamp
        )
        .unwrap(),
        first
    );
    let extrapolated = interpolate_dual_illuminant_matrix(
        warm,
        first,
        cool,
        second,
        outside,
        BoundaryPolicy::Extrapolate,
    )
    .unwrap();
    assert!(extrapolated.0[0][0] < 1.0);
    assert_eq!(
        interpolate_dual_illuminant_matrix(warm, first, warm, second, warm, BoundaryPolicy::Clamp),
        Err(ReferenceError::CoincidentIlluminants)
    );
    assert!(ColorTemperatureKelvin::new(0.0).is_err());
}

#[test]
fn dcp_hue_only_table_wraps_continuously_and_periodically() {
    // DNG hue divisions are cyclic: the final division interpolates back to division zero.
    let map = HueSatMap::new(
        HueSatMapDimensions::new(4, 1, 1).unwrap(),
        vec![
            entry(0.0, 1.0, 1.0),
            entry(1.0, 1.0, 1.0),
            entry(0.0, 1.0, 1.0),
            entry(-1.0, 1.0, 1.0),
        ],
    )
    .unwrap();
    let sample = |hue| {
        map.evaluate(
            HueSatCoordinates::new(hue, 0.5, 0.5).unwrap(),
            BoundaryPolicy::Clamp,
        )
        .unwrap()
        .hue_shift_degrees
    };
    close(sample(45.0), 0.5, 1e-15);
    close(sample(-45.0), -0.5, 1e-15);
    close(sample(45.0), sample(405.0), 0.0);
    close(sample(-1.0), sample(359.0), 0.0);
    assert!((sample(1.0) - sample(359.0)).abs() < 0.023);
}

#[test]
fn dcp_three_dimensional_table_uses_hue_fastest_trilinear_order() {
    // ProfileHueSatMapData is hue-fastest, then saturation, then value in the DNG specification.
    let mut entries = Vec::new();
    for value in 0..2 {
        for saturation in 0..2 {
            for hue in 0..2 {
                let basis = hue as f64 + 10.0 * saturation as f64 + 100.0 * value as f64;
                entries.push(entry(basis, 1.0 + basis / 100.0, 2.0 + basis / 50.0));
            }
        }
    }
    let map = HueSatMap::new(HueSatMapDimensions::new(2, 2, 2).unwrap(), entries).unwrap();
    for value in 0..2 {
        for saturation in 0..2 {
            for hue in 0..2 {
                let expected = hue as f64 + 10.0 * saturation as f64 + 100.0 * value as f64;
                let sample = map
                    .evaluate(
                        HueSatCoordinates::new(hue as f64 * 180.0, saturation as f64, value as f64)
                            .unwrap(),
                        BoundaryPolicy::Reject,
                    )
                    .unwrap();
                close(sample.hue_shift_degrees, expected, 0.0);
            }
        }
    }
    let interior = map
        .evaluate(
            HueSatCoordinates::new(45.0, 0.25, 0.5).unwrap(),
            BoundaryPolicy::Reject,
        )
        .unwrap();
    close(interior.hue_shift_degrees, 52.75, 1e-14);
    close(interior.saturation_scale, 1.5275, 1e-14);
    close(interior.value_scale, 3.055, 1e-14);

    let outside = HueSatCoordinates::new(45.0, -0.5, 1.5).unwrap();
    assert_eq!(
        map.evaluate(outside, BoundaryPolicy::Reject),
        Err(ReferenceError::OutOfDomain)
    );
    close(
        map.evaluate(outside, BoundaryPolicy::Clamp)
            .unwrap()
            .hue_shift_degrees,
        100.25,
        1e-14,
    );
    close(
        map.evaluate(outside, BoundaryPolicy::Extrapolate)
            .unwrap()
            .hue_shift_degrees,
        145.25,
        1e-14,
    );

    let signed_extrapolation = HueSatMap::new(
        HueSatMapDimensions::new(1, 2, 1).unwrap(),
        vec![entry(0.0, 1.0, 1.0), entry(0.0, 2.0, 1.0)],
    )
    .unwrap()
    .evaluate(
        HueSatCoordinates::new(0.0, -2.0, 0.5).unwrap(),
        BoundaryPolicy::Extrapolate,
    )
    .unwrap();
    close(signed_extrapolation.saturation_scale, -1.0, 0.0);
}

#[test]
fn dcp_tables_reject_corrupt_shape_and_nonfinite_or_negative_entries() {
    let dimensions = HueSatMapDimensions::new(2, 2, 2).unwrap();
    assert_eq!(
        HueSatMap::new(dimensions, vec![entry(0.0, 1.0, 1.0)]),
        Err(ReferenceError::InvalidTableLength)
    );
    assert!(HueSatMapDimensions::new(0, 2, 2).is_err());
    assert!(HueSatMapEntry::new(0.0, -1.0, 1.0).is_err());
    assert!(HueSatMapEntry::new(f64::NAN, 1.0, 1.0).is_err());
    assert!(HueSatCoordinates::new(f64::INFINITY, 0.5, 0.5).is_err());
    assert!(ColorTemperatureKelvin::new(f64::from_bits(1)).is_err());
    assert_eq!(
        HueSatMapDimensions::new(usize::MAX, 2, 2).and_then(|dimensions| HueSatMap::new(
            dimensions,
            Vec::new()
        )
        .map(|_| ())),
        Err(ReferenceError::InvalidTableDimensions)
    );
    assert_eq!(DCP_REFERENCE_CONTRACT_ID, "rapidraw.color-reference.dcp.v1");
}
