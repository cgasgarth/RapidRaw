use crate::color::camera_input_transform::{
    AcesCgLinearV1, CameraInputTransform, CameraRgbWhiteBalanceGains, RawInputTransformReceiptV1,
    RawWorkingImageV1, XyzToCameraMatrix, apply_camera_input_transform,
};
#[cfg(test)]
use crate::color::white_balance::{
    WhiteBalanceModeV1, WhiteBalancePlanInputV1, compile_white_balance_plan,
};
use crate::color::white_balance::{
    WhiteBalancePlanV1, camera_white_chroma, neutral_chroma_from_wb, project_neutral_mired_weight,
};
use crate::image_processing::apply_orientation;
use anyhow::{Result, anyhow};
use image::{DynamicImage, ImageBuffer, Rgba};
use rawler::imgop::xyz::Illuminant;
use rawler::{
    decoders::{Orientation, RawDecodeParams, RawMetadata},
    imgop::develop::{DemosaicAlgorithm, Intermediate, ProcessingStep, RawDevelop},
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

const CAMERA_PROFILE_RESOLVER_ALGORITHM_ID: &str = "dual_illuminant_camera_neutral_mired_v2";
#[cfg(test)]
static RAW_DEVELOPMENT_INVOCATIONS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

#[cfg(test)]
pub(crate) fn raw_development_invocations() -> u64 {
    RAW_DEVELOPMENT_INVOCATIONS.load(Ordering::SeqCst)
}

/// Sensor-domain decode used by computational RAW workflows before demosaic or rendering.
/// Callers own calibration and must not treat this as a developed RGB image.
pub(crate) struct RawSensorDecode {
    pub metadata: RawMetadata,
    pub raw_image: RawImage,
}

pub(crate) fn decode_raw_sensor_image(file_bytes: &[u8]) -> Result<RawSensorDecode> {
    let source = RawSource::new_from_slice(file_bytes);
    let decoder = rawler::get_decoder(&source)?;
    let params = RawDecodeParams::default();

    Ok(RawSensorDecode {
        metadata: decoder.raw_metadata(&source, &params)?,
        raw_image: decoder.raw_image(&source, &params, false)?,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
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
    XTransHq,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawCameraProfileReport {
    pub algorithm_id: &'static str,
    pub candidate_count: usize,
    pub cct_clamped: Option<bool>,
    pub cool_illuminant: Option<String>,
    pub cool_weight: Option<f32>,
    pub estimated_cct_kelvin: Option<f32>,
    pub fallback_reason: Option<&'static str>,
    pub illuminant_estimate_confidence: &'static str,
    pub illuminant_estimate_method: &'static str,
    pub matrix_hash: Option<String>,
    pub profile_illuminant_duv: Option<f64>,
    pub profile_illuminant_xy: Option<[f64; 2]>,
    pub status: &'static str,
    pub warm_illuminant: Option<String>,
    pub white_balance_plan_fingerprint: Option<String>,
    pub warning_codes: Vec<&'static str>,
}

impl RawCameraProfileReport {
    fn unavailable(reason: &'static str, candidate_count: usize) -> Self {
        Self {
            algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
            candidate_count,
            cct_clamped: None,
            cool_illuminant: None,
            cool_weight: None,
            estimated_cct_kelvin: None,
            fallback_reason: Some(reason),
            illuminant_estimate_confidence: "low",
            illuminant_estimate_method: "fallback",
            matrix_hash: None,
            profile_illuminant_duv: None,
            profile_illuminant_xy: None,
            status: "unavailable",
            warm_illuminant: None,
            white_balance_plan_fingerprint: None,
            warning_codes: vec![reason],
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawRuntimeReport {
    pub cache_hit: bool,
    pub decode_elapsed_ms: Option<u128>,
    pub export_elapsed_ms: Option<u128>,
    pub output_dimensions: Option<(u32, u32)>,
    pub preview_elapsed_ms: Option<u128>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawDevelopmentReport {
    pub demosaic_path: RawDemosaicPath,
    pub demosaic_algorithm_id: Option<&'static str>,
    pub processing_profile: RawProcessingProfile,
    pub camera_profile: RawCameraProfileReport,
    pub input_transform: Option<RawInputTransformReceiptV1>,
    pub runtime: Option<RawRuntimeReport>,
    pub xtrans_hq: Option<XTransHqDevelopmentReport>,
}

pub(crate) fn develop_raw_image_with_report(
    file_bytes: &[u8],
    fast_demosaic: bool,
    profile: RawProcessingProfile,
    highlight_compression: f32,
    linear_mode: String,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<(DynamicImage, RawDevelopmentReport)> {
    #[cfg(test)]
    RAW_DEVELOPMENT_INVOCATIONS.fetch_add(1, Ordering::SeqCst);
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

pub(crate) fn develop_raw_image_with_report_and_white_balance(
    file_bytes: &[u8],
    fast_demosaic: bool,
    profile: RawProcessingProfile,
    highlight_compression: f32,
    linear_mode: String,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
    white_balance_plan: WhiteBalancePlanV1,
) -> Result<(DynamicImage, RawDevelopmentReport)> {
    #[cfg(test)]
    RAW_DEVELOPMENT_INVOCATIONS.fetch_add(1, Ordering::SeqCst);
    let (developed_image, orientation, report) = develop_internal_with_options(
        file_bytes,
        fast_demosaic,
        profile,
        highlight_compression,
        linear_mode,
        cancel_token,
        RawDefectDevelopmentOptions {
            white_balance_plan: Some(white_balance_plan),
            ..RawDefectDevelopmentOptions::default()
        },
    )?;
    Ok((apply_orientation(developed_image, orientation), report))
}

pub(crate) fn develop_raw_source_with_report(
    source: &RawSource,
    fast_demosaic: bool,
    profile: RawProcessingProfile,
    highlight_compression: f32,
    linear_mode: String,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<(DynamicImage, RawDevelopmentReport)> {
    #[cfg(test)]
    RAW_DEVELOPMENT_INVOCATIONS.fetch_add(1, Ordering::SeqCst);
    let (developed_image, orientation, report) = develop_internal_from_source(
        source,
        fast_demosaic,
        profile,
        highlight_compression,
        linear_mode,
        cancel_token,
        RawDefectDevelopmentOptions::default(),
    )?;
    Ok((apply_orientation(developed_image, orientation), report))
}

pub(crate) fn develop_raw_source_with_report_and_white_balance(
    source: &RawSource,
    fast_demosaic: bool,
    profile: RawProcessingProfile,
    highlight_compression: f32,
    linear_mode: String,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
    white_balance_plan: WhiteBalancePlanV1,
) -> Result<(DynamicImage, RawDevelopmentReport)> {
    #[cfg(test)]
    RAW_DEVELOPMENT_INVOCATIONS.fetch_add(1, Ordering::SeqCst);
    let (developed_image, orientation, report) = develop_internal_from_source(
        source,
        fast_demosaic,
        profile,
        highlight_compression,
        linear_mode,
        cancel_token,
        RawDefectDevelopmentOptions {
            white_balance_plan: Some(white_balance_plan),
            ..RawDefectDevelopmentOptions::default()
        },
    )?;
    Ok((apply_orientation(developed_image, orientation), report))
}

#[derive(Debug, Clone)]
struct RawDefectDevelopmentOptions {
    #[cfg(test)]
    inject_test_defects: bool,
    repair_sensor_defects: bool,
    white_balance_plan: Option<WhiteBalancePlanV1>,
}

impl Default for RawDefectDevelopmentOptions {
    fn default() -> Self {
        Self {
            #[cfg(test)]
            inject_test_defects: false,
            repair_sensor_defects: true,
            white_balance_plan: None,
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

fn is_rgb_xtrans_raw(raw_image: &RawImage) -> bool {
    matches!(
        &raw_image.photometric,
        RawPhotometricInterpretation::Cfa(config)
            if raw_image.cpp == 1
                && config.cfa.is_rgb()
                && config.cfa.width == 6
                && config.cfa.height == 6
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

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XTransHqDevelopmentReport {
    reconstruction: crate::xtrans_hq::XTransHqReport,
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

#[derive(Debug, Clone, Copy, PartialEq)]
struct SceneCctEstimate {
    cct_kelvin: f32,
    clamped: bool,
    confidence: &'static str,
    method: &'static str,
}

fn estimate_scene_cct_from_camera_neutral(
    wb: [f32; 4],
    candidates: &[(Illuminant, f32, &[f32])],
) -> Option<SceneCctEstimate> {
    let observed = neutral_chroma_from_wb(wb)?;
    let warm = candidates.first()?;
    let cool = candidates.last()?;
    let warm_white = illuminant_white_xy(warm.0)?;
    let cool_white = illuminant_white_xy(cool.0)?;
    let warm_chroma = camera_white_chroma(warm.2, warm_white)?;
    let cool_chroma = camera_white_chroma(cool.2, cool_white)?;
    let cool_weight = project_neutral_mired_weight(observed, warm_chroma, cool_chroma)?;
    let inverse_cct = (1.0 - cool_weight) / f64::from(warm.1) + cool_weight / f64::from(cool.1);
    let cct_kelvin = (1.0 / inverse_cct) as f32;
    let projected = [
        warm_chroma[0].mul_add(1.0 - cool_weight, cool_chroma[0] * cool_weight),
        warm_chroma[1].mul_add(1.0 - cool_weight, cool_chroma[1] * cool_weight),
    ];
    let residual = (projected[0] - observed[0]).hypot(projected[1] - observed[1]);
    Some(SceneCctEstimate {
        cct_kelvin,
        clamped: cool_weight <= f64::EPSILON || cool_weight >= 1.0 - f64::EPSILON,
        confidence: if residual < 0.08 {
            "high"
        } else if residual < 0.2 {
            "medium"
        } else {
            "low"
        },
        method: "camera_neutral_profile_projection",
    })
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
    calibration_white_xy: Option<[f64; 2]>,
    report: RawCameraProfileReport,
}

fn cct_to_xy(cct: f32) -> Option<[f64; 2]> {
    let t = f64::from(cct);
    if !(1_667.0..=25_000.0).contains(&t) {
        return None;
    }
    let x = if t <= 4_000.0 {
        -0.266_123_9e9 / t.powi(3) - 0.234_358_0e6 / t.powi(2) + 0.877_695_6e3 / t + 0.179_910
    } else {
        -3.025_846_9e9 / t.powi(3) + 2.107_037_9e6 / t.powi(2) + 0.222_634_7e3 / t + 0.240_390
    };
    let y = if t <= 2_222.0 {
        -1.106_381_4 * x.powi(3) - 1.348_110_20 * x.powi(2) + 2.185_558_32 * x - 0.202_196_83
    } else if t <= 4_000.0 {
        -0.954_947_6 * x.powi(3) - 1.374_185_93 * x.powi(2) + 2.091_370_15 * x - 0.167_488_67
    } else {
        3.081_758_0 * x.powi(3) - 5.873_386_70 * x.powi(2) + 3.751_129_97 * x - 0.370_014_83
    };
    Some([x, y])
}

fn illuminant_white_xy(illuminant: Illuminant) -> Option<[f64; 2]> {
    match illuminant {
        Illuminant::A | Illuminant::Tungsten | Illuminant::IsoStudioTungsten => {
            Some([0.44757, 0.40745])
        }
        Illuminant::D50 => Some([0.34567, 0.35850]),
        Illuminant::D55 => Some([0.33242, 0.34743]),
        Illuminant::Daylight | Illuminant::FineWeather | Illuminant::Flash | Illuminant::D65 => {
            Some([0.31271, 0.32902])
        }
        Illuminant::CloudyWeather | Illuminant::D75 => Some([0.29902, 0.31485]),
        Illuminant::Shade => cct_to_xy(8_000.0),
        _ => None,
    }
}

fn resolve_camera_color_profile(
    color_matrices: &HashMap<Illuminant, Vec<f32>>,
    wb: [f32; 4],
    white_balance_plan: Option<&WhiteBalancePlanV1>,
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

    let plan_illuminant =
        white_balance_plan.and_then(WhiteBalancePlanV1::camera_profile_illuminant);
    let cct_estimate = plan_illuminant.map_or_else(
        || estimate_scene_cct_from_camera_neutral(wb, &candidates),
        |illuminant| {
            Some(SceneCctEstimate {
                cct_kelvin: illuminant.cct_kelvin as f32,
                clamped: false,
                confidence: "high",
                method: "white_balance_plan_v1",
            })
        },
    );
    let Some(cct_estimate) = cct_estimate else {
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
            calibration_white_xy: if d65.is_some() {
                illuminant_white_xy(Illuminant::D65)
            } else {
                candidates
                    .first()
                    .and_then(|candidate| illuminant_white_xy(candidate.0))
            },
            report: RawCameraProfileReport {
                algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
                candidate_count,
                cct_clamped: None,
                cool_illuminant: None,
                cool_weight: None,
                estimated_cct_kelvin: None,
                fallback_reason: Some(fallback_reason),
                illuminant_estimate_confidence: "low",
                illuminant_estimate_method: "fallback",
                matrix_hash: selected.as_deref().map(camera_matrix_hash),
                profile_illuminant_duv: None,
                profile_illuminant_xy: None,
                status: if selected.is_some() {
                    "fallback"
                } else {
                    "unavailable"
                },
                warm_illuminant: None,
                white_balance_plan_fingerprint: None,
                warning_codes: vec![fallback_reason],
            },
        };
    };
    let target_cct = cct_estimate.cct_kelvin;
    let profile_illuminant_xy = plan_illuminant
        .map(|illuminant| illuminant.xy)
        .or_else(|| cct_to_xy(target_cct));
    let profile_illuminant_duv = plan_illuminant.map(|illuminant| illuminant.duv);
    let white_balance_plan_fingerprint =
        plan_illuminant.map(|illuminant| illuminant.fingerprint.to_string());

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
                calibration_white_xy: profile_illuminant_xy,
                report: RawCameraProfileReport {
                    algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
                    candidate_count,
                    cct_clamped: Some(cct_estimate.clamped),
                    cool_illuminant: Some(illuminant_label(cool.0)),
                    cool_weight: Some(cool_weight),
                    estimated_cct_kelvin: Some(target_cct),
                    fallback_reason: None,
                    illuminant_estimate_confidence: cct_estimate.confidence,
                    illuminant_estimate_method: cct_estimate.method,
                    matrix_hash: Some(camera_matrix_hash(&matrix)),
                    profile_illuminant_duv,
                    profile_illuminant_xy,
                    status: "interpolated",
                    warm_illuminant: Some(illuminant_label(warm.0)),
                    white_balance_plan_fingerprint,
                    warning_codes: Vec::new(),
                },
                matrix: Some(matrix),
            };
        }

        let matrix = warm.2.to_vec();
        return CameraProfileResolution {
            calibration_white_xy: profile_illuminant_xy,
            report: RawCameraProfileReport {
                algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
                candidate_count,
                cct_clamped: Some(cct_estimate.clamped),
                cool_illuminant: Some(illuminant_label(warm.0)),
                cool_weight: Some(1.0),
                estimated_cct_kelvin: Some(target_cct),
                fallback_reason: None,
                illuminant_estimate_confidence: cct_estimate.confidence,
                illuminant_estimate_method: cct_estimate.method,
                matrix_hash: Some(camera_matrix_hash(&matrix)),
                profile_illuminant_duv,
                profile_illuminant_xy,
                status: "single_illuminant",
                warm_illuminant: Some(illuminant_label(warm.0)),
                white_balance_plan_fingerprint,
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
        calibration_white_xy: profile_illuminant_xy.or_else(|| {
            candidates
                .first()
                .and_then(|candidate| illuminant_white_xy(candidate.0))
        }),
        report: RawCameraProfileReport {
            algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
            candidate_count,
            cct_clamped: Some(cct_estimate.clamped),
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
            illuminant_estimate_confidence: cct_estimate.confidence,
            illuminant_estimate_method: cct_estimate.method,
            matrix_hash: selected.as_deref().map(camera_matrix_hash),
            profile_illuminant_duv,
            profile_illuminant_xy,
            status: if selected.is_some() {
                "single_illuminant"
            } else {
                "unavailable"
            },
            warm_illuminant: candidates
                .first()
                .map(|candidate| illuminant_label(candidate.0)),
            white_balance_plan_fingerprint,
            warning_codes: if selected.is_some() {
                vec!["single_valid_camera_matrix"]
            } else {
                vec!["no_valid_camera_matrix"]
            },
        },
    }
}

fn apply_dual_illuminant_camera_profile(
    raw_image: &mut RawImage,
    white_balance_plan: Option<&WhiteBalancePlanV1>,
) -> CameraProfileResolution {
    let wb = if raw_image.wb_coeffs[0].is_nan() {
        [1.0, 1.0, 1.0, 1.0]
    } else {
        raw_image.wb_coeffs
    };
    let resolution = resolve_camera_color_profile(&raw_image.color_matrix, wb, white_balance_plan);
    if let Some(color_matrix) = resolution.matrix.clone() {
        raw_image.color_matrix.clear();
        raw_image.color_matrix.insert(Illuminant::D65, color_matrix);
    }
    resolution
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
    Ok((
        apply_default_crop(&scaled, Intermediate::ThreeColor(demosaiced)),
        BayerHqDevelopmentReport {
            artifact_suppression: suppression_report,
        },
    ))
}

fn develop_xtrans_hq_intermediate(
    raw_image: &RawImage,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<(Intermediate, XTransHqDevelopmentReport)> {
    let mut scaled = raw_image.clone();
    scaled.apply_scaling()?;
    let RawPhotometricInterpretation::Cfa(config) = &scaled.photometric else {
        return Err(anyhow!("X-Trans HQ requires CFA RAW input"));
    };

    let pixels = rawler::pixarray::PixF32::new_with(
        scaled.data.as_f32().into_owned(),
        scaled.width,
        scaled.height,
    );
    let roi = scaled.active_area.unwrap_or(pixels.rect());
    let (demosaiced, reconstruction_report) =
        crate::xtrans_hq::demosaic_xtrans_hq_with_cancel(&pixels, &config.cfa, roi, || {
            if let Some((tracker, generation)) = &cancel_token
                && tracker.load(Ordering::SeqCst) != *generation
            {
                return Err(anyhow!("Load cancelled"));
            }
            Ok(())
        })?;
    Ok((
        apply_default_crop(&scaled, Intermediate::ThreeColor(demosaiced)),
        XTransHqDevelopmentReport {
            reconstruction: reconstruction_report,
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
    let source = RawSource::new_from_slice(file_bytes);
    develop_internal_from_source(
        &source,
        fast_demosaic,
        profile,
        highlight_compression,
        linear_mode,
        cancel_token,
        defect_options,
    )
}

fn develop_internal_from_source(
    source: &RawSource,
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

    let decoder = rawler::get_decoder(source)?;

    check_cancel()?;
    let mut raw_image: RawImage = decoder.raw_image(source, &RawDecodeParams::default(), false)?;

    let metadata = decoder.raw_metadata(source, &RawDecodeParams::default())?;
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

    let profile_resolution = if apply_calibration {
        apply_dual_illuminant_camera_profile(
            &mut raw_image,
            defect_options.white_balance_plan.as_ref(),
        )
    } else {
        CameraProfileResolution {
            matrix: None,
            calibration_white_xy: None,
            report: RawCameraProfileReport::unavailable(
                "calibration_disabled",
                raw_image.color_matrix.len(),
            ),
        }
    };
    let camera_profile = profile_resolution.report.clone();
    if apply_calibration && is_linear_format {
        return Err(anyhow!("raw_input_transform_unsupported_linear_raw"));
    }

    for level in raw_image.whitelevel.0.iter_mut() {
        *level = u32::MAX;
    }

    let mut developer = RawDevelop::default();
    let use_bayer_hq = profile == RawProcessingProfile::Maximum
        && !fast_demosaic
        && !is_linear_format
        && is_rgb_bayer_raw(&raw_image)
        && apply_calibration;
    let use_xtrans_hq = profile == RawProcessingProfile::Maximum
        && !fast_demosaic
        && !is_linear_format
        && is_rgb_xtrans_raw(&raw_image)
        && apply_calibration;
    let demosaic_path = if use_bayer_hq {
        RawDemosaicPath::BayerHq
    } else if use_xtrans_hq {
        RawDemosaicPath::XTransHq
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
        developer.steps.retain(|&step| {
            !matches!(
                step,
                ProcessingStep::SRgb | ProcessingStep::Calibrate | ProcessingStep::WhiteBalance
            )
        });
    } else {
        developer.steps.retain(|&step| {
            !matches!(
                step,
                ProcessingStep::SRgb | ProcessingStep::Calibrate | ProcessingStep::WhiteBalance
            )
        });
    }

    check_cancel()?;
    let mut xtrans_hq_report = None;
    let mut developed_intermediate = if use_bayer_hq {
        develop_bayer_hq_intermediate(&raw_image)?.0
    } else if use_xtrans_hq {
        let (intermediate, report) =
            develop_xtrans_hq_intermediate(&raw_image, cancel_token.clone())?;
        xtrans_hq_report = Some(report);
        intermediate
    } else {
        developer.develop_intermediate(&raw_image)?
    };

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
        Intermediate::ThreeColor(pixels) => pixels.data.iter_mut().for_each(|p| {
            p[0] *= rescale_factor;
            p[1] *= rescale_factor;
            p[2] *= rescale_factor;
        }),
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

    let input_transform = if apply_calibration {
        let Intermediate::ThreeColor(pixels) = &mut developed_intermediate else {
            return Err(anyhow!("raw_input_transform_unsupported_pixel_domain"));
        };
        let matrix = profile_resolution
            .matrix
            .as_deref()
            .ok_or_else(|| anyhow!("raw_input_transform_missing_camera_matrix"))?;
        let white = profile_resolution
            .calibration_white_xy
            .ok_or_else(|| anyhow!("raw_input_transform_unknown_calibration_white"))?;
        let matrix_hash = camera_profile
            .matrix_hash
            .as_deref()
            .ok_or_else(|| anyhow!("raw_input_transform_missing_matrix_hash"))?;
        let wb = CameraRgbWhiteBalanceGains::from_rawler(raw_image.wb_coeffs)?;
        let camera_id = format!(
            "{} {}",
            raw_image.clean_make.trim(),
            raw_image.clean_model.trim()
        );
        Some(apply_camera_input_transform(
            &mut pixels.data,
            CameraInputTransform {
                camera_make_model_id: camera_id.trim(),
                resolver_algorithm_id: CAMERA_PROFILE_RESOLVER_ALGORITHM_ID,
                selected_matrix_sha256: matrix_hash,
                xyz_to_camera: XyzToCameraMatrix::from_row_major(matrix)?,
                calibration_white_xy: white,
                as_shot_wb: wb,
                sensor_floor_count: 0,
            },
        )?)
    } else {
        None
    };
    drop(raw_image);

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
            if let Some(receipt) = input_transform.clone() {
                RawWorkingImageV1 {
                    pixels: buffer,
                    domain: AcesCgLinearV1,
                    input_transform_receipt: receipt,
                }
                .into_dynamic_image()
            } else {
                DynamicImage::ImageRgba32F(buffer)
            }
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
            demosaic_algorithm_id: if use_xtrans_hq {
                Some(crate::xtrans_hq::XTRANS_HQ_ALGORITHM_ID)
            } else {
                None
            },
            processing_profile: profile,
            camera_profile,
            input_transform,
            runtime: None,
            xtrans_hq: xtrans_hq_report,
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
    use serde::Deserialize;
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
    fn scene_cct_uses_camera_neutral_and_calibration_responses() {
        let matrix = vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let candidates = [
            (Illuminant::A, 2_856.0, matrix.as_slice()),
            (Illuminant::D65, 6_504.0, matrix.as_slice()),
        ];
        let warm =
            camera_white_chroma(&matrix, illuminant_white_xy(Illuminant::A).unwrap()).unwrap();
        let cool =
            camera_white_chroma(&matrix, illuminant_white_xy(Illuminant::D65).unwrap()).unwrap();
        let observed = [
            warm[0] * 0.75 + cool[0] * 0.25,
            warm[1] * 0.75 + cool[1] * 0.25,
        ];
        let wb = [
            (-observed[0]).exp() as f32,
            1.0,
            (-observed[1]).exp() as f32,
            f32::NAN,
        ];
        let estimate = estimate_scene_cct_from_camera_neutral(wb, &candidates).unwrap();

        assert_eq!(estimate.method, "camera_neutral_profile_projection");
        assert_eq!(estimate.confidence, "high");
        assert!(!estimate.clamped);
        assert!((estimate.cct_kelvin - 3_493.0).abs() < 2.0, "{estimate:?}");
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
        let target_cct = 4_000.0;
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
        let warm = vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let cool = vec![0.95, 0.01, 0.0, 0.0, 1.02, 0.0, 0.0, 0.01, 0.94];
        let mut color_matrices = HashMap::new();
        color_matrices.insert(Illuminant::A, warm.clone());
        color_matrices.insert(Illuminant::D65, cool.clone());
        let warm_chroma =
            camera_white_chroma(&warm, illuminant_white_xy(Illuminant::A).unwrap()).unwrap();
        let cool_chroma =
            camera_white_chroma(&cool, illuminant_white_xy(Illuminant::D65).unwrap()).unwrap();
        let observed = [
            (warm_chroma[0] + cool_chroma[0]) * 0.5,
            (warm_chroma[1] + cool_chroma[1]) * 0.5,
        ];
        let wb = [
            (-observed[0]).exp() as f32,
            1.0,
            (-observed[1]).exp() as f32,
            f32::NAN,
        ];

        let resolution = resolve_camera_color_profile(&color_matrices, wb, None);
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
        assert_eq!(
            resolution.report.illuminant_estimate_method,
            "camera_neutral_profile_projection"
        );
        assert_eq!(resolution.report.illuminant_estimate_confidence, "high");
        assert_eq!(resolution.report.cct_clamped, Some(false));
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
    fn explicit_white_balance_plan_is_camera_profile_interpolation_authority() {
        let warm = vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let cool = vec![0.8, 0.02, 0.0, 0.0, 1.1, 0.0, 0.0, 0.01, 0.7];
        let color_matrices = HashMap::from([
            (Illuminant::A, warm.clone()),
            (Illuminant::D65, cool.clone()),
        ]);
        let plan = compile_white_balance_plan(WhiteBalancePlanInputV1 {
            mode: WhiteBalanceModeV1::KelvinTint,
            kelvin: 4_200.0,
            duv: 0.012,
            x: None,
            y: None,
            input_semantics: Default::default(),
            camera_channel_gains: None,
        })
        .unwrap();

        let first = resolve_camera_color_profile(
            &color_matrices,
            [f32::NAN, 1.0, f32::NAN, f32::NAN],
            Some(&plan),
        );
        let second =
            resolve_camera_color_profile(&color_matrices, [8.0, 1.0, 0.125, f32::NAN], Some(&plan));
        let daylight_plan = compile_white_balance_plan(WhiteBalancePlanInputV1 {
            mode: WhiteBalanceModeV1::Preset,
            kelvin: 6_000.0,
            duv: -0.004,
            x: None,
            y: None,
            input_semantics: Default::default(),
            camera_channel_gains: None,
        })
        .unwrap();
        let daylight = resolve_camera_color_profile(
            &color_matrices,
            [8.0, 1.0, 0.125, f32::NAN],
            Some(&daylight_plan),
        );

        assert_eq!(
            first.matrix, second.matrix,
            "metadata WB cannot override the explicit plan"
        );
        assert_eq!(
            first.report.illuminant_estimate_method,
            "white_balance_plan_v1"
        );
        assert_eq!(first.report.estimated_cct_kelvin, Some(4_200.0));
        assert_eq!(first.report.profile_illuminant_duv, Some(0.012));
        assert_eq!(
            first.report.profile_illuminant_xy,
            Some(plan.source_illuminant.xy)
        );
        assert_eq!(
            first.report.white_balance_plan_fingerprint.as_deref(),
            Some(plan.fingerprint.as_str())
        );
        assert_eq!(first.calibration_white_xy, Some(plan.source_illuminant.xy));
        assert_ne!(first.matrix, Some(warm));
        assert_ne!(first.matrix, Some(cool));
        assert_ne!(first.matrix, daylight.matrix);
        assert_ne!(
            first.report.white_balance_plan_fingerprint,
            daylight.report.white_balance_plan_fingerprint
        );
        assert_eq!(
            daylight.report.profile_illuminant_xy,
            Some(daylight_plan.source_illuminant.xy)
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
            resolve_camera_color_profile(&color_matrices, [f32::NAN, 1.0, 1.0, f32::NAN], None);
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
        assert_eq!(resolution.report.illuminant_estimate_method, "fallback");
        assert_eq!(resolution.report.illuminant_estimate_confidence, "low");
        assert_eq!(resolution.report.cct_clamped, None);
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
            white_balance_plan: None,
        };
        let (uncorrected, uncorrected_orientation, _) = develop_internal_with_options(
            &file_bytes,
            false,
            RawProcessingProfile::Balanced,
            2.5,
            "default".to_string(),
            None,
            proof_options.clone(),
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
        const MIN_CHANGED_PIXEL_RATIO: f64 = 0.001;
        const MIN_MEAN_ABSOLUTE_BYTE_DELTA: f64 = 0.01;
        assert!(changed_pixel_ratio > MIN_CHANGED_PIXEL_RATIO);
        assert!(mean_absolute_byte_delta > MIN_MEAN_ABSOLUTE_BYTE_DELTA);

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

    #[test]
    fn private_xtrans_hq_generates_distinct_maximum_output_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_XTRANS_HQ_PROOF").ok() != Some("1".to_string()) {
            return;
        }

        let source_paths = private_xtrans_source_paths();
        assert!(
            !source_paths.is_empty(),
            "RAWENGINE_PRIVATE_RAW_SOURCE, RAWENGINE_XTRANS_HQ_SOURCE, RAWENGINE_XTRANS_HQ_SOURCE_LIST, or RAWENGINE_PRIVATE_RAW_ROOT must select at least one X-Trans RAW candidate"
        );
        let report_dir = std::env::var("RAWENGINE_XTRANS_HQ_REPORT_DIR")
            .unwrap_or_else(|_| "target/xtrans-hq-proof".to_string());
        let report_dir = Path::new(&report_dir);
        fs::create_dir_all(report_dir).expect("create report dir");

        let mut source_reports = Vec::new();
        for source_path in source_paths {
            source_reports.push(private_xtrans_hq_source_proof(&source_path, report_dir));
        }
        assert!(!source_reports.is_empty());

        let report = serde_json::json!({
            "issues": [3240, 3817, 3818],
            "proofBoundary": "private_xtrans_hq_runtime_acceptance",
            "sourceCount": source_reports.len(),
            "sources": source_reports,
            "manualReviewRequired": true,
            "privateAssetsCommitted": false,
        });
        fs::write(
            report_dir.join("xtrans-hq-private-proof.json"),
            serde_json::to_vec_pretty(&report).expect("serialize X-Trans HQ proof report"),
        )
        .expect("write X-Trans HQ proof report");
    }

    fn private_xtrans_hq_source_proof(source_path: &str, report_dir: &Path) -> serde_json::Value {
        let file_bytes = fs::read(source_path).expect("read private X-Trans RAW");
        let source_hash = blake3::hash(&file_bytes).to_hex().to_string();
        let source_artifact_id = &source_hash[..12];
        let (balanced, balanced_orientation, balanced_report) = develop_internal_with_options(
            &file_bytes,
            false,
            RawProcessingProfile::Balanced,
            2.5,
            "default".to_string(),
            None,
            RawDefectDevelopmentOptions::default(),
        )
        .expect("develop balanced private X-Trans RAW");
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
        .expect("develop X-Trans HQ private RAW");
        let maximum_elapsed_ms = started.elapsed().as_millis();
        let maximum = apply_orientation(maximum, maximum_orientation);

        assert_eq!(balanced_report.demosaic_path, RawDemosaicPath::Standard);
        assert_eq!(maximum_report.demosaic_path, RawDemosaicPath::XTransHq);
        assert_eq!(
            maximum_report.demosaic_algorithm_id,
            Some(crate::xtrans_hq::XTRANS_HQ_ALGORITHM_ID)
        );
        let xtrans_report = maximum_report
            .xtrans_hq
            .expect("maximum X-Trans report includes reconstruction details");
        assert!(xtrans_report.reconstruction.evaluated_pixels > 0);
        assert!(xtrans_report.reconstruction.green_directional_pixels > 0);

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
        const MIN_CHANGED_PIXEL_RATIO: f64 = 0.001;
        const MIN_MEAN_ABSOLUTE_BYTE_DELTA: f64 = 0.01;
        assert!(changed_pixel_ratio > MIN_CHANGED_PIXEL_RATIO);
        assert!(mean_absolute_byte_delta > MIN_MEAN_ABSOLUTE_BYTE_DELTA);

        let balanced_path = report_dir.join(format!(
            "xtrans-{source_artifact_id}-balanced-standard.tiff"
        ));
        let maximum_path = report_dir.join(format!("xtrans-{source_artifact_id}-maximum-hq.tiff"));
        let preview_before_path = report_dir.join(format!(
            "xtrans-{source_artifact_id}-preview-before-standard.png"
        ));
        let preview_after_path =
            report_dir.join(format!("xtrans-{source_artifact_id}-preview-after-hq.png"));
        let export_after_path =
            report_dir.join(format!("xtrans-{source_artifact_id}-export-after-hq.tiff"));
        balanced
            .save_with_format(&balanced_path, image::ImageFormat::Tiff)
            .expect("write balanced X-Trans TIFF");
        maximum
            .save_with_format(&maximum_path, image::ImageFormat::Tiff)
            .expect("write X-Trans HQ TIFF");
        image::DynamicImage::ImageRgba8(balanced_rgba)
            .save_with_format(&preview_before_path, image::ImageFormat::Png)
            .expect("write X-Trans preview-before PNG");
        image::DynamicImage::ImageRgba8(maximum_rgba.clone())
            .save_with_format(&preview_after_path, image::ImageFormat::Png)
            .expect("write X-Trans preview-after PNG");
        maximum
            .save_with_format(&export_after_path, image::ImageFormat::Tiff)
            .expect("write X-Trans export-after TIFF");

        let preview_before = image::open(&preview_before_path)
            .expect("decode X-Trans preview-before PNG")
            .to_rgba8();
        let preview_after = image::open(&preview_after_path)
            .expect("decode X-Trans preview-after PNG")
            .to_rgba8();
        assert!(export_after_path.exists());
        assert_eq!(preview_after.dimensions(), maximum_rgba.dimensions());
        let preview_before_hash = blake3::hash(preview_before.as_raw()).to_hex().to_string();
        let preview_after_hash = blake3::hash(preview_after.as_raw()).to_hex().to_string();
        let export_after_hash = maximum_hash.clone();

        let preview_export_mean_abs_delta =
            mean_abs_byte_delta(preview_after.as_raw(), maximum_rgba.as_raw());
        const MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA: f64 = 0.0;
        assert_eq!(
            preview_export_mean_abs_delta,
            MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA
        );

        let export_settings = crate::app_settings::AppSettings {
            raw_processing_mode: Some("maximum".to_string()),
            raw_highlight_compression: Some(4.0),
            raw_preprocessing_color_nr: Some(0.65),
            raw_preprocessing_sharpening: Some(0.42),
            raw_preprocessing_sharpening_detail: Some(0.62),
            raw_preprocessing_sharpening_edge_masking: Some(0.42),
            raw_preprocessing_sharpening_radius: Some(0.82),
            apply_preprocessing_to_non_raws: Some(false),
            ..crate::app_settings::AppSettings::default()
        };
        let (_, export_loader_report) = crate::image_loader::load_and_composite_with_report(
            &file_bytes,
            source_path,
            &serde_json::json!({ "rawProcessingModeOverride": "maximum" }),
            false,
            &export_settings,
            None,
        )
        .expect("export loader uses maximum raw processing mode");
        let export_loader_report =
            export_loader_report.expect("export loader returns raw development report");
        assert_eq!(
            export_loader_report.demosaic_path,
            RawDemosaicPath::XTransHq
        );
        assert_eq!(
            export_loader_report.demosaic_algorithm_id,
            Some(crate::xtrans_hq::XTRANS_HQ_ALGORITHM_ID)
        );

        let quality_metrics = serde_json::json!([
            {
                "name": "changedPixelRatio",
                "value": changed_pixel_ratio,
                "threshold": MIN_CHANGED_PIXEL_RATIO,
                "operator": "gt",
                "passed": changed_pixel_ratio > MIN_CHANGED_PIXEL_RATIO,
            },
            {
                "name": "meanAbsoluteByteDelta",
                "value": mean_absolute_byte_delta,
                "threshold": MIN_MEAN_ABSOLUTE_BYTE_DELTA,
                "operator": "gt",
                "passed": mean_absolute_byte_delta > MIN_MEAN_ABSOLUTE_BYTE_DELTA,
            },
            {
                "name": "previewExportMeanAbsDelta",
                "value": preview_export_mean_abs_delta,
                "threshold": MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA,
                "operator": "eq",
                "passed": preview_export_mean_abs_delta == MAX_PREVIEW_EXPORT_MEAN_ABS_DELTA,
            },
        ]);
        assert!(
            quality_metrics
                .as_array()
                .expect("quality metrics array")
                .iter()
                .all(|metric| metric["passed"].as_bool() == Some(true))
        );

        serde_json::json!({
            "proofBoundary": "private_xtrans_hq_runtime_preview_export_parity",
            "sourcePath": source_path,
            "dimensions": {
                "width": maximum.width(),
                "height": maximum.height(),
            },
            "baseImageHash": format!("blake3:{source_hash}"),
            "balanced": {
                "algorithm": "rawler_xtrans_quality_baseline",
                "demosaicPath": format!("{:?}", balanced_report.demosaic_path),
                "imageHash": balanced_hash,
                "tiffPath": balanced_path.to_string_lossy(),
            },
            "maximum": {
                "algorithm": crate::xtrans_hq::XTRANS_HQ_ALGORITHM_ID,
                "demosaicPath": format!("{:?}", maximum_report.demosaic_path),
                "elapsedMs": maximum_elapsed_ms,
                "imageHash": maximum_hash,
                "tiffPath": maximum_path.to_string_lossy(),
                "reconstruction": xtrans_report.reconstruction,
            },
            "previewExportParity": {
                "rawProcessingModeOverride": "maximum",
                "rawDemosaicPath": format!("{:?}", maximum_report.demosaic_path),
                "demosaicAlgorithmId": maximum_report.demosaic_algorithm_id,
                "baseImageHash": format!("blake3:{source_hash}"),
                "previewBeforeHash": format!("blake3:{preview_before_hash}"),
                "previewAfterHash": format!("blake3:{preview_after_hash}"),
                "exportAfterHash": format!("blake3:{export_after_hash}"),
                "previewBeforePath": preview_before_path.to_string_lossy(),
                "previewAfterPath": preview_after_path.to_string_lossy(),
                "exportAfterPath": export_after_path.to_string_lossy(),
                "previewAfterFormat": "png",
                "exportAfterFormat": "tiff",
                "previewExportMeanAbsDelta": preview_export_mean_abs_delta,
                "exportLoaderRawDemosaicPath": format!("{:?}", export_loader_report.demosaic_path),
                "exportLoaderDemosaicAlgorithmId": export_loader_report.demosaic_algorithm_id,
            },
            "qualityMetrics": quality_metrics,
            "outputDiff": {
                "changedPixelRatio": changed_pixel_ratio,
                "meanAbsoluteByteDelta": mean_absolute_byte_delta,
            },
            "privateAssetsCommitted": false,
        })
    }

    fn private_xtrans_source_paths() -> Vec<String> {
        if let Ok(source_list) = std::env::var("RAWENGINE_XTRANS_HQ_SOURCE_LIST") {
            return source_list
                .lines()
                .flat_map(|line| line.split(','))
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(ToString::to_string)
                .collect();
        }

        if let Ok(source_path) = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE")
            .or_else(|_| std::env::var("RAWENGINE_XTRANS_HQ_SOURCE"))
        {
            return vec![source_path];
        }

        if let Ok(root) = std::env::var("RAWENGINE_PRIVATE_RAW_ROOT") {
            let mut paths = Vec::new();
            collect_private_raw_candidates(Path::new(&root), &mut paths);
            paths.sort();
            return paths;
        }

        Vec::new()
    }

    fn collect_private_raw_candidates(root: &Path, paths: &mut Vec<String>) {
        let Ok(entries) = fs::read_dir(root) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_private_raw_candidates(&path, paths);
                continue;
            }
            let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
                continue;
            };
            if extension.eq_ignore_ascii_case("raf") {
                paths.push(path.to_string_lossy().to_string());
            }
        }
    }

    fn mean_abs_byte_delta(first: &[u8], second: &[u8]) -> f64 {
        assert_eq!(first.len(), second.len());
        let mut mean = 0.0;
        for (index, (first_value, second_value)) in first.iter().zip(second.iter()).enumerate() {
            let delta = first_value.abs_diff(*second_value) as f64 / 255.0;
            mean += (delta - mean) / (index + 1) as f64;
        }
        mean
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateColorCheckerManifest {
        captures: Vec<PrivateColorCheckerCapture>,
        proof_boundary: String,
        schema_version: u8,
        thresholds: PrivateColorCheckerThresholds,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateColorCheckerCapture {
        capture_id: String,
        illuminant_label: String,
        measured_cct_kelvin: Option<f32>,
        patches: Vec<PrivateColorCheckerPatch>,
        source_path: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateColorCheckerPatch {
        id: String,
        reference_lab: PrivateLabColor,
        roi: PrivateColorCheckerRoi,
        role: String,
    }

    #[derive(Clone, Copy, Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateColorCheckerRoi {
        height: u32,
        width: u32,
        x: u32,
        y: u32,
    }

    #[derive(Clone, Copy, Debug, Deserialize, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateLabColor {
        l: f64,
        a: f64,
        b: f64,
    }

    #[derive(Debug, Deserialize, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateColorCheckerThresholds {
        delta_e00_max_max: f64,
        delta_e00_mean_max: f64,
        delta_e00_p95_max: f64,
        neutral_chroma_max: f64,
    }

    fn load_private_colorchecker_manifest() -> Option<PrivateColorCheckerManifest> {
        let manifest_path =
            std::env::var("RAWENGINE_DUAL_ILLUMINANT_COLORCHECKER_MANIFEST").ok()?;
        let manifest: PrivateColorCheckerManifest =
            serde_json::from_slice(&fs::read(manifest_path).expect("read ColorChecker manifest"))
                .expect("parse ColorChecker manifest");
        assert_eq!(manifest.schema_version, 1);
        assert_eq!(
            manifest.proof_boundary,
            "private_dual_illuminant_colorchecker_manifest"
        );
        assert!(!manifest.captures.is_empty());
        Some(manifest)
    }

    fn colorchecker_capture_for_source<'a>(
        manifest: &'a PrivateColorCheckerManifest,
        source_path: &str,
    ) -> &'a PrivateColorCheckerCapture {
        manifest
            .captures
            .iter()
            .find(|capture| {
                capture
                    .source_path
                    .as_deref()
                    .is_none_or(|manifest_source| manifest_source == source_path)
            })
            .expect("ColorChecker manifest must include the active source")
    }

    fn sample_colorchecker_patches(
        image: &DynamicImage,
        capture: &PrivateColorCheckerCapture,
        report_dir: &Path,
    ) -> serde_json::Value {
        let rgba = image.to_rgba8();
        let width = rgba.width();
        let height = rgba.height();
        let patch_measurements = capture
            .patches
            .iter()
            .map(|patch| {
                let measured_lab = sample_roi_lab(&rgba, patch.roi);
                let neutral_chroma = if patch.role == "neutral" {
                    Some((measured_lab.a.powi(2) + measured_lab.b.powi(2)).sqrt())
                } else {
                    None
                };
                serde_json::json!({
                    "id": patch.id,
                    "role": patch.role,
                    "roi": {
                        "x": patch.roi.x,
                        "y": patch.roi.y,
                        "width": patch.roi.width,
                        "height": patch.roi.height,
                    },
                    "referenceLab": patch.reference_lab,
                    "measuredLab": measured_lab,
                    "neutralChroma": neutral_chroma,
                })
            })
            .collect::<Vec<_>>();
        let overlay_path = write_colorchecker_overlay(&rgba, capture, report_dir);
        let patch_csv_path = write_colorchecker_patch_csv(capture, &patch_measurements, report_dir);
        let summary_csv_path =
            write_colorchecker_summary_csv(capture, patch_measurements.len(), report_dir);

        serde_json::json!({
            "proofBoundary": "private_dual_illuminant_colorchecker_runtime_sampling",
            "colorimetricProof": true,
            "captureId": capture.capture_id,
            "illuminantLabel": capture.illuminant_label,
            "measuredCctKelvin": capture.measured_cct_kelvin,
            "imageDimensions": {
                "width": width,
                "height": height,
            },
            "patchCount": patch_measurements.len(),
            "artifacts": {
                "overlayPath": overlay_path.to_string_lossy(),
                "patchCsvPath": patch_csv_path.to_string_lossy(),
                "summaryCsvPath": summary_csv_path.to_string_lossy(),
            },
            "patches": patch_measurements,
        })
    }

    fn write_colorchecker_overlay(
        image: &image::RgbaImage,
        capture: &PrivateColorCheckerCapture,
        report_dir: &Path,
    ) -> std::path::PathBuf {
        let overlay_dir = report_dir.join("overlays");
        fs::create_dir_all(&overlay_dir).expect("create ColorChecker overlay dir");
        let mut overlay = image.clone();
        for patch in &capture.patches {
            draw_roi_outline(&mut overlay, patch.roi);
        }
        let overlay_path = overlay_dir.join(format!(
            "{}-rois.png",
            safe_artifact_stem(&capture.capture_id)
        ));
        overlay
            .save(&overlay_path)
            .expect("write ColorChecker overlay");
        overlay_path
    }

    fn draw_roi_outline(image: &mut image::RgbaImage, roi: PrivateColorCheckerRoi) {
        let color = Rgba([255, 32, 32, 255]);
        let x_end = roi.x + roi.width - 1;
        let y_end = roi.y + roi.height - 1;
        for x in roi.x..=x_end {
            image.put_pixel(x, roi.y, color);
            image.put_pixel(x, y_end, color);
        }
        for y in roi.y..=y_end {
            image.put_pixel(roi.x, y, color);
            image.put_pixel(x_end, y, color);
        }
    }

    fn write_colorchecker_patch_csv(
        capture: &PrivateColorCheckerCapture,
        patches: &[serde_json::Value],
        report_dir: &Path,
    ) -> std::path::PathBuf {
        let path = report_dir.join("dual-illuminant-profile-patches.csv");
        let mut csv = String::from(
            "captureId,illuminantLabel,patchId,role,roiX,roiY,roiWidth,roiHeight,referenceL,referenceA,referenceB,measuredL,measuredA,measuredB,neutralChroma\n",
        );
        for patch in patches {
            csv.push_str(&format!(
                "{},{},{},{},{},{},{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{}\n",
                capture.capture_id,
                capture.illuminant_label,
                patch["id"].as_str().expect("patch id"),
                patch["role"].as_str().expect("patch role"),
                patch["roi"]["x"].as_u64().expect("roi x"),
                patch["roi"]["y"].as_u64().expect("roi y"),
                patch["roi"]["width"].as_u64().expect("roi width"),
                patch["roi"]["height"].as_u64().expect("roi height"),
                patch["referenceLab"]["l"].as_f64().expect("reference l"),
                patch["referenceLab"]["a"].as_f64().expect("reference a"),
                patch["referenceLab"]["b"].as_f64().expect("reference b"),
                patch["measuredLab"]["l"].as_f64().expect("measured l"),
                patch["measuredLab"]["a"].as_f64().expect("measured a"),
                patch["measuredLab"]["b"].as_f64().expect("measured b"),
                patch["neutralChroma"]
                    .as_f64()
                    .map(|value| format!("{value:.6}"))
                    .unwrap_or_default(),
            ));
        }
        fs::write(&path, csv).expect("write ColorChecker patch CSV");
        path
    }

    fn write_colorchecker_summary_csv(
        capture: &PrivateColorCheckerCapture,
        patch_count: usize,
        report_dir: &Path,
    ) -> std::path::PathBuf {
        let path = report_dir.join("dual-illuminant-profile-summary.csv");
        fs::write(
            &path,
            format!(
                "captureId,illuminantLabel,measuredCctKelvin,patchCount\n{},{},{},{}\n",
                capture.capture_id,
                capture.illuminant_label,
                capture
                    .measured_cct_kelvin
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                patch_count,
            ),
        )
        .expect("write ColorChecker summary CSV");
        path
    }

    fn safe_artifact_stem(value: &str) -> String {
        value
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                    character
                } else {
                    '-'
                }
            })
            .collect()
    }

    fn sample_roi_lab(image: &image::RgbaImage, roi: PrivateColorCheckerRoi) -> PrivateLabColor {
        assert!(roi.width > 0);
        assert!(roi.height > 0);
        assert!(roi.x + roi.width <= image.width());
        assert!(roi.y + roi.height <= image.height());

        let mut red_sum = 0.0;
        let mut green_sum = 0.0;
        let mut blue_sum = 0.0;
        let mut count = 0.0;
        for y in roi.y..roi.y + roi.height {
            for x in roi.x..roi.x + roi.width {
                let pixel = image.get_pixel(x, y).0;
                red_sum += srgb_u8_to_linear(pixel[0]);
                green_sum += srgb_u8_to_linear(pixel[1]);
                blue_sum += srgb_u8_to_linear(pixel[2]);
                count += 1.0;
            }
        }
        linear_srgb_to_lab(red_sum / count, green_sum / count, blue_sum / count)
    }

    fn srgb_u8_to_linear(value: u8) -> f64 {
        let encoded = f64::from(value) / 255.0;
        if encoded <= 0.04045 {
            encoded / 12.92
        } else {
            ((encoded + 0.055) / 1.055).powf(2.4)
        }
    }

    fn linear_srgb_to_lab(red: f64, green: f64, blue: f64) -> PrivateLabColor {
        let x = red * 0.412_456_4 + green * 0.357_576_1 + blue * 0.180_437_5;
        let y = red * 0.212_672_9 + green * 0.715_152_2 + blue * 0.072_175;
        let z = red * 0.019_333_9 + green * 0.119_192 + blue * 0.950_304_1;
        xyz_d65_to_lab(x, y, z)
    }

    fn xyz_d65_to_lab(x: f64, y: f64, z: f64) -> PrivateLabColor {
        let fx = lab_pivot(x / 0.950_47);
        let fy = lab_pivot(y);
        let fz = lab_pivot(z / 1.088_83);
        PrivateLabColor {
            l: 116.0 * fy - 16.0,
            a: 500.0 * (fx - fy),
            b: 200.0 * (fy - fz),
        }
    }

    fn lab_pivot(value: f64) -> f64 {
        const EPSILON: f64 = 216.0 / 24_389.0;
        const KAPPA: f64 = 24_389.0 / 27.0;
        if value > EPSILON {
            value.cbrt()
        } else {
            (KAPPA * value + 16.0) / 116.0
        }
    }

    #[test]
    fn private_dual_illuminant_profile_runtime_proof_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_DUAL_ILLUMINANT_PROFILE_PROOF").ok()
            != Some("1".to_string())
        {
            return;
        }

        let source_path = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE")
            .expect("RAWENGINE_PRIVATE_RAW_SOURCE must point to a private RAW");
        let colorchecker_manifest = load_private_colorchecker_manifest();
        let report_dir = std::env::var("RAWENGINE_DUAL_ILLUMINANT_PROFILE_REPORT_DIR")
            .unwrap_or_else(|_| "target/dual-illuminant-profile-proof".to_string());
        let report_dir = Path::new(&report_dir);
        fs::create_dir_all(report_dir).expect("create report dir");

        let file_bytes = fs::read(&source_path).expect("read private RAW");
        let proof_profile = match std::env::var("RAWENGINE_PRIVATE_RAW_PROFILE").as_deref() {
            Ok("fast") => RawProcessingProfile::Fast,
            Ok("maximum") => RawProcessingProfile::Maximum,
            _ => RawProcessingProfile::Balanced,
        };
        let started = std::time::Instant::now();
        let (developed, report) = develop_raw_image_with_report(
            &file_bytes,
            proof_profile == RawProcessingProfile::Fast,
            proof_profile,
            2.5,
            "default".to_string(),
            None,
        )
        .expect("develop private RAW with camera-profile report");
        let elapsed_ms = started.elapsed().as_millis();

        assert!(developed.width() > 0);
        assert!(developed.height() > 0);
        assert_eq!(
            report.camera_profile.algorithm_id,
            CAMERA_PROFILE_RESOLVER_ALGORITHM_ID
        );

        let rgba = developed.to_rgba8();
        let image_hash = format!("blake3:{}", blake3::hash(rgba.as_raw()).to_hex());
        let tiff_path = report_dir.join("dual-illuminant-profile-preview.tiff");
        developed
            .save_with_format(&tiff_path, image::ImageFormat::Tiff)
            .expect("write dual-illuminant proof TIFF");
        let colorchecker_proof = colorchecker_manifest.as_ref().map(|manifest| {
            let capture = colorchecker_capture_for_source(manifest, &source_path);
            serde_json::json!({
                "thresholds": manifest.thresholds,
                "runtimeSampling": sample_colorchecker_patches(&developed, capture, report_dir),
            })
        });

        let proof_report = serde_json::json!({
            "issue": 5327,
            "proofBoundary": "private_dual_illuminant_profile_runtime_report",
            "proofLevel": if colorchecker_proof.is_some() {
                "private_raw_colorchecker_runtime_sampling"
            } else {
                "private_raw_smoke_not_colorchecker_accuracy"
            },
            "sourcePath": source_path,
            "dimensions": {
                "width": developed.width(),
                "height": developed.height(),
            },
            "elapsedMs": elapsed_ms,
            "rawDevelopmentReport": report,
            "output": {
                "imageHash": image_hash,
                "tiffPath": tiff_path.to_string_lossy(),
            },
            "colorimetricProof": colorchecker_proof.is_some(),
            "colorCheckerProof": colorchecker_proof,
            "privateAssetsCommitted": false,
        });
        fs::write(
            report_dir.join("dual-illuminant-profile-private-proof.json"),
            serde_json::to_vec_pretty(&proof_report).expect("serialize dual-illuminant proof"),
        )
        .expect("write dual-illuminant proof report");
    }
}
