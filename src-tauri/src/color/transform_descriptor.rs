//! Versioned metadata for shared matrix/CAT operations. Pixel evaluation remains native.

use anyhow::{Result, anyhow};

pub const COLOR_TRANSFORM_CONTRACT_V1: &str = "rapidraw.color_transform.v1";

#[derive(Debug, Clone, serde::Serialize)]
pub struct ColorTransformDescriptorV1 {
    pub contract: String,
    pub source_domain: String,
    pub destination_domain: String,
    pub source_encoding: String,
    pub destination_encoding: String,
    pub matrix_direction: Option<String>,
    pub chromatic_adaptation: String,
    pub range_policy: String,
    pub channel_order: String,
    pub numeric_policy_version: String,
    pub content_sha256: String,
}

impl ColorTransformDescriptorV1 {
    pub fn validate(&self) -> Result<()> {
        let valid_encoding =
            |encoding: &str| matches!(encoding, "linear" | "log_density" | "display_encoded");
        let valid_hash = |hash: &str| hash.starts_with("blake3:") && hash.len() > 7;
        if self.contract != COLOR_TRANSFORM_CONTRACT_V1
            || self.source_domain.trim().is_empty()
            || self.destination_domain.trim().is_empty()
            || !valid_encoding(&self.source_encoding)
            || !valid_encoding(&self.destination_encoding)
            || !matches!(
                self.matrix_direction.as_deref(),
                None | Some("source_to_destination") | Some("destination_to_source")
            )
            || !matches!(
                self.chromatic_adaptation.as_str(),
                "none_same_white" | "bradford_v1" | "cat16_v1" | "already_adapted"
            )
            || !matches!(
                self.range_policy.as_str(),
                "preserve_extended_finite" | "physical_floor_only" | "target_gamut_stage"
            )
            || self.channel_order != "rgb"
            || self.numeric_policy_version.trim().is_empty()
            || !valid_hash(&self.content_sha256)
        {
            return Err(anyhow!("color_transform_descriptor_invalid"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor() -> ColorTransformDescriptorV1 {
        ColorTransformDescriptorV1 {
            contract: COLOR_TRANSFORM_CONTRACT_V1.into(),
            source_domain: "negative_acquisition_rgb".into(),
            destination_domain: "acescg_linear_v1".into(),
            source_encoding: "linear".into(),
            destination_encoding: "linear".into(),
            matrix_direction: Some("source_to_destination".into()),
            chromatic_adaptation: "bradford_v1".into(),
            range_policy: "preserve_extended_finite".into(),
            channel_order: "rgb".into(),
            numeric_policy_version: "shared_color_f64_v1".into(),
            content_sha256: "blake3:descriptor-v1".into(),
        }
    }

    #[test]
    fn descriptor_rejects_implicit_or_malformed_metadata() {
        assert!(descriptor().validate().is_ok());
        let mut invalid = descriptor();
        invalid.matrix_direction = Some("implicit".into());
        assert!(invalid.validate().is_err());
        invalid = descriptor();
        invalid.content_sha256 = "sha256:missing".into();
        assert!(invalid.validate().is_err());
    }
}
