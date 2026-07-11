use std::io::Cursor;

use base64::Engine;
use image::{ImageFormat, Rgba, RgbaImage};

use super::{
    alignment::{RectF64, SimilarityTransform},
    raw_frame::{DecodedFocusSource, RegistrationFrame},
};

pub(crate) const WARP_ID: &str = "focus_inverse_bicubic_transparent_v1";

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourcePreview {
    pub source_index: usize,
    pub reference_data_url: String,
    pub overlay_data_url: String,
    pub difference_data_url: String,
    pub preview_hash: String,
    pub width: u32,
    pub height: u32,
    pub compensation_applied: bool,
}

pub(crate) fn render_previews(
    sources: &[DecodedFocusSource],
    transforms: &[SimilarityTransform],
    reference_source_index: usize,
    crop: &RectF64,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<Vec<SourcePreview>, String> {
    let reference = sources
        .iter()
        .find(|source| source.source_index == reference_source_index)
        .ok_or_else(|| "focus_preview_reference_missing".to_string())?;
    let reference_transform = transforms
        .iter()
        .find(|transform| transform.source_index == reference_source_index)
        .ok_or_else(|| "focus_preview_reference_transform_missing".to_string())?;
    let reference_pixels = warp(
        &reference.registration,
        reference_transform,
        crop,
        cancelled,
    )?;
    transforms
        .iter()
        .filter(|transform| transform.status == "accepted")
        .map(|transform| {
            if cancelled() {
                return Err("focus_stack_alignment_cancelled:preview".to_string());
            }
            let source = sources
                .iter()
                .find(|source| source.source_index == transform.source_index)
                .ok_or_else(|| "focus_preview_source_missing".to_string())?;
            let pixels = if source.source_index == reference_source_index {
                reference_pixels.clone()
            } else {
                warp(&source.registration, transform, crop, cancelled)?
            };
            let width = preview_width(&reference.registration, crop);
            let height = preview_height(&reference.registration, crop);
            let reference_png = encode(&reference_pixels, width, height)?;
            let overlay = reference_pixels
                .iter()
                .zip(&pixels)
                .map(|(a, b)| blend(*a, *b))
                .collect::<Vec<_>>();
            let difference = reference_pixels
                .iter()
                .zip(&pixels)
                .map(|(a, b)| difference(*a, *b))
                .collect::<Vec<_>>();
            let overlay_png = encode(&overlay, width, height)?;
            let difference_png = encode(&difference, width, height)?;
            let mut canonical =
                Vec::with_capacity(reference_png.len() + overlay_png.len() + difference_png.len());
            canonical.extend_from_slice(&reference_png);
            canonical.extend_from_slice(&overlay_png);
            canonical.extend_from_slice(&difference_png);
            Ok(SourcePreview {
                source_index: source.source_index,
                reference_data_url: data_url(&reference_png),
                overlay_data_url: data_url(&overlay_png),
                difference_data_url: data_url(&difference_png),
                preview_hash: format!("blake3:{}", blake3::hash(&canonical).to_hex()),
                width,
                height,
                compensation_applied: source.source_index != reference_source_index
                    && ((transform.scale - 1.0).abs() > 1e-8
                        || transform.rotation_degrees.abs() > 1e-8
                        || transform.translation_x_px.abs() > 1e-8
                        || transform.translation_y_px.abs() > 1e-8),
            })
        })
        .collect()
}

fn preview_width(frame: &RegistrationFrame, crop: &RectF64) -> u32 {
    ((crop.width * frame.width as f64 / frame.full_width as f64).floor() as u32).max(1)
}
fn preview_height(frame: &RegistrationFrame, crop: &RectF64) -> u32 {
    ((crop.height * frame.height as f64 / frame.full_height as f64).floor() as u32).max(1)
}

fn warp(
    frame: &RegistrationFrame,
    transform: &SimilarityTransform,
    crop: &RectF64,
    cancelled: impl Fn() -> bool,
) -> Result<Vec<[f32; 4]>, String> {
    let width = preview_width(frame, crop) as usize;
    let height = preview_height(frame, crop) as usize;
    let ref_scale_x = frame.full_width as f64 / frame.width as f64;
    let ref_scale_y = frame.full_height as f64 / frame.height as f64;
    let mut output = vec![[0.0; 4]; width * height];
    for y in 0..height {
        if y % 32 == 0 && cancelled() {
            return Err("focus_stack_alignment_cancelled:warp_rows".to_string());
        }
        for x in 0..width {
            let ref_x = crop.x + (x as f64 + 0.5) * ref_scale_x - 0.5;
            let ref_y = crop.y + (y as f64 + 0.5) * ref_scale_y - 0.5;
            let m = transform.inverse_matrix;
            let full_x = m[0] * ref_x + m[1] * ref_y + m[2];
            let full_y = m[3] * ref_x + m[4] * ref_y + m[5];
            let proxy_x = (full_x + 0.5) / ref_scale_x - 0.5;
            let proxy_y = (full_y + 0.5) / ref_scale_y - 0.5;
            if let Some(rgb) = bicubic(frame, proxy_x, proxy_y) {
                output[y * width + x] = [rgb[0], rgb[1], rgb[2], 1.0];
            }
        }
    }
    Ok(output)
}

fn bicubic(frame: &RegistrationFrame, x: f64, y: f64) -> Option<[f32; 3]> {
    if x < 1.0 || y < 1.0 || x >= (frame.width - 2) as f64 || y >= (frame.height - 2) as f64 {
        return None;
    }
    let x0 = x.floor() as isize;
    let y0 = y.floor() as isize;
    let mut sum = [0.0f64; 3];
    let mut weight_sum = 0.0;
    for j in -1..=2 {
        for i in -1..=2 {
            let sx = (x0 + i) as usize;
            let sy = (y0 + j) as usize;
            let index = sy * frame.width + sx;
            if !frame.valid[index] {
                return None;
            }
            let weight = cubic(x - (x0 + i) as f64) * cubic(y - (y0 + j) as f64);
            for (channel, value) in sum.iter_mut().enumerate() {
                *value += frame.color[index][channel] as f64 * weight;
            }
            weight_sum += weight;
        }
    }
    (weight_sum.abs() > 1e-12).then(|| {
        [
            (sum[0] / weight_sum) as f32,
            (sum[1] / weight_sum) as f32,
            (sum[2] / weight_sum) as f32,
        ]
    })
}
fn cubic(value: f64) -> f64 {
    let x = value.abs();
    if x <= 1.0 {
        1.5 * x * x * x - 2.5 * x * x + 1.0
    } else if x < 2.0 {
        -0.5 * x * x * x + 2.5 * x * x - 4.0 * x + 2.0
    } else {
        0.0
    }
}
fn blend(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    if a[3] == 0.0 || b[3] == 0.0 {
        return [0.0, 0.0, 0.0, 0.0];
    }
    [
        a[0] * 0.5 + b[0] * 0.5,
        a[1] * 0.5 + b[1] * 0.5,
        a[2] * 0.5 + b[2] * 0.5,
        1.0,
    ]
}
fn difference(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    if a[3] == 0.0 || b[3] == 0.0 {
        return [0.0, 0.0, 0.0, 0.0];
    }
    [
        ((a[0] - b[0]).abs() * 4.0).min(1.0),
        ((a[1] - b[1]).abs() * 4.0).min(1.0),
        ((a[2] - b[2]).abs() * 4.0).min(1.0),
        1.0,
    ]
}
fn encode(pixels: &[[f32; 4]], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let image = RgbaImage::from_fn(width, height, |x, y| {
        let p = pixels[y as usize * width as usize + x as usize];
        Rgba([
            (p[0].clamp(0.0, 1.0) * 255.0).round() as u8,
            (p[1].clamp(0.0, 1.0) * 255.0).round() as u8,
            (p[2].clamp(0.0, 1.0) * 255.0).round() as u8,
            (p[3] * 255.0).round() as u8,
        ])
    });
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|error| format!("focus_preview_encode_failed:{error}"))?;
    Ok(cursor.into_inner())
}
fn data_url(bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transparent_border_is_not_mirrored() {
        let frame = RegistrationFrame {
            width: 8,
            height: 8,
            full_width: 8,
            full_height: 8,
            luma: vec![0.5; 64],
            color: vec![[0.5; 3]; 64],
            valid: vec![true; 64],
            clipped: vec![false; 64],
        };
        let transform = SimilarityTransform {
            source_index: 0,
            scale: 1.0,
            rotation_degrees: 0.0,
            translation_x_px: 2.0,
            translation_y_px: 0.0,
            center_x_px: 3.5,
            center_y_px: 3.5,
            source_center_x_px: 3.5,
            source_center_y_px: 3.5,
            reference_center_x_px: 3.5,
            reference_center_y_px: 3.5,
            forward_matrix: [1.0, 0.0, 2.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
            inverse_matrix: [1.0, 0.0, -2.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
            valid_domain: vec![],
            overlap_ratio: 0.75,
            crop_loss_ratio: 0.25,
            inlier_ratio: 1.0,
            p50_residual_px: 0.0,
            p95_residual_px: 0.0,
            confidence: 1.0,
            status: "accepted",
            reason_codes: vec![],
            exposure_normalization: super::super::alignment::ExposureNormalization {
                scalar: 1.0,
                fit_within_bounds: true,
                log_residual: 0.0,
                sample_coverage: 1.0,
                metadata_delta_ev: None,
            },
        };
        let pixels = warp(
            &frame,
            &transform,
            &RectF64 {
                x: 0.0,
                y: 0.0,
                width: 8.0,
                height: 8.0,
            },
            || false,
        )
        .unwrap();
        assert_eq!(pixels[0][3], 0.0);
        assert_eq!(pixels[4 * 8 + 4][3], 1.0);
    }
}
