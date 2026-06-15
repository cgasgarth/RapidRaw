use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use image::DynamicImage;
use serde_json::Value;

use crate::denoise_cpu_reference::{DenoiseCpuReferenceSettings, apply_cpu_reference_denoise};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DenoiseRenderControls {
    pub chroma_strength: f32,
    pub luma_strength: f32,
}

pub fn parse_denoise_render_controls(adjustments: &Value) -> DenoiseRenderControls {
    let luma_strength = adjustments
        .get("lumaNoiseReduction")
        .and_then(Value::as_f64)
        .map(|value| (value as f32 / 100.0).clamp(0.0, 1.0))
        .unwrap_or(0.0);
    let chroma_strength = adjustments
        .get("colorNoiseReduction")
        .and_then(Value::as_f64)
        .map(|value| (value as f32 / 100.0).clamp(0.0, 1.0))
        .unwrap_or(0.0);

    DenoiseRenderControls {
        chroma_strength,
        luma_strength,
    }
}

pub fn calculate_denoise_render_hash(base_hash: u64, adjustments: &Value) -> u64 {
    let controls = parse_denoise_render_controls(adjustments);
    let mut hasher = DefaultHasher::new();
    base_hash.hash(&mut hasher);
    controls.luma_strength.to_bits().hash(&mut hasher);
    controls.chroma_strength.to_bits().hash(&mut hasher);
    hasher.finish()
}

pub fn apply_denoise_stage<'a>(
    image: &'a DynamicImage,
    adjustments: &Value,
) -> Cow<'a, DynamicImage> {
    let controls = parse_denoise_render_controls(adjustments);
    if controls.luma_strength <= f32::EPSILON && controls.chroma_strength <= f32::EPSILON {
        return Cow::Borrowed(image);
    }

    let strength = controls.luma_strength.max(controls.chroma_strength);
    let settings = DenoiseCpuReferenceSettings {
        chroma_strength: controls.chroma_strength * 0.52,
        edge_threshold: 0.018 + (1.0 - strength) * 0.045,
        luma_strength: controls.luma_strength * 0.32,
    };
    let output = apply_cpu_reference_denoise(&image.to_rgb32f(), settings);
    Cow::Owned(DynamicImage::ImageRgb32F(output))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgb32FImage};
    use serde_json::json;

    fn noisy_patch_image() -> DynamicImage {
        let image: Rgb32FImage = ImageBuffer::from_fn(16, 16, |x, y| {
            let base = if x > 7 { 0.65 } else { 0.25 };
            let noise = (((x * 13 + y * 7) % 9) as f32 - 4.0) * 0.006;
            Rgb([
                (base + noise).clamp(0.0, 1.0),
                (base * 0.92 - noise * 0.5).clamp(0.0, 1.0),
                (base * 0.82 + noise * 0.75).clamp(0.0, 1.0),
            ])
        });
        DynamicImage::ImageRgb32F(image)
    }

    fn max_delta(a: &DynamicImage, b: &DynamicImage) -> f32 {
        a.to_rgb32f()
            .pixels()
            .zip(b.to_rgb32f().pixels())
            .map(|(left, right)| {
                left.0
                    .iter()
                    .zip(right.0.iter())
                    .map(|(l, r)| (l - r).abs())
                    .fold(0.0_f32, f32::max)
            })
            .fold(0.0_f32, f32::max)
    }

    #[test]
    fn zero_strength_preserves_input() {
        let image = noisy_patch_image();
        let adjustments = json!({
            "colorNoiseReduction": 0,
            "lumaNoiseReduction": 0
        });

        let output = apply_denoise_stage(&image, &adjustments);

        assert_eq!(max_delta(&image, output.as_ref()), 0.0);
    }

    #[test]
    fn enabled_denoise_changes_pixels() {
        let image = noisy_patch_image();
        let adjustments = json!({
            "colorNoiseReduction": 65,
            "lumaNoiseReduction": 55
        });

        let output = apply_denoise_stage(&image, &adjustments);

        assert!(max_delta(&image, output.as_ref()) > 0.0001);
    }

    #[test]
    fn same_input_produces_preview_export_parity() {
        let image = noisy_patch_image();
        let adjustments = json!({
            "colorNoiseReduction": 65,
            "lumaNoiseReduction": 55
        });

        let preview = apply_denoise_stage(&image, &adjustments);
        let export = apply_denoise_stage(&image, &adjustments);

        assert_eq!(max_delta(preview.as_ref(), export.as_ref()), 0.0);
    }

    #[test]
    fn denoise_controls_affect_render_hash() {
        let disabled = json!({
            "colorNoiseReduction": 0,
            "lumaNoiseReduction": 0
        });
        let enabled = json!({
            "colorNoiseReduction": 65,
            "lumaNoiseReduction": 55
        });

        assert_ne!(
            calculate_denoise_render_hash(42, &disabled),
            calculate_denoise_render_hash(42, &enabled)
        );
    }
}
