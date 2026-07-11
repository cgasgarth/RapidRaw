use std::io::Cursor;

use base64::Engine;
use image::{DynamicImage, ImageBuffer, ImageFormat, Luma, Rgb};

use super::{
    motion::{MOTION_ALGORITHM_ID, probability},
    source_ownership::{Candidate, OWNERSHIP_ALGORITHM_ID, UNRESOLVED_OWNER, select},
    tone_map::{TONE_MAP_ALGORITHM_ID, render_rgb8},
};

pub(crate) const DEGHOST_ALGORITHM_ID: &str = "scene_linear_owner_feather_v1";

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct AlignedPixel {
    pub alignment_confidence: f32,
    pub clipped: [bool; 3],
    pub is_reference: bool,
    pub source_index: usize,
    pub valid: [bool; 3],
    pub value: [f32; 3],
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeghostPreview {
    pub action_state: &'static str,
    pub algorithm_id: &'static str,
    pub color_state: &'static str,
    pub confidence_mean: f32,
    pub feather_hash: String,
    pub motion_algorithm_id: &'static str,
    pub motion_coverage: f32,
    pub motion_probability_data_url: String,
    pub motion_probability_hash: String,
    pub ownership_algorithm_id: &'static str,
    pub ownership_data_url: String,
    pub ownership_hash: String,
    pub plan_hash: String,
    pub radiance_hash: String,
    pub radiance_handle: String,
    pub static_radiance_hash: String,
    pub tone_map_algorithm_id: &'static str,
    pub tone_mapped_preview_data_url: String,
    pub tone_mapped_preview_hash: String,
    pub unresolved_fraction: f32,
}

fn hash_bytes(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}

fn png_data_url(bytes: Vec<u8>) -> Result<(String, String), String> {
    let hash = hash_bytes(&bytes);
    Ok((
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        hash,
    ))
}

fn encode_luma(width: usize, height: usize, bytes: Vec<u8>) -> Result<(String, String), String> {
    let image = ImageBuffer::<Luma<u8>, _>::from_raw(width as u32, height as u32, bytes)
        .ok_or("deghost_luma_dimensions")?;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageLuma8(image)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    png_data_url(png.into_inner())
}

pub(crate) fn reconstruct(
    width: usize,
    height: usize,
    static_radiance: &[[f32; 3]],
    static_radiance_hash: &str,
    aligned: &[Vec<AlignedPixel>],
    plan_hash: &str,
    cancelled: impl Fn() -> bool,
) -> Result<DeghostPreview, String> {
    let pixel_count = width * height;
    let mut probability_bytes = vec![0u8; pixel_count];
    let mut owners = vec![UNRESOLVED_OWNER; pixel_count];
    let mut confidence = vec![0.0f32; pixel_count];
    for index in 0..pixel_count {
        if cancelled() {
            return Err("hdr_plan_cancelled:motion_probability".to_string());
        }
        let luma = aligned[index]
            .iter()
            .map(|pixel| {
                if pixel.valid.iter().any(|valid| *valid) {
                    pixel.value.iter().sum::<f32>() / 3.0
                } else {
                    f32::NAN
                }
            })
            .collect::<Vec<_>>();
        let motion_probability = probability(&luma);
        probability_bytes[index] = (motion_probability * 255.0).round() as u8;
        if motion_probability >= 0.2 {
            let candidates = aligned[index]
                .iter()
                .map(|pixel| Candidate {
                    alignment_confidence: pixel.alignment_confidence,
                    clipped: pixel.clipped.iter().all(|clipped| *clipped),
                    is_reference: pixel.is_reference,
                    source_index: pixel.source_index,
                    valid: pixel.valid.iter().any(|valid| *valid),
                    value: pixel.value.iter().sum::<f32>() / 3.0,
                })
                .collect::<Vec<_>>();
            (owners[index], confidence[index]) = select(&candidates);
        }
    }
    if cancelled() {
        return Err("hdr_plan_cancelled:ownership_selection".to_string());
    }
    let owner_bytes = owners
        .iter()
        .map(|owner| {
            if *owner == UNRESOLVED_OWNER {
                255
            } else {
                (*owner).min(254) as u8
            }
        })
        .collect::<Vec<_>>();
    let feather = probability_bytes
        .iter()
        .zip(&confidence)
        .map(|(motion, confidence)| ((*motion as f32) * confidence).round() as u8)
        .collect::<Vec<_>>();
    let mut radiance = static_radiance.to_vec();
    for index in 0..pixel_count {
        if cancelled() {
            return Err("hdr_plan_cancelled:scene_linear_deghost_preview".to_string());
        }
        let owner = owners[index];
        if owner == UNRESOLVED_OWNER {
            continue;
        }
        let Some(selected) = aligned[index]
            .iter()
            .find(|pixel| pixel.source_index == owner as usize)
        else {
            continue;
        };
        let alpha = feather[index] as f32 / 255.0;
        for channel in 0..3 {
            if selected.valid[channel] && !selected.clipped[channel] {
                radiance[index][channel] = static_radiance[index][channel] * (1.0 - alpha)
                    + selected.value[channel] * alpha;
            }
        }
    }
    let probability_hash = hash_bytes(&probability_bytes);
    let ownership_hash = hash_bytes(&owner_bytes);
    let feather_hash = hash_bytes(&feather);
    let radiance_bytes = radiance
        .iter()
        .flat_map(|pixel| pixel.iter().flat_map(|value| value.to_le_bytes()))
        .collect::<Vec<_>>();
    let radiance_hash = hash_bytes(&radiance_bytes);
    let (motion_probability_data_url, _) = encode_luma(width, height, probability_bytes.clone())?;
    let (ownership_data_url, _) = encode_luma(width, height, owner_bytes)?;
    if cancelled() {
        return Err("hdr_plan_cancelled:review_tone_map".to_string());
    }
    let rgb = render_rgb8(&radiance, 1.0);
    let image = ImageBuffer::<Rgb<u8>, _>::from_raw(width as u32, height as u32, rgb)
        .ok_or("deghost_preview_dimensions")?;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    let (tone_mapped_preview_data_url, tone_mapped_preview_hash) = png_data_url(png.into_inner())?;
    let motion_pixels = probability_bytes
        .iter()
        .filter(|value| **value >= 51)
        .count();
    let unresolved = owners
        .iter()
        .zip(&probability_bytes)
        .filter(|(owner, motion)| **motion >= 51 && **owner == UNRESOLVED_OWNER)
        .count();
    Ok(DeghostPreview {
        action_state: if unresolved == 0 {
            "deghost_preview_ready"
        } else {
            "deghost_unresolved"
        },
        algorithm_id: DEGHOST_ALGORITHM_ID,
        color_state: "scene_linear_camera_white_balanced_uncalibrated_display_fallback",
        confidence_mean: confidence.iter().sum::<f32>() / pixel_count as f32,
        feather_hash,
        motion_algorithm_id: MOTION_ALGORITHM_ID,
        motion_coverage: motion_pixels as f32 / pixel_count as f32,
        motion_probability_data_url,
        motion_probability_hash: probability_hash,
        ownership_algorithm_id: OWNERSHIP_ALGORITHM_ID,
        ownership_data_url,
        ownership_hash,
        plan_hash: plan_hash.to_string(),
        radiance_hash: radiance_hash.clone(),
        radiance_handle: format!("native:hdr/deghost-preview/v1/{}", &radiance_hash[7..23]),
        static_radiance_hash: static_radiance_hash.to_string(),
        tone_map_algorithm_id: TONE_MAP_ALGORITHM_ID,
        tone_mapped_preview_data_url,
        tone_mapped_preview_hash,
        unresolved_fraction: unresolved as f32 / pixel_count as f32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_artifacts_change_pixels_only_for_motion() {
        let static_radiance = vec![[0.4; 3], [0.4; 3]];
        let source = |index, values: [[f32; 3]; 2], reference| {
            vec![
                AlignedPixel {
                    alignment_confidence: 1.0,
                    clipped: [false; 3],
                    is_reference: reference,
                    source_index: index,
                    valid: [true; 3],
                    value: values[0],
                },
                AlignedPixel {
                    alignment_confidence: 1.0,
                    clipped: [false; 3],
                    is_reference: reference,
                    source_index: index,
                    valid: [true; 3],
                    value: values[1],
                },
            ]
        };
        let a = source(0, [[0.4; 3], [0.2; 3]], true);
        let b = source(1, [[0.401; 3], [0.9; 3]], false);
        let aligned = (0..2)
            .map(|index| vec![a[index], b[index]])
            .collect::<Vec<_>>();
        let first = reconstruct(
            2,
            1,
            &static_radiance,
            "blake3:static",
            &aligned,
            "blake3:plan",
            || false,
        )
        .unwrap();
        let second = reconstruct(
            2,
            1,
            &static_radiance,
            "blake3:static",
            &aligned,
            "blake3:plan",
            || false,
        )
        .unwrap();
        assert_eq!(
            first.motion_probability_hash,
            second.motion_probability_hash
        );
        assert_eq!(first.ownership_hash, second.ownership_hash);
        assert_eq!(first.radiance_hash, second.radiance_hash);
        assert_ne!(first.radiance_hash, "blake3:static");
        assert_eq!(first.action_state, "deghost_preview_ready");
    }
}
