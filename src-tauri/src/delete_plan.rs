use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn rrdata_sidecar_filename(source_path: &Path, copy_id: Option<&str>) -> String {
    let source_filename = source_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    match copy_id {
        Some(id) => format!("{}.{}.rrdata", source_filename, id),
        None => format!("{}.rrdata", source_filename),
    }
}

pub fn rrdata_sidecar_path(source_path: &Path, copy_id: Option<&str>) -> PathBuf {
    source_path.with_file_name(rrdata_sidecar_filename(source_path, copy_id))
}

pub fn rrexif_sidecar_path(source_path: &Path) -> PathBuf {
    let mut rrexif_name = source_path.file_name().unwrap_or_default().to_os_string();
    rrexif_name.push(".rrexif");
    source_path.with_file_name(rrexif_name)
}

pub fn associated_files_for_source(source_image_path: &Path) -> Result<Vec<PathBuf>, String> {
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

pub fn plan_virtual_path_deletes(
    paths: &[String],
    parse_virtual_path: impl Fn(&str) -> (PathBuf, PathBuf),
) -> (Vec<PathBuf>, HashSet<String>) {
    let mut files_to_delete = HashSet::new();
    let mut deletions = HashSet::new();

    for path_str in paths {
        let (source_path, sidecar_path) = parse_virtual_path(path_str);
        deletions.insert(path_str.clone());

        if path_str.contains("?vc=") {
            if sidecar_path.exists() {
                files_to_delete.insert(sidecar_path);
            }
        } else if source_path.exists() {
            match associated_files_for_source(&source_path) {
                Ok(associated_files) => files_to_delete.extend(associated_files),
                Err(error) => log::warn!(
                    "Could not find associated files for {}: {}",
                    source_path.display(),
                    error
                ),
            }
        }
    }

    (files_to_delete.into_iter().collect(), deletions)
}

pub fn plan_stem_associated_deletes(
    paths: &[String],
    parse_virtual_path: impl Fn(&str) -> (PathBuf, PathBuf),
    is_supported_image_file: impl Fn(&str) -> bool,
) -> (Vec<PathBuf>, HashSet<String>) {
    let mut stems_to_delete = HashSet::new();
    let mut parent_dirs = HashSet::new();
    let mut deletions = HashSet::new();

    for path_str in paths {
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
        return (Vec::new(), deletions);
    }

    let mut files_to_delete = HashSet::new();
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
                    files_to_delete.insert(entry_path);
                }
            }
        }
    }

    (files_to_delete.into_iter().collect(), deletions)
}

pub fn remove_paths(paths: impl IntoIterator<Item = PathBuf>) -> Result<(), String> {
    for path in paths {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|error| format!("Failed to delete file {}: {}", path.display(), error))?;
        } else if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|error| {
                format!("Failed to delete directory {}: {}", path.display(), error)
            })?;
        }
    }

    Ok(())
}

pub fn trash_or_remove_paths(paths: Vec<PathBuf>) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        if let Err(trash_error) = trash::delete_all(&paths) {
            log::warn!(
                "Failed to move files to trash: {}. Falling back to permanent delete.",
                trash_error
            );
            remove_paths(paths)?;
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        remove_paths(paths)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn associated_files_include_primary_virtual_and_exif_sidecars() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let source = temp_dir.path().join("IMG_0001.CR3");
        let primary = temp_dir.path().join("IMG_0001.CR3.rrdata");
        let virtual_copy = temp_dir.path().join("IMG_0001.CR3.abc123.rrdata");
        let exif = temp_dir.path().join("IMG_0001.CR3.rrexif");
        let unrelated = temp_dir.path().join("IMG_0002.CR3.rrdata");

        for path in [&source, &primary, &virtual_copy, &exif, &unrelated] {
            fs::write(path, b"test").expect("write test file");
        }

        let associated = associated_files_for_source(&source).expect("associated files");

        assert!(associated.contains(&source));
        assert!(associated.contains(&primary));
        assert!(associated.contains(&virtual_copy));
        assert!(associated.contains(&exif));
        assert!(!associated.contains(&unrelated));
    }

    #[test]
    fn virtual_copy_delete_plan_only_includes_copy_sidecar() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let source = temp_dir.path().join("IMG_0001.CR3");
        let sidecar = temp_dir.path().join("IMG_0001.CR3.abc123.rrdata");
        fs::write(&source, b"raw").expect("write raw");
        fs::write(&sidecar, b"sidecar").expect("write sidecar");

        let virtual_path = format!("{}?vc=abc123", source.display());
        let (files, deletions) =
            plan_virtual_path_deletes(std::slice::from_ref(&virtual_path), |path| {
                let (base, copy_id) = path.rsplit_once("?vc=").expect("virtual path");
                let source = PathBuf::from(base);
                (source.clone(), rrdata_sidecar_path(&source, Some(copy_id)))
            });

        assert_eq!(files, vec![sidecar]);
        assert!(deletions.contains(&virtual_path));
    }

    #[test]
    fn stem_associated_plan_keeps_unrelated_stems() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let source = temp_dir.path().join("IMG_0001.CR3");
        let jpeg = temp_dir.path().join("IMG_0001.JPG");
        let rrdata = temp_dir.path().join("IMG_0001.CR3.rrdata");
        let unrelated = temp_dir.path().join("IMG_0002.JPG");

        for path in [&source, &jpeg, &rrdata, &unrelated] {
            fs::write(path, b"test").expect("write test file");
        }

        let request = vec![source.to_string_lossy().to_string()];
        let (files, _) = plan_stem_associated_deletes(
            &request,
            |path| (PathBuf::from(path), PathBuf::new()),
            |file_name| file_name.ends_with(".CR3") || file_name.ends_with(".JPG"),
        );

        assert!(files.contains(&source));
        assert!(files.contains(&jpeg));
        assert!(files.contains(&rrdata));
        assert!(!files.contains(&unrelated));
    }
}
