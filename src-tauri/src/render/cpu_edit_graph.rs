//! Deterministic CPU reference executor for the compiled color graph.
//!
//! This intentionally mirrors the WGSL equations. It is both the oversized-frame
//! fallback and the stage-level oracle used by GPU parity tests.

use glam::Vec3;
use image::{DynamicImage, ImageBuffer, Luma, Rgba};

use crate::adjustments::abi::{
    AllAdjustments, ColorCalibrationSettings, ColorGradeSettings, HslColor, LevelsSettings, Point,
    PointColorGpuSettings, ToneEqualizerGpuSettings,
};
use crate::color::dehaze::{DEHAZE_GUIDANCE_RADIUS, prepare_cpu_dehaze};
use crate::color::perceptual_grading::apply_gpu_settings as apply_perceptual_grading;
use crate::color::point_color::apply_gpu_plan_ap1;
use crate::color::view_transform::{
    RAPID_VIEW_IMPLEMENTATION_VERSION, ViewColorStrategy, ViewTransformPlanV1, ViewTransformProcess,
};
use crate::edit_graph::CompiledEditGraph;
use crate::lut_processing::Lut;
use crate::mixer_render::{apply_black_white_mixer, apply_channel_mixer, apply_color_balance_rgb};
use crate::tone::tone_equalizer::{
    BasicToneMacros, ToneEqualizerPickerSampleV1, ToneEqualizerPlanV1, ToneEqualizerSettingsV1,
    band_weights, edge_aware_exposure_ev, scene_luminance as tone_scene_luminance,
};

