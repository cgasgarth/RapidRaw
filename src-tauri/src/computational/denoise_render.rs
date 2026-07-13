use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const DENOISE_RENDER_REVISION_ABI: u32 = 1;

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
    DENOISE_RENDER_REVISION_ABI.hash(&mut hasher);
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
    use std::fs;

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

    fn separated_luma_chroma_noise_image() -> DynamicImage {
        let image: Rgb32FImage = ImageBuffer::from_fn(24, 24, |x, y| {
            let base = 0.42 + (x as f32 / 23.0) * 0.12;
            let luma_noise = (((x * 17 + y * 11) % 11) as f32 - 5.0) * 0.006;
            let chroma_noise = (((x * 5 + y * 19) % 13) as f32 - 6.0) * 0.004;
            Rgb([
                (base + luma_noise + chroma_noise).clamp(0.0, 1.0),
                (base + luma_noise).clamp(0.0, 1.0),
                (base + luma_noise - chroma_noise).clamp(0.0, 1.0),
            ])
        });
        DynamicImage::ImageRgb32F(image)
    }

    fn luma(pixel: &[f32; 3]) -> f32 {
        0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]
    }

    fn chroma(pixel: &[f32; 3]) -> f32 {
        ((pixel[0] - pixel[1]).powi(2) + (pixel[2] - pixel[1]).powi(2)).sqrt()
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

    fn mean_luma_delta(a: &DynamicImage, b: &DynamicImage) -> f32 {
        let left = a.to_rgb32f();
        let right = b.to_rgb32f();
        let total = left
            .pixels()
            .zip(right.pixels())
            .map(|(left, right)| (luma(&left.0) - luma(&right.0)).abs())
            .sum::<f32>();
        total / left.pixels().len() as f32
    }

    fn mean_chroma_delta(a: &DynamicImage, b: &DynamicImage) -> f32 {
        let left = a.to_rgb32f();
        let right = b.to_rgb32f();
        let total = left
            .pixels()
            .zip(right.pixels())
            .map(|(left, right)| (chroma(&left.0) - chroma(&right.0)).abs())
            .sum::<f32>();
        total / left.pixels().len() as f32
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

    #[test]
    fn luma_and_chroma_noise_controls_have_independent_output_effects() {
        let image = separated_luma_chroma_noise_image();
        let luma_only = json!({
            "colorNoiseReduction": 0,
            "lumaNoiseReduction": 80
        });
        let chroma_only = json!({
            "colorNoiseReduction": 80,
            "lumaNoiseReduction": 0
        });

        let luma_output = apply_denoise_stage(&image, &luma_only);
        let chroma_output = apply_denoise_stage(&image, &chroma_only);

        let luma_only_luma_delta = mean_luma_delta(&image, luma_output.as_ref());
        let luma_only_chroma_delta = mean_chroma_delta(&image, luma_output.as_ref());
        let chroma_only_luma_delta = mean_luma_delta(&image, chroma_output.as_ref());
        let chroma_only_chroma_delta = mean_chroma_delta(&image, chroma_output.as_ref());

        assert!(
            luma_only_luma_delta > chroma_only_luma_delta * 2.0,
            "luma-only denoise should primarily change luminance"
        );
        assert!(
            chroma_only_chroma_delta > luma_only_chroma_delta * 2.0,
            "chroma-only denoise should primarily change chroma"
        );
    }

    #[test]
    fn workflow_report_proves_preview_export_parity_and_image_change() {
        let image = noisy_patch_image();
        let enabled = json!({
            "colorNoiseReduction": 65,
            "lumaNoiseReduction": 55
        });
        let disabled = json!({
            "colorNoiseReduction": 0,
            "lumaNoiseReduction": 0
        });

        let preview = apply_denoise_stage(&image, &enabled);
        let export = apply_denoise_stage(&image, &enabled);
        let disabled_preview = apply_denoise_stage(&image, &disabled);
        let input_to_preview_max_delta = max_delta(&image, preview.as_ref());
        let preview_to_export_max_delta = max_delta(preview.as_ref(), export.as_ref());
        let disabled_preview_max_delta = max_delta(&image, disabled_preview.as_ref());
        let enabled_render_hash = calculate_denoise_render_hash(42, &enabled);
        let disabled_render_hash = calculate_denoise_render_hash(42, &disabled);

        assert!(input_to_preview_max_delta > 0.0001);
        assert_eq!(preview_to_export_max_delta, 0.0);
        assert_eq!(disabled_preview_max_delta, 0.0);
        assert_ne!(enabled_render_hash, disabled_render_hash);

        let report_path = match std::env::var("RAWENGINE_DENOISE_WORKFLOW_REPORT") {
            Ok(path) => path,
            Err(_) => return,
        };
        let artifact_path = std::env::var("RAWENGINE_DENOISE_WORKFLOW_PREVIEW_ARTIFACT")
            .unwrap_or_else(|_| "target/rawengine-denoise-workflow-preview.png".to_string());

        preview
            .as_ref()
            .to_rgb8()
            .save(&artifact_path)
            .expect("write denoise workflow preview artifact");

        let report = json!({
            "artifactPath": artifact_path,
            "applyStatus": "applied",
            "disabledPreviewMaxDelta": disabled_preview_max_delta,
            "enabledRenderHash": enabled_render_hash.to_string(),
            "disabledRenderHash": disabled_render_hash.to_string(),
            "inputToPreviewMaxDelta": input_to_preview_max_delta,
            "issue": 1177,
            "mutates": true,
            "orderedAfter": "demosaic",
            "orderedBefore": "scene_linear_deblur",
            "persistentAdjustments": {
                "colorNoiseReduction": 65,
                "lumaNoiseReduction": 55
            },
            "previewToExportMaxDelta": preview_to_export_max_delta,
            "runtimeStatus": "preview_export_parity",
            "schemaVersion": 1,
            "stage": "scene_linear_denoise",
            "warnings": ["Synthetic runtime workflow proof; real RAW quality remains tracked separately."]
        });
        fs::write(&report_path, serde_json::to_string_pretty(&report).unwrap())
            .expect("write denoise workflow report");
    }
}
