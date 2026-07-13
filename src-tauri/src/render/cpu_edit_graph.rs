//! Deterministic CPU reference executor for the compiled color graph.
//!
//! This intentionally mirrors the WGSL equations. It is both the oversized-frame
//! fallback and the stage-level oracle used by GPU parity tests.

use glam::Vec3;
use image::{DynamicImage, ImageBuffer, Luma, Rgba};

use crate::adjustments::abi::{
    AllAdjustments, ColorCalibrationSettings, ColorGradeSettings, HslColor, LevelsSettings, Point,
};
use crate::edit_graph::CompiledEditGraph;
use crate::lut_processing::Lut;
use crate::mixer_render::{apply_black_white_mixer, apply_channel_mixer, apply_color_balance_rgb};

#[derive(Clone, Copy)]
struct EffectiveAdjustments {
    exposure: f32,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    hue: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,
    glow: f32,
    halation: f32,
    flare: f32,
    hsl: [HslColor; 8],
}

pub(crate) fn execute_cpu_edit_graph(
    base_image: &DynamicImage,
    adjustments: &AllAdjustments,
    mask_bitmaps: &[ImageBuffer<Luma<u8>, Vec<u8>>],
    lut: Option<&Lut>,
    graph: &CompiledEditGraph,
) -> Result<DynamicImage, &'static str> {
    graph.validate_contract()?;
    if graph.pipeline_version as f32 != adjustments.global.edit_graph_version {
        return Err("edit_graph.cpu_reference_version_mismatch");
    }
    let global = &adjustments.global;
    if global.sharpness != 0.0
        || global.luma_noise_reduction != 0.0
        || global.color_noise_reduction != 0.0
        || global.clarity != 0.0
        || global.dehaze != 0.0
        || global.structure != 0.0
        || global.centré != 0.0
        || global.glow_amount != 0.0
        || global.halation_amount != 0.0
        || global.flare_amount != 0.0
        || global.chromatic_aberration_red_cyan != 0.0
        || global.chromatic_aberration_blue_yellow != 0.0
    {
        return Err("edit_graph.cpu_reference_spatial_pending");
    }

    let preserve_extended = graph.pipeline_version >= 2;
    let source = base_image.to_rgba32f();
    let (width, height) = source.dimensions();
    if mask_bitmaps
        .iter()
        .any(|mask| mask.dimensions() != (width, height))
    {
        return Err("edit_graph.cpu_reference_mask_dimensions");
    }
    let input = source
        .pixels()
        .map(|pixel| {
            Vec3::new(
                round_f16(pixel[0]),
                round_f16(pixel[1]),
                round_f16(pixel[2]),
            )
        })
        .collect::<Vec<_>>();
    let scale = width.min(height) as f32 / 1080.0;
    let tonal_active = global.contrast != 0.0
        || global.highlights != 0.0
        || global.shadows != 0.0
        || global.whites != 0.0
        || global.blacks != 0.0
        || adjustments.mask_adjustments
            [..(adjustments.mask_count as usize).min(adjustments.mask_adjustments.len())]
            .iter()
            .any(|mask| {
                mask.contrast != 0.0
                    || mask.highlights != 0.0
                    || mask.shadows != 0.0
                    || mask.whites != 0.0
                    || mask.blacks != 0.0
            });
    let tonal_blur = tonal_active
        .then(|| gaussian_blur(&input, width, height, (3.5 * scale).ceil().max(1.0) as u32));
    let mut output = ImageBuffer::<Rgba<f32>, Vec<f32>>::new(width, height);
    for (x, y, target) in output.enumerate_pixels_mut() {
        let source_pixel = source.get_pixel(x, y).0;
        let index = (y * width + x) as usize;
        let effective = effective_adjustments(adjustments, mask_bitmaps, x, y);
        let mut color = input[index];
        if adjustments.global.is_raw_image == 0 {
            color = srgb_to_linear(color);
        }
        color *= 2.0_f32.powf(effective.exposure);
        color = apply_white_balance(color, effective.temperature, effective.tint);
        color = apply_filmic_exposure(color, effective.brightness);
        let tonal = tonal_blur.as_ref().map_or(input[index], |blur| blur[index]);
        let tonal_linear = if adjustments.global.is_raw_image == 1 {
            tonal
        } else {
            srgb_to_linear(tonal)
        };
        color = apply_tonal_adjustments(
            color,
            tonal_linear,
            effective.contrast,
            effective.shadows,
            effective.whites,
            effective.blacks,
        );
        color = apply_highlights_adjustment(color, effective.highlights);
        color = apply_color_calibration(color, adjustments.global.color_calibration);
        color = apply_hsl_panel(color, effective.hsl);
        color = apply_hue_shift(color, effective.hue);
        color = apply_creative_color(color, effective.saturation, effective.vibrance);
        color = Vec3::from_array(apply_color_balance_rgb(
            color.to_array(),
            adjustments.global.color_balance_rgb,
            preserve_extended,
        ));
        color = Vec3::from_array(apply_channel_mixer(
            color.to_array(),
            adjustments.global.channel_mixer,
            preserve_extended,
        ));
        color = apply_luma_levels(color, adjustments.global.levels, preserve_extended);
        color = apply_color_grading(
            color,
            adjustments.global.color_grading_shadows,
            adjustments.global.color_grading_midtones,
            adjustments.global.color_grading_highlights,
            adjustments.global.color_grading_global,
            adjustments.global.color_grading_blending,
            adjustments.global.color_grading_balance,
        );
        color = apply_local_color_grading(color, adjustments, mask_bitmaps, x, y);
        color = Vec3::from_array(apply_black_white_mixer(
            color.to_array(),
            adjustments.global.black_white_mixer,
            preserve_extended,
        ));
        color = apply_vignette(color, x, y, width, height, adjustments);
        color = if adjustments.global.tonemapper_mode == 1 {
            agx_full_transform(color, adjustments)
        } else if adjustments.global.is_raw_image == 1 {
            let encoded = if preserve_extended {
                linear_to_srgb_extended(color)
            } else {
                linear_to_srgb(color)
            };
            let gamma = encoded.map(|channel| channel.max(0.0).powf(1.0 / 1.1));
            let contrast = gamma * gamma * (Vec3::splat(3.0) - gamma * 2.0);
            gamma.lerp(contrast, 0.75)
        } else if preserve_extended {
            linear_to_srgb_extended(color)
        } else {
            linear_to_srgb(color)
        };
        color = apply_all_curves(color, adjustments, preserve_extended);
        color = apply_local_curves(color, adjustments, mask_bitmaps, x, y, preserve_extended);
        if let Some(lut) = lut {
            color = color.lerp(
                sample_lut_tetrahedral(color, lut),
                adjustments.global.lut_intensity,
            );
        }
        color = apply_grain(color, x, y, width, height, adjustments);

        if adjustments.global.show_clipping == 1 {
            if color.cmpgt(Vec3::splat(0.998)).any() {
                color = Vec3::X;
            } else if color.cmplt(Vec3::splat(0.002)).any() {
                color = Vec3::Z;
            }
        }
        *target = Rgba([color.x, color.y, color.z, round_f16(source_pixel[3])]);
    }
    Ok(DynamicImage::ImageRgba32F(output))
}

