use rapidraw_color_reference::{
    REFERENCE_CONTRACT_ID,
    adaptation::{bradford_adaptation, cat16_adaptation},
    difference::{delta_e_76, delta_e_2000, delta_e_itp},
    matrix::{LinearRgbToXyzMatrix, Matrix3},
    output::{ControlledOutputSpace, encode_ap1_to_controlled_output},
    transfer::{
        decode_rec2020, decode_srgb, encode_rec2020, encode_srgb, hlg_inverse_oetf, hlg_oetf,
        linear_to_rec2020_channel, linear_to_srgb_channel, pq_eotf, pq_inverse_eotf,
        rec2020_to_linear_channel, srgb_to_linear_channel,
    },
    types::{
        AbsoluteLuminanceNits, ChromaticityXyY, CieLab, EncodedRec2020, EncodedSrgb, HlgSignal,
        ICtCp, LinearRgb, PqSignal, SceneLinearHlg, WhitePointXyz,
    },
};

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual={actual:.12} expected={expected:.12}"
    );
}

#[test]
fn aces_ap1_to_xyz_d60_matrix_matches_published_neutral() {
    // Academy ACES CTL `ACESlib.Transform_Common.ctl`, AP1-to-XYZ(D60) matrix.
    let ap1_to_xyz = LinearRgbToXyzMatrix::new([
        [0.662_454_181_1, 0.134_004_206_5, 0.156_187_687_0],
        [0.272_228_716_8, 0.674_081_765_8, 0.053_689_517_4],
        [-0.005_574_649_5, 0.004_060_733_5, 1.010_339_100_3],
    ])
    .unwrap();
    let rgb = LinearRgb::new(1.0, 1.0, 1.0).unwrap();
    let xyz = ap1_to_xyz.transform(rgb).unwrap();
    close(xyz.x, 0.952_646_074_6, 1e-10);
    close(xyz.y, 1.0, 1e-10);
    close(xyz.z, 1.008_825_184_3, 1e-10);
    let round_trip = ap1_to_xyz
        .matrix()
        .inverse()
        .unwrap()
        .transform(xyz.components());
    for value in round_trip {
        close(value, 1.0, 1e-12);
    }
}

#[test]
fn controlled_output_oracles_preserve_ap1_neutral_and_declared_transfer() {
    for output in [
        ControlledOutputSpace::SrgbD65,
        ControlledOutputSpace::DisplayP3D65,
        ControlledOutputSpace::ProPhotoD50,
        ControlledOutputSpace::NarrowD65Gamma22,
    ] {
        let encoded = encode_ap1_to_controlled_output([0.18; 3], output).unwrap();
        close(encoded[0], encoded[1], 7e-6);
        close(encoded[1], encoded[2], 7e-6);
    }
    let srgb = encode_ap1_to_controlled_output([0.18; 3], ControlledOutputSpace::SrgbD65).unwrap();
    for channel in srgb {
        close(channel, linear_to_srgb_channel(0.18), 4e-7);
    }
}

#[test]
fn cie_xyy_d65_conversion_matches_published_xyz() {
    let xyz = ChromaticityXyY::new(0.3127, 0.3290, 1.0)
        .unwrap()
        .to_xyz()
        .unwrap();
    close(xyz.x, 0.950_455_927_052, 1e-12);
    close(xyz.y, 1.0, 0.0);
    close(xyz.z, 1.089_057_750_760, 1e-12);
}

