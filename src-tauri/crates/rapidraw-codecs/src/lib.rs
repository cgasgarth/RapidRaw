//! Native codec implementations kept outside the application crate.
//!
//! Baseline JPEG remains available to preview/render paths. Advanced JXL and WebP support is an
//! explicit feature so capability-limited builds do not link those codec implementations.

pub fn require_advanced_codecs() -> Result<(), rapidraw_types::CapabilityUnavailable> {
    if cfg!(feature = "advanced") {
        Ok(())
    } else {
        Err(rapidraw_types::CapabilityUnavailable::new(
            rapidraw_types::NativeCapability::AdvancedCodecs,
        ))
    }
}

#[cfg(feature = "jpeg")]
use imgref::ImgRef;
#[cfg(feature = "jpeg")]
use mozjpeg_rs::{Encoder, Preset};
#[cfg(feature = "jpeg")]
use rgb::{FromSlice, RGBA8};

#[cfg(feature = "jpeg")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JpegPreset {
    Fastest,
    Balanced,
}

#[cfg(feature = "jpeg")]
fn encoder(preset: JpegPreset, quality: u8) -> Encoder {
    let preset = match preset {
        JpegPreset::Fastest => Preset::BaselineFastest,
        JpegPreset::Balanced => Preset::BaselineBalanced,
    };
    Encoder::new(preset).quality(quality.clamp(1, 100))
}

#[cfg(feature = "jpeg")]
pub fn encode_jpeg_rgb(
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    preset: JpegPreset,
    icc_profile: Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let expected = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(3))
        .ok_or_else(|| "jpeg_dimensions_overflow".to_string())?;
    if pixels.len() != expected {
        return Err("jpeg_rgb_shape_mismatch".to_string());
    }
    let encoder = encoder(preset, quality);
    let encoder = if let Some(profile) = icc_profile {
        encoder.icc_profile(profile)
    } else {
        encoder
    };
    encoder
        .encode_rgb(pixels, width, height)
        .map_err(|error| error.to_string())
}

#[cfg(feature = "jpeg")]
pub fn encode_jpeg_rgba(
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let expected = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "jpeg_dimensions_overflow".to_string())?;
    if pixels.len() != expected {
        return Err("jpeg_rgba_shape_mismatch".to_string());
    }
    let rgba: &[RGBA8] = pixels.as_rgba();
    encoder(JpegPreset::Fastest, quality)
        .fast_color(true)
        .encode_imgref(ImgRef::new(rgba, width as usize, height as usize))
        .map_err(|error| error.to_string())
}

#[cfg(feature = "advanced")]
pub fn encode_jxl(image: &image::DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    use image::GenericImageView;
    use jxl_encoder::{LosslessConfig, LossyConfig, PixelLayout};

    let (width, height) = image.dimensions();
    let has_alpha = image.color().has_alpha();
    if quality == 100 {
        if has_alpha {
            let rgba = image.to_rgba8();
            LosslessConfig::new()
                .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                .map_err(|error| error.to_string())
        } else {
            let rgb = image.to_rgb8();
            LosslessConfig::new()
                .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                .map_err(|error| error.to_string())
        }
    } else {
        let distance = ((100.0 - f32::from(quality)) / 10.0).max(0.01);
        if has_alpha {
            let rgba = image.to_rgba8();
            LossyConfig::new(distance)
                .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                .map_err(|error| error.to_string())
        } else {
            let rgb = image.to_rgb8();
            LossyConfig::new(distance)
                .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                .map_err(|error| error.to_string())
        }
    }
}

#[cfg(feature = "advanced")]
pub fn encode_webp(image: &image::DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    webp::Encoder::from_image(image)
        .map(|encoder| encoder.encode(f32::from(quality)).to_vec())
        .map_err(|_| "webp_encoder_creation_failed".to_string())
}

#[cfg(feature = "advanced")]
pub fn register_jxl_decoding_hook() {
    jxl_oxide::integration::register_image_decoding_hook();
}

#[cfg(all(test, feature = "jpeg"))]
mod tests {
    use super::*;

    #[test]
    fn jpeg_rgb_and_rgba_paths_emit_decodable_dimensions() {
        let rgb = encode_jpeg_rgb(&[32; 4 * 3 * 3], 4, 3, 82, JpegPreset::Balanced, None)
            .expect("RGB JPEG encodes");
        let rgba = encode_jpeg_rgba(&[64; 4 * 3 * 4], 4, 3, 82).expect("RGBA JPEG encodes");
        for bytes in [rgb, rgba] {
            assert!(bytes.starts_with(&[0xff, 0xd8]));
            assert!(bytes.ends_with(&[0xff, 0xd9]));
        }
    }

    #[cfg(not(feature = "advanced"))]
    #[test]
    fn disabled_advanced_codecs_return_stable_typed_capability_error() {
        let error = require_advanced_codecs().unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "code": "capability_unavailable",
                "capability": "advancedCodecs"
            })
        );
    }
}

#[cfg(all(test, feature = "advanced"))]
mod advanced_tests {
    use super::*;
    use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba};

    #[test]
    fn advanced_codecs_round_trip_real_pixels() {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_fn(7, 5, |x, y| {
            Rgba([(x * 17) as u8, (y * 23) as u8, 91, 255])
        }));
        let jxl = encode_jxl(&image, 100).expect("JXL encodes");
        let webp = encode_webp(&image, 90).expect("WebP encodes");
        let decoded_jxl = jxl_oxide::JxlImage::builder()
            .read(std::io::Cursor::new(jxl))
            .expect("JXL decodes through production decoder");
        assert_eq!((decoded_jxl.width(), decoded_jxl.height()), (7, 5));
        assert_eq!(image::load_from_memory(&webp).unwrap().dimensions(), (7, 5));
    }
}