fn effective_adjustments(
    adjustments: &AllAdjustments,
    masks: &[ImageBuffer<Luma<u8>, Vec<u8>>],
    x: u32,
    y: u32,
) -> EffectiveAdjustments {
    let global = &adjustments.global;
    let mut effective = EffectiveAdjustments {
        exposure: global.exposure,
        brightness: global.brightness,
        contrast: global.contrast,
        highlights: global.highlights,
        shadows: global.shadows,
        whites: global.whites,
        blacks: global.blacks,
        saturation: global.saturation,
        temperature: global.temperature,
        tint: global.tint,
        vibrance: global.vibrance,
        hue: global.hue,
        luma_noise_reduction: global.luma_noise_reduction,
        color_noise_reduction: global.color_noise_reduction,
        clarity: global.clarity,
        dehaze: global.dehaze,
        structure: global.structure,
        glow: global.glow_amount,
        halation: global.halation_amount,
        flare: global.flare_amount,
        hsl: global.hsl,
    };
    let count = (adjustments.mask_count as usize)
        .min(masks.len())
        .min(adjustments.mask_adjustments.len());
    for (index, mask) in masks.iter().take(count).enumerate() {
        let influence = f32::from(mask.get_pixel(x, y).0[0]) / 255.0;
        if influence <= 0.001 {
            continue;
        }
        let local = adjustments.mask_adjustments[index];
        effective.exposure += local.exposure * influence;
        effective.brightness += local.brightness * influence;
        effective.contrast += local.contrast * influence;
        effective.highlights += local.highlights * influence;
        effective.shadows += local.shadows * influence;
        effective.whites += local.whites * influence;
        effective.blacks += local.blacks * influence;
        effective.saturation += local.saturation * influence;
        effective.temperature += local.temperature * influence;
        effective.tint += local.tint * influence;
        effective.vibrance += local.vibrance * influence;
        effective.hue += local.hue * influence;
        effective.luma_noise_reduction += local.luma_noise_reduction * influence;
        effective.color_noise_reduction += local.color_noise_reduction * influence;
        effective.clarity += local.clarity * influence;
        effective.dehaze += local.dehaze * influence;
        effective.structure += local.structure * influence;
        effective.glow += local.glow_amount * influence;
        effective.halation += local.halation_amount * influence;
        effective.flare += local.flare_amount * influence;
        for hsl_index in 0..8 {
            effective.hsl[hsl_index].hue += local.hsl[hsl_index].hue * influence;
            effective.hsl[hsl_index].saturation += local.hsl[hsl_index].saturation * influence;
            effective.hsl[hsl_index].luminance += local.hsl[hsl_index].luminance * influence;
        }
    }
    effective
}

fn round_f16(value: f32) -> f32 {
    half::f16::from_f32(value).to_f32()
}

