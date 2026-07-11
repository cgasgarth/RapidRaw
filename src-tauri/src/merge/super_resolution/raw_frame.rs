use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};

use rawler::rawimage::{RawImage, RawImageData, RawPhotometricInterpretation};
use serde::{Deserialize, Serialize};

use crate::file_management::parse_virtual_path;
use crate::merge::derived_output_provenance::stable_hash;
use crate::raw_processing::decode_raw_sensor_image;

pub const SR_BAYER_INTAKE_ALGORITHM_ID: &str = "calibrated_bayer_burst_intake_v2";
pub const SR_GREEN_PROXY_ALGORITHM_ID: &str = "calibrated_green_phase_proxy_v1";
pub const SR_PROXY_CROP_VERSION: &str = "full_sensor_even_green_cells_v1";
pub const SR_PROXY_NORMALIZATION_VERSION: &str = "black_white_normalized_green_v1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionBayerCalibration {
    pub bayer_pattern: String,
    pub black_level: Vec<f32>,
    pub black_level_repeat: [usize; 3],
    pub bits_per_sample: usize,
    pub white_balance: [f32; 4],
    pub white_level: Vec<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionBayerBurstSource {
    pub block_codes: Vec<String>,
    pub calibration: SuperResolutionBayerCalibration,
    pub calibration_identity: String,
    pub camera_make: String,
    pub camera_model: String,
    pub content_hash: String,
    pub graph_revision: String,
    pub height: u32,
    pub path: String,
    pub source_index: usize,
    pub width: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionReadinessSettings {
    pub alignment_mode: String,
    pub detail_policy: String,
    pub max_preview_dimension_px: u32,
    pub output_scale: f32,
    pub quality_preference: String,
    pub reconstruction_mode: String,
    pub source_mode: String,
}

#[derive(Clone, Debug)]
pub struct GreenPhaseProxy {
    pub clipped_ratio: f32,
    pub height: usize,
    pub proxy_pixel_scale: f32,
    pub quality_score: f32,
    pub valid: Vec<bool>,
    pub values: Vec<f32>,
    pub width: usize,
}

#[derive(Clone, Debug)]
pub struct SuperResolutionRawFrame {
    pub sensor: CalibratedBayerSensor,
    pub proxy: GreenPhaseProxy,
    pub source: SuperResolutionBayerBurstSource,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CfaClass {
    R,
    G1,
    G2,
    B,
}

#[derive(Clone, Debug)]
pub struct CalibratedBayerSensor {
    pub classes: Vec<CfaClass>,
    pub height: usize,
    pub valid: Vec<bool>,
    pub values: Vec<f32>,
    pub variances: Vec<f32>,
    pub width: usize,
}

pub fn check_cancel(cancellation_token: &AtomicBool) -> Result<(), String> {
    if cancellation_token.load(Ordering::SeqCst) {
        return Err("super_resolution_registration_cancelled".to_string());
    }
    Ok(())
}

pub fn decode_bayer_burst_frame(
    virtual_path: &str,
    source_index: usize,
    max_preview_dimension_px: u32,
    cancellation_token: &AtomicBool,
) -> Result<SuperResolutionRawFrame, String> {
    check_cancel(cancellation_token)?;
    if max_preview_dimension_px == 0 {
        return Err("invalid_preview_dimension".to_string());
    }
    let source_path = parse_virtual_path(virtual_path).0;
    let bytes = fs::read(&source_path)
        .map_err(|error| format!("Failed to read {}: {error}", source_path.display()))?;
    check_cancel(cancellation_token)?;

    let decoded = decode_raw_sensor_image(&bytes)
        .map_err(|error| format!("Failed to decode {}: {error}", source_path.display()))?;
    check_cancel(cancellation_token)?;

    let raw_image = decoded.raw_image;
    let calibration = calibrated_bayer_sensor(&raw_image).map_err(|reason| {
        format!(
            "{} is not an eligible calibrated Bayer source: {reason}",
            source_path.display()
        )
    })?;
    let width = u32::try_from(raw_image.width)
        .map_err(|_| format!("{} is wider than supported by SR.", source_path.display()))?;
    let height = u32::try_from(raw_image.height)
        .map_err(|_| format!("{} is taller than supported by SR.", source_path.display()))?;
    let proxy = build_green_phase_proxy(&raw_image, max_preview_dimension_px, cancellation_token)?;
    let sensor = build_calibrated_sensor(&raw_image, cancellation_token)?;
    let calibration_identity = stable_hash(
        &serde_json::to_value(&calibration)
            .map_err(|error| format!("Failed to encode Bayer calibration identity: {error}"))?,
    );
    let content_hash = format!("blake3:{}", blake3::hash(&bytes).to_hex());

    Ok(SuperResolutionRawFrame {
        sensor,
        proxy,
        source: SuperResolutionBayerBurstSource {
            block_codes: Vec::new(),
            calibration,
            calibration_identity,
            camera_make: if raw_image.clean_make.is_empty() {
                decoded.metadata.make
            } else {
                raw_image.clean_make
            },
            camera_model: if raw_image.clean_model.is_empty() {
                decoded.metadata.model
            } else {
                raw_image.clean_model
            },
            graph_revision: format!("raw_content:{content_hash}"),
            content_hash,
            height,
            path: source_path.to_string_lossy().into_owned(),
            source_index,
            width,
        },
    })
}

fn build_calibrated_sensor(
    raw_image: &RawImage,
    cancellation_token: &AtomicBool,
) -> Result<CalibratedBayerSensor, String> {
    let RawPhotometricInterpretation::Cfa(config) = &raw_image.photometric else {
        return Err("calibrated sensor requires a CFA image".to_string());
    };
    let RawImageData::Integer(pixels) = &raw_image.data else {
        return Err("calibrated sensor requires integer samples".to_string());
    };
    let green_positions = green_offsets(&config.cfa)?;
    let count = raw_image.width * raw_image.height;
    if pixels.len() < count {
        return Err("Bayer sample dimensions do not match decoded image dimensions".to_string());
    }
    let mut values = Vec::with_capacity(count);
    let mut variances = Vec::with_capacity(count);
    let mut valid = Vec::with_capacity(count);
    let mut classes = Vec::with_capacity(count);
    for y in 0..raw_image.height {
        if y % 32 == 0 {
            check_cancel(cancellation_token)?;
        }
        for x in 0..raw_image.width {
            let color = config.cfa.color_at(y, x);
            let class = match color {
                0 => CfaClass::R,
                2 => CfaClass::B,
                1 if (y % 2, x % 2) == green_positions[0] => CfaClass::G1,
                1 => CfaClass::G2,
                _ => return Err("unsupported non-RGB Bayer color".to_string()),
            };
            let sample = pixels[y * raw_image.width + x] as f32;
            let black = black_level_at(raw_image, x, y);
            let white = white_level_at(raw_image, color);
            let range = (white - black).max(1.0);
            let value = (sample - black) / range;
            let clip_guard = (range * 0.005).max(2.0);
            let is_valid = sample.is_finite()
                && sample > black
                && sample < white - clip_guard
                && x > 0
                && y > 0
                && x + 1 < raw_image.width
                && y + 1 < raw_image.height;
            // Conservative normalized read + shot variance until camera-specific noise is available.
            let variance = (4.0 / (range * range) + value.max(0.0) / range).max(1.0e-7);
            values.push(value);
            variances.push(variance);
            valid.push(is_valid);
            classes.push(class);
        }
    }
    Ok(CalibratedBayerSensor {
        classes,
        height: raw_image.height,
        valid,
        values,
        variances,
        width: raw_image.width,
    })
}

pub fn calibrated_bayer_sensor(
    raw_image: &RawImage,
) -> Result<SuperResolutionBayerCalibration, &'static str> {
    let RawPhotometricInterpretation::Cfa(config) = &raw_image.photometric else {
        return Err("decoded image is not a CFA sensor image");
    };
    if raw_image.cpp != 1 || config.cfa.width != 2 || config.cfa.height != 2 || !config.cfa.is_rgb()
    {
        return Err("only 2x2 RGB Bayer CFA sensor images are supported");
    }
    if !matches!(&raw_image.data, RawImageData::Integer(_)) {
        return Err("only integer Bayer sensor samples are supported");
    }
    if raw_image.width < 32 || raw_image.height < 32 {
        return Err("sensor dimensions are too small for deterministic registration");
    }

    Ok(SuperResolutionBayerCalibration {
        bayer_pattern: config.cfa.name.clone(),
        black_level: raw_image.blacklevel.as_vec(),
        black_level_repeat: [
            raw_image.blacklevel.width,
            raw_image.blacklevel.height,
            raw_image.blacklevel.cpp,
        ],
        bits_per_sample: raw_image.bps,
        white_balance: raw_image.wb_coeffs,
        white_level: raw_image.whitelevel.0.clone(),
    })
}

fn build_green_phase_proxy(
    raw_image: &RawImage,
    max_preview_dimension_px: u32,
    cancellation_token: &AtomicBool,
) -> Result<GreenPhaseProxy, String> {
    let RawPhotometricInterpretation::Cfa(config) = &raw_image.photometric else {
        return Err("green-phase proxy requires a CFA sensor image".to_string());
    };
    let RawImageData::Integer(pixels) = &raw_image.data else {
        return Err("green-phase proxy requires integer Bayer samples".to_string());
    };
    let width = raw_image.width / 2;
    let height = raw_image.height / 2;
    if width < 16 || height < 16 {
        return Err("green-phase proxy is too small for registration".to_string());
    }

    let mut values = vec![0.0; width * height];
    let mut valid = vec![false; width * height];
    let mut clipped_cells = 0usize;
    let green_offsets = green_offsets(&config.cfa)?;
    for proxy_y in 0..height {
        if proxy_y % 16 == 0 {
            check_cancel(cancellation_token)?;
        }
        for proxy_x in 0..width {
            let raw_x = proxy_x * 2;
            let raw_y = proxy_y * 2;
            let mut green_samples = [0.0; 2];
            let mut green_count = 0usize;
            let mut clipped = false;
            for (offset_y, offset_x) in green_offsets {
                let x = raw_x + offset_x;
                let y = raw_y + offset_y;
                let raw_index = y * raw_image.width + x;
                let sample = *pixels.get(raw_index).ok_or_else(|| {
                    "Bayer sample dimensions do not match decoded image dimensions".to_string()
                })? as f32;
                let black = black_level_at(raw_image, x, y);
                let white = white_level_at(raw_image, config.cfa.color_at(y, x));
                let range = (white - black).max(1.0);
                let normalized = ((sample - black) / range).clamp(0.0, 1.0);
                clipped |= sample >= white - (range * 0.005).max(2.0);
                if green_count < green_samples.len() {
                    green_samples[green_count] = normalized;
                    green_count += 1;
                }
            }
            if green_count != 2 {
                return Err(
                    "Bayer proxy did not find exactly two green samples per cell".to_string(),
                );
            }
            let index = proxy_y * width + proxy_x;
            values[index] = (green_samples[0] + green_samples[1]) * 0.5;
            let edge = proxy_x < 2 || proxy_y < 2 || proxy_x + 2 >= width || proxy_y + 2 >= height;
            valid[index] = !clipped && !edge;
            if clipped {
                clipped_cells += 1;
            }
        }
    }

    let proxy = GreenPhaseProxy {
        clipped_ratio: clipped_cells as f32 / (width * height) as f32,
        height,
        proxy_pixel_scale: 2.0,
        quality_score: 0.0,
        valid,
        values,
        width,
    };
    downsample_proxy(proxy, max_preview_dimension_px as usize, cancellation_token)
}

fn green_offsets(cfa: &rawler::cfa::CFA) -> Result<[(usize, usize); 2], String> {
    let positions = (0..2)
        .flat_map(|y| (0..2).map(move |x| (y, x)))
        .filter(|(y, x)| cfa.color_at(*y, *x) == 1)
        .collect::<Vec<_>>();
    positions
        .try_into()
        .map_err(|_| "Bayer proxy requires exactly two green samples in each 2x2 cell".to_string())
}

fn downsample_proxy(
    proxy: GreenPhaseProxy,
    max_dimension: usize,
    cancellation_token: &AtomicBool,
) -> Result<GreenPhaseProxy, String> {
    if max_dimension == 0 {
        return Err("invalid_preview_dimension".to_string());
    }
    let factor =
        ((proxy.width.max(proxy.height) + max_dimension.saturating_sub(1)) / max_dimension).max(1);
    if factor == 1 {
        return Ok(with_quality_score(proxy));
    }

    let width = proxy.width / factor;
    let height = proxy.height / factor;
    let mut values = vec![0.0; width * height];
    let mut valid = vec![false; width * height];
    for y in 0..height {
        if y % 8 == 0 {
            check_cancel(cancellation_token)?;
        }
        for x in 0..width {
            let mut sum = 0.0;
            let mut count = 0usize;
            for sample_y in y * factor..(y + 1) * factor {
                for sample_x in x * factor..(x + 1) * factor {
                    let sample_index = sample_y * proxy.width + sample_x;
                    if proxy.valid[sample_index] {
                        sum += proxy.values[sample_index];
                        count += 1;
                    }
                }
            }
            let index = y * width + x;
            if count * 4 >= factor * factor * 3 {
                values[index] = sum / count as f32;
                valid[index] = true;
            }
        }
    }

    Ok(with_quality_score(GreenPhaseProxy {
        clipped_ratio: proxy.clipped_ratio,
        height,
        proxy_pixel_scale: proxy.proxy_pixel_scale * factor as f32,
        quality_score: 0.0,
        valid,
        values,
        width,
    }))
}

fn with_quality_score(mut proxy: GreenPhaseProxy) -> GreenPhaseProxy {
    let mut gradient_sum = 0.0;
    let mut gradient_count = 0usize;
    let mut valid_count = 0usize;
    for y in 1..proxy.height.saturating_sub(1) {
        for x in 1..proxy.width.saturating_sub(1) {
            let index = y * proxy.width + x;
            if !proxy.valid[index] {
                continue;
            }
            valid_count += 1;
            let left = index - 1;
            let right = index + 1;
            let up = index - proxy.width;
            let down = index + proxy.width;
            if proxy.valid[left] && proxy.valid[right] && proxy.valid[up] && proxy.valid[down] {
                let gradient_x = (proxy.values[right] - proxy.values[left]) * 0.5;
                let gradient_y = (proxy.values[down] - proxy.values[up]) * 0.5;
                gradient_sum += gradient_x.hypot(gradient_y);
                gradient_count += 1;
            }
        }
    }
    let valid_ratio = valid_count as f32 / (proxy.width * proxy.height).max(1) as f32;
    let gradient = gradient_sum / gradient_count.max(1) as f32;
    proxy.quality_score =
        valid_ratio * (1.0 - proxy.clipped_ratio) * (gradient / (gradient + 0.01));
    proxy
}

fn black_level_at(raw_image: &RawImage, x: usize, y: usize) -> f32 {
    let width = raw_image.blacklevel.width.max(1);
    let height = raw_image.blacklevel.height.max(1);
    let cpp = raw_image.blacklevel.cpp.max(1);
    let index = ((y % height) * width + (x % width)) * cpp;
    raw_image
        .blacklevel
        .levels
        .get(index)
        .or_else(|| raw_image.blacklevel.levels.first())
        .map(|level| level.as_f32())
        .unwrap_or(0.0)
}

fn white_level_at(raw_image: &RawImage, color_index: usize) -> f32 {
    raw_image
        .whitelevel
        .0
        .get(color_index)
        .or_else(|| raw_image.whitelevel.0.first())
        .copied()
        .unwrap_or(u16::MAX as u32) as f32
}

#[cfg(test)]
mod tests {
    use rawler::cfa::CFA;

    use super::green_offsets;

    #[test]
    fn green_phase_proxy_accepts_all_bayer_layouts() {
        for pattern in ["RGGB", "BGGR", "GRBG", "GBRG"] {
            let cfa = CFA::new(pattern);
            let offsets = green_offsets(&cfa).expect("Bayer layout has two green samples");
            assert_ne!(offsets[0], offsets[1]);
            assert!(offsets.iter().all(|(y, x)| cfa.color_at(*y, *x) == 1));
        }
    }
}
