use std::io::Cursor;

use base64::Engine;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgb};

use super::{
    plan::PlannedSource,
    radiance::{RADIANCE_ALGORITHM_ID, Sample, estimate},
    tone_map::{TONE_MAP_ALGORITHM_ID, render_rgb8},
};

const MOTION_BLOCK_THRESHOLD: f32 = 0.02;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StaticRadiancePreview {
    pub action_state: &'static str,
    pub color_state: &'static str,
    pub effective_sample_mean: f32,
    pub invalid_or_clipped_coverage: f32,
    pub motion_coverage: f32,
    pub plan_hash: String,
    pub radiance_algorithm_id: &'static str,
    pub radiance_hash: String,
    pub radiance_handle: String,
    pub recovered_highlight_coverage: f32,
    pub residual_hash: String,
    pub support_hash: String,
    pub tone_map_algorithm_id: &'static str,
    pub tone_map_exposure: f32,
    pub tone_mapped_preview_data_url: String,
    pub tone_mapped_preview_hash: String,
    pub variance_hash: String,
    pub weight_hash: String,
}

fn hash_f32(values: impl IntoIterator<Item = f32>) -> String {
    let bytes = values
        .into_iter()
        .flat_map(f32::to_le_bytes)
        .collect::<Vec<_>>();
    format!("blake3:{}", blake3::hash(&bytes).to_hex())
}

pub(crate) fn reconstruct_static_preview(
    sources: &[PlannedSource],
    plan_hash: &str,
    cancelled: impl Fn() -> bool,
) -> Result<StaticRadiancePreview, String> {
    let reference = sources
        .iter()
        .find(|source| source.is_reference)
        .ok_or("missing_reference_source")?;
    let width = reference.frame.color_proxy.width;
    let height = reference.frame.color_proxy.height;
    let reference_scale = reference.frame.exposure.exposure_scale;
    let mut radiance = vec![[0.0f32; 3]; width * height];
    let mut support = vec![0.0f32; width * height];
    let mut variance = vec![0.0f32; width * height];
    let mut weight = vec![0.0f32; width * height];
    let mut residual = vec![0.0f32; width * height];
    let mut invalid_channels = 0usize;
    let mut reference_clipped_channels = 0usize;
    let mut recovered_clipped_channels = 0usize;
    let mut motion_pixels = 0usize;
    for y in 0..height {
        if cancelled() {
            return Err("hdr_plan_cancelled:robust_merge".to_string());
        }
        for x in 0..width {
            let output_index = y * width + x;
            let mut pixel_residual = 0.0f32;
            for (channel, output_channel) in radiance[output_index].iter_mut().enumerate() {
                let mut samples = Vec::with_capacity(sources.len());
                for source in sources {
                    let proxy_scale = source.frame.proxy.scale;
                    let shift_x = (source.alignment.matrix[2] / proxy_scale).round() as isize;
                    let shift_y = (source.alignment.matrix[5] / proxy_scale).round() as isize;
                    let sx = x as isize - shift_x;
                    let sy = y as isize - shift_y;
                    if sx < 0 || sy < 0 || sx >= width as isize || sy >= height as isize {
                        samples.push(Sample::default());
                        continue;
                    }
                    let index = sy as usize * width + sx as usize;
                    samples.push(Sample {
                        clipped: source.frame.color_proxy.clipped[index][channel],
                        exposure_scale: source.frame.exposure.exposure_scale / reference_scale,
                        valid: source.frame.color_proxy.valid[index][channel],
                        value: source.frame.color_proxy.pixels[index][channel],
                    });
                }
                let estimate = estimate(&samples);
                *output_channel = estimate.radiance;
                support[output_index] += estimate.effective_samples as f32 / 3.0;
                variance[output_index] += estimate.variance / 3.0;
                weight[output_index] += estimate.weight / 3.0;
                pixel_residual = pixel_residual.max(estimate.residual);
                if estimate.effective_samples == 0 {
                    invalid_channels += 1;
                }
                if reference.frame.color_proxy.clipped[output_index][channel] {
                    reference_clipped_channels += 1;
                    if estimate.effective_samples > 0 {
                        recovered_clipped_channels += 1;
                    }
                }
            }
            residual[output_index] = pixel_residual;
            if pixel_residual > 0.04 {
                motion_pixels += 1;
            }
        }
    }
    if cancelled() {
        return Err("hdr_plan_cancelled:radiance_artifact_encode".to_string());
    }
    let radiance_hash = hash_f32(radiance.iter().flat_map(|pixel| pixel.iter().copied()));
    let support_hash = hash_f32(support.iter().copied());
    let variance_hash = hash_f32(variance.iter().copied());
    let weight_hash = hash_f32(weight.iter().copied());
    let residual_hash = hash_f32(residual.iter().copied());
    let tone_map_exposure = 1.0;
    let rgb = render_rgb8(&radiance, tone_map_exposure);
    let image = ImageBuffer::<Rgb<u8>, _>::from_raw(width as u32, height as u32, rgb)
        .ok_or("tone_map_buffer_dimensions")?;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    let png = png.into_inner();
    let tone_mapped_preview_hash = format!("blake3:{}", blake3::hash(&png).to_hex());
    let tone_mapped_preview_data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png)
    );
    let motion_coverage = motion_pixels as f32 / (width * height) as f32;
    Ok(StaticRadiancePreview {
        action_state: if motion_coverage > MOTION_BLOCK_THRESHOLD {
            "deghost_required"
        } else {
            "static_radiance_preview_ready"
        },
        color_state: "scene_linear_camera_white_balanced_uncalibrated_display_fallback",
        effective_sample_mean: support.iter().sum::<f32>() / support.len() as f32,
        invalid_or_clipped_coverage: invalid_channels as f32 / (width * height * 3) as f32,
        motion_coverage,
        plan_hash: plan_hash.to_string(),
        radiance_algorithm_id: RADIANCE_ALGORITHM_ID,
        radiance_hash: radiance_hash.clone(),
        radiance_handle: format!("native:hdr/radiance-preview/v1/{}", &radiance_hash[7..23]),
        recovered_highlight_coverage: if reference_clipped_channels == 0 {
            0.0
        } else {
            recovered_clipped_channels as f32 / reference_clipped_channels as f32
        },
        residual_hash,
        support_hash,
        tone_map_algorithm_id: TONE_MAP_ALGORITHM_ID,
        tone_map_exposure,
        tone_mapped_preview_data_url,
        tone_mapped_preview_hash,
        variance_hash,
        weight_hash,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn float_artifact_hash_is_stable_and_order_sensitive() {
        let first = hash_f32([0.0, 0.5, 1.0]);
        assert_eq!(first, hash_f32([0.0, 0.5, 1.0]));
        assert_ne!(first, hash_f32([1.0, 0.5, 0.0]));
    }
}