fn gaussian_blur(source: &[Vec3], width: u32, height: u32, radius: u32) -> Vec<Vec3> {
    let sigma = radius as f32 / 2.0;
    let weights = (-(radius as i32)..=radius as i32)
        .map(|offset| (-(offset as f32).powi(2) / (2.0 * sigma * sigma)).exp())
        .collect::<Vec<_>>();
    let total_weight: f32 = weights.iter().sum();
    let mut horizontal = vec![Vec3::ZERO; source.len()];
    for y in 0..height {
        for x in 0..width {
            let mut color = Vec3::ZERO;
            for (weight_index, offset) in (-(radius as i32)..=radius as i32).enumerate() {
                let sample_x = (x as i32 + offset).clamp(0, width as i32 - 1) as u32;
                color += source[(y * width + sample_x) as usize]
                    .clamp(Vec3::ZERO, Vec3::splat(65_504.0))
                    * weights[weight_index];
            }
            horizontal[(y * width + x) as usize] = (color / total_weight).map(round_f16);
        }
    }
    let mut vertical = vec![Vec3::ZERO; source.len()];
    for y in 0..height {
        for x in 0..width {
            let mut color = Vec3::ZERO;
            for (weight_index, offset) in (-(radius as i32)..=radius as i32).enumerate() {
                let sample_y = (y as i32 + offset).clamp(0, height as i32 - 1) as u32;
                color += horizontal[(sample_y * width + x) as usize] * weights[weight_index];
            }
            vertical[(y * width + x) as usize] = (color / total_weight).map(round_f16);
        }
    }
    vertical
}

fn mask_influence(mask: &ImageBuffer<Luma<u8>, Vec<u8>>, x: u32, y: u32) -> f32 {
    f32::from(mask.get_pixel(x, y).0[0]) / 255.0
}

fn blend_mask_layer(base: Vec3, layer: Vec3, influence: f32, blend_mode: f32) -> Vec3 {
    let blended = if blend_mode > 0.5 && blend_mode < 1.5 {
        base * layer
    } else if blend_mode > 1.5 && blend_mode < 2.5 {
        Vec3::ONE - (Vec3::ONE - base) * (Vec3::ONE - layer)
    } else {
        layer
    };
    base.lerp(blended, influence)
}

fn apply_local_color_grading(
    mut color: Vec3,
    adjustments: &AllAdjustments,
    masks: &[ImageBuffer<Luma<u8>, Vec<u8>>],
    x: u32,
    y: u32,
) -> Vec3 {
    let count = (adjustments.mask_count as usize)
        .min(masks.len())
        .min(adjustments.mask_adjustments.len());
    for (index, mask) in masks.iter().take(count).enumerate() {
        let influence = mask_influence(mask, x, y);
        if influence <= 0.001 {
            continue;
        }
        let local = adjustments.mask_adjustments[index];
        let graded = apply_color_grading(
            color,
            local.color_grading_shadows,
            local.color_grading_midtones,
            local.color_grading_highlights,
            local.color_grading_global,
            local.color_grading_blending,
            local.color_grading_balance,
        );
        color = blend_mask_layer(color, graded, influence, local.blend_mode);
    }
    color
}

fn apply_local_curves(
    mut color: Vec3,
    adjustments: &AllAdjustments,
    masks: &[ImageBuffer<Luma<u8>, Vec<u8>>],
    x: u32,
    y: u32,
    preserve_extended: bool,
) -> Vec3 {
    let count = (adjustments.mask_count as usize)
        .min(masks.len())
        .min(adjustments.mask_adjustments.len());
    for (index, mask) in masks.iter().take(count).enumerate() {
        let influence = mask_influence(mask, x, y);
        if influence <= 0.001 {
            continue;
        }
        let local = adjustments.mask_adjustments[index];
        let curved = apply_curve_set(
            color,
            &local.luma_curve,
            local.luma_curve_count,
            &local.red_curve,
            local.red_curve_count,
            &local.green_curve,
            local.green_curve_count,
            &local.blue_curve,
            local.blue_curve_count,
            preserve_extended,
        );
        color = blend_mask_layer(color, curved, influence, local.blend_mode);
    }
    color
}

fn get_luma(color: Vec3) -> f32 {
    color.dot(Vec3::new(0.2126, 0.7152, 0.0722))
}

fn srgb_to_linear(color: Vec3) -> Vec3 {
    color.map(|channel| {
        if channel <= 0.04045 {
            channel / 12.92
        } else {
            ((channel + 0.055) / 1.055).powf(2.4)
        }
    })
}

fn linear_to_srgb(color: Vec3) -> Vec3 {
    color
        .clamp(Vec3::ZERO, Vec3::ONE)
        .map(srgb_encode_magnitude)
}

fn linear_to_srgb_extended(color: Vec3) -> Vec3 {
    color.map(|channel| channel.signum() * srgb_encode_magnitude(channel.abs()))
}

fn srgb_encode_magnitude(channel: f32) -> f32 {
    if channel <= 0.003_130_8 {
        channel * 12.92
    } else {
        1.055 * channel.powf(1.0 / 2.4) - 0.055
    }
}

fn apply_white_balance(color: Vec3, temperature: f32, tint: f32) -> Vec3 {
    color
        * Vec3::new(
            1.0 + temperature * 0.2,
            1.0 + temperature * 0.05,
            1.0 - temperature * 0.2,
        )
        * Vec3::new(1.0 + tint * 0.25, 1.0 - tint * 0.25, 1.0 + tint * 0.25)
}

