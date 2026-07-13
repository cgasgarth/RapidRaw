use super::{CameraProfileSource, DcpParseLimits, DcpProfileV1, parse_dcp};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use walkdir::WalkDir;

const MAX_PARSED_PROFILE_CACHE_ENTRIES: usize = 128;
static PARSED_PROFILE_CACHE: OnceLock<Mutex<BTreeMap<String, DcpProfileV1>>> = OnceLock::new();
static MANAGED_PROFILE_ROOT: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileRegistryEntry {
    pub id: String,
    pub display_name: String,
    pub camera_model: Option<String>,
    pub source: CameraProfileSource,
    pub content_sha256: String,
    pub compatible: bool,
    pub creative_amount_supported: bool,
    pub favorite: bool,
    pub last_used_epoch_ms: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuarantinedProfile {
    pub private_path_token: String,
    pub reason_code: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CameraProfileRegistryReport {
    pub entries: Vec<ProfileRegistryEntry>,
    pub quarantine: Vec<QuarantinedProfile>,
}
#[derive(Debug, Default)]
pub(crate) struct CameraProfileRegistry {
    profiles: BTreeMap<String, (DcpProfileV1, ProfileRegistryEntry)>,
    quarantine: Vec<QuarantinedProfile>,
}

impl CameraProfileRegistry {
    pub(crate) fn scan(
        &mut self,
        roots: &[(PathBuf, CameraProfileSource)],
        camera_model: Option<&str>,
        limits: DcpParseLimits,
    ) -> Result<()> {
        for (root, source) in roots {
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root)
                .follow_links(false)
                .max_depth(8)
                .into_iter()
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry.file_type().is_file()
                        && entry
                            .path()
                            .extension()
                            .is_some_and(|ext| ext.eq_ignore_ascii_case("dcp"))
                })
            {
                self.ingest_path(entry.path(), *source, camera_model, limits);
            }
        }
        Ok(())
    }
    fn ingest_path(
        &mut self,
        path: &Path,
        source: CameraProfileSource,
        camera_model: Option<&str>,
        limits: DcpParseLimits,
    ) {
        let result =
            read_profile_bytes(path, limits).and_then(|bytes| parse_profile_cached(&bytes, limits));
        match result {
            Ok(profile) => {
                let id = format!(
                    "dcp:{}",
                    profile.content_sha256.trim_start_matches("sha256:")
                );
                let compatible = match (&profile.camera_model, camera_model) {
                    (Some(a), Some(b)) => normalize(a) == normalize(b),
                    (Some(_), None) => false,
                    (None, _) => true,
                };
                let entry = ProfileRegistryEntry {
                    id: id.clone(),
                    display_name: profile.name.clone(),
                    camera_model: profile.camera_model.clone(),
                    source,
                    content_sha256: profile.content_sha256.clone(),
                    compatible,
                    creative_amount_supported: profile.look_table.is_some(),
                    favorite: false,
                    last_used_epoch_ms: None,
                };
                self.profiles.entry(id).or_insert((profile, entry));
            }
            Err(error) => self.quarantine.push(QuarantinedProfile {
                private_path_token: path.file_name().and_then(|name| name.to_str()).map_or_else(
                    || "invalid-profile".into(),
                    |name| format!("name-hash:{}", blake3::hash(name.as_bytes()).to_hex()),
                ),
                reason_code: error.root_cause().to_string(),
            }),
        }
    }
    pub(crate) fn entries(
        &self,
        search: Option<&str>,
        compatible_only: bool,
    ) -> Vec<&ProfileRegistryEntry> {
        let query = search.map(normalize);
        let mut entries: Vec<_> = self
            .profiles
            .values()
            .map(|(_, entry)| entry)
            .filter(|entry| !compatible_only || entry.compatible)
            .filter(|entry| {
                query.as_ref().is_none_or(|q| {
                    normalize(&entry.display_name).contains(q)
                        || entry
                            .camera_model
                            .as_ref()
                            .is_some_and(|model| normalize(model).contains(q))
                })
            })
            .collect();
        entries.sort_by_key(|entry| {
            (
                !entry.favorite,
                std::cmp::Reverse(entry.last_used_epoch_ms),
                entry.display_name.to_lowercase(),
            )
        });
        entries
    }
    pub(crate) fn quarantine(&self) -> &[QuarantinedProfile] {
        &self.quarantine
    }
    fn report(&self) -> CameraProfileRegistryReport {
        CameraProfileRegistryReport {
            entries: self.entries(None, false).into_iter().cloned().collect(),
            quarantine: self.quarantine().to_vec(),
        }
    }
}

