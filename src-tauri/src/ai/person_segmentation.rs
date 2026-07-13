#[cfg(any(target_os = "macos", test))]
use image::ImageFormat;
use image::{DynamicImage, GrayImage};
#[cfg(target_os = "macos")]
use std::io::Cursor;

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::AnyThread;
    use objc2::runtime::AnyObject;
    use objc2_core_video::{
        CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight,
        CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
        CVPixelBufferUnlockBaseAddress, kCVPixelFormatType_OneComponent8,
    };
    use objc2_foundation::{NSArray, NSData, NSDictionary};
    use objc2_vision::{
        VNDetectFaceRectanglesRequest, VNGeneratePersonSegmentationRequest,
        VNGeneratePersonSegmentationRequestQualityLevel, VNImageOption, VNImageRequestHandler,
        VNPixelBufferObservation, VNRequest,
    };
    use std::slice;

    pub fn generate_whole_person_mask(image: &DynamicImage) -> Result<GrayImage, String> {
        let mut png_bytes = Vec::new();
        DynamicImage::ImageRgba8(image.to_rgba8())
            .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
            .map_err(|error| error.to_string())?;

        unsafe {
            let image_data =
                NSData::dataWithBytes_length(png_bytes.as_ptr().cast(), png_bytes.len());
            let options = NSDictionary::<VNImageOption, AnyObject>::new();
            let handler = VNImageRequestHandler::initWithData_options(
                VNImageRequestHandler::alloc(),
                &image_data,
                options.as_ref(),
            );

            let request = VNGeneratePersonSegmentationRequest::new();
            request.setQualityLevel(VNGeneratePersonSegmentationRequestQualityLevel::Balanced);
            request.setOutputPixelFormat(kCVPixelFormatType_OneComponent8);

            let request_ref: &VNRequest = request.as_ref();
            let requests = NSArray::from_slice(&[request_ref]);
            handler
                .performRequests_error(&requests)
                .map_err(|error| error.localizedDescription().to_string())?;

            let observations = request
                .results()
                .ok_or_else(|| "Vision returned no person segmentation results".to_string())?;
            let observation = observations
                .firstObject()
                .ok_or_else(|| "Vision returned an empty person segmentation result".to_string())?;
            pixel_buffer_to_gray_image(&observation)
        }
    }

    pub fn generate_face_mask(image: &DynamicImage) -> Result<GrayImage, String> {
        let mut png_bytes = Vec::new();
        DynamicImage::ImageRgba8(image.to_rgba8())
            .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
            .map_err(|error| error.to_string())?;

        unsafe {
            let image_data =
                NSData::dataWithBytes_length(png_bytes.as_ptr().cast(), png_bytes.len());
            let options = NSDictionary::<VNImageOption, AnyObject>::new();
            let handler = VNImageRequestHandler::initWithData_options(
                VNImageRequestHandler::alloc(),
                &image_data,
                options.as_ref(),
            );

            let request = VNDetectFaceRectanglesRequest::new();
            let request_ref: &VNRequest = request.as_ref();
            let requests = NSArray::from_slice(&[request_ref]);
            handler
                .performRequests_error(&requests)
                .map_err(|error| error.localizedDescription().to_string())?;

            let observations = request
                .results()
                .ok_or_else(|| "Vision returned no face detection results".to_string())?;
            let observation = observations
                .firstObject()
                .ok_or_else(|| "Vision returned an empty face detection result".to_string())?;
            Ok(face_observation_to_soft_oval_mask(
                image.width(),
                image.height(),
                observation.boundingBox(),
            ))
        }
    }

    fn face_observation_to_soft_oval_mask(
        width: u32,
        height: u32,
        bounding_box: objc2_core_foundation::CGRect,
    ) -> GrayImage {
        let rect_width = bounding_box.size.width.max(0.01) as f32;
        let rect_height = bounding_box.size.height.max(0.01) as f32;
        let center_x = (bounding_box.origin.x as f32 + rect_width * 0.5) * width as f32;
        let center_y = (1.0 - bounding_box.origin.y as f32 - rect_height * 0.5) * height as f32;
        let radius_x = (rect_width * width as f32 * 0.58).max(1.0);
        let radius_y = (rect_height * height as f32 * 0.62).max(1.0);

        let mut mask = GrayImage::new(width, height);
        for y in 0..height {
            for x in 0..width {
                let dx = (x as f32 + 0.5 - center_x) / radius_x;
                let dy = (y as f32 + 0.5 - center_y) / radius_y;
                let distance = (dx * dx + dy * dy).sqrt();
                let alpha = if distance <= 1.0 {
                    255
                } else if distance < 1.15 {
                    ((1.15 - distance) / 0.15 * 255.0).round() as u8
                } else {
                    0
                };
                mask.put_pixel(x, y, image::Luma([alpha]));
            }
        }
        mask
    }

    fn pixel_buffer_to_gray_image(
        observation: &VNPixelBufferObservation,
    ) -> Result<GrayImage, String> {
        let pixel_buffer = unsafe { observation.pixelBuffer() };
        let lock_status =
            unsafe { CVPixelBufferLockBaseAddress(&pixel_buffer, CVPixelBufferLockFlags(0)) };
        if lock_status != 0 {
            return Err(format!(
                "CVPixelBuffer lock failed with status {lock_status}"
            ));
        }

        let width = CVPixelBufferGetWidth(&pixel_buffer);
        let height = CVPixelBufferGetHeight(&pixel_buffer);
        let bytes_per_row = CVPixelBufferGetBytesPerRow(&pixel_buffer);
        let base = CVPixelBufferGetBaseAddress(&pixel_buffer);
        if base.is_null() {
            unsafe { CVPixelBufferUnlockBaseAddress(&pixel_buffer, CVPixelBufferLockFlags(0)) };
            return Err("Vision mask pixel buffer had no base address".to_string());
        }

        let data = unsafe { slice::from_raw_parts(base.cast::<u8>(), bytes_per_row * height) };
        let mut mask = GrayImage::new(width as u32, height as u32);
        for y in 0..height {
            let row = &data[y * bytes_per_row..y * bytes_per_row + width];
            for (x, alpha) in row.iter().enumerate() {
                mask.put_pixel(x as u32, y as u32, image::Luma([*alpha]));
            }
        }

        unsafe { CVPixelBufferUnlockBaseAddress(&pixel_buffer, CVPixelBufferLockFlags(0)) };
        Ok(mask)
    }
}