fn apply_filmic_exposure(color: Vec3, brightness: f32) -> Vec3 {
    if brightness == 0.0 {
        return color;
    }
    let original_luma = get_luma(color);
    if original_luma.abs() < 0.000_01 {
        return color;
    }
    let direct_adjustment = brightness * 0.05;
    let rational_adjustment = brightness * 0.95;
    let scale = 2.0_f32.powf(direct_adjustment);
    let k = 2.0_f32.powf(-rational_adjustment * 1.2);
    let luma_abs = original_luma.abs();
    let luma_floor = (luma_abs / 1.06).floor() * 1.06;
    let normalized = (luma_abs - luma_floor) / 1.06;
    let shaped = normalized / (normalized + (1.0 - normalized) * k);
    let new_luma = original_luma.signum() * (luma_floor + shaped * 1.06) * scale;
    let chroma = color - Vec3::splat(original_luma);
    let total_luma_scale = new_luma / original_luma;
    let luma_weight = new_luma.clamp(0.0, 2.0) * 0.5;
    let dynamic_exponent = 0.95 + (0.65 - 0.95) * luma_weight;
    let base_chroma_scale = total_luma_scale.powf(dynamic_exponent);
    let highlight_rolloff = 1.0 / (1.0 + (new_luma - 0.9).max(0.0) * 2.0);
    Vec3::splat(new_luma) + chroma * base_chroma_scale * highlight_rolloff
}

fn apply_creative_color(color: Vec3, saturation: f32, vibrance: f32) -> Vec3 {
    let luma = get_luma(color);
    let mut processed = Vec3::splat(luma).lerp(color, 1.0 + saturation);
    let c_max = processed.max_element();
    let c_min = processed.min_element();
    let delta = c_max - c_min;
    if delta < 0.02 {
        return processed;
    }
    let current_sat = delta / c_max.max(0.001);
    if vibrance > 0.0 {
        let sat_mask = 1.0 - smoothstep(0.4, 0.9, current_sat);
        let hue = rgb_to_hsv(processed).x;
        let hue_distance = (hue - 25.0).abs().min(360.0 - (hue - 25.0).abs());
        let skin_dampener = 1.0 + (0.6 - 1.0) * smoothstep(35.0, 10.0, hue_distance);
        processed =
            Vec3::splat(luma).lerp(processed, 1.0 + vibrance * sat_mask * skin_dampener * 3.0);
    } else {
        let desat_mask = 1.0 - smoothstep(0.2, 0.8, current_sat);
        processed = Vec3::splat(luma).lerp(processed, 1.0 + vibrance * desat_mask);
    }
    processed
}

fn apply_tonal_adjustments(
    mut color: Vec3,
    mut blurred: Vec3,
    contrast: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
) -> Vec3 {
    if whites != 0.0 {
        let multiplier = 1.0 / (1.0 - whites * 0.25).max(0.01);
        color *= multiplier;
        blurred *= multiplier;
    }
    let pixel_luma = get_luma(color.max(Vec3::ZERO)).max(0.0001);
    let blurred_luma = get_luma(blurred.max(Vec3::ZERO)).max(0.0001);
    if shadows != 0.0 || blacks != 0.0 {
        let edge_difference = (pixel_luma.sqrt() - blurred_luma.sqrt()).abs();
        let halo = smoothstep(0.05, 0.25, edge_difference);
        let spatial = shadow_multiplier(blurred_luma, shadows, blacks);
        let pixel = shadow_multiplier(pixel_luma, shadows, blacks);
        color *= spatial + (pixel - spatial) * halo;
    }
    if contrast != 0.0 {
        let safe = color.max(Vec3::ZERO);
        let perceptual = safe.powf(1.0 / 2.2).clamp(Vec3::ZERO, Vec3::ONE);
        let strength = 2.0_f32.powf(contrast * 1.25);
        let curved = perceptual.map(|channel| {
            if channel < 0.5 {
                0.5 * (2.0 * channel).powf(strength)
            } else {
                1.0 - 0.5 * (2.0 * (1.0 - channel)).powf(strength)
            }
        });
        let adjusted = curved.powf(2.2);
        color = Vec3::new(
            adjusted.x + (color.x - adjusted.x) * smoothstep(1.0, 1.01, safe.x),
            adjusted.y + (color.y - adjusted.y) * smoothstep(1.0, 1.01, safe.y),
            adjusted.z + (color.z - adjusted.z) * smoothstep(1.0, 1.01, safe.z),
        );
    }
    color
}

fn shadow_multiplier(luma: f32, shadows: f32, blacks: f32) -> f32 {
    let mut multiplier = 1.0;
    if blacks != 0.0 && luma < 0.05 {
        let mask = (1.0 - luma / 0.05).powi(2);
        multiplier *= 1.0 + (2.0_f32.powf(blacks * 0.75).min(3.9) - 1.0) * mask;
    }
    if shadows != 0.0 && luma < 0.1 {
        let mask = (1.0 - luma / 0.1).powi(2);
        multiplier *= 1.0 + (2.0_f32.powf(shadows * 1.5).min(3.9) - 1.0) * mask;
    }
    multiplier
}

fn apply_highlights_adjustment(color: Vec3, highlights: f32) -> Vec3 {
    if highlights == 0.0 {
        return color;
    }
    let luma = get_luma(color.max(Vec3::ZERO));
    let mask = smoothstep(0.3, 0.95, (luma.max(0.0001) * 1.5).tanh());
    if mask < 0.001 {
        return color;
    }
    let adjusted = if highlights < 0.0 {
        let new_luma = if luma <= 1.0 {
            luma.powf(1.0 - highlights * 1.75)
        } else {
            let excess = luma - 1.0;
            1.0 + excess / (1.0 + excess * -highlights * 6.0)
        };
        let tonal = color * (new_luma / luma.max(0.0001));
        tonal.lerp(Vec3::splat(new_luma), smoothstep(1.0, 10.0, luma))
    } else {
        color * 2.0_f32.powf(highlights * 1.75)
    };
    color.lerp(adjusted, mask)
}