thread_local! {
    static SCENE_REFERRED_V2_LUMA: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

struct SceneLumaGuard(bool);

impl Drop for SceneLumaGuard {
    fn drop(&mut self) {
        SCENE_REFERRED_V2_LUMA.set(self.0);
    }
}

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
    tone_equalizer: ToneEqualizerGpuSettings,
    point_color: PointColorGpuSettings,
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
    graph.validate_gpu_execution(adjustments, lut.is_some(), mask_bitmaps.len())?;
    let mut authoritative_adjustments = graph.shader_abi();
    prepare_cpu_dehaze(base_image, &mut authoritative_adjustments);
    let adjustments = &authoritative_adjustments;
    let previous_luma_model = SCENE_REFERRED_V2_LUMA.replace(graph.pipeline_version >= 2);
    let _luma_guard = SceneLumaGuard(previous_luma_model);
    let global = &adjustments.global;

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
    let active_masks = &adjustments.mask_adjustments
        [..(adjustments.mask_count as usize).min(adjustments.mask_adjustments.len())];
    let tonal_radius = tonal_blur_base_radius(adjustments);
    let tonal_blur = tonal_radius.map(|radius| {
        gaussian_blur(
            &input,
            width,
            height,
            (radius * scale).ceil().max(1.0) as u32,
        )
    });
    let blur = |active: bool, radius: f32| {
        active.then(|| {
            gaussian_blur(
                &input,
                width,
                height,
                (radius * scale).ceil().max(1.0) as u32,
            )
        })
    };
    let sharpness_blur = blur(
        global.sharpness != 0.0 || active_masks.iter().any(|mask| mask.sharpness.abs() > 0.001),
        1.0,
    );
    let clarity_blur = blur(
        global.clarity != 0.0
            || global.centré != 0.0
            || global.halation_amount > 0.0
            || active_masks
                .iter()
                .any(|mask| mask.clarity != 0.0 || mask.halation_amount > 0.0),
        8.0,
    );
    let structure_blur = blur(
        global.structure != 0.0
            || global.glow_amount > 0.0
            || active_masks
                .iter()
                .any(|mask| mask.structure != 0.0 || mask.glow_amount > 0.0),
        40.0,
    );
    let dehaze_blur = blur(
        global.dehaze != 0.0 || active_masks.iter().any(|mask| mask.dehaze != 0.0),
        DEHAZE_GUIDANCE_RADIUS,
    );
    let flare_map =
        (global.flare_amount > 0.0).then(|| build_flare_map(&input, width, height, adjustments));
    let global_tone_plan = tone_equalizer_plan(effective_adjustments(adjustments, &[], 0, 0));
    let local_tone_adjustments = adjustments
        .mask_adjustments
        .iter()
        .take((adjustments.mask_count as usize).min(mask_bitmaps.len()))
        .any(|local| {
            local.brightness != 0.0
                || local.contrast != 0.0
                || local.highlights != 0.0
                || local.shadows != 0.0
                || local.whites != 0.0
                || local.blacks != 0.0
                || local.tone_equalizer.params0[0] > 0.5
        });
    let mut output = ImageBuffer::<Rgba<f32>, Vec<f32>>::new(width, height);
    for (x, y, target) in output.enumerate_pixels_mut() {
        let source_pixel = source.get_pixel(x, y).0;
        let index = (y * width + x) as usize;
        let effective = effective_adjustments(adjustments, mask_bitmaps, x, y);
        let color_from_texture = apply_ca_correction(
            &input,
            x,
            y,
            width,
            height,
            global.chromatic_aberration_red_cyan,
            global.chromatic_aberration_blue_yellow,
        );
        let mut color = color_from_texture;
        if adjustments.global.is_raw_image == 0 {
            color = srgb_to_linear(color);
        }
        color = apply_noise_reduction(
            color,
            &input,
            x,
            y,
            width,
            height,
            effective.luma_noise_reduction,
            effective.color_noise_reduction,
            scale.max(0.1),
            adjustments.global.is_raw_image == 1,
        );
        let initial_linear = color;
        let sharpness_surface = sharpness_blur
            .as_ref()
            .map_or(input[index], |blur| blur[index]);
        color = apply_local_contrast(
            color,
            sharpness_surface,
            global.sharpness,
            adjustments.global.is_raw_image == 1,
            0,
            global.sharpness_threshold,
        );
        color += local_sharpness_delta(
            initial_linear,
            sharpness_surface,
            adjustments,
            mask_bitmaps,
            x,
            y,
        );
        let clarity_surface = clarity_blur
            .as_ref()
            .map_or(input[index], |blur| blur[index]);
        let structure_surface = structure_blur
            .as_ref()
            .map_or(input[index], |blur| blur[index]);
        let dehaze_guidance = dehaze_blur
            .as_ref()
            .map_or(input[index], |blur| blur[index]);
        color = apply_local_contrast(
            color,
            clarity_surface,
            effective.clarity,
            adjustments.global.is_raw_image == 1,
            1,
            0.0,
        );
        color = apply_local_contrast(
            color,
            structure_surface,
            effective.structure,
            adjustments.global.is_raw_image == 1,
            1,
            0.0,
        );
        color = apply_centre_local_contrast(
            color,
            global.centré,
            x,
            y,
            width,
            height,
            clarity_surface,
            adjustments.global.is_raw_image == 1,
        );
        color *= 2.0_f32.powf(effective.exposure);
        color = apply_glow_bloom(
            color,
            structure_surface,
            effective.glow,
            adjustments.global.is_raw_image == 1,
            effective.exposure,
            effective.brightness,
            effective.whites,
        );
        color = apply_halation(
            color,
            clarity_surface,
            effective.halation,
            adjustments.global.is_raw_image == 1,
            effective.exposure,
            effective.brightness,
            effective.whites,
        );
        color = apply_flare(
            color,
            flare_map.as_deref(),
            x,
            y,
            width,
            height,
            effective.flare,
        );
        color = if graph.pipeline_version >= 2 {
            apply_scene_dehaze_v1(
                color,
                dehaze_guidance,
                adjustments.global.is_raw_image == 1,
                effective.dehaze,
                Vec3::new(
                    global.dehaze_atmosphere_r,
                    global.dehaze_atmosphere_g,
                    global.dehaze_atmosphere_b,
                ),
                global.dehaze_atmosphere_confidence,
            )
        } else {
            legacy_fixed_atmosphere_dehaze_v1(
                color,
                dehaze_guidance,
                adjustments.global.is_raw_image == 1,
                effective.dehaze,
            )
        };
        color = apply_centre_tonal_and_color(color, global.centré, x, y, width, height);
        color = apply_white_balance(color, effective.temperature, effective.tint);
        let tonal = tonal_blur.as_ref().map_or(input[index], |blur| blur[index]);
        let tonal_linear = if adjustments.global.is_raw_image == 1 {
            tonal
        } else {
            srgb_to_linear(tonal)
        };
        if preserve_extended {
            let local_tone_plan = local_tone_adjustments.then(|| tone_equalizer_plan(effective));
            let tone_plan = local_tone_plan.as_ref().unwrap_or(&global_tone_plan);
            let tone_source = if adjustments.global.is_raw_image == 1 {
                input[index]
            } else {
                srgb_to_linear(input[index])
            } * 2.0_f32.powf(global.exposure);
            let guidance = tonal_linear * 2.0_f32.powf(global.exposure);
            color = Vec3::from_array(tone_plan.apply_rgb(
                color.to_array(),
                tone_source.to_array(),
                guidance.to_array(),
                adjustments.global.rapid_view_parameters0[0],
            ));
        } else {
            color = apply_filmic_exposure(color, effective.brightness);
            color = apply_tonal_adjustments(
                color,
                tonal_linear,
                effective.contrast,
                effective.shadows,
                effective.whites,
                effective.blacks,
            );
            color = apply_highlights_adjustment(color, effective.highlights);
        }
        color = apply_color_calibration(color, adjustments.global.color_calibration);
        color = apply_hsl_panel(color, effective.hsl);
        color = Vec3::from_array(apply_gpu_plan_ap1(color.to_array(), &effective.point_color));
        for (mask_index, mask) in mask_bitmaps.iter().take(active_masks.len()).enumerate() {
            let influence = f32::from(mask.get_pixel(x, y).0[0]) / 255.0;
            if influence <= 0.001 {
                continue;
            }
            let local = apply_gpu_plan_ap1(color.to_array(), &active_masks[mask_index].point_color);
            color = color.lerp(Vec3::from_array(local), influence);
        }
        color = Vec3::from_array(apply_perceptual_grading(
            color.to_array(),
            &adjustments.global.perceptual_grading,
        ));
        for (mask_index, mask) in mask_bitmaps.iter().take(active_masks.len()).enumerate() {
            let influence = f32::from(mask.get_pixel(x, y).0[0]) / 255.0;
            if influence <= 0.001 {
                continue;
            }
            let local = Vec3::from_array(apply_perceptual_grading(
                color.to_array(),
                &active_masks[mask_index].perceptual_grading,
            ));
            color = blend_mask_layer(color, local, influence, active_masks[mask_index].blend_mode);
        }
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
        let scene_monochrome_toning = adjustments.global.black_white_mixer.enabled != 0
            && adjustments.global.black_white_mixer.process
                != crate::monochrome::LEGACY_FIXED_BAND_V1
            && adjustments.global.black_white_mixer.implementation_version
                == crate::monochrome::MONOCHROME_IMPLEMENTATION_VERSION;
        let apply_grading = |input| {
            let graded = apply_color_grading(
                input,
                adjustments.global.color_grading_shadows,
                adjustments.global.color_grading_midtones,
                adjustments.global.color_grading_highlights,
                adjustments.global.color_grading_global,
                adjustments.global.color_grading_blending,
                adjustments.global.color_grading_balance,
            );
            apply_local_color_grading(graded, adjustments, mask_bitmaps, x, y)
        };
        if !scene_monochrome_toning {
            color = apply_grading(color);
        }
        color = Vec3::from_array(apply_black_white_mixer(
            color.to_array(),
            adjustments.global.black_white_mixer,
            preserve_extended,
        ));
        if scene_monochrome_toning {
            color = apply_grading(color);
        }
        color = apply_vignette(color, x, y, width, height, adjustments);
        if let Some(curve) = graph.scene_curve() {
            color = Vec3::from_array(curve.evaluate_rgb(color.to_array()));
        }
        if preserve_extended {
            // V2 crosses a real RGBA16F scene intermediate before the view
            // dispatch. Mirror its finite storage range in the CPU reference.
            color = color.map(round_rgba16f_storage);
        }
        color = if adjustments.global.tonemapper_mode == 2 {
            let mapped = rapid_view_plan(adjustments).apply_rgb(color.to_array());
            linear_to_srgb_extended(Vec3::from_array(mapped))
        } else if adjustments.global.tonemapper_mode == 1 {
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
        if preserve_extended {
            // The view dispatch writes another RGBA16F intermediate consumed
            // by display curves, LUTs, and grain.
            color = color.map(round_rgba16f_storage);
        }
        color = apply_all_curves(color, adjustments, preserve_extended);
        color = apply_local_curves(color, adjustments, mask_bitmaps, x, y, preserve_extended);
        if let Some(lut) = lut {
            color = color.lerp(
                sample_lut_tetrahedral(color, lut),
                adjustments.global.lut_intensity,
            );
        }
        color = apply_grain(color, x, y, width, height, adjustments);
        if let Some(curve) = graph.output_curve() {
            color = Vec3::from_array(curve.evaluate_rgb(color.to_array()));
        }

        if adjustments.global.show_clipping == 1 {
            if color.cmpgt(Vec3::splat(0.998)).any() {
                color = Vec3::X;
            } else if color.cmplt(Vec3::splat(0.002)).any() {
                color = Vec3::Z;
            }
        }
        *target = Rgba([
            round_f16(color.x),
            round_f16(color.y),
            round_f16(color.z),
            round_f16(source_pixel[3]),
        ]);
    }
    Ok(DynamicImage::ImageRgba32F(output))
}

pub(crate) fn sample_tone_equalizer_coordinate(
    base_image: &DynamicImage,
    graph: &CompiledEditGraph,
    normalized_x: f64,
    normalized_y: f64,
) -> Result<ToneEqualizerPickerSampleV1, &'static str> {
    graph.validate_contract()?;
    if !normalized_x.is_finite()
        || !normalized_y.is_finite()
        || !(0.0..=1.0).contains(&normalized_x)
        || !(0.0..=1.0).contains(&normalized_y)
    {
        return Err("tone_equalizer.picker_invalid_point");
    }
    let adjustments = graph.shader_abi();
    let global = &adjustments.global;
    let source = base_image.to_rgba32f();
    let (width, height) = source.dimensions();
    if width == 0 || height == 0 {
        return Err("tone_equalizer.picker_empty_source");
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
    let radius = (global.tone_equalizer.params1[1].clamp(4.0, 64.0)
        * (width.min(height) as f32 / 1080.0))
        .ceil()
        .max(1.0) as u32;
    let x = (normalized_x * f64::from(width - 1)).round() as u32;
    let y = (normalized_y * f64::from(height - 1)).round() as u32;
    let index = (y * width + x) as usize;
    let smoothed = gaussian_blur_at(&input, width, height, x, y, radius);
    let to_linear = |rgb: Vec3| {
        if global.is_raw_image == 1 {
            rgb
        } else {
            srgb_to_linear(rgb)
        }
    };
    let exposure_scale = 2.0_f32.powf(global.exposure);
    let coordinate = to_linear(input[index]) * exposure_scale;
    let guidance = to_linear(smoothed) * exposure_scale;
    let middle_grey = global.rapid_view_parameters0[0].max(1.0e-8);
    let exposure_ev = edge_aware_exposure_ev(
        tone_scene_luminance(coordinate.to_array()),
        tone_scene_luminance(guidance.to_array()),
        middle_grey,
        global.tone_equalizer.params0[3],
        global.tone_equalizer.params1[0],
    );
    let contributing_weights = band_weights(
        exposure_ev,
        global.tone_equalizer.params0[1],
        global.tone_equalizer.params0[2],
    );
    let primary_band = contributing_weights
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
        .map_or(4, |(index, _)| index as u32);
    Ok(ToneEqualizerPickerSampleV1 {
        exposure_ev,
        contributing_weights,
        primary_band,
    })
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
        tone_equalizer: global.tone_equalizer,
        point_color: global.point_color,
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
        if local.tone_equalizer.params0[0] > 0.5 {
            effective.tone_equalizer.params0[0] = 1.0;
            for channel in 0..4 {
                effective.tone_equalizer.bands0[channel] +=
                    local.tone_equalizer.bands0[channel] * influence;
                effective.tone_equalizer.bands1[channel] +=
                    local.tone_equalizer.bands1[channel] * influence;
            }
            effective.tone_equalizer.bands2[0] += local.tone_equalizer.bands2[0] * influence;
            for parameter in 1..4 {
                let current = effective.tone_equalizer.params0[parameter];
                effective.tone_equalizer.params0[parameter] =
                    current + (local.tone_equalizer.params0[parameter] - current) * influence;
            }
            let current_edge = effective.tone_equalizer.params1[0];
            effective.tone_equalizer.params1[0] =
                current_edge + (local.tone_equalizer.params1[0] - current_edge) * influence;
            effective.tone_equalizer.params1[2] += local.tone_equalizer.params1[2] * influence;
        }
        for hsl_index in 0..8 {
            effective.hsl[hsl_index].hue += local.hsl[hsl_index].hue * influence;
            effective.hsl[hsl_index].saturation += local.hsl[hsl_index].saturation * influence;
            effective.hsl[hsl_index].luminance += local.hsl[hsl_index].luminance * influence;
        }
    }
    effective
}

