use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use image::DynamicImage;
use serde_json::Value;

use crate::image_processing::{WaveletDetailSettings, apply_wavelet_detail_by_scale};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WaveletDetailRenderControls {
    pub coarse_amount: f32,
    pub edge_threshold: f32,
    pub enabled: bool,
    pub fine_amount: f32,
    pub halo_suppression: f32,
    pub medium_amount: f32,
}

pub fn parse_wavelet_detail_render_controls(adjustments: &Value) -> WaveletDetailRenderControls {
    let enabled = adjustments
        .get("waveletDetailEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let amount = |key: &str| -> f32 {
        adjustments
            .get(key)
            .and_then(Value::as_f64)
            .map(|value| (value as f32).clamp(-100.0, 100.0))
            .unwrap_or(0.0)
    };
    let unit = |key: &str, fallback: f32| -> f32 {
        adjustments
            .get(key)
            .and_then(Value::as_f64)
            .map(|value| (value as f32).clamp(0.0, 1.0))
            .unwrap_or(fallback)
    };

    WaveletDetailRenderControls {
        coarse_amount: if enabled {
            amount("waveletDetailCoarse")
        } else {
            0.0
        },
        edge_threshold: unit("waveletDetailEdgeThreshold", 0.18),
        enabled,
        fine_amount: if enabled {
            amount("waveletDetailFine")
        } else {
            0.0
        },
        halo_suppression: unit("waveletDetailHaloSuppression", 0.65),
        medium_amount: if enabled {
            amount("waveletDetailMedium")
        } else {
            0.0
        },
    }
}

pub fn calculate_wavelet_detail_render_hash(base_hash: u64, adjustments: &Value) -> u64 {
    let controls = parse_wavelet_detail_render_controls(adjustments);
    let mut hasher = DefaultHasher::new();
    base_hash.hash(&mut hasher);
    controls.enabled.hash(&mut hasher);
    controls.fine_amount.to_bits().hash(&mut hasher);
    controls.medium_amount.to_bits().hash(&mut hasher);
    controls.coarse_amount.to_bits().hash(&mut hasher);
    controls.edge_threshold.to_bits().hash(&mut hasher);
    controls.halo_suppression.to_bits().hash(&mut hasher);
    hasher.finish()
}

