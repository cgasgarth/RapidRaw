use std::time::Duration;

use crate::community_presets::{
    COMMUNITY_PRESET_CONNECT_TIMEOUT_SECS, COMMUNITY_PRESET_MANIFEST_URL,
    COMMUNITY_PRESET_REQUEST_TIMEOUT_SECS, COMMUNITY_PRESET_USER_AGENT, CommunityPreset,
    MAX_COMMUNITY_PRESET_MANIFEST_BYTES, parse_community_preset_manifest,
};

#[tauri::command]
pub(crate) async fn fetch_community_presets() -> Result<Vec<CommunityPreset>, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(COMMUNITY_PRESET_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(COMMUNITY_PRESET_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("community_presets.client_build_failed:{error}"))?;
    let mut response = client
        .get(COMMUNITY_PRESET_MANIFEST_URL)
        .header("User-Agent", COMMUNITY_PRESET_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("community_presets.fetch_failed:{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "community_presets.http_status:{}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_COMMUNITY_PRESET_MANIFEST_BYTES as u64)
    {
        return Err("community_presets.manifest_too_large".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("community_presets.body_read_failed:{error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_COMMUNITY_PRESET_MANIFEST_BYTES {
            return Err("community_presets.manifest_too_large".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_community_preset_manifest(&bytes)
}
