//! Frozen legacy 0-255 display curve and measured opt-in conversion.
//!
//! Existing edits continue to execute through [`evaluate_legacy_display_curve_v1`].
//! Conversion never mutates them in place: callers receive a new output curve only
//! when its measured error is within the requested tolerance.

use crate::adjustments::abi::Point;

use super::output_curves::{
    CompiledOutputCurvePlanV1, OutputCurveCompileError, OutputCurvePoint, OutputCurveTargetV1,
    compile_output_curve,
};

pub const LEGACY_DISPLAY_CURVE_IMPLEMENTATION_VERSION: u32 = 1;
pub const LEGACY_CURVE_FIT_SAMPLE_COUNT: u32 = 4_097;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LegacyCurveConversionError {
    InvalidTolerance,
    InvalidPointCount,
    NonFinitePoint,
    PointsNotStrictlyIncreasing,
    OutputNotMonotone,
    TargetNotSdr,
    OutputCurve(OutputCurveCompileError),
}

#[derive(Clone, Debug)]
pub struct LegacyCurveFitReportV1 {
    pub converted: Option<CompiledOutputCurvePlanV1>,
    pub max_abs_error: f32,
    pub rms_error: f32,
    pub tolerance: f32,
    pub sample_count: u32,
}

impl LegacyCurveFitReportV1 {
    pub fn accepted(&self) -> bool {
        self.converted.is_some()
    }
}

pub fn fit_legacy_display_curve_to_output_v1(
    points: &[Point; 16],
    count: u32,
    target: OutputCurveTargetV1,
    tolerance: f32,
) -> Result<LegacyCurveFitReportV1, LegacyCurveConversionError> {
    if !tolerance.is_finite() || tolerance < 0.0 {
        return Err(LegacyCurveConversionError::InvalidTolerance);
    }
    let count = usize::try_from(count)
        .ok()
        .filter(|count| (2..=points.len()).contains(count))
        .ok_or(LegacyCurveConversionError::InvalidPointCount)?;
    let active = &points[..count];
    if active
        .iter()
        .any(|point| !point.x.is_finite() || !point.y.is_finite())
    {
        return Err(LegacyCurveConversionError::NonFinitePoint);
    }
    if active.windows(2).any(|pair| pair[1].x <= pair[0].x) {
        return Err(LegacyCurveConversionError::PointsNotStrictlyIncreasing);
    }
    if active.windows(2).any(|pair| pair[1].y < pair[0].y) {
        return Err(LegacyCurveConversionError::OutputNotMonotone);
    }
    if (target.encoded_headroom() - 1.0).abs() > f32::EPSILON {
        return Err(LegacyCurveConversionError::TargetNotSdr);
    }

    let output_points = active
        .iter()
        .map(|point| OutputCurvePoint::new(point.x / 255.0, point.y / 255.0))
        .collect::<Vec<_>>();
    let candidate = compile_output_curve(target, &output_points)
        .map_err(LegacyCurveConversionError::OutputCurve)?;
    let mut maximum = 0.0_f32;
    let mut squared_error = 0.0_f64;
    for index in 0..LEGACY_CURVE_FIT_SAMPLE_COUNT {
        let input = index as f32 / (LEGACY_CURVE_FIT_SAMPLE_COUNT - 1) as f32;
        let legacy = evaluate_legacy_display_curve_v1(input, points, count as u32, false);
        let error = (candidate.evaluate(input) - legacy).abs();
        maximum = maximum.max(error);
        squared_error += f64::from(error) * f64::from(error);
    }
    let rms_error = (squared_error / f64::from(LEGACY_CURVE_FIT_SAMPLE_COUNT)).sqrt() as f32;
    let converted = (maximum <= tolerance).then_some(candidate);
    Ok(LegacyCurveFitReportV1 {
        converted,
        max_abs_error: maximum,
        rms_error,
        tolerance,
        sample_count: LEGACY_CURVE_FIT_SAMPLE_COUNT,
    })
}