fn tone_equalizer_plan(effective: EffectiveAdjustments) -> ToneEqualizerPlanV1 {
    let gpu = effective.tone_equalizer;
    ToneEqualizerPlanV1::compile(
        ToneEqualizerSettingsV1 {
            enabled: gpu.params0[0] > 0.5,
            band_ev: [
                gpu.bands0[0],
                gpu.bands0[1],
                gpu.bands0[2],
                gpu.bands0[3],
                gpu.bands1[0],
                gpu.bands1[1],
                gpu.bands1[2],
                gpu.bands1[3],
                gpu.bands2[0],
            ],
            pivot_ev: gpu.params0[1],
            range_ev: gpu.params0[2],
            detail_preservation: gpu.params0[3],
            edge_refinement: gpu.params1[0],
            smoothing_radius: gpu.params1[1],
            mask_exposure_compensation: gpu.params1[2],
            auto_placement: false,
            selected_band: gpu.bands2[1].clamp(0.0, 8.0) as u32,
            preview_mode: gpu.params1[3].max(0.0) as u32,
        },
        BasicToneMacros {
            brightness: effective.brightness,
            contrast: effective.contrast,
            highlights: effective.highlights,
            shadows: effective.shadows,
            whites: effective.whites,
            blacks: effective.blacks,
        },
    )
}

fn round_f16(value: f32) -> f32 {
    half::f16::from_f32(value).to_f32()
}

fn round_rgba16f_storage(value: f32) -> f32 {
    round_f16(value.clamp(-65_504.0, 65_504.0))
}

