use memmap2::{Mmap, MmapOptions};
use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::thread;

use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use image::codecs::{jpeg::JpegEncoder, tiff::TiffDecoder};
use image::{ColorType, DynamicImage, GenericImageView, ImageBuffer, ImageDecoder, Luma};
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::AppState;
use crate::album_management::{add_to_album, sync_album_path_changes};
#[cfg(target_os = "android")]
use crate::android_integration::*;
use crate::app_settings::*;
use crate::cache_utils::calculate_geometry_hash;
use crate::exif_processing;
use crate::formats::{is_raw_file, is_supported_image_file, jpeg_data_url};
use crate::gpu_processing;
use crate::image_loader;
use crate::image_processing::GpuContext;
use crate::image_processing::{
    Crop, ImageMetadata, RawEngineArtifacts, apply_coarse_rotation,
    apply_cpu_default_raw_processing, apply_crop, apply_flip, apply_geometry_warp, apply_rotation,
    auto_results_to_json, get_all_adjustments_from_json, perform_auto_analysis,
};
use crate::library_identity::{
    LibraryRelinkIdentity, read_exif_for_paths_blocking, read_library_relink_identity_blocking,
};
use crate::mask_generation::MaskDefinition;
use crate::smart_preview_cache::{
    SMART_PREVIEW_TARGET_WIDTH, ThumbnailSmartPreviewPayload, compute_source_revision,
    read_smart_preview_artifact, resolve_smart_preview_cache_dir, write_smart_preview_artifact,
};
use crate::tagging::{COLOR_TAG_PREFIX, USER_TAG_PREFIX};
use crate::xmp_sidecar::{extract_xmp_label, extract_xmp_rating, extract_xmp_tags};

