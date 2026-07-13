use rapidraw_color_reference::{
    ReferenceError,
    artistic::{
        ARTISTIC_REFERENCE_CONTRACT_ID, ColorCalibration, ColorGrade, CurvePoint,
        DISPLAY_ENCODED_EXTENDED_DOMAIN, HslAdjustment, Levels, Lut3d, MaskBlendMode,
        SCENE_LINEAR_EXTENDED_DOMAIN, agx_tonemap_identity_matrix, apply_clipping_overlay,
        apply_color_calibration, apply_color_grading, apply_filmic_brightness, apply_flare,
        apply_glow_raw, apply_grain, apply_halation_raw, apply_hsl_ranges, apply_local_contrast,
        apply_luma_levels, apply_monotone_curve, apply_vignette, apply_white_balance,
        blend_mask_layer,
    },
};

fn close(left: f64, right: f64, tolerance: f64) {
    assert!((left - right).abs() <= tolerance, "{left} != {right}");
}

#[test]
fn artistic_contract_declares_domains_and_monotone_curve_extended_boundaries() {
    assert_eq!(
        ARTISTIC_REFERENCE_CONTRACT_ID,
        "rapidraw.color-reference.artistic.v1"
    );
    assert_eq!(
        SCENE_LINEAR_EXTENDED_DOMAIN,
        "acescg_scene_linear_extended_v1"
    );
    assert_eq!(
        DISPLAY_ENCODED_EXTENDED_DOMAIN,
        "display_encoded_rgb_extended_v1"
    );
    let points = [
        CurvePoint::new(0.0, 0.0).unwrap(),
        CurvePoint::new(64.0, 50.0).unwrap(),
        CurvePoint::new(128.0, 160.0).unwrap(),
        CurvePoint::new(255.0, 255.0).unwrap(),
    ];
    close(apply_monotone_curve(-0.5, &points).unwrap(), 0.0, 0.0);
    close(apply_monotone_curve(2.0, &points).unwrap(), 1.0, 0.0);
    let outputs = (0..=1024)
        .map(|index| apply_monotone_curve(index as f64 / 1024.0, &points).unwrap())
        .collect::<Vec<_>>();
    assert!(outputs.windows(2).all(|pair| pair[0] <= pair[1]));
    assert_eq!(
        apply_monotone_curve(
            0.5,
            &[
                CurvePoint::new(0.0, 0.0).unwrap(),
                CurvePoint::new(128.0, 160.0).unwrap(),
                CurvePoint::new(255.0, 120.0).unwrap(),
            ],
        ),
        Err(ReferenceError::NonIncreasingInput)
    );
}

#[test]
fn levels_hsl_and_grading_cover_negative_neutral_and_extended_vectors() {
    let levels = Levels {
        input_black: 0.05,
        input_white: 0.92,
        gamma: 1.15,
        output_black: 0.02,
        output_white: 0.96,
    };
    for rgb in [
        [-0.25, -0.01, 0.0],
        [0.18; 3],
        [0.05, 0.9, 0.2],
        [4.0, 2.0, 1.25],
    ] {
        let output = apply_luma_levels(rgb, levels).unwrap();
        assert!(
            output
                .into_iter()
                .all(|value| value.is_finite() && (0.0..=1.0).contains(&value))
        );
    }
    let neutral = apply_luma_levels([0.18; 3], levels).unwrap();
    close(neutral[0], neutral[1], 1.0e-12);
    close(neutral[1], neutral[2], 1.0e-12);

    let mut hsl = [HslAdjustment::default(); 8];
    hsl[5] = HslAdjustment {
        hue: 0.1,
        saturation: 0.25,
        luminance: -0.08,
    };
    assert_eq!(apply_hsl_ranges([-0.2; 3], hsl).unwrap(), [0.0; 3]);
    assert_eq!(apply_hsl_ranges([0.4; 3], hsl).unwrap(), [0.4; 3]);
    let shifted = apply_hsl_ranges([0.05, 0.2, 1.25], hsl).unwrap();
    assert!(shifted.into_iter().all(f64::is_finite));
    assert_ne!(shifted, [0.05, 0.2, 1.25]);

    let graded = apply_color_grading(
        [-0.25, 0.18, 1.5],
        ColorGrade::default(),
        ColorGrade {
            hue_degrees: 32.0,
            saturation: 0.3,
            luminance: 0.08,
        },
        ColorGrade::default(),
        ColorGrade::default(),
        0.5,
        0.0,
    )
    .unwrap();
    assert!(graded.into_iter().all(f64::is_finite));
}

