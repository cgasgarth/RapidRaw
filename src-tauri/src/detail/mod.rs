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
        if index < 2 && gain > 0.0 {
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
    fn plan_compiler_rejects_invalid_dimensions_and_gains() {
        assert!(compile_detail_plan(DetailStageClass::CreativeDetail, 0, 1080, enabled()).is_err());
        let mut invalid = enabled();
        invalid.finest = 1.01;
        assert!(
            compile_detail_plan(DetailStageClass::CreativeDetail, 1920, 1080, invalid).is_err()
        );
    }
}
