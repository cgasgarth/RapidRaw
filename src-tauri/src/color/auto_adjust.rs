use image::DynamicImage;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::AppState;
use crate::color::white_balance::{WHITE_BALANCE_CONTRACT, estimate_cct_duv_from_xy};
use crate::image_processing::downscale_f32_image;

/// Stable identifier for the pre-scene-referred RGB8 Auto process. This process remains
/// callable for saved automation and batch compatibility; new editor Auto uses auto_edit_v1.
pub const LEGACY_AUTO_ADJUST_PROCESS: &str = "legacy_auto_adjust_v1";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AutoAdjustmentResults {
    pub exposure: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub vibrancy: f64,
    pub vignette_amount: f64,
    pub temperature: f64,
    pub tint: f64,
    pub wb_kelvin: f64,
    pub wb_duv: f64,
    pub wb_x: f64,
    pub wb_y: f64,
    pub wb_confidence: f64,
    pub wb_accepted_samples: u64,
    pub wb_rejected_samples: u64,
    pub dehaze: f64,
    pub clarity: f64,
    pub centre: f64,
    pub blacks: f64,
    pub whites: f64,
}

pub fn perform_auto_analysis(image: &DynamicImage) -> AutoAdjustmentResults {
    const ANALYSIS_MAX_DIM: u32 = 1024;

    const LUMA_R: f32 = 0.2126;
    const LUMA_G: f32 = 0.7152;
    const LUMA_B: f32 = 0.0722;

    const EXPOSURE_MIDPOINT: f64 = 128.0;
    const EXPOSURE_SCALE: f64 = 0.125;
    const WHITE_POINT_HARD_LIMIT: usize = 245;
    const HIGHLIGHT_LUMA_THRESHOLD: usize = 240;
    const CLIPPED_LUMA_THRESHOLD: usize = 250;
    const HIGHLIGHT_PERCENT_THRESHOLD: f64 = 0.02;
    const CLIPPED_PERCENT_THRESHOLD: f64 = 0.005;
    const EXPOSURE_CEILING: f64 = 250.0;

    const TARGET_RANGE: f64 = 220.0;
    const CONTRAST_SCALE: f64 = 10.0;
    const HIGHLIGHT_CONTRAST_REDUCE: f64 = 0.5;

    const SHADOW_LUMA_MAX: usize = 32;
    const SHADOW_PERCENT_THRESHOLD: f64 = 0.05;
    const SHADOW_BOOST_SCALE: f64 = 40.0;
    const SHADOW_MAX: f64 = 50.0;
    const HIGHLIGHT_BOOST_SCALE: f64 = 120.0;
    const HIGHLIGHT_MAX: f64 = 70.0;

    const VIBRANCY_SAT_THRESHOLD: f32 = 0.2;
    const VIBRANCY_SCALE: f64 = 120.0;

    const DEHAZE_RANGE_THRESHOLD: f64 = 120.0;
    const DEHAZE_SAT_THRESHOLD: f32 = 0.15;
    const DEHAZE_SCALE: f64 = 35.0;
    const CLARITY_RANGE_THRESHOLD: f64 = 180.0;
    const CLARITY_SCALE: f64 = 50.0;

    const VIGNETTE_CENTER_LOW: f32 = 0.25;
    const VIGNETTE_CENTER_HIGH: f32 = 0.75;

    const VIGNETTE_SCALE: f64 = 100.0;
    const VIGNETTE_CENTRE_DIFF_THRESHOLD: f32 = 0.05;
    const CENTRE_SCALE: f64 = 100.0;
    const CENTRE_MAX: f64 = 60.0;

    const MID_GRAY: f64 = 128.0;
    const BLACKS_SCALE: f64 = 0.5;
    const WHITES_SCALE: f64 = 0.2;
    const EXPOSURE_OUTPUT_SCALE: f64 = 20.0;
    const BRIGHTNESS_SCALE: f64 = 0.007;

    let analysis_preview = downscale_f32_image(image, ANALYSIS_MAX_DIM, ANALYSIS_MAX_DIM);
    let rgb_image = analysis_preview.to_rgb8();
    let auto_white_balance = estimate_auto_white_balance(&rgb_image);
    let total_pixels = (rgb_image.width() * rgb_image.height()) as f64;

    let (width, height) = rgb_image.dimensions();
    let cx0 = (width as f32 * VIGNETTE_CENTER_LOW) as u32;
    let cx1 = (width as f32 * VIGNETTE_CENTER_HIGH) as u32;
    let cy0 = (height as f32 * VIGNETTE_CENTER_LOW) as u32;
    let cy1 = (height as f32 * VIGNETTE_CENTER_HIGH) as u32;

    let mut luma_hist = vec![0u32; 256];
    let mut mean_saturation = 0.0f32;
    let mut center_sum = 0.0f32;
    let mut edge_sum = 0.0f32;
    let mut center_n = 0u32;
    let mut edge_n = 0u32;

    for (x, y, pixel) in rgb_image.enumerate_pixels() {
        let r = pixel[0] as f32;
        let g = pixel[1] as f32;
        let b = pixel[2] as f32;

        let luma_f = LUMA_R * r + LUMA_G * g + LUMA_B * b;
        luma_hist[(luma_f.round() as usize).min(255)] += 1;

        let r_n = r / 255.0;
        let g_n = g / 255.0;
        let b_n = b / 255.0;
        let max_c = r_n.max(g_n).max(b_n);
        let min_c = r_n.min(g_n).min(b_n);
        if max_c > 0.0 {
            let s = (max_c - min_c) / max_c;
            mean_saturation += s;
        }

        let luma_norm = luma_f / 255.0;
        if x >= cx0 && x < cx1 && y >= cy0 && y < cy1 {
            center_sum += luma_norm;
            center_n += 1;
        } else {
            edge_sum += luma_norm;
            edge_n += 1;
        }
    }

    mean_saturation /= total_pixels as f32;

    let percentile = |hist: &Vec<u32>, p: f64| -> usize {
        let target = (total_pixels * p) as u32;
        let mut cumulative = 0u32;
        for (i, &v) in hist.iter().enumerate() {
            cumulative += v;
            if cumulative >= target {
                return i;
            }
        }
        255
    };

    let p1 = percentile(&luma_hist, 0.01);
    let p50 = percentile(&luma_hist, 0.50);
    let p99 = percentile(&luma_hist, 0.99);

    let black_point = p1;
    let white_point = p99;
    let range = (white_point as f64 - black_point as f64).max(1.0);

    let highlight_percent =
        luma_hist[HIGHLIGHT_LUMA_THRESHOLD..256].iter().sum::<u32>() as f64 / total_pixels;
    let clipped_percent =
        luma_hist[CLIPPED_LUMA_THRESHOLD..256].iter().sum::<u32>() as f64 / total_pixels;

    let mut exposure = (EXPOSURE_MIDPOINT - p50 as f64) * EXPOSURE_SCALE;

    if white_point > WHITE_POINT_HARD_LIMIT
        || highlight_percent > HIGHLIGHT_PERCENT_THRESHOLD
        || clipped_percent > CLIPPED_PERCENT_THRESHOLD
    {
        exposure = exposure.min(0.0);
    }

    if white_point as f64 + exposure > EXPOSURE_CEILING {
        exposure = EXPOSURE_CEILING - white_point as f64;
    }

    let mut contrast = 0.0f64;
    if range < TARGET_RANGE {
        contrast = ((TARGET_RANGE / range) - 1.0) * CONTRAST_SCALE;
    }
    if highlight_percent > HIGHLIGHT_PERCENT_THRESHOLD {
        contrast *= HIGHLIGHT_CONTRAST_REDUCE;
    }

    let shadow_percent = luma_hist[0..SHADOW_LUMA_MAX].iter().sum::<u32>() as f64 / total_pixels;

    let mut shadows = 0.0f64;
    if shadow_percent > SHADOW_PERCENT_THRESHOLD {
        shadows = (shadow_percent * SHADOW_BOOST_SCALE).min(SHADOW_MAX);
    }

    let mut highlights = 0.0f64;
    if highlight_percent > HIGHLIGHT_PERCENT_THRESHOLD {
        highlights = -(highlight_percent * HIGHLIGHT_BOOST_SCALE).min(HIGHLIGHT_MAX);
    }

    let mut vibrancy = 0.0f64;
    if mean_saturation < VIBRANCY_SAT_THRESHOLD {
        vibrancy = (VIBRANCY_SAT_THRESHOLD - mean_saturation) as f64 * VIBRANCY_SCALE;
    }

    let mut dehaze = 0.0f64;
    if range < DEHAZE_RANGE_THRESHOLD && mean_saturation < DEHAZE_SAT_THRESHOLD {
        dehaze = (1.0 - range / DEHAZE_RANGE_THRESHOLD) * DEHAZE_SCALE;
    }

    let mut clarity = 0.0f64;
    if range < CLARITY_RANGE_THRESHOLD {
        clarity = (1.0 - range / CLARITY_RANGE_THRESHOLD) * CLARITY_SCALE;
    }

    let mut vignette_amount = 0.0f64;
    let mut centre = 0.0f64;

    if center_n > 0 && edge_n > 0 {
        let c_avg = center_sum / center_n as f32;
        let e_avg = edge_sum / edge_n as f32;

        if e_avg < c_avg {
            let diff = c_avg - e_avg;
            vignette_amount = -(diff as f64 * VIGNETTE_SCALE);

            if diff > VIGNETTE_CENTRE_DIFF_THRESHOLD {
                centre = (diff as f64 * CENTRE_SCALE).min(CENTRE_MAX);
            }
        }
    }

    let mut adjusted_luma_hist = vec![0u32; 256];
    for pixel in rgb_image.pixels() {
        let r = pixel[0] as f64;
        let g = pixel[1] as f64;
        let b = pixel[2] as f64;
        let mut luma = LUMA_R as f64 * r + LUMA_G as f64 * g + LUMA_B as f64 * b;
        luma += exposure;
        luma = (luma - MID_GRAY) * (1.0 + contrast / 100.0) + MID_GRAY;
        adjusted_luma_hist[luma.clamp(0.0, 255.0).round() as usize] += 1;
    }

    let adj_p1 = percentile(&adjusted_luma_hist, 0.01);
    let adj_p50 = percentile(&adjusted_luma_hist, 0.50);
    let adj_p99 = percentile(&adjusted_luma_hist, 0.99);
    let blacks: f64 = -(adj_p1 as f64 * BLACKS_SCALE);
    let whites: f64 = (adj_p99 as f64 - 255.0) * WHITES_SCALE;
    let brightness: f64 = (MID_GRAY - adj_p50 as f64) * BRIGHTNESS_SCALE;

    AutoAdjustmentResults {
        exposure: (exposure / EXPOSURE_OUTPUT_SCALE).clamp(-5.0, 5.0),
        brightness: brightness.clamp(-5.0, 5.0),
        contrast: contrast.clamp(-100.0, 100.0),
        highlights: highlights.clamp(-100.0, 100.0),
        shadows: shadows.clamp(-100.0, 100.0),
        vibrancy: vibrancy.clamp(-100.0, 100.0),
        vignette_amount: vignette_amount.clamp(-100.0, 100.0),
        temperature: 0.0,
        tint: 0.0,
        wb_kelvin: auto_white_balance.kelvin,
        wb_duv: auto_white_balance.duv,
        wb_x: auto_white_balance.xy[0],
        wb_y: auto_white_balance.xy[1],
        wb_confidence: auto_white_balance.confidence,
        wb_accepted_samples: auto_white_balance.accepted_samples,
        wb_rejected_samples: auto_white_balance.rejected_samples,
        dehaze: dehaze.clamp(-100.0, 100.0),
        clarity: clarity.clamp(-100.0, 100.0),
        centre: centre.clamp(-100.0, 100.0),
        whites: whites.clamp(-100.0, 100.0),
        blacks: blacks.clamp(-100.0, 100.0),
    }
}