#[test]
fn local_mask_blends_have_zero_one_equivalence_and_detect_channel_defects() {
    let base = [-0.2, 0.4, 1.4];
    let layer = [0.8, 0.2, 0.6];
    for mode in [
        MaskBlendMode::Normal,
        MaskBlendMode::Multiply,
        MaskBlendMode::Screen,
    ] {
        assert_eq!(blend_mask_layer(base, layer, 0.0, mode).unwrap(), base);
    }
    assert_eq!(
        blend_mask_layer(base, layer, 1.0, MaskBlendMode::Normal).unwrap(),
        layer
    );
    let multiplied = blend_mask_layer(base, layer, 1.0, MaskBlendMode::Multiply).unwrap();
    for (actual, expected) in multiplied.into_iter().zip([-0.16, 0.08, 0.84]) {
        close(actual, expected, 1.0e-15);
    }
    let expected = blend_mask_layer(base, layer, 0.65, MaskBlendMode::Screen).unwrap();
    let injected_channel_swap = [expected[2], expected[1], expected[0]];
    let max_error = expected
        .into_iter()
        .zip(injected_channel_swap)
        .map(|(left, right)| (left - right).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        max_error > 8.0e-5,
        "injected shader channel swap must exceed tolerance"
    );
    assert_eq!(
        blend_mask_layer(base, layer, f64::NAN, MaskBlendMode::Normal),
        Err(ReferenceError::NonFiniteInput)
    );
}

#[test]
fn tetrahedral_lut_clipping_agx_and_halation_cover_invariants_and_defects() {
    let mut identity_values = Vec::new();
    for z in 0..2 {
        for y in 0..2 {
            for x in 0..2 {
                identity_values.push([x as f64, y as f64, z as f64]);
            }
        }
    }
    let identity = Lut3d::new(2, identity_values).unwrap();
    for rgb in [[-0.2_f64, 0.3, 1.4], [0.2, 0.7, 0.4], [1.0, 0.0, 0.5]] {
        let expected = rgb.map(|channel| channel.clamp(0.0, 1.0));
        let actual = identity.evaluate_tetrahedral(rgb).unwrap();
        for (actual, expected) in actual.into_iter().zip(expected) {
            close(actual, expected, 1.0e-12);
        }
    }
    let expected = identity.evaluate_tetrahedral([0.2, 0.7, 0.4]).unwrap();
    let injected_axis_swap = [expected[2], expected[1], expected[0]];
    assert!(
        expected
            .into_iter()
            .zip(injected_axis_swap)
            .any(|(left, right)| (left - right).abs() > 8.0e-5)
    );

    assert_eq!(
        apply_clipping_overlay([1.01, 0.5, 0.5], true).unwrap(),
        [1.0, 0.0, 0.0]
    );
    assert_eq!(
        apply_clipping_overlay([0.5, 0.001, 0.5], true).unwrap(),
        [0.0, 0.0, 1.0]
    );
    assert_eq!(
        apply_clipping_overlay([0.2, 0.4, 0.6], false).unwrap(),
        [0.2, 0.4, 0.6]
    );

    let neutral_ramp = [-0.5, 0.0, 0.001, 0.18, 1.0, 4.0]
        .map(|value| agx_tonemap_identity_matrix([value; 3]).unwrap());
    assert!(neutral_ramp.windows(2).all(|pair| pair[0][0] <= pair[1][0]));
    assert!(
        neutral_ramp.iter().all(|rgb| {
            (rgb[0] - rgb[1]).abs() <= 1.0e-12 && (rgb[1] - rgb[2]).abs() <= 1.0e-12
        })
    );

    let color = [0.2, 0.2, 0.2];
    assert_eq!(
        apply_halation_raw(color, [4.0, 3.0, 2.0], 0.0).unwrap(),
        color
    );
    let halation = apply_halation_raw(color, [4.0, 3.0, 2.0], 0.7).unwrap();
    assert!(halation[0] > halation[1] && halation[1] > halation[2]);
    assert_ne!(halation, color);
}

