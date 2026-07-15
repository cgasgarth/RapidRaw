use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const COMMUNITY_PRESET_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/CyberTimon/RapidRAW-Presets/main/manifest.json";
pub const COMMUNITY_PRESET_USER_AGENT: &str = "RapidRAW-App";
pub const COMMUNITY_PRESET_CONNECT_TIMEOUT_SECS: u64 = 5;
pub const COMMUNITY_PRESET_REQUEST_TIMEOUT_SECS: u64 = 15;
pub const MAX_COMMUNITY_PRESET_MANIFEST_BYTES: usize = 1024 * 1024;
const MAX_COMMUNITY_PRESETS: usize = 512;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CommunityPreset {
    pub name: String,
    pub creator: String,
    pub adjustments: Value,
    #[serde(rename = "includeMasks")]
    pub include_masks: Option<bool>,
    #[serde(rename = "includeCropTransform")]
    pub include_crop_transform: Option<bool>,
}

pub(crate) fn parse_community_preset_manifest(
    bytes: &[u8],
) -> Result<Vec<CommunityPreset>, String> {
    if bytes.len() > MAX_COMMUNITY_PRESET_MANIFEST_BYTES {
        return Err("community_presets.manifest_too_large".to_string());
    }
    let presets: Vec<CommunityPreset> = serde_json::from_slice(bytes)
        .map_err(|error| format!("community_presets.manifest_invalid:{error}"))?;
    if presets.len() > MAX_COMMUNITY_PRESETS {
        return Err("community_presets.too_many_presets".to_string());
    }
    let mut names = HashSet::with_capacity(presets.len());
    for preset in &presets {
        let name = preset.name.trim();
        if name.is_empty() || preset.creator.trim().is_empty() || !preset.adjustments.is_object() {
            return Err("community_presets.preset_invalid".to_string());
        }
        if !names.insert(name.to_string()) {
            return Err("community_presets.duplicate_name".to_string());
        }
    }
    Ok(presets)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preset(name: &str) -> serde_json::Value {
        serde_json::json!({
            "name": name,
            "creator": "RapidRAW",
            "adjustments": {}
        })
    }

    #[test]
    fn manifest_rejects_duplicate_and_empty_identities() {
        let duplicates = serde_json::to_vec(&vec![preset("Alaska"), preset("Alaska")]).unwrap();
        assert_eq!(
            parse_community_preset_manifest(&duplicates).unwrap_err(),
            "community_presets.duplicate_name"
        );
        let empty = serde_json::to_vec(&vec![preset("  ")]).unwrap();
        assert_eq!(
            parse_community_preset_manifest(&empty).unwrap_err(),
            "community_presets.preset_invalid"
        );
    }

    #[test]
    fn manifest_size_is_bounded_before_json_parsing() {
        let oversized = vec![b' '; MAX_COMMUNITY_PRESET_MANIFEST_BYTES + 1];
        assert_eq!(
            parse_community_preset_manifest(&oversized).unwrap_err(),
            "community_presets.manifest_too_large"
        );
    }

    #[test]
    fn valid_manifest_preserves_typed_preset_contract() {
        let bytes = serde_json::to_vec(&vec![preset("Alaska")]).unwrap();
        let presets = parse_community_preset_manifest(&bytes).unwrap();
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "Alaska");
        assert!(presets[0].adjustments.is_object());
    }
}
