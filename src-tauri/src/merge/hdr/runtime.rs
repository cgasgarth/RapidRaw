use image::{DynamicImage, ImageBuffer, Rgb};

use super::{
    PlannedSource,
    motion::probability,
    radiance::{Sample, estimate},
    source_ownership::{Candidate, UNRESOLVED_OWNER, select},
    tone_map::render_rgb8,
};

pub(crate) const ENGINE_ID: &str = "rapidraw_native_scene_linear_hdr_v1";
pub(crate) const BACKEND_ID: &str = "deterministic_cpu_tiles_v1";

#[derive(Debug)]
pub(crate) struct FullResolutionHdr {
    pub scene_linear: DynamicImage,
    pub preview: DynamicImage,
    pub motion_probability: Vec<u8>,
    pub ownership: Vec<u8>,
    pub feather: Vec<u8>,
    pub scene_linear_hash: String,
    pub preview_hash: String,
    pub motion_coverage: f32,
    pub confidence_mean: f32,
}

fn hash_f32(pixels: &[[f32; 3]]) -> String {
    let bytes = pixels
        .iter()
        .flat_map(|pixel| pixel.iter().flat_map(|value| value.to_le_bytes()))
        .collect::<Vec<_>>();
    format!("blake3:{}", blake3::hash(&bytes).to_hex())
}

