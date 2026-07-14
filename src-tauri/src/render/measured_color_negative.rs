//! Runtime trust boundary for a measured color-negative calibration report.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeasuredColorNegativeCalibrationV1 {
    pub schema_version: u8,
    pub dataset_id: String,
    pub source_sha256: String,
    pub train_sample_ids: Vec<String>,
    pub holdout_sample_ids: Vec<String>,
    pub exposure_knots_ev: Vec<f32>,
    pub density_knots: Vec<[f32; 3]>,
    pub holdout_density_rmse: f32,
    pub neutral_chroma_mean: f32,
    pub fit_input_sha256: String,
    pub limitations: Vec<String>,
}

impl MeasuredColorNegativeCalibrationV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != 1 || self.dataset_id.trim().is_empty() {
            return Err("measured_color_negative_invalid_identity");
        }
        if !is_sha256(&self.source_sha256) || !is_sha256(&self.fit_input_sha256) {
            return Err("measured_color_negative_invalid_hash");
        }
        if self.train_sample_ids.len() < 5
            || self.holdout_sample_ids.len() < 5
            || self.train_sample_ids.iter().any(|id| id.trim().is_empty())
            || self
                .holdout_sample_ids
                .iter()
                .any(|id| id.trim().is_empty())
            || self.holdout_sample_ids.iter().any(|id| {
                self.train_sample_ids
                    .iter()
                    .collect::<HashSet<_>>()
                    .contains(id)
            })
        {
            return Err("measured_color_negative_invalid_split");
        }
        if self.exposure_knots_ev.len() < 2
            || self.exposure_knots_ev.len() != self.density_knots.len()
            || self
                .exposure_knots_ev
                .windows(2)
                .any(|window| !window[0].is_finite() || window[0] >= window[1])
            || self
                .density_knots
                .iter()
                .flatten()
                .any(|value| !value.is_finite())
            || self.holdout_density_rmse.is_nan()
            || !(0.0..=0.03).contains(&self.holdout_density_rmse)
            || self.neutral_chroma_mean.is_nan()
            || !(0.0..=2.0).contains(&self.neutral_chroma_mean)
            || self.limitations.is_empty()
        {
            return Err("measured_color_negative_invalid_metrics");
        }
        Ok(())
    }
}

fn is_sha256(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> MeasuredColorNegativeCalibrationV1 {
        MeasuredColorNegativeCalibrationV1 {
            schema_version: 1,
            dataset_id: "measured-test".into(),
            source_sha256: format!("sha256:{}", "a".repeat(64)),
            train_sample_ids: (0..5).map(|index| format!("train-{index}")).collect(),
            holdout_sample_ids: (0..5).map(|index| format!("holdout-{index}")).collect(),
            exposure_knots_ev: vec![-6.0, 0.0, 6.0],
            density_knots: vec![[2.0; 3], [1.0; 3], [0.2; 3]],
            holdout_density_rmse: 0.02,
            neutral_chroma_mean: 1.0,
            fit_input_sha256: format!("sha256:{}", "b".repeat(64)),
            limitations: vec!["Measured only for declared process and illuminant.".into()],
        }
    }

    #[test]
    fn accepts_rights_pinned_holdout_report() {
        assert_eq!(fixture().validate(), Ok(()));
    }

    #[test]
    fn rejects_train_holdout_leakage_and_failed_thresholds() {
        let mut report = fixture();
        report.holdout_sample_ids[0] = report.train_sample_ids[0].clone();
        assert_eq!(
            report.validate(),
            Err("measured_color_negative_invalid_split")
        );
        let mut report = fixture();
        report.holdout_density_rmse = 0.031;
        assert_eq!(
            report.validate(),
            Err("measured_color_negative_invalid_metrics")
        );
    }
}
