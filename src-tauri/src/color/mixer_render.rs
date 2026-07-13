use std::borrow::Cow;

use image::{DynamicImage, ImageBuffer, Rgba};
use rayon::prelude::*;

use crate::adjustments::abi::{
    BlackWhiteMixerSettings, ChannelMixerRow, ChannelMixerSettings, ColorBalanceRgbSettings,
    GlobalAdjustments,
};

const REC709_RED: f32 = 0.2126;
const REC709_GREEN: f32 = 0.7152;
const REC709_BLUE: f32 = 0.0722;

const BLACK_WHITE_MIXER_RANGE_CENTERS: [f32; 8] =
    [358.0, 25.0, 60.0, 115.0, 180.0, 225.0, 280.0, 330.0];
const BLACK_WHITE_MIXER_RANGE_WIDTHS: [f32; 8] = [35.0, 45.0, 40.0, 90.0, 60.0, 60.0, 55.0, 50.0];

pub(crate) fn apply_native_color_mixer_adjustments<'a>(
    image: Cow<'a, DynamicImage>,
    global: &GlobalAdjustments,
) -> Cow<'a, DynamicImage> {
    if !has_active_native_color_mixer_adjustments(global) {
        return image;
    }

    let (width, height) = (image.width(), image.height());
    let mut pixels = image.to_rgba32f().into_raw();

    pixels.par_chunks_exact_mut(4).for_each(|pixel| {
        let mut color = [pixel[0], pixel[1], pixel[2]];
        color = apply_color_balance_rgb(color, global.color_balance_rgb);
        color = apply_channel_mixer(color, global.channel_mixer);
        color = apply_black_white_mixer(color, global.black_white_mixer);
        pixel[..3].copy_from_slice(&color);
    });

    let rendered = ImageBuffer::<Rgba<f32>, Vec<f32>>::from_raw(width, height, pixels)
        .expect("RGBA32F buffer dimensions must match its pixel data");
    Cow::Owned(DynamicImage::ImageRgba32F(rendered))
}

pub(crate) fn has_active_native_color_mixer_adjustments(global: &GlobalAdjustments) -> bool {
    global.color_balance_rgb.enabled != 0
        || global.channel_mixer.enabled != 0
        || global.black_white_mixer.enabled != 0
}

fn apply_color_balance_rgb(color: [f32; 3], settings: ColorBalanceRgbSettings) -> [f32; 3] {
    if settings.enabled == 0 {
        return color;
    }

    let source_luma = rec709_luma(color);
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
    let balanced = clamp_rgb(add_rgb(color, offset));

    if settings.preserve_luminance == 0 {
        return balanced;
    }

    preserve_color_balance_luminance(balanced, source_luma)
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

fn apply_channel_mixer(color: [f32; 3], settings: ChannelMixerSettings) -> [f32; 3] {
    if settings.enabled == 0 {
        return color;
    }

    let mixed = [
        apply_channel_mixer_row(color, settings.red),
        apply_channel_mixer_row(color, settings.green),
        apply_channel_mixer_row(color, settings.blue),
    ];

    if settings.preserve_luminance == 0 {
        return mixed;
    }

    let source_luma = rec709_luma(color);
    if source_luma <= 0.0 {
        return mixed;
    }

    preserve_color_balance_luminance(mixed, source_luma)
}

fn apply_channel_mixer_row(color: [f32; 3], row: ChannelMixerRow) -> f32 {
    (color[0] * row.red + color[1] * row.green + color[2] * row.blue + row.constant).clamp(0.0, 1.0)
}

fn apply_black_white_mixer(color: [f32; 3], settings: BlackWhiteMixerSettings) -> [f32; 3] {
    if settings.enabled == 0 {
        return color;
    }

    let luma = rec709_luma(color);
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

    let mixed = (luma * (1.0 + weighted_adjustment * 0.5)).clamp(0.0, 1.0);
    [mixed; 3]
}

fn preserve_color_balance_luminance(color: [f32; 3], source_luma: f32) -> [f32; 3] {
    let output_luma = rec709_luma(color);
    if output_luma <= 0.0 {
        return color;
    }

    clamp_rgb(scale_rgb(color, source_luma / output_luma))
}

fn rec709_luma(color: [f32; 3]) -> f32 {
    color[0] * REC709_RED + color[1] * REC709_GREEN + color[2] * REC709_BLUE
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
                apply_color_balance_rgb(source, adjustments.global.color_balance_rgb),
                adjustments.global.channel_mixer,
            ),
            adjustments.global.black_white_mixer,
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

        let result = apply_black_white_mixer(source, adjustments.global.black_white_mixer);

        assert!((result[0] - expected).abs() < 0.000_001);
        assert_eq!(result, [result[0]; 3]);
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
            apply_color_balance_rgb([0.0, 0.0, 0.0], settings.global.color_balance_rgb),
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
        RenderRequest, Roi, get_or_init_compute_gpu_context_for_tests,
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
            crate::gpu_processing::PreGpuImageIdentity::for_source(&source, "mixer_preview"),
            render_request(adjustments, None),
            "color_mixer_preview",
        )
        .expect("preview render succeeds");
        let zoom = process_and_get_dynamic_image(
            &context,
            &state,
            &source,
            crate::gpu_processing::PreGpuImageIdentity::for_source(&source, "mixer_preview"),
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
            crate::gpu_processing::PreGpuImageIdentity::for_source(&source, "mixer_preview"),
            render_request(adjustments, None),
            "color_mixer_export",
        )
        .expect("export render succeeds");
        let disabled = process_and_get_dynamic_image(
            &context,
            &state,
            &source,
            crate::gpu_processing::PreGpuImageIdentity::for_source(&source, "mixer_disabled"),
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
}
