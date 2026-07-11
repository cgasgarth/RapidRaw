use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::file_management::parse_virtual_path;
use crate::render::resample::RESAMPLE_KERNEL_VERSION;
use crate::thumbnail_resources::{
    ThumbnailResourceDescriptor, ThumbnailResourceSource, descriptor_from_manifest,
    publish_thumbnail_artifact,
};

const SMART_PREVIEW_SCHEMA_VERSION: u8 = 2;
const SMART_PREVIEW_COLOR_PROFILE: &str = "srgb";
pub const SMART_PREVIEW_TARGET_WIDTH: u32 = 2560;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SmartPreviewManifest {
    schema_version: u8,
    path: String,
    width: u32,
    height: u32,
    byte_size: u64,
    color_profile: String,
    source_revision: String,
    source_available: bool,
    stale: bool,
    created_at: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailSmartPreviewPayload {
    pub color_profile: String,
    pub height: u32,
    pub source: String,
    pub source_available: bool,
    pub source_revision: String,
    pub stale: bool,
    pub width: u32,
}

pub fn compute_smart_preview_id(path_str: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(path_str.as_bytes());
    hasher.update(&RESAMPLE_KERNEL_VERSION.to_le_bytes());
    hasher.finalize().to_hex().to_string()
}

pub fn compute_source_revision(path_str: &str, adjustments_bytes: &[u8]) -> String {
    let (source_path, _) = parse_virtual_path(path_str);
    let metadata = fs::metadata(&source_path).ok();
    let modified_secs = metadata
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let byte_len = metadata.as_ref().map(|m| m.len()).unwrap_or(0);

    let mut hasher = blake3::Hasher::new();
    hasher.update(path_str.as_bytes());
    hasher.update(&modified_secs.to_le_bytes());
    hasher.update(&byte_len.to_le_bytes());
    hasher.update(adjustments_bytes);
    hasher.finalize().to_hex().to_string()
}

pub fn resolve_smart_preview_cache_dir(
    app_handle: &AppHandle,
) -> std::result::Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let smart_preview_dir = cache_dir.join("smart-previews");
    if !smart_preview_dir.exists() {
        fs::create_dir_all(&smart_preview_dir).map_err(|e| e.to_string())?;
    }
    Ok(smart_preview_dir)
}

pub fn smart_preview_paths(smart_preview_dir: &Path, path_str: &str) -> (PathBuf, PathBuf) {
    let preview_id = compute_smart_preview_id(path_str);
    (
        smart_preview_dir.join(format!("{}.jpg", preview_id)),
        smart_preview_dir.join(format!("{}.json", preview_id)),
    )
}

fn thumbnail_smart_preview_payload(
    manifest: &SmartPreviewManifest,
    source: &str,
) -> ThumbnailSmartPreviewPayload {
    ThumbnailSmartPreviewPayload {
        color_profile: manifest.color_profile.clone(),
        height: manifest.height,
        source: source.to_string(),
        source_available: manifest.source_available,
        source_revision: manifest.source_revision.clone(),
        stale: manifest.stale,
        width: manifest.width,
    }
}

