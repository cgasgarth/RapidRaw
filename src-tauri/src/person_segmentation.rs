use image::{DynamicImage, GrayImage, ImageFormat};
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
        VNGeneratePersonSegmentationRequest, VNGeneratePersonSegmentationRequestQualityLevel,
        VNImageOption, VNImageRequestHandler, VNPixelBufferObservation, VNRequest,
    };
    use std::slice;

    pub fn generate_whole_person_mask(image: &DynamicImage) -> Result<GrayImage, String> {
        let mut png_bytes = Vec::new();
        image
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

#[cfg(target_os = "macos")]
pub use macos::generate_whole_person_mask;

#[cfg(not(target_os = "macos"))]
pub fn generate_whole_person_mask(_image: &DynamicImage) -> Result<GrayImage, String> {
    Err("Whole-person masking requires macOS Vision".to_string())
}