fn resolve_thumbnail_cache_dir(app_handle: &AppHandle) -> std::result::Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");
    if !thumb_cache_dir.exists() {
        fs::create_dir_all(&thumb_cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(thumb_cache_dir)
}

fn emit_thumbnail_cache_setup_error(app_handle: &AppHandle, path: &str, reason: &str) {
    let _ = app_handle.emit(
        "thumbnail-generation-error",
        serde_json::json!({ "path": path, "reason": reason }),
    );
}

fn compute_thumbnail_cache_hash(path_str: &str, adjustments_bytes: &[u8]) -> Option<String> {
    let (source_path, _) = parse_virtual_path(path_str);

    let img_mod_time = fs::metadata(&source_path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();

    let mut hasher = blake3::Hasher::new();
    hasher.update(path_str.as_bytes());
    hasher.update(&img_mod_time.to_le_bytes());
    hasher.update(adjustments_bytes);
    Some(hasher.finalize().to_hex().to_string())
}

#[derive(Debug, Clone)]
struct ThumbnailResult {
    data_url: String,
    is_edited: bool,
    rating: u8,
    smart_preview: Option<ThumbnailSmartPreviewPayload>,
}

fn generate_and_write_smart_preview_artifact(
    smart_preview_dir: &Path,
    path_str: &str,
    gpu_context: Option<&GpuContext>,
    preloaded_image: Option<&DynamicImage>,
    app_handle: &AppHandle,
    adjustments_bytes: &[u8],
) -> Option<ThumbnailSmartPreviewPayload> {
    let smart_image = generate_thumbnail_data_with_target(
        path_str,
        gpu_context,
        preloaded_image,
        app_handle,
        Some(SMART_PREVIEW_TARGET_WIDTH),
    )
    .ok()?;
    let (smart_data, width, height) =
        encode_thumbnail(&smart_image, SMART_PREVIEW_TARGET_WIDTH).ok()?;
    write_smart_preview_artifact(
        smart_preview_dir,
        path_str,
        &smart_data,
        width,
        height,
        adjustments_bytes,
    )
}

#[derive(Debug)]
pub enum ReadFileError {
    Io(std::io::Error),
    Locked,
    Empty,
    NotFound,
    Invalid,
}

impl fmt::Display for ReadFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadFileError::Io(err) => write!(f, "IO error: {}", err),
            ReadFileError::Locked => write!(f, "File is locked"),
            ReadFileError::Empty => write!(f, "File is empty"),
            ReadFileError::NotFound => write!(f, "File not found"),
            ReadFileError::Invalid => write!(f, "Invalid file"),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageFile {
    path: String,
    modified: u64,
    is_edited: bool,
    rating: u8,
    tags: Option<Vec<String>>,
    exif: Option<HashMap<String, String>>,
    is_virtual_copy: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEditorVariantReceipt {
    artifact_id: String,
    bit_depth: Option<u8>,
    color_profile: Option<String>,
    content_hash: String,
    embedded_icc_profile: bool,
    output_path: String,
    rendering_intent: Option<String>,
    sidecar_path: String,
    source_path: String,
    source_revision: String,
    verified_bit_depth: Option<u8>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileWatchSnapshot {
    byte_size: u64,
    modified_ms: u128,
    path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettings {
    pub filename_template: String,
    pub organize_by_date: bool,
    pub date_folder_format: String,
    pub delete_after_import: bool,
}

fn split_rrdata_sidecar_filename(file_name: &str) -> Option<(String, Option<String>)> {
    let base = file_name.strip_suffix(".rrdata")?;
    if base.len() >= 7 && base.as_bytes()[base.len() - 7] == b'.' {
        let id = &base[base.len() - 6..];
        if id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
            return Some((base[..base.len() - 7].to_string(), Some(id.to_string())));
        }
    }

    Some((base.to_string(), None))
}

fn rrdata_sidecar_filename(source_path: &Path, copy_id: Option<&str>) -> String {
    let source_filename = source_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    match copy_id {
        Some(id) => format!("{}.{}.rrdata", source_filename, id),
        None => format!("{}.rrdata", source_filename),
    }
}

fn rrdata_sidecar_path(source_path: &Path, copy_id: Option<&str>) -> PathBuf {
    source_path.with_file_name(rrdata_sidecar_filename(source_path, copy_id))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VirtualImagePath {
    source_path: PathBuf,
    copy_id: Option<String>,
}

impl VirtualImagePath {
    pub fn parse(virtual_path: &str) -> Self {
        let (source_path, copy_id) = if let Some((base, id)) = virtual_path.rsplit_once("?vc=") {
            (PathBuf::from(base), Some(id.to_string()))
        } else {
            (PathBuf::from(virtual_path), None)
        };

        Self {
            source_path,
            copy_id,
        }
    }

    pub fn source_path(&self) -> &Path {
        &self.source_path
    }

    pub fn copy_id(&self) -> Option<&str> {
        self.copy_id.as_deref()
    }

    pub fn sidecar_path(&self) -> PathBuf {
        rrdata_sidecar_path(&self.source_path, self.copy_id())
    }

    pub fn to_serialized(&self) -> String {
        match self.copy_id() {
            Some(copy_id) => format!("{}?vc={}", self.source_path.to_string_lossy(), copy_id),
            None => self.source_path.to_string_lossy().to_string(),
        }
    }
}

fn rrexif_sidecar_path(source_path: &Path) -> PathBuf {
    let mut rrexif_name = source_path.file_name().unwrap_or_default().to_os_string();
    rrexif_name.push(".rrexif");
    source_path.with_file_name(rrexif_name)
}

fn save_metadata_sidecar(sidecar_path: &Path, metadata: &ImageMetadata) -> Result<(), String> {
    crate::exif_processing::save_sidecar_metadata_atomic(sidecar_path, metadata)
}

fn save_metadata_sidecar_or_warn(sidecar_path: &Path, metadata: &ImageMetadata, context: &str) {
    if let Err(err) = save_metadata_sidecar(sidecar_path, metadata) {
        log::warn!(
            "{} failed for sidecar {}: {}",
            context,
            sidecar_path.display(),
            err
        );
    }
}

fn copy_existing_file(source_path: &Path, destination_path: &Path) -> Result<(), String> {
    if source_path.exists() {
        fs::copy(source_path, destination_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_primary_sidecars(
    source_path: &Path,
    source_sidecar_path: &Path,
    destination_path: &Path,
) -> Result<(), String> {
    copy_existing_file(
        source_sidecar_path,
        &rrdata_sidecar_path(destination_path, None),
    )?;
    copy_existing_file(
        &rrexif_sidecar_path(source_path),
        &rrexif_sidecar_path(destination_path),
    )
}

fn virtual_path_for_copy(source_path: &Path, copy_id: Option<&str>) -> (String, bool) {
    let virtual_image_path = VirtualImagePath {
        source_path: source_path.to_path_buf(),
        copy_id: copy_id.map(str::to_string),
    };
    (virtual_image_path.to_serialized(), copy_id.is_some())
}

fn expand_image_file_rows(
    path_buf: PathBuf,
    sidecars: Vec<Option<String>>,
    settings: &AppSettings,
    enable_xmp_sync: bool,
) -> Vec<ImageFile> {
    let path_str = path_buf.to_string_lossy().into_owned();
    let modified = fs::metadata(&path_buf)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut file_results = Vec::with_capacity(sidecars.len());

    for copy_id_opt in sidecars {
        let (virtual_path, is_virtual_copy) =
            virtual_path_for_copy(&path_buf, copy_id_opt.as_deref());
        let sidecar_path = rrdata_sidecar_path(&path_buf, copy_id_opt.as_deref());

        let (is_edited, tags, rating) = {
            let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

            if enable_xmp_sync && sync_metadata_from_xmp(&path_buf, &mut metadata) {
                save_metadata_sidecar_or_warn(&sidecar_path, &metadata, "XMP import");
            }

            let is_raw = crate::formats::is_raw_file(&path_str);
            let tm_override =
                crate::image_processing::resolve_tonemapper_override(settings, is_raw);
            let edited = crate::image_processing::is_image_edited(
                &metadata.adjustments,
                is_raw,
                tm_override,
            );
            (edited, metadata.tags, metadata.rating)
        };

        file_results.push(ImageFile {
            path: virtual_path,
            modified,
            is_edited,
            tags,
            exif: None,
            is_virtual_copy,
            rating,
        });
    }

    file_results
}

pub fn parse_virtual_path(virtual_path: &str) -> (PathBuf, PathBuf) {
    let virtual_image_path = VirtualImagePath::parse(virtual_path);
    (
        virtual_image_path.source_path().to_path_buf(),
        virtual_image_path.sidecar_path(),
    )
}

#[tauri::command]
pub async fn read_exif_for_paths(
    paths: Vec<String>,
) -> Result<HashMap<String, HashMap<String, String>>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(read_exif_for_paths_blocking(paths)))
        .await
        .unwrap_or_else(|e| Err(format!("Task failed: {}", e)))
}

#[tauri::command]
pub async fn read_library_relink_identity(path: String) -> Result<LibraryRelinkIdentity, String> {
    tauri::async_runtime::spawn_blocking(move || read_library_relink_identity_blocking(path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn update_exif_fields(
    paths: Vec<String>,
    updates: HashMap<String, String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || update_exif_fields_blocking(paths, updates))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn update_exif_fields_blocking(
    paths: Vec<String>,
    updates: HashMap<String, String>,
) -> Result<(), String> {
    paths
        .par_iter()
        .map(|path| -> Result<(), String> {
            let original_path = Path::new(&path);
            let primary_path = crate::exif_processing::get_primary_sidecar_path(original_path);
            let temp_metadata = crate::exif_processing::load_sidecar(&primary_path);

            let mut exif_data = temp_metadata.exif.unwrap_or_else(|| {
                if let Some(existing) = crate::exif_processing::read_rrexif_sidecar(original_path) {
                    existing
                } else if let Ok(mmap) = read_file_mapped(original_path) {
                    crate::exif_processing::read_exif_data_from_bytes(path, &mmap)
                } else if let Ok(bytes) = fs::read(original_path) {
                    crate::exif_processing::read_exif_data_from_bytes(path, &bytes)
                } else {
                    HashMap::new()
                }
            });

            for (k, v) in &updates {
                let trimmed = v.trim();
                if trimmed.is_empty() {
                    exif_data.remove(k);
                } else {
                    exif_data.insert(k.clone(), trimmed.to_string());
                }
            }

            let mut final_metadata = crate::exif_processing::load_sidecar(&primary_path);

            final_metadata.exif = Some(exif_data);
            save_metadata_sidecar(&primary_path, &final_metadata)
                .map_err(|e| format!("{}: {}", path, e))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|_| ())
}

#[tauri::command]
pub fn list_images_in_dir(path: String, app_handle: AppHandle) -> Result<Vec<ImageFile>, String> {
    let settings = load_settings_or_default(&app_handle);
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut images = Vec::new();
    let mut sidecars_by_filename: HashMap<String, Vec<Option<String>>> = HashMap::new();

    for entry in entries.filter_map(Result::ok) {
        let entry_path = entry.path();
        let file_name = entry
            .file_name()
            .into_string()
            .unwrap_or_else(|os| os.to_string_lossy().into_owned());

        if let Some((source_filename, copy_id)) = split_rrdata_sidecar_filename(&file_name) {
            sidecars_by_filename
                .entry(source_filename)
                .or_default()
                .push(copy_id);
        } else if is_supported_image_file(&file_name) {
            images.push((file_name, entry_path));
        }
    }

    let tasks: Vec<_> = images
        .into_iter()
        .map(|(file_name, path_buf)| {
            let sidecars = sidecars_by_filename
                .remove(&file_name)
                .unwrap_or_else(|| vec![None]);
            (path_buf, sidecars)
        })
        .collect();

    let result_list: Vec<ImageFile> = tasks
        .into_par_iter()
        .flat_map(|(path_buf, sidecars)| {
            expand_image_file_rows(path_buf, sidecars, &settings, enable_xmp_sync)
        })
        .collect();

    Ok(result_list)
}

#[tauri::command]
pub fn list_images_recursive(
    path: String,
    app_handle: AppHandle,
) -> Result<Vec<ImageFile>, String> {
    let settings = load_settings_or_default(&app_handle);
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let root_path = Path::new(&path);
    let mut images = Vec::new();

    let mut sidecars_by_path: HashMap<PathBuf, Vec<Option<String>>> = HashMap::new();

    for entry in WalkDir::new(root_path).into_iter().filter_map(Result::ok) {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }

        let file_name = entry_path.file_name().unwrap_or_default().to_string_lossy();
        if let Some((source_filename, copy_id)) = split_rrdata_sidecar_filename(&file_name) {
            if let Some(parent) = entry_path.parent() {
                sidecars_by_path
                    .entry(parent.join(source_filename))
                    .or_default()
                    .push(copy_id);
            }
        } else if is_supported_image_file(entry_path.to_string_lossy().as_ref()) {
            images.push(entry_path.to_path_buf());
        }
    }

    let tasks: Vec<_> = images
        .into_iter()
        .map(|path_buf| {
            let sidecars = sidecars_by_path
                .remove(&path_buf)
                .unwrap_or_else(|| vec![None]);
            (path_buf, sidecars)
        })
        .collect();

    let result_list: Vec<ImageFile> = tasks
        .into_par_iter()
        .flat_map(|(path_buf, sidecars)| {
            expand_image_file_rows(path_buf, sidecars, &settings, enable_xmp_sync)
        })
        .collect();

    Ok(result_list)
}

#[tauri::command]
pub fn get_album_images(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<Vec<ImageFile>, String> {
    let settings = load_settings_or_default(&app_handle);
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let result_list: Vec<ImageFile> = paths
        .into_par_iter()
        .filter_map(|virtual_path| {
            let (source_path, sidecar_path) = parse_virtual_path(&virtual_path);
            if !source_path.exists() {
                return None;
            }

            let modified = fs::metadata(&source_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let is_virtual_copy = virtual_path.contains("?vc=");

            let (is_edited, tags, rating) = {
                let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

                if enable_xmp_sync && sync_metadata_from_xmp(&source_path, &mut metadata) {
                    save_metadata_sidecar_or_warn(&sidecar_path, &metadata, "XMP import");
                }

                let is_raw = crate::formats::is_raw_file(&source_path);
                let tm_override =
                    crate::image_processing::resolve_tonemapper_override(&settings, is_raw);
                let edited = crate::image_processing::is_image_edited(
                    &metadata.adjustments,
                    is_raw,
                    tm_override,
                );
                (edited, metadata.tags, metadata.rating)
            };

            Some(ImageFile {
                path: virtual_path,
                modified,
                is_edited,
                tags,
                exif: None,
                is_virtual_copy,
                rating,
            })
        })
        .collect();

    Ok(result_list)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub is_dir: bool,
    pub image_count: usize,
    pub has_subdirs: bool,
    pub modified: u64,
    pub created: u64,
}

fn has_subdirs(path: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.filter_map(Result::ok) {
            if let Ok(file_type) = entry.file_type()
                && file_type.is_dir()
            {
                let name = entry.file_name();
                if !name.to_string_lossy().starts_with('.') {
                    return true;
                }
            }
        }
    }
    false
}

fn scan_dir_lazy(
    path: &Path,
    expanded_folders: &HashSet<&str>,
    show_image_counts: bool,
    prefetch_one_level: bool,
) -> Result<(Vec<FolderNode>, usize), std::io::Error> {
    let mut children_folders = Vec::new();
    let mut current_dir_image_count = 0;

    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!("Could not scan directory '{}': {}", path.display(), e);
            return Ok((Vec::new(), 0));
        }
    };

    for entry in entries.filter_map(Result::ok) {
        let current_path = entry.path();
        let (file_type, modified, created) = match entry.metadata() {
            Ok(meta) => {
                let ft = meta.file_type();
                let mod_time = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                let cre_time = meta.created().unwrap_or(mod_time);

                (
                    ft,
                    mod_time
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    cre_time
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                )
            }
            Err(_) => continue,
        };

        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if file_type.is_dir() {
            let path_str = current_path.to_string_lossy().into_owned();
            let is_expanded = expanded_folders.contains(path_str.as_str());

            let should_scan = is_expanded || prefetch_one_level;
            let next_prefetch = is_expanded;

            let (grand_children, sub_dir_own_images) = if should_scan {
                scan_dir_lazy(
                    &current_path,
                    expanded_folders,
                    show_image_counts,
                    next_prefetch,
                )?
            } else {
                let count = if show_image_counts {
                    WalkDir::new(&current_path)
                        .into_iter()
                        .filter_map(Result::ok)
                        .filter(|e| {
                            e.file_type().is_file()
                                && crate::formats::is_supported_image_file(e.path())
                        })
                        .count()
                } else {
                    0
                };
                (Vec::new(), count)
            };

            let has_any_subdirs = if should_scan {
                grand_children.iter().any(|c| c.is_dir)
            } else {
                has_subdirs(&current_path)
            };

            let grand_children_sum: usize = grand_children.iter().map(|c| c.image_count).sum();
            let total_child_count = sub_dir_own_images + grand_children_sum;

            children_folders.push(FolderNode {
                name: name_str.into_owned(),
                path: path_str,
                children: grand_children,
                is_dir: true,
                image_count: total_child_count,
                has_subdirs: has_any_subdirs,
                modified,
                created,
            });
        } else if show_image_counts
            && file_type.is_file()
            && crate::formats::is_supported_image_file(&current_path)
        {
            current_dir_image_count += 1;
        }
    }

    children_folders.sort_by_key(|a| a.name.to_lowercase());

    Ok((children_folders, current_dir_image_count))
}

fn get_folder_tree_sync(
    path: String,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
) -> Result<FolderNode, String> {
    let root_path = Path::new(&path);
    if !root_path.is_dir() {
        return Err(format!("Directory does not exist: {}", path));
    }

    let (modified, created) = root_path
        .metadata()
        .map(|m| {
            let mod_time = m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let cre_time = m.created().unwrap_or(mod_time);
            (
                mod_time
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                cre_time
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            )
        })
        .unwrap_or((0, 0));

    let expanded_set: HashSet<&str> = expanded_folders.iter().map(|s| s.as_str()).collect();

    let (children, own_count) = scan_dir_lazy(root_path, &expanded_set, show_image_counts, true)
        .map_err(|e| e.to_string())?;

    let children_sum: usize = children.iter().map(|c| c.image_count).sum();
    let has_subdirs = children.iter().any(|c| c.is_dir);

    let name = match root_path.file_name() {
        Some(n) => n.to_string_lossy().into_owned(),
        None => {
            let trimmed = path.trim_end_matches(&['/', '\\'][..]);
            if trimmed.is_empty() {
                path.clone()
            } else {
                trimmed.to_string()
            }
        }
    };

    Ok(FolderNode {
        name,
        path: path.clone(),
        children,
        is_dir: true,
        image_count: own_count + children_sum,
        has_subdirs,
        modified,
        created,
    })
}

#[tauri::command]
pub async fn get_folder_children(
    path: String,
    show_image_counts: bool,
) -> Result<Vec<FolderNode>, String> {
    match tauri::async_runtime::spawn_blocking(move || {
        let root_path = Path::new(&path);
        if !root_path.is_dir() {
            return Err(format!("Directory does not exist: {}", path));
        }
        let empty_set = HashSet::new();
        let (children, _) = scan_dir_lazy(root_path, &empty_set, show_image_counts, false)
            .map_err(|e| e.to_string())?;

        Ok(children)
    })
    .await
    {
        Ok(Ok(children)) => Ok(children),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Task failed: {}", e)),
    }
}

#[tauri::command]
pub async fn get_folder_tree(
    path: String,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
) -> Result<FolderNode, String> {
    match tauri::async_runtime::spawn_blocking(move || {
        get_folder_tree_sync(path, expanded_folders, show_image_counts)
    })
    .await
    {
        Ok(Ok(folder_node)) => Ok(folder_node),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Failed to execute folder tree task: {}", e)),
    }
}

#[tauri::command]
pub async fn get_pinned_folder_trees(
    paths: Vec<String>,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
) -> Result<Vec<FolderNode>, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let results: Vec<Result<FolderNode, String>> = paths
            .par_iter()
            .map(|path| {
                get_folder_tree_sync(path.clone(), expanded_folders.clone(), show_image_counts)
            })
            .collect();

        let mut folder_nodes = Vec::new();
        for result in results {
            match result {
                Ok(node) => folder_nodes.push(node),
                Err(e) => log::warn!("Failed to get tree for pinned folder: {}", e),
            }
        }
        folder_nodes
    })
    .await;

    match result {
        Ok(nodes) => Ok(nodes),
        Err(e) => Err(format!("Task failed: {}", e)),
    }
}

pub fn read_file_mapped(path: &Path) -> Result<Mmap, ReadFileError> {
    if !path.is_file() {
        return Err(ReadFileError::Invalid);
    }
    if !path.exists() {
        return Err(ReadFileError::NotFound);
    }
    if path.metadata().map_err(ReadFileError::Io)?.len() == 0 {
        return Err(ReadFileError::Empty);
    }
    let file = fs::File::open(path).map_err(ReadFileError::Io)?;
    if file.try_lock_shared().is_err() {
        return Err(ReadFileError::Locked);
    }
    let mmap = unsafe {
        MmapOptions::new()
            .len(file.metadata().map_err(ReadFileError::Io)?.len() as usize)
            .map(&file)
            .map_err(ReadFileError::Io)?
    };
    Ok(mmap)
}

pub fn generate_thumbnail_data(
    path_str: &str,
    gpu_context: Option<&GpuContext>,
    preloaded_image: Option<&DynamicImage>,
    app_handle: &AppHandle,
) -> anyhow::Result<DynamicImage> {
    generate_thumbnail_data_with_target(path_str, gpu_context, preloaded_image, app_handle, None)
}

fn generate_thumbnail_data_with_target(
    path_str: &str,
    gpu_context: Option<&GpuContext>,
    preloaded_image: Option<&DynamicImage>,
    app_handle: &AppHandle,
    target_resolution: Option<u32>,
) -> anyhow::Result<DynamicImage> {
    let (source_path, sidecar_path) = parse_virtual_path(path_str);
    let source_path_str = source_path.to_string_lossy().to_string();
    let is_raw = is_raw_file(&source_path_str);

    let metadata: Option<ImageMetadata> = fs::read_to_string(sidecar_path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok());

    let adjustments = metadata
        .as_ref()
        .map_or(serde_json::Value::Null, |m| m.adjustments.clone());

    if let (Some(context), Some(meta)) = (gpu_context, metadata)
        && !meta.adjustments.is_null()
    {
        let state = app_handle.state::<AppState>();
        let settings = load_settings_or_default(app_handle);
        let target_res =
            target_resolution.unwrap_or_else(|| settings.thumbnail_resolution.unwrap_or(720));

        let geometry_hash = calculate_geometry_hash(&meta.adjustments);

        let crop_data: Option<Crop> = serde_json::from_value(meta.adjustments["crop"].clone()).ok();

        let cached_base: Option<(DynamicImage, f32)> = {
            let cache = state.thumbnail_geometry_cache.lock().unwrap();
            if let Some((cached_hash, img, scale)) = cache.get(path_str) {
                let mut sufficient_resolution = true;
                if let Some(c) = &crop_data
                    && c.width > 0.0
                    && c.height > 0.0
                {
                    let final_crop_max_dim =
                        (c.width as f32 * *scale).max(c.height as f32 * *scale);
                    if final_crop_max_dim < (target_res as f32 * 0.95) {
                        sufficient_resolution = false;
                    }
                }

                if *cached_hash == geometry_hash && sufficient_resolution {
                    Some((img.clone(), *scale))
                } else {
                    None
                }
            } else {
                None
            }
        };

        let (processing_base, total_scale) = if let Some(hit) = cached_base {
            hit
        } else {
            let settings = load_settings_or_default(app_handle);
            let mut raw_scale_factor = 1.0f32;

            let composite_image = if let Some(img) = preloaded_image {
                image_loader::composite_patches_on_image(img, &adjustments)?
            } else {
                let mmap_guard;
                let vec_guard;

                let file_slice: &[u8] = match read_file_mapped(&source_path) {
                    Ok(mmap) => {
                        mmap_guard = Some(mmap);
                        mmap_guard.as_ref().unwrap()
                    }
                    Err(e) => {
                        if preloaded_image.is_none() {
                            log::warn!("Fallback read for {}: {}", source_path_str, e);
                        }
                        let bytes = fs::read(&source_path).map_err(|io_err| {
                            anyhow::anyhow!(
                                "Fallback read failed for {}: {}",
                                source_path_str,
                                io_err
                            )
                        })?;
                        vec_guard = Some(bytes);
                        vec_guard.as_ref().unwrap()
                    }
                };

                let img = image_loader::load_and_composite(
                    file_slice,
                    &source_path_str,
                    &adjustments,
                    true,
                    &settings,
                    None,
                )?;

                if is_raw {
                    raw_scale_factor = crate::raw_processing::get_fast_demosaic_scale_factor(
                        file_slice,
                        img.width(),
                        img.height(),
                    );
                }
                img
            };

            let warped_image =
                apply_geometry_warp(Cow::Borrowed(&composite_image), &meta.adjustments);
            let orientation_steps =
                meta.adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
            let coarse_rotated_image = apply_coarse_rotation(warped_image, orientation_steps);

            let (full_w, full_h) = coarse_rotated_image.dimensions();

            let mut processing_dim = target_res;
            if let Some(c) = &crop_data
                && c.width > 0.0
                && c.height > 0.0
            {
                let crop_max_dim_loaded = c.width.max(c.height) * raw_scale_factor as f64;
                let full_max_dim = full_w.max(full_h) as f64;
                if crop_max_dim_loaded > 0.0 {
                    processing_dim = ((target_res as f64 * full_max_dim / crop_max_dim_loaded)
                        .round() as u32)
                        .min(full_w.max(full_h));
                }
            }

            let (base, gpu_scale) = if full_w > processing_dim || full_h > processing_dim {
                let base = crate::image_processing::downscale_f32_image(
                    &coarse_rotated_image,
                    processing_dim,
                    processing_dim,
                );
                let scale = if full_w > 0 {
                    base.width() as f32 / full_w as f32
                } else {
                    1.0
                };
                (base, scale)
            } else {
                (coarse_rotated_image.into_owned(), 1.0)
            };

            let total_scale = gpu_scale * raw_scale_factor;

            let mut cache = state.thumbnail_geometry_cache.lock().unwrap();
            if cache.len() > 30 {
                cache.clear();
            }
            cache.insert(
                path_str.to_string(),
                (geometry_hash, base.clone(), total_scale),
            );

            (base, total_scale)
        };

        let rotation_degrees = meta.adjustments["rotation"].as_f64().unwrap_or(0.0) as f32;
        let flip_horizontal = meta.adjustments["flipHorizontal"]
            .as_bool()
            .unwrap_or(false);
        let flip_vertical = meta.adjustments["flipVertical"].as_bool().unwrap_or(false);

        let flipped_image = apply_flip(Cow::Owned(processing_base), flip_horizontal, flip_vertical);
        let rotated_image = apply_rotation(flipped_image, rotation_degrees);

        let scaled_crop_json = if let Some(c) = &crop_data {
            serde_json::to_value(Crop {
                x: c.x * total_scale as f64,
                y: c.y * total_scale as f64,
                width: c.width * total_scale as f64,
                height: c.height * total_scale as f64,
            })
            .unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };

        let cropped_preview = apply_crop(rotated_image, &scaled_crop_json);
        let (preview_w, preview_h) = cropped_preview.dimensions();
        let unscaled_crop_offset = crop_data.map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32));

        let mask_definitions: Vec<MaskDefinition> = meta
            .adjustments
            .get("masks")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_else(Vec::new);

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                crate::get_cached_or_generate_mask(
                    &state,
                    def,
                    preview_w,
                    preview_h,
                    total_scale,
                    (
                        unscaled_crop_offset.0 * total_scale,
                        unscaled_crop_offset.1 * total_scale,
                    ),
                    &meta.adjustments,
                )
            })
            .collect();

        let tm_override = crate::image_processing::resolve_tonemapper_override(&settings, is_raw);
        let gpu_adjustments = get_all_adjustments_from_json(&meta.adjustments, is_raw, tm_override);
        let lut_path = meta.adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| {
            let mut cache = state.lut_cache.lock().unwrap();
            if let Some(cached_lut) = cache.get(p) {
                return Some(cached_lut.clone());
            }
            if let Ok(loaded_lut) = crate::lut_processing::parse_lut_file(p) {
                let arc_lut = Arc::new(loaded_lut);
                cache.insert(p.to_string(), arc_lut.clone());
                return Some(arc_lut);
            }
            None
        });

        let mut hasher = DefaultHasher::new();
        path_str.hash(&mut hasher);
        meta.adjustments.to_string().hash(&mut hasher);
        let unique_hash = hasher.finish();

        if let Ok(processed_image) = gpu_processing::process_and_get_dynamic_image(
            context,
            &state,
            cropped_preview.as_ref(),
            unique_hash,
            gpu_processing::RenderRequest {
                adjustments: gpu_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
                roi: None,
            },
            "generate_thumbnail_data",
        ) {
            return Ok(processed_image);
        } else {
            return Ok(cropped_preview.into_owned());
        }
    }

    let settings = load_settings_or_default(app_handle);

    let mut final_image = if let Some(img) = preloaded_image {
        image_loader::composite_patches_on_image(img, &adjustments)?
    } else {
        match read_file_mapped(&source_path) {
            Ok(mmap) => image_loader::load_and_composite(
                &mmap,
                &source_path_str,
                &adjustments,
                true,
                &settings,
                None,
            )?,
            Err(e) => {
                log::warn!("Fallback read for {}: {}", source_path_str, e);
                let bytes = fs::read(&source_path)?;
                image_loader::load_and_composite(
                    &bytes,
                    &source_path_str,
                    &adjustments,
                    true,
                    &settings,
                    None,
                )?
            }
        }
    };

    if adjustments.is_null() {
        let default_tm = if is_raw {
            settings.default_raw_tonemapper.as_deref().unwrap_or("agx")
        } else {
            settings
                .default_non_raw_tonemapper
                .as_deref()
                .unwrap_or("basic")
        };
        if default_tm == "agx" {
            if !is_raw {
                final_image = crate::image_processing::apply_srgb_to_linear(final_image);
            }
            crate::image_processing::apply_cpu_agx_tonemap(&mut final_image);
        } else if is_raw {
            apply_cpu_default_raw_processing(&mut final_image);
        }
    }

    let fallback_orientation_steps = adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
    Ok(apply_coarse_rotation(Cow::Owned(final_image), fallback_orientation_steps).into_owned())
}

