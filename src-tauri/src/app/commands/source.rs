//! Source identity and availability commands.
//!
//! These commands are intentionally state-free. They normalize virtual-copy
//! paths once, then delegate source probing/identity to the library and IO
//! contracts without coupling the composition root to file details.

use std::path::PathBuf;

use crate::file_management::parse_virtual_path;

fn source_path(path: &str) -> PathBuf {
    let (source_path, _) = parse_virtual_path(path);
    source_path
}

#[tauri::command]
pub(crate) fn get_image_dimensions(path: String) -> Result<crate::ImageDimensions, String> {
    image::image_dimensions(source_path(&path))
        .map(|(width, height)| crate::ImageDimensions { width, height })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn is_original_file_available(path: String) -> bool {
    source_path(&path).exists()
}

#[tauri::command]
pub(crate) fn resolve_original_source_identity(
    path: String,
) -> Result<crate::io::reference_source_identity::ReferenceSourceIdentity, String> {
    crate::io::reference_source_identity::resolve_reference_source_identity(&source_path(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn virtual_copy_path_commands_probe_the_source_not_the_sidecar() {
        let source = std::env::temp_dir().join(format!(
            "rapidraw-source-command-{}-{}.png",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let source_string = source.to_string_lossy().into_owned();
        assert_eq!(source_path(&source_string), source);
        assert!(!is_original_file_available(source_string));
    }

    #[test]
    fn source_path_normalization_is_safe_for_concurrent_queries() {
        let path = std::env::temp_dir().join("rapidraw-source-command-concurrency.nef");
        let path = path.to_string_lossy().into_owned();
        let workers = (0..8)
            .map(|_| {
                let path = path.clone();
                thread::spawn(move || source_path(&path))
            })
            .collect::<Vec<_>>();
        for worker in workers {
            assert_eq!(
                worker.join().expect("source query worker"),
                PathBuf::from(&path)
            );
        }
    }
}
