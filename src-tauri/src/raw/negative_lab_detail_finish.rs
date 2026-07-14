use image::Rgb32FImage;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

const DETAIL_FINISH_ALGORITHM_VERSION: u8 = 1;
const MIN_RADIUS: f32 = 0.0005;
const MAX_RADIUS: f32 = 0.25;

fn default_detail_finish_algorithm_version() -> u8 {
    DETAIL_FINISH_ALGORITHM_VERSION
}

fn default_detail_finish_scale_basis() -> NegativeLabDetailFinishScaleBasis {
    NegativeLabDetailFinishScaleBasis::FullResolutionShortEdgeV1
}

fn default_detail_finish_working_space() -> NegativeLabDetailFinishWorkingSpace {
    NegativeLabDetailFinishWorkingSpace::SceneLinearLuminanceV1
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NegativeLabDetailFinishScaleBasis {
    FullResolutionShortEdgeV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NegativeLabDetailFinishWorkingSpace {
    SceneLinearLuminanceV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegativeLabDetailFinishParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub local_contrast_amount: f32,
    #[serde(default = "default_local_contrast_radius")]
    pub local_contrast_radius: f32,
    #[serde(default = "default_local_contrast_clip_limit")]
    pub local_contrast_clip_limit: f32,
    #[serde(default)]
    pub sharpening_amount: f32,
    #[serde(default = "default_sharpening_radius")]
    pub sharpening_radius: f32,
    #[serde(default = "default_sharpening_threshold")]
    pub sharpening_threshold: f32,
    #[serde(default = "default_detail_finish_scale_basis")]
    pub scale_basis: NegativeLabDetailFinishScaleBasis,
    #[serde(default = "default_detail_finish_working_space")]
    pub working_space: NegativeLabDetailFinishWorkingSpace,
    #[serde(default = "default_detail_finish_algorithm_version")]
    pub algorithm_version: u8,
}

fn default_local_contrast_radius() -> f32 {
    0.02
}

fn default_local_contrast_clip_limit() -> f32 {
    0.25
}

fn default_sharpening_radius() -> f32 {
    0.005
}

fn default_sharpening_threshold() -> f32 {
    0.01
}

impl Default for NegativeLabDetailFinishParams {
    fn default() -> Self {
        Self {
            enabled: false,
            local_contrast_amount: 0.0,
            local_contrast_radius: default_local_contrast_radius(),
            local_contrast_clip_limit: default_local_contrast_clip_limit(),
            sharpening_amount: 0.0,
            sharpening_radius: default_sharpening_radius(),
            sharpening_threshold: default_sharpening_threshold(),
            scale_basis: default_detail_finish_scale_basis(),
            working_space: default_detail_finish_working_space(),
            algorithm_version: DETAIL_FINISH_ALGORITHM_VERSION,
        }
    }
}

impl NegativeLabDetailFinishParams {
    pub(crate) fn sanitized(self) -> Self {
        let defaults = Self::default();
        Self {
            enabled: self.enabled,
            local_contrast_amount: finite_or(
                self.local_contrast_amount,
                defaults.local_contrast_amount,
            )
            .clamp(0.0, 1.0),
            local_contrast_radius: finite_or(
                self.local_contrast_radius,
                defaults.local_contrast_radius,
            )
            .clamp(MIN_RADIUS, MAX_RADIUS),
            local_contrast_clip_limit: finite_or(
                self.local_contrast_clip_limit,
                defaults.local_contrast_clip_limit,
            )
            .clamp(0.0, 1.0),
            sharpening_amount: finite_or(self.sharpening_amount, defaults.sharpening_amount)
                .clamp(0.0, 1.0),
            sharpening_radius: finite_or(self.sharpening_radius, defaults.sharpening_radius)
                .clamp(MIN_RADIUS, MAX_RADIUS),
            sharpening_threshold: finite_or(
                self.sharpening_threshold,
                defaults.sharpening_threshold,
            )
            .clamp(0.0, 1.0),
            scale_basis: defaults.scale_basis,
            working_space: defaults.working_space,
            algorithm_version: DETAIL_FINISH_ALGORITHM_VERSION,
        }
    }
}

fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegativeLabDetailFinishMetrics {
    pub changed_pixel_ratio: f32,
    pub chroma_drift_max: f32,
    pub edge_overshoot: f32,
    pub edge_undershoot: f32,
    pub effective_local_contrast_radius: f32,
    pub effective_sharpening_radius: f32,
}

fn luminance(pixel: &[f32]) -> f32 {
    0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]
}

fn box_blur(values: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    if radius == 0 || values.is_empty() {
        return values.to_vec();
    }
    let horizontal: Vec<f32> = (0..height)
        .into_par_iter()
        .flat_map_iter(|y| {
            let row = &values[y * width..(y + 1) * width];
            (0..width).map(move |x| {
                let start = x.saturating_sub(radius);
                let end = (x + radius + 1).min(width);
                row[start..end].iter().sum::<f32>() / (end - start) as f32
            })
        })
        .collect();
    let mut vertical = vec![0.0; width * height];
    vertical
        .par_iter_mut()
        .enumerate()
        .for_each(|(index, output)| {
            let y = index / width;
            let x = index % width;
            let start = y.saturating_sub(radius);
            let end = (y + radius + 1).min(height);
            *output = (start..end)
                .map(|row| horizontal[row * width + x])
                .sum::<f32>()
                / (end - start) as f32;
        });
    vertical
}

pub(crate) fn apply_negative_lab_detail_finish(
    image: &mut Rgb32FImage,
    requested: &NegativeLabDetailFinishParams,
) -> NegativeLabDetailFinishMetrics {
    let params = requested.sanitized();
    if !params.enabled || (params.local_contrast_amount == 0.0 && params.sharpening_amount == 0.0) {
        return NegativeLabDetailFinishMetrics::default();
    }
    let (width, height) = image.dimensions();
    let width = width as usize;
    let height = height as usize;
    let short_edge = width.min(height).max(1) as f32;
    let local_radius = ((params.local_contrast_radius * short_edge).round() as usize).max(1);
    let sharpening_radius = ((params.sharpening_radius * short_edge).round() as usize).max(1);
    let input = image.as_raw().clone();
    let source_luma: Vec<f32> = input.par_chunks_exact(3).map(luminance).collect();
    let local_blur = box_blur(&source_luma, width, height, local_radius);
    let sharpening_blur = box_blur(&source_luma, width, height, sharpening_radius);
    let mut output = input.clone();
    let mut changed = 0usize;
    let mut chroma_drift_max = 0.0f32;
    let mut edge_overshoot = 0.0f32;
    let mut edge_undershoot = 0.0f32;
    for (index, pixel) in output.chunks_exact_mut(3).enumerate() {
        let luma = source_luma[index];
        let local_detail = luma - local_blur[index];
        let local_limit = params.local_contrast_clip_limit * luma.abs().max(1.0);
        let local_delta =
            (local_detail * params.local_contrast_amount).clamp(-local_limit, local_limit);
        let sharpen_detail = luma - sharpening_blur[index];
        let sharpen_delta = if sharpen_detail.abs() >= params.sharpening_threshold {
            sharpen_detail * params.sharpening_amount
        } else {
            0.0
        };
        let mut target_luma = (luma + local_delta + sharpen_delta).clamp(0.0, 1.0);
        if luma > 1.0e-5 {
            let maximum_source_ratio = (pixel[0] / luma).max(pixel[1] / luma).max(pixel[2] / luma);
            if maximum_source_ratio > 1.0e-5 {
                target_luma = target_luma.min(1.0 / maximum_source_ratio);
            }
        }
        let delta = target_luma - luma;
        if delta.abs() > 1.0e-7 {
            changed += 1;
        }
        edge_overshoot = edge_overshoot.max((target_luma - luma).max(0.0));
        edge_undershoot = edge_undershoot.max((luma - target_luma).max(0.0));
        if luma > 1.0e-5 {
            let ratio = target_luma / luma;
            for channel in pixel.iter_mut() {
                *channel = (*channel * ratio).clamp(0.0, 1.0);
            }
        } else {
            for channel in pixel.iter_mut() {
                *channel = (*channel + delta).clamp(0.0, 1.0);
            }
        }
        let new_luma = luminance(pixel);
        if luma > 1.0e-5 && new_luma > 1.0e-5 {
            let source_ratios = [
                input[index * 3] / luma,
                input[index * 3 + 1] / luma,
                input[index * 3 + 2] / luma,
            ];
            let output_ratios = [
                pixel[0] / new_luma,
                pixel[1] / new_luma,
                pixel[2] / new_luma,
            ];
            chroma_drift_max = chroma_drift_max.max(
                (output_ratios[0] - source_ratios[0])
                    .abs()
                    .max((output_ratios[1] - source_ratios[1]).abs())
                    .max((output_ratios[2] - source_ratios[2]).abs()),
            );
        }
    }
    *image = Rgb32FImage::from_vec(width as u32, height as u32, output)
        .expect("detail finish output dimensions match source");
    NegativeLabDetailFinishMetrics {
        changed_pixel_ratio: changed as f32 / source_luma.len().max(1) as f32,
        chroma_drift_max,
        edge_overshoot,
        edge_undershoot,
        effective_local_contrast_radius: local_radius as f32 / short_edge,
        effective_sharpening_radius: sharpening_radius as f32 / short_edge,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Rgb32FImage {
        Rgb32FImage::from_fn(9, 9, |x, y| {
            let value = if x == 4 || y == 4 { 0.8 } else { 0.2 };
            image::Rgb([value, value * 0.8, value * 0.6])
        })
    }

    #[test]
    fn disabled_detail_finish_is_exact_identity() {
        let mut image = fixture();
        let before = image.clone();
        let metrics = apply_negative_lab_detail_finish(&mut image, &Default::default());
        assert_eq!(image.as_raw(), before.as_raw());
        assert_eq!(metrics, NegativeLabDetailFinishMetrics::default());
    }

    #[test]
    fn finish_changes_luminance_without_material_chroma_drift() {
        let mut image = fixture();
        let metrics = apply_negative_lab_detail_finish(
            &mut image,
            &NegativeLabDetailFinishParams {
                enabled: true,
                local_contrast_amount: 0.45,
                sharpening_amount: 0.65,
                ..Default::default()
            },
        );
        assert!(metrics.changed_pixel_ratio > 0.0);
        assert!(metrics.changed_pixel_ratio < 1.0);
        assert!(metrics.chroma_drift_max < 1.0e-4);
        assert!(metrics.edge_overshoot <= 1.0);
        assert!(metrics.edge_undershoot <= 1.0);
    }

    #[test]
    fn threshold_blocks_fine_noise() {
        let mut image = Rgb32FImage::from_fn(7, 7, |x, y| {
            let value = 0.5 + if (x + y) % 2 == 0 { 0.002 } else { -0.002 };
            image::Rgb([value, value, value])
        });
        let before = image.clone();
        let metrics = apply_negative_lab_detail_finish(
            &mut image,
            &NegativeLabDetailFinishParams {
                enabled: true,
                sharpening_amount: 1.0,
                sharpening_threshold: 0.1,
                ..Default::default()
            },
        );
        assert_eq!(image.as_raw(), before.as_raw());
        assert_eq!(metrics.changed_pixel_ratio, 0.0);
    }
}