fn encode_thumbnail(image: &DynamicImage, target_width: u32) -> Result<(Vec<u8>, u32, u32)> {
    let thumbnail = crate::image_processing::downscale_f32_image(image, target_width, target_width);
    let (width, height) = thumbnail.dimensions();
    let mut buf = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, 75);
    encoder.encode_image(&thumbnail.to_rgb8())?;
    Ok((buf.into_inner(), width, height))
}

fn generate_single_thumbnail_and_cache(
    path_str: &str,
    thumb_cache_dir: &Path,
    gpu_context: Option<&GpuContext>,
    preloaded_image: Option<&DynamicImage>,
    force_regenerate: bool,
    app_handle: &AppHandle,
    settings: &AppSettings,
) -> Option<ThumbnailResult> {
    let (_, sidecar_path) = parse_virtual_path(path_str);

    let (rating, is_edited, adjustments_bytes) =
        if let Ok(content) = fs::read_to_string(&sidecar_path) {
            if let Ok(meta) = serde_json::from_str::<ImageMetadata>(&content) {
                let is_raw = crate::formats::is_raw_file(path_str);
                let tm = crate::image_processing::resolve_tonemapper_override(settings, is_raw);

                (
                    meta.rating,
                    crate::image_processing::is_image_edited(&meta.adjustments, is_raw, tm),
                    serde_json::to_vec(&meta.adjustments).unwrap_or_default(),
                )
            } else {
                (0, false, Vec::new())
            }
        } else {
            (0, false, Vec::new())
        };

    let smart_preview_dir = resolve_smart_preview_cache_dir(app_handle).ok();
    let cache_hash = compute_thumbnail_cache_hash(path_str, &adjustments_bytes);

    if !force_regenerate
        && cache_hash.is_none()
        && let Some(smart_preview_dir) = smart_preview_dir.as_deref()
        && let Some((data_url, smart_preview)) =
            read_smart_preview_artifact(smart_preview_dir, path_str)
    {
        return Some(ThumbnailResult {
            data_url,
            rating,
            is_edited,
            smart_preview: Some(smart_preview),
        });
    }

    let cache_hash = cache_hash?;

    let cache_filename = format!("{}.jpg", cache_hash);
    let cache_path = thumb_cache_dir.join(cache_filename);

    if !force_regenerate
        && cache_path.exists()
        && let Ok(data) = fs::read(&cache_path)
    {
        let smart_preview = smart_preview_dir.as_deref().and_then(|dir| {
            if let Some((_, existing)) = read_smart_preview_artifact(dir, path_str) {
                Some(existing)
            } else {
                generate_and_write_smart_preview_artifact(
                    dir,
                    path_str,
                    gpu_context,
                    preloaded_image,
                    app_handle,
                    &adjustments_bytes,
                )
            }
        });
        let base64_str = general_purpose::STANDARD.encode(&data);
        return Some(ThumbnailResult {
            data_url: jpeg_data_url(base64_str),
            rating,
            is_edited,
            smart_preview,
        });
    }

    let target_width = settings.thumbnail_resolution.unwrap_or(720);

    if let Ok(thumb_image) =
        generate_thumbnail_data(path_str, gpu_context, preloaded_image, app_handle)
        && let Ok((thumb_data, width, height)) = encode_thumbnail(&thumb_image, target_width)
    {
        let _ = fs::write(&cache_path, &thumb_data);
        let smart_preview = smart_preview_dir
            .as_deref()
            .and_then(|dir| {
                generate_and_write_smart_preview_artifact(
                    dir,
                    path_str,
                    gpu_context,
                    preloaded_image,
                    app_handle,
                    &adjustments_bytes,
                )
            })
            .or_else(|| {
                smart_preview_dir.as_deref().and_then(|dir| {
                    write_smart_preview_artifact(
                        dir,
                        path_str,
                        &thumb_data,
                        width,
                        height,
                        &adjustments_bytes,
                    )
                })
            });
        let base64_str = general_purpose::STANDARD.encode(&thumb_data);
        return Some(ThumbnailResult {
            data_url: jpeg_data_url(base64_str),
            rating,
            is_edited,
            smart_preview,
        });
    }
    None
}

fn emit_thumbnail_result(app_handle: &AppHandle, path: &str, thumbnail: ThumbnailResult) {
    let _ = app_handle.emit(
        "thumbnail-generated",
        serde_json::json!({
            "path": path,
            "data": thumbnail.data_url,
            "rating": thumbnail.rating,
            "is_edited": thumbnail.is_edited,
            "smartPreview": thumbnail.smart_preview
        }),
    );
}

pub fn start_thumbnail_workers(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<crate::AppState>();
    let manager = state.thumbnail_manager.clone();
    let settings = load_settings_or_default(&app_handle);
    let thread_count = settings.thumbnail_worker_threads.unwrap_or(4).clamp(1, 16);

    for _ in 0..thread_count {
        let app_clone = app_handle.clone();
        let manager_clone = manager.clone();
        let worker_settings = settings.clone();

        std::thread::spawn(move || {
            loop {
                let path_to_process: String = {
                    let mut queue = manager_clone.queue.lock().unwrap();
                    while queue.is_empty() {
                        queue = manager_clone.cvar.wait(queue).unwrap();
                    }
                    let path = queue.pop_back().unwrap();

                    let mut processing = manager_clone.processing_now.lock().unwrap();
                    if processing.contains(&path) {
                        let state = app_clone.state::<crate::AppState>();
                        increment_thumbnail_progress(&state, &app_clone);
                        continue;
                    }
                    processing.insert(path.clone());
                    path
                };

                let state = app_clone.state::<crate::AppState>();
                let gpu_context =
                    crate::gpu_processing::get_or_init_gpu_context(&state, &app_clone).ok();

                if let Ok(cache_dir) = get_thumb_cache_dir(&app_clone) {
                    let result = generate_single_thumbnail_and_cache(
                        &path_to_process,
                        &cache_dir,
                        gpu_context.as_ref(),
                        None,
                        false,
                        &app_clone,
                        &worker_settings,
                    );

                    if let Some(thumbnail) = result {
                        emit_thumbnail_result(&app_clone, &path_to_process, thumbnail);
                    }
                    increment_thumbnail_progress(&state, &app_clone);
                }
                manager_clone
                    .processing_now
                    .lock()
                    .unwrap()
                    .remove(&path_to_process);
            }
        });
    }
}

#[tauri::command]
pub fn update_thumbnail_queue(
    paths: Vec<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<crate::AppState>();

    let mut queue = state.thumbnail_manager.queue.lock().unwrap();

    if paths.is_empty() {
        queue.clear();
        let mut tracker = state.thumbnail_progress.lock().unwrap();
        tracker.total = 0;
        tracker.completed = 0;
        drop(tracker);

        let _ = app_handle.emit(
            crate::events::THUMBNAIL_PROGRESS,
            serde_json::json!({ "current": 0, "total": 0 }),
        );
        state.thumbnail_manager.cvar.notify_all();
        return Ok(());
    }

    let mut unique_paths = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for path in paths {
        if seen.insert(path.clone()) {
            unique_paths.push(path);
        }
    }

    queue.retain(|p| !seen.contains(p));

    while queue.len() + unique_paths.len() > 500 {
        queue.pop_front();
    }

    for path in unique_paths {
        queue.push_back(path);
    }

    let queue_len = queue.len();
    drop(queue);

    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.total = tracker.completed + queue_len;

    let current = tracker.completed;
    let total = tracker.total;
    drop(tracker);

    let _ = app_handle.emit(
        crate::events::THUMBNAIL_PROGRESS,
        serde_json::json!({ "current": current, "total": total }),
    );

    state.thumbnail_manager.cvar.notify_all();
    Ok(())
}

pub fn add_to_thumbnail_queue(state: &AppState, count: usize, app_handle: &AppHandle) {
    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.total += count;
    let current = tracker.completed;
    let total = tracker.total;
    drop(tracker);

    let _ = app_handle.emit(
        crate::events::THUMBNAIL_PROGRESS,
        serde_json::json!({ "current": current, "total": total }),
    );
}

pub fn increment_thumbnail_progress(state: &AppState, app_handle: &AppHandle) {
    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.completed += 1;
    let current = tracker.completed;
    let total = tracker.total;

    if current >= total {
        tracker.total = 0;
        tracker.completed = 0;
        drop(tracker);

        let _ = app_handle.emit(
            crate::events::THUMBNAIL_PROGRESS,
            serde_json::json!({ "current": 0, "total": 0 }),
        );
        let _ = app_handle.emit(crate::events::THUMBNAIL_GENERATION_COMPLETE, true);
    } else {
        drop(tracker);
        let _ = app_handle.emit(
            crate::events::THUMBNAIL_PROGRESS,
            serde_json::json!({ "current": current, "total": total }),
        );
    }
}

pub fn resolve_lens_params_in_adjustments(
    adjustments: &mut Value,
    exif_data: &Option<HashMap<String, String>>,
    lens_db: Option<&crate::lens_correction::LensDatabase>,
) {
    if let Some(map) = adjustments.as_object_mut() {
        let mode = map
            .get("lensCorrectionMode")
            .and_then(|v| v.as_str())
            .unwrap_or("manual");

        if mode == "auto" {
            if let Some(exif) = exif_data {
                let exif_maker = exif.get("Make").map(|s| s.as_str()).unwrap_or("");
                let exif_model = exif.get("LensModel").map(|s| s.as_str()).unwrap_or("");
                if let Some(db) = lens_db {
                    if let Some((detected_maker, detected_model)) =
                        crate::lens_correction::find_best_lens_match(db, exif_maker, exif_model)
                    {
                        map.insert(
                            "lensMaker".to_string(),
                            serde_json::to_value(&detected_maker).unwrap(),
                        );
                        map.insert(
                            "lensModel".to_string(),
                            serde_json::to_value(&detected_model).unwrap(),
                        );
                    } else {
                        map.remove("lensMaker");
                        map.remove("lensModel");
                    }
                }
            } else {
                map.remove("lensMaker");
                map.remove("lensModel");
            }
        }

        if let Some(db) = lens_db {
            let has_valid_lens = match (
                map.get("lensMaker").and_then(|v| v.as_str()),
                map.get("lensModel").and_then(|v| v.as_str()),
            ) {
                (Some(maker), Some(model)) if !maker.is_empty() && !model.is_empty() => {
                    let mut focal_length = 50.0;
                    let mut aperture = None;
                    let mut distance = None;

                    if let Some(exif) = exif_data {
                        if let Some(fl_str) = exif
                            .get("FocalLength")
                            .or(exif.get("FocalLengthIn35mmFilm"))
                            && let Ok(fl) = fl_str.replace(" mm", "").trim().parse::<f32>()
                        {
                            focal_length = fl;
                        }
                        if let Some(ap_str) = exif.get("ApertureValue").or(exif.get("FNumber"))
                            && let Ok(ap) = ap_str.replace("f/", "").trim().parse::<f32>()
                        {
                            aperture = Some(ap);
                        }
                        if let Some(dist_str) = exif.get("SubjectDistance")
                            && let Ok(dist) = dist_str.replace(" m", "").trim().parse::<f32>()
                        {
                            distance = Some(dist);
                        }
                    }

                    if let Some(params) = crate::lens_correction::resolve_lens_params(
                        db,
                        maker,
                        model,
                        focal_length,
                        aperture,
                        distance,
                    ) {
                        map.insert(
                            "lensDistortionParams".to_string(),
                            serde_json::to_value(params).unwrap(),
                        );
                        true
                    } else {
                        false
                    }
                }
                _ => false,
            };

            if !has_valid_lens {
                map.remove("lensDistortionParams");
            }
        }
    }
}

#[tauri::command]
pub fn get_supported_file_types() -> Result<serde_json::Value, String> {
    let raw_extensions: Vec<&str> = crate::formats::RAW_EXTENSIONS
        .iter()
        .map(|(ext, _)| *ext)
        .collect();
    let non_raw_extensions: Vec<&str> = crate::formats::NON_RAW_EXTENSIONS.to_vec();

    Ok(serde_json::json!({
        "raw": raw_extensions,
        "nonRaw": non_raw_extensions
    }))
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if let (Some(parent), Some(new_folder_name_os)) = (path_obj.parent(), path_obj.file_name())
        && let Some(new_folder_name) = new_folder_name_os.to_str()
        && parent.exists()
    {
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry
                && entry.file_name().to_string_lossy().to_lowercase()
                    == new_folder_name.to_lowercase()
            {
                return Err("A folder with that name already exists.".to_string());
            }
        }
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(path: String, new_name: String, app_handle: AppHandle) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err("Path is not a directory.".to_string());
    }
    if let Some(parent) = p.parent() {
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry
                && entry.file_name().to_string_lossy().to_lowercase() == new_name.to_lowercase()
                && entry.path() != p
            {
                return Err("A folder with that name already exists.".to_string());
            }
        }
        let new_path = parent.join(&new_name);
        fs::rename(p, &new_path).map_err(|e| e.to_string())?;

        let new_folder_str = new_path.to_string_lossy().into_owned();
        sync_album_path_changes(&app_handle, None, None, Some((&path, &new_folder_str)));

        Ok(())
    } else {
        Err("Could not determine parent directory.".to_string())
    }
}

