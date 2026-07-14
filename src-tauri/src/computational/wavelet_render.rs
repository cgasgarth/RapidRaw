use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const WAVELET_RENDER_REVISION_ABI: u32 = 3;

use image::DynamicImage;
use serde_json::Value;

use crate::detail::multiscale::{
    MultiscaleDetailPlanV1, MultiscaleDetailSettingsV1, apply_multiscale_detail,
};
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
    let mut hasher = DefaultHasher::new();
    WAVELET_RENDER_REVISION_ABI.hash(&mut hasher);
    base_hash.hash(&mut hasher);
    if let Some(settings) = resolved_multiscale_settings(adjustments) {
        "multiscale_detail_v1".hash(&mut hasher);
        match settings {
            Ok(settings) => serde_json::to_string(&settings)
                .expect("multiscale detail settings serialize")
                .hash(&mut hasher),
            Err(raw) => raw.to_string().hash(&mut hasher),
        }
        return hasher.finish();
    }
    let controls = parse_wavelet_detail_render_controls(adjustments);
    "legacy_wavelet_detail_v1".hash(&mut hasher);
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
    if let Some(settings) = resolved_multiscale_settings(adjustments) {
        let Ok(settings) = settings else {
            return Cow::Borrowed(image);
        };
        let Ok(plan) = MultiscaleDetailPlanV1::compile(settings, image.width(), image.height())
        else {
            return Cow::Borrowed(image);
        };
        if log::log_enabled!(log::Level::Trace) {
            let receipt = serde_json::to_string(&plan.receipt())
                .unwrap_or_else(|error| format!("receipt_encode_error:{error}"));
            log::trace!("multiscale_detail_plan={receipt}");
        }
        if plan.is_identity() {
            return Cow::Borrowed(image);
        }
        let mut output = image.clone();
        apply_multiscale_detail(&mut output, &plan);
        return Cow::Owned(output);
    }
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

pub fn multiscale_owns_legacy_global_detail(adjustments: &Value) -> bool {
    resolved_multiscale_settings(adjustments).is_some()
}

fn resolved_multiscale_settings(
    adjustments: &Value,
) -> Option<Result<MultiscaleDetailSettingsV1, Value>> {
    if let Some(settings) = typed_multiscale_settings(adjustments) {
        return Some(
            serde_json::from_value::<MultiscaleDetailSettingsV1>(settings.clone())
                .map_err(|_| settings.clone()),
        );
    }
    macro_multiscale_settings(adjustments).map(Ok)
}

fn macro_multiscale_settings(adjustments: &Value) -> Option<MultiscaleDetailSettingsV1> {
    let graph_version = adjustments
        .get("rawEngineEditGraphVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    if graph_version < 2 {
        return None;
    }
    let control = |key: &str| {
        adjustments
            .get(key)
            .and_then(Value::as_f64)
            .map(|value| (value as f32 / 100.0).clamp(-1.0, 1.0))
            .unwrap_or(0.0)
    };
    let sharpness = control("sharpness");
    let clarity = control("clarity");
    let structure = control("structure");
    if sharpness.abs() <= f32::EPSILON
        && clarity.abs() <= f32::EPSILON
        && structure.abs() <= f32::EPSILON
    {
        return None;
    }
    let sharpness_weights = [1.0, 0.72, 0.18, 0.0, 0.0];
    let clarity_weights = [0.0, 0.08, 0.58, 0.82, 0.24];
    let structure_weights = [0.0, 0.0, 0.12, 0.68, 1.0];
    let thresholds = [0.004, 0.006, 0.01, 0.015, 0.025];
    let bands = std::array::from_fn(|index| crate::detail::multiscale::DetailBandSettingsV1 {
        edge_protection: 0.8 - index as f32 * 0.08,
        gain: (sharpness * sharpness_weights[index]
            + clarity * clarity_weights[index]
            + structure * structure_weights[index])
            .clamp(-2.0, 2.0),
        noise_protection: 0.9 - index as f32 * 0.16,
        threshold: thresholds[index],
    });
    Some(MultiscaleDetailSettingsV1 {
        bands,
        chroma_detail: 0.0,
        halo_suppression: 0.78,
        highlight_protection: 0.8,
        overall_amount: 1.0,
        process: crate::detail::multiscale::DetailProcessV1::AtrousLumaV1,
        reference_scale_px: 2_048.0,
        ringing_suppression: 0.8,
        shadow_noise_protection: 0.85,
    })
}