fn tonal_blur_base_radius(adjustments: &AllAdjustments) -> Option<f32> {
    let global = &adjustments.global;
    let graph_v2 = global.edit_graph_version >= 2.0;
    let global_guided_active = global.contrast != 0.0
        || global.highlights != 0.0
        || global.shadows != 0.0
        || global.whites != 0.0
        || global.blacks != 0.0;
    let global_v2_only_active =
        graph_v2 && (global.brightness != 0.0 || global.tone_equalizer.params0[0] > 0.5);
    let mut radius = (global_guided_active || global_v2_only_active).then_some(if graph_v2 {
        global.tone_equalizer.params1[1].clamp(4.0, 64.0)
    } else {
        3.5
    });

    let mask_count = (adjustments.mask_count as usize).min(adjustments.mask_adjustments.len());
    for mask in &adjustments.mask_adjustments[..mask_count] {
        let local_guided_active = mask.contrast != 0.0
            || mask.highlights != 0.0
            || mask.shadows != 0.0
            || mask.whites != 0.0
            || mask.blacks != 0.0;
        let local_v2_only_active =
            graph_v2 && (mask.brightness != 0.0 || mask.tone_equalizer.params0[0] > 0.5);
        if local_guided_active || local_v2_only_active {
            let local_radius = if graph_v2 {
                mask.tone_equalizer.params1[1].clamp(4.0, 64.0)
            } else {
                3.5
            };
            radius = Some(radius.map_or(local_radius, |current| current.max(local_radius)));
        }
    }
    radius
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

fn gaussian_blur_at(source: &[Vec3], width: u32, height: u32, x: u32, y: u32, radius: u32) -> Vec3 {
    let sigma = radius as f32 / 2.0;
    let weights = (-(radius as i32)..=radius as i32)
        .map(|offset| (-(offset as f32).powi(2) / (2.0 * sigma * sigma)).exp())
        .collect::<Vec<_>>();
    let total_weight: f32 = weights.iter().sum();
    let mut color = Vec3::ZERO;
    for (vertical_index, vertical_offset) in (-(radius as i32)..=radius as i32).enumerate() {
        let sample_y = (y as i32 + vertical_offset).clamp(0, height as i32 - 1) as u32;
        let mut horizontal = Vec3::ZERO;
        for (horizontal_index, horizontal_offset) in (-(radius as i32)..=radius as i32).enumerate()
        {
            let sample_x = (x as i32 + horizontal_offset).clamp(0, width as i32 - 1) as u32;
            horizontal += source[(sample_y * width + sample_x) as usize]
                .clamp(Vec3::ZERO, Vec3::splat(65_504.0))
                * weights[horizontal_index];
        }
        color += (horizontal / total_weight).map(round_f16) * weights[vertical_index];
    }
    (color / total_weight).map(round_f16)
}

fn apply_ca_correction(
    input: &[Vec3],
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    red_cyan: f32,
    blue_yellow: f32,
) -> Vec3 {
    if red_cyan.abs() <= 0.000_001 && blue_yellow.abs() <= 0.000_001 {
        return input[(y * width + x) as usize];
    }
    let center = glam::Vec2::new(width as f32, height as f32) * 0.5;
    let position = glam::Vec2::new(x as f32, y as f32);
    let radial = position - center;
    let distance = radial.length();
    if distance == 0.0 {
        return input[(y * width + x) as usize];
    }
    let direction = radial / distance;
    let sample = |shift: f32| {
        let coordinate = position - direction * distance * shift;
        (
            coordinate.x.round().clamp(0.0, width as f32 - 1.0) as u32,
            coordinate.y.round().clamp(0.0, height as f32 - 1.0) as u32,
        )
    };
    let red = sample(red_cyan);
    let blue = sample(blue_yellow);
    Vec3::new(
        input[(red.1 * width + red.0) as usize].x,
        input[(y * width + x) as usize].y,
        input[(blue.1 * width + blue.0) as usize].z,
    )
}

fn apply_local_contrast(
    color: Vec3,
    blurred_input: Vec3,
    amount: f32,
    is_raw: bool,
    mode: u32,
    threshold: f32,
) -> Vec3 {
    if amount == 0.0 {
        return color;
    }
    let blurred = if is_raw {
        blurred_input
    } else {
        srgb_to_linear(blurred_input)
    };
    if amount < 0.0 {
        return color.lerp(blurred, -amount * if mode == 0 { 0.5 } else { 1.0 });
    }
    let center_luma = scene_luminance(color);
    let midtone_mask = smoothstep(0.0, if is_raw { 0.1 } else { 0.03 }, center_luma)
        * (1.0 - smoothstep(0.9, 1.0, center_luma));
    if midtone_mask < 0.001 {
        return color;
    }
    let log_ratio = (center_luma.max(0.0001) / scene_luminance(blurred).max(0.0001)).log2();
    let effective = if mode == 0 {
        let edge = log_ratio.abs();
        let edge_mask = if threshold <= 0.0 {
            1.0
        } else {
            smoothstep(threshold * 0.5, threshold * 1.5, edge)
        };
        amount * (1.0 - (edge / 3.0).clamp(0.0, 1.0).sqrt()) * edge_mask * 0.8
    } else {
        amount
    };
    color.lerp(color * 2.0_f32.powf(log_ratio * effective), midtone_mask)
}

fn local_sharpness_delta(
    initial: Vec3,
    blurred: Vec3,
    adjustments: &AllAdjustments,
    masks: &[ImageBuffer<Luma<u8>, Vec<u8>>],
    x: u32,
    y: u32,
) -> Vec3 {
    let mut delta = Vec3::ZERO;
    let count = (adjustments.mask_count as usize)
        .min(masks.len())
        .min(adjustments.mask_adjustments.len());
    for (index, mask) in masks.iter().take(count).enumerate() {
        let local = adjustments.mask_adjustments[index];
        if local.sharpness.abs() <= 0.001 {
            continue;
        }
        let result = apply_local_contrast(
            initial,
            blurred,
            local.sharpness,
            adjustments.global.is_raw_image == 1,
            0,
            local.sharpness_threshold,
        );
        delta += (result - initial) * mask_influence(mask, x, y);
    }
    delta
}

fn radial_centre_mask(x: u32, y: u32, width: u32, height: u32) -> f32 {
    let centered =
        glam::Vec2::new(x as f32 / width as f32, y as f32 / height as f32) * 2.0 - glam::Vec2::ONE;
    let distance = (centered * glam::Vec2::new(1.0, height as f32 / width as f32)).length() * 0.5;
    1.0 - smoothstep(0.025, 0.775, distance)
}

#[allow(clippy::too_many_arguments)]
fn apply_centre_local_contrast(
    color: Vec3,
    amount: f32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    blurred: Vec3,
    is_raw: bool,
) -> Vec3 {
    if amount == 0.0 {
        return color;
    }
    let strength = amount * (2.0 * radial_centre_mask(x, y, width, height) - 1.0) * 0.9;
    if strength.abs() > 0.001 {
        apply_local_contrast(color, blurred, strength, is_raw, 1, 0.0)
    } else {
        color
    }
}

fn apply_centre_tonal_and_color(
    color: Vec3,
    amount: f32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Vec3 {
    if amount == 0.0 {
        return color;
    }
    let center = radial_centre_mask(x, y, width, height);
    let exposed = apply_filmic_exposure(color, center * amount * 0.5);
    apply_creative_color(
        exposed,
        center * amount * 0.3 - (1.0 - center) * amount * 0.8,
        center * amount * 0.4,
    )
}

fn blur_to_linear(color: Vec3, is_raw: bool) -> Vec3 {
    if is_raw { color } else { srgb_to_linear(color) }
}

fn legacy_fixed_atmosphere_dehaze_v1(
    color: Vec3,
    blurred: Vec3,
    is_raw: bool,
    amount: f32,
) -> Vec3 {
    if amount == 0.0 {
        return color;
    }
    let blurred = blur_to_linear(blurred, is_raw);
    let atmosphere = Vec3::new(0.95, 0.97, 1.0);
    if amount < 0.0 {
        let dark = (blurred.min_element() - 0.02).max(0.0);
        let depth = dark / (dark + 0.2);
        return color.lerp(atmosphere, amount.abs() * 0.7 * (0.4 + 0.6 * depth));
    }
    let pixel_dark = color.min_element();
    let regional_dark = blurred.min_element();
    let edge = (scene_luminance(color.max(Vec3::ZERO)).sqrt()
        - scene_luminance(blurred.max(Vec3::ZERO)).sqrt())
    .abs();
    let spatial_dark = regional_dark + (pixel_dark - regional_dark) * smoothstep(0.02, 0.15, edge);
    let safe_dark = (spatial_dark - 0.02).max(0.0);
    let transmission = (1.0 - amount * (safe_dark / (safe_dark + 0.2)) * 0.85).max(0.15);
    let mut recovered = (color - atmosphere) / transmission + atmosphere;
    let recovered_luma = scene_luminance(recovered.max(Vec3::ZERO));
    recovered += Vec3::splat(smoothstep(0.1, 0.0, recovered_luma) * (1.0 - transmission) * 0.15);
    let final_luma = scene_luminance(recovered.max(Vec3::ZERO));
    Vec3::splat(final_luma)
        .lerp(recovered, 1.0 + (1.0 - transmission) * 0.5)
        .max(Vec3::ZERO)
}

fn apply_scene_dehaze_v1(
    color: Vec3,
    blurred: Vec3,
    is_raw: bool,
    amount: f32,
    atmospheric_light: Vec3,
    atmosphere_confidence: f32,
) -> Vec3 {
    if amount == 0.0 {
        return color;
    }
    let blurred = blur_to_linear(blurred, is_raw);
    let atmosphere = atmospheric_light.max(Vec3::splat(0.01));
    let transmission = edge_refined_image_transmission_v1(color, blurred, atmosphere);
    let confidence_weight = atmosphere_confidence.clamp(0.0, 1.0);
    let strength = (amount.abs() * 7.5).clamp(0.0, 1.0) * confidence_weight;
    let effective_transmission = 1.0 + (transmission - 1.0) * strength;
    if amount < 0.0 {
        return color * effective_transmission + atmosphere * (1.0 - effective_transmission);
    }
    let recovered = (color - atmosphere) / effective_transmission + atmosphere;
    let pixel_luma = scene_luminance(color.max(Vec3::ZERO));
    let atmosphere_luma = scene_luminance(atmosphere);
    let highlight_protection =
        smoothstep(atmosphere_luma * 0.75, atmosphere_luma * 1.25, pixel_luma);
    recovered.lerp(color, highlight_protection * 0.65)
}

fn edge_refined_image_transmission_v1(
    color: Vec3,
    regional_guidance: Vec3,
    atmosphere: Vec3,
) -> f32 {
    let pixel_dark = (color / atmosphere).min_element();
    let regional_dark = (regional_guidance / atmosphere).min_element();
    let pixel_transmission = (1.0 - 0.95 * pixel_dark).clamp(0.08, 1.0);
    let regional_transmission = (1.0 - 0.95 * regional_dark).clamp(0.08, 1.0);
    let pixel_luma = scene_luminance(color.max(Vec3::ZERO));
    let regional_luma = scene_luminance(regional_guidance.max(Vec3::ZERO));
    let luma_edge = (pixel_luma.sqrt() - regional_luma.sqrt()).abs();
    let pixel_chroma = color - Vec3::splat(pixel_luma);
    let regional_chroma = regional_guidance - Vec3::splat(regional_luma);
    let chroma_edge = (pixel_chroma - regional_chroma).length()
        / (pixel_luma.sqrt() + regional_luma.sqrt() + 0.05);
    let discontinuity = luma_edge.max(chroma_edge * 0.3);
    regional_transmission
        + (pixel_transmission - regional_transmission) * smoothstep(0.015, 0.12, discontinuity)
}

fn prepared_effect_blur(
    blurred: Vec3,
    is_raw: bool,
    exposure: f32,
    brightness: f32,
    whites: f32,
) -> Vec3 {
    let input_space = blurred;
    let mut linear = blur_to_linear(blurred, is_raw) * 2.0_f32.powf(exposure);
    linear = apply_filmic_exposure(linear, brightness);
    apply_tonal_adjustments(linear, input_space, 0.0, 0.0, whites, 0.0)
}

#[allow(clippy::too_many_arguments)]
fn apply_glow_bloom(
    color: Vec3,
    blurred: Vec3,
    amount: f32,
    is_raw: bool,
    exposure: f32,
    brightness: f32,
    whites: f32,
) -> Vec3 {
    if amount <= 0.0 {
        return color;
    }
    let linear = prepared_effect_blur(blurred, is_raw, exposure, brightness, whites);
    let linear_luma = scene_luminance(linear.max(Vec3::ZERO));
    let perceptual = if linear_luma <= 1.0 {
        linear_luma.max(0.0).powf(1.0 / 2.2)
    } else {
        1.0 + (linear_luma - 1.0).powf(1.0 / 2.2)
    };
    let cutoff = 0.75 + (0.08 - 0.75) * amount.clamp(0.0, 1.0);
    let cutoff_fade = smoothstep(cutoff, cutoff + 0.15, perceptual);
    let intensity = smoothstep(0.0, 1.0, (perceptual - cutoff).max(0.0) / 5.5).powf(0.45);
    let mut bloom = if linear_luma > 0.01 {
        linear / linear_luma * Vec3::new(1.03, 1.0, 0.97)
    } else {
        Vec3::new(1.0, 0.99, 0.98)
    };
    bloom *=
        intensity * linear_luma.powf(0.6) * cutoff_fade * smoothstep(0.0, 0.5, linear_luma).sqrt();
    color
        + bloom
            * amount
            * 3.8
            * (1.0 - smoothstep(1.0, 2.2, scene_luminance(color.max(Vec3::ZERO))))
}

#[allow(clippy::too_many_arguments)]
fn apply_halation(
    color: Vec3,
    blurred: Vec3,
    amount: f32,
    is_raw: bool,
    exposure: f32,
    brightness: f32,
    whites: f32,
) -> Vec3 {
    if amount <= 0.0 {
        return color;
    }
    let linear = prepared_effect_blur(blurred, is_raw, exposure, brightness, whites);
    let linear_luma = scene_luminance(linear.max(Vec3::ZERO));
    let perceptual = if linear_luma <= 1.0 {
        linear_luma.max(0.0).powf(1.0 / 2.2)
    } else {
        1.0 + (linear_luma - 1.0).powf(1.0 / 2.2)
    };
    let cutoff = 0.85 + (0.1 - 0.85) * amount.clamp(0.0, 1.0);
    if perceptual <= cutoff {
        return color;
    }
    let mask = smoothstep(0.0, (1.5 - cutoff).max(0.1) * 0.6, perceptual - cutoff);
    let tint =
        Vec3::new(1.0, 0.32, 0.1).lerp(Vec3::new(1.0, 0.15, 0.03), smoothstep(0.0, 0.7, mask));
    let luma = scene_luminance(color.max(Vec3::ZERO));
    let affected = color.lerp(Vec3::splat(luma), mask * 0.12);
    Vec3::splat(0.5).lerp(affected, 1.0 - mask * 0.06) + tint * mask * linear_luma * amount * 2.5
}

const FLARE_MAP_EDGE: u32 = 512;

fn sample_bilinear_grid(source: &[Vec3], width: u32, height: u32, uv: glam::Vec2) -> Vec3 {
    let uv = uv.clamp(glam::Vec2::ZERO, glam::Vec2::ONE);
    let position = uv * glam::Vec2::new(width as f32, height as f32) - glam::Vec2::splat(0.5);
    let base_x = position.x.floor() as i32;
    let base_y = position.y.floor() as i32;
    let fraction = position - position.floor();
    let fetch = |x: i32, y: i32| {
        source[(y.clamp(0, height as i32 - 1) as u32 * width + x.clamp(0, width as i32 - 1) as u32)
            as usize]
    };
    fetch(base_x, base_y)
        .lerp(fetch(base_x + 1, base_y), fraction.x)
        .lerp(
            fetch(base_x, base_y + 1).lerp(fetch(base_x + 1, base_y + 1), fraction.x),
            fraction.y,
        )
}

fn flare_filmic_exposure(color: Vec3, brightness: f32) -> Vec3 {
    if brightness == 0.0 {
        return color;
    }
    let luma = scene_luminance(color);
    if luma.abs() < 0.000_01 {
        return color;
    }
    let scale = 2.0_f32.powf(brightness * 0.05);
    let k = 2.0_f32.powf(-brightness * 0.95 * 1.2);
    let absolute = luma.abs();
    let floor = absolute.floor();
    let fraction = absolute - floor;
    let shaped = fraction / (fraction + (1.0 - fraction) * k);
    let next_luma = luma.signum() * (floor + shaped) * scale;
    Vec3::splat(next_luma) + (color - Vec3::splat(luma)) * (next_luma / luma).powf(0.8)
}

fn build_flare_threshold(
    input: &[Vec3],
    width: u32,
    height: u32,
    adjustments: &AllAdjustments,
) -> Vec<Vec3> {
    let global = &adjustments.global;
    let mut threshold = vec![Vec3::ZERO; (FLARE_MAP_EDGE * FLARE_MAP_EDGE) as usize];
    for y in 0..FLARE_MAP_EDGE {
        for x in 0..FLARE_MAP_EDGE {
            let uv = (glam::Vec2::new(x as f32, y as f32) + glam::Vec2::splat(0.5))
                / FLARE_MAP_EDGE as f32;
            let sampled = sample_bilinear_grid(input, width, height, uv);
            let mut linear = if global.is_raw_image == 1 {
                sampled
            } else {
                srgb_to_linear(sampled)
            };
            linear *= 2.0_f32.powf(global.exposure);
            linear = flare_filmic_exposure(linear, global.brightness);
            if global.whites != 0.0 {
                linear /= (1.0 - global.whites * 0.25).max(0.01);
            }
            let true_luma = scene_luminance(linear);
            let threshold_value = 0.88 + (0.5 - 0.88) * global.flare_amount.clamp(0.0, 1.0);
            let contribution_input = true_luma.min(1.0) - threshold_value + 0.15;
            let contribution = if contribution_input <= 0.0 {
                0.0
            } else if contribution_input < 0.3 {
                contribution_input * contribution_input / 0.6
            } else {
                contribution_input - 0.15
            };
            threshold[(y * FLARE_MAP_EDGE + x) as usize] =
                (linear * (contribution / true_luma.max(0.001))).map(round_f16);
        }
    }
    threshold
}

fn uv_inside(uv: glam::Vec2) -> bool {
    uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0
}

fn flare_direction(spike: u32, aspect: f32) -> glam::Vec2 {
    let angle = spike as f32 * std::f32::consts::PI / 6.0 + std::f32::consts::FRAC_PI_6;
    glam::Vec2::new(angle.cos() / aspect, angle.sin()).normalize()
}

fn starburst_rays(threshold: &[Vec3], uv: glam::Vec2, aspect: f32) -> Vec3 {
    let mut result = Vec3::ZERO;
    for spike in 0..6 {
        let direction = flare_direction(spike, aspect);
        let mut ray = Vec3::ZERO;
        let mut weight_sum = 0.0;
        for index in 1..=24 {
            let t = index as f32 / 24.0;
            let distance = t * t * 0.65;
            let weight = (-distance * 2.5).exp() + 0.4 * (-distance * 0.8).exp();
            for sign in [-1.0_f32, 1.0] {
                let sample_uv = uv + direction * distance * sign;
                if !uv_inside(sample_uv) {
                    continue;
                }
                let red_uv = uv + direction * distance * 1.01 * sign;
                let blue_uv = uv + direction * distance * 0.99 * sign;
                ray.x += sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, red_uv).x
                    * weight;
                ray.y += sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, sample_uv)
                    .y
                    * weight;
                ray.z += sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, blue_uv).z
                    * weight;
                weight_sum += weight;
            }
        }
        if weight_sum > 0.0 {
            result += ray / weight_sum;
        }
    }
    result * 0.5
}