#[tauri::command]
pub fn delete_folder(path: String, app_handle: AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        if let Err(trash_error) = trash::delete(&path) {
            log::warn!(
                "Failed to move folder to trash: {}. Falling back to permanent delete.",
                trash_error
            );
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }

    let mut deletions = HashSet::new();
    deletions.insert(path);
    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

#[tauri::command]
pub fn duplicate_file(
    path: String,
    target_album_id: Option<String>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, source_sidecar_path) = parse_virtual_path(&path);
    if !source_path.is_file() {
        return Err("Source path is not a file.".to_string());
    }

    let parent = source_path
        .parent()
        .ok_or("Could not get parent directory")?;
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Could not get file stem")?;
    let extension = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let mut counter = 1;
    let mut dest_path;
    loop {
        let new_stem = if counter == 1 {
            format!("{}_copy", stem)
        } else {
            format!("{}_copy_{}", stem, counter - 1)
        };
        dest_path = parent.join(format!("{}.{}", new_stem, extension));
        if !dest_path.exists() {
            break;
        }
        counter += 1;
    }

    fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;

    copy_primary_sidecars(&source_path, &source_sidecar_path, &dest_path)?;

    let dest_path_str = dest_path.to_string_lossy().into_owned();

    if let Some(album_id) = target_album_id {
        let _ = add_to_album(album_id, vec![dest_path_str.clone()], app_handle);
    }

    Ok(dest_path_str)
}

fn find_all_associated_files(source_image_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut associated_files = vec![source_image_path.to_path_buf()];

    let rrexif_path = rrexif_sidecar_path(source_image_path);

    if rrexif_path.exists() {
        associated_files.push(rrexif_path);
    }

    let parent_dir = source_image_path
        .parent()
        .ok_or("Could not determine parent directory")?;
    let source_filename = source_image_path
        .file_name()
        .ok_or("Could not get source filename")?
        .to_string_lossy();

    let primary_sidecar_name = rrdata_sidecar_filename(source_image_path, None);
    let virtual_copy_prefix = format!("{}.", source_filename);

    if let Ok(entries) = fs::read_dir(parent_dir) {
        for entry in entries.filter_map(Result::ok) {
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }

            let entry_os_filename = entry.file_name();
            let entry_filename = entry_os_filename.to_string_lossy();

            if entry_filename == primary_sidecar_name
                || (entry_filename.starts_with(&virtual_copy_prefix)
                    && entry_filename.ends_with(".rrdata"))
            {
                associated_files.push(entry_path);
            }
        }
    }

    Ok(associated_files)
}

