use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, http, ipc};

const ARTIFACT_SCHEMA_VERSION: u32 = 2;
const ENCODER_VERSION: u32 = 2;
pub const THUMBNAIL_PROTOCOL: &str = "rapidraw-thumb";

static RESOURCE_REQUESTS: AtomicU64 = AtomicU64::new(0);
static RESOURCE_BYTES_SERVED: AtomicU64 = AtomicU64::new(0);
static RESOURCE_ERRORS: AtomicU64 = AtomicU64::new(0);
static BINARY_FALLBACKS: AtomicU64 = AtomicU64::new(0);
static DESCRIPTOR_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ThumbnailResourceSource {
    DiskCache,
    Generated,
    SmartPreview,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResourceDescriptor {
    pub resource_id: String,
    pub revision: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub byte_len: u64,
    pub generation: u64,
    pub source: ThumbnailResourceSource,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailArtifactManifest {
    schema_version: u32,
    mime_type: String,
    width: u32,
    height: u32,
    byte_len: u64,
    revision: String,
    adjustment_fingerprint: String,
    encoder_version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailTransportMetrics {
    resource_requests: u64,
    resource_bytes_served: u64,
    resource_errors: u64,
    binary_fallbacks: u64,
    thumbnail_base64_calls: u64,
}

pub fn next_descriptor_generation() -> u64 {
    DESCRIPTOR_GENERATION.fetch_add(1, Ordering::Relaxed)
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ThumbnailResourceKind {
    Thumbnail,
    SmartPreview,
}

impl ThumbnailResourceKind {
    fn cache_dir_name(self) -> &'static str {
        match self {
            Self::Thumbnail => "thumbnails",
            Self::SmartPreview => "smart-previews",
        }
    }
}

fn is_resource_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_revision(value: &str) -> bool {
    is_resource_id(value)
}

fn cache_root(app: &AppHandle, kind: ThumbnailResourceKind) -> Result<PathBuf, String> {
    let app_cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    Ok(app_cache.join(kind.cache_dir_name()))
}

fn artifact_paths(root: &Path, resource_id: &str) -> Option<(PathBuf, PathBuf)> {
    is_resource_id(resource_id).then(|| {
        (
            root.join(format!("{resource_id}.jpg")),
            root.join(format!("{resource_id}.resource.json")),
        )
    })
}

fn read_manifest(root: &Path, resource_id: &str) -> Option<ThumbnailArtifactManifest> {
    let (_, manifest_path) = artifact_paths(root, resource_id)?;
    let manifest =
        serde_json::from_slice::<ThumbnailArtifactManifest>(&fs::read(manifest_path).ok()?).ok()?;
    (manifest.schema_version == ARTIFACT_SCHEMA_VERSION
        && manifest.encoder_version == ENCODER_VERSION
        && manifest.mime_type == "image/jpeg"
        && manifest.width > 0
        && manifest.height > 0
        && is_revision(&manifest.revision))
    .then_some(manifest)
}

fn confined_artifact_path(root: &Path, resource_id: &str) -> Option<PathBuf> {
    let (path, _) = artifact_paths(root, resource_id)?;
    if fs::symlink_metadata(&path).ok()?.file_type().is_symlink() {
        return None;
    }
    let canonical_root = root.canonicalize().ok()?;
    let canonical_path = path.canonicalize().ok()?;
    canonical_path
        .starts_with(&canonical_root)
        .then_some(canonical_path)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "artifact has no cache parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp_path = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
        std::io::Write::write_all(&mut file, bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temp_path, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp_path);
    }
    result
}

pub fn publish_thumbnail_artifact(
    root: &Path,
    resource_id: &str,
    revision: &str,
    jpeg: &[u8],
    width: u32,
    height: u32,
    adjustment_fingerprint: &str,
) -> Option<ThumbnailArtifactManifest> {
    if !is_resource_id(resource_id)
        || !is_revision(revision)
        || jpeg.is_empty()
        || width == 0
        || height == 0
    {
        return None;
    }
    let (jpeg_path, manifest_path) = artifact_paths(root, resource_id)?;
    let manifest = ThumbnailArtifactManifest {
        schema_version: ARTIFACT_SCHEMA_VERSION,
        mime_type: "image/jpeg".into(),
        width,
        height,
        byte_len: jpeg.len() as u64,
        revision: revision.into(),
        adjustment_fingerprint: adjustment_fingerprint.into(),
        encoder_version: ENCODER_VERSION,
    };
    let manifest_bytes = serde_json::to_vec(&manifest).ok()?;
    atomic_write(&jpeg_path, jpeg).ok()?;
    if atomic_write(&manifest_path, &manifest_bytes).is_err() {
        let _ = fs::remove_file(jpeg_path);
        return None;
    }
    Some(manifest)
}

pub fn descriptor_from_manifest(
    root: &Path,
    resource_id: &str,
    revision: &str,
    generation: u64,
    source: ThumbnailResourceSource,
) -> Option<ThumbnailResourceDescriptor> {
    let manifest = read_manifest(root, resource_id)?;
    let jpeg_path = confined_artifact_path(root, resource_id)?;
    let metadata = fs::metadata(jpeg_path).ok()?;
    if manifest.revision != revision || metadata.len() != manifest.byte_len {
        return None;
    }
    Some(ThumbnailResourceDescriptor {
        resource_id: resource_id.into(),
        revision: revision.into(),
        mime_type: manifest.mime_type,
        width: manifest.width,
        height: manifest.height,
        byte_len: manifest.byte_len,
        generation,
        source,
    })
}

fn read_resource(
    app: &AppHandle,
    kind: ThumbnailResourceKind,
    resource_id: &str,
    revision: &str,
) -> Result<Vec<u8>, String> {
    if !is_resource_id(resource_id) || !is_revision(revision) {
        return Err("invalid thumbnail resource reference".into());
    }
    let root = cache_root(app, kind)?;
    let manifest = read_manifest(&root, resource_id)
        .ok_or_else(|| "thumbnail resource not found".to_string())?;
    if manifest.revision != revision {
        return Err("thumbnail resource is stale".into());
    }
    let path = confined_artifact_path(&root, resource_id)
        .ok_or_else(|| "thumbnail resource not found".to_string())?;
    let bytes = fs::read(path).map_err(|_| "thumbnail resource not found".to_string())?;
    if bytes.len() as u64 != manifest.byte_len {
        return Err("thumbnail resource length mismatch".into());
    }
    Ok(bytes)
}

pub fn protocol_response(app: &AppHandle, uri: &http::Uri) -> http::Response<Vec<u8>> {
    RESOURCE_REQUESTS.fetch_add(1, Ordering::Relaxed);
    let segments: Vec<_> = uri.path().trim_matches('/').split('/').collect();
    let revision = uri
        .query()
        .and_then(|query| query.strip_prefix("v="))
        .unwrap_or_default();
    let kind = match segments.first().copied() {
        Some("thumbnail") => Some(ThumbnailResourceKind::Thumbnail),
        Some("smart-preview") => Some(ThumbnailResourceKind::SmartPreview),
        _ => None,
    };
    let result = kind
        .zip(segments.get(1).copied())
        .ok_or_else(|| "thumbnail resource not found".to_string())
        .and_then(|(kind, id)| read_resource(app, kind, id, revision));
    match result {
        Ok(bytes) => {
            RESOURCE_BYTES_SERVED.fetch_add(bytes.len() as u64, Ordering::Relaxed);
            http::Response::builder()
                .status(http::StatusCode::OK)
                .header(http::header::CONTENT_TYPE, "image/jpeg")
                .header(http::header::CONTENT_LENGTH, bytes.len())
                .header(
                    http::header::CACHE_CONTROL,
                    "public, max-age=31536000, immutable",
                )
                .header(http::header::ETAG, format!("\"{revision}\""))
                .body(bytes)
                .unwrap()
        }
        Err(_) => {
            RESOURCE_ERRORS.fetch_add(1, Ordering::Relaxed);
            http::Response::builder()
                .status(http::StatusCode::NOT_FOUND)
                .body(Vec::new())
                .unwrap()
        }
    }
}

#[tauri::command]
pub fn get_thumbnail_resource(
    app_handle: AppHandle,
    kind: ThumbnailResourceKind,
    resource_id: String,
    revision: String,
) -> Result<ipc::Response, String> {
    BINARY_FALLBACKS.fetch_add(1, Ordering::Relaxed);
    read_resource(&app_handle, kind, &resource_id, &revision).map(ipc::Response::new)
}

#[tauri::command]
pub fn get_thumbnail_transport_metrics() -> ThumbnailTransportMetrics {
    ThumbnailTransportMetrics {
        resource_requests: RESOURCE_REQUESTS.load(Ordering::Relaxed),
        resource_bytes_served: RESOURCE_BYTES_SERVED.load(Ordering::Relaxed),
        resource_errors: RESOURCE_ERRORS.load(Ordering::Relaxed),
        binary_fallbacks: BINARY_FALLBACKS.load(Ordering::Relaxed),
        thumbnail_base64_calls: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(byte: char) -> String {
        std::iter::repeat_n(byte, 64).collect()
    }

    #[test]
    fn rejects_untrusted_resource_ids() {
        let too_short = "a".repeat(63);
        for value in ["../secret", "/absolute/path", "ABCDEF", "a/b", &too_short] {
            assert!(!is_resource_id(value));
        }
    }

    #[test]
    fn manifest_hit_does_not_require_reading_jpeg_body() {
        let dir = tempfile::tempdir().unwrap();
        let resource_id = id('a');
        let revision = id('b');
        publish_thumbnail_artifact(
            dir.path(),
            &resource_id,
            &revision,
            b"jpeg-body",
            40,
            20,
            "adjustments",
        )
        .unwrap();
        let descriptor = descriptor_from_manifest(
            dir.path(),
            &resource_id,
            &revision,
            7,
            ThumbnailResourceSource::DiskCache,
        )
        .unwrap();
        assert_eq!(descriptor.byte_len, 9);
        assert_eq!(descriptor.generation, 7);
        assert_eq!(descriptor.source, ThumbnailResourceSource::DiskCache);
    }

    #[test]
    fn corrupt_or_stale_manifest_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let resource_id = id('c');
        let revision = id('d');
        publish_thumbnail_artifact(dir.path(), &resource_id, &revision, b"jpeg", 4, 3, "").unwrap();
        assert!(
            descriptor_from_manifest(
                dir.path(),
                &resource_id,
                &id('e'),
                0,
                ThumbnailResourceSource::DiskCache
            )
            .is_none()
        );
        fs::write(
            dir.path().join(format!("{resource_id}.resource.json")),
            b"partial",
        )
        .unwrap();
        assert!(
            descriptor_from_manifest(
                dir.path(),
                &resource_id,
                &revision,
                0,
                ThumbnailResourceSource::DiskCache
            )
            .is_none()
        );
    }

    #[test]
    fn legacy_manifest_namespace_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let resource_id = id('1');
        let revision = id('2');
        publish_thumbnail_artifact(dir.path(), &resource_id, &revision, b"jpeg", 4, 3, "").unwrap();
        let path = dir.path().join(format!("{resource_id}.resource.json"));
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        manifest["schemaVersion"] = serde_json::json!(1);
        manifest["encoderVersion"] = serde_json::json!(1);
        fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(
            descriptor_from_manifest(
                dir.path(),
                &resource_id,
                &revision,
                0,
                ThumbnailResourceSource::DiskCache
            )
            .is_none()
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        let resource_id = id('f');
        symlink(
            outside.path(),
            dir.path().join(format!("{resource_id}.jpg")),
        )
        .unwrap();
        assert!(confined_artifact_path(dir.path(), &resource_id).is_none());
    }
}
