//! Versioned creative-detail planning and scalar reference math.
//!
//! The production WGPU path consumes the same four nested low-pass products.
//! Keeping the reference scalar makes reconstruction, protection, and macro
//! semantics testable without a graphics device.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub const DETAIL_PROCESS_LEGACY_V1: u32 = 0;
pub const DETAIL_PROCESS_MULTISCALE_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetailStageClass {
    CaptureCorrection,
    CreativeDetail,
    OutputSharpening,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiscaleDetailSettingsV1 {
    pub process_version: u32,
    pub finest: f32,
    pub fine: f32,
    pub medium: f32,
    pub coarse: f32,
    pub texture: f32,
    pub overall_amount: f32,
    pub noise_protection: f32,
    pub halo_suppression: f32,
    pub ringing_suppression: f32,
    pub chroma_detail: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DetailScaleMapping {
    pub target_scale: f32,
    pub effective_radii_px: [f32; 4],
    pub halo_px: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MultiscaleDetailPlanV1 {
    pub stage_class: DetailStageClass,
    pub settings: MultiscaleDetailSettingsV1,
    pub scale_mapping: DetailScaleMapping,
    pub fingerprint: u64,
    pub implementation_version: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DetailStagePlacementV1 {
    pub stage_class: DetailStageClass,
    pub stable_node_id: &'static str,
    pub input_anchor: &'static str,
    pub output_anchor: &'static str,
    pub target_dimensions: [u32; 2],
    pub fingerprint: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DetailPipelinePlacementV1 {
    pub capture: DetailStagePlacementV1,
    pub creative: DetailStagePlacementV1,
    pub output: DetailStagePlacementV1,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CpuDetailDecompositionV1 {
    pub width: u32,
    pub height: u32,
    pub effective_radii_px: [u32; 4],
    low_passes: [Vec<[f32; 3]>; 4],
}

impl CpuDetailDecompositionV1 {
    pub fn low_passes_at(&self, index: usize) -> [[f32; 3]; 4] {
        std::array::from_fn(|band| self.low_passes[band][index])
    }
}

pub fn compile_detail_plan(
    stage_class: DetailStageClass,
    width: u32,
    height: u32,
    settings: MultiscaleDetailSettingsV1,
) -> Result<MultiscaleDetailPlanV1, &'static str> {
    if width == 0 || height == 0 {
        return Err("detail target dimensions must be nonzero");
    }
    let signed = [
        settings.finest,
        settings.fine,
        settings.medium,
        settings.coarse,
        settings.texture,
    ];
    let unit = [
        settings.overall_amount,
        settings.noise_protection,
        settings.halo_suppression,
        settings.ringing_suppression,
        settings.chroma_detail,
    ];
    if signed
        .iter()
        .any(|value| !value.is_finite() || !(-1.0..=1.0).contains(value))
        || unit
            .iter()
            .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
    {
        return Err("detail settings exceed normalized bounds");
    }
    let scale_mapping = compile_scale_mapping(width, height);
    let mut hasher = DefaultHasher::new();
    stage_class.hash(&mut hasher);
    width.hash(&mut hasher);
    height.hash(&mut hasher);
    settings.process_version.hash(&mut hasher);
    for value in signed.into_iter().chain(unit) {
        value.to_bits().hash(&mut hasher);
    }
    Ok(MultiscaleDetailPlanV1 {
        stage_class,
        settings,
        scale_mapping,
        fingerprint: hasher.finish(),
        implementation_version: 1,
    })
}

pub fn compile_scale_mapping(width: u32, height: u32) -> DetailScaleMapping {
    let target_scale = (width.min(height) as f32) / 1080.0;
    let effective_radii_px =
        [1.0, 3.5, 8.0, 40.0].map(|radius| (radius * target_scale).ceil().max(1.0));
    DetailScaleMapping {
        target_scale,
        effective_radii_px,
        halo_px: effective_radii_px[3].ceil() as u32,
    }
}

pub fn compile_detail_pipeline_placement(
    source_dimensions: [u32; 2],
    creative_target_dimensions: [u32; 2],
    output_dimensions: [u32; 2],
    output_recipe_fingerprint: u64,
) -> Result<DetailPipelinePlacementV1, &'static str> {
    if [
        source_dimensions,
        creative_target_dimensions,
        output_dimensions,
    ]
    .iter()
    .any(|dimensions| dimensions[0] == 0 || dimensions[1] == 0)
    {
        return Err("detail stage dimensions must be nonzero");
    }
    Ok(DetailPipelinePlacementV1 {
        capture: stage_placement(
            DetailStageClass::CaptureCorrection,
            "capture_correction_detail_v1",
            "highlight_reconstruction",
            "primary_denoise",
            source_dimensions,
            0,
        ),
        creative: stage_placement(
            DetailStageClass::CreativeDetail,
            "creative_multiscale_detail_v1",
            "primary_denoise",
            "scene_global_color_tone",
            creative_target_dimensions,
            0,
        ),
        output: stage_placement(
            DetailStageClass::OutputSharpening,
            "output_sharpen_after_resize_v1",
            "final_resize",
            "output_encoding",
            output_dimensions,
            output_recipe_fingerprint,
        ),
    })
}

pub fn validate_detail_pipeline_placement(
    placement: &DetailPipelinePlacementV1,
) -> Result<(), &'static str> {
    let expected = [
        (
            placement.capture,
            DetailStageClass::CaptureCorrection,
            "capture_correction_detail_v1",
            "highlight_reconstruction",
            "primary_denoise",
        ),
        (
            placement.creative,
            DetailStageClass::CreativeDetail,
            "creative_multiscale_detail_v1",
            "primary_denoise",
            "scene_global_color_tone",
        ),
        (
            placement.output,
            DetailStageClass::OutputSharpening,
            "output_sharpen_after_resize_v1",
            "final_resize",
            "output_encoding",
        ),
    ];
    for (stage, class, stable_node_id, input, output) in expected {
        if stage.stage_class != class
            || stage.stable_node_id != stable_node_id
            || stage.input_anchor != input
            || stage.output_anchor != output
        {
            return Err("detail stage placement is ambiguous or out of order");
        }
        if stage.target_dimensions.contains(&0) {
            return Err("detail stage target dimensions must be nonzero");
        }
    }
    if placement.capture.stable_node_id == placement.creative.stable_node_id
        || placement.capture.stable_node_id == placement.output.stable_node_id
        || placement.creative.stable_node_id == placement.output.stable_node_id
    {
        return Err("detail stage identities must be distinct");
    }
    Ok(())
}

fn stage_placement(
    stage_class: DetailStageClass,
    stable_node_id: &'static str,
    input_anchor: &'static str,
    output_anchor: &'static str,
    target_dimensions: [u32; 2],
    identity_salt: u64,
) -> DetailStagePlacementV1 {
    let mut hasher = DefaultHasher::new();
    stage_class.hash(&mut hasher);
    stable_node_id.hash(&mut hasher);
    input_anchor.hash(&mut hasher);
    output_anchor.hash(&mut hasher);
    target_dimensions.hash(&mut hasher);
    identity_salt.hash(&mut hasher);
    DetailStagePlacementV1 {
        stage_class,
        stable_node_id,
        input_anchor,
        output_anchor,
        target_dimensions,
        fingerprint: hasher.finish(),
    }
}

/// Maps the compact legacy-style controls into the shared decomposition.
/// Inputs and output gains use normalized `-1..1` units.
pub fn compile_macro_gains(sharpness: f32, texture: f32, clarity: f32, structure: f32) -> [f32; 4] {
    [
        sharpness * 0.72,
        sharpness * 0.28 + texture * 0.6,
        clarity * 0.68 + texture * 0.4,
        clarity * 0.32 + structure,
    ]
}

pub fn decompose_luma(source: f32, low_passes: [f32; 4]) -> ([f32; 4], f32) {
    (
        [
            source - low_passes[0],
            low_passes[0] - low_passes[1],
            low_passes[1] - low_passes[2],
            low_passes[2] - low_passes[3],
        ],
        low_passes[3],
    )
}

pub fn reconstruct_luma(bands: [f32; 4], residual: f32) -> f32 {
    bands.into_iter().sum::<f32>() + residual
}

pub fn apply_luma_reference(
    source: f32,
    low_passes: [f32; 4],
    settings: MultiscaleDetailSettingsV1,
    macro_gains: [f32; 4],
) -> f32 {
    if settings.process_version != DETAIL_PROCESS_MULTISCALE_V1 {
        return source;
    }
    let (bands, _) = decompose_luma(source, low_passes);
    let direct = [
        settings.finest,
        settings.fine,
        settings.medium,
        settings.coarse,
    ];
    let mut delta = 0.0;
    for index in 0..4 {
        let gain = (direct[index] + macro_gains[index]) * settings.overall_amount;
        let mut confidence = 1.0;
        if index < 3 && gain > 0.0 {
            let signal = bands[index].abs();
            let floor = 0.0001 + settings.noise_protection * 0.02;
            confidence = ((signal - floor) / (floor * 2.0).max(0.001)).clamp(0.0, 1.0);
            let shadow = ((source - 0.015) / 0.15).clamp(0.0, 1.0);
            confidence *= 1.0 - settings.noise_protection * (1.0 - shadow);
        }
        delta += bands[index] * gain * confidence;
    }
    let limit = (0.01_f32.max(source.abs() * 0.5))
        * (1.0 - settings.halo_suppression.clamp(0.0, 1.0) * 0.8)
        * (1.0 - settings.ringing_suppression.clamp(0.0, 1.0) * 0.5);
    (source + delta.clamp(-limit, limit)).max(0.0)
}

pub fn build_cpu_detail_decomposition(
    source: &[[f32; 3]],
    width: u32,
    height: u32,
) -> Result<CpuDetailDecompositionV1, &'static str> {
    let mapping = compile_scale_mapping(width, height);
    let radii = mapping.effective_radii_px.map(|radius| radius as u32);
    build_cpu_detail_decomposition_with_radii(source, width, height, radii)
}

pub fn apply_cpu_detail(
    source: &[[f32; 3]],
    decomposition: &CpuDetailDecompositionV1,
    settings: MultiscaleDetailSettingsV1,
    macro_gains: [f32; 4],
) -> Result<Vec<[f32; 3]>, &'static str> {
    if source.len() != decomposition.low_passes[0].len() {
        return Err("detail source and decomposition lengths differ");
    }
    Ok(source
        .iter()
        .enumerate()
        .map(|(index, source)| {
            apply_rgb_reference(
                *source,
                decomposition.low_passes_at(index),
                settings,
                macro_gains,
            )
        })
        .collect())
}

pub fn apply_cpu_detail_tiled(
    source: &[[f32; 3]],
    width: u32,
    height: u32,
    tile_edge: u32,
    settings: MultiscaleDetailSettingsV1,
    macro_gains: [f32; 4],
) -> Result<Vec<[f32; 3]>, &'static str> {
    validate_cpu_surface(source, width, height)?;
    if tile_edge == 0 {
        return Err("detail tile edge must be nonzero");
    }
    let radii = compile_scale_mapping(width, height)
        .effective_radii_px
        .map(|radius| radius as u32);
    let halo = radii[3];
    let mut output = vec![[0.0; 3]; source.len()];
    for tile_y in (0..height).step_by(tile_edge as usize) {
        for tile_x in (0..width).step_by(tile_edge as usize) {
            let tile_end_x = (tile_x + tile_edge).min(width);
            let tile_end_y = (tile_y + tile_edge).min(height);
            let input_x = tile_x.saturating_sub(halo);
            let input_y = tile_y.saturating_sub(halo);
            let input_end_x = (tile_end_x + halo).min(width);
            let input_end_y = (tile_end_y + halo).min(height);
            let input_width = input_end_x - input_x;
            let input_height = input_end_y - input_y;
            let mut tile_source = Vec::with_capacity((input_width * input_height) as usize);
            for y in input_y..input_end_y {
                let start = (y * width + input_x) as usize;
                tile_source.extend_from_slice(&source[start..start + input_width as usize]);
            }
            let decomposition = build_cpu_detail_decomposition_with_radii(
                &tile_source,
                input_width,
                input_height,
                radii,
            )?;
            let processed = apply_cpu_detail(&tile_source, &decomposition, settings, macro_gains)?;
            for y in tile_y..tile_end_y {
                for x in tile_x..tile_end_x {
                    let source_index = ((y - input_y) * input_width + (x - input_x)) as usize;
                    output[(y * width + x) as usize] = processed[source_index];
                }
            }
        }
    }
    Ok(output)
}

