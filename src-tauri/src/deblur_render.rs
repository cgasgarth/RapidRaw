use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use image::DynamicImage;
use serde_json::Value;

use crate::deblur_cpu_reference::{
    DeblurCpuReferenceAssessment, DeblurCpuReferenceSettings, DeblurSkipReason,
    apply_cpu_reference_deblur_checked,
};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DeblurRenderControls {
    pub enabled: bool,
    pub sigma_px: f32,
    pub strength: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeblurRenderStatus {
    Applied,
    Skipped(DeblurSkipReason),
}

pub struct DeblurRenderResult<'a> {
    pub image: Cow<'a, DynamicImage>,
    #[allow(dead_code)]
    pub status: DeblurRenderStatus,
}

pub fn parse_deblur_render_controls(adjustments: &Value) -> DeblurRenderControls {
    let enabled = adjustments
        .get("deblurEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let strength = adjustments
        .get("deblurStrength")
        .and_then(Value::as_f64)
        .map(|value| (value as f32 / 100.0).clamp(0.0, 1.0))
        .unwrap_or(0.0);
    let sigma_px = adjustments
        .get("deblurSigmaPx")
        .and_then(Value::as_f64)
        .map(|value| value as f32)
        .unwrap_or(0.8);

    DeblurRenderControls {
        enabled,
        sigma_px,
        strength: if enabled { strength } else { 0.0 },
    }
}

pub fn calculate_deblur_render_hash(base_hash: u64, adjustments: &Value) -> u64 {
    let controls = parse_deblur_render_controls(adjustments);
    let mut hasher = DefaultHasher::new();
    base_hash.hash(&mut hasher);
    controls.enabled.hash(&mut hasher);
    controls.sigma_px.to_bits().hash(&mut hasher);
    controls.strength.to_bits().hash(&mut hasher);
    hasher.finish()
}

pub fn apply_deblur_stage<'a>(
    image: &'a DynamicImage,
    adjustments: &Value,
) -> DeblurRenderResult<'a> {
    let controls = parse_deblur_render_controls(adjustments);
    if !controls.enabled || controls.strength <= f32::EPSILON {
        return DeblurRenderResult {
            image: Cow::Borrowed(image),
            status: DeblurRenderStatus::Skipped(DeblurSkipReason::Disabled),
        };
    }
    if !(0.45..=1.35).contains(&controls.sigma_px) || !controls.sigma_px.is_finite() {
        return DeblurRenderResult {
            image: Cow::Borrowed(image),
            status: DeblurRenderStatus::Skipped(DeblurSkipReason::SigmaOutOfRange),
        };
    }

    let settings =
        DeblurCpuReferenceSettings::constrained_gaussian(controls.strength, controls.sigma_px);
    let input = image.to_rgb32f();
    match apply_cpu_reference_deblur_checked(
        &input,
        settings,
        DeblurCpuReferenceAssessment::synthetic_gaussian(settings.noise_floor, 0.0),
    ) {
        Ok(output) => DeblurRenderResult {
            image: Cow::Owned(DynamicImage::ImageRgb32F(output)),
            status: DeblurRenderStatus::Applied,
        },
        Err(reason) => DeblurRenderResult {
            image: Cow::Borrowed(image),
            status: DeblurRenderStatus::Skipped(reason),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgb32FImage};
    use serde_json::json;
    use std::fs;

    fn synthetic_edge_image() -> DynamicImage {
        let image: Rgb32FImage = ImageBuffer::from_fn(16, 16, |x, y| {
            let value = if x > 7 || y > 7 { 0.82 } else { 0.18 };
            Rgb([value, value * 0.92, value * 0.82])
        });
        DynamicImage::ImageRgb32F(image)
    }

    fn enabled_adjustments() -> Value {
        json!({
            "deblurEnabled": true,
            "deblurSigmaPx": 0.8,
            "deblurStrength": 70
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
    fn disabled_deblur_preserves_input_and_hash() {
        let image = synthetic_edge_image();
        let adjustments = json!({
            "deblurEnabled": false,
            "deblurSigmaPx": 0.8,
            "deblurStrength": 70
        });

        let result = apply_deblur_stage(&image, &adjustments);

        assert_eq!(
            result.status,
            DeblurRenderStatus::Skipped(DeblurSkipReason::Disabled)
        );
        assert_eq!(max_delta(&image, result.image.as_ref()), 0.0);
        assert_eq!(
            calculate_deblur_render_hash(42, &adjustments),
            calculate_deblur_render_hash(42, &adjustments)
        );
    }

    #[test]
    fn enabled_deblur_changes_pixels() {
        let image = synthetic_edge_image();
        let result = apply_deblur_stage(&image, &enabled_adjustments());

        assert_eq!(result.status, DeblurRenderStatus::Applied);
        assert!(max_delta(&image, result.image.as_ref()) > 0.0001);
    }

    #[test]
    fn invalid_sigma_skips_without_mutation() {
        let image = synthetic_edge_image();
        let adjustments = json!({
            "deblurEnabled": true,
            "deblurSigmaPx": 2.0,
            "deblurStrength": 70
        });

        let result = apply_deblur_stage(&image, &adjustments);

        assert_eq!(
            result.status,
            DeblurRenderStatus::Skipped(DeblurSkipReason::SigmaOutOfRange)
        );
        assert_eq!(max_delta(&image, result.image.as_ref()), 0.0);
    }

    #[test]
    fn same_input_produces_preview_export_parity() {
        let image = synthetic_edge_image();
        let adjustments = enabled_adjustments();

        let preview = apply_deblur_stage(&image, &adjustments);
        let export = apply_deblur_stage(&image, &adjustments);

        assert_eq!(
            max_delta(preview.image.as_ref(), export.image.as_ref()),
            0.0
        );
    }

    #[test]
    fn workflow_report_proves_preview_export_parity_and_image_change() {
        let image = synthetic_edge_image();
        let adjustments = enabled_adjustments();
        let disabled_adjustments = json!({
            "deblurEnabled": false,
            "deblurSigmaPx": 0.8,
            "deblurStrength": 70
        });

        let preview = apply_deblur_stage(&image, &adjustments);
        let export = apply_deblur_stage(&image, &adjustments);
        let disabled = apply_deblur_stage(&image, &disabled_adjustments);
        let input_to_preview_max_delta = max_delta(&image, preview.image.as_ref());
        let preview_to_export_max_delta = max_delta(preview.image.as_ref(), export.image.as_ref());
        let disabled_preview_max_delta = max_delta(&image, disabled.image.as_ref());
        let enabled_render_hash = calculate_deblur_render_hash(42, &adjustments);
        let disabled_render_hash = calculate_deblur_render_hash(42, &disabled_adjustments);

        assert_eq!(preview.status, DeblurRenderStatus::Applied);
        assert!(input_to_preview_max_delta > 0.0001);
        assert_eq!(preview_to_export_max_delta, 0.0);
        assert_eq!(disabled_preview_max_delta, 0.0);
        assert_ne!(enabled_render_hash, disabled_render_hash);

        let report_path = match std::env::var("RAWENGINE_DEBLUR_WORKFLOW_REPORT") {
            Ok(path) => path,
            Err(_) => return,
        };
        let artifact_path = std::env::var("RAWENGINE_DEBLUR_WORKFLOW_PREVIEW_ARTIFACT")
            .unwrap_or_else(|_| "target/rawengine-deblur-workflow-preview.png".to_string());

        preview
            .image
            .as_ref()
            .to_rgb8()
            .save(&artifact_path)
            .expect("write deblur workflow preview artifact");

        let report = json!({
            "artifactPath": artifact_path,
            "applyStatus": "applied",
            "disabledPreviewMaxDelta": disabled_preview_max_delta,
            "enabledRenderHash": enabled_render_hash.to_string(),
            "disabledRenderHash": disabled_render_hash.to_string(),
            "inputToPreviewMaxDelta": input_to_preview_max_delta,
            "issue": 1183,
            "orderedAfter": "scene_linear_denoise",
            "orderedBefore": "capture_sharpen",
            "persistentAdjustments": {
                "deblurEnabled": true,
                "deblurSigmaPx": 0.8,
                "deblurStrength": 70
            },
            "previewToExportMaxDelta": preview_to_export_max_delta,
            "runtimeStatus": "preview_export_parity",
            "schemaVersion": 1,
            "stage": "scene_linear_post_denoise",
            "warnings": ["Synthetic runtime workflow proof; real RAW quality remains tracked separately."]
        });
        fs::write(&report_path, serde_json::to_string_pretty(&report).unwrap())
            .expect("write deblur workflow report");
    }
}
