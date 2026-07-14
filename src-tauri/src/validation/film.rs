//! Native trust-boundary checks for the governed Film analytic report.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmValidationMetricsV1 {
    pub max_abs: f32,
    pub rmse: f32,
    pub neutral_axis_drift: f32,
    pub negative_component_count: u32,
    pub high_component_count: u32,
}

pub(crate) fn validate_metrics(metrics: &FilmValidationMetricsV1) -> Result<(), &'static str> {
    if !metrics.max_abs.is_finite()
        || !metrics.rmse.is_finite()
        || !metrics.neutral_axis_drift.is_finite()
        || metrics.max_abs < 0.0
        || metrics.rmse < 0.0
        || metrics.neutral_axis_drift < 0.0
    {
        return Err("film_validation_non_finite_metrics");
    }
    if metrics.max_abs > 0.1 || metrics.rmse > 0.1 || metrics.neutral_axis_drift > 0.1 {
        return Err("film_validation_metric_ceiling_failed");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_finite_metrics_and_preserves_out_of_gamut_counts() {
        let metrics = FilmValidationMetricsV1 {
            max_abs: 0.0001,
            rmse: 0.00002,
            neutral_axis_drift: 0.00001,
            negative_component_count: 2,
            high_component_count: 3,
        };
        assert_eq!(validate_metrics(&metrics), Ok(()));
        assert_eq!(metrics.negative_component_count, 2);
        assert_eq!(metrics.high_component_count, 3);
    }

    #[test]
    fn rejects_non_finite_or_unbounded_metrics() {
        let mut metrics = FilmValidationMetricsV1 {
            max_abs: 0.0001,
            rmse: 0.00002,
            neutral_axis_drift: 0.00001,
            negative_component_count: 0,
            high_component_count: 0,
        };
        metrics.max_abs = f32::NAN;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_validation_non_finite_metrics")
        );
        metrics.max_abs = 0.2;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_validation_metric_ceiling_failed")
        );
    }
}