pub(crate) fn reconstruct(
    images: &[DynamicImage],
    sources: &[PlannedSource],
    cancelled: impl Fn() -> bool,
) -> Result<FullResolutionHdr, String> {
    if images.len() != sources.len() || images.len() < 2 {
        return Err("hdr_runtime_source_mismatch".to_string());
    }
    let reference = sources
        .iter()
        .find(|source| source.is_reference)
        .ok_or("missing_reference_source")?;
    let reference_scale = reference.frame.exposure.exposure_scale;
    let width = reference.frame.width;
    let height = reference.frame.height;
    let rgb = images
        .iter()
        .map(DynamicImage::to_rgb32f)
        .collect::<Vec<_>>();
    if rgb
        .iter()
        .any(|image| image.width() as usize != width || image.height() as usize != height)
    {
        return Err("hdr_runtime_dimension_mismatch".to_string());
    }

    let pixel_count = width * height;
    let mut radiance = vec![[0.0f32; 3]; pixel_count];
    let mut motion_probability = vec![0u8; pixel_count];
    let mut ownership = vec![255u8; pixel_count];
    let mut feather = vec![0u8; pixel_count];
    let mut confidence_sum = 0.0f32;
    let mut motion_count = 0usize;

    for y in 0..height {
        if cancelled() {
            return Err("hdr_apply_cancelled:radiance_merge".to_string());
        }
        for x in 0..width {
            let output_index = y * width + x;
            let mut normalized = vec![[f32::NAN; 3]; sources.len()];
            let mut valid = vec![[false; 3]; sources.len()];
            let mut clipped = vec![[false; 3]; sources.len()];
            for (source_slot, source) in sources.iter().enumerate() {
                let sx = x as isize - source.alignment.matrix[2].round() as isize;
                let sy = y as isize - source.alignment.matrix[5].round() as isize;
                if sx < 0 || sy < 0 || sx >= width as isize || sy >= height as isize {
                    continue;
                }
                let pixel = rgb[source_slot].get_pixel(sx as u32, sy as u32);
                let exposure = source.frame.exposure.exposure_scale / reference_scale;
                for channel in 0..3 {
                    let value = pixel[channel];
                    valid[source_slot][channel] = value.is_finite() && value > 0.000_01;
                    clipped[source_slot][channel] = value >= 0.995;
                    if valid[source_slot][channel] && exposure > 0.0 {
                        normalized[source_slot][channel] = value / exposure;
                    }
                }
            }
            for channel in 0..3 {
                let samples = sources
                    .iter()
                    .enumerate()
                    .map(|(slot, source)| Sample {
                        value: normalized[slot][channel]
                            * (source.frame.exposure.exposure_scale / reference_scale),
                        exposure_scale: source.frame.exposure.exposure_scale / reference_scale,
                        valid: valid[slot][channel],
                        clipped: clipped[slot][channel],
                    })
                    .collect::<Vec<_>>();
                radiance[output_index][channel] = estimate(&samples).radiance;
            }

            let luma = normalized
                .iter()
                .map(|pixel| pixel.iter().copied().filter(|v| v.is_finite()).sum::<f32>() / 3.0)
                .collect::<Vec<_>>();
            let probability = probability(&luma);
            motion_probability[output_index] = (probability * 255.0).round() as u8;
            if probability < 0.2 {
                continue;
            }
            motion_count += 1;
            let candidates = sources
                .iter()
                .enumerate()
                .map(|(slot, source)| Candidate {
                    alignment_confidence: source.alignment.confidence,
                    clipped: clipped[slot].iter().all(|value| *value),
                    is_reference: source.is_reference,
                    source_index: source.frame.source_index,
                    valid: valid[slot].iter().any(|value| *value),
                    value: luma[slot],
                })
                .collect::<Vec<_>>();
            let (owner, confidence) = select(&candidates);
            if owner == UNRESOLVED_OWNER {
                continue;
            }
            ownership[output_index] = owner.min(254) as u8;
            confidence_sum += confidence;
            feather[output_index] = (probability * confidence * 255.0).round() as u8;
            let Some((slot, _)) = sources
                .iter()
                .enumerate()
                .find(|(_, source)| source.frame.source_index == owner as usize)
            else {
                continue;
            };
            let alpha = feather[output_index] as f32 / 255.0;
            for channel in 0..3 {
                if valid[slot][channel] && !clipped[slot][channel] {
                    radiance[output_index][channel] = radiance[output_index][channel]
                        * (1.0 - alpha)
                        + normalized[slot][channel] * alpha;
                }
            }
        }
    }
    let scene_linear_hash = hash_f32(&radiance);
    let preview_bytes = render_rgb8(&radiance, 1.0);
    let preview_hash = format!("blake3:{}", blake3::hash(&preview_bytes).to_hex());
    let scene_linear = ImageBuffer::<Rgb<f32>, _>::from_raw(
        width as u32,
        height as u32,
        radiance.into_iter().flatten().collect(),
    )
    .ok_or("hdr_scene_linear_dimensions")?;
    let preview = ImageBuffer::<Rgb<u8>, _>::from_raw(width as u32, height as u32, preview_bytes)
        .ok_or("hdr_preview_dimensions")?;
    Ok(FullResolutionHdr {
        scene_linear: DynamicImage::ImageRgb32F(scene_linear),
        preview: DynamicImage::ImageRgb8(preview),
        motion_probability,
        ownership,
        feather,
        scene_linear_hash,
        preview_hash,
        motion_coverage: motion_count as f32 / pixel_count as f32,
        confidence_mean: if motion_count == 0 {
            1.0
        } else {
            confidence_sum / motion_count as f32
        },
    })
}

