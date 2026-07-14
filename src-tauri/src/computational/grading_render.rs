use std::borrow::Cow;
use std::hash::{Hash, Hasher};

use image::{DynamicImage, ImageBuffer, Rgba};
use rayon::prelude::*;
use serde_json::Value;

use crate::color::perceptual_grading::{PerceptualGradingPlanV1, PerceptualGradingSettingsV1};

const PERCEPTUAL_GRADING_RENDER_ABI: u32 = 1;

pub(crate) fn apply_perceptual_grading_stage<'a>(
    image: &'a DynamicImage,
    adjustments: &Value,
) -> Cow<'a, DynamicImage> {
    let Some(value) = typed_settings(adjustments) else {
        return Cow::Borrowed(image);
    };
    let Ok(settings) = serde_json::from_value::<PerceptualGradingSettingsV1>(value.clone()) else {
        return Cow::Borrowed(image);
    };
    let Ok(plan) = PerceptualGradingPlanV1::compile(settings) else {
        return Cow::Borrowed(image);
    };
    if plan.is_identity() {
        return Cow::Borrowed(image);
    }
    let (width, height) = (image.width(), image.height());
    let mut pixels = image.to_rgba32f().into_raw();
    pixels.par_chunks_exact_mut(4).for_each(|pixel| {
        let graded = plan.apply_rgb([pixel[0], pixel[1], pixel[2]]);
        pixel[..3].copy_from_slice(&graded);
    });
    Cow::Owned(DynamicImage::ImageRgba32F(
        ImageBuffer::<Rgba<f32>, Vec<f32>>::from_raw(width, height, pixels)
            .expect("perceptual grading output dimensions match source"),
    ))
}

pub(crate) fn calculate_perceptual_grading_render_hash(base_hash: u64, adjustments: &Value) -> u64 {
    let Some(value) = typed_settings(adjustments) else {
        return base_hash;
    };
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    PERCEPTUAL_GRADING_RENDER_ABI.hash(&mut hasher);
    base_hash.hash(&mut hasher);
    match serde_json::from_value::<PerceptualGradingSettingsV1>(value.clone()) {
        Ok(settings) => serde_json::to_string(&settings)
            .expect("perceptual grading settings serialize")
            .hash(&mut hasher),
        Err(_) => value.to_string().hash(&mut hasher),
    }
    hasher.finish()
}

fn typed_settings(adjustments: &Value) -> Option<&Value> {
    let graph_version = adjustments
        .get("rawEngineEditGraphVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    (graph_version >= 2)
        .then(|| adjustments.get("perceptualGradingV1"))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgb32FImage};
    use serde_json::json;

    fn image() -> DynamicImage {
        let image: Rgb32FImage = ImageBuffer::from_fn(24, 16, |x, y| {
            let value = 0.08 + x as f32 / 30.0 + y as f32 / 80.0;
            Rgb([value, value * 0.7, value * 0.45])
        });
        DynamicImage::ImageRgb32F(image)
    }

    fn adjustments() -> Value {
        json!({
            "rawEngineEditGraphVersion": 2,
            "perceptualGradingV1": {
                "shadows": {"hueDegrees": 220, "chroma": 0.18, "saturation": 0, "brilliance": 0, "luminanceEv": 0},
                "midtones": {"hueDegrees": 0, "chroma": 0, "saturation": 0.2, "brilliance": 0.1, "luminanceEv": 0},
                "highlights": {"hueDegrees": 45, "chroma": 0.12, "saturation": 0, "brilliance": 0, "luminanceEv": 0.2},
                "global": {"hueDegrees": 0, "chroma": 0, "saturation": 0, "brilliance": 0, "luminanceEv": 0},
                "shadowFulcrumEv": -2,
                "highlightFulcrumEv": 2,
                "falloff": 1,
                "balance": 0,
                "blending": 0.5,
                "perceptualModel": "oklab_d65_from_acescg_v1",
                "neutralProtection": 0.7,
                "skinProtection": 0.2
            }
        })
    }

    fn max_delta(left: &DynamicImage, right: &DynamicImage) -> f32 {
        left.to_rgb32f()
            .pixels()
            .zip(right.to_rgb32f().pixels())
            .flat_map(|(left, right)| left.0.into_iter().zip(right.0))
            .map(|(left, right)| (left - right).abs())
            .fold(0.0, f32::max)
    }

    #[test]
    fn typed_v2_grading_changes_real_output_and_hash() {
        let source = image();
        let adjustments = adjustments();
        let output = apply_perceptual_grading_stage(&source, &adjustments);
        assert!(max_delta(&source, output.as_ref()) > 0.001);
        assert!(
            output
                .to_rgb32f()
                .as_raw()
                .iter()
                .all(|value| value.is_finite())
        );
        assert_ne!(
            calculate_perceptual_grading_render_hash(42, &adjustments),
            42
        );
    }

    #[test]
    fn legacy_and_malformed_state_fail_safe_without_reinterpretation() {
        let source = image();
        let mut legacy = adjustments();
        legacy["rawEngineEditGraphVersion"] = json!(1);
        assert!(matches!(
            apply_perceptual_grading_stage(&source, &legacy),
            Cow::Borrowed(_)
        ));
        let mut malformed = adjustments();
        malformed["perceptualGradingV1"]["falloff"] = json!(0);
        assert!(matches!(
            apply_perceptual_grading_stage(&source, &malformed),
            Cow::Borrowed(_)
        ));
    }
}
