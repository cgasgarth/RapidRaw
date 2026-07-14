#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilmProfileLifecycle {
    Active,
    Deprecated,
    Withdrawn,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilmProfileClaimClass {
    GenericEngineered,
    MeasuredProjectOwned,
    LicensedThirdParty,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilmProfileDecisionStatus {
    Allowed,
    Unavailable,
    Rejected,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FilmProfileDecision {
    pub status: FilmProfileDecisionStatus,
    pub reason_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmProfileManifestV1 {
    pub schema_version: u8,
    pub profile: FilmProfileIdentity,
    pub presentation: FilmProfilePresentation,
    pub claim: FilmProfileClaim,
    pub provenance: FilmProfileProvenance,
    pub calibration: FilmProfileCalibration,
    pub model: serde_json::Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmProfileIdentity {
    pub id: String,
    pub version: String,
    pub content_sha256: String,
    pub render_contract_version: String,
    pub working_space: String,
    pub lifecycle: FilmProfileLifecycle,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilmProfilePresentation {
    pub display_name: String,
    pub family: String,
    pub tags: Vec<String>,
    pub description: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilmProfileClaim {
    pub class: FilmProfileClaimClass,
    pub public_statement: String,
    pub prohibited_claims: Vec<String>,
    pub exact_stock_or_product_claim: Option<FilmProfileExactClaim>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilmProfileExactClaim {
    pub claimed_name: String,
    pub rights_basis: String,
    pub legal_review_id: String,
    pub reviewed_at: String,
    pub endorsement_disclaimed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilmProfileProvenance {
    pub authors: Vec<String>,
    pub source_kind: String,
    pub source_urls: Vec<String>,
    pub license_spdx: Vec<String>,
    pub notice_paths: Vec<String>,
    pub asset_sha256: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilmProfileCalibration {
    pub status: String,
    pub method_version: String,
    pub limitations: Vec<String>,
    pub dataset_sha256: Option<String>,
    pub dataset_license_spdx: Option<Vec<String>>,
    pub fitting_tool_commit: Option<String>,
    pub metrics_sha256: Option<String>,
}

pub fn evaluate_film_profile_claim(
    manifest: &FilmProfileManifestV1,
    available_assets: &BTreeMap<String, Vec<u8>>,
) -> FilmProfileDecision {
    let mut reason_codes = Vec::new();
    let claim_text = format!(
        "{} {} {}",
        manifest.presentation.display_name,
        manifest.presentation.description,
        manifest.claim.public_statement
    )
    .to_ascii_lowercase()
    .replace("no stock", "")
    .replace("no manufacturer", "")
    .replace("not measured", "");
    if matches!(manifest.profile.lifecycle, FilmProfileLifecycle::Withdrawn) {
        reason_codes.push("profile_withdrawn".to_string());
    }
    if matches!(
        manifest.claim.class,
        FilmProfileClaimClass::GenericEngineered
    ) && [
        "manufacturer",
        "stock",
        "matched",
        "accurate",
        "measured",
        "official",
        "kodak",
        "fuji",
        "ilford",
        "cinestill",
    ]
    .iter()
    .any(|word| claim_text.contains(word))
    {
        reason_codes.push("generic_claim_language".to_string());
    }
    if matches!(
        manifest.claim.class,
        FilmProfileClaimClass::MeasuredProjectOwned
    ) && (manifest.calibration.dataset_sha256.is_none()
        || manifest
            .calibration
            .dataset_license_spdx
            .as_ref()
            .is_none_or(Vec::is_empty)
        || manifest.calibration.fitting_tool_commit.is_none()
        || manifest.calibration.metrics_sha256.is_none())
    {
        reason_codes.push("measured_evidence_incomplete".to_string());
    }
    if matches!(
        manifest.claim.class,
        FilmProfileClaimClass::LicensedThirdParty
    ) && (manifest
        .claim
        .exact_stock_or_product_claim
        .as_ref()
        .is_none_or(|claim| claim.legal_review_id.is_empty())
        || manifest.provenance.license_spdx.is_empty())
    {
        reason_codes.push("licensed_evidence_incomplete".to_string());
    }
    if manifest
        .provenance
        .asset_sha256
        .keys()
        .any(|asset| !available_assets.contains_key(asset))
    {
        reason_codes.push("asset_unavailable".to_string());
    }
    let status = if reason_codes
        .iter()
        .any(|code| code == "profile_withdrawn" || code == "asset_unavailable")
    {
        FilmProfileDecisionStatus::Unavailable
    } else if reason_codes.is_empty() {
        FilmProfileDecisionStatus::Allowed
    } else {
        FilmProfileDecisionStatus::Rejected
    };
    FilmProfileDecision {
        status,
        reason_codes,
    }
}

pub fn verify_manifest_hash(manifest: &FilmProfileManifestV1) -> bool {
    let bytes = serde_json::to_vec(manifest).expect("film profile manifest is serializable");
    let hash = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
    hash == manifest.profile.content_sha256
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(claim: FilmProfileClaimClass) -> FilmProfileManifestV1 {
        FilmProfileManifestV1 {
            schema_version: 1,
            profile: FilmProfileIdentity {
                id: "rapidraw.reference_film.v1".into(),
                version: "1".into(),
                content_sha256:
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000".into(),
                render_contract_version: "1".into(),
                working_space: "acescg_linear_v1".into(),
                lifecycle: FilmProfileLifecycle::Active,
            },
            presentation: FilmProfilePresentation {
                display_name: "Clean Color".into(),
                family: "generic".into(),
                tags: vec!["reference".into()],
                description: "Generic engineered creative look.".into(),
            },
            claim: FilmProfileClaim {
                class: claim,
                public_statement: "No stock or endorsement claim.".into(),
                prohibited_claims: vec!["exact_stock_match".into()],
                exact_stock_or_product_claim: None,
            },
            provenance: FilmProfileProvenance {
                authors: vec!["RapidRaw".into()],
                source_kind: "project_parameters".into(),
                source_urls: vec![],
                license_spdx: vec!["AGPL-3.0-or-later".into()],
                notice_paths: vec!["AGPL_COMPLIANCE.md".into()],
                asset_sha256: BTreeMap::new(),
            },
            calibration: FilmProfileCalibration {
                status: "engineered".into(),
                method_version: "1".into(),
                limitations: vec!["Not measured stock emulation.".into()],
                dataset_sha256: None,
                dataset_license_spdx: None,
                fitting_tool_commit: None,
                metrics_sha256: None,
            },
            model: serde_json::json!({"nodeType":"film_emulation"}),
        }
    }
    #[test]
    fn generic_profile_is_allowed_and_unsafe_claim_is_rejected() {
        let mut valid = fixture(FilmProfileClaimClass::GenericEngineered);
        assert_eq!(
            evaluate_film_profile_claim(&valid, &BTreeMap::new()).status,
            FilmProfileDecisionStatus::Allowed
        );
        valid.presentation.display_name = "Kodak matched".into();
        assert_eq!(
            evaluate_film_profile_claim(&valid, &BTreeMap::new()).status,
            FilmProfileDecisionStatus::Rejected
        );
    }
    #[test]
    fn withdrawn_profile_is_unavailable_without_fallback() {
        let mut manifest = fixture(FilmProfileClaimClass::GenericEngineered);
        manifest.profile.lifecycle = FilmProfileLifecycle::Withdrawn;
        assert_eq!(
            evaluate_film_profile_claim(&manifest, &BTreeMap::new()).status,
            FilmProfileDecisionStatus::Unavailable
        );
    }
}