fn apply_color_calibration(color: Vec3, settings: ColorCalibrationSettings) -> Vec3 {
    let red = Vec3::new(
        1.0 - settings.red_hue.abs(),
        settings.red_hue.max(0.0),
        (-settings.red_hue).max(0.0),
    );
    let green = Vec3::new(
        (-settings.green_hue).max(0.0),
        1.0 - settings.green_hue.abs(),
        settings.green_hue.max(0.0),
    );
    let blue = Vec3::new(
        settings.blue_hue.max(0.0),
        (-settings.blue_hue).max(0.0),
        1.0 - settings.blue_hue.abs(),
    );
    let mut calibrated = glam::Mat3::from_cols(red, green, blue) * color;
    let luma = get_luma(calibrated.max(Vec3::ZERO));
    let saturation_vector = calibrated - Vec3::splat(luma);
    let sum = calibrated.element_sum();
    let masks = if sum > 0.001 {
        calibrated / sum
    } else {
        Vec3::ZERO
    };
    calibrated += saturation_vector
        * masks.dot(Vec3::new(
            settings.red_saturation,
            settings.green_saturation,
            settings.blue_saturation,
        ));
    if settings.shadows_tint.abs() > 0.001 {
        let mask = 1.0 - smoothstep(0.0, 0.3, get_luma(calibrated.max(Vec3::ZERO)));
        let tint = Vec3::new(
            1.0 + settings.shadows_tint * 0.25,
            1.0 - settings.shadows_tint * 0.25,
            1.0 + settings.shadows_tint * 0.25,
        );
        calibrated = calibrated.lerp(calibrated * tint, mask);
    }
    calibrated
}

fn apply_hue_shift(color: Vec3, shift: f32) -> Vec3 {
    if shift.abs() < 0.01 {
        return color;
    }
    let mut hsv = rgb_to_hsv(linear_to_srgb_extended(color));
    hsv.x = (hsv.x + shift + 360.0) % 360.0;
    srgb_to_linear(hsv_to_rgb(hsv))
}

fn apply_hsl_panel(color: Vec3, settings: [HslColor; 8]) -> Vec3 {
    const RANGES: [(f32, f32); 8] = [
        (358.0, 35.0),
        (25.0, 45.0),
        (60.0, 40.0),
        (115.0, 90.0),
        (180.0, 60.0),
        (225.0, 60.0),
        (280.0, 55.0),
        (330.0, 50.0),
    ];
    let safe = color.max(Vec3::ZERO);
    if (safe.x - safe.y).abs() < 0.001 && (safe.y - safe.z).abs() < 0.001 {
        return safe;
    }
    let original_hsv = rgb_to_hsv(safe);
    let original_luma = get_luma(safe);
    let saturation_mask = smoothstep(0.05, 0.2, original_hsv.y);
    let luminance_weight = smoothstep(0.0, 1.0, original_hsv.y);
    if saturation_mask < 0.001 && luminance_weight < 0.001 {
        return safe;
    }
    let influences = RANGES.map(|(center, width)| {
        let distance = (original_hsv.x - center)
            .abs()
            .min(360.0 - (original_hsv.x - center).abs());
        (-1.5 * (distance / (width * 0.5)).powi(2)).exp()
    });
    let total: f32 = influences.iter().sum();
    let mut hue_shift = 0.0;
    let mut saturation = 0.0;
    let mut luminance = 0.0;
    for index in 0..8 {
        let influence = influences[index] / total;
        hue_shift += settings[index].hue * 2.0 * influence * saturation_mask;
        saturation += settings[index].saturation * influence * saturation_mask;
        luminance += settings[index].luminance * influence * luminance_weight;
    }
    if original_hsv.y * (1.0 + saturation) < 0.0001 {
        return Vec3::splat(original_luma * (1.0 + luminance));
    }
    let shifted = hsv_to_rgb(Vec3::new(
        (original_hsv.x + hue_shift + 360.0) % 360.0,
        (original_hsv.y * (1.0 + saturation)).clamp(0.0, 1.0),
        original_hsv.z,
    ));
    let new_luma = get_luma(shifted);
    let target = original_luma * (1.0 + luminance);
    if new_luma < 0.0001 {
        Vec3::splat(target.max(0.0))
    } else {
        shifted * (target / new_luma)
    }
}

fn apply_luma_levels(color: Vec3, settings: LevelsSettings, preserve_extended: bool) -> Vec3 {
    if settings.enabled == 0 {
        return color;
    }
    let source_luma = get_luma(color).max(0.0);
    let input_range = (settings.input_white - settings.input_black).max(0.0001);
    let normalized = ((source_luma - settings.input_black) / input_range).clamp(0.0, 1.0);
    let gamma = normalized.powf(1.0 / settings.gamma.max(0.0001));
    let output_luma =
        settings.output_black + (settings.output_white - settings.output_black) * gamma;
    if source_luma <= 0.0001 {
        return Vec3::splat(output_luma);
    }
    let adjusted = color * (output_luma / source_luma);
    if preserve_extended {
        adjusted
    } else {
        adjusted.clamp(Vec3::ZERO, Vec3::ONE)
    }
}

