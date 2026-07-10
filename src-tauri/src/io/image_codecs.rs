use std::io::Cursor;

use base64::{Engine as _, engine::general_purpose};
use image::{DynamicImage, GenericImageView, ImageFormat};
use mozjpeg_rs::{Encoder, Preset};
use tauri::ipc::Response;

use crate::formats::{jpeg_data_url, png_data_url};

pub(crate) fn encode_jpeg_bytes(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let (width, height) = image.dimensions();
    let rgb_pixels = image.to_rgb8().into_vec();
    Encoder::new(Preset::BaselineFastest)
        .quality(quality)
        .encode_rgb(&rgb_pixels, width, height)
        .map_err(|e| format!("Failed to encode JPEG preview with mozjpeg-rs: {}", e))
}

pub(crate) fn encode_jpeg_data_url(image: &DynamicImage, quality: u8) -> Result<String, String> {
    let bytes = encode_jpeg_bytes(image, quality)?;
    Ok(jpeg_data_url(general_purpose::STANDARD.encode(&bytes)))
}

pub(crate) fn encode_jpeg_response(image: &DynamicImage, quality: u8) -> Result<Response, String> {
    encode_jpeg_bytes(image, quality).map(Response::new)
}

pub(crate) fn encode_png_data_url(image: &DynamicImage) -> Result<String, String> {
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|error| format!("Failed to encode PNG data URL: {}", error))?;
    Ok(png_data_url(
        general_purpose::STANDARD.encode(png.get_ref()),
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        encode_jpeg_bytes, encode_jpeg_data_url, encode_jpeg_response, encode_png_data_url,
    };
    use crate::formats::{JPEG_DATA_URL_PREFIX, PNG_DATA_URL_PREFIX};
    use image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, Rgba};

    #[test]
    fn jpeg_helpers_encode_response_and_data_url() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(4, 4, Rgba([20, 40, 60, 255])));
        let data_url = encode_jpeg_data_url(&image, 75).expect("jpeg data url should encode");
        encode_jpeg_response(&image, 75).expect("jpeg response should encode");
        let bytes = encode_jpeg_bytes(&image, 75).expect("jpeg bytes should encode");
        let decoded = image::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
            .expect("encoded JPEG should decode through the native image decoder");

        assert!(data_url.starts_with(JPEG_DATA_URL_PREFIX));
        assert!(!bytes.is_empty());
        assert_eq!(decoded.dimensions(), (4, 4));
    }

    #[test]
    fn png_helper_encodes_data_url() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(4, 4, Rgba([20, 40, 60, 128])));
        let data_url = encode_png_data_url(&image).expect("png data url should encode");

        assert!(data_url.starts_with(PNG_DATA_URL_PREFIX));
    }
}
