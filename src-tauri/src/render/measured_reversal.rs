//! Runtime trust boundary for a measured direct-positive reversal report.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeasuredReversalCalibrationV1 {
    pub schema_version: u8,
    pub dataset_id: String,
    pub source_sha256: String,
    pub train_sample_ids: Vec<String>,
    pub holdout_sample_ids: Vec<String>,
    pub exposure_knots_ev: Vec<f32>,
    pub density_knots: Vec<[f32; 3]>,
    pub holdout_density_rmse: f32,
    pub highlight_reference_error_ev: f32,
    pub ap1_excursion_count: u32,
    pub fit_input_sha256: String,
    pub limitations: Vec<String>,
}

impl MeasuredReversalCalibrationV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != 1 || self.dataset_id.trim().is_empty() {
            return Err("measured_reversal_invalid_identity");
        }
        if !is_sha256(&self.source_sha256) || !is_sha256(&self.fit_input_sha256) {
            return Err("measured_reversal_invalid_hash");
        }
        if self.train_sample_ids.len() < 5
            || self.holdout_sample_ids.len() < 5
            || self
                .holdout_sample_ids
                .iter()
                .any(|id| self.train_sample_ids.contains(id))
        {
            return Err("measured_reversal_invalid_split");
        }
        if self.exposure_knots_ev.len() < 2
            || self.exposure_knots_ev.len() != self.density_knots.len()
            || self
                .exposure_knots_ev
                .windows(2)
                .any(|window| window[0] >= window[1])
            || self
                .density_knots
                .iter()
                .flatten()
                .any(|value| !value.is_finite())
            || !(0.0..=0.025).contains(&self.holdout_density_rmse)
            || !(0.0..=(1.0 / 6.0)).contains(&self.highlight_reference_error_ev)
            || self.limitations.is_empty()
        {
            return Err("measured_reversal_invalid_metrics");
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

    fn fixture() -> MeasuredReversalCalibrationV1 {
        MeasuredReversalCalibrationV1 {
            schema_version: 1,
            dataset_id: "reversal-test".into(),
            source_sha256: format!("sha256:{}", "a".repeat(64)),
            train_sample_ids: (0..5).map(|index| format!("train-{index}")).collect(),
            holdout_sample_ids: (0..5).map(|index| format!("holdout-{index}")).collect(),
            exposure_knots_ev: vec![-4.0, 0.0, 4.0],
            density_knots: vec![[2.0; 3], [1.0; 3], [0.2; 3]],
            holdout_density_rmse: 0.02,
            highlight_reference_error_ev: 0.1,
            ap1_excursion_count: 2,
            fit_input_sha256: format!("sha256:{}", "b".repeat(64)),
            limitations: vec!["Measured only for declared process and illuminant.".into()],
        }
    }

    #[test]
    fn accepts_reversal_report_with_highlight_metrics() {
        assert_eq!(fixture().validate(), Ok(()));
    }

    #[test]
    fn rejects_holdout_leakage_or_shoulder_failure() {
        let mut report = fixture();
        report.holdout_sample_ids[0] = report.train_sample_ids[0].clone();
        assert_eq!(report.validate(), Err("measured_reversal_invalid_split"));
        let mut report = fixture();
        report.highlight_reference_error_ev = 0.2;
        assert_eq!(report.validate(), Err("measured_reversal_invalid_metrics"));
    }
}