fn apply_color_grading(
    color: Vec3,
    shadows: ColorGradeSettings,
    midtones: ColorGradeSettings,
    highlights: ColorGradeSettings,
    global: ColorGradeSettings,
    blending: f32,
    balance: f32,
) -> Vec3 {
    let luma = get_luma(color.max(Vec3::ZERO));
    let shadow_crossover = 0.1 + (-balance).max(0.0) * 0.5;
    let highlight_crossover = 0.5 - balance.max(0.0) * 0.5;
    let feather = 0.2 * blending;
    let final_shadow = shadow_crossover.min(highlight_crossover - 0.01);
    let shadow_mask = 1.0 - smoothstep(final_shadow - feather, final_shadow + feather, luma);
    let highlight_mask = smoothstep(
        highlight_crossover - feather,
        highlight_crossover + feather,
        luma,
    );
    let midtone_mask = (1.0 - shadow_mask - highlight_mask).max(0.0);
    let mut graded = color;
    graded = apply_grade_wheel(graded, shadows, shadow_mask, 0.3, 0.5);
    graded = apply_grade_wheel(graded, midtones, midtone_mask, 0.6, 0.8);
    graded = apply_grade_wheel(graded, highlights, highlight_mask, 0.8, 1.0);
    apply_grade_wheel(graded, global, 1.0, 1.0, 1.0)
}

fn apply_grade_wheel(
    mut color: Vec3,
    settings: ColorGradeSettings,
    mask: f32,
    saturation_strength: f32,
    luminance_strength: f32,
) -> Vec3 {
    if settings.saturation > 0.001 {
        let tint = hsv_to_rgb(Vec3::new(settings.hue, 1.0, 1.0));
        color += (tint - Vec3::splat(0.5)) * settings.saturation * mask * saturation_strength;
    }
    color + Vec3::splat(settings.luminance * mask * luminance_strength)
}

fn apply_vignette(
    color: Vec3,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    adjustments: &AllAdjustments,
) -> Vec3 {
    let amount = adjustments.global.vignette_amount;
    if amount == 0.0 {
        return color;
    }
    let centered_x = (x as f32 / width as f32 - 0.5) * 2.0;
    let centered_y = (y as f32 / height as f32 - 0.5) * 2.0;
    let power = 1.0 - adjustments.global.vignette_roundness;
    let rounded_x = centered_x.signum() * centered_x.abs().powf(power);
    let rounded_y = centered_y.signum() * centered_y.abs().powf(power);
    let distance =
        (rounded_x.powi(2) + (rounded_y * height as f32 / width as f32).powi(2)).sqrt() * 0.5;
    let feather = adjustments.global.vignette_feather * 0.5;
    let mask = smoothstep(
        adjustments.global.vignette_midpoint - feather,
        adjustments.global.vignette_midpoint + feather,
        distance,
    );
    if amount < 0.0 {
        color * (1.0 + amount * mask)
    } else {
        color.lerp(Vec3::ONE, amount * mask)
    }
}

fn apply_all_curves(color: Vec3, adjustments: &AllAdjustments, preserve_extended: bool) -> Vec3 {
    let global = &adjustments.global;
    apply_curve_set(
        color,
        &global.luma_curve,
        global.luma_curve_count,
        &global.red_curve,
        global.red_curve_count,
        &global.green_curve,
        global.green_curve_count,
        &global.blue_curve,
        global.blue_curve_count,
        preserve_extended,
    )
}

#[allow(clippy::too_many_arguments)]
fn apply_curve_set(
    color: Vec3,
    luma_curve: &[Point; 16],
    luma_count: u32,
    red_curve: &[Point; 16],
    red_count: u32,
    green_curve: &[Point; 16],
    green_count: u32,
    blue_curve: &[Point; 16],
    blue_count: u32,
    preserve_extended: bool,
) -> Vec3 {
    let luma_default = is_default_curve(luma_curve, luma_count);
    let red_default = is_default_curve(red_curve, red_count);
    let green_default = is_default_curve(green_curve, green_count);
    let blue_default = is_default_curve(blue_curve, blue_count);
    let rgb_active = !red_default || !green_default || !blue_default;
    if preserve_extended && luma_default && !rgb_active {
        return color;
    }
    if !rgb_active {
        return Vec3::new(
            apply_curve(color.x, luma_curve, luma_count),
            apply_curve(color.y, luma_curve, luma_count),
            apply_curve(color.z, luma_curve, luma_count),
        );
    }
    let graded = Vec3::new(
        apply_curve(color.x, red_curve, red_count),
        apply_curve(color.y, green_curve, green_count),
        apply_curve(color.z, blue_curve, blue_count),
    );
    let target_luma = apply_curve(get_luma(color), luma_curve, luma_count);
    let graded_luma = get_luma(graded);
    let mut result = if graded_luma > 0.001 {
        graded * (target_luma / graded_luma)
    } else {
        Vec3::splat(target_luma)
    };
    let maximum = result.max_element();
    if maximum > 1.0 {
        result /= maximum;
    }
    result
}

fn is_default_curve(points: &[Point; 16], count: u32) -> bool {
    if count < 2 {
        return false;
    }
    let active = &points[..count as usize];
    active.iter().all(|point| (point.x - point.y).abs() <= 0.5)
        && active
            .first()
            .is_some_and(|point| point.x.abs() < 0.1 && point.y.abs() < 0.1)
        && active
            .last()
            .is_some_and(|point| (point.x - 255.0).abs() < 0.1 && (point.y - 255.0).abs() < 0.1)
}