fn starburst_inner(threshold: &[Vec3], uv: glam::Vec2, aspect: f32) -> Vec3 {
    let mut result = Vec3::ZERO;
    for spike in 0..6 {
        let direction = flare_direction(spike, aspect);
        let mut ray = Vec3::ZERO;
        let mut weight_sum = 0.0;
        for index in 1..=16 {
            let distance = index as f32 / 16.0 * 0.2;
            let weight = (-distance * 8.0).exp();
            for sign in [-1.0_f32, 1.0] {
                let sample_uv = uv + direction * distance * sign;
                if uv_inside(sample_uv) {
                    ray +=
                        sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, sample_uv)
                            * weight;
                    weight_sum += weight;
                }
            }
        }
        if weight_sum > 0.0 {
            result += ray / weight_sum;
        }
    }
    result / 3.0
}

fn radial_glow(threshold: &[Vec3], uv: glam::Vec2, aspect: f32) -> Vec3 {
    let mut result = sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, uv) * 2.0;
    let mut weight_sum = 2.0;
    for ring in 1..=3 {
        let radius = ring as f32 / 3.0 * 0.08;
        let weight = (-radius * radius * 200.0).exp();
        for sample in 0..12 {
            let angle = sample as f32 * std::f32::consts::TAU / 12.0 + ring as f32 * 0.5;
            let offset = glam::Vec2::new(angle.cos() * radius / aspect, angle.sin() * radius);
            if uv_inside(uv + offset) {
                result +=
                    sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, uv + offset)
                        * weight;
                weight_sum += weight;
            }
        }
    }
    result / weight_sum
}