#[test]
fn bradford_d65_to_d50_matches_icc_reference_matrix_and_white() {
    // ICC.1:2022 Annex E D65-to-D50 Bradford adaptation.
    let d65 = WhitePointXyz::new(0.95047, 1.0, 1.08883).unwrap();
    let d50 = WhitePointXyz::new(0.96422, 1.0, 0.82521).unwrap();
    let adaptation = bradford_adaptation(d65, d50).unwrap();
    let expected = [
        [1.047_811_2, 0.022_886_6, -0.050_127_0],
        [0.029_542_4, 0.990_484_4, -0.017_049_1],
        [-0.009_234_5, 0.015_043_6, 0.752_131_6],
    ];
    for (actual_row, expected_row) in adaptation.matrix().0.into_iter().zip(expected) {
        for (actual, expected) in actual_row.into_iter().zip(expected_row) {
            close(actual, expected, 5e-7);
        }
    }
    let adapted = adaptation.adapt(d65.xyz()).unwrap();
    for (actual, expected) in adapted.components().into_iter().zip(d50.xyz().components()) {
        close(actual, expected, 2e-15);
    }
}

#[test]
fn cat16_full_adaptation_matches_published_matrix_equations() {
    // CAT16 M16 coefficients are published by Li et al. (2017); this D65-to-D50 full-adaptation
    // vector independently fixes the matrix composition and cone scaling order.
    let d65 = WhitePointXyz::new(0.95047, 1.0, 1.08883).unwrap();
    let d50 = WhitePointXyz::new(0.96422, 1.0, 0.82521).unwrap();
    let adaptation = cat16_adaptation(d65, d50).unwrap();
    let expected = [
        [1.010_822_616_789, 0.040_599_054_105, -0.034_105_991_463],
        [0.005_413_876_872, 0.993_595_630_938, 0.001_155_957_782],
        [0.000_250_848_316, -0.011_480_159_745, 0.768_211_507_716],
    ];
    for (actual_row, expected_row) in adaptation.matrix().0.into_iter().zip(expected) {
        for (actual, expected) in actual_row.into_iter().zip(expected_row) {
            close(actual, expected, 5e-13);
        }
    }
    let adapted = adaptation.adapt(d65.xyz()).unwrap();
    for (actual, expected) in adapted.components().into_iter().zip(d50.xyz().components()) {
        close(actual, expected, 6e-16);
    }
}

#[test]
fn srgb_transfer_matches_iec_vectors_without_clamping_extended_values() {
    close(
        srgb_to_linear_channel(0.04045),
        0.003_130_804_953_560_371_3,
        1e-15,
    );
    close(srgb_to_linear_channel(0.5), 0.214_041_140_482_232_55, 1e-15);
    close(linear_to_srgb_channel(0.214_041_140_482_232_55), 0.5, 1e-15);
    close(srgb_to_linear_channel(-0.1292), -0.01, 1e-15);
    assert!(linear_to_srgb_channel(2.0) > 1.0);
    let encoded = EncodedSrgb::new(-0.1292, 0.5, 1.2).unwrap();
    let round_trip = encode_srgb(decode_srgb(encoded).unwrap()).unwrap();
    close(round_trip.red, encoded.red, 1e-15);
    close(round_trip.green, encoded.green, 1e-15);
    close(round_trip.blue, encoded.blue, 1e-15);
}

#[test]
fn rec2020_transfer_matches_bt2020_vectors_and_preserves_extended_values() {
    close(
        linear_to_rec2020_channel(0.018_053_968_510_807),
        0.081_242_858_298_634,
        2e-15,
    );
    close(
        linear_to_rec2020_channel(0.18),
        0.408_848_108_891_225,
        2e-15,
    );
    close(
        rec2020_to_linear_channel(0.408_848_108_891_225),
        0.18,
        2e-15,
    );
    close(linear_to_rec2020_channel(-0.1), -0.45, 1e-15);
    assert!(linear_to_rec2020_channel(2.0) > 1.0);
    let encoded = EncodedRec2020::new(-0.45, 0.408_848_108_891_225, 1.2).unwrap();
    let round_trip = encode_rec2020(decode_rec2020(encoded).unwrap()).unwrap();
    for (actual, expected) in [round_trip.red, round_trip.green, round_trip.blue]
        .into_iter()
        .zip([encoded.red, encoded.green, encoded.blue])
    {
        close(actual, expected, 2e-14);
    }
}

