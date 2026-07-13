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

const SMART_PREVIEW_SCHEMA_VERSION: u8 = 3;
const SMART_PREVIEW_COLOR_PROFILE: &str = "srgb";
pub const SMART_PREVIEW_TARGET_WIDTH: u32 = 2560;
pub const SMART_PREVIEW_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const SMART_PREVIEW_CACHE_MAX_ARTIFACTS: usize = 2_000;

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

pub fn enforce_smart_preview_cache_budget(
    smart_preview_dir: &Path,
    preserve_resource_id: &str,
) -> (usize, u64) {
    enforce_smart_preview_cache_budget_with_limits(
        smart_preview_dir,
        preserve_resource_id,
        SMART_PREVIEW_CACHE_MAX_ARTIFACTS,
        SMART_PREVIEW_CACHE_MAX_BYTES,
    )
}

fn enforce_smart_preview_cache_budget_with_limits(
    smart_preview_dir: &Path,
    preserve_resource_id: &str,
    max_artifacts: usize,
    max_bytes: u64,
) -> (usize, u64) {
    let mut artifacts = fs::read_dir(smart_preview_dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let resource_id = name.strip_suffix(".resource.json")?.to_string();
            let jpeg = smart_preview_dir.join(format!("{resource_id}.jpg"));
            let metadata = fs::metadata(&jpeg).ok()?;
            Some((
                resource_id,
                metadata.len(),
                metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
            ))
        })
        .collect::<Vec<_>>();
    artifacts.sort_by_key(|(_, _, modified)| *modified);
    let mut total_bytes = artifacts.iter().map(|(_, bytes, _)| bytes).sum::<u64>();
    let mut total_count = artifacts.len();
    for (resource_id, bytes, _) in artifacts {
        if total_count <= max_artifacts && total_bytes <= max_bytes {
            break;
        }
        if resource_id == preserve_resource_id {
            continue;
        }
        for suffix in ["jpg", "resource.json", "json"] {
            let _ = fs::remove_file(smart_preview_dir.join(format!("{resource_id}.{suffix}")));
        }
        total_count = total_count.saturating_sub(1);
        total_bytes = total_bytes.saturating_sub(bytes);
    }
    (total_count, total_bytes)
}

pub fn read_smart_preview_artifact(
    smart_preview_dir: &Path,
    path_str: &str,
    expected_adjustments: Option<&[u8]>,
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
    if manifest.source_available
        && expected_adjustments.is_none_or(|adjustments| {
            manifest.source_revision != compute_source_revision(path_str, adjustments)
        })
    {
        return None;
    }

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
    fn smart_preview_revision_invalidates_for_technical_white_balance() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("image.raf");
        fs::write(&image_path, b"raw").expect("source image");
        let path = image_path.to_string_lossy();
        let as_shot = br#"{"whiteBalanceTechnical":{"mode":"as_shot"}}"#;
        let daylight = br#"{"whiteBalanceTechnical":{"mode":"preset","kelvin":5503,"duv":0}}"#;
        assert_ne!(
            compute_source_revision(&path, as_shot),
            compute_source_revision(&path, daylight)
        );
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
            read_smart_preview_artifact(&preview_dir, &path, None).expect("smart preview read");

        assert_eq!(descriptor.byte_len, 4);
        assert!(read_payload.stale);
        assert!(!read_payload.source_available);
        assert_eq!(read_payload.source, "smartPreview");
    }

    #[test]
    fn smart_preview_budget_evicts_old_artifacts_but_preserves_current() {
        let temp = tempfile::tempdir().unwrap();
        for (resource_id, bytes) in [("a", 8_usize), ("b", 8), ("c", 8)] {
            fs::write(
                temp.path().join(format!("{resource_id}.jpg")),
                vec![0; bytes],
            )
            .unwrap();
            fs::write(
                temp.path().join(format!("{resource_id}.resource.json")),
                b"{}",
            )
            .unwrap();
            fs::write(temp.path().join(format!("{resource_id}.json")), b"{}").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        let (count, bytes) =
            enforce_smart_preview_cache_budget_with_limits(temp.path(), "a", 2, 16);
        assert_eq!((count, bytes), (2, 16));
        assert!(temp.path().join("a.jpg").exists());
        assert!(!temp.path().join("b.jpg").exists());
        assert!(temp.path().join("c.jpg").exists());
    }

    #[test]
    fn rejects_legacy_manifest_namespace() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("image.raf");
        fs::write(&image_path, b"raw").unwrap();
        let path = image_path.to_string_lossy().into_owned();
        let preview_dir = temp_dir.path().join("smart-previews");
        fs::create_dir_all(&preview_dir).unwrap();
        write_smart_preview_artifact(&preview_dir, &path, b"jpeg", 10, 10, b"{}").unwrap();
        let (_, manifest_path) = smart_preview_paths(&preview_dir, &path);
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["schemaVersion"] = serde_json::json!(2);
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(read_smart_preview_artifact(&preview_dir, &path, Some(b"{}")).is_none());
    }
}