pub fn apply_rgb_reference(
    source: [f32; 3],
    low_passes: [[f32; 3]; 4],
    settings: MultiscaleDetailSettingsV1,
    macro_gains: [f32; 4],
) -> [f32; 3] {
    if settings.process_version != DETAIL_PROCESS_MULTISCALE_V1 {
        return source;
    }
    let source = source.map(|channel| channel.max(0.0));
    let low_passes = low_passes.map(|color| color.map(|channel| channel.max(0.0)));
    let source_luma = detail_luma(source);
    let low_luma = low_passes.map(detail_luma);
    let (bands, _) = decompose_luma(source_luma, low_luma);
    let rgb_bands = [
        subtract_rgb(source, low_passes[0]),
        subtract_rgb(low_passes[0], low_passes[1]),
        subtract_rgb(low_passes[1], low_passes[2]),
        subtract_rgb(low_passes[2], low_passes[3]),
    ];
    let direct = [
        settings.finest,
        settings.fine,
        settings.medium,
        settings.coarse,
    ];
    let mut delta = 0.0;
    let mut rgb_delta = [0.0; 3];
    for index in 0..4 {
        let gain = (direct[index] + macro_gains[index]) * settings.overall_amount;
        let mut confidence = 1.0;
        if index < 3 && gain > 0.0 {
            let floor = 0.0001 + settings.noise_protection * 0.02;
            confidence = smoothstep(floor, floor * 3.0, bands[index].abs());
            let shadow_confidence = smoothstep(0.015, 0.165, source_luma);
            confidence *= 1.0 - settings.noise_protection * (1.0 - shadow_confidence);
        }
        delta += bands[index] * gain * confidence;
        for channel in 0..3 {
            rgb_delta[channel] += rgb_bands[index][channel] * gain * confidence;
        }
    }
    let halo_limit = source_luma.abs().mul_add(0.5, 0.0).max(0.01)
        * (1.0 - settings.halo_suppression.clamp(0.0, 1.0) * 0.8)
        * (1.0 - settings.ringing_suppression.clamp(0.0, 1.0) * 0.5);
    let output_luma = (source_luma + delta.clamp(-halo_limit, halo_limit)).max(0.0);
    let ratio = output_luma / source_luma.max(0.00001);
    let luma_only = source.map(|channel| (channel * ratio).max(0.0));
    let mut chroma = std::array::from_fn(|channel| {
        (source[channel] + rgb_delta[channel].clamp(-halo_limit, halo_limit)).max(0.0)
    });
    let chroma_scale = output_luma / detail_luma(chroma).max(0.00001);
    chroma = chroma.map(|channel| channel * chroma_scale);
    let chroma_mix = settings.chroma_detail.clamp(0.0, 1.0) * 0.2;
    std::array::from_fn(|channel| {
        luma_only[channel] * (1.0 - chroma_mix) + chroma[channel] * chroma_mix
    })
}