fn apply_curve(value: f32, points: &[Point; 16], count: u32) -> f32 {
    if count < 2 {
        return value;
    }
    let count = count as usize;
    let x = value * 255.0;
    if x <= points[0].x {
        return points[0].y / 255.0;
    }
    if x >= points[count - 1].x {
        return points[count - 1].y / 255.0;
    }
    for index in 0..count - 1 {
        let first = points[index];
        let second = points[index + 1];
        if x > second.x {
            continue;
        }
        let previous = points[index.saturating_sub(1)];
        let next = points[(index + 2).min(count - 1)];
        let before = (first.y - previous.y) / (first.x - previous.x).max(0.001);
        let current = (second.y - first.y) / (second.x - first.x).max(0.001);
        let after = (next.y - second.y) / (next.x - second.x).max(0.001);
        let mut tangent_first = if index == 0 || before * current <= 0.0 {
            if index == 0 { current } else { 0.0 }
        } else {
            (before + current) * 0.5
        };
        let mut tangent_second = if index + 1 == count - 1 || current * after <= 0.0 {
            if index + 1 == count - 1 { current } else { 0.0 }
        } else {
            (current + after) * 0.5
        };
        if current != 0.0 {
            let alpha = tangent_first / current;
            let beta = tangent_second / current;
            if alpha * alpha + beta * beta > 9.0 {
                let tau = 3.0 / (alpha * alpha + beta * beta).sqrt();
                tangent_first *= tau;
                tangent_second *= tau;
            }
        }
        let delta = second.x - first.x;
        let t = (x - first.x) / delta;
        let t2 = t * t;
        let t3 = t2 * t;
        let result = (2.0 * t3 - 3.0 * t2 + 1.0) * first.y
            + (t3 - 2.0 * t2 + t) * tangent_first * delta
            + (-2.0 * t3 + 3.0 * t2) * second.y
            + (t3 - t2) * tangent_second * delta;
        return (result / 255.0).clamp(0.0, 1.0);
    }
    points[count - 1].y / 255.0
}

fn apply_grain(
    color: Vec3,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    adjustments: &AllAdjustments,
) -> Vec3 {
    let amount = adjustments.global.grain_amount;
    if amount <= 0.0 {
        return color;
    }
    let scale = (width.min(height) as f32 / 1080.0).max(0.1);
    let frequency = (1.0 / adjustments.global.grain_size.max(0.1)) / scale;
    let luma = get_luma(color).max(0.0);
    let luma_mask = smoothstep(0.0, 0.15, luma) * (1.0 - smoothstep(0.6, 1.0, luma));
    let base = gradient_noise(x as f32 * frequency, y as f32 * frequency);
    let rough = gradient_noise(
        x as f32 * frequency * 0.6 + 5.2,
        y as f32 * frequency * 0.6 + 1.3,
    );
    color
        + Vec3::splat(
            (base + (rough - base) * adjustments.global.grain_roughness) * amount * 0.5 * luma_mask,
        )
}

fn sample_lut_tetrahedral(color: Vec3, lut: &Lut) -> Vec3 {
    let scale = (lut.size - 1) as f32;
    let scaled = color.clamp(Vec3::ZERO, Vec3::ONE) * scale;
    let base = scaled.floor().as_uvec3();
    let fraction = scaled - base.as_vec3();
    let upper = (base + glam::UVec3::ONE).min(glam::UVec3::splat(lut.size - 1));
    let c000 = lut_fetch(lut, base.x, base.y, base.z);
    let c111 = lut_fetch(lut, upper.x, upper.y, upper.z);
    if fraction.x > fraction.y {
        if fraction.y > fraction.z {
            let c100 = lut_fetch(lut, upper.x, base.y, base.z);
            let c110 = lut_fetch(lut, upper.x, upper.y, base.z);
            c000 * (1.0 - fraction.x)
                + c100 * (fraction.x - fraction.y)
                + c110 * (fraction.y - fraction.z)
                + c111 * fraction.z
        } else if fraction.x > fraction.z {
            let c100 = lut_fetch(lut, upper.x, base.y, base.z);
            let c101 = lut_fetch(lut, upper.x, base.y, upper.z);
            c000 * (1.0 - fraction.x)
                + c100 * (fraction.x - fraction.z)
                + c101 * (fraction.z - fraction.y)
                + c111 * fraction.y
        } else {
            let c001 = lut_fetch(lut, base.x, base.y, upper.z);
            let c101 = lut_fetch(lut, upper.x, base.y, upper.z);
            c000 * (1.0 - fraction.z)
                + c001 * (fraction.z - fraction.x)
                + c101 * (fraction.x - fraction.y)
                + c111 * fraction.y
        }
    } else if fraction.z > fraction.y {
        let c001 = lut_fetch(lut, base.x, base.y, upper.z);
        let c011 = lut_fetch(lut, base.x, upper.y, upper.z);
        c000 * (1.0 - fraction.z)
            + c001 * (fraction.z - fraction.y)
            + c011 * (fraction.y - fraction.x)
            + c111 * fraction.x
    } else if fraction.z > fraction.x {
        let c010 = lut_fetch(lut, base.x, upper.y, base.z);
        let c011 = lut_fetch(lut, base.x, upper.y, upper.z);
        c000 * (1.0 - fraction.y)
            + c010 * (fraction.y - fraction.z)
            + c011 * (fraction.z - fraction.x)
            + c111 * fraction.x
    } else {
        let c010 = lut_fetch(lut, base.x, upper.y, base.z);
        let c110 = lut_fetch(lut, upper.x, upper.y, base.z);
        c000 * (1.0 - fraction.y)
            + c010 * (fraction.y - fraction.x)
            + c110 * (fraction.x - fraction.z)
            + c111 * fraction.z
    }
}

