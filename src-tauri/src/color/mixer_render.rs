#[cfg(test)]
use std::borrow::Cow;

#[cfg(test)]
use image::{DynamicImage, ImageBuffer, Rgba};
#[cfg(test)]
use rayon::prelude::*;

#[cfg(test)]
use crate::adjustments::abi::GlobalAdjustments;
use crate::adjustments::abi::{
    BlackWhiteMixerSettings, ChannelMixerRow, ChannelMixerSettings, ColorBalanceRgbSettings,
};
use crate::monochrome::{
    CONTINUOUS_SENSITIVITY_V1, NEUTRAL_PANCHROMATIC_V1, continuous_sensitivity_v1,
    neutral_panchromatic_v1,
};

const REC709_RED: f32 = 0.2126;
const REC709_GREEN: f32 = 0.7152;
const REC709_BLUE: f32 = 0.0722;
const ACESCG_RED: f32 = 0.272_228_72;
const ACESCG_GREEN: f32 = 0.674_081_74;
const ACESCG_BLUE: f32 = 0.053_689_52;

const BLACK_WHITE_MIXER_RANGE_CENTERS: [f32; 8] =
    [358.0, 25.0, 60.0, 115.0, 180.0, 225.0, 280.0, 330.0];
const BLACK_WHITE_MIXER_RANGE_WIDTHS: [f32; 8] = [35.0, 45.0, 40.0, 90.0, 60.0, 60.0, 55.0, 50.0];

#[cfg(test)]
pub(crate) fn apply_native_color_mixer_adjustments<'a>(
    image: Cow<'a, DynamicImage>,
    global: &GlobalAdjustments,
) -> Cow<'a, DynamicImage> {
    apply_native_color_mixer_adjustments_for_graph(image, global, false)
}

#[cfg(test)]
pub(crate) fn apply_native_color_mixer_adjustments_for_graph<'a>(
    image: Cow<'a, DynamicImage>,
    global: &GlobalAdjustments,
    preserve_extended: bool,
) -> Cow<'a, DynamicImage> {
    if !has_active_native_color_mixer_adjustments(global) {
        return image;
    }

    let (width, height) = (image.width(), image.height());
    let mut pixels = image.to_rgba32f().into_raw();

    pixels.par_chunks_exact_mut(4).for_each(|pixel| {
        let mut color = [pixel[0], pixel[1], pixel[2]];
        color = apply_color_balance_rgb(color, global.color_balance_rgb, preserve_extended);
        color = apply_channel_mixer(color, global.channel_mixer, preserve_extended);
        color = apply_black_white_mixer(color, global.black_white_mixer, preserve_extended);
        pixel[..3].copy_from_slice(&color);
    });

    let rendered = ImageBuffer::<Rgba<f32>, Vec<f32>>::from_raw(width, height, pixels)
        .expect("RGBA32F buffer dimensions must match its pixel data");
    Cow::Owned(DynamicImage::ImageRgba32F(rendered))
}

#[cfg(test)]
pub(crate) fn has_active_native_color_mixer_adjustments(global: &GlobalAdjustments) -> bool {
    global.color_balance_rgb.enabled != 0
        || global.channel_mixer.enabled != 0
        || global.black_white_mixer.enabled != 0
}

pub(crate) fn apply_color_balance_rgb(
    color: [f32; 3],
    settings: ColorBalanceRgbSettings,
    preserve_extended: bool,
) -> [f32; 3] {
    if settings.enabled == 0 {
        return color;
    }

    let source_luma = scene_luminance(color, preserve_extended);
    let [shadows, midtones, highlights] = color_balance_rgb_weights(source_luma);
    let offset = [
        (settings.shadows[0] * shadows
            + settings.midtones[0] * midtones
            + settings.highlights[0] * highlights)
            / 400.0,
        (settings.shadows[1] * shadows
            + settings.midtones[1] * midtones
            + settings.highlights[1] * highlights)
            / 400.0,
        (settings.shadows[2] * shadows
            + settings.midtones[2] * midtones
            + settings.highlights[2] * highlights)
            / 400.0,
    ];
    let balanced = if preserve_extended {
        add_rgb(color, offset)
    } else {
        clamp_rgb(add_rgb(color, offset))
    };

    if settings.preserve_luminance == 0 {
        return balanced;
    }

    preserve_color_balance_luminance(balanced, source_luma, preserve_extended)
}

