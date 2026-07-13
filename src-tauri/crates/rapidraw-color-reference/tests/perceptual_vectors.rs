use rapidraw_color_reference::{
    perceptual::{lab_to_xyz, xyz_to_lab},
    types::{CieXyz, WhitePointXyz},
};

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual={actual:.12} expected={expected:.12}"
    );
}

#[test]
fn cie_lab_maps_reference_white_and_black_to_the_neutral_axis() {
    let d50 = WhitePointXyz::new(0.96422, 1.0, 0.82521).unwrap();
    let white = xyz_to_lab(d50.xyz(), d50).unwrap();
    close(white.lightness, 100.0, 1.0e-12);
    close(white.a, 0.0, 1.0e-12);
    close(white.b, 0.0, 1.0e-12);
    let black = xyz_to_lab(CieXyz::new(0.0, 0.0, 0.0).unwrap(), d50).unwrap();
    close(black.lightness, 0.0, 1.0e-12);
    close(black.a, 0.0, 1.0e-12);
    close(black.b, 0.0, 1.0e-12);
}

#[test]
fn cie_lab_matches_the_published_d65_srgb_red_vector() {
    let d65 = WhitePointXyz::new(0.95047, 1.0, 1.08883).unwrap();
    let red = xyz_to_lab(CieXyz::new(0.4124564, 0.2126729, 0.0193339).unwrap(), d65).unwrap();
    close(red.lightness, 53.2408, 0.0002);
    close(red.a, 80.0925, 0.0002);
    close(red.b, 67.2032, 0.0002);
}

#[test]
fn cie_lab_round_trip_preserves_negative_and_over_range_xyz_without_clamps() {
    let d60 = WhitePointXyz::new(0.952646, 1.0, 1.008825).unwrap();
    for xyz in [
        CieXyz::new(-0.02, 0.001, 0.2).unwrap(),
        CieXyz::new(1.8, 2.4, 0.6).unwrap(),
    ] {
        let round_trip = lab_to_xyz(xyz_to_lab(xyz, d60).unwrap(), d60).unwrap();
        close(round_trip.x, xyz.x, 2.0e-14);
        close(round_trip.y, xyz.y, 2.0e-14);
        close(round_trip.z, xyz.z, 2.0e-14);
    }
}
