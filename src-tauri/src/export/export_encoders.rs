use std::io::Cursor;

use image::{
    DynamicImage, ExtendedColorType, ImageDecoder, ImageEncoder, ImageFormat,
    codecs::{
        jpeg::JpegDecoder,
        tiff::{TiffDecoder, TiffEncoder},
    },
};
use rapidraw_codecs::JpegPreset;
use sha2::{Digest, Sha256};

use crate::color::working_to_output_transform::WorkingColorState;
use crate::export::export_color_policy::{
    export_rgb16_pixels_with_working_color_state, output_color_profile,
};
use crate::export::export_processing::{
    ExportColorProfile, ExportReceiptMetadata, ExportRenderingIntent, encode_icc_profile,
    export_receipt_metadata, export_source_precision_receipt_label, export_source_rgb16_pixels,
    quantize_rgb16_to_rgb8, validate_export_color_policy,
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
    encode_image_with_working_color_state(
        image,
        WorkingColorState::EncodedSrgbV1,
        output_format,
        jpeg_quality,
        color_profile,
        rendering_intent,
        black_point_compensation,
        source_embedded_icc,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn encode_image_with_working_color_state(
    image: &DynamicImage,
    source_color_state: WorkingColorState,
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
            #[cfg(not(feature = "advanced-codecs"))]
            return Err(advanced_codecs_unavailable());
            #[cfg(feature = "advanced-codecs")]
            let jxl_data = rapidraw_codecs::encode_jxl(image, jpeg_quality)
                .map_err(|error| format!("Failed to encode JXL: {error}"))?;

            return Ok(EncodedExportImage {
                bytes: jxl_data,
                color_policy: None,
            });
        }
        "webp" => {
            #[cfg(not(feature = "advanced-codecs"))]
            return Err(advanced_codecs_unavailable());
            #[cfg(feature = "advanced-codecs")]
            let webp_mem = rapidraw_codecs::encode_webp(image, jpeg_quality)
                .map_err(|error| format!("Failed to encode WebP: {error}"))?;
            return Ok(EncodedExportImage {
                bytes: webp_mem,
                color_policy: None,
            });
        }
        "jpg" | "jpeg" => {
            let bytes = encode_jpeg_to_bytes(
                image,
                source_color_state,
                jpeg_quality,
                color_profile,
                rendering_intent,
                black_point_compensation,
                source_embedded_icc,
            )?;
            let color_policy = export_receipt_metadata(
                &normalized_format,
                color_profile,
                rendering_intent,
                black_point_compensation,
                &export_source_precision_receipt_label(image),
                source_embedded_icc.map(|profile| profile.sha256.clone()),
            );
            validate_export_file_readback_color_policy(
                &bytes,
                &normalized_format,
                color_policy.as_ref(),
                color_profile,
                rendering_intent,
                black_point_compensation,
                source_embedded_icc,
            )?;

            return Ok(EncodedExportImage {
                bytes,
                color_policy,
            });
        }
        "png" => {
            let image_to_encode = match image {
                DynamicImage::ImageRgb32F(_) => DynamicImage::ImageRgb16(image.to_rgb16()),
                DynamicImage::ImageRgba32F(_) => DynamicImage::ImageRgba16(image.to_rgba16()),
                _ => image.clone(),
            };

            image_to_encode
                .write_to(&mut cursor, ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        }
        "tiff" => {
            let bytes = encode_tiff16_to_bytes(
                image,
                source_color_state,
                color_profile,
                rendering_intent,
                black_point_compensation,
                source_embedded_icc,
            )?;
            let color_policy = export_receipt_metadata(
                &normalized_format,
                color_profile,
                rendering_intent,
                black_point_compensation,
                &export_source_precision_receipt_label(image),
                source_embedded_icc.map(|profile| profile.sha256.clone()),
            );
            validate_export_file_readback_color_policy(
                &bytes,
                &normalized_format,
                color_policy.as_ref(),
                color_profile,
                rendering_intent,
                black_point_compensation,
                source_embedded_icc,
            )?;

            return Ok(EncodedExportImage {
                bytes,
                color_policy,
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

pub(crate) fn validate_export_file_readback_color_policy(
    bytes: &[u8],
    output_format: &str,
    metadata: Option<&ExportReceiptMetadata>,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_embedded_icc: Option<&EmbeddedSourceIccProfile>,
) -> Result<(), String> {
    let Some(metadata) = metadata else {
        return Ok(());
    };
    let normalized_format = output_format.to_lowercase();
    let readback = readback_export_icc_profile(bytes, &normalized_format)?;

    if metadata.icc_embedded && readback.icc_profile.is_none() {
        return Err(format!(
            "Export ICC/receipt parity failed: receipt says ICC embedded for {normalized_format}, but file readback found none."
        ));
    }
    if !metadata.icc_embedded && readback.icc_profile.is_some() {
        return Err(format!(
            "Export ICC/receipt parity failed: receipt says no ICC embedded for {normalized_format}, but file readback found one."
        ));
    }
    if metadata.bit_depth != readback.bit_depth {
        return Err(format!(
            "Export ICC/receipt parity failed: receipt bit depth {} does not match file readback {}.",
            metadata.bit_depth, readback.bit_depth
        ));
    }

    let expected_metadata = export_receipt_metadata(
        &normalized_format,
        color_profile,
        rendering_intent,
        black_point_compensation,
        &metadata.source_precision_path,
        metadata.source_icc_profile_hash.clone(),
    )
    .ok_or_else(|| {
        "Export ICC/receipt parity failed: managed export did not resolve expected receipt metadata."
            .to_string()
    })?;
    compare_receipt_metadata(metadata, &expected_metadata)?;

    if let Some(embedded_icc) = readback.icc_profile {
        validate_readback_icc_profile(&embedded_icc, color_profile, metadata, source_embedded_icc)?;
    }

    Ok(())
}

#[derive(Debug)]
struct ExportFileReadback {
    bit_depth: u8,
    icc_profile: Option<Vec<u8>>,
}

fn readback_export_icc_profile(
    bytes: &[u8],
    output_format: &str,
) -> Result<ExportFileReadback, String> {
    match output_format {
        "jpg" | "jpeg" => {
            let mut decoder = JpegDecoder::new(Cursor::new(bytes))
                .map_err(|error| format!("Failed to read back JPEG export ICC profile: {error}"))?;
            let bit_depth = match decoder.color_type() {
                image::ColorType::Rgb8 | image::ColorType::Rgba8 | image::ColorType::L8 => 8,
                other => {
                    return Err(format!(
                        "Export ICC/receipt parity failed: JPEG readback color type {other:?} is not an 8-bit export."
                    ));
                }
            };
            let icc_profile = decoder
                .icc_profile()
                .map_err(|error| format!("Failed to read back JPEG export ICC profile: {error}"))?;

            Ok(ExportFileReadback {
                bit_depth,
                icc_profile,
            })
        }
        "tif" | "tiff" => {
            let mut decoder = TiffDecoder::new(Cursor::new(bytes))
                .map_err(|error| format!("Failed to read back TIFF export ICC profile: {error}"))?;
            let bit_depth = match decoder.color_type() {
                image::ColorType::Rgb16 | image::ColorType::Rgba16 | image::ColorType::L16 => 16,
                other => {
                    return Err(format!(
                        "Export ICC/receipt parity failed: TIFF readback color type {other:?} is not a 16-bit export."
                    ));
                }
            };
            let icc_profile = decoder
                .icc_profile()
                .map_err(|error| format!("Failed to read back TIFF export ICC profile: {error}"))?;

            Ok(ExportFileReadback {
                bit_depth,
                icc_profile,
            })
        }
        _ => Ok(ExportFileReadback {
            bit_depth: 0,
            icc_profile: None,
        }),
    }
}

fn compare_receipt_metadata(
    actual: &ExportReceiptMetadata,
    expected: &ExportReceiptMetadata,
) -> Result<(), String> {
    let mut mismatches = Vec::new();
    if actual.icc_embedded != expected.icc_embedded {
        mismatches.push("iccEmbedded");
    }
    if actual.effective_color_profile != expected.effective_color_profile {
        mismatches.push("effectiveColorProfile");
    }
    if actual.requested_color_profile != expected.requested_color_profile {
        mismatches.push("requestedColorProfile");
    }
    if actual.requested_rendering_intent != expected.requested_rendering_intent {
        mismatches.push("requestedRenderingIntent");
    }
    if actual.effective_rendering_intent != expected.effective_rendering_intent {
        mismatches.push("effectiveRenderingIntent");
    }
    if actual.color_managed_transform != expected.color_managed_transform {
        mismatches.push("colorManagedTransform");
    }
    if actual.policy_status != expected.policy_status {
        mismatches.push("policyStatus");
    }
    if actual.policy_version != expected.policy_version {
        mismatches.push("policyVersion");
    }
    if actual.source_icc_profile_hash != expected.source_icc_profile_hash {
        mismatches.push("sourceIccProfileHash");
    }
    if actual.source_precision_path != expected.source_precision_path {
        mismatches.push("sourcePrecisionPath");
    }
    if actual.transform_applied != expected.transform_applied {
        mismatches.push("transformApplied");
    }
    if actual.transform_policy_fingerprint != expected.transform_policy_fingerprint {
        mismatches.push("transformPolicyFingerprint");
    }

    if mismatches.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Export ICC/receipt parity failed: receipt fields diverged from resolved export policy: {}.",
            mismatches.join(", ")
        ))
    }
}

fn validate_readback_icc_profile(
    embedded_icc: &[u8],
    color_profile: &ExportColorProfile,
    metadata: &ExportReceiptMetadata,
    source_embedded_icc: Option<&EmbeddedSourceIccProfile>,
) -> Result<(), String> {
    if matches!(color_profile, ExportColorProfile::SourceEmbedded) {
        let source_profile = source_embedded_icc.ok_or_else(|| {
            "Export ICC/receipt parity failed: SourceEmbedded receipt requires source ICC context."
                .to_string()
        })?;
        let readback_hash = format!("sha256:{}", hex::encode(Sha256::digest(embedded_icc)));
        if metadata.source_icc_profile_hash.as_deref() != Some(source_profile.sha256.as_str()) {
            return Err(
                "Export ICC/receipt parity failed: SourceEmbedded receipt hash does not match source ICC context."
                    .to_string(),
            );
        }
        if readback_hash != source_profile.sha256 {
            return Err(format!(
                "Export ICC/receipt parity failed: SourceEmbedded file ICC hash {readback_hash} does not match receipt/source hash {}.",
                source_profile.sha256
            ));
        }
        return Ok(());
    }

    let expected_profile = output_color_profile(color_profile)?;
    let expected_icc = encode_icc_profile(&expected_profile)?;
    if normalize_icc_creation_time(embedded_icc.to_vec())
        != normalize_icc_creation_time(expected_icc)
    {
        return Err(format!(
            "Export ICC/receipt parity failed: embedded ICC does not match {} receipt profile.",
            metadata.effective_color_profile
        ));
    }

    Ok(())
}

fn normalize_icc_creation_time(mut profile: Vec<u8>) -> Vec<u8> {
    if profile.len() >= 36 {
        profile[24..36].fill(0);
    }
    profile
}

fn encode_tiff16_to_bytes(
    image: &DynamicImage,
    source_color_state: WorkingColorState,
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
            let (pixels, width, height, output_profile) =
                export_rgb16_pixels_with_working_color_state(
                    image,
                    source_color_state,
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
    source_color_state: WorkingColorState,
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
            let (rgb16_pixels, width, height, output_profile) =
                export_rgb16_pixels_with_working_color_state(
                    image,
                    source_color_state,
                    color_profile,
                    rendering_intent,
                    black_point_compensation,
                )?;
            (
                quantize_rgb16_to_rgb8(&rgb16_pixels),
                width,
                height,
                encode_icc_profile(&output_profile)?,
            )
        };

    rapidraw_codecs::encode_jpeg_rgb(
        &rgb_pixels,
        width,
        height,
        jpeg_quality,
        JpegPreset::Balanced,
        Some(icc_profile),
    )
    .map_err(|e| format!("Failed to encode JPEG: {}", e))
}

#[cfg(not(feature = "advanced-codecs"))]
fn advanced_codecs_unavailable() -> String {
    let unavailable = rapidraw_codecs::require_advanced_codecs()
        .expect_err("advanced codec fallback only runs when the capability is disabled");
    serde_json::to_string(&unavailable).expect("capability-unavailable contract serializes")
}