fn parse_profile_cached(bytes: &[u8], limits: DcpParseLimits) -> Result<DcpProfileV1> {
    use sha2::{Digest, Sha256};
    let hash = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
    let cache = PARSED_PROFILE_CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    if let Some(profile) = cache.lock().unwrap().get(&hash).cloned() {
        return Ok(profile);
    }
    let profile = parse_dcp(bytes, limits)?;
    let mut cache = cache.lock().unwrap();
    if cache.len() >= MAX_PARSED_PROFILE_CACHE_ENTRIES
        && let Some(oldest) = cache.keys().next().cloned()
    {
        cache.remove(&oldest);
    }
    cache.insert(hash, profile.clone());
    Ok(profile)
}
fn read_profile_bytes(path: &Path, limits: DcpParseLimits) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path).context("camera_profile_metadata_failed")?;
    anyhow::ensure!(metadata.is_file(), "camera_profile_not_regular_file");
    anyhow::ensure!(
        metadata.len() <= limits.max_file_bytes as u64,
        "camera_profile_file_too_large"
    );
    fs::read(path).context("camera_profile_read_failed")
}

pub(crate) fn managed_profile_root(app: &tauri::AppHandle) -> Result<PathBuf> {
    use tauri::Manager;
    let root = app
        .path()
        .app_data_dir()
        .context("camera_profile_app_data_dir_unavailable")?
        .join("camera-profiles");
    let _ = MANAGED_PROFILE_ROOT.set(root.clone());
    Ok(root)
}

pub(crate) fn resolve_managed_profile(
    id: &str,
    root: &Path,
) -> Option<(DcpProfileV1, CameraProfileSource)> {
    let root = if root.as_os_str().is_empty() {
        MANAGED_PROFILE_ROOT.get()?.as_path()
    } else {
        root
    };
    let digest = id.strip_prefix("dcp:")?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return None;
    }
    let expected_hash = format!("sha256:{digest}");
    for (directory, source) in [
        ("user", CameraProfileSource::User),
        ("open", CameraProfileSource::Open),
        ("generated", CameraProfileSource::Generated),
    ] {
        let path = root.join(directory).join(format!("{}.dcp", digest));
        if let Ok(bytes) = read_profile_bytes(&path, DcpParseLimits::default())
            && let Ok(profile) = parse_profile_cached(&bytes, DcpParseLimits::default())
            && profile.content_sha256 == expected_hash
        {
            return Some((profile, source));
        }
    }
    None
}

