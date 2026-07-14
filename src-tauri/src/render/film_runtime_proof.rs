//! Native trust boundary for a private RAW Film runtime receipt.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmRuntimeProofMetricsV1 {
    pub changed_pixel_ratio: f32,
    pub preview_export_mean_abs_delta: f32,
    pub post_film_pre_view_hash_equal: bool,
    pub source_hash_unchanged: bool,
}

pub(crate) fn validate_metrics(metrics: &FilmRuntimeProofMetricsV1) -> Result<(), &'static str> {
    if !metrics.changed_pixel_ratio.is_finite()
        || !metrics.preview_export_mean_abs_delta.is_finite()
        || !(0.0..=1.0).contains(&metrics.changed_pixel_ratio)
        || metrics.changed_pixel_ratio == 0.0
        || metrics.preview_export_mean_abs_delta > 0.015
    {
        return Err("film_runtime_proof_metrics_invalid");
    }
    if !metrics.post_film_pre_view_hash_equal || !metrics.source_hash_unchanged {
        return Err("film_runtime_proof_identity_mismatch");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> FilmRuntimeProofMetricsV1 {
        FilmRuntimeProofMetricsV1 {
            changed_pixel_ratio: 0.42,
            preview_export_mean_abs_delta: 0.001,
            post_film_pre_view_hash_equal: true,
            source_hash_unchanged: true,
        }
    }

    #[test]
    fn accepts_private_runtime_parity_metrics() {
        assert_eq!(validate_metrics(&valid()), Ok(()));
    }

    #[test]
    fn rejects_identity_or_tolerance_failure() {
        let mut metrics = valid();
        metrics.post_film_pre_view_hash_equal = false;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_runtime_proof_identity_mismatch")
        );
        let mut metrics = valid();
        metrics.preview_export_mean_abs_delta = 0.02;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_runtime_proof_metrics_invalid")
        );
    }
}