pub fn auto_results_to_json(results: &AutoAdjustmentResults) -> serde_json::Value {
    json!({
        "exposure": results.exposure,
        "brightness": results.brightness,
        "contrast": results.contrast,
        "highlights": results.highlights,
        "shadows": results.shadows,
        "vibrance": results.vibrancy,
        "vignetteAmount": results.vignette_amount,
        "clarity": results.clarity,
        "centré": results.centre,

        "dehaze": results.dehaze,
        "whiteBalanceTechnical": {
            "contract": WHITE_BALANCE_CONTRACT,
            "mode": "auto",
            "kelvin": results.wb_kelvin,
            "duv": results.wb_duv,
            "x": results.wb_x,
            "y": results.wb_y,
            "adaptation": "cat16_v1",
            "source": "auto",
            "confidence": results.wb_confidence,
            "sampleCount": results.wb_accepted_samples
        },
        "whiteBalanceMigration": "native_v1",
        "sectionVisibility": {
            "basic": true,
            "color": true,
            "effects": true
        },
        "whites": results.whites,
        "blacks": results.blacks
    })
}

#[derive(Debug, Clone, Copy)]
struct AutoWhiteBalanceEstimate {
    kelvin: f64,
    duv: f64,
    xy: [f64; 2],
    confidence: f64,
    accepted_samples: u64,
    rejected_samples: u64,
}