fn lut_fetch(lut: &Lut, x: u32, y: u32, z: u32) -> Vec3 {
    let index = ((z * lut.size * lut.size + y * lut.size + x) * 4) as usize;
    Vec3::new(
        half::f16::from_bits(lut.rgba16f[index]).to_f32(),
        half::f16::from_bits(lut.rgba16f[index + 1]).to_f32(),
        half::f16::from_bits(lut.rgba16f[index + 2]).to_f32(),
    )
}

fn agx_full_transform(color: Vec3, adjustments: &AllAdjustments) -> Vec3 {
    let pipe_to_rendering = mat3(adjustments.global.agx_pipe_to_rendering_matrix);
    let rendering_to_pipe = mat3(adjustments.global.agx_rendering_to_pipe_matrix);
    let minimum = color.min_element();
    let compressed = if minimum < 0.0 {
        color - Vec3::splat(minimum)
    } else {
        color
    };
    let rendering = pipe_to_rendering * compressed;
    rendering_to_pipe * agx_tonemap(rendering)
}

fn mat3(matrix: crate::adjustments::abi::GpuMat3) -> glam::Mat3 {
    glam::Mat3::from_cols(
        Vec3::from_slice(&matrix.col0[..3]),
        Vec3::from_slice(&matrix.col1[..3]),
        Vec3::from_slice(&matrix.col2[..3]),
    )
}

fn agx_tonemap(color: Vec3) -> Vec3 {
    let encoded = (color / 0.18)
        .max(Vec3::splat(1.0e-6))
        .log2()
        .map(|channel| ((channel + 15.2) / 20.2).clamp(0.0, 1.0));
    encoded.map(agx_curve).max(Vec3::ZERO).powf(2.4)
}

fn agx_curve(value: f32) -> f32 {
    let result = if value < 0.606_060_6 {
        agx_scaled_sigmoid(value, -1.0359, 1.5)
    } else if value <= 0.606_060_6 {
        2.3843 * value - 1.0112
    } else {
        agx_scaled_sigmoid(value, 1.3475, 1.5)
    };
    result.clamp(0.0, 1.0)
}

fn agx_scaled_sigmoid(value: f32, scale: f32, power: f32) -> f32 {
    let x = 2.3843 * (value - 0.606_060_6) / scale;
    scale * (x / (1.0 + x.powf(power)).powf(1.0 / power)) + 0.43446
}

fn rgb_to_hsv(color: Vec3) -> Vec3 {
    let maximum = color.max_element();
    let minimum = color.min_element();
    let delta = maximum - minimum;
    let mut hue = if delta <= 0.0 {
        0.0
    } else if maximum == color.x {
        60.0 * (((color.y - color.z) / delta) % 6.0)
    } else if maximum == color.y {
        60.0 * (((color.z - color.x) / delta) + 2.0)
    } else {
        60.0 * (((color.x - color.y) / delta) + 4.0)
    };
    if hue < 0.0 {
        hue += 360.0;
    }
    Vec3::new(hue, delta / maximum.max(0.000_01), maximum)
}

fn hsv_to_rgb(hsv: Vec3) -> Vec3 {
    let chroma = hsv.z * hsv.y;
    let hue = ((hsv.x % 360.0) + 360.0) % 360.0;
    let x = chroma * (1.0 - ((hue / 60.0) % 2.0 - 1.0).abs());
    let prime = if hue < 60.0 {
        Vec3::new(chroma, x, 0.0)
    } else if hue < 120.0 {
        Vec3::new(x, chroma, 0.0)
    } else if hue < 180.0 {
        Vec3::new(0.0, chroma, x)
    } else if hue < 240.0 {
        Vec3::new(0.0, x, chroma)
    } else if hue < 300.0 {
        Vec3::new(x, 0.0, chroma)
    } else {
        Vec3::new(chroma, 0.0, x)
    };
    prime + Vec3::splat(hsv.z - chroma)
}

fn gradient_noise(x: f32, y: f32) -> f32 {
    let ix = x.floor();
    let iy = y.floor();
    let fx = x.fract();
    let fy = y.fract();
    let ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    let uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
    let gradient = |gx: f32, gy: f32| {
        Vec3::new(hash2(gx, gy), hash2(gx + 11.0, gy + 37.0), 0.0).truncate() * 2.0
            - glam::Vec2::ONE
    };
    let a = gradient(ix, iy).dot(glam::Vec2::new(fx, fy));
    let b = gradient(ix + 1.0, iy).dot(glam::Vec2::new(fx - 1.0, fy));
    let c = gradient(ix, iy + 1.0).dot(glam::Vec2::new(fx, fy - 1.0));
    let d = gradient(ix + 1.0, iy + 1.0).dot(glam::Vec2::new(fx - 1.0, fy - 1.0));
    let bottom = a + (b - a) * ux;
    let top = c + (d - c) * ux;
    bottom + (top - bottom) * uy
}

fn hash2(x: f32, y: f32) -> f32 {
    let mut p = Vec3::new(x, y, x) * 0.1031;
    p = p.fract();
    p += Vec3::splat(p.dot(Vec3::new(p.y, p.z, p.x) + Vec3::splat(33.33)));
    ((p.x + p.y) * p.z).fract()
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