fn iris_pattern(threshold: &[Vec3], uv: glam::Vec2, aspect: f32) -> Vec3 {
    let distance = ((uv - glam::Vec2::splat(0.5)) * glam::Vec2::new(aspect, 1.0)).length();
    let angle_vector = (uv - glam::Vec2::splat(0.5)) * glam::Vec2::new(aspect, 1.0);
    let angle = angle_vector.y.atan2(angle_vector.x);
    let modulation = 0.9 + 0.1 * (angle * 3.0).cos().abs().powi(4);
    let source = sample_bilinear_grid(
        threshold,
        FLARE_MAP_EDGE,
        FLARE_MAP_EDGE,
        glam::Vec2::ONE - uv,
    );
    let mut result = Vec3::ZERO;
    for (radius, width, intensity) in [
        (0.15_f32, 0.02_f32, 0.4_f32),
        (0.25, 0.025, 0.3),
        (0.35, 0.03, 0.2),
        (0.48, 0.035, 0.15),
    ] {
        result += source * (-((distance - radius) / width).powi(2)).exp() * intensity * modulation;
    }
    result * Vec3::new(0.7, 0.8, 1.0)
}

#[allow(clippy::too_many_arguments)]
fn add_flare_ghost(
    flare: &mut Vec3,
    threshold: &[Vec3],
    uv: glam::Vec2,
    tint: Vec3,
    intensity: f32,
    aspect: f32,
    vignette_start: f32,
    vignette_end: f32,
) {
    let distance = ((uv - glam::Vec2::splat(0.5)) * glam::Vec2::new(aspect, 1.0)).length();
    *flare += sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, uv)
        * tint
        * intensity
        * (1.0 - smoothstep(vignette_start, vignette_end, distance));
}

fn flare_ghost_pixel(threshold: &[Vec3], uv: glam::Vec2, aspect: f32) -> Vec3 {
    let mut flare = starburst_rays(threshold, uv, aspect) * Vec3::new(1.0, 0.95, 0.85) * 3.5;
    flare += starburst_inner(threshold, uv, aspect) * Vec3::new(1.0, 0.9, 0.8) * 1.5;
    flare += radial_glow(threshold, uv, aspect) * Vec3::new(1.0, 0.95, 0.9) * 0.4;
    flare += iris_pattern(threshold, uv, aspect) * 0.2;
    let flipped = glam::Vec2::ONE - uv;
    for (scale, tint, intensity, start, end) in [
        (0.75, Vec3::new(1.0, 0.92, 0.85), 0.05, 0.15, 0.6),
        (0.4, Vec3::new(0.92, 1.0, 0.95), 0.07, 0.1, 0.45),
        (0.2, Vec3::new(0.95, 0.97, 1.0), 0.08, 0.08, 0.35),
        (0.12, Vec3::new(1.0, 1.0, 0.97), 0.07, 0.05, 0.25),
        (0.55, Vec3::new(0.97, 0.95, 1.0), 0.04, 0.2, 0.5),
    ] {
        let ghost_uv = glam::Vec2::splat(0.5) + (flipped - glam::Vec2::splat(0.5)) * scale;
        add_flare_ghost(
            &mut flare, threshold, ghost_uv, tint, intensity, aspect, start, end,
        );
    }
    let outward = glam::Vec2::splat(0.5) + (uv - glam::Vec2::splat(0.5)) * 1.8;
    if uv_inside(outward) {
        add_flare_ghost(
            &mut flare,
            threshold,
            outward,
            Vec3::new(0.85, 0.9, 1.0),
            0.03,
            aspect,
            0.25,
            0.75,
        );
    }
    let outer_flipped = glam::Vec2::splat(0.5) + (flipped - glam::Vec2::splat(0.5)) * 1.3;
    if uv_inside(outer_flipped) {
        add_flare_ghost(
            &mut flare,
            threshold,
            outer_flipped,
            Vec3::new(1.0, 0.9, 0.95),
            0.03,
            aspect,
            0.2,
            0.55,
        );
    }
    let halo = sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, flipped);
    let center_distance = ((uv - glam::Vec2::splat(0.5)) * glam::Vec2::new(aspect, 1.0)).length();
    for (radius, width, tint, intensity) in [
        (0.4, 0.05, Vec3::new(0.85, 0.92, 1.0), 0.07),
        (0.22, 0.035, Vec3::new(0.92, 0.88, 1.0), 0.05),
        (0.55, 0.06, Vec3::new(0.85, 0.95, 0.97), 0.03),
    ] {
        flare += halo * tint * (-((center_distance - radius) / width).powi(2)).exp() * intensity;
    }
    let streak_length = 0.4 / aspect;
    let mut streak = Vec3::ZERO;
    let mut total_weight = 0.0;
    for index in 0..64 {
        let t = index as f32 / 63.0 * 2.0 - 1.0;
        let offset = t * streak_length;
        let sample_uv = glam::Vec2::new(uv.x + offset, uv.y);
        let weight = (-t * t * 3.5).exp();
        total_weight += weight;
        if sample_uv.x > 0.0 && sample_uv.x < 1.0 {
            streak.x += sample_bilinear_grid(
                threshold,
                FLARE_MAP_EDGE,
                FLARE_MAP_EDGE,
                glam::Vec2::new(uv.x + offset * 1.015, uv.y),
            )
            .x * weight;
            streak.y += sample_bilinear_grid(threshold, FLARE_MAP_EDGE, FLARE_MAP_EDGE, sample_uv)
                .y
                * weight;
            streak.z += sample_bilinear_grid(
                threshold,
                FLARE_MAP_EDGE,
                FLARE_MAP_EDGE,
                glam::Vec2::new(uv.x + offset * 0.985, uv.y),
            )
            .z * weight;
        }
    }
    flare + streak / total_weight * Vec3::new(0.85, 0.92, 1.0)
}

fn build_flare_map(
    input: &[Vec3],
    width: u32,
    height: u32,
    adjustments: &AllAdjustments,
) -> Vec<Vec3> {
    let threshold = build_flare_threshold(input, width, height, adjustments);
    let aspect = width as f32 / height as f32;
    let mut output = vec![Vec3::ZERO; threshold.len()];
    for y in 0..FLARE_MAP_EDGE {
        for x in 0..FLARE_MAP_EDGE {
            let uv = (glam::Vec2::new(x as f32, y as f32) + glam::Vec2::splat(0.5))
                / FLARE_MAP_EDGE as f32;
            output[(y * FLARE_MAP_EDGE + x) as usize] =
                (flare_ghost_pixel(&threshold, uv, aspect) * adjustments.global.flare_amount * 1.5)
                    .map(round_f16);
        }
    }
    output
}

#[allow(clippy::too_many_arguments)]
fn apply_flare(
    color: Vec3,
    flare_map: Option<&[Vec3]>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    amount: f32,
) -> Vec3 {
    if amount <= 0.0 {
        return color;
    }
    let Some(flare_map) = flare_map else {
        return color;
    };
    let mut flare = sample_bilinear_grid(
        flare_map,
        FLARE_MAP_EDGE,
        FLARE_MAP_EDGE,
        glam::Vec2::new(x as f32 / width as f32, y as f32 / height as f32),
    ) * 1.4;
    flare *= flare;
    let luma = scene_luminance(color.max(Vec3::ZERO));
    let perceptual = if luma <= 1.0 {
        luma.max(0.0).powf(1.0 / 2.2)
    } else {
        1.0 + (luma - 1.0).powf(1.0 / 2.2)
    };
    color + flare * amount * (1.0 - smoothstep(0.7, 1.8, perceptual))
}

