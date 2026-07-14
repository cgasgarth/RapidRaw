use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::Manager;

const LIBRARY_DIRECTORY: &str = "negative-lab";
const LIBRARY_FILE: &str = "measured-profile-library.json";

fn library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|root| root.join(LIBRARY_DIRECTORY).join(LIBRARY_FILE))
        .map_err(|error| format!("negative_lab_profile_library_app_data_dir:{error}"))
}

fn validate_library_document(json: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(json)
        .map_err(|error| format!("negative_lab_profile_library_invalid_json:{error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "negative_lab_profile_library_root_must_be_object".to_string())?;
    if object.get("libraryId").and_then(Value::as_str)
        != Some("negative_lab_measured_profile_library")
    {
        return Err("negative_lab_profile_library_id_mismatch".into());
    }
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("negative_lab_profile_library_schema_version_unsupported".into());
    }
    let entries = object
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| "negative_lab_profile_library_entries_missing".to_string())?;
    for entry in entries {
        let entry = entry
            .as_object()
            .ok_or_else(|| "negative_lab_profile_library_entry_must_be_object".to_string())?;
        if entry.get("source").and_then(Value::as_str) != Some("imported_local") {
            return Err("negative_lab_profile_library_entry_source_invalid".into());
        }
        if entry
            .get("contentHash")
            .and_then(Value::as_str)
            .is_none_or(|hash| !hash.starts_with("fnv1a32:") || hash.len() != 16)
        {
            return Err("negative_lab_profile_library_content_hash_invalid".into());
        }
        if entry.get("profile").and_then(Value::as_object).is_none()
            || entry
                .get("profile")
                .and_then(Value::as_object)
                .and_then(|profile| profile.get("profileId"))
                .and_then(Value::as_str)
                .is_none()
        {
            return Err("negative_lab_profile_library_profile_invalid".into());
        }
        if entry.get("report").and_then(Value::as_object).is_none() {
            return Err("negative_lab_profile_library_report_invalid".into());
        }
    }
    Ok(())
}

fn quarantine_corrupt(path: &Path) {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let quarantine = path.with_extension(format!("corrupt-{suffix}.json"));
    let _ = fs::rename(path, quarantine);
}

fn read_library(path: &Path) -> Result<Option<String>, String> {
    let json = match fs::read_to_string(path) {
        Ok(json) => json,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("negative_lab_profile_library_read_failed:{error}")),
    };
    if validate_library_document(&json).is_err() {
        quarantine_corrupt(path);
        return Ok(None);
    }
    Ok(Some(json))
}

fn write_library(path: &Path, json: &str) -> Result<(), String> {
    validate_library_document(json)?;
    let parent = path
        .parent()
        .ok_or_else(|| "negative_lab_profile_library_parent_missing".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("negative_lab_profile_library_directory_failed:{error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temp = path.with_extension(format!("json.tmp-{}-{nonce}", std::process::id()));
    fs::write(&temp, json.as_bytes())
        .map_err(|error| format!("negative_lab_profile_library_temp_write_failed:{error}"))?;
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "negative_lab_profile_library_publish_failed:{error}"
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn read_negative_lab_measured_profile_library(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let path = library_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_library(&path))
        .await
        .map_err(|error| format!("negative_lab_profile_library_read_join_failed:{error}"))?
}

#[tauri::command]
pub async fn write_negative_lab_measured_profile_library(
    app: tauri::AppHandle,
    json: String,
) -> Result<(), String> {
    let path = library_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || write_library(&path, &json))
        .await
        .map_err(|error| format!("negative_lab_profile_library_write_join_failed:{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_document() -> String {
        r#"{"libraryId":"negative_lab_measured_profile_library","schemaVersion":1,"entries":[{"contentHash":"fnv1a32:deadbeef","createdAt":"2026-07-14T00:00:00Z","profile":{"profileId":"negative_lab.measured.c41.local_snapshot.v1"},"report":{"profileId":"negative_lab.measured.c41.local_snapshot.v1"},"source":"imported_local","updatedAt":"2026-07-14T00:00:00Z"}]}"#.into()
    }

    #[test]
    fn atomic_round_trip_and_malformed_quarantine_fail_closed() {
        let root = tempfile::tempdir().unwrap();
        let path = root
            .path()
            .join("negative-lab/measured-profile-library.json");
        write_library(&path, &valid_document()).unwrap();
        assert_eq!(read_library(&path).unwrap(), Some(valid_document()));
        fs::write(&path, "not-json").unwrap();
        assert_eq!(read_library(&path).unwrap(), None);
        assert!(!path.exists());
        assert!(
            root.path()
                .join("negative-lab")
                .read_dir()
                .unwrap()
                .next()
                .is_some()
        );
    }

    #[test]
    fn rejects_wrong_library_identity_and_hash() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("library.json");
        assert!(write_library(&path, &valid_document().replace("deadbeef", "bad")).is_err());
        assert!(
            write_library(
                &path,
                &valid_document().replace("negative_lab_measured_profile_library", "other")
            )
            .is_err()
        );
    }
}
