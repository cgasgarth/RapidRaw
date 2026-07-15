use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose};
use image::ImageFormat;

use crate::file_management::parse_virtual_path;
use crate::formats::PNG_DATA_URL_PREFIX;

#[tauri::command]
pub(crate) fn save_collage(base64_data: String, first_path_str: String) -> Result<String, String> {
    let (first_path, _) = parse_virtual_path(&first_path_str);
    let parent = first_path
        .parent()
        .ok_or_else(|| "Could not determine parent directory of the first image.".to_string())?;
    let stem = first_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("collage");
    let output = save_collage_data_url(parent, stem, &base64_data)?;
    Ok(output.to_string_lossy().into_owned())
}

fn save_collage_data_url(
    parent: &Path,
    source_stem: &str,
    data_url: &str,
) -> Result<PathBuf, String> {
    let png_bytes = decode_png_data_url(data_url)?;
    publish_collage(parent, source_stem, &png_bytes)
}

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .strip_prefix(PNG_DATA_URL_PREFIX)
        .ok_or_else(|| "Invalid base64 data format".to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Failed to decode base64: {error}"))?;
    let image = image::load_from_memory_with_format(&bytes, ImageFormat::Png)
        .map_err(|error| format!("Invalid PNG collage payload: {error}"))?;
    if image.width() == 0 || image.height() == 0 {
        return Err("Invalid PNG collage payload: empty image".to_string());
    }
    Ok(bytes)
}

fn publish_collage(parent: &Path, source_stem: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    for suffix in 1_u32.. {
        let filename = if suffix == 1 {
            format!("{source_stem}_Collage.png")
        } else {
            format!("{source_stem}_Collage_{suffix}.png")
        };
        let output = parent.join(filename);
        let mut temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| format!("Failed to create collage staging file: {error}"))?;
        temporary
            .write_all(bytes)
            .map_err(|error| format!("Failed to write collage staging file: {error}"))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| format!("Failed to sync collage staging file: {error}"))?;
        match temporary.persist_noclobber(&output) {
            Ok(_) => {
                File::open(parent)
                    .and_then(|directory| directory.sync_all())
                    .map_err(|error| format!("Failed to sync collage directory: {error}"))?;
                return Ok(output);
            }
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to publish collage image: {}", error.error)),
        }
    }
    unreachable!("u32 collage suffix space exhausted")
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{DynamicImage, Rgba, RgbaImage};

    use super::*;

    fn png_bytes(color: [u8; 4]) -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba(color)));
        let mut cursor = Cursor::new(Vec::new());
        image.write_to(&mut cursor, ImageFormat::Png).unwrap();
        cursor.into_inner()
    }

    #[test]
    fn invalid_png_is_rejected_before_any_output_is_created() {
        let directory = tempfile::tempdir().unwrap();
        let encoded = general_purpose::STANDARD.encode(b"not a png");
        let error = save_collage_data_url(
            directory.path(),
            "frame",
            &format!("{PNG_DATA_URL_PREFIX}{encoded}"),
        )
        .unwrap_err();

        assert!(error.starts_with("Invalid PNG collage payload:"));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn publish_is_atomic_and_never_clobbers_an_existing_collage() {
        let directory = tempfile::tempdir().unwrap();
        let first = png_bytes([255, 0, 0, 255]);
        let second = png_bytes([0, 0, 255, 255]);

        let first_path = publish_collage(directory.path(), "frame", &first).unwrap();
        let second_path = publish_collage(directory.path(), "frame", &second).unwrap();

        assert_eq!(first_path.file_name().unwrap(), "frame_Collage.png");
        assert_eq!(second_path.file_name().unwrap(), "frame_Collage_2.png");
        assert_eq!(std::fs::read(first_path).unwrap(), first);
        assert_eq!(std::fs::read(second_path).unwrap(), second);
        assert!(std::fs::read_dir(directory.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".tmp")
        }));
    }
}
