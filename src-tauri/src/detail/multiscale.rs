use std::hash::{Hash, Hasher};

use image::DynamicImage;
use serde::{Deserialize, Serialize};

pub const MULTISCALE_DETAIL_IMPLEMENTATION_VERSION: u32 = 1;
pub const MULTISCALE_DETAIL_BAND_COUNT: usize = 5;
const BASE_RADII: [f32; MULTISCALE_DETAIL_BAND_COUNT] = [1.0, 2.0, 4.0, 8.0, 16.0];
const AP1_LUMA: [f32; 3] = [0.272_228_72, 0.674_081_74, 0.053_689_52];

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DetailBandSettingsV1 {
    pub edge_protection: f32,
    pub gain: f32,
    pub noise_protection: f32,
    pub threshold: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DetailProcessV1 {
    AtrousLumaV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DetailStageClassV1 {
    CaptureCorrection,
    CreativeDetail,
    OutputSharpening,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MultiscaleDetailSettingsV1 {
    pub bands: [DetailBandSettingsV1; MULTISCALE_DETAIL_BAND_COUNT],
    pub chroma_detail: f32,
    pub halo_suppression: f32,
    pub highlight_protection: f32,
    pub overall_amount: f32,
    pub process: DetailProcessV1,
    pub reference_scale_px: f32,
    pub ringing_suppression: f32,
    pub shadow_noise_protection: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MultiscaleDetailValidationError {
    InvalidBandControl,
    InvalidGlobalControl,
    InvalidReferenceScale,
    UnsupportedChromaDetail,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MultiscaleDetailPlanV1 {
    pub effective_radii_px: [usize; MULTISCALE_DETAIL_BAND_COUNT],
    pub fingerprint: u64,
    pub implementation_version: u32,
    pub stage_class: DetailStageClassV1,
    pub settings: MultiscaleDetailSettingsV1,
    pub target_dimensions: [u32; 2],
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiscaleDetailReceiptV1 {
    pub effective_radii_px: [usize; MULTISCALE_DETAIL_BAND_COUNT],
    pub fingerprint: String,
    pub implementation_version: u32,
    pub process: DetailProcessV1,
    pub reference_scale_px: f32,
    pub stage_class: DetailStageClassV1,
    pub target_dimensions: [u32; 2],
}

impl MultiscaleDetailSettingsV1 {
    pub fn validate(&self) -> Result<(), MultiscaleDetailValidationError> {
        if !self.overall_amount.is_finite()
            || !(0.0..=2.0).contains(&self.overall_amount)
            || !unit(self.halo_suppression)
            || !unit(self.ringing_suppression)
            || !unit(self.shadow_noise_protection)
            || !unit(self.highlight_protection)
        {
            return Err(MultiscaleDetailValidationError::InvalidGlobalControl);
        }
        if !self.reference_scale_px.is_finite()
            || !(256.0..=20_000.0).contains(&self.reference_scale_px)
        {
            return Err(MultiscaleDetailValidationError::InvalidReferenceScale);
        }
        if !self.chroma_detail.is_finite() || self.chroma_detail.abs() > f32::EPSILON {
            return Err(MultiscaleDetailValidationError::UnsupportedChromaDetail);
        }
        if self.bands.iter().any(|band| {
            !band.gain.is_finite()
                || !(-2.0..=2.0).contains(&band.gain)
                || !unit(band.threshold)
                || !unit(band.edge_protection)
                || !unit(band.noise_protection)
        }) {
            return Err(MultiscaleDetailValidationError::InvalidBandControl);
        }
        Ok(())
    }
}

impl MultiscaleDetailPlanV1 {
    pub fn compile(
        settings: MultiscaleDetailSettingsV1,
        width: u32,
        height: u32,
    ) -> Result<Self, MultiscaleDetailValidationError> {
        Self::compile_for_stage(settings, width, height, DetailStageClassV1::CreativeDetail)
    }

    pub fn compile_for_stage(
        settings: MultiscaleDetailSettingsV1,
        width: u32,
        height: u32,
        stage_class: DetailStageClassV1,
    ) -> Result<Self, MultiscaleDetailValidationError> {
        settings.validate()?;
        let long_edge = width.max(height).max(1) as f32;
        let scale = long_edge / settings.reference_scale_px;
        let mut previous = 0;
        let effective_radii_px = BASE_RADII.map(|radius| {
            let mapped = (radius * scale).round().max(1.0) as usize;
            let distinct = mapped.max(previous + 1);
            previous = distinct;
            distinct
        });
        let fingerprint = fingerprint(&settings, [width, height], effective_radii_px, stage_class);
        Ok(Self {
            effective_radii_px,
            fingerprint,
            implementation_version: MULTISCALE_DETAIL_IMPLEMENTATION_VERSION,
            stage_class,
            settings,
            target_dimensions: [width, height],
        })
    }

    pub fn is_identity(&self) -> bool {
        self.settings.overall_amount <= f32::EPSILON
            || self
                .settings
                .bands
                .iter()
                .all(|band| band.gain.abs() <= f32::EPSILON)
    }

    pub fn receipt(&self) -> MultiscaleDetailReceiptV1 {
        MultiscaleDetailReceiptV1 {
            effective_radii_px: self.effective_radii_px,
            fingerprint: format!("{:016x}", self.fingerprint),
            implementation_version: self.implementation_version,
            process: self.settings.process,
            reference_scale_px: self.settings.reference_scale_px,
            stage_class: self.stage_class,
            target_dimensions: self.target_dimensions,
        }
    }
}

pub fn apply_multiscale_detail(image: &mut DynamicImage, plan: &MultiscaleDetailPlanV1) {
    if plan.is_identity() {
        return;
    }
    let mut output = image.to_rgb32f();
    let width = output.width() as usize;
    let height = output.height() as usize;
    if width == 0 || height == 0 {
        return;
    }
    let source = output.as_raw();
    let luma = source
        .chunks_exact(3)
        .map(|pixel| pixel[0] * AP1_LUMA[0] + pixel[1] * AP1_LUMA[1] + pixel[2] * AP1_LUMA[2])
        .collect::<Vec<_>>();
    let mut previous = luma.clone();
    let mut bands = Vec::with_capacity(MULTISCALE_DETAIL_BAND_COUNT);
    for radius in plan.effective_radii_px {
        let base = box_blur(&previous, width, height, radius);
        bands.push(
            previous
                .iter()
                .zip(&base)
                .map(|(source, blurred)| source - blurred)
                .collect::<Vec<_>>(),
        );
        previous = base;
    }

    for (index, pixel) in output.as_mut().chunks_exact_mut(3).enumerate() {
        let source_luma = luma[index];
        let detail_energy = bands.iter().map(|band| band[index].abs()).sum::<f32>();
        let edge_guard = 1.0
            - plan.settings.halo_suppression * detail_energy
                / (detail_energy + 0.08_f32.max(f32::EPSILON));
        let shadow = (1.0 - source_luma.clamp(0.0, 0.25) / 0.25).max(0.0);
        let mut boost = 0.0;
        for (band_index, band) in bands.iter().enumerate() {
            let value = band[index];
            let settings = plan.settings.bands[band_index];
            let confidence = smoothstep(settings.threshold, settings.threshold + 0.04, value.abs());
            let noise_guard = 1.0
                - settings.noise_protection
                    * plan.settings.shadow_noise_protection
                    * shadow
                    * (1.0 - confidence);
            let band_edge_guard = 1.0 - settings.edge_protection * (1.0 - edge_guard);
            boost += value * settings.gain * noise_guard * band_edge_guard;
        }
        boost *= plan.settings.overall_amount * edge_guard;

        let ringing_limit = (0.01 + detail_energy * 0.25)
            * (1.0 - 0.8 * plan.settings.ringing_suppression)
            * (0.75 + 0.25 * plan.settings.overall_amount);
        boost = boost.clamp(-ringing_limit, ringing_limit);
        if boost > 0.0 && source_luma > 1.0 {
            let highlight_guard = 1.0
                - plan.settings.highlight_protection
                    * ((source_luma - 1.0) / (source_luma + 1.0)).clamp(0.0, 1.0);
            boost *= highlight_guard;
        }

        let target_luma = (source_luma + boost).max(0.0);
        if source_luma > 1e-6 {
            let scale = target_luma / source_luma;
            pixel[0] *= scale;
            pixel[1] *= scale;
            pixel[2] *= scale;
        }
    }
    *image = DynamicImage::ImageRgb32F(output);
}

fn unit(value: f32) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn smoothstep(low: f32, high: f32, value: f32) -> f32 {
    if high <= low {
        return (value >= high) as u8 as f32;
    }
    let t = ((value - low) / (high - low)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn box_blur(source: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    let mut horizontal = vec![0.0; source.len()];
    for y in 0..height {
        let mut prefix = vec![0.0_f64; width + 1];
        for x in 0..width {
            prefix[x + 1] = prefix[x] + f64::from(source[y * width + x]);
        }
        for x in 0..width {
            let start = x.saturating_sub(radius);
            let end = (x + radius + 1).min(width);
            horizontal[y * width + x] =
                ((prefix[end] - prefix[start]) / (end - start) as f64) as f32;
        }
    }
    let mut vertical = vec![0.0; source.len()];
    for x in 0..width {
        let mut prefix = vec![0.0_f64; height + 1];
        for y in 0..height {
            prefix[y + 1] = prefix[y] + f64::from(horizontal[y * width + x]);
        }
        for y in 0..height {
            let start = y.saturating_sub(radius);
            let end = (y + radius + 1).min(height);
            vertical[y * width + x] = ((prefix[end] - prefix[start]) / (end - start) as f64) as f32;
        }
    }
    vertical
}

fn fingerprint(
    settings: &MultiscaleDetailSettingsV1,
    target_dimensions: [u32; 2],
    radii: [usize; MULTISCALE_DETAIL_BAND_COUNT],
    stage_class: DetailStageClassV1,
) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    MULTISCALE_DETAIL_IMPLEMENTATION_VERSION.hash(&mut hasher);
    target_dimensions.hash(&mut hasher);
    radii.hash(&mut hasher);
    stage_class.hash(&mut hasher);
    (settings.process as u8).hash(&mut hasher);
    settings.overall_amount.to_bits().hash(&mut hasher);
    settings.halo_suppression.to_bits().hash(&mut hasher);
    settings.ringing_suppression.to_bits().hash(&mut hasher);
    settings.shadow_noise_protection.to_bits().hash(&mut hasher);
    settings.highlight_protection.to_bits().hash(&mut hasher);
    settings.chroma_detail.to_bits().hash(&mut hasher);
    settings.reference_scale_px.to_bits().hash(&mut hasher);
    for band in settings.bands {
        band.gain.to_bits().hash(&mut hasher);
        band.threshold.to_bits().hash(&mut hasher);
        band.edge_protection.to_bits().hash(&mut hasher);
        band.noise_protection.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgb32FImage};

    fn settings(gain: f32) -> MultiscaleDetailSettingsV1 {
        MultiscaleDetailSettingsV1 {
            bands: [DetailBandSettingsV1 {
                edge_protection: 0.6,
                gain,
                noise_protection: 0.8,
                threshold: 0.015,
            }; MULTISCALE_DETAIL_BAND_COUNT],
            chroma_detail: 0.0,
            halo_suppression: 0.7,
            highlight_protection: 0.8,
            overall_amount: 1.0,
            process: DetailProcessV1::AtrousLumaV1,
            reference_scale_px: 1_024.0,
            ringing_suppression: 0.75,
            shadow_noise_protection: 0.85,
        }
    }

    fn fixture() -> DynamicImage {
        let image: Rgb32FImage = ImageBuffer::from_fn(64, 48, |x, y| {
            let edge = if x >= 32 { 0.66 } else { 0.24 };
            let texture = (((x * 17 + y * 11) % 13) as f32 - 6.0) * 0.003;
            Rgb([
                edge + texture,
                (edge + texture) * 0.8,
                (edge + texture) * 0.55,
            ])
        });
        DynamicImage::ImageRgb32F(image)
    }

    fn max_delta(left: &DynamicImage, right: &DynamicImage) -> f32 {
        left.to_rgb32f()
            .pixels()
            .zip(right.to_rgb32f().pixels())
            .flat_map(|(left, right)| left.0.into_iter().zip(right.0))
            .map(|(left, right)| (left - right).abs())
            .fold(0.0, f32::max)
    }

    fn horizontal_detail_energy(image: &DynamicImage) -> f32 {
        let image = image.to_rgb32f();
        let width = image.width() as usize;
        image
            .as_raw()
            .chunks_exact(width * 3)
            .map(|row| {
                row.chunks_exact(3)
                    .zip(row.chunks_exact(3).skip(1))
                    .map(|(left, right)| (left[0] - right[0]).abs())
                    .sum::<f32>()
            })
            .sum()
    }

    #[test]
    fn plan_serialization_is_strict_and_fingerprint_is_target_bound() {
        let settings = settings(0.5);
        let json = serde_json::to_value(&settings).unwrap();
        assert_eq!(
            serde_json::from_value::<MultiscaleDetailSettingsV1>(json).unwrap(),
            settings
        );
        assert!(
            serde_json::from_value::<MultiscaleDetailSettingsV1>(serde_json::json!({})).is_err()
        );
        let preview = MultiscaleDetailPlanV1::compile(settings.clone(), 1_024, 768).unwrap();
        let export = MultiscaleDetailPlanV1::compile(settings, 4_096, 3_072).unwrap();
        assert_eq!(preview.effective_radii_px, [1, 2, 4, 8, 16]);
        assert_eq!(export.effective_radii_px, [4, 8, 16, 32, 64]);
        assert_ne!(preview.fingerprint, export.fingerprint);
    }

    #[test]
    fn stage_receipts_prevent_capture_creative_and_output_aliasing() {
        let settings = settings(0.5);
        let capture = MultiscaleDetailPlanV1::compile_for_stage(
            settings.clone(),
            1_024,
            768,
            DetailStageClassV1::CaptureCorrection,
        )
        .unwrap();
        let creative = MultiscaleDetailPlanV1::compile(settings.clone(), 1_024, 768).unwrap();
        let output = MultiscaleDetailPlanV1::compile_for_stage(
            settings,
            1_024,
            768,
            DetailStageClassV1::OutputSharpening,
        )
        .unwrap();

        assert_eq!(creative.stage_class, DetailStageClassV1::CreativeDetail);
        assert_ne!(capture.fingerprint, creative.fingerprint);
        assert_ne!(creative.fingerprint, output.fingerprint);
        let receipt = output.receipt();
        assert_eq!(receipt.stage_class, DetailStageClassV1::OutputSharpening);
        assert_eq!(receipt.target_dimensions, [1_024, 768]);
        assert_eq!(receipt.effective_radii_px, [1, 2, 4, 8, 16]);
        assert_eq!(receipt.fingerprint, format!("{:016x}", output.fingerprint));
        assert_eq!(
            serde_json::to_value(receipt).unwrap()["stageClass"],
            "output_sharpening"
        );
    }

    #[test]
    fn output_stage_executes_on_final_target_pixels_with_target_bound_receipt() {
        let mut output_pixels = fixture();
        let before = output_pixels.clone();
        let plan = MultiscaleDetailPlanV1::compile_for_stage(
            settings(0.75),
            output_pixels.width(),
            output_pixels.height(),
            DetailStageClassV1::OutputSharpening,
        )
        .unwrap();
        apply_multiscale_detail(&mut output_pixels, &plan);

        assert!(max_delta(&before, &output_pixels) > 0.0001);
        assert_eq!(plan.receipt().target_dimensions, [64, 48]);
        assert!(
            output_pixels
                .to_rgb32f()
                .as_raw()
                .iter()
                .all(|value| value.is_finite())
        );
    }

    #[test]
    fn zero_gain_is_exact_identity_and_positive_gain_changes_real_pixels() {
        let input = fixture();
        let identity_plan = MultiscaleDetailPlanV1::compile(settings(0.0), 64, 48).unwrap();
        let mut identity = input.clone();
        apply_multiscale_detail(&mut identity, &identity_plan);
        assert_eq!(max_delta(&input, &identity), 0.0);

        let plan = MultiscaleDetailPlanV1::compile(settings(0.75), 64, 48).unwrap();
        let mut changed = input.clone();
        apply_multiscale_detail(&mut changed, &plan);
        assert!(max_delta(&input, &changed) > 0.0001);
        assert!(
            changed
                .to_rgb32f()
                .as_raw()
                .iter()
                .all(|value| value.is_finite())
        );
    }

    #[test]
    fn luminance_detail_preserves_pixel_channel_ratios() {
        let input = fixture();
        let plan = MultiscaleDetailPlanV1::compile(settings(0.8), 64, 48).unwrap();
        let mut output = input.clone();
        apply_multiscale_detail(&mut output, &plan);
        let input = input.to_rgb32f();
        let output = output.to_rgb32f();
        for (before, after) in input.pixels().zip(output.pixels()) {
            if before[0] > 1e-5 && after[0] > 1e-5 {
                assert!((before[1] / before[0] - after[1] / after[0]).abs() < 2e-5);
                assert!((before[2] / before[0] - after[2] / after[0]).abs() < 2e-5);
            }
        }
    }

    #[test]
    fn negative_band_gain_reduces_fixture_detail_energy() {
        let input = fixture();
        let plan = MultiscaleDetailPlanV1::compile(settings(-0.8), 64, 48).unwrap();
        let mut output = input.clone();
        apply_multiscale_detail(&mut output, &plan);

        assert!(horizontal_detail_energy(&output) < horizontal_detail_energy(&input));
    }

    #[test]
    fn halo_and_ringing_guards_bound_step_edge_overshoot() {
        let plan = MultiscaleDetailPlanV1::compile(settings(2.0), 64, 48).unwrap();
        let mut output = fixture();
        apply_multiscale_detail(&mut output, &plan);
        let pixels = output.to_rgb32f();
        let maximum = pixels
            .pixels()
            .map(|pixel| pixel[0])
            .fold(f32::MIN, f32::max);
        let minimum = pixels
            .pixels()
            .map(|pixel| pixel[0])
            .fold(f32::MAX, f32::min);
        assert!(maximum <= 0.72, "step overshoot {maximum}");
        assert!(minimum >= 0.18, "step undershoot {minimum}");
    }
}