fn color_balance_rgb_weights(luma: f32) -> [f32; 3] {
    let shadows = ((0.55 - luma) / 0.55).clamp(0.0, 1.0);
    let highlights = ((luma - 0.45) / 0.55).clamp(0.0, 1.0);
    let midtones = (1.0 - (luma - 0.5).abs() / 0.5).clamp(0.0, 1.0);
    let total = shadows + midtones + highlights;

    if total <= 0.0 {
        return [0.0, 1.0, 0.0];
    }

    [shadows / total, midtones / total, highlights / total]
}

pub(crate) fn apply_channel_mixer(
    color: [f32; 3],
    settings: ChannelMixerSettings,
    preserve_extended: bool,
) -> [f32; 3] {
    if settings.enabled == 0 {
        return color;
    }

    let mixed = [
        apply_channel_mixer_row(color, settings.red, preserve_extended),
        apply_channel_mixer_row(color, settings.green, preserve_extended),
        apply_channel_mixer_row(color, settings.blue, preserve_extended),
    ];

    if settings.preserve_luminance == 0 {
        return mixed;
    }

    let source_luma = scene_luminance(color, preserve_extended);
    if source_luma <= 0.0 {
        return mixed;
    }

    preserve_color_balance_luminance(mixed, source_luma, preserve_extended)
}

fn apply_channel_mixer_row(color: [f32; 3], row: ChannelMixerRow, preserve_extended: bool) -> f32 {
    let mixed = color[0] * row.red + color[1] * row.green + color[2] * row.blue + row.constant;
    if preserve_extended {
        mixed
    } else {
        mixed.clamp(0.0, 1.0)
    }
}

pub(crate) fn apply_black_white_mixer(
    color: [f32; 3],
    settings: BlackWhiteMixerSettings,
    preserve_extended: bool,
) -> [f32; 3] {
    if settings.enabled == 0 {
        return color;
    }

    if settings.process == NEUTRAL_PANCHROMATIC_V1
        && settings.implementation_version == crate::monochrome::MONOCHROME_IMPLEMENTATION_VERSION
    {
        return neutral_panchromatic_v1(color);
    }
    if settings.process == CONTINUOUS_SENSITIVITY_V1
        && settings.implementation_version == crate::monochrome::MONOCHROME_IMPLEMENTATION_VERSION
        && settings.source_class == crate::monochrome::COLOR_SOURCE
    {
        return continuous_sensitivity_v1(
            color,
            [
                settings.reds,
                settings.oranges,
                settings.yellows,
                settings.greens,
                settings.aquas,
                settings.blues,
                settings.purples,
                settings.magentas,
            ],
        );
    }
    if settings.process == CONTINUOUS_SENSITIVITY_V1
        && settings.implementation_version == crate::monochrome::MONOCHROME_IMPLEMENTATION_VERSION
    {
        return neutral_panchromatic_v1(color);
    }

    let luma = scene_luminance(color, preserve_extended);
    let Some(hue) = rgb_to_hue_degrees(color) else {
        return [luma; 3];
    };

    let weights = [
        settings.reds,
        settings.oranges,
        settings.yellows,
        settings.greens,
        settings.aquas,
        settings.blues,
        settings.purples,
        settings.magentas,
    ];
    let mut influence_total = 0.0;
    let mut weighted_adjustment = 0.0;

    for index in 0..weights.len() {
        let influence = (1.0
            - circular_hue_distance(hue, BLACK_WHITE_MIXER_RANGE_CENTERS[index])
                / (BLACK_WHITE_MIXER_RANGE_WIDTHS[index] * 0.5))
            .clamp(0.0, 1.0);
        if influence > 0.0 {
            influence_total += influence;
            weighted_adjustment += influence * weights[index];
        }
    }

    if influence_total > 0.0 {
        weighted_adjustment /= influence_total;
    }

    let adjusted = luma * (1.0 + weighted_adjustment * 0.5);
    let mixed = if preserve_extended {
        adjusted
    } else {
        adjusted.clamp(0.0, 1.0)
    };
    [mixed; 3]
}

