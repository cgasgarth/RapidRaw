use std::io::Cursor;

use image::{
    DynamicImage, ExtendedColorType, GenericImageView, ImageEncoder, ImageFormat,
    codecs::tiff::TiffEncoder,
};
use jxl_encoder::{LosslessConfig, LossyConfig, PixelLayout};
use mozjpeg_rs::{Encoder as MozJpegEncoder, Preset};

use crate::export_processing::{
    ExportColorProfile, ExportReceiptMetadata, ExportRenderingIntent, encode_icc_profile,
    export_jpeg_rgb_pixels_and_profile, export_receipt_metadata, export_rgb16_pixels_and_profile,
    export_source_precision_receipt_label, export_source_rgb16_pixels, quantize_rgb16_to_rgb8,
    validate_export_color_policy,
};

#[derive(Debug)]
pub(crate) struct EncodedExportImage {
    pub(crate) bytes: Vec<u8>,
    pub(crate) color_policy: Option<ExportReceiptMetadata>,
}

#[derive(Debug)]
pub(crate) struct EmbeddedSourceIccProfile {
    pub(crate) bytes: Vec<u8>,
    pub(crate) sha256: String,
}

pub(crate) fn encode_image_to_bytes(
    image: &DynamicImage,
    output_format: &str,
    jpeg_quality: u8,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> Result<Vec<u8>, String> {
    encode_image_with_applied_policy(
        image,
        output_format,
        jpeg_quality,
        color_profile,
        rendering_intent,
        false,
    )
    .map(|encoded| encoded.bytes)
}

pub(crate) fn encode_image_with_applied_policy(
    image: &DynamicImage,
    output_format: &str,
    jpeg_quality: u8,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<EncodedExportImage, String> {
    encode_image_with_applied_policy_and_source_profile(
        image,
        output_format,
        jpeg_quality,
        color_profile,
        rendering_intent,
        black_point_compensation,
        None,
    )
}

pub(crate) fn encode_image_with_applied_policy_and_source_profile(
    image: &DynamicImage,
    output_format: &str,
    jpeg_quality: u8,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_embedded_icc: Option<&EmbeddedSourceIccProfile>,
) -> Result<EncodedExportImage, String> {
    validate_export_color_policy(output_format, color_profile)?;
    let normalized_format = output_format.to_lowercase();

    let mut image_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut image_bytes);

    match normalized_format.as_str() {
        "jxl" => {
            let (width, height) = image.dimensions();
            let has_alpha = image.color().has_alpha();

            let jxl_data = if jpeg_quality == 100 {
                if has_alpha {
                    let rgba = image.to_rgba8();
                    LosslessConfig::new()
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    LosslessConfig::new()
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                }
            } else {
                let distance = (100.0 - jpeg_quality as f32) / 10.0;
                let distance = distance.max(0.01);

                if has_alpha {
                    let rgba = image.to_rgba8();
                    LossyConfig::new(distance)
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    LossyConfig::new(distance)
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                }
            };

            return Ok(EncodedExportImage {
                bytes: jxl_data,
                color_policy: None,
            });
        }
        "webp" => {
            let encoder = webp::Encoder::from_image(image)
                .map_err(|_| "Failed to create WebP encoder".to_string())?;
            let webp_mem = encoder.encode(jpeg_quality as f32);
            return Ok(EncodedExportImage {
                bytes: webp_mem.to_vec(),
                color_policy: None,
            });
        }
        "jpg" | "jpeg" => {
            return Ok(EncodedExportImage {
                bytes: encode_jpeg_to_bytes(
                    image,
                    jpeg_quality,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                    source_embedded_icc,
                )?,
                color_policy: export_receipt_metadata(
                    &normalized_format,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                    &export_source_precision_receipt_label(image),
                    source_embedded_icc.map(|profile| profile.sha256.clone()),
                ),
            });
        }
        "png" => {
            let image_to_encode = if image.as_rgb32f().is_some() {
                DynamicImage::ImageRgb16(image.to_rgb16())
            } else {
                image.clone()
            };

            image_to_encode
                .write_to(&mut cursor, ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        }
        "tiff" => {
            return Ok(EncodedExportImage {
                bytes: encode_tiff16_to_bytes(
                    image,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                    source_embedded_icc,
                )?,
                color_policy: export_receipt_metadata(
                    &normalized_format,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                    &export_source_precision_receipt_label(image),
                    source_embedded_icc.map(|profile| profile.sha256.clone()),
                ),
            });
        }
        "avif" => {
            image
                .write_to(&mut cursor, ImageFormat::Avif)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unsupported file format: {}", output_format)),
    };
    Ok(EncodedExportImage {
        bytes: image_bytes,
        color_policy: None,
    })
}

fn encode_tiff16_to_bytes(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_embedded_icc: Option<&EmbeddedSourceIccProfile>,
) -> Result<Vec<u8>, String> {
    let (pixels, width, height, icc_profile) =
        if matches!(color_profile, ExportColorProfile::SourceEmbedded) {
            let (pixels, width, height) =
                export_source_rgb16_pixels(image, color_profile, rendering_intent);
            let source_icc = source_embedded_icc.ok_or_else(|| {
                "Source embedded export profile requires a source ICC profile.".to_string()
            })?;
            (pixels, width, height, source_icc.bytes.clone())
        } else {
            let (pixels, width, height, output_profile) = export_rgb16_pixels_and_profile(
                image,
                color_profile,
                rendering_intent,
                black_point_compensation,
            )?;
            (pixels, width, height, encode_icc_profile(&output_profile)?)
        };
    let mut image_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut image_bytes);
    let mut encoder = TiffEncoder::new(&mut cursor);

    encoder
        .set_icc_profile(icc_profile)
        .map_err(|e| format!("Failed to attach TIFF ICC profile: {}", e))?;
    encoder
        .write_image(
            bytemuck::cast_slice(&pixels),
            width,
            height,
            ExtendedColorType::Rgb16,
        )
        .map_err(|e| format!("Failed to encode 16-bit TIFF: {}", e))?;

    Ok(image_bytes)
}

fn encode_jpeg_to_bytes(
    image: &DynamicImage,
    jpeg_quality: u8,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_embedded_icc: Option<&EmbeddedSourceIccProfile>,
) -> Result<Vec<u8>, String> {
    let (rgb_pixels, width, height, icc_profile) =
        if matches!(color_profile, ExportColorProfile::SourceEmbedded) {
            let (rgb16_pixels, width, height) =
                export_source_rgb16_pixels(image, color_profile, rendering_intent);
            let source_icc = source_embedded_icc.ok_or_else(|| {
                "Source embedded export profile requires a source ICC profile.".to_string()
            })?;
            (
                quantize_rgb16_to_rgb8(&rgb16_pixels),
                width,
                height,
                source_icc.bytes.clone(),
            )
        } else {
            let (rgb_pixels, width, height, output_profile) = export_jpeg_rgb_pixels_and_profile(
                image,
                color_profile,
                rendering_intent,
                black_point_compensation,
            )?;
            (
                rgb_pixels,
                width,
                height,
                encode_icc_profile(&output_profile)?,
            )
        };

    MozJpegEncoder::new(Preset::BaselineBalanced)
        .quality(jpeg_quality.clamp(1, 100))
        .icc_profile(icc_profile)
        .encode_rgb(&rgb_pixels, width, height)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))
}