pub(crate) fn tone_map(image: &DynamicImage, exposure: f32) -> Result<DynamicImage, String> {
    let rgb = image.to_rgb32f();
    let radiance = rgb
        .pixels()
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect::<Vec<_>>();
    let bytes = render_rgb8(&radiance, exposure);
    ImageBuffer::<Rgb<u8>, _>::from_raw(image.width(), image.height(), bytes)
        .map(DynamicImage::ImageRgb8)
        .ok_or_else(|| "hdr_tone_map_dimensions".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merge::hdr::{
        alignment::{ALIGNMENT_POLICY_ID, AlignmentReceipt},
        source_frame::{
            ActiveArea, AlignmentProxy, CalibrationReceipt, ColorProxy, ExposureReceipt,
            SourceFrame,
        },
    };

    fn source(index: usize, exposure_scale: f32, reference: bool) -> PlannedSource {
        let width = 8;
        let height = 4;
        PlannedSource {
            frame: SourceFrame {
                active_area: ActiveArea {
                    x: 0,
                    y: 0,
                    width,
                    height,
                },
                calibration: CalibrationReceipt {
                    algorithm_id: "test_calibration",
                    black_levels: vec![64.0; 3],
                    linearization_id: "identity",
                    white_balance: vec![1.0; 3],
                    white_levels: vec![4095.0; 3],
                },
                camera_make: "Fixture".into(),
                camera_model: "Public HDR".into(),
                cfa_pattern: "RGGB".into(),
                content_hash: format!("blake3:source-{index}"),
                decoder_id: "fixture_color_decode",
                exposure: ExposureReceipt {
                    aperture: 8.0,
                    exposure_scale,
                    exposure_time_seconds: exposure_scale / 100.0,
                    iso: 100.0,
                },
                focal_length_mm: 35.0,
                focus_distance_mm: Some(10_000.0),
                graph_revision: "fixture_v1",
                height,
                lens_model: "Fixture 35mm".into(),
                orientation: "normal".into(),
                path: format!("fixture-{index}.dng"),
                proxy_hash: format!("blake3:proxy-{index}"),
                proxy_id: "fixture_proxy",
                source_index: index,
                width,
                proxy: AlignmentProxy {
                    width,
                    height,
                    pixels: vec![0.2; width * height],
                    scale: 1.0,
                },
                color_proxy: ColorProxy {
                    width,
                    height,
                    pixels: vec![[0.2; 3]; width * height],
                    valid: vec![[true; 3]; width * height],
                    clipped: vec![[false; 3]; width * height],
                },
            },
            alignment: AlignmentReceipt {
                confidence: 1.0,
                converged: true,
                iterations: 1,
                matrix: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
                model: "translation",
                overlap_fraction: 1.0,
                policy_id: ALIGNMENT_POLICY_ID,
                residual_p95: 0.0,
                residual_rms: 0.0,
            },
            is_reference: reference,
        }
    }

    #[test]
    fn decoded_color_frames_reconstruct_scene_linear_and_deghost_deterministically() {
        let scales = [0.25, 1.0, 4.0];
        let sources = scales
            .iter()
            .enumerate()
            .map(|(index, scale)| source(index, *scale, index == 1))
            .collect::<Vec<_>>();
        let images = scales
            .iter()
            .enumerate()
            .map(|(source_index, scale)| {
                DynamicImage::ImageRgb32F(ImageBuffer::from_fn(8, 4, |x, _| {
                    let radiance = if x >= 6 { 1.8 } else { 0.2 + x as f32 * 0.05 };
                    let mut value = (radiance * scale).min(1.0);
                    if source_index == 2 && x == 3 {
                        value = 0.9;
                    }
                    Rgb([value, value * 0.9, value * 0.8])
                }))
            })
            .collect::<Vec<_>>();
        let first = reconstruct(&images, &sources, || false).unwrap();
        let second = reconstruct(&images, &sources, || false).unwrap();
        assert_eq!(first.scene_linear_hash, second.scene_linear_hash);
        assert_eq!(first.motion_probability, second.motion_probability);
        assert_eq!(first.ownership, second.ownership);
        assert!(first.motion_coverage > 0.0);
        let output = first.scene_linear.to_rgb32f();
        assert!((output.get_pixel(2, 0)[0] - 0.3).abs() / 0.3 <= 0.015);
        assert!(output.get_pixel(7, 0)[0] > 1.7);
    }

    #[test]
    fn cancellation_publishes_no_runtime_result() {
        let sources = vec![source(0, 0.5, false), source(1, 1.0, true)];
        let images = vec![DynamicImage::new_rgb32f(8, 4); 2];
        assert_eq!(
            reconstruct(&images, &sources, || true).unwrap_err(),
            "hdr_apply_cancelled:radiance_merge"
        );
    }
}
