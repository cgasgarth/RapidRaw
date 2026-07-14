use image::{DynamicImage, GenericImageView, imageops};
use serde::{Deserialize, Serialize};

use crate::detail::multiscale::{
    DetailBandSettingsV1, DetailProcessV1, DetailStageClassV1, MultiscaleDetailPlanV1,
    MultiscaleDetailSettingsV1, apply_multiscale_detail,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum ResizeMode {
    LongEdge,
    ShortEdge,
    Width,
    Height,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResizeOptions {
    pub mode: ResizeMode,
    pub value: u32,
    pub dont_enlarge: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum OutputSharpeningTarget {
    Screen,
    Print,
    Custom,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutputSharpeningSettings {
    pub target: OutputSharpeningTarget,
    pub amount: f32,
    pub radius_px: f32,
    pub threshold: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum WatermarkAnchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkSettings {
    pub path: String,
    pub anchor: WatermarkAnchor,
    pub scale: f32,
    pub spacing: f32,
    pub opacity: f32,
}

pub(crate) fn calculate_resize_target(
    current_w: u32,
    current_h: u32,
    resize_opts: &ResizeOptions,
) -> (u32, u32) {
    if resize_opts.dont_enlarge {
        let exceeds = match resize_opts.mode {
            ResizeMode::LongEdge => current_w.max(current_h) > resize_opts.value,
            ResizeMode::ShortEdge => current_w.min(current_h) > resize_opts.value,
            ResizeMode::Width => current_w > resize_opts.value,
            ResizeMode::Height => current_h > resize_opts.value,
        };
        if !exceeds {
            return (current_w, current_h);
        }
    }

    let fix_width = match resize_opts.mode {
        ResizeMode::LongEdge => current_w >= current_h,
        ResizeMode::ShortEdge => current_w <= current_h,
        ResizeMode::Width => true,
        ResizeMode::Height => false,
    };

    let value = resize_opts.value;
    if fix_width {
        let h = (value as f32 * (current_h as f32 / current_w as f32)).round() as u32;
        (value, h)
    } else {
        let w = (value as f32 * (current_w as f32 / current_h as f32)).round() as u32;
        (w, value)
    }
}

pub(crate) fn apply_export_postprocess(
    mut image: DynamicImage,
    resize: Option<&ResizeOptions>,
    output_sharpening: Option<&OutputSharpeningSettings>,
    watermark: Option<&WatermarkSettings>,
) -> Result<DynamicImage, String> {
    if let Some(resize_opts) = resize {
        let (current_w, current_h) = image.dimensions();
        let (target_w, target_h) = calculate_resize_target(current_w, current_h, resize_opts);

        if target_w != current_w || target_h != current_h {
            image = image.resize(target_w, target_h, imageops::FilterType::Lanczos3);
        }
    }

    if let Some(output_sharpening) = output_sharpening {
        image = apply_output_sharpening(image, output_sharpening);
    }

    if let Some(watermark_settings) = watermark {
        apply_watermark(&mut image, watermark_settings)?;
    }
    Ok(image)
}

fn apply_watermark(
    base_image: &mut DynamicImage,
    watermark_settings: &WatermarkSettings,
) -> Result<(), String> {
    let watermark_img = image::open(&watermark_settings.path)
        .map_err(|e| format!("Failed to open watermark image: {}", e))?;

    let (base_w, base_h) = base_image.dimensions();
    let base_min_dim = base_w.min(base_h) as f32;

    let watermark_scale_factor =
        (base_min_dim * (watermark_settings.scale / 100.0)) / watermark_img.width().max(1) as f32;
    let new_wm_w = (watermark_img.width() as f32 * watermark_scale_factor).round() as u32;
    let new_wm_h = (watermark_img.height() as f32 * watermark_scale_factor).round() as u32;

    if new_wm_w == 0 || new_wm_h == 0 {
        return Ok(());
    }

    let scaled_watermark =
        watermark_img.resize_exact(new_wm_w, new_wm_h, image::imageops::FilterType::Lanczos3);
    let mut scaled_watermark_rgba = scaled_watermark.to_rgba8();

    let opacity_factor = (watermark_settings.opacity / 100.0).clamp(0.0, 1.0);
    for pixel in scaled_watermark_rgba.pixels_mut() {
        pixel[3] = (pixel[3] as f32 * opacity_factor) as u8;
    }
    let final_watermark = DynamicImage::ImageRgba8(scaled_watermark_rgba);

    let spacing_pixels = (base_min_dim * (watermark_settings.spacing / 100.0)) as i64;
    let (wm_w, wm_h) = final_watermark.dimensions();

    let x = match watermark_settings.anchor {
        WatermarkAnchor::TopLeft | WatermarkAnchor::CenterLeft | WatermarkAnchor::BottomLeft => {
            spacing_pixels
        }
        WatermarkAnchor::TopCenter | WatermarkAnchor::Center | WatermarkAnchor::BottomCenter => {
            (base_w as i64 - wm_w as i64) / 2
        }
        WatermarkAnchor::TopRight | WatermarkAnchor::CenterRight | WatermarkAnchor::BottomRight => {
            base_w as i64 - wm_w as i64 - spacing_pixels
        }
    };

    let y = match watermark_settings.anchor {
        WatermarkAnchor::TopLeft | WatermarkAnchor::TopCenter | WatermarkAnchor::TopRight => {
            spacing_pixels
        }
        WatermarkAnchor::CenterLeft | WatermarkAnchor::Center | WatermarkAnchor::CenterRight => {
            (base_h as i64 - wm_h as i64) / 2
        }
        WatermarkAnchor::BottomLeft
        | WatermarkAnchor::BottomCenter
        | WatermarkAnchor::BottomRight => base_h as i64 - wm_h as i64 - spacing_pixels,
    };

    image::imageops::overlay(base_image, &final_watermark, x, y);

    Ok(())
}

fn apply_output_sharpening(
    mut image: DynamicImage,
    settings: &OutputSharpeningSettings,
) -> DynamicImage {
    let amount = (settings.amount / 100.0).clamp(0.0, 1.0);
    if amount <= 0.0 {
        return image;
    }

    let (target_multiplier, band_shape) = match settings.target {
        OutputSharpeningTarget::Screen => (0.8, [1.0, 0.72, 0.24, 0.08, 0.0]),
        OutputSharpeningTarget::Print => (1.15, [0.72, 1.0, 0.55, 0.18, 0.04]),
        OutputSharpeningTarget::Custom => (1.0, [1.0, 0.85, 0.4, 0.12, 0.02]),
    };
    let effective_amount = amount * target_multiplier;
    let radius = settings.radius_px.clamp(0.3, 3.0);
    let threshold = settings.threshold.clamp(0.0, 1.0) * 0.05;
    let long_edge = image.width().max(image.height()).max(1) as f32;
    let reference_scale_px = (long_edge / radius).clamp(256.0, 20_000.0);
    let detail_settings = MultiscaleDetailSettingsV1 {
        bands: std::array::from_fn(|index| DetailBandSettingsV1 {
            edge_protection: 0.9 - index as f32 * 0.1,
            gain: band_shape[index],
            noise_protection: 0.95 - index as f32 * 0.15,
            threshold,
        }),
        chroma_detail: 0.0,
        halo_suppression: 0.88,
        highlight_protection: 0.9,
        overall_amount: effective_amount,
        process: DetailProcessV1::AtrousLumaV1,
        reference_scale_px,
        ringing_suppression: 0.9,
        shadow_noise_protection: 0.9,
    };
    let Ok(plan) = MultiscaleDetailPlanV1::compile_for_stage(
        detail_settings,
        image.width(),
        image.height(),
        DetailStageClassV1::OutputSharpening,
    ) else {
        return image;
    };
    let receipt = apply_multiscale_detail(&mut image, &plan);
    log::trace!(
        "output_multiscale_detail_receipt={}",
        serde_json::to_string(&receipt)
            .unwrap_or_else(|error| format!("receipt_encode_error:{error}"))
    );
    image
}

#[cfg(test)]
mod tests {
    use super::{
        OutputSharpeningSettings, OutputSharpeningTarget, ResizeMode, ResizeOptions,
        WatermarkAnchor, WatermarkSettings, apply_export_postprocess, calculate_resize_target,
    };
    use image::{DynamicImage, GenericImageView, ImageBuffer, Rgb, Rgba};

    fn synthetic_export_edge() -> DynamicImage {
        let mut buffer = ImageBuffer::<Rgb<f32>, Vec<f32>>::new(11, 5);
        for y in 0..5 {
            for x in 0..11 {
                let value = if x < 5 { 0.3 } else { 0.7 };
                buffer.put_pixel(x, y, Rgb([value, value, value]));
            }
        }
        DynamicImage::ImageRgb32F(buffer)
    }

    fn red_channel(image: &DynamicImage, x: u32, y: u32) -> f32 {
        image.to_rgb32f().get_pixel(x, y).0[0]
    }

    #[test]
    fn resize_target_preserves_aspect_for_each_mode() {
        assert_eq!(
            calculate_resize_target(
                4000,
                3000,
                &ResizeOptions {
                    mode: ResizeMode::LongEdge,
                    value: 2000,
                    dont_enlarge: false,
                },
            ),
            (2000, 1500)
        );
        assert_eq!(
            calculate_resize_target(
                4000,
                3000,
                &ResizeOptions {
                    mode: ResizeMode::ShortEdge,
                    value: 1500,
                    dont_enlarge: false,
                },
            ),
            (2000, 1500)
        );
        assert_eq!(
            calculate_resize_target(
                4000,
                3000,
                &ResizeOptions {
                    mode: ResizeMode::Width,
                    value: 1000,
                    dont_enlarge: false,
                },
            ),
            (1000, 750)
        );
        assert_eq!(
            calculate_resize_target(
                4000,
                3000,
                &ResizeOptions {
                    mode: ResizeMode::Height,
                    value: 600,
                    dont_enlarge: false,
                },
            ),
            (800, 600)
        );
    }

    #[test]
    fn resize_target_honors_no_enlarge() {
        assert_eq!(
            calculate_resize_target(
                4000,
                3000,
                &ResizeOptions {
                    mode: ResizeMode::LongEdge,
                    value: 6000,
                    dont_enlarge: true,
                },
            ),
            (4000, 3000)
        );
    }

    #[test]
    fn output_sharpening_increases_export_edge_contrast() {
        let before = synthetic_export_edge();
        let after = apply_export_postprocess(
            before.clone(),
            None,
            Some(&OutputSharpeningSettings {
                target: OutputSharpeningTarget::Print,
                amount: 70.0,
                radius_px: 1.2,
                threshold: 0.0,
            }),
            None,
        )
        .expect("output sharpening should process");

        let before_contrast = red_channel(&before, 5, 2) - red_channel(&before, 4, 2);
        let after_contrast = red_channel(&after, 5, 2) - red_channel(&after, 4, 2);

        assert!(
            after_contrast > before_contrast,
            "output sharpening should increase final export edge contrast"
        );
    }

    #[test]
    fn disabled_output_sharpening_preserves_export_pixels() {
        let before = synthetic_export_edge();
        let after = apply_export_postprocess(before.clone(), None, None, None)
            .expect("disabled output sharpening should process");

        for y in 0..5 {
            for x in 0..11 {
                assert_eq!(red_channel(&after, x, y), red_channel(&before, x, y));
            }
        }
    }

    #[test]
    fn output_sharpening_is_target_specific_and_runs_after_final_resize() {
        let input = DynamicImage::ImageRgb32F(ImageBuffer::from_fn(40, 24, |x, y| {
            let edge = if x >= 20 { 0.72 } else { 0.18 };
            let texture = (((x * 13 + y * 7) % 11) as f32 - 5.0) * 0.002;
            Rgb([edge + texture, edge + texture, edge + texture])
        }));
        let resize = ResizeOptions {
            mode: ResizeMode::Width,
            value: 20,
            dont_enlarge: false,
        };
        let settings = |target| OutputSharpeningSettings {
            target,
            amount: 75.0,
            radius_px: 1.0,
            threshold: 0.0,
        };
        let screen = apply_export_postprocess(
            input.clone(),
            Some(&resize),
            Some(&settings(OutputSharpeningTarget::Screen)),
            None,
        )
        .unwrap();
        let print = apply_export_postprocess(
            input,
            Some(&resize),
            Some(&settings(OutputSharpeningTarget::Print)),
            None,
        )
        .unwrap();

        assert_eq!(screen.dimensions(), (20, 12));
        assert_eq!(print.dimensions(), (20, 12));
        assert!(
            screen
                .to_rgb32f()
                .as_raw()
                .iter()
                .zip(print.to_rgb32f().as_raw())
                .any(|(screen, print)| (screen - print).abs() > 1.0e-6),
            "screen and print recipes must not alias"
        );
    }

    #[test]
    fn output_sharpening_preserves_scene_linear_headroom_until_encoding() {
        let input = DynamicImage::ImageRgb32F(ImageBuffer::from_fn(32, 16, |x, _| {
            let value = if x >= 16 { 1.35 } else { 0.82 };
            Rgb([value, value * 0.92, value * 0.8])
        }));
        let output = apply_export_postprocess(
            input,
            None,
            Some(&OutputSharpeningSettings {
                target: OutputSharpeningTarget::Print,
                amount: 60.0,
                radius_px: 1.2,
                threshold: 0.0,
            }),
            None,
        )
        .unwrap()
        .to_rgb32f();

        assert!(output.as_raw().iter().all(|value| value.is_finite()));
        assert!(
            output.as_raw().iter().any(|value| *value > 1.0),
            "output detail must not clamp HDR headroom before export encoding"
        );
    }

    #[test]
    fn zero_size_watermark_scale_leaves_image_unchanged() {
        let directory = tempfile::tempdir().expect("tempdir");
        let watermark_path = directory.path().join("watermark.png");
        DynamicImage::ImageRgba8(ImageBuffer::from_pixel(8, 8, Rgba([255, 0, 0, 255])))
            .save(&watermark_path)
            .expect("watermark should save");

        let before =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(10, 10, Rgba([0, 0, 0, 255])));
        let after = apply_export_postprocess(
            before.clone(),
            None,
            None,
            Some(&WatermarkSettings {
                path: watermark_path.to_string_lossy().into_owned(),
                anchor: WatermarkAnchor::BottomRight,
                scale: 0.0,
                spacing: 0.0,
                opacity: 100.0,
            }),
        )
        .expect("zero-size watermark should be ignored");

        assert_eq!(after.to_rgba8().as_raw(), before.to_rgba8().as_raw());
    }

    #[test]
    fn watermark_anchor_places_bottom_right_with_spacing() {
        let directory = tempfile::tempdir().expect("tempdir");
        let watermark_path = directory.path().join("watermark.png");
        DynamicImage::ImageRgba8(ImageBuffer::from_pixel(10, 10, Rgba([255, 0, 0, 255])))
            .save(&watermark_path)
            .expect("watermark should save");

        let base =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(100, 100, Rgba([0, 0, 0, 255])));
        let after = apply_export_postprocess(
            base,
            None,
            None,
            Some(&WatermarkSettings {
                path: watermark_path.to_string_lossy().into_owned(),
                anchor: WatermarkAnchor::BottomRight,
                scale: 10.0,
                spacing: 5.0,
                opacity: 100.0,
            }),
        )
        .expect("watermark should apply")
        .to_rgba8();

        assert_eq!(after.get_pixel(85, 85).0, [255, 0, 0, 255]);
        assert_eq!(after.get_pixel(84, 85).0, [0, 0, 0, 255]);
        assert_eq!(after.get_pixel(95, 95).0, [0, 0, 0, 255]);
    }
}
