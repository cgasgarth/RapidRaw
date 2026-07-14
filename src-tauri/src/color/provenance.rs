//! Shared evidence references; claims remain owned by each workflow/profile.

use anyhow::{Result, anyhow};

#[derive(Debug, Clone, serde::Serialize)]
pub struct CalibrationEvidenceRefV1 {
    pub evidence_id: String,
    pub evidence_version: String,
    pub source_kind: String,
    pub manifest_path_or_uri: String,
    pub manifest_sha256: String,
    pub license_spdx: Vec<String>,
    pub notice_paths: Vec<String>,
    pub method_version: String,
    pub limitations: Vec<String>,
}

impl CalibrationEvidenceRefV1 {
    pub fn validate(&self) -> Result<()> {
        if self.evidence_id.trim().is_empty()
            || self.evidence_version.trim().is_empty()
            || !matches!(
                self.source_kind.as_str(),
                "project_measurement" | "project_engineered" | "licensed_dataset"
            )
            || self.manifest_path_or_uri.trim().is_empty()
            || !self.manifest_sha256.starts_with("sha256:")
            || self.manifest_sha256.len() <= 7
            || self.license_spdx.is_empty()
            || self.method_version.trim().is_empty()
            || self.limitations.is_empty()
        {
            return Err(anyhow!("calibration_evidence_reference_invalid"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_reference_requires_license_and_limitations() {
        let reference = CalibrationEvidenceRefV1 {
            evidence_id: "rapidraw.project.fixture".into(),
            evidence_version: "1".into(),
            source_kind: "project_engineered".into(),
            manifest_path_or_uri: "calibration/manifest.json".into(),
            manifest_sha256: "sha256:fixture-manifest-v1".into(),
            license_spdx: vec!["LicenseRef-RapidRaw-Project".into()],
            notice_paths: vec![],
            method_version: "fixture_method_v1".into(),
            limitations: vec!["Synthetic fixture; not a camera stock claim.".into()],
        };
        assert!(reference.validate().is_ok());
        let mut invalid = reference;
        invalid.license_spdx.clear();
        assert!(invalid.validate().is_err());
    }
}