fn typed_multiscale_settings(adjustments: &Value) -> Option<&Value> {
    let graph_version = adjustments
        .get("rawEngineEditGraphVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    (graph_version >= 2)
        .then(|| adjustments.get("multiscaleDetailV1"))
        .flatten()
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

    fn multiscale_adjustments(gain: f32) -> Value {
        json!({
            "rawEngineEditGraphVersion": 2,
            "multiscaleDetailV1": {
                "bands": [
                    {"gain": gain, "threshold": 0.01, "edgeProtection": 0.7, "noiseProtection": 0.9},
                    {"gain": gain * 0.8, "threshold": 0.01, "edgeProtection": 0.7, "noiseProtection": 0.8},
                    {"gain": gain * 0.6, "threshold": 0.01, "edgeProtection": 0.6, "noiseProtection": 0.6},
                    {"gain": gain * 0.4, "threshold": 0.01, "edgeProtection": 0.5, "noiseProtection": 0.4},
                    {"gain": gain * 0.2, "threshold": 0.01, "edgeProtection": 0.4, "noiseProtection": 0.2}
                ],
                "overallAmount": 1.0,
                "haloSuppression": 0.75,
                "ringingSuppression": 0.8,
                "shadowNoiseProtection": 0.85,
                "highlightProtection": 0.8,
                "chromaDetail": 0.0,
                "referenceScalePx": 1024.0,
                "process": "atrous_luma_v1"
            },
            "waveletDetailEnabled": true,
            "waveletDetailFine": 100
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
    fn typed_multiscale_process_owns_output_without_double_applying_legacy_controls() {
        let image = synthetic_texture_image();
        let typed = multiscale_adjustments(0.75);
        let mut without_legacy = typed.clone();
        without_legacy["waveletDetailEnabled"] = json!(false);
        let output = apply_wavelet_detail_stage(&image, &typed);
        let output_without_legacy = apply_wavelet_detail_stage(&image, &without_legacy);

        assert!(max_delta(&image, output.as_ref()) > 0.0001);
        assert_eq!(
            max_delta(output.as_ref(), output_without_legacy.as_ref()),
            0.0
        );
        assert_eq!(
            calculate_wavelet_detail_render_hash(42, &typed),
            calculate_wavelet_detail_render_hash(42, &without_legacy)
        );
    }

    #[test]
    fn typed_multiscale_hash_is_canonical_across_json_field_order() {
        let original = multiscale_adjustments(0.75);
        let mut reordered = original.clone();
        let settings = original["multiscaleDetailV1"].as_object().unwrap();
        reordered["multiscaleDetailV1"] = Value::Object(
            settings
                .iter()
                .rev()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        );

        assert_eq!(
            calculate_wavelet_detail_render_hash(42, &original),
            calculate_wavelet_detail_render_hash(42, &reordered)
        );
    }

    #[test]
    fn malformed_typed_settings_fail_safe_without_falling_through_to_legacy() {
        let image = synthetic_texture_image();
        let mut adjustments = multiscale_adjustments(0.75);
        adjustments["multiscaleDetailV1"]["bands"] = json!([]);
        let output = apply_wavelet_detail_stage(&image, &adjustments);

        assert!(matches!(output, Cow::Borrowed(_)));
        assert_eq!(max_delta(&image, output.as_ref()), 0.0);
    }

    #[test]
    fn graph_v2_user_controls_compile_to_distinct_scale_aware_bands() {
        let sharpness = json!({"rawEngineEditGraphVersion": 2, "sharpness": 80});
        let clarity = json!({"rawEngineEditGraphVersion": 2, "clarity": 80});
        let structure = json!({"rawEngineEditGraphVersion": 2, "structure": 80});
        let sharpness_plan = resolved_multiscale_settings(&sharpness).unwrap().unwrap();
        let clarity_plan = resolved_multiscale_settings(&clarity).unwrap().unwrap();
        let structure_plan = resolved_multiscale_settings(&structure).unwrap().unwrap();

        assert!(sharpness_plan.bands[0].gain > sharpness_plan.bands[4].gain);
        assert!(clarity_plan.bands[2].gain > clarity_plan.bands[0].gain);
        assert!(structure_plan.bands[4].gain > structure_plan.bands[1].gain);
        let preview = MultiscaleDetailPlanV1::compile(sharpness_plan.clone(), 1_024, 768).unwrap();
        let export = MultiscaleDetailPlanV1::compile(sharpness_plan, 4_096, 3_072).unwrap();
        assert_eq!(preview.effective_radii_px, [1, 2, 3, 4, 8]);
        assert_eq!(export.effective_radii_px, [2, 4, 8, 16, 32]);
    }

    #[test]
    fn graph_v2_user_controls_execute_real_pixels_and_legacy_graph_stays_unchanged() {
        let image = synthetic_texture_image();
        let modern = json!({
            "rawEngineEditGraphVersion": 2,
            "sharpness": 65,
            "clarity": 40,
            "structure": 25
        });
        let legacy = json!({
            "rawEngineEditGraphVersion": 1,
            "sharpness": 65,
            "clarity": 40,
            "structure": 25
        });
        let output = apply_wavelet_detail_stage(&image, &modern);
        assert!(matches!(output, Cow::Owned(_)));
        assert!(max_delta(&image, output.as_ref()) > 0.0001);
        assert!(multiscale_owns_legacy_global_detail(&modern));
        assert!(!multiscale_owns_legacy_global_detail(&legacy));
        assert!(matches!(
            apply_wavelet_detail_stage(&image, &legacy),
            Cow::Borrowed(_)
        ));
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
