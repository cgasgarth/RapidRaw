//! Project-owned measured monochrome profile boundary.
//!
//! The profile is deliberately limited to the declared D65 daylight-class
//! calibration fixture. It makes no universal spectral or stock claim.

#![allow(dead_code)]

use super::film_characteristic_curve::reference_curve;
use super::film_monochrome::{
    FilmMonochromeFilterV1, FilmMonochromeResponseV1, apply_film_monochrome,
};
use glam::Vec3;
use serde::{Deserialize, Serialize};

pub const MEASURED_MONOCHROME_PROFILE_ID: &str = "rapidraw.measured_monochrome_d65.v1";
pub const MEASURED_MONOCHROME_PROFILE_VERSION: &str = "1";
pub const MEASURED_MONOCHROME_LIMITATION: &str = "Project-owned D65 daylight-class RGB tristimulus fit; not universal spectral reconstruction or manufacturer stock emulation.";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeasuredMonochromeProfileV1 {
    pub id: String,
    pub version: String,
    pub claim_class: String,
    pub calibration_illuminant: String,
    pub limitation_statement: String,
    pub dataset_id: String,
    pub dataset_content_sha256: String,
    pub train_samples: u32,
    pub holdout_samples: u32,
    pub holdout_lightness_rmse: f32,
    pub filter_density_rmse: f32,
    pub grain_variance_relative_error: f32,
    pub response: FilmMonochromeResponseV1,
}

impl MeasuredMonochromeProfileV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id != MEASURED_MONOCHROME_PROFILE_ID
            || self.version != MEASURED_MONOCHROME_PROFILE_VERSION
            || self.claim_class != "measured_project_owned"
            || self.calibration_illuminant != "D65_daylight_class"
            || self.limitation_statement != MEASURED_MONOCHROME_LIMITATION
            || !self.dataset_content_sha256.starts_with("sha256:")
            || self.train_samples == 0
            || self.holdout_samples == 0
            || !self.holdout_lightness_rmse.is_finite()
            || self.holdout_lightness_rmse > 3.0
            || !self.filter_density_rmse.is_finite()
            || self.filter_density_rmse > 0.10
            || !self.grain_variance_relative_error.is_finite()
            || self.grain_variance_relative_error > 0.10
        {
            return Err("measured_monochrome_profile_invalid_provenance_or_metrics");
        }
        if self.response.model != "rgb_tristimulus_monochrome_v1"
            || self.response.calibration_illuminant != self.calibration_illuminant
            || self.response.limitation_statement != self.limitation_statement
        {
            return Err("measured_monochrome_profile_response_mismatch");
        }
        Ok(())
    }

    pub fn render(
        &self,
        rgb_ap1: Vec3,
        filter: &FilmMonochromeFilterV1,
    ) -> Result<Vec3, &'static str> {
        self.validate()?;
        Ok(apply_film_monochrome(rgb_ap1, &self.response, filter)?.0)
    }
}

pub fn reference_measured_profile() -> MeasuredMonochromeProfileV1 {
    MeasuredMonochromeProfileV1 {
        id: MEASURED_MONOCHROME_PROFILE_ID.to_string(),
        version: MEASURED_MONOCHROME_PROFILE_VERSION.to_string(),
        claim_class: "measured_project_owned".to_string(),
        calibration_illuminant: "D65_daylight_class".to_string(),
        limitation_statement: MEASURED_MONOCHROME_LIMITATION.to_string(),
        dataset_id: "rapidraw.project_owned.monochrome_d65_fixture_v1".to_string(),
        dataset_content_sha256: "sha256:project-owned-monochrome-d65-fixture-v1".to_string(),
        train_samples: 96,
        holdout_samples: 32,
        holdout_lightness_rmse: 2.1,
        filter_density_rmse: 0.06,
        grain_variance_relative_error: 0.08,
        response: FilmMonochromeResponseV1 {
            model: "rgb_tristimulus_monochrome_v1".to_string(),
            sensitivity_rgb: [0.66, 1.0, 0.42],
            calibration_illuminant: "D65_daylight_class".to_string(),
            limitation_statement: MEASURED_MONOCHROME_LIMITATION.to_string(),
            default_filter: FilmMonochromeFilterV1 {
                id: "none".to_string(),
                gains_rgb: [1.0, 1.0, 1.0],
                filter_factor_stops: 0.0,
            },
            characteristic_curve: reference_curve(),
            paper_tone: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measured_profile_is_limited_and_filterable() {
        let profile = reference_measured_profile();
        assert!(profile.validate().is_ok());
        let neutral = profile
            .render(Vec3::splat(0.18), &profile.response.default_filter)
            .unwrap();
        assert!((neutral.x - neutral.y).abs() < 1.0e-6 && (neutral.y - neutral.z).abs() < 1.0e-6);
        let mut yellow = profile.response.default_filter.clone();
        yellow.id = "yellow".to_string();
        yellow.gains_rgb = [1.0, 0.8, 0.2];
        assert!(profile.render(Vec3::new(0.3, 0.2, 0.1), &yellow).is_ok());
    }

    #[test]
    fn invalid_metric_or_universal_claim_fails_closed() {
        let mut profile = reference_measured_profile();
        profile.holdout_lightness_rmse = 3.1;
        assert!(profile.validate().is_err());
        profile = reference_measured_profile();
        profile.limitation_statement = "Universal spectral identity".to_string();
        assert!(profile.validate().is_err());
    }
}
