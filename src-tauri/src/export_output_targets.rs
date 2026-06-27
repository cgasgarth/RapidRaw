use std::path::{Path, PathBuf};

use crate::exif_processing;
use crate::file_management::{generate_filename_from_template, parse_virtual_path};

pub(crate) struct ExportOutputTargetRequest<'a> {
    pub image_path: &'a str,
    pub output_folder_path: &'a Path,
    pub is_explicit_file_path: bool,
    pub base_origin_folders: &'a [String],
    pub filename_template: &'a str,
    pub preserve_folders: bool,
    pub output_format: &'a str,
    pub total_paths: usize,
    pub global_index: usize,
    pub appearance_count: usize,
    pub explicit_virtual_copy: Option<u32>,
}

pub(crate) struct ResolvedExportOutputTarget {
    pub sidecar_path: PathBuf,
    pub source_path_str: String,
    pub output_path: PathBuf,
}

pub(crate) fn resolve_export_output_target(
    request: ExportOutputTargetRequest<'_>,
) -> ResolvedExportOutputTarget {
    let (source_path, sidecar_path) = parse_virtual_path(request.image_path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let file_date = exif_processing::get_creation_date_from_path(&source_path);
    let mut new_stem = generate_filename_from_template(
        request.filename_template,
        &source_path,
        request.global_index + 1,
        request.total_paths,
        &file_date,
    );

    if let Some(virtual_copy_id) = request.explicit_virtual_copy {
        new_stem = format!("{}_VC{:02}", new_stem, virtual_copy_id);
    } else if request.appearance_count > 1 {
        new_stem = format!("{}_VC{:02}", new_stem, request.appearance_count - 1);
    }

    let new_filename = format!("{}.{}", new_stem, request.output_format);
    let output_path = if request.is_explicit_file_path && request.total_paths == 1 {
        request.output_folder_path.to_path_buf()
    } else if request.preserve_folders {
        preserved_folder_output_path(
            &source_path,
            request.output_folder_path,
            request.base_origin_folders,
            &new_filename,
        )
    } else {
        request.output_folder_path.join(&new_filename)
    };

    ResolvedExportOutputTarget {
        sidecar_path,
        source_path_str,
        output_path,
    }
}

fn preserved_folder_output_path(
    source_path: &Path,
    output_folder_path: &Path,
    base_origin_folders: &[String],
    new_filename: &str,
) -> PathBuf {
    let matched_base = base_origin_folders
        .iter()
        .map(Path::new)
        .find(|base| source_path.starts_with(base));
    let Some(base_origin) = matched_base else {
        return output_folder_path.join(new_filename);
    };
    let Ok(rel_path) = source_path.strip_prefix(base_origin) else {
        return output_folder_path.join(new_filename);
    };
    let rel_dir = rel_path.parent().unwrap_or_else(|| Path::new(""));
    let rel_dir_is_safe = rel_dir.components().all(|component| {
        matches!(
            component,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    });
    if !rel_dir_is_safe {
        return output_folder_path.join(new_filename);
    }

    let full_dir = output_folder_path.join(rel_dir);
    if let Err(e) = std::fs::create_dir_all(&full_dir) {
        log::warn!("Failed to create export subdirectory: {}", e);
    }
    full_dir.join(new_filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request<'a>(
        image_path: &'a str,
        output_folder_path: &'a Path,
        base_origin_folders: &'a [String],
    ) -> ExportOutputTargetRequest<'a> {
        ExportOutputTargetRequest {
            image_path,
            output_folder_path,
            is_explicit_file_path: false,
            base_origin_folders,
            filename_template: "{original_filename}_edited",
            preserve_folders: false,
            output_format: "jpg",
            total_paths: 1,
            global_index: 0,
            appearance_count: 1,
            explicit_virtual_copy: None,
        }
    }

    #[test]
    fn resolves_batch_output_folder() {
        let output_folder = PathBuf::from("/tmp/exports");
        let target =
            resolve_export_output_target(request("/photos/alaska/raw1.raf", &output_folder, &[]));

        assert_eq!(target.output_path, output_folder.join("raw1_edited.jpg"));
    }

    #[test]
    fn preserves_safe_relative_folder() {
        let output_folder = PathBuf::from("/tmp/exports");
        let base = vec!["/photos".to_string()];
        let mut req = request("/photos/alaska/raw1.raf", &output_folder, &base);
        req.preserve_folders = true;

        let target = resolve_export_output_target(req);

        assert_eq!(
            target.output_path,
            output_folder.join("alaska").join("raw1_edited.jpg")
        );
    }

    #[test]
    fn explicit_single_output_uses_requested_file_path() {
        let output_file = PathBuf::from("/tmp/export/custom.jpg");
        let mut req = request("/photos/raw1.raf", &output_file, &[]);
        req.is_explicit_file_path = true;

        let target = resolve_export_output_target(req);

        assert_eq!(target.output_path, output_file);
    }

    #[test]
    fn appends_virtual_copy_suffix() {
        let output_folder = PathBuf::from("/tmp/exports");
        let mut req = request("/photos/raw1.raf?vc=3", &output_folder, &[]);
        req.explicit_virtual_copy = Some(3);

        let target = resolve_export_output_target(req);

        assert_eq!(
            target.output_path,
            output_folder.join("raw1_edited_VC03.jpg")
        );
    }

    #[test]
    fn appends_duplicate_appearance_suffix() {
        let output_folder = PathBuf::from("/tmp/exports");
        let mut req = request("/photos/raw1.raf", &output_folder, &[]);
        req.appearance_count = 2;

        let target = resolve_export_output_target(req);

        assert_eq!(
            target.output_path,
            output_folder.join("raw1_edited_VC01.jpg")
        );
    }
}
