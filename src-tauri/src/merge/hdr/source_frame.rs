use std::path::Path;

use rawler::rawimage::{RawImage, RawImageData, RawPhotometricInterpretation};

use crate::raw::raw_processing::decode_raw_sensor_image;

pub(crate) const DECODER_ID: &str = "rawler_sensor_decode_v1";
pub(crate) const CALIBRATION_ID: &str = "cfa_black_white_wb_linear_v1";
pub(crate) const PROXY_ID: &str = "cfa_scene_linear_luma_box_v1";
const MAX_PROXY_EDGE: usize = 768;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveArea {
    pub height: usize,
    pub width: usize,
    pub x: usize,
    pub y: usize,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalibrationReceipt {
    pub algorithm_id: &'static str,
    pub black_levels: Vec<f32>,
    pub linearization_id: &'static str,
    pub white_balance: Vec<f32>,
    pub white_levels: Vec<f32>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExposureReceipt {
    pub aperture: f32,
    pub exposure_scale: f32,
    pub exposure_time_seconds: f32,
    pub iso: f32,
}

#[derive(Clone, Debug)]
pub(crate) struct AlignmentProxy {
    pub height: usize,
    pub pixels: Vec<f32>,
    pub scale: f32,
    pub width: usize,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceFrame {
    pub active_area: ActiveArea,
    pub calibration: CalibrationReceipt,
    pub camera_make: String,
    pub camera_model: String,
    pub cfa_pattern: String,
    pub content_hash: String,
    pub decoder_id: &'static str,
    pub exposure: ExposureReceipt,
    pub focal_length_mm: f32,
    pub graph_revision: &'static str,
    pub height: usize,
    pub lens_model: String,
    pub orientation: String,
    pub path: String,
    pub proxy_hash: String,
    pub proxy_id: &'static str,
    pub source_index: usize,
    pub width: usize,
    #[serde(skip)]
    pub proxy: AlignmentProxy,
}

fn rational(value: Option<rawler::formats::tiff::Rational>) -> Option<f32> {
    value
        .map(|value| value.n as f32 / value.d as f32)
        .filter(|value| value.is_finite())
}

fn active_area(raw: &RawImage) -> ActiveArea {
    raw.active_area
        .map(|area| ActiveArea {
            x: area.p.x,
            y: area.p.y,
            width: area.d.w,
            height: area.d.h,
        })
        .unwrap_or(ActiveArea {
            x: 0,
            y: 0,
            width: raw.width,
            height: raw.height,
        })
}

fn cfa_pattern(raw: &RawImage) -> Result<String, String> {
    let RawPhotometricInterpretation::Cfa(config) = &raw.photometric else {
        return Err("unsupported_raw_photometric".to_string());
    };
    if raw.cpp != 1 || !config.cfa.is_rgb() {
        return Err("unsupported_raw_cfa".to_string());
    }
    Ok((0..config.cfa.height)
        .flat_map(|y| (0..config.cfa.width).map(move |x| config.cfa.color_at(y, x).to_string()))
        .collect::<Vec<_>>()
        .join(""))
}

fn make_proxy(raw: &RawImage, area: &ActiveArea) -> Result<AlignmentProxy, String> {
    let RawPhotometricInterpretation::Cfa(config) = &raw.photometric else {
        return Err("unsupported_raw_photometric".to_string());
    };
    let step = area.width.max(area.height).div_ceil(MAX_PROXY_EDGE).max(1);
    let width = area.width.div_ceil(step);
    let height = area.height.div_ceil(step);
    let black = raw
        .blacklevel
        .levels
        .iter()
        .map(|v| v.as_f32())
        .collect::<Vec<_>>();
    let white = raw
        .whitelevel
        .0
        .iter()
        .map(|v| *v as f32)
        .collect::<Vec<_>>();
    if black.is_empty()
        || white.is_empty()
        || raw.wb_coeffs[..3]
            .iter()
            .any(|v| !v.is_finite() || *v <= 0.0)
    {
        return Err("missing_raw_calibration".to_string());
    }
    let sample = |index: usize| match &raw.data {
        RawImageData::Integer(values) => values[index] as f32,
        RawImageData::Float(values) => values[index],
    };
    let mut pixels = vec![0.0; width * height];
    for py in 0..height {
        for px in 0..width {
            let mut sum = 0.0;
            let mut count = 0usize;
            let y_end = ((py + 1) * step).min(area.height);
            let x_end = ((px + 1) * step).min(area.width);
            for ay in (py * step)..y_end {
                for ax in (px * step)..x_end {
                    let x = area.x + ax;
                    let y = area.y + ay;
                    let channel = config.cfa.color_at(y, x).min(2);
                    let b = black.get(channel).copied().unwrap_or(black[0]);
                    let w = white.get(channel).copied().unwrap_or(white[0]);
                    let value = sample(y * raw.width + x);
                    if w > b && value > b && value < w * 0.995 {
                        sum += ((value - b) / (w - b)) * raw.wb_coeffs[channel];
                        count += 1;
                    }
                }
            }
            pixels[py * width + px] = if count == 0 { 0.0 } else { sum / count as f32 };
        }
    }
    Ok(AlignmentProxy {
        width,
        height,
        pixels,
        scale: step as f32,
    })
}

pub(crate) fn decode_source(path: &str, source_index: usize) -> Result<SourceFrame, String> {
    if !crate::formats::is_raw_file(path) {
        return Err("unsupported_display_referred_source".to_string());
    }
    let bytes = std::fs::read(path).map_err(|error| format!("source_read_failed:{error}"))?;
    let decoded =
        decode_raw_sensor_image(&bytes).map_err(|error| format!("raw_decode_failed:{error}"))?;
    let raw = decoded.raw_image;
    let area = active_area(&raw);
    let cfa_pattern = cfa_pattern(&raw)?;
    let exposure_time_seconds = rational(decoded.metadata.exif.exposure_time)
        .filter(|value| *value > 0.0)
        .ok_or_else(|| "missing_exposure_time".to_string())?;
    let aperture = rational(decoded.metadata.exif.fnumber)
        .filter(|value| *value > 0.0)
        .ok_or_else(|| "missing_aperture".to_string())?;
    let iso = decoded
        .metadata
        .exif
        .iso_speed
        .map(|value| value as f32)
        .or_else(|| {
            decoded
                .metadata
                .exif
                .iso_speed_ratings
                .map(|value| value as f32)
        })
        .filter(|value| *value > 0.0)
        .ok_or_else(|| "missing_iso".to_string())?;
    let focal_length_mm = rational(decoded.metadata.exif.focal_length)
        .filter(|value| *value > 0.0)
        .ok_or_else(|| "missing_focal_length".to_string())?;
    let proxy = make_proxy(&raw, &area)?;
    let proxy_bytes = proxy
        .pixels
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect::<Vec<_>>();
    let proxy_hash = format!("blake3:{}", blake3::hash(&proxy_bytes).to_hex());
    let black_levels = raw
        .blacklevel
        .levels
        .iter()
        .map(|value| value.as_f32())
        .collect();
    let white_levels = raw.whitelevel.0.iter().map(|value| *value as f32).collect();
    let lens_model = decoded
        .metadata
        .exif
        .lens_model
        .unwrap_or_else(|| "unknown".to_string());

    Ok(SourceFrame {
        active_area: area,
        calibration: CalibrationReceipt {
            algorithm_id: CALIBRATION_ID,
            black_levels,
            linearization_id: "identity_declared_by_decoder",
            white_balance: raw.wb_coeffs.to_vec(),
            white_levels,
        },
        camera_make: raw.clean_make,
        camera_model: raw.clean_model,
        cfa_pattern,
        content_hash: format!("blake3:{}", blake3::hash(&bytes).to_hex()),
        decoder_id: DECODER_ID,
        exposure: ExposureReceipt {
            aperture,
            exposure_scale: exposure_time_seconds * iso / (aperture * aperture),
            exposure_time_seconds,
            iso,
        },
        focal_length_mm,
        graph_revision: "source_bytes_v1",
        height: raw.height,
        lens_model,
        orientation: format!("{:?}", raw.orientation),
        path: Path::new(path).to_string_lossy().into_owned(),
        proxy_hash,
        proxy_id: PROXY_ID,
        proxy,
        source_index,
        width: raw.width,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn first_raw(root: &Path) -> Option<PathBuf> {
        let mut entries = std::fs::read_dir(root)
            .ok()?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                if let Some(found) = first_raw(&path) {
                    return Some(found);
                }
            } else if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    matches!(
                        extension.to_ascii_lowercase().as_str(),
                        "arw" | "cr2" | "cr3" | "dng" | "nef" | "raf"
                    )
                })
            {
                return Some(path);
            }
        }
        None
    }

    #[test]
    fn rendered_input_cannot_claim_calibrated_readiness() {
        assert_eq!(
            decode_source("/synthetic/rendered.jpg", 0).unwrap_err(),
            "unsupported_display_referred_source"
        );
    }

    #[test]
    fn private_raw_uses_sensor_decode_and_fails_closed() {
        let Ok(root) = std::env::var("RAWENGINE_PRIVATE_RAW_ROOT") else {
            return;
        };
        let path = first_raw(Path::new(&root)).expect("private RAW root contains no RAW asset");
        match decode_source(path.to_str().expect("private RAW path is UTF-8"), 0) {
            Ok(frame) => {
                assert!(frame.content_hash.starts_with("blake3:"));
                assert!(!frame.calibration.black_levels.is_empty());
                assert!(!frame.calibration.white_levels.is_empty());
                assert!(
                    frame.proxy.width <= MAX_PROXY_EDGE && frame.proxy.height <= MAX_PROXY_EDGE
                );
                println!(
                    "private_hdr_sensor_decode=ready dimensions={}x{} decoder={} calibration={}",
                    frame.width, frame.height, frame.decoder_id, frame.calibration.algorithm_id
                );
            }
            Err(error) => {
                assert!(
                    error.starts_with("missing_")
                        || error.starts_with("unsupported_raw_")
                        || error.starts_with("raw_decode_failed:"),
                    "unexpected private RAW failure: {error}"
                );
                println!("private_hdr_sensor_decode=blocked code={error}");
            }
        }
    }
}