#[tauri::command]
pub fn copy_files(source_paths: Vec<String>, destination_folder: String) -> Result<(), String> {
    let dest_path = Path::new(&destination_folder);
    if !dest_path.is_dir() {
        return Err(format!(
            "Destination is not a folder: {}",
            destination_folder
        ));
    }

    let unique_source_images: HashSet<PathBuf> = source_paths
        .iter()
        .map(|p| parse_virtual_path(p).0)
        .collect();

    for source_image_path in unique_source_images {
        let all_files_to_copy = find_all_associated_files(&source_image_path)?;

        let source_parent = source_image_path
            .parent()
            .ok_or("Could not get parent directory")?;
        if source_parent == dest_path {
            let stem = source_image_path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("Could not get file stem")?;
            let extension = source_image_path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("");

            let mut counter = 1;
            let new_base_path = loop {
                let new_stem = format!("{}_copy_{}", stem, counter);
                let temp_path = source_parent.join(format!("{}.{}", new_stem, extension));
                if !temp_path.exists() {
                    break temp_path;
                }
                counter += 1;
            };
            let new_filename = new_base_path.file_name().unwrap().to_string_lossy();

            for original_file in all_files_to_copy {
                let original_full_filename = original_file.file_name().unwrap().to_string_lossy();
                let source_base_filename = source_image_path.file_name().unwrap().to_string_lossy();
                let new_dest_filename =
                    original_full_filename.replacen(&*source_base_filename, &new_filename, 1);
                let final_dest_path = dest_path.join(new_dest_filename);

                fs::copy(&original_file, &final_dest_path).map_err(|e| e.to_string())?;
            }
        } else {
            for file_to_copy in all_files_to_copy {
                if let Some(file_name) = file_to_copy.file_name() {
                    let dest_file_path = dest_path.join(file_name);
                    fs::copy(&file_to_copy, &dest_file_path).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn move_files(
    source_paths: Vec<String>,
    destination_folder: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    let dest_path = Path::new(&destination_folder);
    if !dest_path.is_dir() {
        return Err(format!(
            "Destination is not a folder: {}",
            destination_folder
        ));
    }

    let mut seen_source_images = HashSet::new();
    let mut unique_source_images = Vec::new();
    for source_path in &source_paths {
        let source_image_path = parse_virtual_path(source_path).0;
        if seen_source_images.insert(source_image_path.clone()) {
            unique_source_images.push(source_image_path);
        }
    }

    let mut destination_paths = HashSet::new();
    let mut move_plan: Vec<Vec<PathBuf>> = Vec::with_capacity(unique_source_images.len());
    let mut renames = HashMap::new();

    for source_image_path in unique_source_images {
        let source_parent = source_image_path
            .parent()
            .ok_or("Could not get parent directory")?;
        if source_parent == dest_path {
            return Err("Cannot move files into the same folder they are already in.".to_string());
        }

        let files_to_move = find_all_associated_files(&source_image_path)?;

        for file_to_move in &files_to_move {
            if let Some(file_name) = file_to_move.file_name() {
                let dest_file_path = dest_path.join(file_name);
                if !destination_paths.insert(dest_file_path.clone()) {
                    return Err(format!(
                        "Multiple files would be moved to {}.",
                        dest_file_path.display()
                    ));
                }
                if dest_file_path.exists() {
                    return Err(format!(
                        "File already exists at destination: {}",
                        dest_file_path.display()
                    ));
                }
            }
        }

        let dest_image_path = dest_path.join(source_image_path.file_name().unwrap());
        renames.insert(
            source_image_path.to_string_lossy().into_owned(),
            dest_image_path.to_string_lossy().into_owned(),
        );

        move_plan.push(files_to_move);
    }

    let mut copied_destinations = Vec::new();
    let mut all_files_to_trash = Vec::new();

    for files_to_move in &move_plan {
        for file_to_move in files_to_move {
            if let Some(file_name) = file_to_move.file_name() {
                let dest_file_path = dest_path.join(file_name);
                if let Err(err) = fs::copy(file_to_move, &dest_file_path) {
                    rollback_copied_files(&copied_destinations);
                    return Err(format!(
                        "Failed to copy {} to {}: {}. Completed copies were rolled back.",
                        file_to_move.display(),
                        dest_file_path.display(),
                        err
                    ));
                }
                copied_destinations.push(dest_file_path);
            }
        }

        all_files_to_trash.extend(files_to_move.iter().cloned());
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if !all_files_to_trash.is_empty()
        && let Err(trash_error) = trash::delete_all(&all_files_to_trash)
    {
        log::warn!(
            "Failed to move source files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in all_files_to_trash {
            if path.is_file()
                && let Err(err) = fs::remove_file(&path)
            {
                rollback_copied_files(&copied_destinations);
                return Err(format!(
                    "Failed to delete source file {}: {}. Completed copies were rolled back.",
                    path.display(),
                    err
                ));
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in all_files_to_trash {
        if path.is_file()
            && let Err(err) = fs::remove_file(&path)
        {
            rollback_copied_files(&copied_destinations);
            return Err(format!(
                "Failed to delete source file {}: {}. Completed copies were rolled back.",
                path.display(),
                err
            ));
        }
    }

    sync_album_path_changes(&app_handle, Some(&renames), None, None);

    Ok(())
}

fn rollback_copied_files(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        if let Err(err) = fs::remove_file(path)
            && path.exists()
        {
            log::error!(
                "Failed to roll back copied file {}: {}",
                path.display(),
                err
            );
        }
    }
}

#[tauri::command]
pub fn save_metadata_and_update_thumbnail(
    path: String,
    adjustments: Value,
    app_handle: AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let (source_path, sidecar_path) = parse_virtual_path(&path);

    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

    let mut final_adjustments = adjustments;
    {
        let lens_db_guard = state.lens_db.lock().unwrap();
        resolve_lens_params_in_adjustments(
            &mut final_adjustments,
            &metadata.exif,
            lens_db_guard.as_deref(),
        );
    }

    metadata.adjustments = final_adjustments;

    save_metadata_sidecar(&sidecar_path, &metadata)?;

    if let Ok(settings) = load_settings(app_handle.clone())
        && settings.enable_xmp_sync.unwrap_or(false)
    {
        let create_if_missing = settings.create_xmp_if_missing.unwrap_or(false);
        sync_metadata_to_xmp(&source_path, &metadata, create_if_missing);
    }

    let loaded_image_lock = state.original_image.lock().unwrap();
    let preloaded_image_option = if let Some(loaded_image) = loaded_image_lock.as_ref() {
        if loaded_image.path == path {
            Some(loaded_image.image.clone())
        } else {
            None
        }
    } else {
        None
    };
    drop(loaded_image_lock);

    let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();
    let app_handle_clone = app_handle.clone();
    let path_clone = path;

    add_to_thumbnail_queue(&state, 1, &app_handle);

    thread::spawn(move || {
        let state = app_handle_clone.state::<AppState>();
        let settings = load_settings_or_default(&app_handle_clone);

        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle_clone) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!(
                    "Unable to initialize thumbnail cache directory for '{}': {}",
                    path_clone,
                    e
                );
                emit_thumbnail_cache_setup_error(&app_handle_clone, &path_clone, &e);
                increment_thumbnail_progress(&state, &app_handle_clone);
                return;
            }
        };

        let result = generate_single_thumbnail_and_cache(
            &path_clone,
            &thumb_cache_dir,
            gpu_context.as_ref(),
            preloaded_image_option.as_deref(),
            true,
            &app_handle_clone,
            &settings,
        );

        if let Some(thumbnail) = result {
            emit_thumbnail_result(&app_handle_clone, &path_clone, thumbnail);
        }

        increment_thumbnail_progress(&state, &app_handle_clone);
    });

    Ok(())
}

#[tauri::command]
pub async fn apply_adjustments_to_paths(
    paths: Vec<String>,
    adjustments: Value,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings_or_default(&app_handle);
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        let lens_db = app_handle
            .state::<AppState>()
            .lens_db
            .lock()
            .unwrap()
            .clone();

        paths.par_iter().for_each(|path| {
            let (_, sidecar_path) = parse_virtual_path(path);

            let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

            let mut new_adjustments = existing_metadata.adjustments;
            if new_adjustments.is_null() {
                new_adjustments = serde_json::json!({});
            }

            if let (Some(new_map), Some(pasted_map)) =
                (new_adjustments.as_object_mut(), adjustments.as_object())
            {
                for (k, v) in pasted_map {
                    new_map.insert(k.clone(), v.clone());
                }
            }

            resolve_lens_params_in_adjustments(
                &mut new_adjustments,
                &existing_metadata.exif,
                lens_db.as_deref(),
            );

            existing_metadata.adjustments = new_adjustments;

            if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                let _ = std::fs::write(&sidecar_path, json_string);
            }

            if enable_xmp_sync {
                let source_path = parse_virtual_path(path).0;
                sync_metadata_to_xmp(&source_path, &existing_metadata, create_xmp_if_missing);
            }
        });

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path_str| {
            let result = generate_single_thumbnail_and_cache(
                path_str,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                None,
                true,
                &app_handle,
                &settings,
            );

            if let Some(thumbnail) = result {
                emit_thumbnail_result(&app_handle, path_str, thumbnail);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn reset_adjustments_for_paths(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings_or_default(&app_handle);
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        paths.par_iter().for_each(|path| {
            let (_, sidecar_path) = parse_virtual_path(path);

            let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

            existing_metadata.adjustments = serde_json::json!({});

            if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                let _ = std::fs::write(&sidecar_path, json_string);
            }

            if enable_xmp_sync {
                let source_path = parse_virtual_path(path).0;
                sync_metadata_to_xmp(&source_path, &existing_metadata, create_xmp_if_missing);
            }
        });

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path_str| {
            let result = generate_single_thumbnail_and_cache(
                path_str,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                None,
                true,
                &app_handle,
                &settings,
            );

            if let Some(thumbnail) = result {
                emit_thumbnail_result(&app_handle, path_str, thumbnail);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn apply_auto_adjustments_to_paths(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings_or_default(&app_handle);
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path| {
            let loaded_image: Option<DynamicImage> = (|| -> Result<DynamicImage, String> {
                let (source_path, sidecar_path) = parse_virtual_path(path);
                let source_path_str = source_path.to_string_lossy().to_string();

                let file_bytes = fs::read(&source_path).map_err(|e| e.to_string())?;
                let image = image_loader::load_base_image_from_bytes(
                    &file_bytes,
                    &source_path_str,
                    true,
                    &settings,
                    None,
                )
                .map_err(|e| e.to_string())?;

                let auto_results = perform_auto_analysis(&image);
                let auto_adjustments_json = auto_results_to_json(&auto_results);

                let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

                if existing_metadata.adjustments.is_null() {
                    existing_metadata.adjustments = serde_json::json!({});
                }

                if let (Some(existing_map), Some(auto_map)) = (
                    existing_metadata.adjustments.as_object_mut(),
                    auto_adjustments_json.as_object(),
                ) {
                    for (k, v) in auto_map {
                        if k == "sectionVisibility" {
                            if let Some(existing_vis_val) = existing_map.get_mut(k) {
                                if let (Some(existing_vis), Some(auto_vis)) =
                                    (existing_vis_val.as_object_mut(), v.as_object())
                                {
                                    for (vis_k, vis_v) in auto_vis {
                                        existing_vis.insert(vis_k.clone(), vis_v.clone());
                                    }
                                }
                            } else {
                                existing_map.insert(k.clone(), v.clone());
                            }
                        } else {
                            existing_map.insert(k.clone(), v.clone());
                        }
                    }
                }

                if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                    let _ = std::fs::write(&sidecar_path, json_string);
                }

                if enable_xmp_sync {
                    sync_metadata_to_xmp(&source_path, &existing_metadata, create_xmp_if_missing);
                }
                Ok(image)
            })()
            .map_err(|e| eprintln!("Failed to apply auto adjustments to {}: {}", path, e))
            .ok();

            let result = generate_single_thumbnail_and_cache(
                path,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                loaded_image.as_ref(),
                true,
                &app_handle,
                &settings,
            );

            if let Some(thumbnail) = result {
                emit_thumbnail_result(&app_handle, path, thumbnail);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[tauri::command]
pub fn set_color_label_for_paths(
    paths: Vec<String>,
    color: Option<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let settings = load_settings_or_default(&app_handle);
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    paths.par_iter().for_each(|path| {
        let (_, sidecar_path) = parse_virtual_path(path);

        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

        let mut tags = metadata.tags.unwrap_or_default();
        tags.retain(|tag| !tag.starts_with(COLOR_TAG_PREFIX));

        if let Some(c) = &color
            && !c.is_empty()
        {
            tags.push(format!("{}{}", COLOR_TAG_PREFIX, c));
        }

        if tags.is_empty() {
            metadata.tags = None;
        } else {
            metadata.tags = Some(tags);
        }

        if let Ok(json_string) = serde_json::to_string_pretty(&metadata) {
            let _ = std::fs::write(&sidecar_path, json_string);
        }

        if enable_xmp_sync {
            let source_path = parse_virtual_path(path).0;
            sync_metadata_to_xmp(&source_path, &metadata, create_xmp_if_missing);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn set_rating_for_paths(
    paths: Vec<String>,
    rating: u8,
    app_handle: AppHandle,
) -> Result<(), String> {
    let settings = load_settings_or_default(&app_handle);
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    paths.par_iter().for_each(|path| {
        let (_, sidecar_path) = parse_virtual_path(path);

        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

        metadata.rating = rating;

        if let Ok(json_string) = serde_json::to_string_pretty(&metadata) {
            let _ = std::fs::write(&sidecar_path, json_string);
        }

        if enable_xmp_sync {
            let source_path = parse_virtual_path(path).0;
            sync_metadata_to_xmp(&source_path, &metadata, create_xmp_if_missing);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn load_metadata(path: String, app_handle: AppHandle) -> Result<ImageMetadata, String> {
    let settings = load_settings_or_default(&app_handle);
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let (source_path, sidecar_path) = parse_virtual_path(&path);
    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

    if enable_xmp_sync
        && sync_metadata_from_xmp(&source_path, &mut metadata)
        && let Ok(json) = serde_json::to_string_pretty(&metadata)
    {
        let _ = fs::write(&sidecar_path, json);
    }

    if crate::panorama_stitching::refresh_panorama_stale_artifacts(&mut metadata)
        && let Ok(json) = serde_json::to_string_pretty(&metadata)
    {
        let _ = fs::write(&sidecar_path, json);
    }

    Ok(metadata)
}

fn get_internal_library_root_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(not(target_os = "android"))]
    {
        let library_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("library");

        if !library_dir.exists() {
            fs::create_dir_all(&library_dir).map_err(|e| e.to_string())?;
        }
        Ok(library_dir)
    }
    #[cfg(target_os = "android")]
    {
        crate::android_integration::get_android_internal_library_root()
    }
}

#[tauri::command]
pub fn get_or_create_internal_library_root(app_handle: AppHandle) -> Result<String, String> {
    let library_root = get_internal_library_root_path(&app_handle)?;

    Ok(library_root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn clear_all_sidecars(root_path: String) -> Result<usize, String> {
    if !Path::new(&root_path).exists() {
        return Err(format!("Root path does not exist: {}", root_path));
    }

    let mut deleted_count = 0;
    let walker = WalkDir::new(root_path).into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file()
            && let Some(extension) = path.extension()
            && (extension == "rrdata" || extension == "rrexif")
        {
            if fs::remove_file(path).is_ok() {
                deleted_count += 1;
            } else {
                eprintln!("Failed to delete sidecar file: {:?}", path);
            }
        }
    }

    Ok(deleted_count)
}

#[tauri::command]
pub fn clear_thumbnail_cache(app_handle: AppHandle) -> Result<(), String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");

    if thumb_cache_dir.exists() {
        fs::remove_dir_all(&thumb_cache_dir)
            .map_err(|e| format!("Failed to remove thumbnail cache: {}", e))?;
    }

    fs::create_dir_all(&thumb_cache_dir)
        .map_err(|e| format!("Failed to recreate thumbnail cache directory: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn show_in_finder(path: String) -> Result<(), String> {
    let (source_path, _) = parse_virtual_path(&path);

    #[cfg(target_os = "windows")]
    {
        let source_path_str = source_path.to_string_lossy().to_string();
        Command::new("explorer")
            .args(["/select,", &source_path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let source_path_str = source_path.to_string_lossy().to_string();
        Command::new("open")
            .args(["-R", &source_path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = source_path.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            return Err("Could not get parent directory".into());
        }
    }

    #[cfg(target_os = "android")]
    {
        return Err("Show in File Manager is not natively supported via CLI on Android.".into());
    }

    #[cfg(target_os = "ios")]
    {
        return Err("Show in File Manager is not supported on iOS.".into());
    }

    Ok(())
}

#[tauri::command]
pub fn delete_files_from_disk(paths: Vec<String>, app_handle: AppHandle) -> Result<(), String> {
    let mut files_to_trash = HashSet::new();

    let mut deletions = HashSet::new();

    for path_str in paths {
        let (source_path, sidecar_path) = parse_virtual_path(&path_str);
        deletions.insert(path_str.clone());

        if path_str.contains("?vc=") {
            if sidecar_path.exists() {
                files_to_trash.insert(sidecar_path);
            }
        } else {
            if source_path.exists() {
                match find_all_associated_files(&source_path) {
                    Ok(associated_files) => {
                        for file in associated_files {
                            files_to_trash.insert(file);
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Could not find associated files for {}: {}",
                            source_path.display(),
                            e
                        );
                    }
                }
            }
        }
    }

    if files_to_trash.is_empty() {
        return Ok(());
    }

    let final_paths_to_delete: Vec<PathBuf> = files_to_trash.into_iter().collect();
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Err(trash_error) = trash::delete_all(&final_paths_to_delete) {
        log::warn!(
            "Failed to move files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in final_paths_to_delete {
            if path.is_file() {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
            } else if path.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|e| format!("Failed to delete directory {}: {}", path.display(), e))?;
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in final_paths_to_delete {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
        } else if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to delete directory {}: {}", path.display(), e))?;
        }
    }

    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

#[tauri::command]
pub fn delete_files_with_associated(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let mut stems_to_delete = HashSet::new();
    let mut parent_dirs = HashSet::new();
    let mut deletions = HashSet::new();

    for path_str in &paths {
        deletions.insert(path_str.clone());
        let (source_path, _) = parse_virtual_path(path_str);
        if let Some(file_name) = source_path.file_name().and_then(|s| s.to_str())
            && let Some(stem) = file_name.split('.').next()
        {
            stems_to_delete.insert(stem.to_string());
        }
        if let Some(parent) = source_path.parent() {
            parent_dirs.insert(parent.to_path_buf());
        }
    }

    if stems_to_delete.is_empty() {
        return Ok(());
    }

    let mut files_to_trash = HashSet::new();

    for parent_dir in parent_dirs {
        if let Ok(entries) = fs::read_dir(parent_dir) {
            for entry in entries.filter_map(Result::ok) {
                let entry_path = entry.path();
                if !entry_path.is_file() {
                    continue;
                }

                let entry_filename = entry.file_name();
                let entry_filename_str = entry_filename.to_string_lossy();

                if let Some(base_stem) = entry_filename_str.split('.').next()
                    && stems_to_delete.contains(base_stem)
                    && (is_supported_image_file(entry_filename_str.as_ref())
                        || entry_filename_str.ends_with(".rrdata")
                        || entry_filename_str.ends_with(".rrexif"))
                {
                    files_to_trash.insert(entry_path);
                }
            }
        }
    }

    if files_to_trash.is_empty() {
        return Ok(());
    }

    let final_paths_to_delete: Vec<PathBuf> = files_to_trash.into_iter().collect();
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Err(trash_error) = trash::delete_all(&final_paths_to_delete) {
        log::warn!(
            "Failed to move files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in final_paths_to_delete {
            if path.is_file() {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in final_paths_to_delete {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
        }
    }

    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

pub fn get_thumb_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");
    if !thumb_cache_dir.exists() {
        fs::create_dir_all(&thumb_cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(thumb_cache_dir)
}

pub fn get_cache_key_hash(path_str: &str) -> Option<String> {
    let (_, sidecar_path) = parse_virtual_path(path_str);

    let adjustments_bytes = if let Ok(content) = fs::read_to_string(&sidecar_path) {
        if let Ok(meta) = serde_json::from_str::<ImageMetadata>(&content) {
            serde_json::to_vec(&meta.adjustments).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    compute_thumbnail_cache_hash(path_str, &adjustments_bytes)
}

pub fn get_cached_or_generate_thumbnail_image(
    path_str: &str,
    app_handle: &AppHandle,
    gpu_context: Option<&GpuContext>,
) -> Result<DynamicImage> {
    let thumb_cache_dir = get_thumb_cache_dir(app_handle).map_err(|e| anyhow::anyhow!(e))?;
    let settings = load_settings_or_default(app_handle);
    let target_width = settings.thumbnail_resolution.unwrap_or(720);

    if let Some(cache_hash) = get_cache_key_hash(path_str) {
        let cache_filename = format!("{}.jpg", cache_hash);
        let cache_path = thumb_cache_dir.join(cache_filename);

        if cache_path.exists() {
            if let Ok(image) = image::open(&cache_path) {
                return Ok(image);
            }
            eprintln!(
                "Could not open cached thumbnail, regenerating: {:?}",
                cache_path
            );
        }

        let thumb_image = generate_thumbnail_data(path_str, gpu_context, None, app_handle)?;
        let (thumb_data, _, _) = encode_thumbnail(&thumb_image, target_width)?;
        fs::write(&cache_path, &thumb_data)?;

        Ok(thumb_image)
    } else {
        generate_thumbnail_data(path_str, gpu_context, None, app_handle)
    }
}

#[tauri::command]
pub async fn import_files(
    source_paths: Vec<String>,
    destination_folder: String,
    settings: ImportSettings,
    app_handle: AppHandle,
) -> Result<(), String> {
    let total_files = source_paths.len();
    let _ = app_handle.emit(
        crate::events::IMPORT_START,
        serde_json::json!({ "total": total_files }),
    );

    tauri::async_runtime::spawn_blocking(move || {
        for (i, source_path_str) in source_paths.iter().enumerate() {
            let _ = app_handle.emit(
                crate::events::IMPORT_PROGRESS,
                serde_json::json!({ "current": i, "total": total_files, "path": source_path_str }),
            );

            let import_result: Result<(), String> = (|| {
                #[cfg(target_os = "android")]
                if is_android_content_uri(source_path_str) {
                    let resolved_name = resolve_android_content_uri_name(source_path_str)?;
                    let source_bytes = read_android_content_uri(source_path_str)?;
                    let source_name_path = Path::new(&resolved_name);
                    let file_date = exif_processing::get_creation_date_from_bytes(
                        &resolved_name,
                        &source_bytes,
                    );

                    let mut final_dest_folder = PathBuf::from(&destination_folder);
                    if settings.organize_by_date {
                        let date_format_str = settings
                            .date_folder_format
                            .replace("YYYY", "%Y")
                            .replace("MM", "%m")
                            .replace("DD", "%d");
                        let subfolder = file_date.format(&date_format_str).to_string();
                        final_dest_folder.push(subfolder);
                    }

                    fs::create_dir_all(&final_dest_folder)
                        .map_err(|e| format!("Failed to create destination folder: {}", e))?;

                    let new_stem = generate_filename_from_template(
                        &settings.filename_template,
                        source_name_path,
                        i + 1,
                        total_files,
                        &file_date,
                    );
                    let extension = source_name_path
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    let new_filename = format!("{}.{}", new_stem, extension);
                    let dest_file_path = final_dest_folder.join(new_filename);

                    if dest_file_path.exists() {
                        return Err(format!(
                            "File already exists at destination: {}",
                            dest_file_path.display()
                        ));
                    }

                    fs::write(&dest_file_path, source_bytes).map_err(|e| e.to_string())?;

                    if settings.delete_after_import {
                        log::info!(
                            "Skipping delete_after_import for Android content URI source: {}",
                            source_path_str
                        );
                    }

                    return Ok(());
                }

                let (source_path, source_sidecar) = parse_virtual_path(source_path_str);
                if !source_path.exists() {
                    return Err(format!("Source file not found: {}", source_path_str));
                }

                let file_date = exif_processing::get_creation_date_from_path(&source_path);

                let mut final_dest_folder = PathBuf::from(&destination_folder);
                if settings.organize_by_date {
                    let date_format_str = settings
                        .date_folder_format
                        .replace("YYYY", "%Y")
                        .replace("MM", "%m")
                        .replace("DD", "%d");
                    let subfolder = file_date.format(&date_format_str).to_string();
                    final_dest_folder.push(subfolder);
                }

                fs::create_dir_all(&final_dest_folder)
                    .map_err(|e| format!("Failed to create destination folder: {}", e))?;

                let new_stem = generate_filename_from_template(
                    &settings.filename_template,
                    &source_path,
                    i + 1,
                    total_files,
                    &file_date,
                );
                let extension = source_path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let new_filename = format!("{}.{}", new_stem, extension);
                let dest_file_path = final_dest_folder.join(new_filename);

                if dest_file_path.exists() {
                    return Err(format!(
                        "File already exists at destination: {}",
                        dest_file_path.display()
                    ));
                }

                fs::copy(&source_path, &dest_file_path).map_err(|e| e.to_string())?;
                copy_primary_sidecars(&source_path, &source_sidecar, &dest_file_path)?;

                if settings.delete_after_import {
                    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
                    {
                        if let Err(trash_error) = trash::delete(&source_path) {
                            log::warn!(
                                "Failed to trash source file {}: {}. Deleting permanently.",
                                source_path.display(),
                                trash_error
                            );
                            fs::remove_file(&source_path).map_err(|e| e.to_string())?;
                        }
                        if source_sidecar.exists()
                            && let Err(trash_error) = trash::delete(&source_sidecar)
                        {
                            log::warn!(
                                "Failed to trash source sidecar {}: {}. Deleting permanently.",
                                source_sidecar.display(),
                                trash_error
                            );
                            fs::remove_file(&source_sidecar).map_err(|e| e.to_string())?;
                        }
                    }

                    #[cfg(not(any(
                        target_os = "windows",
                        target_os = "macos",
                        target_os = "linux"
                    )))]
                    {
                        fs::remove_file(&source_path).map_err(|e| e.to_string())?;
                        if source_sidecar.exists() {
                            fs::remove_file(&source_sidecar).map_err(|e| e.to_string())?;
                        }
                        let _ = fs::remove_file(rrexif_sidecar_path(&source_path));
                    }
                }

                Ok(())
            })();

            if let Err(e) = import_result {
                eprintln!("Failed to import {}: {}", source_path_str, e);
                let _ = app_handle.emit(crate::events::IMPORT_ERROR, e);
                return;
            }
        }

        let _ = app_handle.emit(
            crate::events::IMPORT_PROGRESS,
            serde_json::json!({ "current": total_files, "total": total_files, "path": "" }),
        );
        let _ = app_handle.emit(crate::events::IMPORT_COMPLETE, ());
    });

    Ok(())
}

pub fn generate_filename_from_template(
    template: &str,
    original_path: &std::path::Path,
    sequence: usize,
    total: usize,
    file_date: &DateTime<Utc>,
) -> String {
    let stem = original_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let sequence_str = format!(
        "{:0width$}",
        sequence,
        width = total.to_string().len().max(1)
    );
    let local_date = file_date.with_timezone(&chrono::Local);

    let mut result = template.to_string();
    result = result.replace("{original_filename}", stem);
    result = result.replace("{sequence}", &sequence_str);
    result = result.replace("{YYYY}", &local_date.format("%Y").to_string());
    result = result.replace("{MM}", &local_date.format("%m").to_string());
    result = result.replace("{DD}", &local_date.format("%d").to_string());
    result = result.replace("{hh}", &local_date.format("%H").to_string());
    result = result.replace("{mm}", &local_date.format("%M").to_string());

    result
}

#[tauri::command]
pub fn rename_files(
    paths: Vec<String>,
    name_template: String,
    app_handle: AppHandle,
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut primary_operations: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(paths.len());
    let mut final_new_paths = Vec::with_capacity(paths.len());
    let mut renames = HashMap::new();
    let mut source_paths = HashSet::new();
    let mut destination_paths = HashSet::new();

    for (i, path_str) in paths.iter().enumerate() {
        let (original_path, _) = parse_virtual_path(path_str);
        if !original_path.exists() {
            return Err(format!("File not found: {}", path_str));
        }
        if !source_paths.insert(original_path.clone()) {
            return Err(format!(
                "Duplicate source file in rename request: {}",
                original_path.display()
            ));
        }

        let parent = original_path
            .parent()
            .ok_or("Could not get parent directory")?;
        let extension = original_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        let file_date = exif_processing::get_creation_date_from_path(&original_path);

        let new_stem = generate_filename_from_template(
            &name_template,
            &original_path,
            i + 1,
            paths.len(),
            &file_date,
        );
        let new_filename = format!("{}.{}", new_stem, extension);
        let new_path = parent.join(new_filename);

        if !destination_paths.insert(new_path.clone()) {
            return Err(format!(
                "Multiple files would be renamed to {}.",
                new_path.display()
            ));
        }

        if new_path.exists() && new_path != original_path {
            return Err(format!(
                "A file with the name {} already exists.",
                new_path.display()
            ));
        }

        final_new_paths.push(new_path.to_string_lossy().into_owned());
        primary_operations.push((original_path, new_path));
    }

    let mut operations = primary_operations.clone();
    let mut sidecar_operations: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (original_path, new_path) in &primary_operations {
        let parent = original_path
            .parent()
            .ok_or("Could not get parent directory")?;
        let original_filename_str = original_path.file_name().unwrap().to_string_lossy();

        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.filter_map(Result::ok) {
                let entry_path = entry.path();
                let entry_os_filename = entry.file_name();
                let entry_filename = entry_os_filename.to_string_lossy();

                if let Some((source_filename, copy_id)) =
                    split_rrdata_sidecar_filename(&entry_filename)
                    && source_filename == original_filename_str
                {
                    let destination = rrdata_sidecar_path(new_path, copy_id.as_deref());
                    if destination.exists() && destination != entry_path {
                        return Err(format!(
                            "A sidecar with the name {} already exists.",
                            destination.display()
                        ));
                    }
                    if !destination_paths.insert(destination.clone()) {
                        return Err(format!(
                            "Multiple files would be renamed to {}.",
                            destination.display()
                        ));
                    }
                    sidecar_operations.push((entry_path, destination));
                }
            }
        }

        let old_rrexif = rrexif_sidecar_path(original_path);

        if old_rrexif.exists() {
            let new_rrexif = rrexif_sidecar_path(new_path);
            if new_rrexif.exists() && new_rrexif != old_rrexif {
                return Err(format!(
                    "A metadata sidecar with the name {} already exists.",
                    new_rrexif.display()
                ));
            }
            if !destination_paths.insert(new_rrexif.clone()) {
                return Err(format!(
                    "Multiple files would be renamed to {}.",
                    new_rrexif.display()
                ));
            }
            sidecar_operations.push((old_rrexif, new_rrexif));
        }
    }
    operations.extend(sidecar_operations);

    let mut journal: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(operations.len());

    for (old_path, new_path) in &operations {
        if old_path == new_path {
            continue;
        }

        if let Err(err) = fs::rename(old_path, new_path) {
            rollback_renames(&journal);
            return Err(format!(
                "Failed to rename {} to {}: {}. Completed renames were rolled back.",
                old_path.display(),
                new_path.display(),
                err
            ));
        }

        journal.push((new_path.clone(), old_path.clone()));

        let old_str = old_path.to_string_lossy().into_owned();
        let new_str = new_path.to_string_lossy().into_owned();

        renames.insert(old_str, new_str.clone());
    }

    sync_album_path_changes(&app_handle, Some(&renames), None, None);

    Ok(final_new_paths)
}

fn rollback_renames(journal: &[(PathBuf, PathBuf)]) {
    for (new_path, old_path) in journal.iter().rev() {
        if let Err(err) = fs::rename(new_path, old_path) {
            log::error!(
                "Failed to roll back rename {} to {}: {}",
                new_path.display(),
                old_path.display(),
                err
            );
        }
    }
}

fn hash_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|err| format!("Failed to open {}: {}", path.display(), err))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|err| format!("Failed to read {}: {}", path.display(), err))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn is_tiff_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "tif" | "tiff"))
        .unwrap_or(false)
}

struct ExternalEditorTiffInspection {
    embedded_icc_profile: bool,
    verified_bit_depth: Option<u8>,
}

fn tiff_bit_depth(color_type: ColorType) -> Option<u8> {
    match color_type {
        ColorType::L8 | ColorType::La8 | ColorType::Rgb8 | ColorType::Rgba8 => Some(8),
        ColorType::L16 | ColorType::La16 | ColorType::Rgb16 | ColorType::Rgba16 => Some(16),
        ColorType::Rgb32F | ColorType::Rgba32F => Some(32),
        _ => None,
    }
}

fn inspect_external_editor_tiff(
    output_path: &Path,
    expected_bit_depth: Option<u8>,
    expected_color_profile: Option<&str>,
) -> Result<ExternalEditorTiffInspection, String> {
    let file = fs::File::open(output_path).map_err(|err| {
        format!(
            "Failed to open edited TIFF {}: {}",
            output_path.display(),
            err
        )
    })?;
    let reader = std::io::BufReader::new(file);
    let mut decoder = TiffDecoder::new(reader)
        .map_err(|err| format!("Edited TIFF could not be decoded: {}", err))?;
    let verified_bit_depth = tiff_bit_depth(decoder.color_type());
    if let Some(expected) = expected_bit_depth
        && verified_bit_depth != Some(expected)
    {
        return Err(format!(
            "Edited TIFF bit depth mismatch: expected {}-bit from export receipt, decoded {}",
            expected,
            verified_bit_depth
                .map(|bit_depth| format!("{bit_depth}-bit"))
                .unwrap_or_else(|| "unsupported bit depth".to_string())
        ));
    }

    let embedded_icc_profile = decoder
        .icc_profile()
        .map_err(|err| format!("Failed to read edited TIFF ICC profile: {}", err))?
        .is_some_and(|profile| !profile.is_empty());
    if expected_color_profile
        .map(|profile| !profile.trim().is_empty())
        .unwrap_or(false)
        && !embedded_icc_profile
    {
        return Err(
            "Edited TIFF is missing the ICC profile required by the export receipt".to_string(),
        );
    }

    Ok(ExternalEditorTiffInspection {
        embedded_icc_profile,
        verified_bit_depth,
    })
}

fn write_external_editor_variant_sidecar(
    source_virtual_path: &str,
    output_path: &Path,
    sidecar_path: &Path,
    bit_depth: Option<u8>,
    color_profile: Option<String>,
    rendering_intent: Option<String>,
) -> Result<ExternalEditorVariantReceipt, String> {
    let (source_path, source_sidecar_path) = parse_virtual_path(source_virtual_path);
    if !source_path.exists() {
        return Err(format!(
            "Source image does not exist: {}",
            source_path.display()
        ));
    }
    if !output_path.exists() {
        return Err(format!(
            "Edited TIFF does not exist: {}",
            output_path.display()
        ));
    }
    if !output_path.is_file() {
        return Err(format!(
            "Edited TIFF is not a file: {}",
            output_path.display()
        ));
    }
    if !is_tiff_path(output_path) {
        return Err(format!(
            "External editor variants must be TIFF files: {}",
            output_path.display()
        ));
    }

    let mut sidecar = crate::exif_processing::load_sidecar(&source_sidecar_path);
    let source_adjustments =
        serde_json::to_vec(&sidecar.adjustments).map_err(|err| err.to_string())?;
    let source_revision = compute_source_revision(source_virtual_path, &source_adjustments);
    let content_hash = hash_file_sha256(output_path)?;
    let tiff_inspection =
        inspect_external_editor_tiff(output_path, bit_depth, color_profile.as_deref())?;
    let artifact_id = format!("artifact_external_editor_{}", Uuid::new_v4().simple());
    let output_path_string = output_path.to_string_lossy().to_string();
    let source_path_string = source_path.to_string_lossy().to_string();
    let source_virtual_path_string = source_virtual_path.to_string();

    let artifacts = sidecar
        .raw_engine_artifacts
        .get_or_insert_with(RawEngineArtifacts::new_v1);
    artifacts.schema_version = 1;
    artifacts.external_editor_artifacts.push(serde_json::json!({
        "artifactId": artifact_id,
        "contentHash": content_hash,
        "createdAt": Utc::now().to_rfc3339(),
        "operationId": "external_editor.import_linked_variant",
        "operationVersion": 1,
        "output": {
            "bitDepth": bit_depth,
            "bitDepthProvenance": "decoded_tiff_matches_export_receipt",
            "colorProfile": color_profile,
            "colorProfileProvenance": if color_profile.is_some() { "embedded_icc_profile_present" } else { "not_requested" },
            "embeddedIccProfile": tiff_inspection.embedded_icc_profile,
            "format": "tiff",
            "noOverwritePolicy": "never_overwrite_original",
            "path": output_path_string,
            "renderingIntent": rendering_intent,
            "renderingIntentProvenance": "export_receipt",
            "storage": "linked_file",
            "verifiedBitDepth": tiff_inspection.verified_bit_depth,
        },
        "provenance": {
            "runtimeStatus": "imported",
            "sourceImagePath": source_path_string,
            "sourceRevision": source_revision,
            "sourceVirtualPath": source_virtual_path_string,
        },
        "schemaVersion": 1,
    }));

    let json = serde_json::to_string_pretty(&sidecar)
        .map_err(|err| format!("Failed to serialize external editor sidecar: {}", err))?;
    fs::write(sidecar_path, json).map_err(|err| {
        format!(
            "Failed to write external editor sidecar {}: {}",
            sidecar_path.display(),
            err
        )
    })?;

    Ok(ExternalEditorVariantReceipt {
        artifact_id,
        bit_depth,
        color_profile,
        content_hash,
        embedded_icc_profile: tiff_inspection.embedded_icc_profile,
        output_path: output_path_string,
        rendering_intent,
        sidecar_path: sidecar_path.to_string_lossy().to_string(),
        source_path: source_path.to_string_lossy().to_string(),
        source_revision,
        verified_bit_depth: tiff_inspection.verified_bit_depth,
    })
}

#[tauri::command]
pub fn import_external_editor_variant(
    source_virtual_path: String,
    output_path: String,
    bit_depth: Option<u8>,
    color_profile: Option<String>,
    rendering_intent: Option<String>,
) -> Result<ExternalEditorVariantReceipt, String> {
    let output_path = PathBuf::from(output_path);
    let sidecar_path = rrdata_sidecar_path(&output_path, None);
    write_external_editor_variant_sidecar(
        &source_virtual_path,
        &output_path,
        &sidecar_path,
        bit_depth,
        color_profile,
        rendering_intent,
    )
}

#[tauri::command]
pub fn get_external_editor_file_watch_snapshot(
    output_path: String,
) -> Result<FileWatchSnapshot, String> {
    let output_path = PathBuf::from(output_path);
    let metadata = fs::metadata(&output_path)
        .map_err(|err| format!("Failed to read {}: {}", output_path.display(), err))?;
    let modified = metadata.modified().map_err(|err| {
        format!(
            "Failed to read modified time for {}: {}",
            output_path.display(),
            err
        )
    })?;
    let modified_ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| {
            format!(
                "Invalid modified time for {}: {}",
                output_path.display(),
                err
            )
        })?
        .as_millis();

    Ok(FileWatchSnapshot {
        byte_size: metadata.len(),
        modified_ms,
        path: output_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn launch_external_editor(
    output_path: String,
    editor_path: Option<String>,
) -> Result<(), String> {
    let output_path = PathBuf::from(output_path);
    if !output_path.exists() {
        return Err(format!(
            "Exported file does not exist: {}",
            output_path.display()
        ));
    }

    let output_path_str = output_path.to_string_lossy().to_string();
    let configured_editor = editor_path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        if let Some(editor) = configured_editor {
            command.args(["-a", &editor, &output_path_str]);
        } else {
            command.arg(&output_path_str);
        }
        let status = command.status().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!(
                "External editor launcher failed for {} with status {}.",
                output_path.display(),
                status
            ));
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(editor) = configured_editor {
            Command::new(editor)
                .arg(&output_path_str)
                .spawn()
                .map_err(|e| {
                    format!(
                        "External editor launcher failed for {}: {}",
                        output_path.display(),
                        e
                    )
                })?;
        } else {
            Command::new("cmd")
                .args(["/C", "start", "", &output_path_str])
                .spawn()
                .map_err(|e| {
                    format!(
                        "External editor launcher failed for {}: {}",
                        output_path.display(),
                        e
                    )
                })?;
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(editor) = configured_editor {
            Command::new(editor)
                .arg(&output_path_str)
                .spawn()
                .map_err(|e| {
                    format!(
                        "External editor launcher failed for {}: {}",
                        output_path.display(),
                        e
                    )
                })?;
        } else {
            Command::new("xdg-open")
                .arg(&output_path_str)
                .spawn()
                .map_err(|e| {
                    format!(
                        "External editor launcher failed for {}: {}",
                        output_path.display(),
                        e
                    )
                })?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn create_virtual_copy(
    source_virtual_path: String,
    target_album_id: Option<String>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, source_sidecar_path) = parse_virtual_path(&source_virtual_path);

    let new_copy_id = Uuid::new_v4().to_string()[..6].to_string();
    let new_virtual_path = VirtualImagePath {
        source_path,
        copy_id: Some(new_copy_id),
    }
    .to_serialized();
    let (_, new_sidecar_path) = parse_virtual_path(&new_virtual_path);

    if source_sidecar_path.exists() {
        fs::copy(&source_sidecar_path, &new_sidecar_path)
            .map_err(|e| format!("Failed to copy sidecar file: {}", e))?;
    } else {
        let default_metadata = ImageMetadata::default();
        let json_string =
            serde_json::to_string_pretty(&default_metadata).map_err(|e| e.to_string())?;
        fs::write(new_sidecar_path, json_string).map_err(|e| e.to_string())?;
    }

    if let Some(album_id) = target_album_id {
        let _ = add_to_album(album_id, vec![new_virtual_path.clone()], app_handle);
    }

    Ok(new_virtual_path)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct XmpMetadataConflictField {
    pub field: String,
    pub label: String,
    pub local: Value,
    pub external: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct XmpMetadataConflictReport {
    pub path: String,
    pub xmp_path: String,
    pub fields: Vec<XmpMetadataConflictField>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct XmpMetadataConflictDecision {
    pub field: String,
    pub choice: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct XmpConflictReceipt {
    pub id: String,
    pub resolved_at: String,
    pub xmp_path: String,
    pub decisions: Vec<XmpMetadataConflictDecision>,
}

fn find_xmp_path(source_path: &Path) -> Option<PathBuf> {
    let xmp_path = source_path.with_extension("xmp");
    let xmp_path_upper = source_path.with_extension("XMP");

    if xmp_path.exists() {
        Some(xmp_path)
    } else if xmp_path_upper.exists() {
        Some(xmp_path_upper)
    } else {
        None
    }
}

fn sorted_unique_values(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut values = values
        .into_iter()
        .filter_map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect::<Vec<_>>();
    values.sort_by_key(|value| value.to_lowercase());
    values.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    values
}

fn metadata_color_label(metadata: &ImageMetadata) -> Option<String> {
    metadata.tags.as_ref().and_then(|tags| {
        tags.iter()
            .find_map(|tag| tag.strip_prefix(COLOR_TAG_PREFIX).map(str::to_string))
    })
}

fn metadata_keywords(metadata: &ImageMetadata) -> Vec<String> {
    sorted_unique_values(
        metadata
            .tags
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|tag| {
                if tag.starts_with(COLOR_TAG_PREFIX) {
                    None
                } else if let Some(user_tag) = tag.strip_prefix(USER_TAG_PREFIX) {
                    Some(user_tag.to_string())
                } else {
                    Some(tag)
                }
            }),
    )
}

fn replace_metadata_color_label(metadata: &mut ImageMetadata, color_label: Option<String>) {
    let mut tags = metadata.tags.clone().unwrap_or_default();
    tags.retain(|tag| !tag.starts_with(COLOR_TAG_PREFIX));

    if let Some(label) = color_label.filter(|label| !label.trim().is_empty()) {
        tags.push(format!(
            "{}{}",
            COLOR_TAG_PREFIX,
            label.trim().to_lowercase()
        ));
    }

    metadata.tags = if tags.is_empty() { None } else { Some(tags) };
}

fn replace_metadata_keywords(metadata: &mut ImageMetadata, keywords: Vec<String>) {
    let mut tags = metadata
        .tags
        .clone()
        .unwrap_or_default()
        .into_iter()
        .filter(|tag| tag.starts_with(COLOR_TAG_PREFIX))
        .collect::<Vec<_>>();

    tags.extend(
        sorted_unique_values(keywords)
            .into_iter()
            .map(|tag| format!("{}{}", USER_TAG_PREFIX, tag)),
    );

    metadata.tags = if tags.is_empty() { None } else { Some(tags) };
}

fn xmp_external_keywords(content: &str) -> Vec<String> {
    sorted_unique_values(extract_xmp_tags(content))
}

fn xmp_conflict_value(
    report: &XmpMetadataConflictReport,
    field: &str,
    choice: &str,
) -> Option<Value> {
    let conflict = report
        .fields
        .iter()
        .find(|conflict| conflict.field == field)?;
    match choice {
        "local" => Some(conflict.local.clone()),
        "external" => Some(conflict.external.clone()),
        "merge" => conflict
            .merged
            .clone()
            .or_else(|| Some(conflict.external.clone())),
        _ => None,
    }
}

fn build_xmp_metadata_conflict_report(
    path: &str,
    source_path: &Path,
    metadata: &ImageMetadata,
) -> Result<Option<XmpMetadataConflictReport>, String> {
    let Some(xmp_path) = find_xmp_path(source_path) else {
        return Ok(None);
    };
    let content = fs::read_to_string(&xmp_path).map_err(|e| e.to_string())?;
    let mut fields = Vec::new();

    let local_rating = serde_json::json!(metadata.rating);
    let external_rating =
        extract_xmp_rating(&content).map_or(Value::Null, |rating| serde_json::json!(rating));
    if local_rating != external_rating {
        fields.push(XmpMetadataConflictField {
            field: "rating".to_string(),
            label: "Rating".to_string(),
            local: local_rating,
            external: external_rating,
            merged: None,
        });
    }

    let local_color =
        metadata_color_label(metadata).map_or(Value::Null, |label| serde_json::json!(label));
    let external_color = extract_xmp_label(&content)
        .map(|label| label.to_lowercase())
        .map_or(Value::Null, |label| serde_json::json!(label));
    if local_color != external_color {
        fields.push(XmpMetadataConflictField {
            field: "colorLabel".to_string(),
            label: "Color label".to_string(),
            local: local_color,
            external: external_color,
            merged: None,
        });
    }

    let local_keywords = metadata_keywords(metadata);
    let external_keywords = xmp_external_keywords(&content);
    if local_keywords != external_keywords {
        let merged_keywords = sorted_unique_values(
            local_keywords
                .iter()
                .cloned()
                .chain(external_keywords.iter().cloned()),
        );
        fields.push(XmpMetadataConflictField {
            field: "keywords".to_string(),
            label: "Keywords".to_string(),
            local: serde_json::json!(local_keywords),
            external: serde_json::json!(external_keywords),
            merged: Some(serde_json::json!(merged_keywords)),
        });
    }

    if fields.is_empty() {
        Ok(None)
    } else {
        Ok(Some(XmpMetadataConflictReport {
            path: path.to_string(),
            xmp_path: xmp_path.to_string_lossy().into_owned(),
            fields,
        }))
    }
}

#[tauri::command]
pub fn check_xmp_metadata_conflicts(
    path: String,
) -> Result<Option<XmpMetadataConflictReport>, String> {
    let (source_path, sidecar_path) = parse_virtual_path(&path);
    let metadata = crate::exif_processing::load_sidecar(&sidecar_path);
    build_xmp_metadata_conflict_report(&path, &source_path, &metadata)
}

#[tauri::command]
pub fn resolve_xmp_metadata_conflicts(
    path: String,
    decisions: Vec<XmpMetadataConflictDecision>,
    app_handle: AppHandle,
) -> Result<Option<XmpConflictReceipt>, String> {
    let (source_path, sidecar_path) = parse_virtual_path(&path);
    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
    let Some(report) = build_xmp_metadata_conflict_report(&path, &source_path, &metadata)? else {
        return Ok(None);
    };

    for decision in &decisions {
        let Some(value) = xmp_conflict_value(&report, &decision.field, &decision.choice) else {
            continue;
        };

        match decision.field.as_str() {
            "rating" => {
                metadata.rating = value.as_u64().unwrap_or_default().min(5) as u8;
            }
            "colorLabel" => {
                replace_metadata_color_label(&mut metadata, value.as_str().map(str::to_string));
            }
            "keywords" => {
                let keywords = value
                    .as_array()
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(str::to_string))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                replace_metadata_keywords(&mut metadata, keywords);
            }
            _ => {}
        }
    }

    let receipt = XmpConflictReceipt {
        id: Uuid::new_v4().to_string(),
        resolved_at: Utc::now().to_rfc3339(),
        xmp_path: report.xmp_path,
        decisions,
    };

    metadata
        .raw_engine_artifacts
        .get_or_insert_with(crate::image_processing::RawEngineArtifacts::new_v1)
        .xmp_conflict_receipts
        .push(serde_json::json!(&receipt));

    let json_string = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    crate::exif_processing::write_text_file_atomic(&sidecar_path, &json_string)?;

    let settings = load_settings_or_default(&app_handle);
    sync_metadata_to_xmp(
        &source_path,
        &metadata,
        settings.create_xmp_if_missing.unwrap_or(false),
    );

    Ok(Some(receipt))
}

pub fn sync_metadata_from_xmp(source_path: &Path, metadata: &mut ImageMetadata) -> bool {
    let actual_xmp = find_xmp_path(source_path);

    let mut changed = false;

    if let Some(xmp_file) = actual_xmp
        && let Ok(content) = fs::read_to_string(&xmp_file)
    {
        if metadata.rating == 0
            && let Some(rating) = extract_xmp_rating(&content)
            && rating != 0
        {
            metadata.rating = rating;
            if let Some(obj) = metadata.adjustments.as_object_mut() {
                obj.insert("rating".to_string(), serde_json::json!(rating));
            } else {
                metadata.adjustments = serde_json::json!({"rating": rating});
            }
            changed = true;
        }

        let xmp_label = extract_xmp_label(&content);
        let xmp_tags = extract_xmp_tags(&content);

        let mut current_tags = metadata.tags.clone().unwrap_or_default();
        let original_len = current_tags.len();
        let had_no_tags = metadata.tags.is_none();

        for tag in xmp_tags {
            if !current_tags.contains(&tag) {
                current_tags.push(tag);
            }
        }

        if let Some(label) = xmp_label {
            let label_tag = format!("{}{}", COLOR_TAG_PREFIX, label.to_lowercase());
            if !current_tags.contains(&label_tag) {
                current_tags.retain(|t| !t.starts_with(COLOR_TAG_PREFIX));
                current_tags.push(label_tag);
            }
        }

        if current_tags.len() != original_len || (had_no_tags && !current_tags.is_empty()) {
            metadata.tags = Some(current_tags);
            changed = true;
        }
    }
    changed
}

pub fn sync_metadata_to_xmp(source_path: &Path, metadata: &ImageMetadata, create_if_missing: bool) {
    let xmp_path = source_path.with_extension("xmp");
    let xmp_path_upper = source_path.with_extension("XMP");

    let mut actual_xmp = if xmp_path.exists() {
        Some(xmp_path.clone())
    } else if xmp_path_upper.exists() {
        Some(xmp_path_upper)
    } else {
        None
    };

    if actual_xmp.is_none() {
        if !create_if_missing {
            return;
        }
        let skeleton = r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="RapidRAW">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        if let Err(e) = crate::exif_processing::write_text_file_atomic(&xmp_path, skeleton) {
            log::error!("Failed to create skeleton XMP: {}", e);
            return;
        }
        actual_xmp = Some(xmp_path);
    }

    if let Some(xmp_file) = actual_xmp
        && let Ok(mut content) = fs::read_to_string(&xmp_file)
    {
        let rating_str = metadata.rating.to_string();
        let re_rating_attr = Regex::new(r#"xmp:Rating\s*=\s*"[^"]*""#).unwrap();
        let re_rating_tag = Regex::new(r#"<xmp:Rating\s*>[^<]*</xmp:Rating>"#).unwrap();

        if re_rating_attr.is_match(&content) {
            content = re_rating_attr
                .replace(&content, format!("xmp:Rating=\"{}\"", rating_str))
                .to_string();
        } else if re_rating_tag.is_match(&content) {
            content = re_rating_tag
                .replace(&content, format!("<xmp:Rating>{}</xmp:Rating>", rating_str))
                .to_string();
        } else if let Some(last_index) = content.rfind("</rdf:Description>") {
            let (start, end) = content.split_at(last_index);
            content = format!("{} <xmp:Rating>{}</xmp:Rating>\n{}", start, rating_str, end);
        }

        let current_tags = metadata.tags.clone().unwrap_or_default();
        let mut label = None;
        let mut normal_tags = Vec::new();

        for t in current_tags {
            if let Some(color) = t.strip_prefix(COLOR_TAG_PREFIX) {
                let mut c = color.chars();
                let cap_color = match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                };
                label = Some(cap_color);
            } else if let Some(user_tag) = t.strip_prefix(USER_TAG_PREFIX) {
                normal_tags.push(user_tag.to_string());
            } else {
                normal_tags.push(t);
            }
        }

        if let Some(lbl) = label {
            let re_label_attr = Regex::new(r#"xmp:Label\s*=\s*"[^"]*""#).unwrap();
            let re_label_tag = Regex::new(r#"<xmp:Label\s*>[^<]*</xmp:Label>"#).unwrap();

            if re_label_attr.is_match(&content) {
                content = re_label_attr
                    .replace(&content, format!("xmp:Label=\"{}\"", lbl))
                    .to_string();
            } else if re_label_tag.is_match(&content) {
                content = re_label_tag
                    .replace(&content, format!("<xmp:Label>{}</xmp:Label>", lbl))
                    .to_string();
            } else if let Some(last_index) = content.rfind("</rdf:Description>") {
                let (start, end) = content.split_at(last_index);
                content = format!("{} <xmp:Label>{}</xmp:Label>\n{}", start, lbl, end);
            }
        } else {
            let re_label_attr = Regex::new(r#"\s*xmp:Label\s*=\s*"[^"]*""#).unwrap();
            let re_label_tag = Regex::new(r#"\s*<xmp:Label\s*>[^<]*</xmp:Label>"#).unwrap();
            content = re_label_attr.replace_all(&content, "").to_string();
            content = re_label_tag.replace_all(&content, "").to_string();
        }

        let re_subject =
            Regex::new(r#"(?s)<dc:subject>\s*<rdf:Bag>.*?</rdf:Bag>\s*</dc:subject>"#).unwrap();
        if normal_tags.is_empty() {
            content = re_subject.replace_all(&content, "").to_string();
        } else {
            let mut bag = String::from("<dc:subject>\n    <rdf:Bag>\n");
            for t in normal_tags {
                bag.push_str(&format!("     <rdf:li>{}</rdf:li>\n", t));
            }
            bag.push_str("    </rdf:Bag>\n   </dc:subject>");

            if re_subject.is_match(&content) {
                content = re_subject.replace(&content, bag).to_string();
            } else if let Some(last_index) = content.rfind("</rdf:Description>") {
                let (start, end) = content.split_at(last_index);
                content = format!("{} {}\n  {}", start, bag, end);
            }
        }

        if let Err(e) = crate::exif_processing::write_text_file_atomic(&xmp_file, &content) {
            log::warn!("Failed to sync XMP sidecar {}: {}", xmp_file.display(), e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageEncoder, codecs::tiff::TiffEncoder};

    #[test]
    fn virtual_image_path_parses_primary_path() {
        let path = VirtualImagePath::parse("/roll/IMG_0001.CR3");

        assert_eq!(path.source_path(), Path::new("/roll/IMG_0001.CR3"));
        assert_eq!(path.copy_id(), None);
        assert_eq!(
            path.sidecar_path(),
            PathBuf::from("/roll/IMG_0001.CR3.rrdata")
        );
        assert_eq!(path.to_serialized(), "/roll/IMG_0001.CR3");
    }

    #[test]
    fn virtual_image_path_parses_virtual_copy_path() {
        let path = VirtualImagePath::parse("/roll/IMG_0001.CR3?vc=abc123");

        assert_eq!(path.source_path(), Path::new("/roll/IMG_0001.CR3"));
        assert_eq!(path.copy_id(), Some("abc123"));
        assert_eq!(
            path.sidecar_path(),
            PathBuf::from("/roll/IMG_0001.CR3.abc123.rrdata")
        );
        assert_eq!(path.to_serialized(), "/roll/IMG_0001.CR3?vc=abc123");
    }

    #[test]
    fn virtual_image_path_keeps_question_mark_without_virtual_copy_suffix() {
        let path = VirtualImagePath::parse("/roll/IMG?draft_0001.CR3");

        assert_eq!(path.source_path(), Path::new("/roll/IMG?draft_0001.CR3"));
        assert_eq!(path.copy_id(), None);
        assert_eq!(
            path.sidecar_path(),
            PathBuf::from("/roll/IMG?draft_0001.CR3.rrdata")
        );
    }

    #[test]
    fn virtual_image_path_preserves_empty_virtual_copy_id_behavior() {
        let path = VirtualImagePath::parse("/roll/IMG_0001.CR3?vc=");

        assert_eq!(path.source_path(), Path::new("/roll/IMG_0001.CR3"));
        assert_eq!(path.copy_id(), Some(""));
        assert_eq!(
            path.sidecar_path(),
            PathBuf::from("/roll/IMG_0001.CR3..rrdata")
        );
        assert_eq!(path.to_serialized(), "/roll/IMG_0001.CR3?vc=");
    }

    #[test]
    fn update_exif_fields_blocking_writes_primary_sidecar_atomically() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("image.raf");
        fs::write(&image_path, b"raw").expect("source image");

        update_exif_fields_blocking(
            vec![image_path.to_string_lossy().into_owned()],
            HashMap::from([("Artist".to_string(), "RawEngine".to_string())]),
        )
        .expect("exif update");

        let sidecar_path = crate::exif_processing::get_primary_sidecar_path(&image_path);
        let metadata = crate::exif_processing::load_sidecar(&sidecar_path);
        assert_eq!(
            metadata.exif.as_ref().and_then(|exif| exif.get("Artist")),
            Some(&"RawEngine".to_string())
        );
    }

    #[test]
    fn update_exif_fields_blocking_reports_mixed_batch_write_failure() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let good_image_path = temp_dir.path().join("good.raf");
        fs::write(&good_image_path, b"raw").expect("source image");
        let missing_parent_path = temp_dir.path().join("missing").join("bad.raf");

        let err = update_exif_fields_blocking(
            vec![
                good_image_path.to_string_lossy().into_owned(),
                missing_parent_path.to_string_lossy().into_owned(),
            ],
            HashMap::from([("Artist".to_string(), "RawEngine".to_string())]),
        )
        .expect_err("mixed batch should report write failure");

        assert!(err.contains("bad.raf"));
        assert!(!crate::exif_processing::get_primary_sidecar_path(&missing_parent_path).exists());
    }

    #[test]
    fn rollback_renames_restores_completed_file_moves_in_reverse_order() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let first_original = temp_dir.path().join("first.raf");
        let second_original = temp_dir.path().join("second.raf");
        let first_new = temp_dir.path().join("renamed-first.raf");
        let second_new = temp_dir.path().join("renamed-second.raf");

        fs::write(&first_original, b"first").expect("first source");
        fs::write(&second_original, b"second").expect("second source");
        fs::rename(&first_original, &first_new).expect("first rename");
        fs::rename(&second_original, &second_new).expect("second rename");

        rollback_renames(&[
            (first_new.clone(), first_original.clone()),
            (second_new.clone(), second_original.clone()),
        ]);

        assert_eq!(fs::read(&first_original).expect("first restored"), b"first");
        assert_eq!(
            fs::read(&second_original).expect("second restored"),
            b"second"
        );
        assert!(!first_new.exists());
        assert!(!second_new.exists());
    }

    #[test]
    fn rollback_copied_files_removes_completed_destinations() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let first_copy = temp_dir.path().join("first-copy.raf");
        let second_copy = temp_dir.path().join("second-copy.raf");

        fs::write(&first_copy, b"first").expect("first copy");
        fs::write(&second_copy, b"second").expect("second copy");

        rollback_copied_files(&[first_copy.clone(), second_copy.clone()]);

        assert!(!first_copy.exists());
        assert!(!second_copy.exists());
    }

    #[test]
    fn external_editor_variant_sidecar_records_linked_tiff_provenance() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let source_path = temp_dir.path().join("image.raf");
        let output_path = temp_dir.path().join("image-edit.tiff");
        let sidecar_path = rrdata_sidecar_path(&output_path, None);
        fs::write(&source_path, b"raw").expect("source image");
        write_external_editor_test_tiff(&output_path, Some(b"test-icc-profile"));

        let source_sidecar_path = crate::exif_processing::get_primary_sidecar_path(&source_path);
        let source_metadata = ImageMetadata {
            adjustments: serde_json::json!({ "exposure": 0.4 }),
            rating: 4,
            ..ImageMetadata::default()
        };
        fs::write(
            &source_sidecar_path,
            serde_json::to_string_pretty(&source_metadata).expect("source metadata json"),
        )
        .expect("source sidecar");

        let receipt = write_external_editor_variant_sidecar(
            &source_path.to_string_lossy(),
            &output_path,
            &sidecar_path,
            Some(16),
            Some("Display P3".to_string()),
            Some("Relative colorimetric".to_string()),
        )
        .expect("import linked variant");

        assert_eq!(receipt.bit_depth, Some(16));
        assert_eq!(receipt.color_profile.as_deref(), Some("Display P3"));
        assert_eq!(
            receipt.rendering_intent.as_deref(),
            Some("Relative colorimetric")
        );
        assert_eq!(receipt.output_path, output_path.to_string_lossy());
        assert_eq!(receipt.source_path, source_path.to_string_lossy());
        assert!(receipt.content_hash.starts_with("sha256:"));
        assert!(receipt.embedded_icc_profile);
        assert_eq!(receipt.verified_bit_depth, Some(16));
        assert!(sidecar_path.exists());

        let imported = crate::exif_processing::load_sidecar(&sidecar_path);
        assert_eq!(imported.rating, 4);
        let artifact = imported
            .raw_engine_artifacts
            .expect("rawEngineArtifacts")
            .external_editor_artifacts
            .pop()
            .expect("external editor artifact");

        assert_eq!(artifact["artifactId"], receipt.artifact_id);
        assert_eq!(artifact["contentHash"], receipt.content_hash);
        assert_eq!(
            artifact["operationId"],
            "external_editor.import_linked_variant"
        );
        assert_eq!(
            artifact["output"]["path"].as_str(),
            Some(output_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            artifact["output"]["noOverwritePolicy"].as_str(),
            Some("never_overwrite_original")
        );
        assert_eq!(artifact["output"]["bitDepth"].as_u64(), Some(16));
        assert_eq!(
            artifact["output"]["bitDepthProvenance"].as_str(),
            Some("decoded_tiff_matches_export_receipt")
        );
        assert_eq!(
            artifact["output"]["colorProfile"].as_str(),
            Some("Display P3")
        );
        assert_eq!(
            artifact["output"]["colorProfileProvenance"].as_str(),
            Some("embedded_icc_profile_present")
        );
        assert_eq!(
            artifact["output"]["embeddedIccProfile"].as_bool(),
            Some(true)
        );
        assert_eq!(artifact["output"]["verifiedBitDepth"].as_u64(), Some(16));
        assert_eq!(
            artifact["output"]["renderingIntent"].as_str(),
            Some("Relative colorimetric")
        );
        assert_eq!(
            artifact["output"]["renderingIntentProvenance"].as_str(),
            Some("export_receipt")
        );
        assert_eq!(
            artifact["provenance"]["sourceImagePath"].as_str(),
            Some(source_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            artifact["provenance"]["sourceRevision"],
            receipt.source_revision
        );
    }

    #[test]
    fn external_editor_variant_rejects_tiff_with_mismatched_bit_depth() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let source_path = temp_dir.path().join("image.raf");
        let output_path = temp_dir.path().join("image-edit.tiff");
        let sidecar_path = rrdata_sidecar_path(&output_path, None);
        fs::write(&source_path, b"raw").expect("source image");
        write_external_editor_test_tiff(&output_path, Some(b"test-icc-profile"));

        let error = write_external_editor_variant_sidecar(
            &source_path.to_string_lossy(),
            &output_path,
            &sidecar_path,
            Some(8),
            Some("Display P3".to_string()),
            Some("Relative colorimetric".to_string()),
        )
        .expect_err("mismatched receipt bit depth should fail");

        assert!(error.contains("bit depth mismatch"));
        assert!(!sidecar_path.exists());
    }

    #[test]
    fn external_editor_variant_rejects_tiff_without_required_icc_profile() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let source_path = temp_dir.path().join("image.raf");
        let output_path = temp_dir.path().join("image-edit.tiff");
        let sidecar_path = rrdata_sidecar_path(&output_path, None);
        fs::write(&source_path, b"raw").expect("source image");
        write_external_editor_test_tiff(&output_path, None);

        let error = write_external_editor_variant_sidecar(
            &source_path.to_string_lossy(),
            &output_path,
            &sidecar_path,
            Some(16),
            Some("Display P3".to_string()),
            Some("Relative colorimetric".to_string()),
        )
        .expect_err("missing ICC profile should fail");

        assert!(error.contains("missing the ICC profile"));
        assert!(!sidecar_path.exists());
    }

    #[test]
    fn external_editor_file_watch_snapshot_tracks_size_and_modified_time() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let output_path = temp_dir.path().join("image-edit.tiff");
        fs::write(&output_path, b"edited tiff").expect("edited output");

        let snapshot =
            get_external_editor_file_watch_snapshot(output_path.to_string_lossy().into_owned())
                .expect("file watch snapshot");

        assert_eq!(snapshot.path, output_path.to_string_lossy());
        assert_eq!(snapshot.byte_size, b"edited tiff".len() as u64);
        assert!(snapshot.modified_ms > 0);
    }

    #[test]
    fn external_editor_launcher_reports_missing_named_editor() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let output_path = temp_dir.path().join("image-edit.tiff");
        write_external_editor_test_tiff(&output_path, Some(b"test-icc-profile"));

        let error = launch_external_editor(
            output_path.to_string_lossy().into_owned(),
            Some("RawEngineMissingEditorForValidation".to_string()),
        )
        .expect_err("missing named editor should fail synchronously");

        assert!(
            error.contains(&output_path.to_string_lossy().to_string())
                || error.contains("RawEngineMissingEditorForValidation"),
            "missing-editor error should identify the failed launch target: {error}"
        );
    }

    #[test]
    #[ignore = "opens Preview and mutates a temp TIFF; run via check:external-editor-preview-roundtrip-proof on macOS"]
    fn external_editor_live_roundtrip_with_preview() {
        if !cfg!(target_os = "macos") {
            return;
        }

        let temp_dir = tempfile::tempdir().expect("tempdir");
        let source_path = temp_dir.path().join("alaska-source.ARW");
        let output_path = temp_dir.path().join("alaska-preview-roundtrip.tiff");
        let sidecar_path = rrdata_sidecar_path(&output_path, None);
        fs::write(&source_path, b"raw-source-placeholder").expect("source image");
        write_external_editor_test_tiff(&output_path, Some(b"test-icc-profile"));

        let before =
            get_external_editor_file_watch_snapshot(output_path.to_string_lossy().into_owned())
                .expect("baseline watch snapshot");
        launch_external_editor(
            output_path.to_string_lossy().into_owned(),
            Some("Preview".to_string()),
        )
        .expect("Preview should accept the TIFF handoff");

        std::thread::sleep(std::time::Duration::from_millis(25));
        write_external_editor_test_tiff(&output_path, Some(b"test-icc-profile-after-save"));
        let after =
            get_external_editor_file_watch_snapshot(output_path.to_string_lossy().into_owned())
                .expect("saved watch snapshot");
        assert!(
            after.modified_ms > before.modified_ms || after.byte_size != before.byte_size,
            "watch snapshot must detect the simulated external save"
        );

        let receipt = write_external_editor_variant_sidecar(
            &source_path.to_string_lossy(),
            &output_path,
            &sidecar_path,
            Some(16),
            Some("Display P3".to_string()),
            Some("Relative colorimetric".to_string()),
        )
        .expect("import linked variant from Preview handoff");

        assert_eq!(receipt.verified_bit_depth, Some(16));
        assert!(receipt.embedded_icc_profile);
        assert!(receipt.content_hash.starts_with("sha256:"));
        assert!(sidecar_path.exists());
        assert!(
            source_path.exists(),
            "external editor import must not overwrite the original source"
        );
    }

    fn write_external_editor_test_tiff(path: &Path, icc_profile: Option<&[u8]>) {
        let image = [128_u16, 64, 32, 128, 64, 32, 128, 64, 32, 128, 64, 32];
        let image_bytes: Vec<u8> = image
            .iter()
            .flat_map(|channel| channel.to_be_bytes())
            .collect();
        let file = fs::File::create(path).expect("create TIFF");
        let mut encoder = TiffEncoder::new(file);
        if let Some(profile) = icc_profile {
            encoder
                .set_icc_profile(profile.to_vec())
                .expect("set TIFF ICC profile");
        }
        encoder
            .write_image(&image_bytes, 2, 2, image::ExtendedColorType::Rgb16)
            .expect("write TIFF");
    }

    #[test]
    fn xmp_conflict_report_detects_rating_label_and_keyword_divergence() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let image_path = temp_dir.path().join("image.raf");
        fs::write(&image_path, b"raw").expect("source image");
        fs::write(
            image_path.with_extension("xmp"),
            r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <xmp:Rating>5</xmp:Rating>
   <xmp:Label>Green</xmp:Label>
   <dc:subject><rdf:Bag><rdf:li>alaska</rdf:li><rdf:li>mountain</rdf:li></rdf:Bag></dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#,
        )
        .expect("xmp");

        let metadata = ImageMetadata {
            rating: 2,
            tags: Some(vec![
                "color:red".to_string(),
                "user:alaska".to_string(),
                "user:sunset".to_string(),
            ]),
            ..ImageMetadata::default()
        };

        let report = build_xmp_metadata_conflict_report("image.raf", &image_path, &metadata)
            .expect("report result");
        let report = report.expect("conflicts");

        assert_eq!(report.fields.len(), 3);
        assert!(report.fields.iter().any(|field| field.field == "rating"));
        assert!(
            report
                .fields
                .iter()
                .any(|field| field.field == "colorLabel")
        );
        let keywords = report
            .fields
            .iter()
            .find(|field| field.field == "keywords")
            .expect("keywords");
        assert_eq!(
            keywords.merged.as_ref().expect("merged keywords"),
            &serde_json::json!(["alaska", "mountain", "sunset"])
        );
    }
}