pub fn evaluate_legacy_display_curve_v1(
    value: f32,
    points: &[Point; 16],
    count: u32,
    preserve_extended: bool,
) -> f32 {
    if count < 2 {
        return value;
    }
    let count = count as usize;
    let x = value * 255.0;
    if x <= points[0].x {
        return if preserve_extended {
            value + (points[0].y - points[0].x) / 255.0
        } else {
            points[0].y / 255.0
        };
    }
    if x >= points[count - 1].x {
        return if preserve_extended {
            value + (points[count - 1].y - points[count - 1].x) / 255.0
        } else {
            points[count - 1].y / 255.0
        };
    }
    for index in 0..count - 1 {
        let first = points[index];
        let second = points[index + 1];
        if x > second.x {
            continue;
        }
        let previous = points[index.saturating_sub(1)];
        let next = points[(index + 2).min(count - 1)];
        let before = (first.y - previous.y) / (first.x - previous.x).max(0.001);
        let current = (second.y - first.y) / (second.x - first.x).max(0.001);
        let after = (next.y - second.y) / (next.x - second.x).max(0.001);
        let mut tangent_first = if index == 0 || before * current <= 0.0 {
            if index == 0 { current } else { 0.0 }
        } else {
            (before + current) * 0.5
        };
        let mut tangent_second = if index + 1 == count - 1 || current * after <= 0.0 {
            if index + 1 == count - 1 { current } else { 0.0 }
        } else {
            (current + after) * 0.5
        };
        if current != 0.0 {
            let alpha = tangent_first / current;
            let beta = tangent_second / current;
            if alpha * alpha + beta * beta > 9.0 {
                let tau = 3.0 / (alpha * alpha + beta * beta).sqrt();
                tangent_first *= tau;
                tangent_second *= tau;
            }
        }
        let delta = second.x - first.x;
        let t = (x - first.x) / delta;
        let t2 = t * t;
        let t3 = t2 * t;
        let result = (2.0 * t3 - 3.0 * t2 + 1.0) * first.y
            + (t3 - 2.0 * t2 + t) * tangent_first * delta
            + (-2.0 * t3 + 3.0 * t2) * second.y
            + (t3 - t2) * tangent_second * delta;
        return if preserve_extended {
            result / 255.0
        } else {
            (result / 255.0).clamp(0.0, 1.0)
        };
    }
    points[count - 1].y / 255.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn points(values: &[(f32, f32)]) -> [Point; 16] {
        let mut result = [Point::default(); 16];
        for (slot, &(x, y)) in result.iter_mut().zip(values) {
            slot.x = x;
            slot.y = y;
        }
        result
    }

    fn sdr_target() -> OutputCurveTargetV1 {
        OutputCurveTargetV1::view_encoded(77, 203.0, 203.0)
    }

    #[test]
    fn identity_and_extended_legacy_evaluation_remain_exact() {
        let identity = points(&[(0.0, 0.0), (255.0, 255.0)]);
        for value in [-0.5, 0.0, 0.18, 1.0, 1.5] {
            assert_eq!(
                evaluate_legacy_display_curve_v1(value, &identity, 2, true),
                value
            );
        }
        assert_eq!(
            evaluate_legacy_display_curve_v1(1.5, &identity, 2, false),
            1.0
        );
    }

    #[test]
    fn legacy_display_curve_v1_matches_frozen_golden_samples() {
        let legacy = points(&[
            (0.0, 8.0),
            (48.0, 32.0),
            (128.0, 150.0),
            (220.0, 238.0),
            (255.0, 248.0),
        ]);
        let golden = [
            (-0.25, 0.031_372_55, -0.218_627_45),
            (0.1, 0.069_232_66, 0.069_232_66),
            (0.25, 0.199_703_41, 0.199_703_41),
            (0.5, 0.585_839_15, 0.585_839_15),
            (0.75, 0.849_643_2, 0.849_643_2),
            (1.25, 0.972_549, 1.222_549),
        ];
        for (input, clamped, extended) in golden {
            assert!(
                (evaluate_legacy_display_curve_v1(input, &legacy, 5, false) - clamped).abs()
                    <= 2.0e-6
            );
            assert!(
                (evaluate_legacy_display_curve_v1(input, &legacy, 5, true) - extended).abs()
                    <= 2.0e-6
            );
        }
    }

    #[test]
    fn conversion_reports_error_and_only_returns_an_accepted_fit() {
        let legacy = points(&[
            (0.0, 0.0),
            (48.0, 32.0),
            (128.0, 150.0),
            (220.0, 238.0),
            (255.0, 255.0),
        ]);
        let measured =
            fit_legacy_display_curve_to_output_v1(&legacy, 5, sdr_target(), 1.0).unwrap();
        assert_eq!(measured.sample_count, LEGACY_CURVE_FIT_SAMPLE_COUNT);
        assert!(measured.accepted());
        assert!(measured.max_abs_error.is_finite());
        assert!(measured.rms_error <= measured.max_abs_error);

        let rejected = fit_legacy_display_curve_to_output_v1(
            &legacy,
            5,
            sdr_target(),
            measured.max_abs_error * 0.5,
        )
        .unwrap();
        assert!(!rejected.accepted());
        assert_eq!(rejected.max_abs_error, measured.max_abs_error);
        assert_eq!(rejected.rms_error, measured.rms_error);
    }

    #[test]
    fn conversion_rejects_nonmonotone_and_hdr_legacy_reinterpretation() {
        let nonmonotone = points(&[(0.0, 0.0), (128.0, 200.0), (255.0, 180.0)]);
        assert_eq!(
            fit_legacy_display_curve_to_output_v1(&nonmonotone, 3, sdr_target(), 0.01,)
                .unwrap_err(),
            LegacyCurveConversionError::OutputNotMonotone
        );
        let identity = points(&[(0.0, 0.0), (255.0, 255.0)]);
        assert_eq!(
            fit_legacy_display_curve_to_output_v1(
                &identity,
                2,
                OutputCurveTargetV1::view_encoded(77, 203.0, 1_000.0),
                0.01,
            )
            .unwrap_err(),
            LegacyCurveConversionError::TargetNotSdr
        );
    }
}
