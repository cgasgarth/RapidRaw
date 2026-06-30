use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;

use chrono::{DateTime, NaiveDateTime, Utc};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::file_management::{parse_virtual_path, read_file_mapped};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRelinkIdentity {
    path: String,
    byte_length: Option<u64>,
    content_hash: Option<String>,
    capture_timestamp: Option<String>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    lens_model: Option<String>,
}

pub fn read_exif_for_paths_blocking(
    paths: Vec<String>,
) -> HashMap<String, HashMap<String, String>> {
    paths
        .par_iter()
        .filter_map(|virtual_path| {
            let (source_path, _) = parse_virtual_path(virtual_path);
            let source_path_str = source_path.to_string_lossy().to_string();
            let map = read_identity_exif(&source_path, &source_path_str);

            if map.is_empty() {
                None
            } else {
                Some((virtual_path.clone(), map))
            }
        })
        .collect()
}

pub fn read_library_relink_identity_blocking(
    path: String,
) -> Result<LibraryRelinkIdentity, String> {
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let metadata = fs::metadata(&source_path).ok();
    let exif = read_identity_exif(&source_path, &source_path_str);

    Ok(LibraryRelinkIdentity {
        path,
        byte_length: metadata.as_ref().map(|item| item.len()),
        content_hash: metadata
            .as_ref()
            .filter(|item| item.is_file())
            .map(|_| sha256_file(&source_path))
            .transpose()?,
        capture_timestamp: capture_timestamp_from_exif(&exif),
        camera_make: non_empty_exif(&exif, "Make"),
        camera_model: non_empty_exif(&exif, "Model"),
        lens_model: non_empty_exif(&exif, "LensModel"),
    })
}

fn read_identity_exif(source_path: &Path, source_path_str: &str) -> HashMap<String, String> {
    if let Some(sidecar_exif) = crate::exif_processing::read_rrexif_sidecar(source_path) {
        return sidecar_exif;
    }

    if let Ok(mmap) = read_file_mapped(source_path) {
        return crate::exif_processing::read_exif_data(source_path_str, &mmap);
    }

    if let Ok(bytes) = fs::read(source_path) {
        return crate::exif_processing::read_exif_data(source_path_str, &bytes);
    }

    HashMap::new()
}

fn capture_timestamp_from_exif(exif: &HashMap<String, String>) -> Option<String> {
    exif.get("DateTimeOriginal")
        .or_else(|| exif.get("CreateDate"))
        .and_then(|value| parse_relink_datetime(value))
        .map(|datetime| DateTime::<Utc>::from_naive_utc_and_offset(datetime, Utc).to_rfc3339())
}

fn parse_relink_datetime(value: &str) -> Option<NaiveDateTime> {
    let trimmed = value.trim();
    for format in [
        "%Y:%m:%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
    ] {
        if let Ok(datetime) = NaiveDateTime::parse_from_str(trimmed, format) {
            return Some(datetime);
        }
    }
    None
}

fn non_empty_exif(exif: &HashMap<String, String>, key: &str) -> Option<String> {
    exif.get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|e| format!("Failed to open file for hashing: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 64];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to hash file: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn relink_datetime_parser_accepts_supported_formats() {
        assert!(parse_relink_datetime("2026:06:27 12:34:56").is_some());
        assert!(parse_relink_datetime("2026-06-27 12:34:56").is_some());
        assert!(parse_relink_datetime("2026-06-27T12:34:56").is_some());
        assert!(parse_relink_datetime("not a date").is_none());
    }

    #[test]
    fn relink_identity_ignores_empty_exif_fields() {
        let exif = HashMap::from([
            ("Make".to_string(), " Nikon ".to_string()),
            ("Model".to_string(), " ".to_string()),
        ]);

        assert_eq!(non_empty_exif(&exif, "Make").as_deref(), Some("Nikon"));
        assert_eq!(non_empty_exif(&exif, "Model"), None);
        assert_eq!(non_empty_exif(&exif, "LensModel"), None);
    }

    #[test]
    fn sha256_file_reports_prefixed_hash() {
        let mut temp = tempfile::NamedTempFile::new().expect("temp file");
        temp.write_all(b"rawengine identity")
            .expect("write temp file");

        let hash = sha256_file(temp.path()).expect("hash file");

        assert!(hash.starts_with("sha256:"));
        assert_eq!(hash.len(), "sha256:".len() + 64);
    }
}