fn build_cpu_detail_decomposition_with_radii(
    source: &[[f32; 3]],
    width: u32,
    height: u32,
    radii: [u32; 4],
) -> Result<CpuDetailDecompositionV1, &'static str> {
    validate_cpu_surface(source, width, height)?;
    Ok(CpuDetailDecompositionV1 {
        width,
        height,
        effective_radii_px: radii,
        low_passes: radii.map(|radius| gaussian_blur_rgb(source, width, height, radius)),
    })
}

fn validate_cpu_surface(source: &[[f32; 3]], width: u32, height: u32) -> Result<(), &'static str> {
    if width == 0 || height == 0 || source.len() != (width as usize * height as usize) {
        return Err("detail CPU surface dimensions are invalid");
    }
    Ok(())
}

fn gaussian_blur_rgb(source: &[[f32; 3]], width: u32, height: u32, radius: u32) -> Vec<[f32; 3]> {
    let sigma = radius as f32 / 2.0;
    let offsets = -(radius as i32)..=radius as i32;
    let weights = offsets
        .clone()
        .map(|offset| (-(offset as f32).powi(2) / (2.0 * sigma * sigma)).exp())
        .collect::<Vec<_>>();
    let total_weight = weights.iter().sum::<f32>();
    let mut horizontal = vec![[0.0; 3]; source.len()];
    for y in 0..height {
        for x in 0..width {
            let mut color = [0.0; 3];
            for (weight_index, offset) in offsets.clone().enumerate() {
                let sample_x = (x as i32 + offset).clamp(0, width as i32 - 1) as u32;
                let sample = source[(y * width + sample_x) as usize];
                for channel in 0..3 {
                    color[channel] += sample[channel].clamp(0.0, 65_504.0) * weights[weight_index];
                }
            }
            horizontal[(y * width + x) as usize] =
                color.map(|channel| round_f16(channel / total_weight));
        }
    }
    let mut vertical = vec![[0.0; 3]; source.len()];
    for y in 0..height {
        for x in 0..width {
            let mut color = [0.0; 3];
            for (weight_index, offset) in offsets.clone().enumerate() {
                let sample_y = (y as i32 + offset).clamp(0, height as i32 - 1) as u32;
                let sample = horizontal[(sample_y * width + x) as usize];
                for channel in 0..3 {
                    color[channel] += sample[channel] * weights[weight_index];
                }
            }
            vertical[(y * width + x) as usize] =
                color.map(|channel| round_f16(channel / total_weight));
        }
    }
    vertical
}