#[test]
fn pq_and_hlg_match_bt2100_st2084_normative_points_without_over_range_clamps() {
    let pq_vectors = [
        // ST 2084's normative max(·, 0) makes code zero decode to black, while the exact inverse
        // black code is c1^m2 rather than bit-exact zero.
        (0.0, 0.0, 0.000_000_730_955_903),
        (0.508_078_421_517_399, 100.0, 0.508_078_421_517_399),
        (0.751_827_096_247_041, 1_000.0, 0.751_827_096_247_041),
        (1.0, 10_000.0, 1.0),
    ];
    for (signal, nits, inverse_signal) in pq_vectors {
        close(
            pq_eotf(PqSignal::new(signal).unwrap()).unwrap().value(),
            nits,
            nits.max(1.0) * 2e-12,
        );
        close(
            pq_inverse_eotf(AbsoluteLuminanceNits::new(nits).unwrap())
                .unwrap()
                .value(),
            inverse_signal,
            2e-13,
        );
    }
    let over_range_nits = AbsoluteLuminanceNits::new(20_000.0).unwrap();
    let over_range_signal = pq_inverse_eotf(over_range_nits).unwrap();
    assert!(over_range_signal.value() > 1.0);
    close(pq_eotf(over_range_signal).unwrap().value(), 20_000.0, 5e-8);
    assert!(PqSignal::new(-0.01).is_err());
    assert!(AbsoluteLuminanceNits::new(-0.01).is_err());
    assert!(pq_eotf(PqSignal::new(2.0).unwrap()).is_err());

    let hlg_vectors = [(0.0, 0.0), (1.0 / 12.0, 0.5), (1.0, 1.0)];
    for (scene, signal) in hlg_vectors {
        close(
            hlg_oetf(SceneLinearHlg::new(scene).unwrap())
                .unwrap()
                .value(),
            signal,
            5e-8,
        );
        close(
            hlg_inverse_oetf(HlgSignal::new(signal).unwrap())
                .unwrap()
                .value(),
            scene,
            5e-8,
        );
    }
    let hlg_over_range = SceneLinearHlg::new(2.0).unwrap();
    let hlg_signal = hlg_oetf(hlg_over_range).unwrap();
    assert!(hlg_signal.value() > 1.0);
    close(hlg_inverse_oetf(hlg_signal).unwrap().value(), 2.0, 2e-14);
    assert!(SceneLinearHlg::new(-0.01).is_err());
    assert!(HlgSignal::new(-0.01).is_err());
}

#[test]
fn delta_e_itp_matches_bt2124_axis_units_and_pathological_finite_values() {
    let origin = ICtCp::new(0.0, 0.0, 0.0).unwrap();
    close(
        delta_e_itp(origin, ICtCp::new(1.0 / 720.0, 0.0, 0.0).unwrap())
            .unwrap()
            .value(),
        1.0,
        1e-15,
    );
    close(
        delta_e_itp(origin, ICtCp::new(0.0, 1.0 / 360.0, 0.0).unwrap())
            .unwrap()
            .value(),
        1.0,
        1e-15,
    );
    close(
        delta_e_itp(origin, ICtCp::new(0.0, 0.0, 1.0 / 720.0).unwrap())
            .unwrap()
            .value(),
        1.0,
        1e-15,
    );
    let negative_over_range = ICtCp::new(-0.25, -1.5, 2.0).unwrap();
    let positive_over_range = ICtCp::new(1.25, 1.5, -2.0).unwrap();
    let forward = delta_e_itp(negative_over_range, positive_over_range).unwrap();
    assert!(forward.value().is_finite() && forward.value() > 0.0);
    close(
        forward.value(),
        delta_e_itp(positive_over_range, negative_over_range)
            .unwrap()
            .value(),
        0.0,
    );
    close(
        delta_e_itp(negative_over_range, negative_over_range)
            .unwrap()
            .value(),
        0.0,
        0.0,
    );
    assert!(ICtCp::new(f64::INFINITY, 0.0, 0.0).is_err());
    let huge = ICtCp::new(f64::MAX, 0.0, 0.0).unwrap();
    assert!(delta_e_itp(huge, origin).is_err());
}

