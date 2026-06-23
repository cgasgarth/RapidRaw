use crate::image_processing::apply_orientation;
use anyhow::{Result, anyhow};
use image::{DynamicImage, ImageBuffer, Rgba};
use rawler::{
    decoders::{Orientation, RawDecodeParams},
    imgop::develop::{DemosaicAlgorithm, Intermediate, ProcessingStep, RawDevelop},
    rawimage::{RawImage, RawImageData, RawPhotometricInterpretation},
    rawsource::RawSource,
};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

pub fn develop_raw_image(
    file_bytes: &[u8],
    fast_demosaic: bool,
    highlight_compression: f32,
    linear_mode: String,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<DynamicImage> {
    let (developed_image, orientation) = develop_internal_with_options(
        file_bytes,
        fast_demosaic,
        highlight_compression,
        linear_mode,
        cancel_token,
        RawDefectDevelopmentOptions::default(),
    )?;
    Ok(apply_orientation(developed_image, orientation))
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

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct RawDefectCorrectionReport {
    hot_pixels: usize,
    dead_pixels: usize,
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
    highlight_compression: f32,
    linear_mode: String,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
    defect_options: RawDefectDevelopmentOptions,
) -> Result<(DynamicImage, Orientation)> {
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

    for level in raw_image.whitelevel.0.iter_mut() {
        *level = u32::MAX;
    }

    let mut developer = RawDevelop::default();

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
    let mut developed_intermediate = developer.develop_intermediate(&raw_image)?;

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

    Ok((dynamic_image, orientation))
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
        let (uncorrected, uncorrected_orientation) = develop_internal_with_options(
            &file_bytes,
            false,
            2.5,
            "default".to_string(),
            None,
            proof_options,
        )
        .expect("develop private RAW with injected defects");
        let uncorrected = apply_orientation(uncorrected, uncorrected_orientation);

        let (corrected, corrected_orientation) = develop_internal_with_options(
            &file_bytes,
            false,
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
}
