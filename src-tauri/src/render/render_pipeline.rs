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

pub(crate) fn apply_current_pre_gpu_detail_stages<'a>(
    image: &'a DynamicImage,
    base_hash: u64,
    document: &crate::adjustments::edit_document_v2::CompiledCurrentEditDocument,
    is_raw: bool,
) -> PreGpuDetailStageResult<'a> {
    let source_class = if is_raw {
        DenoiseSourceClass::LinearRaw
    } else {
        DenoiseSourceClass::EncodedRgb
    };
    let denoise = document.denoise_render_controls();
    let deblur = document.deblur_render_controls();
    let detail = document.detail_macro_controls();
    let denoised_image = crate::denoise_render::apply_denoise_stage_for_source_with_controls(
        image,
        denoise,
        source_class,
    );
    let denoise_hash =
        crate::denoise_render::calculate_denoise_render_hash_with_controls(base_hash, denoise);
    let deblurred_image =
        crate::deblur_render::apply_deblur_stage_with_controls(denoised_image.as_ref(), deblur);
    let deblur_hash =
        crate::deblur_render::calculate_deblur_render_hash_with_controls(denoise_hash, deblur);
    let wavelet_image =
        crate::wavelet_render::apply_current_detail_stage(deblurred_image.image.as_ref(), detail);
    let render_hash =
        crate::wavelet_render::calculate_current_detail_render_hash(deblur_hash, detail);
    let stage_changed = matches!(denoised_image, Cow::Owned(_))
        || matches!(deblurred_image.image, Cow::Owned(_))
        || matches!(wavelet_image, Cow::Owned(_));
    PreGpuDetailStageResult {
        image: if stage_changed {
            Cow::Owned(wavelet_image.into_owned())
        } else {
            Cow::Borrowed(image)
        },
        owns_legacy_global_detail: detail.into_iter().any(|value| value.abs() > f32::EPSILON),
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
        let mut analyzed_dehaze = adjustments;
        analyzed_dehaze.global.dehaze_atmosphere_r = 0.72;
        analyzed_dehaze.global.dehaze_atmosphere_g = 0.68;
        analyzed_dehaze.global.dehaze_atmosphere_b = 0.61;
        analyzed_dehaze.global.dehaze_atmosphere_confidence = 0.84;
        let runtime_bound = graph
            .bind_runtime_dehaze_execution_abi(&analyzed_dehaze, false)
            .expect("deterministic dehaze analysis binds into the final ABI");
        assert!(
            runtime_bound
                .validate_gpu_execution(&analyzed_dehaze, false, 1)
                .is_ok()
        );
        let mut forbidden_mutation = analyzed_dehaze;
        forbidden_mutation.global.exposure += 0.25;
        assert!(matches!(
            graph.bind_runtime_dehaze_execution_abi(&forbidden_mutation, false),
            Err("edit_graph.unbound_runtime_gpu_execution_abi")
        ));
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

    #[cfg(feature = "tauri-test")]
    #[test]
    fn bound_runtime_receipts_cover_raw_rgb_masks_lut_and_cpu_fallback() {
        use crate::gpu_processing::{
            EditGraphExecutionAuthority, PreGpuImageIdentity, RenderRequest, acquire_gpu_test_lock,
            get_or_init_compute_gpu_context_for_tests, process_and_get_unclamped_dynamic_image,
        };
        use crate::lut_processing::Lut;
        use image::Luma;
        use tauri::Manager;

        struct Case {
            label: &'static str,
            is_raw: bool,
            has_mask: bool,
            has_lut: bool,
        }

        let _gpu_test_guard = acquire_gpu_test_lock();
        let app = tauri::test::mock_builder()
            .manage(crate::AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<crate::AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");
        let source = test_image();
        let identity_lut = Arc::new(Lut::compile(
            2,
            vec![
                0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0,
                0.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0,
            ],
        ));

        for case in [
            Case {
                label: "encoded-rgb",
                is_raw: false,
                has_mask: false,
                has_lut: false,
            },
            Case {
                label: "raw-with-mask",
                is_raw: true,
                has_mask: true,
                has_lut: false,
            },
            Case {
                label: "encoded-mask-and-lut",
                is_raw: false,
                has_mask: true,
                has_lut: true,
            },
        ] {
            let masks = case.has_mask.then(|| {
                json!([{
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
                }])
            });
            let raw = crate::render_plan::current_render_adjustments(json!({
                "sharpness": 70,
                "clarity": 45,
                "structure": 30,
                "lumaNoiseReduction": 60,
                "colorNoiseReduction": 50,
                "masks": masks.unwrap_or_else(|| json!([]))
            }));
            let lut = case.has_lut.then(|| Arc::clone(&identity_lut));
            let plan = crate::render_plan::compile_render_plan(
                &raw,
                crate::render_plan::CompileRenderPlanContext {
                    revision: crate::render_plan::content_revision(
                        &raw,
                        u64::from(case.is_raw),
                        u64::from(case.has_mask),
                        u64::from(case.has_lut),
                    ),
                    is_raw: case.is_raw,
                    tonemapper_override: Some(0),
                },
                lut.clone(),
            )
            .expect("current plan compiles");
            let detail_stage = apply_pre_gpu_detail_stages(&source, 41, &raw, case.is_raw);
            let (adjustments, graph) = bind_pre_gpu_execution(
                &plan.edit_graph,
                detail_stage.owns_legacy_global_detail,
                case.has_lut,
            );
            let mask_bitmaps = case
                .has_mask
                .then(|| ImageBuffer::from_pixel(8, 8, Luma([255])))
                .into_iter()
                .collect::<Vec<_>>();
            let cpu = crate::cpu_edit_graph::execute_cpu_edit_graph(
                detail_stage.image.as_ref(),
                &adjustments,
                &mask_bitmaps,
                lut.as_deref(),
                &graph,
            )
            .expect("bound CPU fallback executes");
            let gpu = process_and_get_unclamped_dynamic_image(
                &context,
                &state,
                detail_stage.image.as_ref(),
                PreGpuImageIdentity::for_source(detail_stage.image.as_ref(), case.label),
                RenderRequest {
                    adjustments,
                    mask_bitmaps: &mask_bitmaps,
                    lut,
                    roi: None,
                    edit_graph: EditGraphExecutionAuthority::Compiled(Arc::clone(&graph)),
                },
                case.label,
            )
            .expect("bound WGPU execution succeeds");
            let receipt = state
                .gpu()
                .processing()
                .current_processor_snapshot()
                .and_then(|processor| processor.processor.last_execution_receipt())
                .expect("WGPU publishes an execution receipt");

            assert_eq!(
                receipt.compiled_edit_graph_fingerprint, plan.edit_graph.fingerprint,
                "{} semantic graph identity",
                case.label
            );
            assert_ne!(
                receipt.execution_abi_fingerprint, plan.edit_graph.execution_abi_fingerprint,
                "{} resource-bound execution identity",
                case.label
            );
            if case.has_mask && case.has_lut {
                let baseline_fingerprint = receipt.execution_abi_fingerprint;
                let render_variant = |masks: &[ImageBuffer<Luma<u8>, Vec<u8>>],
                                      lut: Arc<Lut>,
                                      caller: &str| {
                    process_and_get_unclamped_dynamic_image(
                        &context,
                        &state,
                        detail_stage.image.as_ref(),
                        PreGpuImageIdentity::for_source(detail_stage.image.as_ref(), caller),
                        RenderRequest {
                            adjustments,
                            mask_bitmaps: masks,
                            lut: Some(lut),
                            roi: None,
                            edit_graph: EditGraphExecutionAuthority::Compiled(Arc::clone(&graph)),
                        },
                        caller,
                    )
                    .expect("resource variant executes");
                    state
                        .gpu()
                        .processing()
                        .current_processor_snapshot()
                        .and_then(|processor| processor.processor.last_execution_receipt())
                        .expect("resource variant publishes a receipt")
                        .execution_abi_fingerprint
                };

                assert_eq!(
                    render_variant(
                        &mask_bitmaps,
                        Arc::clone(&identity_lut),
                        "same-mask-and-lut"
                    ),
                    baseline_fingerprint,
                    "identical resources keep one execution identity"
                );
                let mut changed_masks = mask_bitmaps.clone();
                changed_masks[0].put_pixel(0, 0, Luma([0]));
                assert_ne!(
                    render_variant(
                        &changed_masks,
                        Arc::clone(&identity_lut),
                        "changed-mask-pixels"
                    ),
                    baseline_fingerprint,
                    "same mask presence with different pixels changes execution identity"
                );
                let mut changed_lut_data = identity_lut.data.to_vec();
                changed_lut_data[3] = 0.75;
                assert_ne!(
                    render_variant(
                        &mask_bitmaps,
                        Arc::new(Lut::compile(2, changed_lut_data)),
                        "changed-lut-content"
                    ),
                    baseline_fingerprint,
                    "same LUT presence with different content changes execution identity"
                );
            }
            for (index, (cpu, gpu)) in cpu
                .to_rgba32f()
                .into_raw()
                .iter()
                .zip(gpu.to_rgba32f().into_raw())
                .enumerate()
            {
                assert!(
                    (*cpu - gpu).abs() <= 0.015,
                    "{} CPU/WGPU pixel {index}: cpu={cpu} gpu={gpu}",
                    case.label
                );
            }
        }
    }
}