fn detail_luma(color: [f32; 3]) -> f32 {
    color[0] * 0.272_228_72 + color[1] * 0.674_081_74 + color[2] * 0.053_689_52
}

fn subtract_rgb(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|channel| left[channel] - right[channel])
}

fn smoothstep(low: f32, high: f32, value: f32) -> f32 {
    let t = ((value - low) / (high - low)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn round_f16(value: f32) -> f32 {
    half::f16::from_f32(value).to_f32()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled() -> MultiscaleDetailSettingsV1 {
        MultiscaleDetailSettingsV1 {
            process_version: DETAIL_PROCESS_MULTISCALE_V1,
            overall_amount: 1.0,
            ..Default::default()
        }
    }

    #[test]
    fn zero_gains_reconstruct_exactly() {
        let source = 0.42;
        assert_eq!(
            apply_luma_reference(source, [0.4, 0.35, 0.3, 0.2], enabled(), [0.0; 4]),
            source
        );
    }

    #[test]
    fn laplacian_bands_reconstruct_impulse_ramp_and_checker_samples() {
        for (source, low_passes) in [
            (1.0, [0.25, 0.12, 0.06, 0.03]),
            (0.63, [0.61, 0.58, 0.51, 0.4]),
            (0.0, [0.5, 0.25, 0.125, 0.0625]),
        ] {
            let (bands, residual) = decompose_luma(source, low_passes);
            assert!((reconstruct_luma(bands, residual) - source).abs() <= f32::EPSILON);
        }
    }

    #[test]
    fn positive_and_negative_band_gain_are_continuous_around_zero() {
        let source = 0.4;
        let low = [0.35, 0.3, 0.28, 0.25];
        let mut settings = enabled();
        settings.fine = -0.0001;
        let below = apply_luma_reference(source, low, settings, [0.0; 4]);
        settings.fine = 0.0001;
        let above = apply_luma_reference(source, low, settings, [0.0; 4]);
        assert!((above - below).abs() < 0.0001);
    }

    #[test]
    fn legacy_process_is_exact_identity() {
        let mut settings = enabled();
        settings.process_version = DETAIL_PROCESS_LEGACY_V1;
        settings.finest = 1.0;
        assert_eq!(apply_luma_reference(0.4, [0.2; 4], settings, [1.0; 4]), 0.4);
    }

    #[test]
    fn macro_mapping_has_stable_scale_ownership() {
        assert_eq!(
            compile_macro_gains(1.0, 0.0, 0.0, 0.0),
            [0.72, 0.28, 0.0, 0.0]
        );
        assert_eq!(
            compile_macro_gains(0.0, 1.0, 0.0, 0.0),
            [0.0, 0.6, 0.4, 0.0]
        );
        assert_eq!(
            compile_macro_gains(0.0, 0.0, 1.0, 0.0),
            [0.0, 0.0, 0.68, 0.32]
        );
        assert_eq!(
            compile_macro_gains(0.0, 0.0, 0.0, 1.0),
            [0.0, 0.0, 0.0, 1.0]
        );
    }

    #[test]
    fn noise_protection_suppresses_shadow_speckle() {
        let low = [0.0505, 0.05, 0.05, 0.05];
        let mut unprotected = enabled();
        unprotected.finest = 1.0;
        let mut protected = unprotected;
        protected.noise_protection = 1.0;
        let plain = apply_luma_reference(0.051, low, unprotected, [0.0; 4]);
        let guarded = apply_luma_reference(0.051, low, protected, [0.0; 4]);
        assert!((guarded - 0.051).abs() < (plain - 0.051).abs());
    }

    #[test]
    fn halo_controls_bound_step_overshoot() {
        let mut settings = enabled();
        settings.coarse = 1.0;
        let unguarded = apply_luma_reference(0.5, [0.5, 0.5, 0.5, 0.0], settings, [0.0; 4]);
        settings.halo_suppression = 1.0;
        settings.ringing_suppression = 1.0;
        let guarded = apply_luma_reference(0.5, [0.5, 0.5, 0.5, 0.0], settings, [0.0; 4]);
        assert!(guarded - 0.5 < unguarded - 0.5);
        assert!(guarded <= 0.525);
    }

    #[test]
    fn scale_mapping_is_resolution_normalized_and_bounded() {
        assert_eq!(
            compile_scale_mapping(1920, 1080).effective_radii_px,
            [1.0, 4.0, 8.0, 40.0]
        );
        let full = compile_scale_mapping(6000, 4000);
        assert!(full.effective_radii_px[3] > 140.0);
        assert_eq!(full.halo_px, full.effective_radii_px[3].ceil() as u32);
    }

    #[test]
    fn stage_class_and_target_dimensions_own_plan_identity() {
        let settings = enabled();
        let creative =
            compile_detail_plan(DetailStageClass::CreativeDetail, 1920, 1080, settings).unwrap();
        let capture =
            compile_detail_plan(DetailStageClass::CaptureCorrection, 1920, 1080, settings).unwrap();
        let resized =
            compile_detail_plan(DetailStageClass::CreativeDetail, 3840, 2160, settings).unwrap();
        assert_ne!(creative.fingerprint, capture.fingerprint);
        assert_ne!(creative.fingerprint, resized.fingerprint);
        assert_eq!(creative.implementation_version, 1);
    }

    #[test]
    fn capture_creative_and_output_stage_contracts_are_distinct_and_recipe_bound() {
        let placement =
            compile_detail_pipeline_placement([6000, 4000], [1800, 1200], [3000, 2000], 41)
                .unwrap();
        validate_detail_pipeline_placement(&placement).unwrap();
        assert_eq!(
            placement.capture.stable_node_id,
            "capture_correction_detail_v1"
        );
        assert_eq!(
            placement.creative.stable_node_id,
            "creative_multiscale_detail_v1"
        );
        assert_eq!(
            placement.output.stable_node_id,
            "output_sharpen_after_resize_v1"
        );
        assert_ne!(
            placement.capture.fingerprint,
            placement.creative.fingerprint
        );
        assert_ne!(placement.creative.fingerprint, placement.output.fingerprint);
        let other_recipe =
            compile_detail_pipeline_placement([6000, 4000], [1800, 1200], [3000, 2000], 42)
                .unwrap();
        assert_eq!(
            placement.capture.fingerprint,
            other_recipe.capture.fingerprint
        );
        assert_eq!(
            placement.creative.fingerprint,
            other_recipe.creative.fingerprint
        );
        assert_ne!(
            placement.output.fingerprint,
            other_recipe.output.fingerprint
        );
    }

    #[test]
    fn stage_contract_rejects_ambiguous_placement_and_zero_targets() {
        assert!(
            compile_detail_pipeline_placement([0, 4000], [1800, 1200], [3000, 2000], 1).is_err()
        );
        let mut placement =
            compile_detail_pipeline_placement([6000, 4000], [1800, 1200], [3000, 2000], 1).unwrap();
        placement.output.input_anchor = "scene_global_color_tone";
        assert!(validate_detail_pipeline_placement(&placement).is_err());
        placement =
            compile_detail_pipeline_placement([6000, 4000], [1800, 1200], [3000, 2000], 1).unwrap();
        placement.output.stable_node_id = placement.creative.stable_node_id;
        assert!(validate_detail_pipeline_placement(&placement).is_err());
        placement =
            compile_detail_pipeline_placement([6000, 4000], [1800, 1200], [3000, 2000], 1).unwrap();
        placement.capture.stable_node_id = "arbitrary_capture_detail";
        assert!(validate_detail_pipeline_placement(&placement).is_err());
    }

    #[test]
    fn plan_compiler_rejects_invalid_dimensions_and_gains() {
        assert!(compile_detail_plan(DetailStageClass::CreativeDetail, 0, 1080, enabled()).is_err());
        let mut invalid = enabled();
        invalid.finest = 1.01;
        assert!(
            compile_detail_plan(DetailStageClass::CreativeDetail, 1920, 1080, invalid).is_err()
        );
    }

    #[test]
    fn cpu_reference_zero_gain_is_identity_and_tiled_execution_has_no_seams() {
        let width = 129;
        let height = 97;
        let source = synthetic_rgb(width, height, |x, y| {
            let ramp = 0.08 + x as f32 / width as f32 * 0.7;
            let checker = if (x / 3 + y / 3) % 2 == 0 {
                0.025
            } else {
                -0.025
            };
            [ramp + checker, ramp * 0.72 + checker, ramp * 0.48 + checker]
        });
        let decomposition = build_cpu_detail_decomposition(&source, width, height).unwrap();
        let identity = apply_cpu_detail(&source, &decomposition, enabled(), [0.0; 4]).unwrap();
        assert_eq!(identity, source);

        let mut settings = enabled();
        settings.finest = 0.55;
        settings.fine = -0.2;
        settings.medium = 0.25;
        settings.coarse = 0.15;
        settings.noise_protection = 0.3;
        settings.halo_suppression = 0.7;
        settings.ringing_suppression = 0.8;
        let full = apply_cpu_detail(&source, &decomposition, settings, [0.0; 4]).unwrap();
        let tiled = apply_cpu_detail_tiled(&source, width, height, 37, settings, [0.0; 4]).unwrap();
        let seam_error = full
            .iter()
            .zip(&tiled)
            .flat_map(|(left, right)| (0..3).map(|channel| (left[channel] - right[channel]).abs()))
            .fold(0.0_f32, f32::max);
        assert!(seam_error <= 0.000_001, "tile seam error {seam_error}");
    }

    #[test]
    fn synthetic_step_ramp_checker_star_and_slanted_edge_remain_finite_and_bounded() {
        let width = 96;
        let height = 96;
        let patterns = [
            synthetic_rgb(width, height, |x, _| {
                gray(if x < width / 2 { 0.12 } else { 0.72 })
            }),
            synthetic_rgb(width, height, |x, _| {
                gray(0.05 + x as f32 / width as f32 * 0.85)
            }),
            synthetic_rgb(width, height, |x, y| {
                gray(if (x / 4 + y / 4) % 2 == 0 { 0.2 } else { 0.7 })
            }),
            synthetic_rgb(width, height, |x, y| {
                let dx = x as f32 - width as f32 * 0.5;
                let dy = y as f32 - height as f32 * 0.5;
                let angle = dy.atan2(dx);
                gray(if (angle * 12.0).sin() >= 0.0 {
                    0.7
                } else {
                    0.15
                })
            }),
            synthetic_rgb(width, height, |x, y| {
                gray(if x as f32 + y as f32 * 0.63 > 76.0 {
                    0.75
                } else {
                    0.1
                })
            }),
        ];
        let mut settings = enabled();
        settings.finest = 0.8;
        settings.fine = 0.55;
        settings.medium = 0.35;
        settings.coarse = 0.2;
        settings.halo_suppression = 1.0;
        settings.ringing_suppression = 1.0;
        for source in patterns {
            let decomposition = build_cpu_detail_decomposition(&source, width, height).unwrap();
            let output = apply_cpu_detail(&source, &decomposition, settings, [0.0; 4]).unwrap();
            for (before, after) in source.iter().zip(output) {
                assert!(after.into_iter().all(f32::is_finite));
                assert!(after.into_iter().all(|channel| channel >= 0.0));
                let before_luma = detail_luma(*before);
                let after_luma = detail_luma(after);
                let bound = before_luma.abs().mul_add(0.05, 0.001).max(0.001_001);
                assert!((after_luma - before_luma).abs() <= bound);
            }
        }
    }

    #[test]
    fn finest_band_prefers_high_frequency_sweep_and_noise_guard_damps_shadow_checker() {
        let width = 160;
        let height = 32;
        let low = synthetic_rgb(width, height, |x, _| {
            gray(0.4 + 0.12 * (x as f32 * std::f32::consts::TAU / 80.0).sin())
        });
        let high = synthetic_rgb(width, height, |x, _| {
            gray(0.4 + 0.12 * (x as f32 * std::f32::consts::TAU / 4.0).sin())
        });
        let mut settings = enabled();
        settings.finest = 0.7;
        let low_delta = rms_delta(
            &low,
            &apply_cpu_detail(
                &low,
                &build_cpu_detail_decomposition(&low, width, height).unwrap(),
                settings,
                [0.0; 4],
            )
            .unwrap(),
        );
        let high_delta = rms_delta(
            &high,
            &apply_cpu_detail(
                &high,
                &build_cpu_detail_decomposition(&high, width, height).unwrap(),
                settings,
                [0.0; 4],
            )
            .unwrap(),
        );
        assert!(high_delta > low_delta * 2.0);

        let shadow = synthetic_rgb(width, height, |x, y| {
            gray(if (x + y) % 2 == 0 { 0.024 } else { 0.016 })
        });
        let decomposition = build_cpu_detail_decomposition(&shadow, width, height).unwrap();
        let unprotected = apply_cpu_detail(&shadow, &decomposition, settings, [0.0; 4]).unwrap();
        settings.noise_protection = 1.0;
        let protected = apply_cpu_detail(&shadow, &decomposition, settings, [0.0; 4]).unwrap();
        assert!(rms_delta(&shadow, &protected) < rms_delta(&shadow, &unprotected));
    }

    #[test]
    fn default_luma_detail_preserves_chromaticity_and_opt_in_chroma_keeps_luma() {
        let source = [0.62, 0.31, 0.12];
        let low_passes = [
            [0.55, 0.29, 0.13],
            [0.5, 0.28, 0.14],
            [0.46, 0.27, 0.15],
            [0.42, 0.26, 0.16],
        ];
        let mut settings = enabled();
        settings.finest = 0.6;
        settings.fine = 0.3;
        let luma_only = apply_rgb_reference(source, low_passes, settings, [0.0; 4]);
        assert!((luma_only[0] / luma_only[1] - source[0] / source[1]).abs() < 0.000_01);
        assert!((luma_only[2] / luma_only[1] - source[2] / source[1]).abs() < 0.000_01);
        settings.chroma_detail = 1.0;
        let chroma = apply_rgb_reference(source, low_passes, settings, [0.0; 4]);
        assert!((detail_luma(chroma) - detail_luma(luma_only)).abs() < 0.000_01);
        assert!(
            chroma
                .into_iter()
                .all(|channel| channel >= 0.0 && channel.is_finite())
        );
    }

    #[test]
    fn cpu_executor_rejects_invalid_surfaces_and_tiles() {
        assert!(build_cpu_detail_decomposition(&[], 0, 0).is_err());
        assert!(build_cpu_detail_decomposition(&[[0.0; 3]], 2, 1).is_err());
        assert!(apply_cpu_detail_tiled(&[[0.0; 3]], 1, 1, 0, enabled(), [0.0; 4]).is_err());
    }

    fn synthetic_rgb(
        width: u32,
        height: u32,
        pattern: impl Fn(u32, u32) -> [f32; 3],
    ) -> Vec<[f32; 3]> {
        let mut pixels = Vec::with_capacity((width * height) as usize);
        for y in 0..height {
            for x in 0..width {
                pixels.push(pattern(x, y));
            }
        }
        pixels
    }

    fn gray(value: f32) -> [f32; 3] {
        [value; 3]
    }

    fn rms_delta(before: &[[f32; 3]], after: &[[f32; 3]]) -> f32 {
        let squared = before
            .iter()
            .zip(after)
            .map(|(left, right)| (detail_luma(*left) - detail_luma(*right)).powi(2))
            .sum::<f32>();
        (squared / before.len() as f32).sqrt()
    }
}
