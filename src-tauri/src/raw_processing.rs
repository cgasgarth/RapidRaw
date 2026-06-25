use crate::image_processing::apply_orientation;
use anyhow::{Result, anyhow};
use image::{DynamicImage, ImageBuffer, Rgba};
use rawler::imgop::xyz::Illuminant;
use rawler::{
    decoders::{Orientation, RawDecodeParams},
    imgop::develop::{DemosaicAlgorithm, Intermediate, ProcessingStep, RawDevelop},
    pixarray::Color2D,
    rawimage::{RawImage, RawImageData, RawPhotometricInterpretation},
    rawsource::RawSource,
};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

const CAMERA_PROFILE_RESOLVER_ALGORITHM_ID: &str = "dual_illuminant_mired_v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawProcessingProfile {
    Fast,
    Balanced,
    Maximum,
}

impl RawProcessingProfile {
    pub fn from_mode(mode: &str) -> Self {
        match mode {
            "fast" => Self::Fast,
            "maximum" => Self::Maximum,
            _ => Self::Balanced,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RawDemosaicPath {
    BayerHq,
    Fast,
    LinearBypass,
    Standard,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawCameraProfileReport {
    pub algorithm_id: &'static str,
    pub candidate_count: usize,
    pub cool_illuminant: Option<String>,
    pub cool_weight: Option<f32>,
    pub estimated_cct_kelvin: Option<f32>,
    pub fallback_reason: Option<&'static str>,
    pub matrix_hash: Option<String>,
    pub status: &'static str,
    pub warm_illuminant: Option<String>,
    pub warning_codes: Vec<&'static str>,
}

impl RawCameraProfileReport {
    fn unavailable(reason: &'static str, candidate_count: usize) -> Self {
        Self {
            algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
            candidate_count,
            cool_illuminant: None,
            cool_weight: None,
            estimated_cct_kelvin: None,
            fallback_reason: Some(reason),
            matrix_hash: None,
            status: "unavailable",
            warm_illuminant: None,
            warning_codes: vec![reason],
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawDevelopmentReport {
    pub demosaic_path: RawDemosaicPath,
    pub camera_profile: RawCameraProfileReport,
}

pub(crate) fn develop_raw_image_with_report(
    file_bytes: &[u8],
    fast_demosaic: bool,
    profile: RawProcessingProfile,
    highlight_compression: f32,
    linear_mode: String,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<(DynamicImage, RawDevelopmentReport)> {
    let (developed_image, orientation, report) = develop_internal_with_options(
        file_bytes,
        fast_demosaic,
        profile,
        highlight_compression,
        linear_mode,
        cancel_token,
        RawDefectDevelopmentOptions::default(),
    )?;
    Ok((apply_orientation(developed_image, orientation), report))
}

#[derive(Debug, Clone, Copy)]
struct RawDefectDevelopmentOptions {
    #[cfg(test)]
    inject_test_defects: bool,
    repair_sensor_defects: bool,
}

impl Default for RawDefectDevelopmentOptions {
    fn default() -> Self {
        Self {
            #[cfg(test)]
            inject_test_defects: false,
            repair_sensor_defects: true,
        }
    }
}

fn is_linear_raw_format(raw_image: &RawImage) -> bool {
    matches!(
        raw_image.photometric,
        RawPhotometricInterpretation::LinearRaw
    )
}

fn is_rgb_bayer_raw(raw_image: &RawImage) -> bool {
    matches!(
        &raw_image.photometric,
        RawPhotometricInterpretation::Cfa(config)
            if raw_image.cpp == 1
                && config.cfa.is_rgb()
                && !(config.cfa.width == 6 && config.cfa.height == 6)
    )
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct RawDefectCorrectionReport {
    hot_pixels: usize,
    dead_pixels: usize,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct HighlightReconstructionReport {
    candidate_pixels: usize,
    reconstructed_channels: usize,
    reconstructed_pixels: usize,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct BayerHqDevelopmentReport {
    artifact_suppression: crate::bayer_hq::ArtifactSuppressionReport,
}

#[derive(Debug, Clone, Copy)]
struct RawDefectImageBounds {
    active_bounds: (usize, usize, usize, usize),
    cfa_height: usize,
    cfa_width: usize,
    height: usize,
    width: usize,
}

#[derive(Debug, Clone)]
struct RawDefectCorrectionContext {
    bounds: RawDefectImageBounds,
    black_cpp: usize,
    black_height: usize,
    black_levels: Vec<f32>,
    black_width: usize,
    cfa_colors: Vec<usize>,
    white_levels: Vec<f32>,
}

impl RawDefectCorrectionContext {
    fn black_level_at(&self, x: usize, y: usize) -> f32 {
        if self.black_levels.is_empty() || self.black_width == 0 || self.black_height == 0 {
            return 0.0;
        }

        let cpp = self.black_cpp.max(1);
        let index = ((y % self.black_height) * self.black_width + (x % self.black_width)) * cpp;
        self.black_levels
            .get(index)
            .copied()
            .or_else(|| self.black_levels.first().copied())
            .unwrap_or(0.0)
    }

    fn white_level_at(&self, x: usize, y: usize) -> f32 {
        if self.white_levels.is_empty() {
            return u16::MAX as f32;
        }

        if self.white_levels.len() == 1 || self.cfa_colors.is_empty() {
            return self.white_levels[0];
        }

        let cfa_index =
            (y % self.bounds.cfa_height) * self.bounds.cfa_width + (x % self.bounds.cfa_width);
        let color_index = self.cfa_colors.get(cfa_index).copied().unwrap_or(0);
        self.white_levels
            .get(color_index)
            .copied()
            .or_else(|| self.white_levels.first().copied())
            .unwrap_or(u16::MAX as f32)
    }
}

fn active_bounds(raw_image: &RawImage) -> (usize, usize, usize, usize) {
    raw_image
        .active_area
        .map(|area| {
            (
                area.p.x.min(raw_image.width),
                area.p.y.min(raw_image.height),
                (area.p.x + area.d.w).min(raw_image.width),
                (area.p.y + area.d.h).min(raw_image.height),
            )
        })
        .unwrap_or((0, 0, raw_image.width, raw_image.height))
}

fn median_u16(values: &mut [u16]) -> u16 {
    values.sort_unstable();
    values[values.len() / 2]
}

fn same_cfa_neighbor_values(
    pixels: &[u16],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    cfa_width: usize,
    cfa_height: usize,
) -> Vec<u16> {
    let mut values = Vec::with_capacity(8);
    let x = x as isize;
    let y = y as isize;
    let cfa_width = cfa_width.max(1) as isize;
    let cfa_height = cfa_height.max(1) as isize;

    for dy in [-cfa_height, 0, cfa_height] {
        for dx in [-cfa_width, 0, cfa_width] {
            if dx == 0 && dy == 0 {
                continue;
            }

            let nx = x + dx;
            let ny = y + dy;
            if nx >= 0 && ny >= 0 && (nx as usize) < width && (ny as usize) < height {
                values.push(pixels[ny as usize * width + nx as usize]);
            }
        }
    }

    values
}

fn has_neighbor_highlight_structure(
    pixels: &[u16],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    highlight_floor: u16,
) -> bool {
    let x = x as isize;
    let y = y as isize;

    for dy in -1..=1 {
        for dx in -1..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }

            let nx = x + dx;
            let ny = y + dy;
            if nx >= 0
                && ny >= 0
                && (nx as usize) < width
                && (ny as usize) < height
                && pixels[ny as usize * width + nx as usize] >= highlight_floor
            {
                return true;
            }
        }
    }

    false
}

fn repair_integer_cfa_defects(
    pixels: &mut [u16],
    context: RawDefectCorrectionContext,
) -> RawDefectCorrectionReport {
    let RawDefectImageBounds {
        active_bounds,
        cfa_height,
        cfa_width,
        height,
        width,
    } = context.bounds;

    if width == 0
        || height == 0
        || pixels.len() != width * height
        || cfa_width == 0
        || cfa_height == 0
    {
        return RawDefectCorrectionReport::default();
    }

    let (left, top, right, bottom) = active_bounds;
    let left = left.saturating_add(cfa_width);
    let top = top.saturating_add(cfa_height);
    let right = right.saturating_sub(cfa_width).min(width);
    let bottom = bottom.saturating_sub(cfa_height).min(height);
    if left >= right || top >= bottom {
        return RawDefectCorrectionReport::default();
    }

    let original = pixels.to_vec();
    let mut replacements = Vec::new();
    let mut report = RawDefectCorrectionReport::default();

    for y in top..bottom {
        for x in left..right {
            let index = y * width + x;
            let value = original[index] as f32;
            let mut neighbors =
                same_cfa_neighbor_values(&original, width, height, x, y, cfa_width, cfa_height);
            if neighbors.len() < 4 {
                continue;
            }

            let black = context.black_level_at(x, y).clamp(0.0, u16::MAX as f32);
            let white = context
                .white_level_at(x, y)
                .clamp(black + 1.0, u16::MAX as f32);
            let range = (white - black).max(1.0);
            let outlier_delta = (range * 0.18).max(1024.0);
            let hot_floor = black + range * 0.70;
            let dead_ceiling = black + range * 0.06;
            let useful_signal_floor = black + range * 0.12;
            let highlight_structure_floor =
                (black + range * 0.55).clamp(0.0, u16::MAX as f32) as u16;

            let median = median_u16(&mut neighbors) as f32;
            let hot_isolated = value >= hot_floor
                && value > median + outlier_delta
                && !has_neighbor_highlight_structure(
                    &original,
                    width,
                    height,
                    x,
                    y,
                    highlight_structure_floor,
                );
            let dead_isolated = median >= useful_signal_floor
                && value <= dead_ceiling
                && median > value + outlier_delta;

            if hot_isolated || dead_isolated {
                replacements.push((
                    index,
                    median.clamp(0.0, u16::MAX as f32) as u16,
                    hot_isolated,
                ));
            }
        }
    }

    for (index, replacement, was_hot) in replacements {
        pixels[index] = replacement;
        if was_hot {
            report.hot_pixels += 1;
        } else {
            report.dead_pixels += 1;
        }
    }

    report
}

fn repair_raw_sensor_defects(
    raw_image: &mut RawImage,
    _original_black_level: f32,
    _original_white_level: f32,
) -> RawDefectCorrectionReport {
    let RawPhotometricInterpretation::Cfa(config) = &raw_image.photometric else {
        return RawDefectCorrectionReport::default();
    };

    if raw_image.cpp != 1 {
        return RawDefectCorrectionReport::default();
    }

    let width = raw_image.width;
    let height = raw_image.height;
    let active = active_bounds(raw_image);
    let cfa_width = config.cfa.width;
    let cfa_height = config.cfa.height;
    let cfa_colors = (0..cfa_height)
        .flat_map(|row| (0..cfa_width).map(move |col| config.cfa.color_at(row, col)))
        .collect();
    let black_levels = raw_image
        .blacklevel
        .levels
        .iter()
        .map(|level| level.as_f32())
        .collect();
    let white_levels = raw_image
        .whitelevel
        .0
        .iter()
        .map(|level| *level as f32)
        .collect();

    match &mut raw_image.data {
        RawImageData::Integer(pixels) => repair_integer_cfa_defects(
            pixels,
            RawDefectCorrectionContext {
                bounds: RawDefectImageBounds {
                    active_bounds: active,
                    cfa_height,
                    cfa_width,
                    height,
                    width,
                },
                black_cpp: raw_image.blacklevel.cpp,
                black_height: raw_image.blacklevel.height,
                black_levels,
                black_width: raw_image.blacklevel.width,
                cfa_colors,
                white_levels,
            },
        ),
        RawImageData::Float(_) => RawDefectCorrectionReport::default(),
    }
}

fn saturation_threshold(context: &RawDefectCorrectionContext, x: usize, y: usize) -> f32 {
    let black = context.black_level_at(x, y).clamp(0.0, u16::MAX as f32);
    let white = context
        .white_level_at(x, y)
        .clamp(black + 1.0, u16::MAX as f32);
    let range = (white - black).max(1.0);
    white - 2.0_f32.max(range * 0.005)
}

fn same_cfa_unclipped_neighbor_signals(
    pixels: &[u16],
    context: &RawDefectCorrectionContext,
    x: usize,
    y: usize,
    radius: isize,
) -> Vec<u16> {
    let RawDefectImageBounds {
        cfa_height,
        cfa_width,
        height,
        width,
        ..
    } = context.bounds;
    let mut values = Vec::with_capacity(((radius * 2 + 1).pow(2) - 1).max(0) as usize);
    let x = x as isize;
    let y = y as isize;
    let cfa_width = cfa_width.max(1) as isize;
    let cfa_height = cfa_height.max(1) as isize;

    for row in -radius..=radius {
        for col in -radius..=radius {
            if row == 0 && col == 0 {
                continue;
            }

            let nx = x + col * cfa_width;
            let ny = y + row * cfa_height;
            if nx < 0 || ny < 0 || nx as usize >= width || ny as usize >= height {
                continue;
            }

            let nx = nx as usize;
            let ny = ny as usize;
            let value = pixels[ny * width + nx];
            if (value as f32) < saturation_threshold(context, nx, ny) {
                values.push(value);
            }
        }
    }

    values
}

fn reconstruct_integer_cfa_highlights(
    pixels: &mut [u16],
    context: RawDefectCorrectionContext,
) -> HighlightReconstructionReport {
    let RawDefectImageBounds {
        active_bounds,
        cfa_height,
        cfa_width,
        height,
        width,
    } = context.bounds;

    if width == 0
        || height == 0
        || pixels.len() != width * height
        || cfa_width == 0
        || cfa_height == 0
        || context.white_levels.is_empty()
    {
        return HighlightReconstructionReport::default();
    }

    let (left, top, right, bottom) = active_bounds;
    let left = left.saturating_add(cfa_width * 2);
    let top = top.saturating_add(cfa_height * 2);
    let right = right.saturating_sub(cfa_width * 2).min(width);
    let bottom = bottom.saturating_sub(cfa_height * 2).min(height);
    if left >= right || top >= bottom {
        return HighlightReconstructionReport::default();
    }

    let original = pixels.to_vec();
    let mut replacements = Vec::new();
    let mut report = HighlightReconstructionReport::default();

    for y in top..bottom {
        for x in left..right {
            let index = y * width + x;
            let value = original[index] as f32;
            let black = context.black_level_at(x, y).clamp(0.0, u16::MAX as f32);
            let white = context
                .white_level_at(x, y)
                .clamp(black + 1.0, u16::MAX as f32);
            let range = (white - black).max(1.0);
            if value < saturation_threshold(&context, x, y) {
                continue;
            }

            report.candidate_pixels += 1;
            let mut samples = same_cfa_unclipped_neighbor_signals(&original, &context, x, y, 2);
            if samples.len() < 4 {
                samples = same_cfa_unclipped_neighbor_signals(&original, &context, x, y, 4);
            }
            if samples.len() < 6 {
                continue;
            }

            let median = median_u16(&mut samples) as f32;
            let median_signal = (median - black).max(0.0);
            if median_signal < range * 0.65 {
                continue;
            }

            let headroom = (white - median).max(range * 0.02);
            let estimate = (white + headroom * 0.25).clamp(white + 1.0, black + range * 1.15);
            if estimate.is_finite() && estimate > value && estimate <= u16::MAX as f32 {
                replacements.push((index, estimate.round() as u16));
            }
        }
    }

    for (index, replacement) in replacements {
        pixels[index] = replacement;
        report.reconstructed_pixels += 1;
        report.reconstructed_channels += 1;
    }

    report
}

fn reconstruct_raw_sensor_highlights(raw_image: &mut RawImage) -> HighlightReconstructionReport {
    let RawPhotometricInterpretation::Cfa(config) = &raw_image.photometric else {
        return HighlightReconstructionReport::default();
    };

    if raw_image.cpp != 1
        || !config.cfa.is_rgb()
        || (config.cfa.width == 6 && config.cfa.height == 6)
    {
        return HighlightReconstructionReport::default();
    }

    let width = raw_image.width;
    let height = raw_image.height;
    let active = active_bounds(raw_image);
    let cfa_width = config.cfa.width;
    let cfa_height = config.cfa.height;
    let cfa_colors = (0..cfa_height)
        .flat_map(|row| (0..cfa_width).map(move |col| config.cfa.color_at(row, col)))
        .collect();
    let black_levels = raw_image
        .blacklevel
        .levels
        .iter()
        .map(|level| level.as_f32())
        .collect();
    let white_levels = raw_image
        .whitelevel
        .0
        .iter()
        .map(|level| *level as f32)
        .collect();

    match &mut raw_image.data {
        RawImageData::Integer(pixels) => reconstruct_integer_cfa_highlights(
            pixels,
            RawDefectCorrectionContext {
                bounds: RawDefectImageBounds {
                    active_bounds: active,
                    cfa_height,
                    cfa_width,
                    height,
                    width,
                },
                black_cpp: raw_image.blacklevel.cpp,
                black_height: raw_image.blacklevel.height,
                black_levels,
                black_width: raw_image.blacklevel.width,
                cfa_colors,
                white_levels,
            },
        ),
        RawImageData::Float(_) => HighlightReconstructionReport::default(),
    }
}

fn multiply_4x3_3x3(a: &[[f32; 3]; 4], b: &[[f32; 3]; 3]) -> [[f32; 3]; 4] {
    let mut result = [[0.0; 3]; 4];
    for i in 0..4 {
        for j in 0..3 {
            for (k, row) in b.iter().enumerate().take(3) {
                result[i][j] += a[i][k] * row[j];
            }
        }
    }
    result
}

fn normalize_4x3(matrix: [[f32; 3]; 4]) -> [[f32; 3]; 4] {
    let mut result = [[0.0; 3]; 4];
    for row in 0..4 {
        let sum: f32 = matrix[row].iter().sum();
        if sum.abs() > f32::EPSILON {
            for col in 0..3 {
                result[row][col] = matrix[row][col] / sum;
            }
        }
    }
    result
}

fn illuminant_cct_kelvin(illuminant: Illuminant) -> Option<f32> {
    match illuminant {
        Illuminant::A | Illuminant::Tungsten | Illuminant::IsoStudioTungsten => Some(2_856.0),
        Illuminant::D50 => Some(5_003.0),
        Illuminant::D55 => Some(5_503.0),
        Illuminant::Daylight | Illuminant::FineWeather | Illuminant::Flash | Illuminant::D65 => {
            Some(6_504.0)
        }
        Illuminant::CloudyWeather | Illuminant::D75 => Some(7_504.0),
        Illuminant::Shade => Some(8_000.0),
        _ => None,
    }
}

fn valid_color_matrix(matrix: &[f32]) -> bool {
    !matrix.is_empty()
        && matrix.len().is_multiple_of(3)
        && matrix.iter().all(|value| value.is_finite())
}

fn estimate_scene_cct_from_wb(wb: [f32; 4]) -> Option<f32> {
    let [red, _green, blue, _extra] = wb;
    if !red.is_finite() || !blue.is_finite() || red <= f32::EPSILON || blue <= f32::EPSILON {
        return None;
    }

    let blue_to_red = (blue / red).clamp(0.44, 2.28);
    Some((6_504.0 / blue_to_red).clamp(2_856.0, 8_000.0))
}

fn interpolation_weight_for_cct(target_cct: f32, warm_cct: f32, cool_cct: f32) -> f32 {
    if (cool_cct - warm_cct).abs() <= f32::EPSILON {
        return 0.0;
    }

    let inverse_target = 1.0 / target_cct;
    let inverse_warm = 1.0 / warm_cct;
    let inverse_cool = 1.0 / cool_cct;
    ((inverse_target - inverse_warm) / (inverse_cool - inverse_warm)).clamp(0.0, 1.0)
}

fn interpolate_color_matrix(warm: &[f32], cool: &[f32], cool_weight: f32) -> Vec<f32> {
    warm.iter()
        .zip(cool.iter())
        .map(|(warm_value, cool_value)| {
            warm_value.mul_add(1.0 - cool_weight, cool_value * cool_weight)
        })
        .collect()
}

fn camera_matrix_hash(matrix: &[f32]) -> String {
    let mut hasher = blake3::Hasher::new();
    for value in matrix {
        hasher.update(&value.to_le_bytes());
    }
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn illuminant_label(illuminant: Illuminant) -> String {
    format!("{illuminant:?}")
}

struct CameraProfileResolution {
    matrix: Option<Vec<f32>>,
    report: RawCameraProfileReport,
}

fn resolve_camera_color_profile(
    color_matrices: &HashMap<Illuminant, Vec<f32>>,
    wb: [f32; 4],
) -> CameraProfileResolution {
    let d65 = color_matrices
        .get(&Illuminant::D65)
        .filter(|matrix| valid_color_matrix(matrix));

    let mut candidates: Vec<(Illuminant, f32, &[f32])> = color_matrices
        .iter()
        .filter(|(_illuminant, matrix)| valid_color_matrix(matrix))
        .filter_map(|(illuminant, matrix)| {
            illuminant_cct_kelvin(*illuminant).map(|cct| (*illuminant, cct, matrix.as_slice()))
        })
        .collect();

    candidates.sort_by(|left, right| {
        left.1
            .total_cmp(&right.1)
            .then_with(|| left.0.cmp(&right.0))
    });

    let candidate_count = candidates.len();

    let Some(target_cct) = estimate_scene_cct_from_wb(wb) else {
        let selected = d65.cloned().or_else(|| {
            candidates
                .first()
                .map(|(_illuminant, _cct, matrix)| (*matrix).to_vec())
        });
        let fallback_reason = if selected.is_some() {
            "invalid_white_balance"
        } else {
            "no_valid_camera_matrix"
        };
        return CameraProfileResolution {
            matrix: selected.clone(),
            report: RawCameraProfileReport {
                algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
                candidate_count,
                cool_illuminant: None,
                cool_weight: None,
                estimated_cct_kelvin: None,
                fallback_reason: Some(fallback_reason),
                matrix_hash: selected.as_deref().map(camera_matrix_hash),
                status: if selected.is_some() {
                    "fallback"
                } else {
                    "unavailable"
                },
                warm_illuminant: None,
                warning_codes: vec![fallback_reason],
            },
        };
    };

    if candidates.len() >= 2 {
        let warm = candidates
            .iter()
            .rev()
            .find(|(_illuminant, cct, matrix)| {
                *cct <= target_cct && matrix.len() == candidates[0].2.len()
            })
            .copied()
            .unwrap_or(candidates[0]);
        let cool = candidates
            .iter()
            .find(|(_illuminant, cct, matrix)| *cct >= target_cct && matrix.len() == warm.2.len())
            .copied()
            .unwrap_or(*candidates.last().expect("candidate count checked above"));

        if warm.0 != cool.0 {
            let cool_weight = interpolation_weight_for_cct(target_cct, warm.1, cool.1);
            let matrix = interpolate_color_matrix(warm.2, cool.2, cool_weight);
            return CameraProfileResolution {
                report: RawCameraProfileReport {
                    algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
                    candidate_count,
                    cool_illuminant: Some(illuminant_label(cool.0)),
                    cool_weight: Some(cool_weight),
                    estimated_cct_kelvin: Some(target_cct),
                    fallback_reason: None,
                    matrix_hash: Some(camera_matrix_hash(&matrix)),
                    status: "interpolated",
                    warm_illuminant: Some(illuminant_label(warm.0)),
                    warning_codes: Vec::new(),
                },
                matrix: Some(matrix),
            };
        }

        let matrix = warm.2.to_vec();
        return CameraProfileResolution {
            report: RawCameraProfileReport {
                algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
                candidate_count,
                cool_illuminant: Some(illuminant_label(warm.0)),
                cool_weight: Some(1.0),
                estimated_cct_kelvin: Some(target_cct),
                fallback_reason: None,
                matrix_hash: Some(camera_matrix_hash(&matrix)),
                status: "single_illuminant",
                warm_illuminant: Some(illuminant_label(warm.0)),
                warning_codes: Vec::new(),
            },
            matrix: Some(matrix),
        };
    }

    let selected = d65.cloned().or_else(|| {
        candidates
            .first()
            .map(|(_illuminant, _cct, matrix)| (*matrix).to_vec())
    });
    CameraProfileResolution {
        matrix: selected.clone(),
        report: RawCameraProfileReport {
            algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
            candidate_count,
            cool_illuminant: candidates
                .first()
                .map(|candidate| illuminant_label(candidate.0)),
            cool_weight: Some(1.0),
            estimated_cct_kelvin: Some(target_cct),
            fallback_reason: if selected.is_some() {
                Some("single_valid_camera_matrix")
            } else {
                Some("no_valid_camera_matrix")
            },
            matrix_hash: selected.as_deref().map(camera_matrix_hash),
            status: if selected.is_some() {
                "single_illuminant"
            } else {
                "unavailable"
            },
            warm_illuminant: candidates
                .first()
                .map(|candidate| illuminant_label(candidate.0)),
            warning_codes: if selected.is_some() {
                vec!["single_valid_camera_matrix"]
            } else {
                vec!["no_valid_camera_matrix"]
            },
        },
    }
}

fn select_camera_color_matrix(
    color_matrices: &HashMap<Illuminant, Vec<f32>>,
    wb: [f32; 4],
) -> Option<Vec<f32>> {
    resolve_camera_color_profile(color_matrices, wb).matrix
}

fn apply_dual_illuminant_camera_profile(raw_image: &mut RawImage) -> RawCameraProfileReport {
    let wb = if raw_image.wb_coeffs[0].is_nan() {
        [1.0, 1.0, 1.0, 1.0]
    } else {
        raw_image.wb_coeffs
    };
    let resolution = resolve_camera_color_profile(&raw_image.color_matrix, wb);
    if let Some(color_matrix) = resolution.matrix {
        raw_image.color_matrix.clear();
        raw_image.color_matrix.insert(Illuminant::D65, color_matrix);
    }
    resolution.report
}

fn pseudo_inverse_4x3(matrix: [[f32; 3]; 4]) -> [[f32; 4]; 3] {
    let mut tmp: [[f32; 3]; 4] = [[0.0; 3]; 4];
    let mut result: [[f32; 4]; 3] = [[0.0; 4]; 3];
    let mut work: [[f32; 6]; 3] = [[0.0; 6]; 3];

    for i in 0..3 {
        for (j, value) in work[i].iter_mut().enumerate() {
            *value = if j == i + 3 { 1.0 } else { 0.0 };
        }
        for j in 0..3 {
            for row in &matrix {
                work[i][j] += row[i] * row[j];
            }
        }
    }

    for i in 0..3 {
        let pivot = work[i][i];
        if pivot.abs() <= f32::EPSILON {
            continue;
        }
        for value in &mut work[i] {
            *value /= pivot;
        }
        let pivot_row = work[i];
        for (k, row) in work.iter_mut().enumerate() {
            if k == i {
                continue;
            }
            let factor = row[i];
            for (value, pivot_value) in row.iter_mut().zip(pivot_row.iter()) {
                *value -= pivot_value * factor;
            }
        }
    }

    for i in 0..4 {
        for j in 0..3 {
            tmp[i][j] = (0..3).map(|k| work[j][k + 3] * matrix[i][k]).sum();
        }
    }
    for i in 0..3 {
        for j in 0..4 {
            result[i][j] = tmp[j][i];
        }
    }

    result
}

fn clip_euclidean_norm_avg(pix: [f32; 3]) -> [f32; 3] {
    let pix = pix.map(|p| p.max(0.0));
    let max_val = pix.iter().copied().reduce(f32::max).unwrap_or(0.0);
    if max_val <= 1.0 {
        return pix;
    }

    let color = pix.map(|p| p / max_val);
    let euclidean = pix.iter().map(|p| p.powi(2)).sum::<f32>().sqrt() / 3.0_f32.sqrt();
    color.map(|p| (p + euclidean) * 0.5)
}

fn calibrate_three_color(raw_image: &RawImage, pixels: Color2D<f32, 3>) -> Color2D<f32, 3> {
    let wb = if raw_image.wb_coeffs[0].is_nan() {
        [1.0, 1.0, 1.0, 1.0]
    } else {
        raw_image.wb_coeffs
    };
    let Some(color_matrix) = select_camera_color_matrix(&raw_image.color_matrix, wb) else {
        return pixels;
    };

    let mut xyz_to_cam = [[0.0; 3]; 4];
    let components = (color_matrix.len() / 3).min(4);
    for i in 0..components {
        for j in 0..3 {
            xyz_to_cam[i][j] = color_matrix[i * 3 + j];
        }
    }
    let srgb_to_xyz_d65 = [
        [0.412_456_4, 0.357_576_1, 0.180_437_5],
        [0.212_672_9, 0.715_152_2, 0.072_175],
        [0.019_333_9, 0.119_192, 0.950_304_1],
    ];
    let rgb_to_cam = normalize_4x3(multiply_4x3_3x3(&xyz_to_cam, &srgb_to_xyz_d65));
    let cam_to_rgb = pseudo_inverse_4x3(rgb_to_cam);

    let data = pixels
        .data
        .iter()
        .map(|pixel| {
            let r = pixel[0] * wb[0];
            let g = pixel[1] * wb[1];
            let b = pixel[2] * wb[2];
            clip_euclidean_norm_avg([
                cam_to_rgb[0][0] * r + cam_to_rgb[0][1] * g + cam_to_rgb[0][2] * b,
                cam_to_rgb[1][0] * r + cam_to_rgb[1][1] * g + cam_to_rgb[1][2] * b,
                cam_to_rgb[2][0] * r + cam_to_rgb[2][1] * g + cam_to_rgb[2][2] * b,
            ])
        })
        .collect();

    Color2D::new_with(data, pixels.width, pixels.height)
}

fn apply_default_crop(raw_image: &RawImage, intermediate: Intermediate) -> Intermediate {
    let Some(mut crop) = raw_image.crop_area else {
        return intermediate;
    };
    if let Some(active_area) = raw_image.active_area {
        crop = crop.intersection(&active_area).adapt(&active_area);
    }

    let original_width = raw_image
        .active_area
        .map(|area| area.d.w)
        .unwrap_or(raw_image.width);
    let width = intermediate.dim().w;
    if original_width > 0 {
        let scale_factor = width as f32 / original_width as f32;
        if (scale_factor - 1.0).abs() > 1e-6 {
            crop.scale(scale_factor);
        }
    }

    if crop.is_empty() || crop.d == intermediate.dim() {
        return intermediate;
    }

    match intermediate {
        Intermediate::Monochrome(pixels) => Intermediate::Monochrome(pixels.crop(crop)),
        Intermediate::ThreeColor(pixels) => Intermediate::ThreeColor(pixels.crop(crop)),
        Intermediate::FourColor(pixels) => Intermediate::FourColor(pixels.crop(crop)),
    }
}

fn develop_bayer_hq_intermediate(
    raw_image: &RawImage,
) -> Result<(Intermediate, BayerHqDevelopmentReport)> {
    let mut scaled = raw_image.clone();
    scaled.apply_scaling()?;
    let RawPhotometricInterpretation::Cfa(config) = &scaled.photometric else {
        return Err(anyhow!("Bayer HQ requires CFA RAW input"));
    };

    let pixels = rawler::pixarray::PixF32::new_with(
        scaled.data.as_f32().into_owned(),
        scaled.width,
        scaled.height,
    );
    let roi = scaled.active_area.unwrap_or(pixels.rect());
    let mut demosaiced = crate::bayer_hq::demosaic_bayer_hq(&pixels, &config.cfa, roi);
    let suppression_report = crate::bayer_hq::suppress_false_color_and_zipper(&mut demosaiced);
    let calibrated = calibrate_three_color(&scaled, demosaiced);

    Ok((
        apply_default_crop(&scaled, Intermediate::ThreeColor(calibrated)),
        BayerHqDevelopmentReport {
            artifact_suppression: suppression_report,
        },
    ))
}

#[cfg(test)]
fn inject_raw_defect_proof_pixels(
    raw_image: &mut RawImage,
    original_black_level: f32,
    original_white_level: f32,
) {
    if !matches!(raw_image.photometric, RawPhotometricInterpretation::Cfa(_)) || raw_image.cpp != 1
    {
        return;
    }

    let width = raw_image.width;
    let height = raw_image.height;
    let (left, top, right, bottom) = active_bounds(raw_image);
    let x = left + (right.saturating_sub(left) / 2);
    let y = top + (bottom.saturating_sub(top) / 2);
    if x < 4 || y < 4 || x + 4 >= width || y + 4 >= height {
        return;
    }

    let hot = original_white_level.clamp(0.0, u16::MAX as f32) as u16;
    let dead = original_black_level.clamp(0.0, u16::MAX as f32) as u16;
    if let RawImageData::Integer(pixels) = &mut raw_image.data {
        pixels[y * width + x] = hot;
        pixels[(y + 2) * width + x + 2] = dead;
    }
}

#[inline]
fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(3.0)
    }
}

fn develop_internal_with_options(
    file_bytes: &[u8],
    fast_demosaic: bool,
    profile: RawProcessingProfile,
    highlight_compression: f32,
    linear_mode: String,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
    defect_options: RawDefectDevelopmentOptions,
) -> Result<(DynamicImage, Orientation, RawDevelopmentReport)> {
    let check_cancel = || -> Result<()> {
        if let Some((tracker, generation)) = &cancel_token
            && tracker.load(Ordering::SeqCst) != *generation
        {
            return Err(anyhow!("Load cancelled"));
        }
        Ok(())
    };

    check_cancel()?;

    let source = RawSource::new_from_slice(file_bytes);
    let decoder = rawler::get_decoder(&source)?;

    check_cancel()?;
    let mut raw_image: RawImage = decoder.raw_image(&source, &RawDecodeParams::default(), false)?;

    let metadata = decoder.raw_metadata(&source, &RawDecodeParams::default())?;
    let orientation = metadata
        .exif
        .orientation
        .map(Orientation::from_u16)
        .unwrap_or(Orientation::Normal);

    let is_linear_format = is_linear_raw_format(&raw_image);

    let (apply_ungamma, apply_calibration) = match linear_mode.as_str() {
        "gamma" => (true, true),
        "skip_calib" => (false, false),
        "gamma_skip_calib" => (true, false),
        _ => (false, true),
    };

    let original_white_level = raw_image
        .whitelevel
        .0
        .first()
        .cloned()
        .unwrap_or(u16::MAX as u32) as f32;
    let original_black_level = raw_image
        .blacklevel
        .levels
        .first()
        .map(|r| r.as_f32())
        .unwrap_or(0.0);

    #[cfg(test)]
    if defect_options.inject_test_defects {
        inject_raw_defect_proof_pixels(&mut raw_image, original_black_level, original_white_level);
    }

    if defect_options.repair_sensor_defects {
        let defect_report =
            repair_raw_sensor_defects(&mut raw_image, original_black_level, original_white_level);
        if defect_report.hot_pixels > 0 || defect_report.dead_pixels > 0 {
            log::debug!(
                "Corrected RAW sensor defects before demosaic: hot={}, dead={}",
                defect_report.hot_pixels,
                defect_report.dead_pixels
            );
        }
    }

    let highlight_reconstruction_report =
        if profile != RawProcessingProfile::Fast && apply_calibration {
            reconstruct_raw_sensor_highlights(&mut raw_image)
        } else {
            HighlightReconstructionReport::default()
        };
    if highlight_reconstruction_report.reconstructed_pixels > 0 {
        log::debug!(
            "Reconstructed RAW sensor highlights before demosaic: candidates={}, pixels={}, channels={}",
            highlight_reconstruction_report.candidate_pixels,
            highlight_reconstruction_report.reconstructed_pixels,
            highlight_reconstruction_report.reconstructed_channels
        );
    }

    let camera_profile = if apply_calibration {
        apply_dual_illuminant_camera_profile(&mut raw_image)
    } else {
        RawCameraProfileReport::unavailable("calibration_disabled", raw_image.color_matrix.len())
    };

    for level in raw_image.whitelevel.0.iter_mut() {
        *level = u32::MAX;
    }

    let mut developer = RawDevelop::default();
    let use_bayer_hq = profile == RawProcessingProfile::Maximum
        && !fast_demosaic
        && !is_linear_format
        && is_rgb_bayer_raw(&raw_image)
        && apply_calibration;
    let demosaic_path = if use_bayer_hq {
        RawDemosaicPath::BayerHq
    } else if is_linear_format {
        RawDemosaicPath::LinearBypass
    } else if fast_demosaic {
        RawDemosaicPath::Fast
    } else {
        RawDemosaicPath::Standard
    };

    if is_linear_format {
        developer.steps.retain(|&step| {
            step != ProcessingStep::SRgb
                && step != ProcessingStep::Demosaic
                && (apply_calibration || step != ProcessingStep::Calibrate)
        });
    } else if fast_demosaic {
        developer.demosaic_algorithm = DemosaicAlgorithm::Speed;
        developer.steps.retain(|&step| step != ProcessingStep::SRgb);
    } else {
        developer.steps.retain(|&step| step != ProcessingStep::SRgb);
    }

    check_cancel()?;
    let mut developed_intermediate = if use_bayer_hq {
        develop_bayer_hq_intermediate(&raw_image)?.0
    } else {
        developer.develop_intermediate(&raw_image)?
    };

    drop(raw_image);

    let denominator = (original_white_level - original_black_level).max(1.0);
    let rescale_factor = (u32::MAX as f32 - original_black_level) / denominator;

    let safe_highlight_compression = highlight_compression.max(1.01);

    let clamp_limit = if fast_demosaic {
        1.0
    } else {
        safe_highlight_compression
    };

    check_cancel()?;

    match &mut developed_intermediate {
        Intermediate::Monochrome(pixels) => {
            pixels.data.iter_mut().for_each(|p| {
                let mut linear_val = *p * rescale_factor;
                if is_linear_format && apply_ungamma {
                    linear_val = srgb_to_linear(linear_val.clamp(0.0, 1.0));
                }
                *p = linear_val.clamp(0.0, clamp_limit);
            });
        }
        Intermediate::ThreeColor(pixels) => {
            pixels.data.iter_mut().for_each(|p| {
                let mut r = (p[0] * rescale_factor).max(0.0);
                let mut g = (p[1] * rescale_factor).max(0.0);
                let mut b = (p[2] * rescale_factor).max(0.0);

                if is_linear_format && apply_ungamma {
                    r = srgb_to_linear(r.clamp(0.0, 1.0));
                    g = srgb_to_linear(g.clamp(0.0, 1.0));
                    b = srgb_to_linear(b.clamp(0.0, 1.0));
                }

                let max_c = r.max(g).max(b);

                let (final_r, final_g, final_b) = if max_c > 1.0 {
                    let min_c = r.min(g).min(b);
                    let compression_factor =
                        (1.0 - (max_c - 1.0) / (safe_highlight_compression - 1.0)).clamp(0.0, 1.0);
                    let compressed_r = min_c + (r - min_c) * compression_factor;
                    let compressed_g = min_c + (g - min_c) * compression_factor;
                    let compressed_b = min_c + (b - min_c) * compression_factor;
                    let compressed_max = compressed_r.max(compressed_g).max(compressed_b);

                    if compressed_max > 1e-6 {
                        let rescale = max_c / compressed_max;
                        (
                            compressed_r * rescale,
                            compressed_g * rescale,
                            compressed_b * rescale,
                        )
                    } else {
                        (max_c, max_c, max_c)
                    }
                } else {
                    (r, g, b)
                };

                p[0] = final_r.clamp(0.0, clamp_limit);
                p[1] = final_g.clamp(0.0, clamp_limit);
                p[2] = final_b.clamp(0.0, clamp_limit);
            });
        }
        Intermediate::FourColor(pixels) => {
            pixels.data.iter_mut().for_each(|p| {
                p.iter_mut().for_each(|c| {
                    let mut linear_val = *c * rescale_factor;
                    if is_linear_format && apply_ungamma {
                        linear_val = srgb_to_linear(linear_val.clamp(0.0, 1.0));
                    }
                    *c = linear_val.clamp(0.0, clamp_limit);
                });
            });
        }
    }

    let (width, height) = {
        let dim = developed_intermediate.dim();
        (dim.w as u32, dim.h as u32)
    };

    check_cancel()?;

    let dynamic_image = match developed_intermediate {
        Intermediate::ThreeColor(pixels) => {
            let buffer = ImageBuffer::<Rgba<f32>, _>::from_fn(width, height, |x, y| {
                let p = pixels.data[(y * width + x) as usize];
                Rgba([p[0], p[1], p[2], 1.0])
            });
            DynamicImage::ImageRgba32F(buffer)
        }
        Intermediate::Monochrome(pixels) => {
            let buffer = ImageBuffer::<Rgba<f32>, _>::from_fn(width, height, |x, y| {
                let p = pixels.data[(y * width + x) as usize];
                Rgba([p, p, p, 1.0])
            });
            DynamicImage::ImageRgba32F(buffer)
        }
        _ => {
            return Err(anyhow!("Unsupported intermediate format for conversion"));
        }
    };

    Ok((
        dynamic_image,
        orientation,
        RawDevelopmentReport {
            demosaic_path,
            camera_profile,
        },
    ))
}

pub fn get_fast_demosaic_scale_factor(
    file_bytes: &[u8],
    decoded_width: u32,
    decoded_height: u32,
) -> f32 {
    let source = RawSource::new_from_slice(file_bytes);
    if let Ok(decoder) = rawler::get_decoder(&source)
        && let Ok(raw_img) = decoder.raw_image(&source, &RawDecodeParams::default(), true)
    {
        let max_orig = (raw_img.width as f32).max(raw_img.height as f32);
        let max_comp = (decoded_width as f32).max(decoded_height as f32);
        if max_orig > 0.0 {
            let ratio = max_comp / max_orig;
            if ratio > 0.1 && ratio < 0.35 {
                return 0.25;
            } else if (0.35..0.75).contains(&ratio) {
                return 0.5;
            }
        }
    }
    1.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::Path};

    fn bayer_pixels(width: usize, height: usize, value: u16) -> Vec<u16> {
        vec![value; width * height]
    }

    fn bayer_context(
        width: usize,
        height: usize,
        active_bounds: (usize, usize, usize, usize),
    ) -> RawDefectCorrectionContext {
        RawDefectCorrectionContext {
            bounds: RawDefectImageBounds {
                active_bounds,
                cfa_height: 2,
                cfa_width: 2,
                height,
                width,
            },
            black_cpp: 1,
            black_height: 1,
            black_levels: vec![512.0],
            black_width: 1,
            cfa_colors: vec![0, 1, 1, 2],
            white_levels: vec![65_535.0],
        }
    }

    fn bayer_context_with_levels(
        width: usize,
        height: usize,
        black_levels: Vec<f32>,
        white_levels: Vec<f32>,
    ) -> RawDefectCorrectionContext {
        RawDefectCorrectionContext {
            black_levels,
            white_levels,
            ..bayer_context(width, height, (0, 0, width, height))
        }
    }

    #[test]
    fn scene_cct_from_wb_tracks_blue_red_ratio() {
        let daylight = estimate_scene_cct_from_wb([1.0, 1.0, 1.0, f32::NAN]).unwrap();
        let tungsten = estimate_scene_cct_from_wb([1.0, 1.0, 2.28, f32::NAN]).unwrap();

        assert!((daylight - 6_504.0).abs() < 0.1);
        assert!((tungsten - 2_856.0).abs() < 0.1);
    }

    #[test]
    fn color_matrix_interpolation_uses_inverse_temperature() {
        let cool_weight = interpolation_weight_for_cct(4_000.0, 2_856.0, 6_504.0);

        assert!(cool_weight > 0.0);
        assert!(cool_weight < 1.0);
        assert!(
            (cool_weight - 0.509_907_84).abs() < 0.000_001,
            "unexpected cool weight {cool_weight}"
        );
    }

    #[test]
    fn interpolates_dual_illuminant_matrices_for_warm_white_balance() {
        let warm = vec![0.80, -0.20, 0.10, -0.30, 1.20, 0.20, -0.04, 0.08, 0.66];
        let cool = vec![0.60, -0.10, 0.04, -0.20, 1.05, 0.14, -0.02, 0.05, 0.52];
        let target_cct = estimate_scene_cct_from_wb([1.0, 1.0, 1.5, f32::NAN]).unwrap();
        let cool_weight = interpolation_weight_for_cct(target_cct, 2_856.0, 6_504.0);
        let interpolated = interpolate_color_matrix(&warm, &cool, cool_weight);

        assert_eq!(interpolated.len(), warm.len());
        assert!(interpolated[0] < warm[0]);
        assert!(interpolated[0] > cool[0]);
        assert!(interpolated[4] < warm[4]);
        assert!(interpolated[4] > cool[4]);
    }

    #[test]
    fn camera_matrix_selection_interpolates_a_to_d65() {
        let warm = vec![0.80, -0.20, 0.10, -0.30, 1.20, 0.20, -0.04, 0.08, 0.66];
        let cool = vec![0.60, -0.10, 0.04, -0.20, 1.05, 0.14, -0.02, 0.05, 0.52];
        let mut color_matrices = HashMap::new();
        color_matrices.insert(Illuminant::A, warm.clone());
        color_matrices.insert(Illuminant::D65, cool.clone());

        let resolution = resolve_camera_color_profile(&color_matrices, [1.0, 1.0, 1.5, f32::NAN]);
        let selected = resolution.matrix.unwrap();

        assert_eq!(selected.len(), warm.len());
        assert!(selected[0] < warm[0]);
        assert!(selected[0] > cool[0]);
        assert_ne!(selected, cool);
        assert_eq!(resolution.report.status, "interpolated");
        assert_eq!(
            resolution.report.algorithm_id,
            CAMERA_PROFILE_RESOLVER_ALGORITHM_ID
        );
        assert_eq!(resolution.report.candidate_count, 2);
        assert!(resolution.report.cool_weight.unwrap() > 0.0);
        assert!(
            resolution
                .report
                .matrix_hash
                .unwrap()
                .starts_with("blake3:")
        );
    }

    #[test]
    fn camera_matrix_selection_keeps_d65_fallback_when_wb_is_invalid() {
        let warm = vec![0.80, -0.20, 0.10, -0.30, 1.20, 0.20, -0.04, 0.08, 0.66];
        let cool = vec![0.60, -0.10, 0.04, -0.20, 1.05, 0.14, -0.02, 0.05, 0.52];
        let mut color_matrices = HashMap::new();
        color_matrices.insert(Illuminant::A, warm);
        color_matrices.insert(Illuminant::D65, cool.clone());

        let resolution =
            resolve_camera_color_profile(&color_matrices, [f32::NAN, 1.0, 1.0, f32::NAN]);
        let selected = resolution.matrix.unwrap();

        assert_eq!(selected, cool);
        assert_eq!(resolution.report.status, "fallback");
        assert_eq!(
            resolution.report.fallback_reason,
            Some("invalid_white_balance")
        );
        assert_eq!(
            resolution.report.warning_codes,
            vec!["invalid_white_balance"]
        );
    }

    #[test]
    fn raw_defect_correction_replaces_isolated_hot_pixel() {
        let width = 12;
        let height = 12;
        let mut pixels = bayer_pixels(width, height, 8_000);
        pixels[6 * width + 6] = u16::MAX;

        let report = repair_integer_cfa_defects(
            &mut pixels,
            bayer_context(width, height, (0, 0, width, height)),
        );

        assert_eq!(report.hot_pixels, 1);
        assert_eq!(report.dead_pixels, 0);
        assert_eq!(pixels[6 * width + 6], 8_000);
    }

    #[test]
    fn raw_defect_correction_replaces_isolated_dead_pixel() {
        let width = 12;
        let height = 12;
        let mut pixels = bayer_pixels(width, height, 12_000);
        pixels[6 * width + 6] = 0;

        let report = repair_integer_cfa_defects(
            &mut pixels,
            bayer_context(width, height, (0, 0, width, height)),
        );

        assert_eq!(report.hot_pixels, 0);
        assert_eq!(report.dead_pixels, 1);
        assert_eq!(pixels[6 * width + 6], 12_000);
    }

    #[test]
    fn raw_defect_correction_preserves_compact_highlight_structure() {
        let width = 12;
        let height = 12;
        let mut pixels = bayer_pixels(width, height, 8_000);
        pixels[6 * width + 6] = 65_000;
        pixels[6 * width + 7] = 60_000;

        let report = repair_integer_cfa_defects(
            &mut pixels,
            bayer_context(width, height, (0, 0, width, height)),
        );

        assert_eq!(report.hot_pixels, 0);
        assert_eq!(report.dead_pixels, 0);
        assert_eq!(pixels[6 * width + 6], 65_000);
    }

    #[test]
    fn raw_defect_correction_respects_active_area() {
        let width = 12;
        let height = 12;
        let mut pixels = bayer_pixels(width, height, 8_000);
        pixels[2 * width + 2] = u16::MAX;
        pixels[6 * width + 6] = u16::MAX;

        let report =
            repair_integer_cfa_defects(&mut pixels, bayer_context(width, height, (4, 4, 10, 10)));

        assert_eq!(report.hot_pixels, 1);
        assert_eq!(pixels[2 * width + 2], u16::MAX);
        assert_eq!(pixels[6 * width + 6], 8_000);
    }

    #[test]
    fn raw_defect_correction_uses_phase_specific_white_levels() {
        let width = 12;
        let height = 12;
        let mut pixels = bayer_pixels(width, height, 8_000);
        pixels[6 * width + 6] = 30_000;

        let report = repair_integer_cfa_defects(
            &mut pixels,
            bayer_context_with_levels(
                width,
                height,
                vec![512.0],
                vec![32_000.0, 65_535.0, 65_535.0],
            ),
        );

        assert_eq!(report.hot_pixels, 1);
        assert_eq!(pixels[6 * width + 6], 8_000);
    }

    #[test]
    fn highlight_reconstruction_extends_single_clipped_channel_from_local_ratio() {
        let width = 16;
        let height = 16;
        let mut pixels = bayer_pixels(width, height, 8_000);
        for y in (0..height).step_by(2) {
            for x in (0..width).step_by(2) {
                pixels[y * width + x] = 14_800;
            }
        }
        pixels[8 * width + 8] = 16_000;

        let report = reconstruct_integer_cfa_highlights(
            &mut pixels,
            bayer_context_with_levels(
                width,
                height,
                vec![512.0],
                vec![16_000.0, 16_000.0, 16_000.0],
            ),
        );

        assert_eq!(report.candidate_pixels, 1);
        assert_eq!(report.reconstructed_pixels, 1);
        assert_eq!(report.reconstructed_channels, 1);
        assert!(pixels[8 * width + 8] > 16_000);
        assert!(pixels[8 * width + 8] <= 18_323);
    }

    #[test]
    fn highlight_reconstruction_rejects_all_channel_clip() {
        let width = 16;
        let height = 16;
        let mut pixels = bayer_pixels(width, height, 8_000);
        pixels[8 * width + 8] = 16_000;

        let report = reconstruct_integer_cfa_highlights(
            &mut pixels,
            bayer_context_with_levels(
                width,
                height,
                vec![512.0],
                vec![16_000.0, 16_000.0, 16_000.0],
            ),
        );

        assert_eq!(report.candidate_pixels, 1);
        assert_eq!(report.reconstructed_pixels, 0);
        assert_eq!(pixels[8 * width + 8], 16_000);
    }

    #[test]
    fn private_raw_defect_correction_changes_injected_sensor_defects_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_RAW_DEFECT_PROOF").ok() != Some("1".to_string()) {
            return;
        }

        let source_path = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE")
            .expect("RAWENGINE_PRIVATE_RAW_SOURCE must point to a private RAW");
        let report_dir = std::env::var("RAWENGINE_RAW_DEFECT_PROOF_REPORT_DIR")
            .unwrap_or_else(|_| "target/raw-defect-correction-proof".to_string());
        let report_dir = Path::new(&report_dir);
        fs::create_dir_all(report_dir).expect("create report dir");

        let file_bytes = fs::read(&source_path).expect("read private RAW");
        let proof_options = RawDefectDevelopmentOptions {
            inject_test_defects: true,
            repair_sensor_defects: false,
        };
        let (uncorrected, uncorrected_orientation, _) = develop_internal_with_options(
            &file_bytes,
            false,
            RawProcessingProfile::Balanced,
            2.5,
            "default".to_string(),
            None,
            proof_options,
        )
        .expect("develop private RAW with injected defects");
        let uncorrected = apply_orientation(uncorrected, uncorrected_orientation);

        let (corrected, corrected_orientation, _) = develop_internal_with_options(
            &file_bytes,
            false,
            RawProcessingProfile::Balanced,
            2.5,
            "default".to_string(),
            None,
            RawDefectDevelopmentOptions {
                repair_sensor_defects: true,
                ..proof_options
            },
        )
        .expect("develop private RAW with injected corrected defects");
        let corrected = apply_orientation(corrected, corrected_orientation);

        assert_eq!(uncorrected.width(), corrected.width());
        assert_eq!(uncorrected.height(), corrected.height());

        let uncorrected_rgba = uncorrected.to_rgba8();
        let corrected_rgba = corrected.to_rgba8();
        let uncorrected_hash = blake3::hash(uncorrected_rgba.as_raw()).to_hex().to_string();
        let corrected_hash = blake3::hash(corrected_rgba.as_raw()).to_hex().to_string();
        assert_ne!(uncorrected_hash, corrected_hash);

        let uncorrected_path = report_dir.join("raw-defect-uncorrected-injected.tiff");
        let corrected_path = report_dir.join("raw-defect-corrected-injected.tiff");
        uncorrected
            .save_with_format(&uncorrected_path, image::ImageFormat::Tiff)
            .expect("write uncorrected proof TIFF");
        corrected
            .save_with_format(&corrected_path, image::ImageFormat::Tiff)
            .expect("write corrected proof TIFF");

        let report = serde_json::json!({
            "issue": 3243,
            "proofBoundary": "private_raw_pre_demosaic_defect_correction_runtime",
            "sourcePath": source_path,
            "dimensions": {
                "width": corrected.width(),
                "height": corrected.height(),
            },
            "injection": "two deterministic sensor-space defects before demosaic",
            "uncorrected": {
                "imageHash": uncorrected_hash,
                "tiffPath": uncorrected_path.to_string_lossy(),
            },
            "corrected": {
                "imageHash": corrected_hash,
                "tiffPath": corrected_path.to_string_lossy(),
            },
        });
        fs::write(
            report_dir.join("raw-defect-correction-private-proof.json"),
            serde_json::to_vec_pretty(&report).expect("serialize proof report"),
        )
        .expect("write proof report");
    }

    #[test]
    fn private_bayer_hq_generates_distinct_maximum_output_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_BAYER_HQ_PROOF").ok() != Some("1".to_string()) {
            return;
        }

        let source_path = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE")
            .or_else(|_| std::env::var("RAWENGINE_BAYER_HQ_SOURCE"))
            .expect("RAWENGINE_PRIVATE_RAW_SOURCE or RAWENGINE_BAYER_HQ_SOURCE must point to a Bayer RAW");
        let report_dir = std::env::var("RAWENGINE_BAYER_HQ_REPORT_DIR")
            .unwrap_or_else(|_| "target/bayer-hq-proof".to_string());
        let report_dir = Path::new(&report_dir);
        fs::create_dir_all(report_dir).expect("create report dir");

        let file_bytes = fs::read(&source_path).expect("read private Bayer RAW");
        let (balanced, balanced_orientation, balanced_report) = develop_internal_with_options(
            &file_bytes,
            false,
            RawProcessingProfile::Balanced,
            2.5,
            "default".to_string(),
            None,
            RawDefectDevelopmentOptions::default(),
        )
        .expect("develop balanced private RAW");
        let balanced = apply_orientation(balanced, balanced_orientation);

        let started = std::time::Instant::now();
        let (maximum, maximum_orientation, maximum_report) = develop_internal_with_options(
            &file_bytes,
            false,
            RawProcessingProfile::Maximum,
            4.0,
            "default".to_string(),
            None,
            RawDefectDevelopmentOptions::default(),
        )
        .expect("develop Bayer HQ private RAW");
        let maximum_elapsed_ms = started.elapsed().as_millis();
        let maximum = apply_orientation(maximum, maximum_orientation);
        assert_eq!(balanced_report.demosaic_path, RawDemosaicPath::Standard);
        assert_eq!(maximum_report.demosaic_path, RawDemosaicPath::BayerHq);

        let source = RawSource::new_from_slice(&file_bytes);
        let decoder =
            rawler::get_decoder(&source).expect("create RAW decoder for suppression proof");
        let mut raw_image = decoder
            .raw_image(&source, &RawDecodeParams::default(), false)
            .expect("decode private Bayer RAW for suppression proof");
        let highlight_reconstruction_report = reconstruct_raw_sensor_highlights(&mut raw_image);
        let (_, bayer_hq_report) =
            develop_bayer_hq_intermediate(&raw_image).expect("run Bayer HQ suppression proof path");
        let suppression_report = bayer_hq_report.artifact_suppression;
        assert!(suppression_report.evaluated_pixels > 0);
        assert!(suppression_report.adjusted_pixels > 0);
        let suppression_adjusted_ratio = suppression_report.adjusted_pixels as f64
            / suppression_report.evaluated_pixels.max(1) as f64;

        assert_eq!(balanced.width(), maximum.width());
        assert_eq!(balanced.height(), maximum.height());

        let balanced_rgba = balanced.to_rgba8();
        let maximum_rgba = maximum.to_rgba8();
        let balanced_hash = blake3::hash(balanced_rgba.as_raw()).to_hex().to_string();
        let maximum_hash = blake3::hash(maximum_rgba.as_raw()).to_hex().to_string();
        assert_ne!(balanced_hash, maximum_hash);
        let mut changed_pixels = 0usize;
        let mut absolute_delta_sum = 0u64;
        for (balanced_pixel, maximum_pixel) in balanced_rgba
            .as_raw()
            .chunks_exact(4)
            .zip(maximum_rgba.as_raw().chunks_exact(4))
        {
            if balanced_pixel != maximum_pixel {
                changed_pixels += 1;
            }
            absolute_delta_sum += balanced_pixel
                .iter()
                .zip(maximum_pixel.iter())
                .take(3)
                .map(|(balanced_value, maximum_value)| {
                    balanced_value.abs_diff(*maximum_value) as u64
                })
                .sum::<u64>();
        }
        let pixel_count = (balanced_rgba.width() as usize) * (balanced_rgba.height() as usize);
        let changed_pixel_ratio = changed_pixels as f64 / pixel_count.max(1) as f64;
        let mean_absolute_byte_delta = absolute_delta_sum as f64 / (pixel_count.max(1) * 3) as f64;
        assert!(changed_pixel_ratio > 0.001);
        assert!(mean_absolute_byte_delta > 0.01);

        let balanced_path = report_dir.join("bayer-balanced-ppg.tiff");
        let maximum_path = report_dir.join("bayer-maximum-hq.tiff");
        balanced
            .save_with_format(&balanced_path, image::ImageFormat::Tiff)
            .expect("write balanced TIFF");
        maximum
            .save_with_format(&maximum_path, image::ImageFormat::Tiff)
            .expect("write Bayer HQ TIFF");

        let report = serde_json::json!({
            "issues": [3239, 3241, 3242],
            "proofBoundary": "private_bayer_hq_runtime_output",
            "sourcePath": source_path,
            "dimensions": {
                "width": maximum.width(),
                "height": maximum.height(),
            },
            "balanced": {
                "algorithm": "rawler_ppg_quality",
                "imageHash": balanced_hash,
                "tiffPath": balanced_path.to_string_lossy(),
            },
            "maximum": {
                "algorithm": "rawengine_adaptive_bayer_hq_v1",
                "elapsedMs": maximum_elapsed_ms,
                "imageHash": maximum_hash,
                "tiffPath": maximum_path.to_string_lossy(),
                "falseColorSuppression": {
                    "algorithm": "suppress_false_color_and_zipper",
                    "evaluatedPixels": suppression_report.evaluated_pixels,
                    "adjustedPixels": suppression_report.adjusted_pixels,
                    "adjustedPixelRatio": suppression_adjusted_ratio,
                },
                "highlightReconstruction": {
                    "algorithm": "sensor_linear_same_phase_headroom_v1",
                    "stage": "pre_demosaic_integer_cfa",
                    "candidatePixels": highlight_reconstruction_report.candidate_pixels,
                    "reconstructedPixels": highlight_reconstruction_report.reconstructed_pixels,
                    "reconstructedChannels": highlight_reconstruction_report.reconstructed_channels,
                },
            },
            "outputDiff": {
                "changedPixelRatio": changed_pixel_ratio,
                "meanAbsoluteByteDelta": mean_absolute_byte_delta,
            },
            "privateAssetsCommitted": false,
        });
        fs::write(
            report_dir.join("bayer-hq-private-proof.json"),
            serde_json::to_vec_pretty(&report).expect("serialize Bayer HQ proof report"),
        )
        .expect("write Bayer HQ proof report");
    }
}