fn preserve_color_balance_luminance(
    color: [f32; 3],
    source_luma: f32,
    preserve_extended: bool,
) -> [f32; 3] {
    let output_luma = scene_luminance(color, preserve_extended);
    if output_luma <= 0.0 {
        return color;
    }

    let scaled = scale_rgb(color, source_luma / output_luma);
    if preserve_extended {
        scaled
    } else {
        clamp_rgb(scaled)
    }
}

fn scene_luminance(color: [f32; 3], scene_referred_v2: bool) -> f32 {
    let coefficients = if scene_referred_v2 {
        [ACESCG_RED, ACESCG_GREEN, ACESCG_BLUE]
    } else {
        [REC709_RED, REC709_GREEN, REC709_BLUE]
    };
    color[0] * coefficients[0] + color[1] * coefficients[1] + color[2] * coefficients[2]
}

fn rgb_to_hue_degrees(color: [f32; 3]) -> Option<f32> {
    let max = color[0].max(color[1]).max(color[2]);
    let min = color[0].min(color[1]).min(color[2]);
    let chroma = max - min;
    if chroma <= 0.0 {
        return None;
    }

    let hue = if max == color[0] {
        (color[1] - color[2]) / chroma * 60.0 + if color[1] < color[2] { 360.0 } else { 0.0 }
    } else if max == color[1] {
        (color[2] - color[0]) / chroma * 60.0 + 120.0
    } else {
        (color[0] - color[1]) / chroma * 60.0 + 240.0
    };

    Some(hue)
}

fn circular_hue_distance(left: f32, right: f32) -> f32 {
    let delta = (left - right).abs() % 360.0;
    delta.min(360.0 - delta)
}