pub fn apply_wavelet_detail_stage<'a>(
    image: &'a DynamicImage,
    adjustments: &Value,
) -> Cow<'a, DynamicImage> {
    let controls = parse_wavelet_detail_render_controls(adjustments);
    if !controls.enabled
        || (controls.fine_amount.abs() <= f32::EPSILON
            && controls.medium_amount.abs() <= f32::EPSILON
            && controls.coarse_amount.abs() <= f32::EPSILON)
    {
        return Cow::Borrowed(image);
    }

    let mut output = image.clone();
    apply_wavelet_detail_by_scale(
        &mut output,
        WaveletDetailSettings {
            coarse_amount: controls.coarse_amount,
            edge_threshold: controls.edge_threshold,
            fine_amount: controls.fine_amount,
            halo_suppression: controls.halo_suppression,
            medium_amount: controls.medium_amount,
        },
    );
    Cow::Owned(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgb32FImage};
    use serde_json::json;
    use std::fs;

    fn synthetic_texture_image() -> DynamicImage {
        let image: Rgb32FImage = ImageBuffer::from_fn(16, 16, |x, y| {
            let base = if x > 7 { 0.62 } else { 0.3 };
            let texture = (((x * 11 + y * 17) % 9) as f32 - 4.0) * 0.008;
            Rgb([
                (base + texture).clamp(0.0, 1.0),
                (base * 0.94 + texture * 0.65).clamp(0.0, 1.0),
                (base * 0.86 - texture * 0.4).clamp(0.0, 1.0),
            ])
        });
        DynamicImage::ImageRgb32F(image)
    }

    fn enabled_adjustments() -> Value {
        json!({
            "waveletDetailCoarse": 0,
            "waveletDetailEdgeThreshold": 0.28,
            "waveletDetailEnabled": true,
            "waveletDetailFine": 55,
            "waveletDetailHaloSuppression": 0.8,
            "waveletDetailMedium": 35
        })
    }

    fn disabled_adjustments() -> Value {
        json!({
            "waveletDetailCoarse": 0,
            "waveletDetailEdgeThreshold": 0.28,
            "waveletDetailEnabled": false,
            "waveletDetailFine": 55,
            "waveletDetailHaloSuppression": 0.8,
            "waveletDetailMedium": 35
        })
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
    fn disabled_wavelet_detail_preserves_input() {
        let image = synthetic_texture_image();
        let output = apply_wavelet_detail_stage(&image, &disabled_adjustments());

        assert_eq!(max_delta(&image, output.as_ref()), 0.0);
    }

    #[test]
    fn enabled_wavelet_detail_changes_pixels() {
        let image = synthetic_texture_image();
        let output = apply_wavelet_detail_stage(&image, &enabled_adjustments());

        assert!(max_delta(&image, output.as_ref()) > 0.0001);
    }

    #[test]
    fn same_input_produces_preview_export_parity() {
        let image = synthetic_texture_image();
        let adjustments = enabled_adjustments();
        let preview = apply_wavelet_detail_stage(&image, &adjustments);
        let export = apply_wavelet_detail_stage(&image, &adjustments);

        assert_eq!(max_delta(preview.as_ref(), export.as_ref()), 0.0);
    }

    #[test]
    fn wavelet_controls_affect_render_hash() {
        assert_ne!(
            calculate_wavelet_detail_render_hash(42, &disabled_adjustments()),
            calculate_wavelet_detail_render_hash(42, &enabled_adjustments())
        );
    }

    #[test]
    fn workflow_report_proves_preview_export_parity_and_image_change() {
        let image = synthetic_texture_image();
        let enabled = enabled_adjustments();
        let disabled = disabled_adjustments();
        let preview = apply_wavelet_detail_stage(&image, &enabled);
        let export = apply_wavelet_detail_stage(&image, &enabled);
        let disabled_preview = apply_wavelet_detail_stage(&image, &disabled);
        let input_to_preview_max_delta = max_delta(&image, preview.as_ref());
        let preview_to_export_max_delta = max_delta(preview.as_ref(), export.as_ref());
        let disabled_preview_max_delta = max_delta(&image, disabled_preview.as_ref());
        let enabled_render_hash = calculate_wavelet_detail_render_hash(42, &enabled);
        let disabled_render_hash = calculate_wavelet_detail_render_hash(42, &disabled);

        assert!(input_to_preview_max_delta > 0.0001);
        assert_eq!(preview_to_export_max_delta, 0.0);
        assert_eq!(disabled_preview_max_delta, 0.0);
        assert_ne!(enabled_render_hash, disabled_render_hash);

        let report_path = match std::env::var("RAWENGINE_WAVELET_WORKFLOW_REPORT") {
            Ok(path) => path,
            Err(_) => return,
        };
        let artifact_path = std::env::var("RAWENGINE_WAVELET_WORKFLOW_PREVIEW_ARTIFACT")
            .unwrap_or_else(|_| "target/rawengine-wavelet-workflow-preview.png".to_string());

        preview
            .as_ref()
            .to_rgb8()
            .save(&artifact_path)
            .expect("write wavelet workflow preview artifact");

        let report = json!({
            "artifactPath": artifact_path,
            "applyStatus": "applied",
            "disabledPreviewMaxDelta": disabled_preview_max_delta,
            "enabledRenderHash": enabled_render_hash.to_string(),
            "disabledRenderHash": disabled_render_hash.to_string(),
            "inputToPreviewMaxDelta": input_to_preview_max_delta,
            "issue": 1266,
            "mutates": true,
            "orderedAfter": "scene_linear_post_denoise",
            "orderedBefore": "capture_sharpen",
            "persistentAdjustments": {
                "waveletDetailCoarse": 0,
                "waveletDetailEdgeThreshold": 0.28,
                "waveletDetailEnabled": true,
                "waveletDetailFine": 55,
                "waveletDetailHaloSuppression": 0.8,
                "waveletDetailMedium": 35
            },
            "previewToExportMaxDelta": preview_to_export_max_delta,
            "runtimeStatus": "preview_export_parity",
            "schemaVersion": 1,
            "stage": "wavelet_luma_detail",
            "warnings": ["Synthetic runtime workflow proof; real RAW quality and UI controls remain tracked separately."]
        });
        fs::write(&report_path, serde_json::to_string_pretty(&report).unwrap())
            .expect("write wavelet workflow report");
    }
}