#[test]
fn cie_color_difference_matches_sharma_published_supplementary_vectors() {
    // Sharma et al. CIEDE2000 supplementary test data, including the first six
    // small-difference pairs and a hue-rotation edge case.
    let vectors = [
        ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
        ((50.0, 3.1571, -77.2803), (50.0, 0.0, -82.7485), 2.8615),
        ((50.0, 2.8361, -74.0200), (50.0, 0.0, -82.7485), 3.4412),
        ((50.0, -1.3802, -84.2814), (50.0, 0.0, -82.7485), 1.0000),
        ((50.0, -1.1848, -84.8006), (50.0, 0.0, -82.7485), 1.0000),
        ((50.0, -0.9009, -85.5211), (50.0, 0.0, -82.7485), 1.0000),
        ((50.0, -0.0010, 2.4900), (50.0, 0.0010, -2.4900), 4.8045),
    ];
    for ((l1, a1, b1), (l2, a2, b2), expected) in vectors {
        let left = CieLab::new(l1, a1, b1).unwrap();
        let right = CieLab::new(l2, a2, b2).unwrap();
        close(delta_e_2000(left, right), expected, 5e-5);
        close(delta_e_2000(right, left), expected, 5e-5);
    }
    close(
        delta_e_76(
            CieLab::new(50.0, 2.5, 0.0).unwrap(),
            CieLab::new(50.0, 0.0, 0.0).unwrap(),
        ),
        2.5,
        1e-15,
    );
    assert_eq!(REFERENCE_CONTRACT_ID, "rapidraw.color-reference.v1");
    assert!(LinearRgb::new(f64::NAN, 0.0, 0.0).is_err());
}

#[test]
fn reference_equations_preserve_identity_and_reject_undefined_domains() {
    let d65 = WhitePointXyz::new(0.95047, 1.0, 1.08883).unwrap();
    let sample = ChromaticityXyY::new(0.25, 0.40, 0.18)
        .unwrap()
        .to_xyz()
        .unwrap();
    let adapted = bradford_adaptation(d65, d65)
        .unwrap()
        .adapt(sample)
        .unwrap();
    for (actual, expected) in adapted.components().into_iter().zip(sample.components()) {
        close(actual, expected, 2e-16);
    }
    assert!(
        Matrix3::new([[1.0, 2.0, 3.0], [2.0, 4.0, 6.0], [0.0, 0.0, 0.0]])
            .unwrap()
            .inverse()
            .is_err()
    );
    let small = Matrix3::new([[1e-100, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
        .unwrap()
        .inverse()
        .unwrap()
        .transform([1e-100, 1.0, 1.0]);
    for value in small {
        close(value, 1.0, 1e-15);
    }
    assert!(ChromaticityXyY::new(0.3, 0.0, 1.0).is_err());
    assert!(WhitePointXyz::new(0.0, 1.0, 1.0).is_err());

    // IEC's rounded encode/decode breakpoints have a documented tiny discontinuity, so the
    // breakpoint itself is asserted against its published value in the vector test above.
    for encoded in [-2.0, -0.5, 0.0, 0.04, 0.5, 1.0, 2.0, 4.0] {
        close(
            linear_to_srgb_channel(srgb_to_linear_channel(encoded)),
            encoded,
            2e-14,
        );
    }
    let colors = [
        CieLab::new(-10.0, -150.0, 100.0).unwrap(),
        CieLab::new(0.0, 0.0, 0.0).unwrap(),
        CieLab::new(50.0, 80.0, -80.0).unwrap(),
        CieLab::new(120.0, -20.0, 30.0).unwrap(),
    ];
    for left in colors {
        close(delta_e_2000(left, left), 0.0, 1e-15);
        for right in colors {
            close(delta_e_2000(left, right), delta_e_2000(right, left), 2e-13);
        }
    }
}