#[tauri::command]
pub(crate) async fn list_camera_profiles(
    app: tauri::AppHandle,
    camera_model: Option<String>,
) -> Result<CameraProfileRegistryReport, String> {
    let root = managed_profile_root(&app).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut registry = CameraProfileRegistry::default();
        registry
            .scan(
                &[
                    (root.join("open"), CameraProfileSource::Open),
                    (root.join("generated"), CameraProfileSource::Generated),
                    (root.join("user"), CameraProfileSource::User),
                ],
                camera_model.as_deref(),
                DcpParseLimits::default(),
            )
            .map_err(|error| error.to_string())?;
        Ok(registry.report())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn import_camera_profile(
    app: tauri::AppHandle,
    source_path: String,
    camera_model: Option<String>,
) -> Result<CameraProfileRegistryReport, String> {
    let root = managed_profile_root(&app).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(source_path);
        if !source
            .extension()
            .is_some_and(|value| value.eq_ignore_ascii_case("dcp"))
        {
            return Err("camera_profile_import_extension_not_dcp".to_string());
        }
        let bytes = read_profile_bytes(&source, DcpParseLimits::default())
            .map_err(|error| error.to_string())?;
        let profile =
            parse_dcp(&bytes, DcpParseLimits::default()).map_err(|error| error.to_string())?;
        let user_root = root.join("user");
        fs::create_dir_all(&user_root)
            .map_err(|_| "camera_profile_import_create_dir_failed".to_string())?;
        let hash = profile.content_sha256.trim_start_matches("sha256:");
        let destination = user_root.join(format!("{hash}.dcp"));
        if !destination.exists() {
            let mut temporary = tempfile::NamedTempFile::new_in(&user_root)
                .map_err(|_| "camera_profile_import_temp_failed".to_string())?;
            temporary
                .write_all(&bytes)
                .and_then(|_| temporary.as_file().sync_all())
                .map_err(|_| "camera_profile_import_write_failed".to_string())?;
            temporary
                .persist(&destination)
                .map_err(|_| "camera_profile_import_persist_failed".to_string())?;
        }
        let mut registry = CameraProfileRegistry::default();
        registry
            .scan(
                &[
                    (root.join("open"), CameraProfileSource::Open),
                    (root.join("generated"), CameraProfileSource::Generated),
                    (user_root, CameraProfileSource::User),
                ],
                camera_model.as_deref(),
                DcpParseLimits::default(),
            )
            .map_err(|error| error.to_string())?;
        Ok(registry.report())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn remove_camera_profile(
    app: tauri::AppHandle,
    id: String,
) -> Result<bool, String> {
    let hash = id
        .strip_prefix("dcp:")
        .ok_or_else(|| "camera_profile_remove_invalid_id".to_string())?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("camera_profile_remove_invalid_id".to_string());
    }
    let path = managed_profile_root(&app)
        .map_err(|error| error.to_string())?
        .join("user")
        .join(format!("{hash}.dcp"));
    tauri::async_runtime::spawn_blocking(move || match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("camera_profile_remove_failed".to_string()),
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn reveal_camera_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let hash = validated_profile_hash(&id)?;
    let path = managed_profile_root(&app)
        .map_err(|error| error.to_string())?
        .join("user")
        .join(format!("{hash}.dcp"));
    if !path.is_file() {
        return Err("camera_profile_reveal_missing".to_string());
    }
    crate::library::file_management::show_in_finder(path.to_string_lossy().into_owned())
}

fn validated_profile_hash(id: &str) -> Result<&str, String> {
    let hash = id
        .strip_prefix("dcp:")
        .ok_or_else(|| "camera_profile_invalid_id".to_string())?;
    if hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(hash)
    } else {
        Err("camera_profile_invalid_id".to_string())
    }
}
fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn minimal_dcp(name: &str, camera: &str) -> Vec<u8> {
        let mut fields = vec![
            (50_936u16, 2u16, format!("{name}\0").into_bytes()),
            (50_708, 2, format!("{camera}\0").into_bytes()),
        ];
        fields.push((
            50_721,
            11,
            [1.0f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
                .into_iter()
                .flat_map(f32::to_le_bytes)
                .collect(),
        ));
        let mut bytes = vec![b'I', b'I', 42, 0, 8, 0, 0, 0];
        bytes.extend_from_slice(&(fields.len() as u16).to_le_bytes());
        let data_start = 8 + 2 + fields.len() * 12 + 4;
        let mut data = Vec::new();
        for (tag, kind, value) in fields {
            let width = if kind == 2 { 1 } else { 4 };
            bytes.extend_from_slice(&tag.to_le_bytes());
            bytes.extend_from_slice(&kind.to_le_bytes());
            bytes.extend_from_slice(&(value.len() as u32 / width).to_le_bytes());
            if value.len() <= 4 {
                let mut inline = [0; 4];
                inline[..value.len()].copy_from_slice(&value);
                bytes.extend_from_slice(&inline);
            } else {
                bytes.extend_from_slice(&((data_start + data.len()) as u32).to_le_bytes());
                data.extend_from_slice(&value);
            }
        }
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&data);
        bytes
    }
    #[test]
    fn registry_search_favorite_and_source_scoped_remove() {
        let mut registry = CameraProfileRegistry::default();
        let profile = DcpProfileV1 {
            name: "Neutral Portrait".into(),
            camera_model: Some("Sony A1".into()),
            calibration_illuminants: [None, None],
            color_matrices: [Some([[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]]), None],
            camera_calibrations: [None, None],
            reduction_matrices: [None, None],
            analog_balance: [1.0; 3],
            forward_matrices: [None, None],
            hue_sat_maps: [None, None],
            look_table: None,
            tone_curve: vec![],
            baseline_exposure_ev: 0.,
            default_black_render: None,
            calibration_signature: None,
            copyright: None,
            embed_policy: None,
            content_sha256: "sha256:a".into(),
            unsupported_tag_ids: vec![],
        };
        let id = "dcp:a".to_string();
        registry.profiles.insert(
            id.clone(),
            (
                profile,
                ProfileRegistryEntry {
                    id: id.clone(),
                    display_name: "Neutral Portrait".into(),
                    camera_model: Some("Sony A1".into()),
                    source: CameraProfileSource::User,
                    content_sha256: "sha256:a".into(),
                    compatible: true,
                    creative_amount_supported: false,
                    favorite: false,
                    last_used_epoch_ms: None,
                },
            ),
        );
        assert_eq!(registry.entries(Some("portrait"), true).len(), 1);
        assert_eq!(registry.entries(None, false)[0].id, id);
    }

    #[test]
    fn scan_quarantines_malformed_profiles_without_exposing_paths() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("private-camera-name.dcp");
        fs::write(&path, b"not a tiff").unwrap();
        let mut registry = CameraProfileRegistry::default();
        registry
            .scan(
                &[(directory.path().to_path_buf(), CameraProfileSource::User)],
                Some("Sony A1"),
                DcpParseLimits::default(),
            )
            .unwrap();
        let report = registry.report();
        assert!(report.entries.is_empty());
        assert_eq!(report.quarantine.len(), 1);
        assert!(
            report.quarantine[0]
                .private_path_token
                .starts_with("name-hash:")
        );
        assert!(
            !serde_json::to_string(&report)
                .unwrap()
                .contains("private-camera-name")
        );
    }

    #[test]
    fn scan_deduplicates_content_and_matches_normalized_camera_identity() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = minimal_dcp("Open Neutral", "SONY ILCE-7RM4");
        fs::write(directory.path().join("first.dcp"), &bytes).unwrap();
        fs::write(directory.path().join("duplicate.dcp"), &bytes).unwrap();
        let mut registry = CameraProfileRegistry::default();
        registry
            .scan(
                &[(directory.path().to_path_buf(), CameraProfileSource::Open)],
                Some("Sony ILCE 7RM4"),
                DcpParseLimits::default(),
            )
            .unwrap();
        let report = registry.report();
        assert_eq!(report.entries.len(), 1);
        assert_eq!(report.entries[0].display_name, "Open Neutral");
        assert!(report.entries[0].compatible);
        assert_eq!(report.entries[0].source, CameraProfileSource::Open);
    }

    #[test]
    fn managed_profile_resolution_reopens_canonical_profile_from_disk() {
        let root = tempfile::tempdir().unwrap();
        let bytes = minimal_dcp("Restart Safe Neutral", "SONY ILCE-7RM4");
        let parsed = parse_dcp(&bytes, DcpParseLimits::default()).unwrap();
        let digest = parsed.content_sha256.trim_start_matches("sha256:");
        let open_root = root.path().join("open");
        fs::create_dir_all(&open_root).unwrap();
        fs::write(open_root.join(format!("{digest}.dcp")), &bytes).unwrap();

        let id = format!("dcp:{digest}");
        let (resolved, source) = resolve_managed_profile(&id, root.path()).unwrap();
        assert_eq!(resolved.content_sha256, parsed.content_sha256);
        assert_eq!(source, CameraProfileSource::Open);
        assert!(resolve_managed_profile(&id.to_ascii_uppercase(), root.path()).is_none());

        let mismatched_id = format!("dcp:{}", "f".repeat(64));
        fs::write(open_root.join(format!("{}.dcp", "f".repeat(64))), &bytes).unwrap();
        assert!(resolve_managed_profile(&mismatched_id, root.path()).is_none());
    }
}
