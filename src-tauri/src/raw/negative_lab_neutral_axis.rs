#![allow(dead_code)]

use serde::{Deserialize, Serialize};

const ALGORITHM_VERSION: u8 = 1;

fn default_low_chroma_quantile() -> f32 {
    0.2
}
fn default_low_chroma_cap() -> f32 {
    0.08
}
fn default_min_support() -> u32 {
    24
}
fn default_confidence_threshold() -> f32 {
    0.65
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) struct NegativeLabNeutralAxisParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_strength")]
    pub strength: f32,
    #[serde(default = "default_low_chroma_quantile")]
    pub low_chroma_quantile: f32,
    #[serde(default = "default_low_chroma_cap")]
    pub low_chroma_cap: f32,
    #[serde(default = "default_min_support")]
    pub min_support: u32,
    #[serde(default = "default_confidence_threshold")]
    pub confidence_threshold: f32,
    #[serde(default)]
    pub allow_global_fallback: bool,
    #[serde(default)]
    pub source: String,
    #[serde(default = "default_algorithm_version")]
    pub algorithm_version: u8,
}

fn default_strength() -> f32 {
    1.0
}
fn default_algorithm_version() -> u8 {
    ALGORITHM_VERSION
}

impl Default for NegativeLabNeutralAxisParams {
    fn default() -> Self {
        Self {
            enabled: false,
            strength: default_strength(),
            low_chroma_quantile: default_low_chroma_quantile(),
            low_chroma_cap: default_low_chroma_cap(),
            min_support: default_min_support(),
            confidence_threshold: default_confidence_threshold(),
            allow_global_fallback: false,
            source: "manual_only_v1".into(),
            algorithm_version: ALGORITHM_VERSION,
        }
    }
}