#[test]
fn basic_and_spatial_nodes_cover_extended_vectors_tiles_and_injected_defects() {
    let source = [-0.1, 0.4, 1.6];
    assert_eq!(apply_white_balance(source, 0.0, 0.0).unwrap(), source);
    let balanced = apply_white_balance(source, 0.18, -0.12).unwrap();
    assert_ne!(balanced, source);
    let calibrated = apply_color_calibration(
        source,
        ColorCalibration {
            red_hue: 0.18,
            blue_hue: -0.12,
            red_saturation: 0.2,
            shadows_tint: 0.08,
            ..ColorCalibration::default()
        },
    )
    .unwrap();
    assert!(calibrated.into_iter().all(f64::is_finite));
    assert_eq!(apply_filmic_brightness(source, 0.0).unwrap(), source);
    assert!(
        apply_filmic_brightness(source, 0.2)
            .unwrap()
            .into_iter()
            .all(f64::is_finite)
    );

    let center = [0.45, 0.4, 0.35];
    let blurred = [0.3, 0.3, 0.3];
    assert_eq!(
        apply_local_contrast(center, blurred, 0.0, 0.08, true).unwrap(),
        center
    );
    assert_ne!(
        apply_local_contrast(center, blurred, 0.5, 0.08, true).unwrap(),
        center
    );
    assert_ne!(
        apply_local_contrast(center, blurred, -0.5, 0.08, true).unwrap(),
        center
    );
    assert_eq!(
        apply_glow_raw(center, [2.0, 1.5, 1.0], 0.0).unwrap(),
        center
    );
    assert_ne!(
        apply_glow_raw(center, [2.0, 1.5, 1.0], 0.7).unwrap(),
        center
    );
    assert_ne!(apply_flare(center, [0.8, 0.4, 0.2], 0.5).unwrap(), center);

    let dimensions = [32.0, 8.0];
    let mut full = Vec::new();
    let mut stitched = Vec::new();
    for y in 0..8 {
        for x in 0..32 {
            full.push(
                apply_grain(center, [x as f64, y as f64], dimensions, 0.12, 0.8, 0.4).unwrap(),
            );
        }
    }
    for tile_x in [0, 16] {
        for y in 0..8 {
            for local_x in 0..16 {
                stitched.push((
                    tile_x + local_x,
                    y,
                    apply_grain(
                        center,
                        [(tile_x + local_x) as f64, y as f64],
                        dimensions,
                        0.12,
                        0.8,
                        0.4,
                    )
                    .unwrap(),
                ));
            }
        }
    }
    for (x, y, pixel) in stitched {
        assert_eq!(pixel, full[y * 32 + x]);
    }
    let center_vignette =
        apply_vignette(center, [16.0, 4.0], dimensions, -0.4, 0.5, 0.2, 0.5).unwrap();
    let edge_vignette =
        apply_vignette(center, [0.0, 0.0], dimensions, -0.4, 0.5, 0.2, 0.5).unwrap();
    assert!(edge_vignette[0] < center_vignette[0]);

    let injected_local_coordinates =
        apply_grain(center, [0.0, 0.0], dimensions, 0.12, 0.8, 0.4).unwrap();
    let correct_absolute_coordinates =
        apply_grain(center, [16.0, 0.0], dimensions, 0.12, 0.8, 0.4).unwrap();
    assert_ne!(injected_local_coordinates, correct_absolute_coordinates);
}