fn add_rgb(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

fn scale_rgb(color: [f32; 3], scale: f32) -> [f32; 3] {
    [color[0] * scale, color[1] * scale, color[2] * scale]
}

fn clamp_rgb(color: [f32; 3]) -> [f32; 3] {
    [
        color[0].clamp(0.0, 1.0),
        color[1].clamp(0.0, 1.0),
        color[2].clamp(0.0, 1.0),
    ]
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use image::{DynamicImage, ImageBuffer, Rgba};
    use serde_json::json;

    use super::{
        apply_black_white_mixer, apply_channel_mixer, apply_color_balance_rgb,
        apply_native_color_mixer_adjustments,
    };
    use crate::adjustments::parse::get_all_adjustments_from_json;
    use crate::monochrome::{
        LEGACY_FIXED_BAND_V1, MONOCHROME_IMPLEMENTATION_VERSION, MONOCHROME_SENSOR_SOURCE,
        NEUTRAL_PANCHROMATIC_V1,
    };

    fn source_image() -> DynamicImage {
        DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            1,
            1,
            Rgba([0.68, 0.48, 0.34, 0.75]),
        ))
    }

    fn pixel(image: &DynamicImage) -> [f32; 4] {
        image.to_rgba32f().get_pixel(0, 0).0
    }

    fn color_adjustments() -> serde_json::Value {
        json!({
            "colorBalanceRgb": {
                "enabled": true,
                "preserveLuminance": false,
                "shadows": { "red": 0, "green": 0, "blue": 0 },
                "midtones": { "red": 100, "green": -40, "blue": 20 },
                "highlights": { "red": 0, "green": 0, "blue": 0 }
            },
            "channelMixer": {
                "enabled": true,
                "preserveLuminance": false,
                "red": { "red": 0, "green": 100, "blue": 0, "constant": 0 },
                "green": { "red": 0, "green": 0, "blue": 100, "constant": 0 },
                "blue": { "red": 100, "green": 0, "blue": 0, "constant": 0 }
            },
            "blackWhiteMixer": {
                "enabled": true,
                "weights": {
                    "reds": 100,
                    "oranges": 0,
                    "yellows": 0,
                    "greens": 0,
                    "aquas": 0,
                    "blues": 0,
                    "purples": 0,
                    "magentas": 0
                }
            }
        })
    }

    #[test]
    fn disabled_native_color_mixers_are_pixel_identical_and_borrowed() {
        let image = source_image();
        let adjustments = get_all_adjustments_from_json(&json!({}), false, None);
        let rendered =
            apply_native_color_mixer_adjustments(Cow::Borrowed(&image), &adjustments.global);

        assert!(matches!(rendered, Cow::Borrowed(_)));
        assert_eq!(pixel(rendered.as_ref()), pixel(&image));
    }

    #[test]
    fn native_color_mixers_apply_in_color_balance_channel_mixer_black_white_order() {
        let image = source_image();
        let adjustments = get_all_adjustments_from_json(&color_adjustments(), false, None);
        let source = [0.68, 0.48, 0.34];
        let expected = apply_black_white_mixer(
            apply_channel_mixer(
                apply_color_balance_rgb(source, adjustments.global.color_balance_rgb, false),
                adjustments.global.channel_mixer,
                false,
            ),
            adjustments.global.black_white_mixer,
            false,
        );

        let rendered =
            apply_native_color_mixer_adjustments(Cow::Borrowed(&image), &adjustments.global);
        let actual = pixel(rendered.as_ref());

        for channel in 0..3 {
            assert!(
                (actual[channel] - expected[channel]).abs() < 0.000_001,
                "channel {channel} expected {}, got {}",
                expected[channel],
                actual[channel]
            );
        }
        assert_eq!(actual[3], 0.75, "the CPU color stage must retain alpha");
        assert_ne!(actual[..3], source);
    }

    #[test]
    fn black_white_mixer_uses_normalized_abi_weights_once() {
        let adjustments = get_all_adjustments_from_json(
            &json!({
                "blackWhiteMixer": {
                    "enabled": true,
                    "weights": {
                        "reds": 100,
                        "oranges": 0,
                        "yellows": 0,
                        "greens": 0,
                        "aquas": 0,
                        "blues": 0,
                        "purples": 0,
                        "magentas": 0
                    }
                }
            }),
            false,
            None,
        );
        let source = [0.9, 0.0, 0.0];
        let luma = 0.9 * 0.2126;
        let expected = (luma * 1.5_f32).clamp(0.0, 1.0);

        let result = apply_black_white_mixer(source, adjustments.global.black_white_mixer, false);

        assert!((result[0] - expected).abs() < 0.000_001);
        assert_eq!(result, [result[0]; 3]);
    }

    #[test]
    fn missing_process_keeps_legacy_fixed_band_v1_pixel_stable() {
        let adjustments = get_all_adjustments_from_json(
            &json!({
                "blackWhiteMixer": {
                    "enabled": true,
                    "weights": {
                        "reds": 35, "oranges": -12, "yellows": 18, "greens": -20,
                        "aquas": 7, "blues": -31, "purples": 22, "magentas": 14
                    }
                }
            }),
            false,
            None,
        );
        let settings = adjustments.global.black_white_mixer;
        assert_eq!(settings.process, LEGACY_FIXED_BAND_V1);
        assert_eq!(
            settings.implementation_version,
            MONOCHROME_IMPLEMENTATION_VERSION
        );

        for (source, expected) in [
            ([0.9, 0.15, 0.05], 0.334_111_24),
            ([0.3, 0.72, 0.18], 0.532_548),
            ([0.12, 0.28, 0.95], 0.248_732_5),
            ([1.4, 0.2, 0.7], 0.525_605_4),
        ] {
            let output = apply_black_white_mixer(source, settings, false);
            assert!(
                (output[0] - expected).abs() <= 2.0e-7,
                "{source:?}: {output:?}"
            );
            assert_eq!(output, [output[0]; 3]);
        }
    }

    #[test]
    fn neutral_process_is_versioned_and_ignores_legacy_band_weights() {
        let adjustments = get_all_adjustments_from_json(
            &json!({
                "blackWhiteMixer": {
                    "enabled": true,
                    "process": "neutral_panchromatic_v1",
                    "weights": {
                        "reds": 100, "oranges": -100, "yellows": 100, "greens": -100,
                        "aquas": 100, "blues": -100, "purples": 100, "magentas": -100
                    }
                }
            }),
            false,
            None,
        );
        let settings = adjustments.global.black_white_mixer;
        assert_eq!(settings.process, NEUTRAL_PANCHROMATIC_V1);
        assert_eq!(
            settings.implementation_version,
            MONOCHROME_IMPLEMENTATION_VERSION
        );
        let output = apply_black_white_mixer([4.0, 2.0, 0.5], settings, false);
        assert!(
            output[0] > 1.0,
            "neutral scene process must not apply an SDR clamp"
        );
        assert_eq!(output, [output[0]; 3]);
    }

    #[test]
    fn continuous_process_abstains_for_true_monochrome_sources() {
        let adjustments = get_all_adjustments_from_json(
            &json!({
                "blackWhiteMixer": {
                    "enabled": true,
                    "process": "continuous_sensitivity_v1",
                    "sourceClass": "monochrome_sensor",
                    "weights": {
                        "reds": 100, "oranges": 0, "yellows": 0, "greens": 0,
                        "aquas": 0, "blues": -100, "purples": 0, "magentas": 0
                    }
                }
            }),
            false,
            None,
        );
        let settings = adjustments.global.black_white_mixer;
        assert_eq!(settings.source_class, MONOCHROME_SENSOR_SOURCE);
        let output = apply_black_white_mixer([8.0, 0.4, 0.2], settings, true);
        assert_eq!(output, [output[0]; 3]);
        assert!(output[0] > 1.0);
    }

    #[test]
    fn color_balance_preserve_luminance_keeps_black_input_black() {
        let settings = get_all_adjustments_from_json(
            &json!({
                "colorBalanceRgb": {
                    "enabled": true,
                    "preserveLuminance": true,
                    "shadows": { "red": 100, "green": 0, "blue": 0 },
                    "midtones": { "red": 0, "green": 0, "blue": 0 },
                    "highlights": { "red": 0, "green": 0, "blue": 0 }
                }
            }),
            false,
            None,
        );

        assert_eq!(
            apply_color_balance_rgb([0.0, 0.0, 0.0], settings.global.color_balance_rgb, false),
            [0.0, 0.0, 0.0]
        );
    }
}