#[allow(clippy::too_many_arguments)]
fn apply_noise_reduction(
    center: Vec3,
    input: &[Vec3],
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    luma_amount: f32,
    color_amount: f32,
    scale: f32,
    is_raw: bool,
) -> Vec3 {
    let luma_amount = luma_amount.clamp(0.0, 1.0);
    let color_amount = color_amount.clamp(0.0, 1.0);
    if luma_amount < 0.001 && color_amount < 0.001 {
        return center;
    }
    let center_luma = scene_luminance(center.max(Vec3::ZERO));
    let center_chroma = center - Vec3::splat(center_luma);
    let resolution = scale.sqrt().clamp(0.5, 2.0);
    let sample = |sample_x: i32, sample_y: i32| {
        let color = input[(sample_y.clamp(0, height as i32 - 1) as u32 * width
            + sample_x.clamp(0, width as i32 - 1) as u32) as usize];
        if is_raw { color } else { srgb_to_linear(color) }
    };
    let mut new_luma = center_luma;
    if luma_amount > 0.001 {
        let curve = luma_amount.sqrt();
        let stride = (1.0 + smoothstep(0.45, 0.95, luma_amount)) * resolution;
        let extra = (stride - 1.0).clamp(0.0, 1.0);
        let spatial = 1.0 + 0.5 * curve;
        let spatial_normalizer = -1.0 / (2.0 * spatial * spatial).max(1.0e-6);
        let jitter_x = (hash2(x as f32, y as f32) - 0.5) * 2.0 * extra;
        let jitter_y = (hash2(x as f32 + 17.31, y as f32 + 71.13) - 0.5) * 2.0 * extra;
        let mut lumas = [0.0_f32; 25];
        let mut spatial_weights = [0.0_f32; 25];
        lumas[0] = center_luma;
        spatial_weights[0] = 1.0;
        let mut minimum = center_luma;
        let mut maximum = center_luma;
        let mut index = 1;
        for dy in -2_i32..=2 {
            for dx in -2_i32..=2 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let grow = 1.0
                    + extra
                        * if dx.abs().max(dy.abs()) == 2 {
                            1.0
                        } else {
                            0.5
                        };
                let sampled = sample(
                    x as i32 + (dx as f32 * grow + jitter_x).round() as i32,
                    y as i32 + (dy as f32 * grow + jitter_y).round() as i32,
                );
                let luma = scene_luminance(sampled.max(Vec3::ZERO));
                lumas[index] = luma;
                spatial_weights[index] = ((dx * dx + dy * dy) as f32 * spatial_normalizer).exp();
                minimum = minimum.min(luma);
                maximum = maximum.max(luma);
                index += 1;
            }
        }
        let edge_strength = smoothstep(0.04, 0.2, maximum - minimum);
        let midpoint = (minimum + maximum) * 0.5;
        let center_side = center_luma > midpoint;
        let broad_tolerance = 0.025 + (0.075 - 0.025) * curve;
        let edge_tolerance = 0.01 + (0.025 - 0.01) * curve;
        let range_tolerance = broad_tolerance + (edge_tolerance - broad_tolerance) * edge_strength;
        let mut gates = [0.0_f32; 25];
        let mut sum = 0.0;
        let mut weight_sum = 0.0;
        for index in 0..25 {
            let range_gate = 1.0
                - smoothstep(
                    range_tolerance * 0.6,
                    range_tolerance,
                    (lumas[index] - center_luma).abs(),
                );
            let side_gate = if (lumas[index] > midpoint) == center_side {
                1.0
            } else {
                0.0
            };
            let weight =
                spatial_weights[index] * range_gate * (1.0 + (side_gate - 1.0) * edge_strength);
            gates[index] = weight;
            sum += lumas[index] * weight;
            weight_sum += weight;
        }
        let initial_mean = sum / weight_sum.max(1.0e-4);
        let outlier_tolerance = 0.07 + (0.025 - 0.07) * edge_strength;
        let mut robust_sum = 0.0;
        let mut robust_weight = 0.0;
        for index in 0..25 {
            if gates[index] <= 0.0001 {
                continue;
            }
            let ratio = (lumas[index] - initial_mean).abs() / outlier_tolerance;
            let bisquare = (1.0 - ratio * ratio).max(0.0);
            let weight = gates[index] * bisquare * bisquare;
            robust_sum += lumas[index] * weight;
            robust_weight += weight;
        }
        let robust = if robust_weight > 0.01 {
            robust_sum / robust_weight.max(1.0e-6)
        } else {
            initial_mean
        };
        let strength = luma_amount * (1.0 + (0.6 - 1.0) * edge_strength);
        new_luma = center_luma + (robust - center_luma) * strength;
    }

    let mut new_chroma = center_chroma;
    if color_amount > 0.001 {
        let center_red = center.x - center_luma;
        let center_blue = center.z - center_luma;
        let curve = color_amount.sqrt();
        let stride = (2.0 + 1.5 * curve) * resolution;
        let spatial = 2.0 + 1.5 * curve;
        let spatial_normalizer = -1.0 / (2.0 * spatial * spatial).max(1.0e-6);
        let luma_tolerance = 0.12 + (0.04 - 0.12) * curve;
        let luma_normalizer = -1.0 / (2.0 * luma_tolerance * luma_tolerance).max(1.0e-6);
        let chroma_tolerance = 0.2 + (0.08 - 0.2) * curve;
        let chroma_normalizer = -1.0 / (2.0 * chroma_tolerance * chroma_tolerance).max(1.0e-6);
        let jitter_x = (hash2(x as f32 + 43.7, y as f32 + 91.1) - 0.5) * stride * 0.5;
        let jitter_y = (hash2(x as f32 + 73.3, y as f32 + 17.9) - 0.5) * stride * 0.5;
        let mut red_sum = center_red;
        let mut blue_sum = center_blue;
        let mut weight_sum = 1.0;
        for dy in -2_i32..=2 {
            for dx in -2_i32..=2 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let sampled = sample(
                    x as i32 + (dx as f32 * stride + jitter_x).round() as i32,
                    y as i32 + (dy as f32 * stride + jitter_y).round() as i32,
                );
                let sampled_luma = scene_luminance(sampled.max(Vec3::ZERO));
                let red = sampled.x - sampled_luma;
                let blue = sampled.z - sampled_luma;
                let spatial_weight = ((dx * dx + dy * dy) as f32 * spatial_normalizer).exp();
                let luma_weight = ((sampled_luma - center_luma).powi(2) * luma_normalizer).exp();
                let chroma_weight = (((red - center_red).powi(2) + (blue - center_blue).powi(2))
                    * chroma_normalizer)
                    .exp();
                let weight = spatial_weight * luma_weight * chroma_weight;
                red_sum += red * weight;
                blue_sum += blue * weight;
                weight_sum += weight;
            }
        }
        let red = center_red + (red_sum / weight_sum.max(1.0e-6) - center_red) * color_amount;
        let blue = center_blue + (blue_sum / weight_sum.max(1.0e-6) - center_blue) * color_amount;
        let coefficients = scene_luminance_coefficients();
        let green = -(coefficients.x * red + coefficients.z * blue) / coefficients.y;
        new_chroma = Vec3::new(red, green, blue);
    }
    Vec3::splat(new_luma) + new_chroma
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

fn scene_luminance(color: Vec3) -> f32 {
    color.dot(scene_luminance_coefficients())
}

fn scene_luminance_coefficients() -> Vec3 {
    SCENE_REFERRED_V2_LUMA.with(|v2| {
        if v2.get() {
            Vec3::new(0.272_228_72, 0.674_081_74, 0.053_689_52)
        } else {
            Vec3::new(0.2126, 0.7152, 0.0722)
        }
    })
}