#[cfg(all(target_os = "macos", any(feature = "ai", test)))]
pub use macos::{generate_face_mask, generate_whole_person_mask};

#[cfg(not(target_os = "macos"))]
pub fn generate_whole_person_mask(_image: &DynamicImage) -> Result<GrayImage, String> {
    Err("Whole-person masking requires macOS Vision".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn generate_face_mask(_image: &DynamicImage) -> Result<GrayImage, String> {
    Err("Face masking requires macOS Vision".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_settings::AppSettings;
    use crate::image_loader::load_base_image_from_bytes;
    use serde::Serialize;
    use std::fs;
    use std::path::{Path, PathBuf};

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PersonMaskPrivateProof {
        issue: u32,
        source_hash: String,
        source_media_kind: String,
        source_name: String,
        mask_coverage: f64,
        mask_hash: String,
        output_path: String,
        validation_mode: String,
    }

    #[test]
    fn private_face_mask_real_raw_proof_when_enabled() -> Result<(), String> {
        if std::env::var("RAWENGINE_RUN_PRIVATE_FACE_MASK_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            return Ok(());
        }

        let source_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_FACE_RAW_SOURCE")
                .map_err(|_| "RAWENGINE_PRIVATE_FACE_RAW_SOURCE is required".to_string())?,
        );
        let private_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_FACE_RAW_ROOT")
                .unwrap_or_else(|_| "/tmp/rawengine-face-mask-proof".to_string()),
        );
        let output_dir = private_root.join("private-artifacts/validation/face-mask");
        fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
        let scan_limit = std::env::var("RAWENGINE_PRIVATE_FACE_RAW_SCAN_LIMIT")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(24);

        for source_path in resolve_private_raw_candidates(&source_root)?
            .into_iter()
            .take(scan_limit)
        {
            let source_bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
            let source_path_string = source_path.to_string_lossy().to_string();
            let image = match load_base_image_from_bytes(
                &source_bytes,
                &source_path_string,
                false,
                &AppSettings::default(),
                None,
            ) {
                Ok(image) => image,
                Err(_) => continue,
            };

            let mask = match generate_face_mask(&image) {
                Ok(mask) => mask,
                Err(_) => continue,
            };
            let coverage = mask_coverage(&mask);
            if !(0.0001..=0.5).contains(&coverage) {
                continue;
            }

            let mask_path = output_dir.join("face-mask-private.png");
            mask.save_with_format(&mask_path, ImageFormat::Png)
                .map_err(|error| error.to_string())?;
            let proof = PersonMaskPrivateProof {
                issue: 3248,
                source_hash: hash_bytes(&source_bytes),
                source_media_kind: source_media_kind(&source_path).to_string(),
                source_name: source_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("private.raw")
                    .to_string(),
                mask_coverage: coverage,
                mask_hash: hash_bytes(&fs::read(&mask_path).map_err(|error| error.to_string())?),
                output_path: mask_path.to_string_lossy().to_string(),
                validation_mode: "private_raw_macos_vision_face_mask_runtime_proof".to_string(),
            };
            fs::write(
                output_dir.join("face-mask-private-proof.json"),
                serde_json::to_string_pretty(&proof).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            return Ok(());
        }

        Err(format!(
            "No face mask proof source found under {}",
            source_root.display()
        ))
    }

    #[test]
    fn private_whole_person_mask_real_raw_proof_when_enabled() -> Result<(), String> {
        if std::env::var("RAWENGINE_RUN_PRIVATE_WHOLE_PERSON_MASK_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            return Ok(());
        }

        let source_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_PERSON_RAW_SOURCE")
                .map_err(|_| "RAWENGINE_PRIVATE_PERSON_RAW_SOURCE is required".to_string())?,
        );
        let private_root = PathBuf::from(
            std::env::var("RAWENGINE_PRIVATE_PERSON_RAW_ROOT")
                .unwrap_or_else(|_| "/tmp/rawengine-whole-person-mask-proof".to_string()),
        );
        let output_dir = private_root.join("private-artifacts/validation/whole-person-mask");
        fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
        let scan_limit = std::env::var("RAWENGINE_PRIVATE_PERSON_RAW_SCAN_LIMIT")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(24);

        let mut rejected_sources = Vec::new();
        for source_path in resolve_private_raw_candidates(&source_root)?
            .into_iter()
            .take(scan_limit)
        {
            let source_bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
            let source_path_string = source_path.to_string_lossy().to_string();
            let image = match load_private_proof_image(&source_bytes, &source_path_string) {
                Ok(image) => image,
                Err(error) => {
                    rejected_sources
                        .push(format!("{}: load failed: {error}", source_path.display()));
                    continue;
                }
            };

            let mask = match generate_whole_person_mask(&image) {
                Ok(mask) => mask,
                Err(error) => {
                    rejected_sources
                        .push(format!("{}: mask failed: {error}", source_path.display()));
                    continue;
                }
            };
            let coverage = mask_coverage(&mask);
            if !(0.001..=0.85).contains(&coverage) {
                rejected_sources.push(format!(
                    "{}: coverage {coverage:.6} outside proof bounds",
                    source_path.display()
                ));
                continue;
            }

            let mask_path = output_dir.join("whole-person-mask-private.png");
            mask.save_with_format(&mask_path, ImageFormat::Png)
                .map_err(|error| error.to_string())?;
            let proof = PersonMaskPrivateProof {
                issue: 3247,
                source_hash: hash_bytes(&source_bytes),
                source_media_kind: source_media_kind(&source_path).to_string(),
                source_name: source_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("private-image")
                    .to_string(),
                mask_coverage: coverage,
                mask_hash: hash_bytes(&fs::read(&mask_path).map_err(|error| error.to_string())?),
                output_path: mask_path.to_string_lossy().to_string(),
                validation_mode: format!(
                    "private_{}_macos_vision_whole_person_mask_runtime_proof",
                    source_media_kind(&source_path)
                ),
            };
            fs::write(
                output_dir.join("whole-person-mask-private-proof.json"),
                serde_json::to_string_pretty(&proof).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            return Ok(());
        }

        let rejection_summary = rejected_sources
            .into_iter()
            .take(3)
            .collect::<Vec<_>>()
            .join("; ");
        Err(format!(
            "No whole-person mask proof source found under {}. {rejection_summary}",
            source_root.display()
        ))
    }

    fn resolve_private_raw_candidates(source: &Path) -> Result<Vec<PathBuf>, String> {
        if source.is_file() {
            return Ok(vec![source.to_path_buf()]);
        }

        let mut candidates: Vec<PathBuf> = fs::read_dir(source)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| {
                        matches!(
                            extension.to_ascii_lowercase().as_str(),
                            "arw"
                                | "cr2"
                                | "cr3"
                                | "dng"
                                | "nef"
                                | "raf"
                                | "jpg"
                                | "jpeg"
                                | "png"
                                | "tif"
                                | "tiff"
                        )
                    })
                    .unwrap_or(false)
            })
            .collect();
        candidates.sort();
        Ok(candidates)
    }

    fn load_private_proof_image(bytes: &[u8], path: &str) -> Result<DynamicImage, String> {
        load_base_image_from_bytes(bytes, path, false, &AppSettings::default(), None)
            .or_else(|_| image::load_from_memory(bytes).map_err(|error| error.to_string()))
    }

    fn source_media_kind(path: &Path) -> &'static str {
        match path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("arw" | "cr2" | "cr3" | "dng" | "nef" | "raf") => "raw",
            _ => "raster",
        }
    }

    fn mask_coverage(mask: &GrayImage) -> f64 {
        let covered = mask.pixels().filter(|pixel| pixel[0] > 0).count() as f64;
        covered / f64::from(mask.width() * mask.height())
    }

    fn hash_bytes(bytes: &[u8]) -> String {
        format!("blake3:{}", blake3::hash(bytes).to_hex())
    }
}
