use image::Rgb32FImage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const ALGORITHM_ID: &str = "negative_lab_optical_finish_v1";
const OPERATION_ID: &str = "negative_lab.optical_finish";

fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

fn default_radius() -> f32 {
    0.02
}
fn default_threshold() -> f32 {
    0.35
}
fn default_red_weight() -> f32 {
    0.75
}
fn default_orange_weight() -> f32 {
    0.35
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NegativeLabOpticalFinishScaleBasis {
    #[default]
    FullResolutionShortEdgeV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NegativeLabOpticalFinishWorkingSpace {
    #[default]
    SceneLinearSrgbD65V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegativeLabOpticalFinishParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub glow_amount: f32,
    #[serde(default = "default_radius")]
    pub glow_radius: f32,
    #[serde(default = "default_threshold")]
    pub glow_threshold: f32,
    #[serde(default)]
    pub halation_amount: f32,
    #[serde(default = "default_radius")]
    pub halation_radius: f32,
    #[serde(default = "default_threshold")]
    pub halation_threshold: f32,
    #[serde(default = "default_red_weight")]
    pub red_weight: f32,
    #[serde(default = "default_orange_weight")]
    pub orange_weight: f32,
    #[serde(default)]
    pub scale_basis: NegativeLabOpticalFinishScaleBasis,
    #[serde(default)]
    pub working_space: NegativeLabOpticalFinishWorkingSpace,
    #[serde(default = "default_algorithm_version")]
    pub algorithm_version: u8,
}

fn default_algorithm_version() -> u8 {
    1
}

impl Default for NegativeLabOpticalFinishParams {
    fn default() -> Self {
        Self {
            enabled: false,
            glow_amount: 0.0,
            glow_radius: default_radius(),
            glow_threshold: default_threshold(),
            halation_amount: 0.0,
            halation_radius: default_radius(),
            halation_threshold: default_threshold(),
            red_weight: default_red_weight(),
            orange_weight: default_orange_weight(),
            scale_basis: NegativeLabOpticalFinishScaleBasis::FullResolutionShortEdgeV1,
            working_space: NegativeLabOpticalFinishWorkingSpace::SceneLinearSrgbD65V1,
            algorithm_version: 1,
        }
    }
}

impl NegativeLabOpticalFinishParams {
    pub(crate) fn sanitized(self) -> Self {
        let defaults = Self::default();
        Self {
            enabled: self.enabled,
            glow_amount: finite_or(self.glow_amount, 0.0).clamp(0.0, 1.0),
            glow_radius: finite_or(self.glow_radius, defaults.glow_radius).clamp(0.0005, 0.25),
            glow_threshold: finite_or(self.glow_threshold, defaults.glow_threshold).clamp(0.0, 1.0),
            halation_amount: finite_or(self.halation_amount, 0.0).clamp(0.0, 1.0),
            halation_radius: finite_or(self.halation_radius, defaults.halation_radius)
                .clamp(0.0005, 0.25),
            halation_threshold: finite_or(self.halation_threshold, defaults.halation_threshold)
                .clamp(0.0, 1.0),
            red_weight: finite_or(self.red_weight, defaults.red_weight).clamp(0.0, 1.0),
            orange_weight: finite_or(self.orange_weight, defaults.orange_weight).clamp(0.0, 1.0),
            scale_basis: NegativeLabOpticalFinishScaleBasis::FullResolutionShortEdgeV1,
            working_space: NegativeLabOpticalFinishWorkingSpace::SceneLinearSrgbD65V1,
            algorithm_version: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegativeLabOpticalFinishMetrics {
    pub operation_id: String,
    pub algorithm_id: String,
    pub algorithm_version: u8,
    pub effective_glow_radius_pixels: u32,
    pub effective_halation_radius_pixels: u32,
    pub changed_pixel_ratio: f32,
    pub pre_policy_overshoot: f32,
    pub gamut_clipped_pixel_count: u32,
    pub localized_mask_ratio: f32,
    pub before_hash: String,
    pub after_hash: String,
    pub warning_codes: Vec<String>,
}

pub(crate) struct NegativeLabOpticalFinishResult {
    pub image: Rgb32FImage,
    pub metrics: NegativeLabOpticalFinishMetrics,
}

fn hash_pixels(image: &Rgb32FImage) -> String {
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(bytemuck::cast_slice(image.as_raw())))
    )
}

fn luminance(pixel: &[f32; 3]) -> f32 {
    0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]
}

fn box_blur(values: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    if radius == 0 {
        return values.to_vec();
    }
    let mut horizontal = vec![0.0; values.len()];
    for y in 0..height {
        for x in 0..width {
            let start = x.saturating_sub(radius);
            let end = (x + radius + 1).min(width);
            horizontal[y * width + x] = values[y * width + start..y * width + end]
                .iter()
                .sum::<f32>()
                / (end - start) as f32;
        }
    }
    let mut output = vec![0.0; values.len()];
    for y in 0..height {
        for x in 0..width {
            let start = y.saturating_sub(radius);
            let end = (y + radius + 1).min(height);
            output[y * width + x] = (start..end)
                .map(|row| horizontal[row * width + x])
                .sum::<f32>()
                / (end - start) as f32;
        }
    }
    output
}

pub(crate) fn apply_negative_lab_optical_finish(
    input: &Rgb32FImage,
    requested: &NegativeLabOpticalFinishParams,
    applicable: bool,
) -> NegativeLabOpticalFinishResult {
    let params = requested.sanitized();
    let before_hash = hash_pixels(input);
    let (width, height) = input.dimensions();
    let pixel_count = (width * height).max(1) as usize;
    let glow_radius =
        ((params.glow_radius * width.min(height).max(1) as f32).round() as usize).max(1);
    let halation_radius =
        ((params.halation_radius * width.min(height).max(1) as f32).round() as usize).max(1);
    let active =
        params.enabled && applicable && (params.glow_amount > 0.0 || params.halation_amount > 0.0);
    let mut output = input.clone();
    let mut warnings = Vec::new();
    if params.enabled && !applicable {
        warnings.push("inapplicable_mode_identity".to_string());
    }
    if !active {
        return NegativeLabOpticalFinishResult {
            image: output,
            metrics: NegativeLabOpticalFinishMetrics {
                operation_id: OPERATION_ID.to_string(),
                algorithm_id: ALGORITHM_ID.to_string(),
                algorithm_version: 1,
                effective_glow_radius_pixels: 0,
                effective_halation_radius_pixels: 0,
                changed_pixel_ratio: 0.0,
                pre_policy_overshoot: 0.0,
                gamut_clipped_pixel_count: 0,
                localized_mask_ratio: 0.0,
                before_hash: before_hash.clone(),
                after_hash: before_hash,
                warning_codes: warnings,
            },
        };
    }
    let source: Vec<[f32; 3]> = input.pixels().map(|pixel| pixel.0).collect();
    let luma: Vec<f32> = source.iter().map(luminance).collect();
    let glow_blur = box_blur(&luma, width as usize, height as usize, glow_radius);
    let edge_blur = box_blur(&luma, width as usize, height as usize, halation_radius);
    let mut changed = 0usize;
    let mut localized = 0usize;
    let mut overshoot = 0.0f32;
    let mut clipped = 0u32;
    for (index, pixel) in output.pixels_mut().enumerate() {
        let glow = (glow_blur[index] - params.glow_threshold).max(0.0) * params.glow_amount;
        let edge = (luma[index] - edge_blur[index] - params.halation_threshold * 0.25).max(0.0);
        let halation = edge * params.halation_amount;
        if glow > 1.0e-6 || halation > 1.0e-6 {
            localized += 1;
        }
        let additions = [
            glow + halation * params.red_weight,
            glow + halation * params.orange_weight,
            glow,
        ];
        let mut next = [0.0; 3];
        for channel in 0..3 {
            let raw = pixel.0[channel] + additions[channel];
            overshoot = overshoot.max((raw - 1.0).max(0.0));
            if !(0.0..=1.0).contains(&raw) {
                clipped += 1;
            }
            next[channel] = raw.clamp(0.0, 1.0);
        }
        if next
            .iter()
            .zip(pixel.0)
            .any(|(left, right)| (*left - right).abs() > 1.0e-6)
        {
            changed += 1;
        }
        pixel.0 = next;
    }
    let after_hash = hash_pixels(&output);
    NegativeLabOpticalFinishResult {
        image: output,
        metrics: NegativeLabOpticalFinishMetrics {
            operation_id: OPERATION_ID.to_string(),
            algorithm_id: ALGORITHM_ID.to_string(),
            algorithm_version: 1,
            effective_glow_radius_pixels: glow_radius as u32,
            effective_halation_radius_pixels: halation_radius as u32,
            changed_pixel_ratio: changed as f32 / pixel_count as f32,
            pre_policy_overshoot: overshoot,
            gamut_clipped_pixel_count: clipped,
            localized_mask_ratio: localized as f32 / pixel_count as f32,
            before_hash,
            after_hash,
            warning_codes: warnings,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn disabled_is_exact_identity() {
        let input = Rgb32FImage::from_fn(5, 5, |x, y| Rgb([x as f32 / 5.0, y as f32 / 5.0, 0.2]));
        let result = apply_negative_lab_optical_finish(
            &input,
            &NegativeLabOpticalFinishParams::default(),
            true,
        );
        assert_eq!(result.image.as_raw(), input.as_raw());
        assert_eq!(result.metrics.before_hash, result.metrics.after_hash);
        assert_eq!(result.metrics.changed_pixel_ratio, 0.0);
    }

    #[test]
    fn glow_and_halation_are_localized_and_distinct() {
        let input = Rgb32FImage::from_fn(9, 9, |x, y| {
            if x == 4 && y == 4 {
                Rgb([1.0, 0.9, 0.8])
            } else {
                Rgb([0.05, 0.05, 0.05])
            }
        });
        let glow = apply_negative_lab_optical_finish(
            &input,
            &NegativeLabOpticalFinishParams {
                enabled: true,
                glow_amount: 0.4,
                glow_threshold: 0.05,
                ..Default::default()
            },
            true,
        );
        let halation = apply_negative_lab_optical_finish(
            &input,
            &NegativeLabOpticalFinishParams {
                enabled: true,
                halation_amount: 0.4,
                halation_threshold: 0.05,
                ..Default::default()
            },
            true,
        );
        assert!(glow.metrics.changed_pixel_ratio > 0.0);
        assert!(halation.metrics.changed_pixel_ratio > 0.0);
        assert_ne!(glow.metrics.after_hash, halation.metrics.after_hash);
        assert!(halation.image.get_pixel(4, 4).0[0] >= halation.image.get_pixel(4, 4).0[2]);
    }

    #[test]
    fn inapplicable_mode_is_identity_with_warning() {
        let input = Rgb32FImage::from_pixel(3, 3, Rgb([0.4, 0.3, 0.2]));
        let result = apply_negative_lab_optical_finish(
            &input,
            &NegativeLabOpticalFinishParams {
                enabled: true,
                glow_amount: 0.4,
                ..Default::default()
            },
            false,
        );
        assert_eq!(result.image.as_raw(), input.as_raw());
        assert_eq!(
            result.metrics.warning_codes,
            vec!["inapplicable_mode_identity"]
        );
        assert_eq!(result.metrics.before_hash, result.metrics.after_hash);
    }
}
