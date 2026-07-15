use std::fs;

use image::DynamicImage;

use crate::app_settings::load_settings_or_default;
use crate::file_management::parse_virtual_path;
use crate::image_loader::load_and_composite;
use crate::raw::negative_lab_retouch::{
    NegativeLabDustSpotCandidate, detect_negative_lab_dust_spots,
};

#[tauri::command]
/// Loads, decodes, and analyzes a negative without editor state or a GPU runtime.
pub(crate) fn analyze_negative_lab_dust_spots(
    path: String,
    app_handle: tauri::AppHandle,
) -> Result<Vec<NegativeLabDustSpotCandidate>, String> {
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let settings = load_settings_or_default(&app_handle);
    let bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    let image = load_and_composite(
        &bytes,
        &source_path_str,
        &serde_json::json!({}),
        false,
        &settings,
        None,
    )
    .map_err(|error| error.to_string())?;
    Ok(analyze_loaded_image(&image))
}

fn analyze_loaded_image(image: &DynamicImage) -> Vec<NegativeLabDustSpotCandidate> {
    detect_negative_lab_dust_spots(&image.to_rgb32f())
}

#[cfg(test)]
mod tests {
    use image::{Rgb, Rgb32FImage};

    use super::*;

    #[test]
    fn command_core_detects_dust_without_app_state_or_gpu_runtime() {
        let mut image = Rgb32FImage::from_pixel(32, 32, Rgb([0.45, 0.45, 0.45]));
        image.put_pixel(16, 16, Rgb([1.0, 1.0, 1.0]));

        let candidates = analyze_loaded_image(&DynamicImage::ImageRgb32F(image));

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].polarity, "light");
        assert_eq!(candidates[0].candidate_id, "negative_lab_dust_16_16");
    }
}