pub fn write_smart_preview_artifact(
    smart_preview_dir: &Path,
    path_str: &str,
    thumb_data: &[u8],
    width: u32,
    height: u32,
    adjustments_bytes: &[u8],
) -> Option<(ThumbnailSmartPreviewPayload, ThumbnailResourceDescriptor)> {
    let (source_path, _) = parse_virtual_path(path_str);
    let source_available = source_path.exists();
    let (_, manifest_path) = smart_preview_paths(smart_preview_dir, path_str);
    let manifest = SmartPreviewManifest {
        schema_version: SMART_PREVIEW_SCHEMA_VERSION,
        path: path_str.to_string(),
        width,
        height,
        byte_size: thumb_data.len() as u64,
        color_profile: SMART_PREVIEW_COLOR_PROFILE.to_string(),
        source_revision: compute_source_revision(path_str, adjustments_bytes),
        source_available,
        stale: !source_available,
        created_at: Utc::now().to_rfc3339(),
    };

    let resource_id = compute_smart_preview_id(path_str);
    publish_thumbnail_artifact(
        smart_preview_dir,
        &resource_id,
        &manifest.source_revision,
        thumb_data,
        width,
        height,
        &manifest.source_revision,
    )?;
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).ok()?;
    let temp_manifest = manifest_path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp_manifest, manifest_bytes).ok()?;
    fs::rename(temp_manifest, manifest_path).ok()?;

    let descriptor = descriptor_from_manifest(
        smart_preview_dir,
        &resource_id,
        &manifest.source_revision,
        0,
        ThumbnailResourceSource::SmartPreview,
    )?;
    Some((
        thumbnail_smart_preview_payload(&manifest, "rendered"),
        descriptor,
    ))
}

pub fn read_smart_preview_artifact(
    smart_preview_dir: &Path,
    path_str: &str,
) -> Option<(ThumbnailResourceDescriptor, ThumbnailSmartPreviewPayload)> {
    let (_, manifest_path) = smart_preview_paths(smart_preview_dir, path_str);
    let mut manifest: SmartPreviewManifest =
        serde_json::from_slice(&fs::read(manifest_path).ok()?).ok()?;
    if manifest.schema_version != SMART_PREVIEW_SCHEMA_VERSION {
        return None;
    }
    let (source_path, _) = parse_virtual_path(path_str);
    manifest.source_available = source_path.exists();
    manifest.stale = !manifest.source_available;

    let resource_id = compute_smart_preview_id(path_str);
    let descriptor = descriptor_from_manifest(
        smart_preview_dir,
        &resource_id,
        &manifest.source_revision,
        0,
        ThumbnailResourceSource::SmartPreview,
    )?;
    Some((
        descriptor,
        thumbnail_smart_preview_payload(&manifest, "smartPreview"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_preview_id_stays_stable_when_source_changes() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("image.raf");
        fs::write(&image_path, b"first").expect("source image");
        let path = image_path.to_string_lossy().into_owned();

        let preview_id = compute_smart_preview_id(&path);

        fs::write(&image_path, b"second").expect("updated source image");

        assert_eq!(preview_id, compute_smart_preview_id(&path));
    }

    #[test]
    fn smart_preview_source_revision_tracks_source_and_adjustment_changes() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("image.raf");
        fs::write(&image_path, b"first").expect("source image");
        let path = image_path.to_string_lossy().into_owned();

        let original_revision = compute_source_revision(&path, br#"{"exposure":0}"#);
        let adjustment_revision = compute_source_revision(&path, br#"{"exposure":1}"#);
        fs::write(&image_path, b"second payload").expect("updated source image");
        let source_revision = compute_source_revision(&path, br#"{"exposure":0}"#);

        assert_ne!(original_revision, adjustment_revision);
        assert_ne!(original_revision, source_revision);
    }

    #[test]
    fn smart_preview_artifact_reports_stale_when_source_disappears() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("image.raf");
        fs::write(&image_path, b"raw").expect("source image");
        let path = image_path.to_string_lossy().into_owned();
        let preview_dir = temp_dir.path().join("smart-previews");
        fs::create_dir_all(&preview_dir).expect("preview dir");

        let (write_payload, _) =
            write_smart_preview_artifact(&preview_dir, &path, b"jpeg", 2560, 1707, b"{}")
                .expect("smart preview write");
        assert!(!write_payload.stale);

        fs::remove_file(&image_path).expect("source removed");
        let (descriptor, read_payload) =
            read_smart_preview_artifact(&preview_dir, &path).expect("smart preview read");

        assert_eq!(descriptor.byte_len, 4);
        assert!(read_payload.stale);
        assert!(!read_payload.source_available);
        assert_eq!(read_payload.source, "smartPreview");
    }
}