#[cfg(all(test, feature = "tauri-test"))]
mod gpu_runtime_tests {
    use image::{DynamicImage, ImageBuffer, Rgba};
    use serde_json::json;
    use tauri::Manager;

    use crate::AppState;
    use crate::adjustments::parse::get_all_adjustments_from_json;
    use crate::gpu_processing::{
        RenderRequest, Roi, acquire_gpu_test_lock, get_or_init_compute_gpu_context_for_tests,
        process_and_get_dynamic_image, process_and_get_unclamped_dynamic_image,
    };

    fn render_request(
        adjustments: crate::adjustments::abi::AllAdjustments,
        roi: Option<Roi>,
    ) -> RenderRequest<'static> {
        RenderRequest {
            adjustments,
            mask_bitmaps: &[],
            lut: None,
            roi,
            edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::TestOnlyLegacy,
        }
    }

    fn max_rgb_delta(left: &DynamicImage, right: &DynamicImage) -> f32 {
        left.to_rgba32f()
            .into_raw()
            .chunks_exact(4)
            .zip(right.to_rgba32f().into_raw().chunks_exact(4))
            .map(|(left, right)| {
                (0..3)
                    .map(|channel| (left[channel] - right[channel]).abs())
                    .fold(0.0_f32, f32::max)
            })
            .fold(0.0_f32, f32::max)
    }

    #[test]
    fn color_mixers_share_preview_zoom_and_export_pixels_without_reapplication() {
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            2,
            2,
            Rgba([0.68, 0.48, 0.34, 1.0]),
        ));
        let _gpu_test_guard = acquire_gpu_test_lock();
        let recipe = json!({
            "colorBalanceRgb": {
                "enabled": true,
                "preserveLuminance": false,
                "shadows": { "red": 0, "green": 0, "blue": 0 },
                "midtones": { "red": 100, "green": -40, "blue": 20 },
                "highlights": { "red": 0, "green": 0, "blue": 0 }
            },
            "channelMixer": {
                "enabled": true,
                "preserveLuminance": false,
                "red": { "red": 0, "green": 100, "blue": 0, "constant": 0 },
                "green": { "red": 0, "green": 0, "blue": 100, "constant": 0 },
                "blue": { "red": 100, "green": 0, "blue": 0, "constant": 0 }
            },
            "blackWhiteMixer": {
                "enabled": true,
                "weights": {
                    "reds": 100,
                    "oranges": 0,
                    "yellows": 0,
                    "greens": 0,
                    "aquas": 0,
                    "blues": 0,
                    "purples": 0,
                    "magentas": 0
                }
            }
        });
        let adjustments = get_all_adjustments_from_json(&recipe, false, None);
        let disabled_adjustments = get_all_adjustments_from_json(&json!({}), false, None);

        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");

        let preview = process_and_get_dynamic_image(
            &context,
            &state,
            &source,
            crate::gpu_processing::PreGpuImageIdentity::for_test_source(&source, "mixer_preview"),
            render_request(adjustments, None),
            "color_mixer_preview",
        )
        .expect("preview render succeeds");
        let zoom = process_and_get_dynamic_image(
            &context,
            &state,
            &source,
            crate::gpu_processing::PreGpuImageIdentity::for_test_source(&source, "mixer_preview"),
            render_request(
                adjustments,
                Some(Roi {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                }),
            ),
            "color_mixer_zoom",
        )
        .expect("zoom render succeeds");
        let export = process_and_get_unclamped_dynamic_image(
            &context,
            &state,
            &source,
            crate::gpu_processing::PreGpuImageIdentity::for_test_source(&source, "mixer_preview"),
            render_request(adjustments, None),
            "color_mixer_export",
        )
        .expect("export render succeeds");
        let disabled = process_and_get_dynamic_image(
            &context,
            &state,
            &source,
            crate::gpu_processing::PreGpuImageIdentity::for_test_source(&source, "mixer_disabled"),
            render_request(disabled_adjustments, None),
            "color_mixer_disabled",
        )
        .expect("disabled render succeeds");

        let preview_pixel = DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            1,
            1,
            *preview.to_rgba32f().get_pixel(0, 0),
        ));
        assert!(
            max_rgb_delta(&preview, &export) < 0.002,
            "preview and export must share the mixer result"
        );
        assert!(
            max_rgb_delta(&preview_pixel, &zoom) < 0.002,
            "the zoom ROI must match the full preview pixel"
        );
        assert!(
            max_rgb_delta(&preview, &disabled) > 0.05,
            "large enabled mixer controls must visibly change the render"
        );
    }

    #[test]
    fn neutral_scene_monochrome_matches_cpu_wgpu_and_preserves_output_headroom() {
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(4, 4, |x, y| {
            let scale = 1.0 + (x + y) as f32 * 0.1;
            Rgba([2.4 * scale, 0.7 * scale, 0.2 * scale, 0.63])
        }));
        let raw = json!({
            "rawEngineEditGraphVersion": 2,
            "blackWhiteMixer": {
                "enabled": true,
                "process": "neutral_panchromatic_v1",
                "weights": {
                    "reds": 0, "oranges": 0, "yellows": 0, "greens": 0,
                    "aquas": 0, "blues": 0, "purples": 0, "magentas": 0
                }
            }
        });
        let plan = crate::render_plan::compile_render_plan(
            &raw,
            crate::render_plan::CompileRenderPlanContext {
                revision: crate::render_plan::content_revision(&raw, 1, 2, 3),
                is_raw: false,
                tonemapper_override: Some(0),
            },
            None,
        )
        .expect("neutral monochrome plan compiles");
        assert_eq!(plan.adjustments.global.black_white_mixer.process, 1);

        let legacy_raw = json!({
            "rawEngineEditGraphVersion": 2,
            "blackWhiteMixer": {
                "enabled": true,
                "process": "legacy_fixed_band_v1",
                "weights": {
                    "reds": 1, "oranges": 0, "yellows": 0, "greens": 0,
                    "aquas": 0, "blues": 0, "purples": 0, "magentas": 0
                }
            }
        });
        let legacy_plan = crate::render_plan::compile_render_plan(
            &legacy_raw,
            crate::render_plan::CompileRenderPlanContext {
                revision: crate::render_plan::content_revision(&legacy_raw, 1, 2, 3),
                is_raw: false,
                tonemapper_override: Some(0),
            },
            None,
        )
        .expect("legacy monochrome plan compiles");
        assert_ne!(plan.fingerprints.color, legacy_plan.fingerprints.color);

        let cpu = crate::cpu_edit_graph::execute_cpu_edit_graph(
            &source,
            &plan.adjustments,
            &[],
            None,
            &plan.edit_graph,
        )
        .expect("CPU neutral monochrome render succeeds");

        let _gpu_test_guard = acquire_gpu_test_lock();
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");
        let gpu = process_and_get_unclamped_dynamic_image(
            &context,
            &state,
            &source,
            crate::gpu_processing::PreGpuImageIdentity::for_test_source(
                &source,
                "neutral_scene_monochrome_v1",
            ),
            RenderRequest {
                adjustments: plan.adjustments,
                mask_bitmaps: &[],
                lut: None,
                roi: None,
                edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(
                    plan.edit_graph,
                ),
            },
            "neutral_scene_monochrome_v1",
        )
        .expect("WGPU neutral monochrome render succeeds");

        assert!(
            max_rgb_delta(&cpu, &gpu) <= 0.004,
            "CPU/WGPU neutral process diverged"
        );
        for pixel in gpu.to_rgba32f().pixels() {
            assert!((pixel[0] - pixel[1]).abs() <= 0.002);
            assert!((pixel[1] - pixel[2]).abs() <= 0.002);
            assert!((pixel[3] - 0.63).abs() <= 0.002);
        }
        assert!(
            gpu.to_rgba32f().pixels().any(|pixel| pixel[0] > 1.0),
            "unclamped output proof must retain scene headroom"
        );
    }

    #[test]
    fn continuous_scene_monochrome_matches_cpu_wgpu_and_separates_colors() {
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(8, 4, |x, y| {
            let scale = 1.0 + y as f32 * 0.25;
            if x < 4 {
                Rgba([8.0 * scale, 0.25 * scale, 0.08 * scale, 0.71])
            } else {
                Rgba([0.08 * scale, 0.35 * scale, 8.0 * scale, 0.71])
            }
        }));
        let raw = json!({
            "rawEngineEditGraphVersion": 2,
            "blackWhiteMixer": {
                "enabled": true,
                "process": "continuous_sensitivity_v1",
                "weights": {
                    "reds": 100, "oranges": 70, "yellows": 20, "greens": -40,
                    "aquas": -80, "blues": -100, "purples": -20, "magentas": 60
                }
            }
        });
        let plan = crate::render_plan::compile_render_plan(
            &raw,
            crate::render_plan::CompileRenderPlanContext {
                revision: crate::render_plan::content_revision(&raw, 7, 8, 9),
                is_raw: true,
                tonemapper_override: Some(0),
            },
            None,
        )
        .expect("continuous monochrome plan compiles");
        assert_eq!(plan.adjustments.global.black_white_mixer.process, 2);
        let cpu = crate::cpu_edit_graph::execute_cpu_edit_graph(
            &source,
            &plan.adjustments,
            &[],
            None,
            &plan.edit_graph,
        )
        .expect("CPU continuous monochrome render succeeds");

        let _gpu_test_guard = acquire_gpu_test_lock();
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");
        let gpu = process_and_get_unclamped_dynamic_image(
            &context,
            &state,
            &source,
            crate::gpu_processing::PreGpuImageIdentity::for_test_source(
                &source,
                "continuous_scene_monochrome_v1",
            ),
            RenderRequest {
                adjustments: plan.adjustments,
                mask_bitmaps: &[],
                lut: None,
                roi: None,
                edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(
                    plan.edit_graph,
                ),
            },
            "continuous_scene_monochrome_v1",
        )
        .expect("WGPU continuous monochrome render succeeds");

        let parity_delta = max_rgb_delta(&cpu, &gpu);
        assert!(parity_delta <= 0.008, "CPU/WGPU delta {parity_delta}");
        for pixel in gpu.to_rgba32f().pixels() {
            assert!((pixel[0] - pixel[1]).abs() <= 0.002);
            assert!((pixel[1] - pixel[2]).abs() <= 0.002);
            assert!((pixel[3] - 0.71).abs() <= 0.002);
        }
        let output = gpu.to_rgba32f();
        assert!(
            (output.get_pixel(0, 0)[0] - output.get_pixel(7, 0)[0]).abs() > 0.1,
            "continuous sensitivity must separate distinct source colors"
        );
    }

    #[test]
    fn scene_monochrome_toning_matches_cpu_wgpu_preview_export_and_batch() {
        use std::sync::Arc;

        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(4, 3, |x, y| {
            let scale = 0.6 + (x + y) as f32 * 0.3;
            Rgba([1.2 * scale, 0.45 * scale, 0.18 * scale, 0.82])
        }));
        let raw = json!({
            "rawEngineEditGraphVersion": 2,
            "blackWhiteMixer": {
                "enabled": true,
                "process": "continuous_sensitivity_v1",
                "weights": {
                    "reds": 35, "oranges": 20, "yellows": 0, "greens": -10,
                    "aquas": -20, "blues": -30, "purples": 0, "magentas": 20
                }
            },
            "colorGrading": {
                "shadows": {"hue": 220, "saturation": 20, "luminance": 0},
                "midtones": {"hue": 35, "saturation": 12, "luminance": 0},
                "highlights": {"hue": 48, "saturation": 18, "luminance": 0},
                "global": {"hue": 32, "saturation": 16, "luminance": 0},
                "blending": 50,
                "balance": 0
            }
        });
        let plan = crate::render_plan::compile_render_plan(
            &raw,
            crate::render_plan::CompileRenderPlanContext {
                revision: crate::render_plan::content_revision(&raw, 11, 12, 13),
                is_raw: true,
                tonemapper_override: Some(0),
            },
            None,
        )
        .expect("toned monochrome plan compiles");
        assert_eq!(
            plan.adjustments
                .global
                .black_white_mixer
                .implementation_version,
            crate::monochrome::MONOCHROME_IMPLEMENTATION_VERSION
        );
        let cpu = crate::cpu_edit_graph::execute_cpu_edit_graph(
            &source,
            &plan.adjustments,
            &[],
            None,
            &plan.edit_graph,
        )
        .expect("CPU toned monochrome render succeeds");
        let mut legacy_raw = raw.clone();
        legacy_raw["blackWhiteMixer"]["process"] = json!("legacy_fixed_band_v1");
        let legacy_plan = crate::render_plan::compile_render_plan(
            &legacy_raw,
            crate::render_plan::CompileRenderPlanContext {
                revision: crate::render_plan::content_revision(&legacy_raw, 11, 12, 14),
                is_raw: true,
                tonemapper_override: Some(0),
            },
            None,
        )
        .expect("legacy toned monochrome plan compiles");
        let legacy = crate::cpu_edit_graph::execute_cpu_edit_graph(
            &source,
            &legacy_plan.adjustments,
            &[],
            None,
            &legacy_plan.edit_graph,
        )
        .expect("legacy monochrome render succeeds");
        assert!(legacy.to_rgba32f().pixels().all(|pixel| {
            (pixel[0] - pixel[1]).abs() <= 1.0e-6 && (pixel[1] - pixel[2]).abs() <= 1.0e-6
        }));

        let _gpu_test_guard = acquire_gpu_test_lock();
        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");
        let render = |consumer: &str| {
            process_and_get_unclamped_dynamic_image(
                &context,
                &state,
                &source,
                crate::gpu_processing::PreGpuImageIdentity::for_test_source(&source, consumer),
                RenderRequest {
                    adjustments: plan.adjustments,
                    mask_bitmaps: &[],
                    lut: None,
                    roi: None,
                    edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(
                        Arc::clone(&plan.edit_graph),
                    ),
                },
                consumer,
            )
            .expect("WGPU toned monochrome render succeeds")
        };
        let preview = render("monochrome_toning_preview");
        let export = render("monochrome_toning_export");
        let batch = render("monochrome_toning_batch");

        assert!(max_rgb_delta(&cpu, &preview) <= 0.008);
        assert!(max_rgb_delta(&preview, &export) <= 0.001);
        assert!(max_rgb_delta(&export, &batch) <= 0.001);
        assert!(
            preview.to_rgba32f().pixels().any(|pixel| {
                (pixel[0] - pixel[1]).abs().max((pixel[1] - pixel[2]).abs()) > 0.01
            })
        );
        assert!(preview.to_rgba32f().pixels().all(|pixel| {
            pixel.0.iter().all(|channel| channel.is_finite()) && (pixel[3] - 0.82).abs() <= 0.002
        }));
    }
}
