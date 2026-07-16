use std::borrow::Cow;
use std::sync::Arc;

use image::DynamicImage;
use serde_json::Value;

use crate::adjustments::abi::AllAdjustments;
use crate::deblur_render::{apply_deblur_stage, calculate_deblur_render_hash};
use crate::denoise_cpu_reference::DenoiseSourceClass;
use crate::denoise_render::{apply_denoise_stage_for_source, calculate_denoise_render_hash};
use crate::wavelet_render::{apply_wavelet_detail_stage, calculate_wavelet_detail_render_hash};

pub(crate) struct PreGpuDetailStageResult<'a> {
    pub image: Cow<'a, DynamicImage>,
    pub owns_legacy_global_detail: bool,
    pub render_hash: u64,
}

/// Global denoise is authoritative in the source-aware CPU detail stage. Mask
/// denoise remains in WGPU because it is spatially local and is not represented
/// by the full-frame pre-stage.
pub(crate) fn bind_pre_gpu_execution(
    graph: &Arc<crate::edit_graph::CompiledEditGraph>,
    owns_global_detail: bool,
    has_lut: bool,
) -> (AllAdjustments, Arc<crate::edit_graph::CompiledEditGraph>) {
    let graph = Arc::new(graph.bind_pre_gpu_execution_abi(owns_global_detail, has_lut));
    let adjustments = graph.shader_abi();
    debug_assert!(
        graph
            .validate_gpu_execution(&adjustments, has_lut, adjustments.mask_count as usize)
            .is_ok()
    );
    (adjustments, graph)
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
    let render_hash = wavelet_render_hash;

    let stage_changed = matches!(denoised_image, Cow::Owned(_))
        || matches!(deblurred_image.image, Cow::Owned(_))
        || matches!(wavelet_image, Cow::Owned(_));

    PreGpuDetailStageResult {
        image: if stage_changed {
            Cow::Owned(wavelet_image.into_owned())
        } else {
            Cow::Borrowed(image)
        },
        owns_legacy_global_detail: crate::wavelet_render::multiscale_owns_legacy_global_detail(
            adjustments,
        ),
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
    fn graph_v2_detail_macros_execute_once_and_suppress_overlapping_gpu_controls() {
        let image = test_image();
        let adjustments_json = json!({
            "rawEngineEditGraphVersion": 2,
            "sharpness": 70,
            "clarity": 45,
            "structure": 30
        });
        let result = apply_pre_gpu_detail_stages(&image, 42, &adjustments_json, true);
        assert!(matches!(result.image, Cow::Owned(_)));
        assert!(result.owns_legacy_global_detail);
    }

    #[test]
    fn perceptual_grading_is_deferred_to_authoritative_edit_graph() {
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

        assert!(matches!(result.image, Cow::Borrowed(_)));
    }

    #[test]
    fn pre_gpu_execution_binding_suppresses_only_owned_global_shader_controls() {
        let raw = crate::render_plan::current_render_adjustments(json!({
            "sharpness": 70,
            "clarity": 45,
            "structure": 30,
            "lumaNoiseReduction": 60,
            "colorNoiseReduction": 50,
            "sceneCurveV1": {
                "middleGrey": 0.18,
                "channelMode": "luminance_preserving",
                "points": [
                    {"xEv": -16.0, "yEv": -16.0},
                    {"xEv": 0.0, "yEv": 0.5},
                    {"xEv": 16.0, "yEv": 16.0}
                ]
            },
            "masks": [{
                "id": "local-detail",
                "name": "Local detail",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "blendMode": "normal",
                "adjustments": {
                    "sharpness": 30,
                    "clarity": 20,
                    "lumaNoiseReduction": 40,
                    "colorNoiseReduction": 25
                },
                "subMasks": []
            }]
        }));
        let plan = crate::render_plan::compile_render_plan(
            &raw,
            crate::render_plan::CompileRenderPlanContext {
                revision: crate::render_plan::content_revision(&raw, 1, 2, 3),
                is_raw: true,
                tonemapper_override: None,
            },
            None,
        )
        .unwrap();
        let local_detail_before = (
            plan.adjustments.mask_adjustments[0].sharpness,
            plan.adjustments.mask_adjustments[0].clarity,
            plan.adjustments.mask_adjustments[0].luma_noise_reduction,
            plan.adjustments.mask_adjustments[0].color_noise_reduction,
        );
        assert!(local_detail_before.0 != 0.0);
        assert!(local_detail_before.1 != 0.0);
        assert!(local_detail_before.2 != 0.0);
        assert!(local_detail_before.3 != 0.0);
        let original_fingerprint = plan.edit_graph.fingerprint;
        let original_execution_fingerprint = plan.edit_graph.execution_abi_fingerprint;
        let (adjustments, graph) = bind_pre_gpu_execution(&plan.edit_graph, true, false);

        assert_eq!(adjustments.global.sharpness, 0.0);
        assert_eq!(adjustments.global.clarity, 0.0);
        assert_eq!(adjustments.global.structure, 0.0);
        assert_eq!(adjustments.global.luma_noise_reduction, 0.0);
        assert_eq!(adjustments.global.color_noise_reduction, 0.0);
        assert_eq!(
            (
                adjustments.mask_adjustments[0].sharpness,
                adjustments.mask_adjustments[0].clarity,
                adjustments.mask_adjustments[0].luma_noise_reduction,
                adjustments.mask_adjustments[0].color_noise_reduction,
            ),
            local_detail_before,
            "pre-GPU ownership must not suppress mask-local controls"
        );
        assert_eq!(graph.fingerprint, original_fingerprint);
        assert_ne!(
            graph.execution_abi_fingerprint,
            original_execution_fingerprint
        );
        assert!(graph.validate_gpu_execution(&adjustments, false, 1).is_ok());
        assert_eq!(
            graph.validate_gpu_execution(&plan.adjustments, false, 1),
            Err("edit_graph.stale_gpu_execution_abi")
        );
        let lut_bound = plan.edit_graph.bind_pre_gpu_execution_abi(true, true);
        assert_ne!(
            graph.execution_abi_fingerprint, lut_bound.execution_abi_fingerprint,
            "LUT resource ownership participates in the bound ABI identity"
        );

        let mask = ImageBuffer::from_pixel(8, 8, image::Luma([255]));
        let cpu = crate::cpu_edit_graph::execute_cpu_edit_graph(
            &test_image(),
            &adjustments,
            &[mask],
            None,
            &graph,
        )
        .expect("bound current graph remains valid for CPU fallback");
        assert_eq!((cpu.width(), cpu.height()), (8, 8));
    }
}
