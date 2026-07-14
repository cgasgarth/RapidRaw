//! Explicit density/transmittance virtual print-and-scan stage for Film.

use glam::Vec3;
use serde::{Deserialize, Serialize};

const EPSILON: f32 = 1.0e-6;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilmPrintScanMode {
    Transmission,
    Reflection,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilmPrintScanCat {
    BradfordV1,
    NoneAlreadyAdapted,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmPrintScanPaperV1 {
    pub exposure_knots_log10: Vec<Vec<f32>>,
    pub response_knots: Vec<Vec<f32>>,
    pub d_min: [f32; 3],
    pub d_max: [f32; 3],
    pub white_point_xy: [f32; 2],
    pub flare_floor: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmPrintScanScanV1 {
    pub mode: FilmPrintScanMode,
    pub matrix_to_xyz: [[f32; 3]; 3],
    pub source_white_xy: [f32; 2],
    pub cat: FilmPrintScanCat,
    pub normalization: [f32; 3],
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmPrintScanV1 {
    pub model: String,
    pub enabled_by_profile: bool,
    pub printer_light_balance_stops: [f32; 3],
    pub printer_cross_talk: [[f32; 3]; 3],
    pub paper: FilmPrintScanPaperV1,
    pub scan: FilmPrintScanScanV1,
}

impl FilmPrintScanV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.model != "density_print_scan_v1" {
            return Err("film_print_scan_invalid_model");
        }
        if self
            .printer_light_balance_stops
            .iter()
            .any(|value| !value.is_finite() || value.abs() > 8.0)
            || !matrix_is_bounded(&self.printer_cross_talk, 4.0)
            || matrix_determinant(&self.printer_cross_talk) <= EPSILON
        {
            return Err("film_print_scan_invalid_printer_matrix");
        }
        let paper = &self.paper;
        if paper.exposure_knots_log10.len() != 3
            || paper.response_knots.len() != 3
            || paper
                .exposure_knots_log10
                .iter()
                .zip(paper.response_knots.iter())
                .any(|(exposure, response)| {
                    exposure.len() < 5
                        || exposure.len() != response.len()
                        || exposure.iter().any(|value| !value.is_finite())
                        || response.iter().any(|value| !value.is_finite())
                        || exposure.windows(2).any(|window| window[0] >= window[1])
                        || response.windows(2).any(|window| window[0] > window[1])
                })
            || paper
                .d_min
                .iter()
                .zip(paper.d_max.iter())
                .any(|(min, max)| !min.is_finite() || !max.is_finite() || min >= max)
            || paper
                .white_point_xy
                .iter()
                .any(|value| !value.is_finite() || *value <= 0.0)
            || !paper.flare_floor.is_finite()
            || !(0.0..1.0).contains(&paper.flare_floor)
        {
            return Err("film_print_scan_invalid_paper_curve");
        }
        let scan = &self.scan;
        if !matrix_is_bounded(&scan.matrix_to_xyz, 8.0)
            || matrix_determinant(&scan.matrix_to_xyz) <= EPSILON
            || scan
                .source_white_xy
                .iter()
                .any(|value| !value.is_finite() || *value <= 0.0)
            || scan
                .normalization
                .iter()
                .any(|value| !value.is_finite() || *value <= 0.0)
        {
            return Err("film_print_scan_invalid_scan_metadata");
        }
        Ok(())
    }
}

fn matrix_is_bounded<const N: usize>(matrix: &[[f32; N]; N], bound: f32) -> bool {
    matrix
        .iter()
        .flatten()
        .all(|value| value.is_finite() && value.abs() <= bound)
}

fn matrix_determinant<const N: usize>(matrix: &[[f32; N]; N]) -> f32 {
    if N == 3 {
        let m = matrix;
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    } else {
        1.0
    }
}

fn curve_sample(exposure: f32, x: &[f32], y: &[f32]) -> f32 {
    let segment = if exposure <= x[0] {
        0
    } else if exposure >= x[x.len() - 1] {
        x.len() - 2
    } else {
        x.windows(2)
            .position(|window| exposure <= window[1])
            .unwrap_or(x.len() - 2)
    };
    let t = ((exposure - x[segment]) / (x[segment + 1] - x[segment])).clamp(0.0, 1.0);
    y[segment] + t * (y[segment + 1] - y[segment])
}

pub fn apply(capture_rgb: Vec3, curve: &FilmPrintScanV1) -> Vec3 {
    if !curve.enabled_by_profile || curve.validate().is_err() || !capture_rgb.is_finite() {
        return capture_rgb;
    }
    let transmittance = capture_rgb.abs().max(Vec3::splat(EPSILON));
    let printer_input = Vec3::new(
        curve.printer_cross_talk[0][0] * transmittance.x
            + curve.printer_cross_talk[0][1] * transmittance.y
            + curve.printer_cross_talk[0][2] * transmittance.z,
        curve.printer_cross_talk[1][0] * transmittance.x
            + curve.printer_cross_talk[1][1] * transmittance.y
            + curve.printer_cross_talk[1][2] * transmittance.z,
        curve.printer_cross_talk[2][0] * transmittance.x
            + curve.printer_cross_talk[2][1] * transmittance.y
            + curve.printer_cross_talk[2][2] * transmittance.z,
    );
    let printer_exposure = printer_input.max(Vec3::splat(EPSILON))
        * Vec3::from_array(
            curve
                .printer_light_balance_stops
                .map(|stops| 10.0_f32.powf(stops)),
        );
    let mut scan_transmittance = [0.0; 3];
    for channel in 0..3 {
        let log_exposure = printer_exposure[channel].log10();
        let response = curve_sample(
            log_exposure,
            &curve.paper.exposure_knots_log10[channel],
            &curve.paper.response_knots[channel],
        );
        let density = curve.paper.d_min[channel]
            + response.clamp(0.0, 1.0) * (curve.paper.d_max[channel] - curve.paper.d_min[channel]);
        scan_transmittance[channel] = ((10.0_f32.powf(-density) - curve.paper.flare_floor)
            / (1.0 - curve.paper.flare_floor))
            .max(0.0)
            * curve.scan.normalization[channel];
    }
    let scan = Vec3::new(
        scan_transmittance[0],
        scan_transmittance[1],
        scan_transmittance[2],
    );
    let output = Vec3::new(
        curve.scan.matrix_to_xyz[0][0] * scan.x
            + curve.scan.matrix_to_xyz[0][1] * scan.y
            + curve.scan.matrix_to_xyz[0][2] * scan.z,
        curve.scan.matrix_to_xyz[1][0] * scan.x
            + curve.scan.matrix_to_xyz[1][1] * scan.y
            + curve.scan.matrix_to_xyz[1][2] * scan.z,
        curve.scan.matrix_to_xyz[2][0] * scan.x
            + curve.scan.matrix_to_xyz[2][1] * scan.y
            + curve.scan.matrix_to_xyz[2][2] * scan.z,
    );
    if output.is_finite() {
        output
    } else {
        capture_rgb
    }
}

pub fn reference() -> FilmPrintScanV1 {
    FilmPrintScanV1 {
        model: "density_print_scan_v1".to_string(),
        enabled_by_profile: true,
        printer_light_balance_stops: [0.0, 0.0, 0.0],
        printer_cross_talk: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        paper: FilmPrintScanPaperV1 {
            exposure_knots_log10: vec![
                vec![-3.0, -1.5, -0.5, 0.0, 0.8, 1.5],
                vec![-3.0, -1.5, -0.5, 0.0, 0.8, 1.5],
                vec![-3.0, -1.5, -0.5, 0.0, 0.8, 1.5],
            ],
            response_knots: vec![
                vec![0.0, 0.05, 0.25, 0.5, 0.8, 1.0],
                vec![0.0, 0.05, 0.25, 0.5, 0.8, 1.0],
                vec![0.0, 0.05, 0.25, 0.5, 0.8, 1.0],
            ],
            d_min: [0.04, 0.04, 0.04],
            d_max: [2.0, 2.0, 2.0],
            white_point_xy: [0.3127, 0.3290],
            flare_floor: 0.01,
        },
        scan: FilmPrintScanScanV1 {
            mode: FilmPrintScanMode::Transmission,
            matrix_to_xyz: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            source_white_xy: [0.3127, 0.3290],
            cat: FilmPrintScanCat::NoneAlreadyAdapted,
            normalization: [1.0, 1.0, 1.0],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn density_transmittance_and_print_response_are_finite() {
        let curve = reference();
        curve.validate().unwrap();
        let output = apply(Vec3::new(0.18, 0.18, 0.18), &curve);
        assert!(output.is_finite());
        assert!(output.max_element() > 0.0);
    }

    #[test]
    fn neutral_reference_stays_neutral_and_bad_profiles_fail_closed() {
        let curve = reference();
        let output = apply(Vec3::splat(0.18), &curve);
        assert!((output.x - output.y).abs() < 1.0e-5);
        assert!((output.y - output.z).abs() < 1.0e-5);
        let mut invalid = reference();
        invalid.paper.d_max[0] = invalid.paper.d_min[0];
        assert_eq!(
            invalid.validate(),
            Err("film_print_scan_invalid_paper_curve")
        );
    }
}