fn srgb_to_linear(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn estimate_auto_white_balance(image: &image::RgbImage) -> AutoWhiteBalanceEstimate {
    let mut samples = Vec::new();
    let mut rejected = 0_u64;
    for pixel in image.pixels().step_by(4) {
        let rgb = pixel.0.map(|value| f64::from(value) / 255.0);
        let max = rgb.into_iter().fold(f64::NEG_INFINITY, f64::max);
        let min = rgb.into_iter().fold(f64::INFINITY, f64::min);
        let luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        let saturation = if max > 1e-9 { (max - min) / max } else { 1.0 };
        if !(0.04..=0.96).contains(&luma) || saturation > 0.28 || max >= 0.995 || min <= 0.005 {
            rejected += 1;
            continue;
        }
        let linear = rgb.map(srgb_to_linear);
        samples.push(linear);
    }
    if samples.len() < 16 {
        return AutoWhiteBalanceEstimate {
            kelvin: 6_004.0,
            duv: 0.0,
            xy: [0.32168, 0.33767],
            confidence: 0.0,
            accepted_samples: samples.len() as u64,
            rejected_samples: rejected,
        };
    }
    let mut channels: [Vec<f64>; 3] = std::array::from_fn(|_| Vec::with_capacity(samples.len()));
    for sample in &samples {
        for channel in 0..3 {
            channels[channel].push(sample[channel]);
        }
    }
    for channel in &mut channels {
        channel.sort_by(f64::total_cmp);
    }
    let median = channels.map(|channel| channel[channel.len() / 2]);
    let xyz = [
        0.412_456_4 * median[0] + 0.357_576_1 * median[1] + 0.180_437_5 * median[2],
        0.212_672_9 * median[0] + 0.715_152_2 * median[1] + 0.072_175_0 * median[2],
        0.019_333_9 * median[0] + 0.119_192_0 * median[1] + 0.950_304_1 * median[2],
    ];
    let sum = xyz.into_iter().sum::<f64>();
    let xy = if sum > 1e-12 {
        [xyz[0] / sum, xyz[1] / sum]
    } else {
        [0.32168, 0.33767]
    };
    let coordinates = estimate_cct_duv_from_xy(xy).unwrap_or_else(|_| {
        estimate_cct_duv_from_xy([0.32168, 0.33767]).expect("D60 coordinates must be valid")
    });
    let accepted = samples.len() as u64;
    let acceptance = accepted as f64 / (accepted + rejected).max(1) as f64;
    AutoWhiteBalanceEstimate {
        kelvin: coordinates.cct_kelvin,
        duv: coordinates.duv,
        xy: coordinates.xy,
        confidence: (acceptance * (1.0 - coordinates.duv.abs() / 0.05)).clamp(0.0, 1.0),
        accepted_samples: accepted,
        rejected_samples: rejected,
    }
}

#[tauri::command]
pub fn calculate_auto_adjustments(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let original_image = state
        .original_image
        .lock()
        .unwrap()
        .as_ref()
        .ok_or("No image loaded for auto adjustments")?
        .image
        .clone();

    let results = perform_auto_analysis(&original_image);

    Ok(auto_results_to_json(&results))
}

#[tauri::command]
pub fn calculate_legacy_auto_adjustments_v1(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    log::trace!("auto_adjust_process={LEGACY_AUTO_ADJUST_PROCESS}");
    calculate_auto_adjustments(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_results_to_json_preserves_editor_adjustment_keys() {
        let results = AutoAdjustmentResults {
            exposure: 0.25,
            brightness: -0.1,
            contrast: 12.0,
            highlights: -8.0,
            shadows: 15.0,
            vibrancy: 20.0,
            vignette_amount: -5.0,
            temperature: 0.0,
            tint: 0.0,
            wb_kelvin: 6_504.0,
            wb_duv: 0.0,
            wb_x: 0.31271,
            wb_y: 0.32902,
            wb_confidence: 0.75,
            wb_accepted_samples: 128,
            wb_rejected_samples: 16,
            dehaze: 3.0,
            clarity: 4.0,
            centre: 2.0,
            blacks: -1.0,
            whites: 1.5,
        };

        let json = auto_results_to_json(&results);

        assert_eq!(json["exposure"], serde_json::json!(0.25));
        assert_eq!(json["vibrance"], serde_json::json!(20.0));
        assert_eq!(json["vignetteAmount"], serde_json::json!(-5.0));
        assert_eq!(json["centré"], serde_json::json!(2.0));
        assert_eq!(
            json["whiteBalanceTechnical"]["mode"],
            serde_json::json!("auto")
        );
        assert_eq!(
            json["whiteBalanceTechnical"]["sampleCount"],
            serde_json::json!(128)
        );
        assert_eq!(json["sectionVisibility"]["basic"], serde_json::json!(true));
        assert_eq!(
            json,
            serde_json::json!({
                "exposure": 0.25,
                "brightness": -0.1,
                "contrast": 12.0,
                "highlights": -8.0,
                "shadows": 15.0,
                "vibrance": 20.0,
                "vignetteAmount": -5.0,
                "clarity": 4.0,
                "centré": 2.0,
                "dehaze": 3.0,
                "whiteBalanceTechnical": {
                    "contract": "rapidraw.white_balance.v1",
                    "mode": "auto",
                    "kelvin": 6504.0,
                    "duv": 0.0,
                    "x": 0.31271,
                    "y": 0.32902,
                    "adaptation": "cat16_v1",
                    "source": "auto",
                    "confidence": 0.75,
                    "sampleCount": 128
                },
                "whiteBalanceMigration": "native_v1",
                "sectionVisibility": {"basic": true, "color": true, "effects": true},
                "whites": 1.5,
                "blacks": -1.0
            })
        );
        assert_eq!(LEGACY_AUTO_ADJUST_PROCESS, "legacy_auto_adjust_v1");
    }

    #[test]
    fn perform_auto_analysis_returns_bounded_adjustments() {
        let image = DynamicImage::new_rgb8(16, 16);
        let results = perform_auto_analysis(&image);

        for value in [
            results.exposure,
            results.brightness,
            results.contrast,
            results.highlights,
            results.shadows,
            results.vibrancy,
            results.vignette_amount,
            results.dehaze,
            results.clarity,
            results.centre,
            results.blacks,
            results.whites,
        ] {
            assert!((-100.0..=100.0).contains(&value));
        }
    }

    #[test]
    fn auto_white_balance_rejects_clipped_pixels_and_fails_safe() {
        let image = image::RgbImage::from_pixel(16, 16, image::Rgb([255, 255, 255]));
        let estimate = estimate_auto_white_balance(&image);
        assert_eq!(estimate.accepted_samples, 0);
        assert!(estimate.rejected_samples > 0);
        assert_eq!(estimate.confidence, 0.0);
        assert_eq!(estimate.xy, [0.32168, 0.33767]);
    }

    #[test]
    fn auto_white_balance_recovers_neutral_patch_with_receipt_counts() {
        let image = image::RgbImage::from_pixel(32, 32, image::Rgb([160, 160, 160]));
        let estimate = estimate_auto_white_balance(&image);
        assert!(estimate.accepted_samples >= 16);
        assert!(estimate.kelvin > 5_000.0);
        assert!(estimate.confidence > 0.5);
    }
}
