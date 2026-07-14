use std::borrow::Cow;

use image::DynamicImage;
use serde_json::Value;

use crate::adjustments::abi::AllAdjustments;
use crate::deblur_render::{apply_deblur_stage, calculate_deblur_render_hash};
use crate::denoise_cpu_reference::DenoiseSourceClass;
use crate::denoise_render::{apply_denoise_stage_for_source, calculate_denoise_render_hash};
use crate::grading_render::{
    apply_perceptual_grading_stage, calculate_perceptual_grading_render_hash,
};
use crate::wavelet_render::{apply_wavelet_detail_stage, calculate_wavelet_detail_render_hash};

pub(crate) struct PreGpuDetailStageResult<'a> {
    pub image: Cow<'a, DynamicImage>,
    pub render_hash: u64,
}

/// Global denoise is authoritative in the source-aware CPU detail stage. Mask
/// denoise remains in WGPU because it is spatially local and is not represented
/// by the full-frame pre-stage.
pub(crate) fn suppress_legacy_global_denoise(adjustments: &mut AllAdjustments) {
    adjustments.global.luma_noise_reduction = 0.0;
    adjustments.global.color_noise_reduction = 0.0;
}

pub(crate) fn apply_pre_gpu_detail_stages<'a>(
    image: &'a DynamicImage,
    base_hash: u64,
    adjustments: &Value,
    is_raw: bool,
) -> PreGpuDetailStageResult<'a> {
    let source_class = if is_raw {
        DenoiseSourceClass::LinearRaw
    } else {
        DenoiseSourceClass::EncodedRgb
    };
    let denoised_image = apply_denoise_stage_for_source(image, adjustments, source_class);
    let denoise_render_hash = calculate_denoise_render_hash(base_hash, adjustments);
    let deblurred_image = apply_deblur_stage(denoised_image.as_ref(), adjustments);
    let deblur_render_hash = calculate_deblur_render_hash(denoise_render_hash, adjustments);
    let wavelet_image = apply_wavelet_detail_stage(deblurred_image.image.as_ref(), adjustments);
    let wavelet_render_hash = calculate_wavelet_detail_render_hash(deblur_render_hash, adjustments);
    let grading_image = apply_perceptual_grading_stage(wavelet_image.as_ref(), adjustments);
    let render_hash = calculate_perceptual_grading_render_hash(wavelet_render_hash, adjustments);

    let stage_changed = matches!(denoised_image, Cow::Owned(_))
        || matches!(deblurred_image.image, Cow::Owned(_))
        || matches!(wavelet_image, Cow::Owned(_))
        || matches!(grading_image, Cow::Owned(_));

    PreGpuDetailStageResult {
        image: if stage_changed {
            Cow::Owned(grading_image.into_owned())
        } else {
            Cow::Borrowed(image)
        },
        render_hash,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgb32FImage};
    use serde_json::json;

    fn test_image() -> DynamicImage {
        let image: Rgb32FImage = ImageBuffer::from_fn(8, 8, |x, y| {
            let value = (x + y) as f32 / 16.0;
            Rgb([value, value * 0.9, value * 0.8])
        });
        DynamicImage::ImageRgb32F(image)
    }

    #[test]
    fn disabled_detail_stages_borrow_input() {
        let image = test_image();
        let result = apply_pre_gpu_detail_stages(&image, 42, &json!({}), false);

        assert!(matches!(result.image, Cow::Borrowed(_)));
    }

    #[test]
    fn detail_stage_hash_includes_adjustment_controls() {
        let image = test_image();
        let disabled = apply_pre_gpu_detail_stages(&image, 42, &json!({}), false);
        let enabled = apply_pre_gpu_detail_stages(
            &image,
            42,
            &json!({
                "waveletDetailEnabled": true,
                "waveletDetailFine": 35.0
            }),
            false,
        );

        assert_ne!(disabled.render_hash, enabled.render_hash);
    }

    #[test]
    fn typed_multiscale_detail_executes_in_the_production_pre_gpu_pipeline() {
        let image = test_image();
        let adjustments = json!({
            "rawEngineEditGraphVersion": 2,
            "multiscaleDetailV1": {
                "bands": [
                    {"gain": 0.8, "threshold": 0.01, "edgeProtection": 0.7, "noiseProtection": 0.9},
                    {"gain": 0.6, "threshold": 0.01, "edgeProtection": 0.7, "noiseProtection": 0.8},
                    {"gain": 0.4, "threshold": 0.01, "edgeProtection": 0.6, "noiseProtection": 0.6},
                    {"gain": 0.2, "threshold": 0.01, "edgeProtection": 0.5, "noiseProtection": 0.4},
                    {"gain": 0.1, "threshold": 0.01, "edgeProtection": 0.4, "noiseProtection": 0.2}
                ],
                "overallAmount": 1.0,
                "haloSuppression": 0.75,
                "ringingSuppression": 0.8,
                "shadowNoiseProtection": 0.85,
                "highlightProtection": 0.8,
                "chromaDetail": 0.0,
                "referenceScalePx": 1024.0,
                "process": "atrous_luma_v1"
            }
        });
        let disabled = apply_pre_gpu_detail_stages(&image, 42, &json!({}), true);
        let enabled = apply_pre_gpu_detail_stages(&image, 42, &adjustments, true);

        assert!(matches!(enabled.image, Cow::Owned(_)));
        assert_ne!(disabled.render_hash, enabled.render_hash);
        assert_ne!(
            image.to_rgb32f().into_raw(),
            enabled.image.as_ref().to_rgb32f().into_raw()
        );
    }

    #[test]
    fn perceptual_grading_runs_in_authoritative_pre_gpu_pipeline() {
        let image = test_image();
        let result = apply_pre_gpu_detail_stages(
            &image,
            42,
            &json!({
                "rawEngineEditGraphVersion": 2,
                "perceptualGradingV1": {
                    "shadows": {"hueDegrees": 220, "chroma": 0.15, "saturation": 0, "brilliance": 0, "luminanceEv": 0},
                    "midtones": {"hueDegrees": 0, "chroma": 0, "saturation": 0.2, "brilliance": 0.1, "luminanceEv": 0},
                    "highlights": {"hueDegrees": 45, "chroma": 0.1, "saturation": 0, "brilliance": 0, "luminanceEv": 0.2},
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
            }),
            true,
        );

        assert!(matches!(result.image, Cow::Owned(_)));
        assert_ne!(result.render_hash, 42);
        assert_ne!(result.image.to_rgb32f(), image.to_rgb32f());
        assert!(
            result
                .image
                .to_rgb32f()
                .as_raw()
                .iter()
                .all(|channel| channel.is_finite())
        );
    }

    #[test]
    fn authoritative_pre_stage_suppresses_only_duplicate_global_shader_denoise() {
        let mut adjustments = AllAdjustments::default();
        adjustments.global.luma_noise_reduction = 0.7;
        adjustments.global.color_noise_reduction = 0.6;
        adjustments.mask_adjustments[0].luma_noise_reduction = 0.4;
        adjustments.mask_adjustments[0].color_noise_reduction = 0.3;
        suppress_legacy_global_denoise(&mut adjustments);
        assert_eq!(adjustments.global.luma_noise_reduction, 0.0);
        assert_eq!(adjustments.global.color_noise_reduction, 0.0);
        assert_eq!(adjustments.mask_adjustments[0].luma_noise_reduction, 0.4);
        assert_eq!(adjustments.mask_adjustments[0].color_noise_reduction, 0.3);
    }
}