impl NegativeLabNeutralAxisParams {
    pub(crate) fn sanitized(self) -> Self {
        Self {
            enabled: self.enabled,
            strength: if self.strength.is_finite() {
                self.strength.clamp(0.0, 1.0)
            } else {
                0.0
            },
            low_chroma_quantile: if self.low_chroma_quantile.is_finite() {
                self.low_chroma_quantile.clamp(0.01, 0.5)
            } else {
                default_low_chroma_quantile()
            },
            low_chroma_cap: if self.low_chroma_cap.is_finite() {
                self.low_chroma_cap.clamp(0.005, 0.25)
            } else {
                default_low_chroma_cap()
            },
            min_support: self.min_support.clamp(4, 100_000),
            confidence_threshold: if self.confidence_threshold.is_finite() {
                self.confidence_threshold.clamp(0.0, 1.0)
            } else {
                default_confidence_threshold()
            },
            allow_global_fallback: self.allow_global_fallback,
            source: if self.source.trim().is_empty() {
                "manual_only_v1".into()
            } else {
                self.source
            },
            algorithm_version: ALGORITHM_VERSION,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegativeLabNeutralAxisAnalysis {
    pub algorithm_id: String,
    pub algorithm_version: u8,
    pub status: String,
    pub fit_mode: String,
    pub confidence: f32,
    pub confidence_threshold: f32,
    pub sample_count: u32,
    pub band_support: [u32; 3],
    pub band_references: [[f32; 3]; 3],
    pub residual_before: f32,
    pub residual_after: f32,
    pub effective_global: [f32; 3],
    pub effective_shadow: [f32; 3],
    pub effective_highlight: [f32; 3],
    pub source: String,
    pub warning_codes: Vec<String>,
}

impl Default for NegativeLabNeutralAxisAnalysis {
    fn default() -> Self {
        Self {
            algorithm_id: "native_negative_lab_neutral_axis_v1".into(),
            algorithm_version: ALGORITHM_VERSION,
            status: "disabled_identity".into(),
            fit_mode: "none".into(),
            confidence: 0.0,
            confidence_threshold: default_confidence_threshold(),
            sample_count: 0,
            band_support: [0; 3],
            band_references: [[0.0; 3]; 3],
            residual_before: 0.0,
            residual_after: 0.0,
            effective_global: [0.0; 3],
            effective_shadow: [0.0; 3],
            effective_highlight: [0.0; 3],
            source: "manual_only_v1".into(),
            warning_codes: Vec::new(),
        }
    }
}

fn median(values: &mut [f32]) -> f32 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if values.is_empty() {
        return 0.0;
    }
    let mid = values.len() / 2;
    if values.len().is_multiple_of(2) {
        (values[mid - 1] + values[mid]) * 0.5
    } else {
        values[mid]
    }
}

fn sample_band(value: f32) -> usize {
    if value < 1.0 / 3.0 {
        0
    } else if value < 2.0 / 3.0 {
        1
    } else {
        2
    }
}

/// Analyze low-chroma density samples, rejecting borders, clipped/non-finite samples,
/// and unsupported bands. Corrections are additive density deltas, ready to compile
/// into the existing CMY timing stage.
pub(crate) fn analyze_neutral_axis(
    pixels: &[[f32; 3]],
    width: usize,
    height: usize,
    requested: &NegativeLabNeutralAxisParams,
) -> NegativeLabNeutralAxisAnalysis {
    let params = requested.clone().sanitized();
    let mut result = NegativeLabNeutralAxisAnalysis {
        confidence_threshold: params.confidence_threshold,
        source: params.source.clone(),
        ..Default::default()
    };
    if !params.enabled || pixels.is_empty() || width == 0 || height == 0 {
        return result;
    }

    let border_x = ((width as f32 * 0.04).round() as usize).min(width / 2);
    let border_y = ((height as f32 * 0.04).round() as usize).min(height / 2);
    let mut candidates: [Vec<[f32; 3]>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    let mut chroma_values = Vec::new();
    for (index, pixel) in pixels.iter().enumerate() {
        let x = index % width;
        let y = index / width;
        if x < border_x || y < border_y || x + border_x >= width || y + border_y >= height {
            continue;
        }
        if pixel
            .iter()
            .any(|v| !v.is_finite() || *v <= 0.0 || *v >= 1.0)
        {
            continue;
        }
        let chroma = pixel.iter().copied().fold(f32::NEG_INFINITY, f32::max)
            - pixel.iter().copied().fold(f32::INFINITY, f32::min);
        if chroma <= params.low_chroma_cap {
            chroma_values.push(chroma);
        }
    }
    if chroma_values.is_empty() {
        result.status = "no_correction_low_confidence".into();
        result.warning_codes.push("no_low_chroma_samples".into());
        return result;
    }
    let quantile_index =
        ((chroma_values.len() - 1) as f32 * params.low_chroma_quantile).round() as usize;
    chroma_values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let cap = chroma_values[quantile_index].min(params.low_chroma_cap);
    for (index, pixel) in pixels.iter().enumerate() {
        let x = index % width;
        let y = index / width;
        if x < border_x || y < border_y || x + border_x >= width || y + border_y >= height {
            continue;
        }
        if pixel
            .iter()
            .any(|v| !v.is_finite() || *v <= 0.0 || *v >= 1.0)
        {
            continue;
        }
        let chroma = pixel.iter().copied().fold(f32::NEG_INFINITY, f32::max)
            - pixel.iter().copied().fold(f32::INFINITY, f32::min);
        if chroma > cap {
            continue;
        }
        let luma = (pixel[0] + pixel[1] + pixel[2]) / 3.0;
        candidates[sample_band(luma)].push(*pixel);
    }
    result.sample_count = candidates.iter().map(|band| band.len() as u32).sum();
    result.band_support = std::array::from_fn(|band| candidates[band].len() as u32);
    for (band_index, samples) in candidates.iter_mut().enumerate() {
        if samples.is_empty() {
            continue;
        }
        for channel in 0..3 {
            let mut values = samples
                .iter()
                .map(|pixel| pixel[channel])
                .collect::<Vec<_>>();
            result.band_references[band_index][channel] = median(&mut values);
        }
    }

    let supported = result
        .band_support
        .iter()
        .filter(|count| **count >= params.min_support)
        .count();
    let support_score =
        (result.sample_count as f32 / (params.min_support.max(1) as f32 * 3.0)).min(1.0);
    let band_score = supported as f32 / 3.0;
    let chroma_score = (1.0 - cap / params.low_chroma_cap.max(0.001)).clamp(0.0, 1.0);
    result.confidence =
        (support_score * 0.55 + band_score * 0.35 + chroma_score * 0.1).clamp(0.0, 1.0);

    let mut usable_bands = Vec::new();
    for band in 0..3 {
        if result.band_support[band] >= params.min_support {
            usable_bands.push(band);
        }
    }
    let fit_mode = match usable_bands.len() {
        3 => "quadratic_three_band_v1",
        2 => "linear_two_band_v1",
        1 if params.allow_global_fallback => "global_one_band_v1",
        _ => "none",
    };
    result.fit_mode = fit_mode.into();
    if fit_mode == "none" || result.confidence < params.confidence_threshold {
        result.status = "no_correction_low_confidence".into();
        result
            .warning_codes
            .push("neutral_axis_confidence_below_threshold".into());
        return result;
    }

    let mut deltas = [[0.0f32; 3]; 3];
    for band in usable_bands.iter().copied() {
        let mean = result.band_references[band].iter().sum::<f32>() / 3.0;
        for (channel, delta) in deltas[band].iter_mut().enumerate() {
            *delta = (mean - result.band_references[band][channel]) * params.strength;
        }
    }
    let mut before = 0.0;
    let mut after = 0.0;
    for band in usable_bands.iter().copied() {
        let mean = result.band_references[band].iter().sum::<f32>() / 3.0;
        let adjusted: [f32; 3] = std::array::from_fn(|channel| {
            result.band_references[band][channel] + deltas[band][channel]
        });
        before += result.band_references[band]
            .iter()
            .map(|v| (v - mean).abs())
            .sum::<f32>()
            / 3.0;
        let adjusted_mean = adjusted.iter().sum::<f32>() / 3.0;
        after += adjusted
            .iter()
            .map(|v| (v - adjusted_mean).abs())
            .sum::<f32>()
            / 3.0;
    }
    let divisor = usable_bands.len().max(1) as f32;
    result.residual_before = before / divisor;
    result.residual_after = after / divisor;
    let global = if usable_bands.len() == 3 {
        std::array::from_fn(|channel| {
            (deltas[0][channel] + deltas[1][channel] + deltas[2][channel]) / 3.0
        })
    } else {
        std::array::from_fn(|channel| {
            usable_bands
                .iter()
                .map(|band| deltas[*band][channel])
                .sum::<f32>()
                / divisor
        })
    };
    result.effective_global = global;
    result.effective_shadow = std::array::from_fn(|channel| deltas[2][channel] - global[channel]);
    result.effective_highlight =
        std::array::from_fn(|channel| deltas[0][channel] - global[channel]);
    result.status = "correction_applied".into();
    result
}

pub(crate) fn compile_neutral_axis_cmy_timing(
    manual: &super::negative_lab_cmy_timing::NegativeLabCmyTimingParams,
    analysis: &NegativeLabNeutralAxisAnalysis,
) -> super::negative_lab_cmy_timing::NegativeLabCmyTimingParams {
    let mut compiled = manual.clone().sanitized();
    if analysis.status != "correction_applied" {
        return compiled;
    }
    compiled.enabled = true;
    compiled.source = format!("neutral_axis:{}", analysis.fit_mode);
    compiled.global_c += analysis.effective_global[0];
    compiled.global_m += analysis.effective_global[1];
    compiled.global_y += analysis.effective_global[2];
    compiled.shadow_c += analysis.effective_shadow[0];
    compiled.shadow_m += analysis.effective_shadow[1];
    compiled.shadow_y += analysis.effective_shadow[2];
    compiled.highlight_c += analysis.effective_highlight[0];
    compiled.highlight_m += analysis.effective_highlight[1];
    compiled.highlight_y += analysis.effective_highlight[2];
    compiled.sanitized()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp() -> (Vec<[f32; 3]>, usize, usize) {
        let width = 12;
        let height = 12;
        let mut pixels = Vec::new();
        for y in 0..height {
            for _x in 0..width {
                let value = 0.12 + (y as f32 / height as f32) * 0.76;
                pixels.push([value + 0.035, value - 0.02, value]);
            }
        }
        (pixels, width, height)
    }

    #[test]
    fn three_supported_bands_reduce_neutral_residual() {
        let (pixels, width, height) = ramp();
        let params = NegativeLabNeutralAxisParams {
            enabled: true,
            min_support: 4,
            confidence_threshold: 0.2,
            ..Default::default()
        };
        let analysis = analyze_neutral_axis(&pixels, width, height, &params);
        assert_eq!(analysis.fit_mode, "quadratic_three_band_v1");
        assert!(analysis.residual_after <= analysis.residual_before);
        assert_eq!(analysis.status, "correction_applied");
    }

    #[test]
    fn unsupported_bands_fail_closed() {
        let pixels = vec![[0.5, 0.7, 0.9]; 100];
        let params = NegativeLabNeutralAxisParams {
            enabled: true,
            min_support: 24,
            ..Default::default()
        };
        let analysis = analyze_neutral_axis(&pixels, 10, 10, &params);
        assert_eq!(analysis.status, "no_correction_low_confidence");
        assert!(analysis.effective_global.iter().all(|v| *v == 0.0));
    }
}