fn view_encoded_luma(color: Vec3) -> f32 {
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

fn rapid_view_plan(adjustments: &AllAdjustments) -> ViewTransformPlanV1 {
    let p0 = adjustments.global.rapid_view_parameters0;
    let p1 = adjustments.global.rapid_view_parameters1;
    let p2 = adjustments.global.rapid_view_parameters2;
    ViewTransformPlanV1 {
        process: ViewTransformProcess::RapidViewV1,
        scene_grey: p0[0],
        source_black_ev: p0[1],
        source_white_ev: p0[2],
        target_black_linear: p0[3],
        target_white_linear: p1[0],
        toe_width_ev: p1[1],
        shoulder_width_ev: p1[2],
        exposure_scale: p1[3],
        output_power: p2[0],
        chroma_compression: p2[1],
        color_strategy: ViewColorStrategy::LuminanceRatio,
        fingerprint: u64::from(p2[2].to_bits()) | (u64::from(p2[3].to_bits()) << 32),
        implementation_version: RAPID_VIEW_IMPLEMENTATION_VERSION,
    }
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
    let original_luma = scene_luminance(color);
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
    let luma = scene_luminance(color);
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
    let pixel_luma = scene_luminance(color.max(Vec3::ZERO)).max(0.0001);
    let blurred_luma = scene_luminance(blurred.max(Vec3::ZERO)).max(0.0001);
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
    let luma = scene_luminance(color.max(Vec3::ZERO));
    // Keep the transcendental in its useful domain. Scene-linear values may be far above
    // display white, where tanh is already saturated but backend approximations can diverge.
    let mask_input = (luma.max(0.0001) * 1.5).min(8.0).tanh();
    let mask = smoothstep(0.3, 0.95, mask_input);
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
    let luma = scene_luminance(calibrated.max(Vec3::ZERO));
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
        let mask = 1.0 - smoothstep(0.0, 0.3, scene_luminance(calibrated.max(Vec3::ZERO)));
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
    // Anchor the nonlinear hue operation to the actual rgba16f transport domain.
    let color = Vec3::new(round_f16(color.x), round_f16(color.y), round_f16(color.z));
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
    let negative_residual = SCENE_REFERRED_V2_LUMA.with(|v2| {
        if v2.get() {
            color.min(Vec3::ZERO)
        } else {
            Vec3::ZERO
        }
    });
    let safe = color.max(Vec3::ZERO);
    if (safe.x - safe.y).abs() < 0.001 && (safe.y - safe.z).abs() < 0.001 {
        return safe + negative_residual;
    }
    let original_hsv = rgb_to_hsv(safe);
    let original_luma = scene_luminance(safe);
    let saturation_mask = smoothstep(0.05, 0.2, original_hsv.y);
    let luminance_weight = smoothstep(0.0, 1.0, original_hsv.y);
    if saturation_mask < 0.001 && luminance_weight < 0.001 {
        return safe + negative_residual;
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
        return Vec3::splat(original_luma * (1.0 + luminance)) + negative_residual;
    }
    let shifted = hsv_to_rgb(Vec3::new(
        (original_hsv.x + hue_shift + 360.0) % 360.0,
        (original_hsv.y * (1.0 + saturation)).clamp(0.0, 1.0),
        original_hsv.z,
    ));
    let new_luma = scene_luminance(shifted);
    let target = original_luma * (1.0 + luminance);
    if new_luma < 0.0001 {
        Vec3::splat(target.max(0.0)) + negative_residual
    } else {
        shifted * (target / new_luma) + negative_residual
    }
}

fn apply_luma_levels(color: Vec3, settings: LevelsSettings, preserve_extended: bool) -> Vec3 {
    if settings.enabled == 0 {
        return color;
    }
    let source_luma = if preserve_extended {
        scene_luminance(color)
    } else {
        scene_luminance(color).max(0.0)
    };
    let input_range = (settings.input_white - settings.input_black).max(0.0001);
    let normalized = (source_luma - settings.input_black) / input_range;
    let output_range = settings.output_white - settings.output_black;
    let output_luma = if preserve_extended && normalized < 0.0 {
        settings.output_black + normalized * output_range
    } else if preserve_extended && normalized > 1.0 {
        settings.output_white + (normalized - 1.0) * output_range
    } else {
        settings.output_black
            + output_range
                * normalized
                    .clamp(0.0, 1.0)
                    .powf(1.0 / settings.gamma.max(0.0001))
    };
    if source_luma.abs() <= 0.0001 {
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
    let luma = scene_luminance(color.max(Vec3::ZERO));
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
            apply_curve(color.x, luma_curve, luma_count, preserve_extended),
            apply_curve(color.y, luma_curve, luma_count, preserve_extended),
            apply_curve(color.z, luma_curve, luma_count, preserve_extended),
        );
    }
    let graded = Vec3::new(
        apply_curve(color.x, red_curve, red_count, preserve_extended),
        apply_curve(color.y, green_curve, green_count, preserve_extended),
        apply_curve(color.z, blue_curve, blue_count, preserve_extended),
    );
    let target_luma = apply_curve(
        view_encoded_luma(color),
        luma_curve,
        luma_count,
        preserve_extended,
    );
    let graded_luma = view_encoded_luma(graded);
    let mut result = if graded_luma > 0.001 {
        graded * (target_luma / graded_luma)
    } else {
        Vec3::splat(target_luma)
    };
    let maximum = result.max_element();
    if !preserve_extended && maximum > 1.0 {
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

fn apply_curve(value: f32, points: &[Point; 16], count: u32, preserve_extended: bool) -> f32 {
    crate::tone::legacy_curves::evaluate_legacy_display_curve_v1(
        value,
        points,
        count,
        preserve_extended,
    )
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
    let luma = view_encoded_luma(color).max(0.0);
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

#[cfg(test)]
mod tone_equalizer_picker_tests {
    use super::*;

    #[test]
    fn point_guidance_matches_the_full_cached_gaussian_surface() {
        let width = 13;
        let height = 9;
        let source = (0..width * height)
            .map(|index| {
                let value = ((index * 17) % 101) as f32 / 100.0;
                Vec3::new(value, value * 0.5, 1.0 - value)
            })
            .collect::<Vec<_>>();
        let full = gaussian_blur(&source, width, height, 4);
        for (x, y) in [(0, 0), (6, 4), (12, 8)] {
            assert_eq!(
                gaussian_blur_at(&source, width, height, x, y, 4),
                full[(y * width + x) as usize]
            );
        }
    }
}

#[cfg(test)]
mod scene_dehaze_tests {
    use super::*;

    #[test]
    fn zero_confidence_is_exact_identity_and_confidence_scales_recovery() {
        let color = Vec3::new(0.35, 0.42, 0.51);
        let blurred = Vec3::splat(0.62);
        let atmosphere = Vec3::new(0.82, 0.9, 1.04);
        let abstained = apply_scene_dehaze_v1(color, blurred, true, 0.1, atmosphere, 0.0);
        let partial = apply_scene_dehaze_v1(color, blurred, true, 0.1, atmosphere, 0.5);
        let full = apply_scene_dehaze_v1(color, blurred, true, 0.1, atmosphere, 1.0);
        assert_eq!(abstained, color);
        assert!(partial.distance(color) > 0.0);
        assert!(partial.distance(color) < full.distance(color));
    }

    #[test]
    fn image_transmission_follows_the_near_side_of_a_depth_discontinuity() {
        let atmosphere = Vec3::new(0.9, 1.0, 1.1);
        let radiance = Vec3::new(0.03, 0.07, 0.12);
        let near_transmission = 0.24;
        let far_transmission = 0.82;
        let observed_near = radiance * near_transmission + atmosphere * (1.0 - near_transmission);
        let observed_far = radiance * far_transmission + atmosphere * (1.0 - far_transmission);
        let cross_edge_blur = observed_near.lerp(observed_far, 0.5);

        let refined =
            edge_refined_image_transmission_v1(observed_near, cross_edge_blur, atmosphere);
        let coarse = (1.0 - 0.95 * (cross_edge_blur / atmosphere).min_element()).clamp(0.08, 1.0);
        assert!((refined - near_transmission).abs() < (coarse - near_transmission).abs());
    }

    #[test]
    fn smooth_regions_use_regional_guidance_to_reject_pixel_noise() {
        let atmosphere = Vec3::splat(1.0);
        let regional = Vec3::splat(0.55);
        let noisy_pixel = Vec3::new(0.545, 0.552, 0.548);
        let refined = edge_refined_image_transmission_v1(noisy_pixel, regional, atmosphere);
        let regional_transmission = 1.0 - 0.95 * 0.55;
        assert!((refined - regional_transmission).abs() < 0.01);
    }

    #[test]
    fn edge_refined_haze_addition_and_removal_stay_finite_with_scene_headroom() {
        let color = Vec3::new(-0.02, 0.4, 1.7);
        let regional = Vec3::new(0.2, 0.45, 1.2);
        let atmosphere = Vec3::new(0.8, 0.9, 1.1);
        for amount in [-0.12, 0.12] {
            let output = apply_scene_dehaze_v1(color, regional, true, amount, atmosphere, 1.0);
            assert!(output.is_finite());
            assert!(output.max_element() > 1.0);
        }
    }
}
