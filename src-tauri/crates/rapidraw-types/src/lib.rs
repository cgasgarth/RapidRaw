//! Stable, serialization-facing contracts shared across native subsystems.
//!
//! This crate intentionally owns only low-churn identifiers and wire contracts. It must remain
//! independent of Tauri, renderers, image decoders, AI runtimes, codecs, and platform APIs.

use serde::{Deserialize, Serialize};

/// Identifies every phase belonging to one selected-image open lifecycle.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ImageOpenSessionId {
    pub selection_generation: u64,
    pub image_session: u64,
}

/// Optional native capability that a feature-partitioned application may expose.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeCapability {
    Ai,
    Computational,
    AdvancedCodecs,
}

/// Stable error contract returned when the running binary excludes an optional capability.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityUnavailable {
    pub code: CapabilityUnavailableCode,
    pub capability: NativeCapability,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityUnavailableCode {
    CapabilityUnavailable,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeBuildProfile {
    FastDev,
    Full,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeCapabilityManifest {
    pub schema_version: u32,
    pub build_profile: NativeBuildProfile,
    pub ai: bool,
    pub advanced_codecs: bool,
    pub computational: bool,
}

impl CapabilityUnavailable {
    #[must_use]
    pub const fn new(capability: NativeCapability) -> Self {
        Self {
            code: CapabilityUnavailableCode::CapabilityUnavailable,
            capability,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_open_session_wire_shape_matches_frontend_contract() {
        let session = ImageOpenSessionId {
            selection_generation: 17,
            image_session: 23,
        };
        assert_eq!(
            serde_json::to_value(session).unwrap(),
            serde_json::json!({ "selectionGeneration": 17, "imageSession": 23 })
        );
    }

    #[test]
    fn capability_unavailable_has_stable_typed_wire_shape() {
        assert_eq!(
            serde_json::to_value(CapabilityUnavailable::new(NativeCapability::AdvancedCodecs))
                .unwrap(),
            serde_json::json!({
                "code": "capability_unavailable",
                "capability": "advancedCodecs"
            })
        );
    }

    #[test]
    fn capability_manifest_has_stable_frontend_wire_shape() {
        assert_eq!(
            serde_json::to_value(NativeCapabilityManifest {
                schema_version: 1,
                build_profile: NativeBuildProfile::FastDev,
                ai: false,
                advanced_codecs: false,
                computational: true,
            })
            .unwrap(),
            serde_json::json!({
                "schemaVersion": 1,
                "buildProfile": "fast_dev",
                "ai": false,
                "advancedCodecs": false,
                "computational": true
            })
        );
    }
}
