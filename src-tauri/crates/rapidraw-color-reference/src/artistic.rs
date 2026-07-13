//! Dependency-independent f64 references for RapidRaw's artistic color nodes.
//!
//! Domains are explicit because these operations intentionally differ from
//! standards-based color transforms: levels, HSL, and grading consume extended
//! scene-linear RGB; curves consume display-encoded RGB; mask composition stays
//! in the domain of the layer it combines.

use crate::{ReferenceError, finite};

pub const ARTISTIC_REFERENCE_CONTRACT_ID: &str = "rapidraw.color-reference.artistic.v1";
pub const SCENE_LINEAR_EXTENDED_DOMAIN: &str = "acescg_scene_linear_extended_v1";
pub const DISPLAY_ENCODED_EXTENDED_DOMAIN: &str = "display_encoded_rgb_extended_v1";

const LUMA: [f64; 3] = [0.2126, 0.7152, 0.0722];
const HSL_RANGES: [(f64, f64); 8] = [
    (358.0, 35.0),
    (25.0, 45.0),
    (60.0, 40.0),
    (115.0, 90.0),
    (180.0, 60.0),
    (225.0, 60.0),
    (280.0, 55.0),
    (330.0, 50.0),
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurvePoint {
    pub x: f64,
    pub y: f64,
}

impl CurvePoint {
    pub fn new(x: f64, y: f64) -> Result<Self, ReferenceError> {
        finite(&[x, y])?;
        Ok(Self { x, y })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Levels {
    pub input_black: f64,
    pub input_white: f64,
    pub gamma: f64,
    pub output_black: f64,
    pub output_white: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HslAdjustment {
    pub hue: f64,
    pub saturation: f64,
    pub luminance: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ColorGrade {
    pub hue_degrees: f64,
    pub saturation: f64,
    pub luminance: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ColorCalibration {
    pub red_hue: f64,
    pub green_hue: f64,
    pub blue_hue: f64,
    pub red_saturation: f64,
    pub green_saturation: f64,
    pub blue_saturation: f64,
    pub shadows_tint: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaskBlendMode {
    Normal,
    Multiply,
    Screen,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Lut3d {
    size: usize,
    values: Vec<[f64; 3]>,
}

impl Lut3d {
    pub fn new(size: usize, values: Vec<[f64; 3]>) -> Result<Self, ReferenceError> {
        if size < 2 {
            return Err(ReferenceError::InvalidTableDimensions);
        }
        let expected = size
            .checked_mul(size)
            .and_then(|area| area.checked_mul(size))
            .ok_or(ReferenceError::InvalidTableDimensions)?;
        if values.len() != expected {
            return Err(ReferenceError::InvalidTableLength);
        }
        finite(&values.iter().flatten().copied().collect::<Vec<_>>())?;
        Ok(Self { size, values })
    }

    pub fn evaluate_tetrahedral(&self, rgb: [f64; 3]) -> Result<[f64; 3], ReferenceError> {
        finite(&rgb)?;
        let scaled = rgb.map(|channel| channel.clamp(0.0, 1.0) * (self.size - 1) as f64);
        let base = scaled.map(|channel| channel.floor() as usize);
        let next = base.map(|channel| (channel + 1).min(self.size - 1));
        let fraction = std::array::from_fn(|index| scaled[index] - base[index] as f64);
        let c000 = self.at(base[0], base[1], base[2]);
        let c111 = self.at(next[0], next[1], next[2]);
        let weighted = |terms: [([f64; 3], f64); 4]| {
            std::array::from_fn(|channel| {
                terms
                    .iter()
                    .map(|(value, weight)| value[channel] * weight)
                    .sum()
            })
        };
        let [r, g, b] = fraction;
        Ok(if r > g {
            if g > b {
                weighted([
                    (c000, 1.0 - r),
                    (self.at(next[0], base[1], base[2]), r - g),
                    (self.at(next[0], next[1], base[2]), g - b),
                    (c111, b),
                ])
            } else if r > b {
                weighted([
                    (c000, 1.0 - r),
                    (self.at(next[0], base[1], base[2]), r - b),
                    (self.at(next[0], base[1], next[2]), b - g),
                    (c111, g),
                ])
            } else {
                weighted([
                    (c000, 1.0 - b),
                    (self.at(base[0], base[1], next[2]), b - r),
                    (self.at(next[0], base[1], next[2]), r - g),
                    (c111, g),
                ])
            }
        } else if b > g {
            weighted([
                (c000, 1.0 - b),
                (self.at(base[0], base[1], next[2]), b - g),
                (self.at(base[0], next[1], next[2]), g - r),
                (c111, r),
            ])
        } else if b > r {
            weighted([
                (c000, 1.0 - g),
                (self.at(base[0], next[1], base[2]), g - b),
                (self.at(base[0], next[1], next[2]), b - r),
                (c111, r),
            ])
        } else {
            weighted([
                (c000, 1.0 - g),
                (self.at(base[0], next[1], base[2]), g - r),
                (self.at(next[0], next[1], base[2]), r - b),
                (c111, b),
            ])
        })
    }

    fn at(&self, x: usize, y: usize, z: usize) -> [f64; 3] {
        self.values[x + self.size * (y + self.size * z)]
    }
}

pub fn apply_monotone_curve(value: f64, points: &[CurvePoint]) -> Result<f64, ReferenceError> {
    finite(&[value])?;
    if points.len() < 2 {
        return Ok(value);
    }
    if points
        .windows(2)
        .any(|pair| pair[0].x >= pair[1].x || pair[0].y > pair[1].y)
    {
        return Err(ReferenceError::NonIncreasingInput);
    }
    finite(
        &points
            .iter()
            .flat_map(|point| [point.x, point.y])
            .collect::<Vec<_>>(),
    )?;
    let x = value * 255.0;
    if x <= points[0].x {
        return Ok(points[0].y / 255.0);
    }
    if x >= points[points.len() - 1].x {
        return Ok(points[points.len() - 1].y / 255.0);
    }
    for index in 0..points.len() - 1 {
        let p1 = points[index];
        let p2 = points[index + 1];
        if x > p2.x {
            continue;
        }
        let p0 = points[index.saturating_sub(1)];
        let p3 = points[(index + 2).min(points.len() - 1)];
        let before = (p1.y - p0.y) / (p1.x - p0.x).max(0.001);
        let current = (p2.y - p1.y) / (p2.x - p1.x).max(0.001);
        let after = (p3.y - p2.y) / (p3.x - p2.x).max(0.001);
        let mut m1 = if index == 0 {
            current
        } else if before * current <= 0.0 {
            0.0
        } else {
            (before + current) * 0.5
        };
        let mut m2 = if index + 1 == points.len() - 1 {
            current
        } else if current * after <= 0.0 {
            0.0
        } else {
            (current + after) * 0.5
        };
        if current != 0.0 {
            let alpha = m1 / current;
            let beta = m2 / current;
            let norm = alpha * alpha + beta * beta;
            if norm > 9.0 {
                let scale = 3.0 / norm.sqrt();
                m1 *= scale;
                m2 *= scale;
            }
        }
        let dx = p2.x - p1.x;
        let t = (x - p1.x) / dx;
        let t2 = t * t;
        let t3 = t2 * t;
        let y = (2.0 * t3 - 3.0 * t2 + 1.0) * p1.y
            + (t3 - 2.0 * t2 + t) * m1 * dx
            + (-2.0 * t3 + 3.0 * t2) * p2.y
            + (t3 - t2) * m2 * dx;
        return Ok((y / 255.0).clamp(0.0, 1.0));
    }
    Ok(points[points.len() - 1].y / 255.0)
}

pub fn apply_luma_levels(rgb: [f64; 3], levels: Levels) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        rgb[0],
        rgb[1],
        rgb[2],
        levels.input_black,
        levels.input_white,
        levels.gamma,
        levels.output_black,
        levels.output_white,
    ])?;
    let source_luma = luma(rgb).max(0.0);
    let input_range = (levels.input_white - levels.input_black).max(0.0001);
    let normalized = ((source_luma - levels.input_black) / input_range).clamp(0.0, 1.0);
    let gamma_luma = normalized.powf(1.0 / levels.gamma.max(0.0001));
    let output_luma = mix(levels.output_black, levels.output_white, gamma_luma);
    if source_luma <= 0.0001 {
        return Ok([output_luma; 3]);
    }
    Ok(rgb.map(|channel| (channel * output_luma / source_luma).clamp(0.0, 1.0)))
}

pub fn apply_hsl_ranges(
    rgb: [f64; 3],
    adjustments: [HslAdjustment; 8],
) -> Result<[f64; 3], ReferenceError> {
    finite(&rgb)?;
    for adjustment in adjustments {
        finite(&[adjustment.hue, adjustment.saturation, adjustment.luminance])?;
    }
    let safe = rgb.map(|channel| channel.max(0.0));
    if (safe[0] - safe[1]).abs() < 0.001 && (safe[1] - safe[2]).abs() < 0.001 {
        return Ok(safe);
    }
    let hsv = rgb_to_hsv(safe);
    let original_luma = luma(safe);
    let saturation_mask = smoothstep(0.05, 0.20, hsv[1]);
    let luminance_weight = smoothstep(0.0, 1.0, hsv[1]);
    let raw = HSL_RANGES.map(|(center, width)| hsl_influence(hsv[0], center, width));
    let total: f64 = raw.iter().sum();
    let mut hue_shift = 0.0;
    let mut saturation = 0.0;
    let mut luminance = 0.0;
    for index in 0..8 {
        let influence = raw[index] / total;
        hue_shift += adjustments[index].hue * 2.0 * influence * saturation_mask;
        saturation += adjustments[index].saturation * influence * saturation_mask;
        luminance += adjustments[index].luminance * influence * luminance_weight;
    }
    let target_luma = original_luma * (1.0 + luminance);
    if hsv[1] * (1.0 + saturation) < 0.0001 {
        return Ok([target_luma; 3]);
    }
    let shifted = hsv_to_rgb([
        (hsv[0] + hue_shift).rem_euclid(360.0),
        (hsv[1] * (1.0 + saturation)).clamp(0.0, 1.0),
        hsv[2],
    ]);
    let shifted_luma = luma(shifted);
    if shifted_luma < 0.0001 {
        return Ok([target_luma.max(0.0); 3]);
    }
    Ok(shifted.map(|channel| channel * target_luma / shifted_luma))
}

pub fn apply_color_grading(
    rgb: [f64; 3],
    shadows: ColorGrade,
    midtones: ColorGrade,
    highlights: ColorGrade,
    global: ColorGrade,
    blending: f64,
    balance: f64,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[rgb[0], rgb[1], rgb[2], blending, balance])?;
    for grade in [shadows, midtones, highlights, global] {
        finite(&[grade.hue_degrees, grade.saturation, grade.luminance])?;
    }
    let value_luma = luma(rgb.map(|channel| channel.max(0.0)));
    let shadow_cross = 0.1 + (-balance).max(0.0) * 0.5;
    let highlight_cross = 0.5 - balance.max(0.0) * 0.5;
    let feather = 0.2 * blending;
    let final_shadow_cross = shadow_cross.min(highlight_cross - 0.01);
    let shadow_mask = 1.0
        - smoothstep(
            final_shadow_cross - feather,
            final_shadow_cross + feather,
            value_luma,
        );
    let highlight_mask = smoothstep(
        highlight_cross - feather,
        highlight_cross + feather,
        value_luma,
    );
    let midtone_mask = (1.0 - shadow_mask - highlight_mask).max(0.0);
    let mut result = rgb;
    for (grade, mask, sat_strength, lum_strength) in [
        (shadows, shadow_mask, 0.3, 0.5),
        (midtones, midtone_mask, 0.6, 0.8),
        (highlights, highlight_mask, 0.8, 1.0),
        (global, 1.0, 1.0, 1.0),
    ] {
        if grade.saturation > 0.001 {
            let tint = hsv_to_rgb([grade.hue_degrees, 1.0, 1.0]);
            for channel in 0..3 {
                result[channel] += (tint[channel] - 0.5) * grade.saturation * mask * sat_strength;
            }
        }
        for channel in &mut result {
            *channel += grade.luminance * mask * lum_strength;
        }
    }
    Ok(result)
}

pub fn blend_mask_layer(
    base: [f64; 3],
    layer: [f64; 3],
    influence: f64,
    mode: MaskBlendMode,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        base[0], base[1], base[2], layer[0], layer[1], layer[2], influence,
    ])?;
    let blended = match mode {
        MaskBlendMode::Normal => layer,
        MaskBlendMode::Multiply => std::array::from_fn(|index| base[index] * layer[index]),
        MaskBlendMode::Screen => {
            std::array::from_fn(|index| 1.0 - (1.0 - base[index]) * (1.0 - layer[index]))
        }
    };
    Ok(std::array::from_fn(|index| {
        mix(base[index], blended[index], influence)
    }))
}

pub fn apply_clipping_overlay(rgb: [f64; 3], enabled: bool) -> Result<[f64; 3], ReferenceError> {
    finite(&rgb)?;
    if !enabled {
        return Ok(rgb);
    }
    if rgb.into_iter().any(|channel| channel > 0.998) {
        Ok([1.0, 0.0, 0.0])
    } else if rgb.into_iter().any(|channel| channel < 0.002) {
        Ok([0.0, 0.0, 1.0])
    } else {
        Ok(rgb)
    }
}

pub fn agx_tonemap_identity_matrix(rgb: [f64; 3]) -> Result<[f64; 3], ReferenceError> {
    finite(&rgb)?;
    let minimum = rgb.into_iter().fold(f64::INFINITY, f64::min);
    let compressed = rgb.map(|channel| {
        if minimum < 0.0 {
            channel - minimum
        } else {
            channel
        }
    });
    Ok(compressed.map(agx_channel))
}

pub fn apply_halation_raw(
    color: [f64; 3],
    blurred_linear: [f64; 3],
    amount: f64,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        color[0],
        color[1],
        color[2],
        blurred_linear[0],
        blurred_linear[1],
        blurred_linear[2],
        amount,
    ])?;
    if amount <= 0.0 {
        return Ok(color);
    }
    let linear_luma = luma(blurred_linear.map(|channel| channel.max(0.0)));
    let perceptual = if linear_luma <= 1.0 {
        linear_luma.max(0.0).powf(1.0 / 2.2)
    } else {
        1.0 + (linear_luma - 1.0).powf(1.0 / 2.2)
    };
    let cutoff = mix(0.85, 0.1, amount.clamp(0.0, 1.0));
    if perceptual <= cutoff {
        return Ok(color);
    }
    let mask = smoothstep(0.0, (1.5 - cutoff).max(0.1) * 0.6, perceptual - cutoff);
    let tint: [f64; 3] = std::array::from_fn(|index| {
        mix(
            [1.0, 0.32, 0.10][index],
            [1.0, 0.15, 0.03][index],
            smoothstep(0.0, 0.7, mask),
        )
    });
    let glow = tint.map(|channel| channel * mask * linear_luma);
    let color_luma = luma(color.map(|channel| channel.max(0.0)));
    let affected: [f64; 3] =
        std::array::from_fn(|index| mix(color[index], color_luma, mask * 0.12));
    let contrast = affected.map(|channel| mix(0.5, channel, 1.0 - mask * 0.06));
    Ok(std::array::from_fn(|index| {
        contrast[index] + glow[index] * amount * 2.5
    }))
}

pub fn apply_white_balance(
    rgb: [f64; 3],
    temperature: f64,
    tint: f64,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[rgb[0], rgb[1], rgb[2], temperature, tint])?;
    let temperature_scale = [
        1.0 + temperature * 0.2,
        1.0 + temperature * 0.05,
        1.0 - temperature * 0.2,
    ];
    let tint_scale = [1.0 + tint * 0.25, 1.0 - tint * 0.25, 1.0 + tint * 0.25];
    Ok(std::array::from_fn(|index| {
        rgb[index] * temperature_scale[index] * tint_scale[index]
    }))
}

pub fn apply_color_calibration(
    rgb: [f64; 3],
    calibration: ColorCalibration,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        rgb[0],
        rgb[1],
        rgb[2],
        calibration.red_hue,
        calibration.green_hue,
        calibration.blue_hue,
        calibration.red_saturation,
        calibration.green_saturation,
        calibration.blue_saturation,
        calibration.shadows_tint,
    ])?;
    let red = [
        1.0 - calibration.red_hue.abs(),
        calibration.red_hue.max(0.0),
        (-calibration.red_hue).max(0.0),
    ];
    let green = [
        (-calibration.green_hue).max(0.0),
        1.0 - calibration.green_hue.abs(),
        calibration.green_hue.max(0.0),
    ];
    let blue = [
        calibration.blue_hue.max(0.0),
        (-calibration.blue_hue).max(0.0),
        1.0 - calibration.blue_hue.abs(),
    ];
    let mut color =
        std::array::from_fn(|row| red[row] * rgb[0] + green[row] * rgb[1] + blue[row] * rgb[2]);
    let value_luma = luma(color.map(|channel| channel.max(0.0)));
    let sum: f64 = color.iter().sum();
    let masks = if sum > 0.001 {
        color.map(|channel| channel / sum)
    } else {
        [0.0; 3]
    };
    let saturation = masks[0] * calibration.red_saturation
        + masks[1] * calibration.green_saturation
        + masks[2] * calibration.blue_saturation;
    for channel in &mut color {
        *channel += (*channel - value_luma) * saturation;
    }
    if calibration.shadows_tint.abs() > 0.001 {
        let mask = 1.0 - smoothstep(0.0, 0.3, luma(color.map(|channel| channel.max(0.0))));
        let scale = [
            1.0 + calibration.shadows_tint * 0.25,
            1.0 - calibration.shadows_tint * 0.25,
            1.0 + calibration.shadows_tint * 0.25,
        ];
        color = std::array::from_fn(|index| mix(color[index], color[index] * scale[index], mask));
    }
    Ok(color)
}

pub fn apply_filmic_brightness(rgb: [f64; 3], brightness: f64) -> Result<[f64; 3], ReferenceError> {
    finite(&[rgb[0], rgb[1], rgb[2], brightness])?;
    if brightness == 0.0 {
        return Ok(rgb);
    }
    let original_luma = luma(rgb);
    if original_luma.abs() < 0.00001 {
        return Ok(rgb);
    }
    let scale = 2.0_f64.powf(brightness * 0.05);
    let k = 2.0_f64.powf(-brightness * 0.95 * 1.2);
    let luma_abs = original_luma.abs();
    let floor = (luma_abs / 1.06).floor() * 1.06;
    let normalized = (luma_abs - floor) / 1.06;
    let shaped = normalized / (normalized + (1.0 - normalized) * k);
    let new_luma = original_luma.signum() * (floor + shaped * 1.06) * scale;
    let total_scale = new_luma / original_luma;
    let exponent = mix(0.95, 0.65, new_luma.clamp(0.0, 2.0) * 0.5);
    let chroma_scale = total_scale.powf(exponent) / (1.0 + (new_luma - 0.9).max(0.0) * 2.0);
    Ok(std::array::from_fn(|index| {
        new_luma + (rgb[index] - original_luma) * chroma_scale
    }))
}

pub fn apply_local_contrast(
    center: [f64; 3],
    blurred: [f64; 3],
    amount: f64,
    threshold: f64,
    edge_aware: bool,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        center[0], center[1], center[2], blurred[0], blurred[1], blurred[2], amount, threshold,
    ])?;
    if amount == 0.0 {
        return Ok(center);
    }
    if amount < 0.0 {
        return Ok(std::array::from_fn(|index| {
            mix(
                center[index],
                blurred[index],
                -amount * if edge_aware { 0.5 } else { 1.0 },
            )
        }));
    }
    let center_luma = luma(center);
    let midtone = smoothstep(0.0, 0.1, center_luma) * (1.0 - smoothstep(0.9, 1.0, center_luma));
    if midtone < 0.001 {
        return Ok(center);
    }
    let ratio = (center_luma.max(0.0001) / luma(blurred).max(0.0001)).log2();
    let effective = if edge_aware {
        let magnitude = ratio.abs();
        amount
            * (1.0 - (magnitude / 3.0).clamp(0.0, 1.0).sqrt())
            * smoothstep(threshold * 0.5, threshold * 1.5, magnitude)
            * 0.8
    } else {
        amount
    };
    let contrasted = center.map(|channel| channel * 2.0_f64.powf(ratio * effective));
    Ok(std::array::from_fn(|index| {
        mix(center[index], contrasted[index], midtone)
    }))
}

pub fn apply_glow_raw(
    color: [f64; 3],
    blurred: [f64; 3],
    amount: f64,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        color[0], color[1], color[2], blurred[0], blurred[1], blurred[2], amount,
    ])?;
    if amount <= 0.0 {
        return Ok(color);
    }
    let linear_luma = luma(blurred.map(|channel| channel.max(0.0)));
    let perceptual = if linear_luma <= 1.0 {
        linear_luma.max(0.0).powf(1.0 / 2.2)
    } else {
        1.0 + (linear_luma - 1.0).powf(1.0 / 2.2)
    };
    let cutoff = mix(0.75, 0.08, amount.clamp(0.0, 1.0));
    let cutoff_fade = smoothstep(cutoff, cutoff + 0.15, perceptual);
    let intensity = smoothstep(0.0, 1.0, (perceptual - cutoff).max(0.0) / 5.5).powf(0.45);
    let ratio = if linear_luma > 0.01 {
        std::array::from_fn(|index| blurred[index] / linear_luma * [1.03, 1.0, 0.97][index])
    } else {
        [1.0, 0.99, 0.98]
    };
    let gate = smoothstep(0.0, 0.5, linear_luma).sqrt();
    let bloom =
        ratio.map(|channel| channel * intensity * linear_luma.powf(0.6) * cutoff_fade * gate);
    let protection = 1.0 - smoothstep(1.0, 2.2, luma(color.map(|channel| channel.max(0.0))));
    Ok(std::array::from_fn(|index| {
        color[index] + bloom[index] * amount * 3.8 * protection
    }))
}

pub fn apply_flare(
    color: [f64; 3],
    flare_sample: [f64; 3],
    amount: f64,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        color[0],
        color[1],
        color[2],
        flare_sample[0],
        flare_sample[1],
        flare_sample[2],
        amount,
    ])?;
    let linear_luma = luma(color.map(|channel| channel.max(0.0)));
    let perceptual = if linear_luma <= 1.0 {
        linear_luma.max(0.0).powf(1.0 / 2.2)
    } else {
        1.0 + (linear_luma - 1.0).powf(1.0 / 2.2)
    };
    let protection = 1.0 - smoothstep(0.7, 1.8, perceptual);
    Ok(std::array::from_fn(|index| {
        color[index] + (flare_sample[index] * 1.4).powi(2) * amount * protection
    }))
}

pub fn apply_vignette(
    color: [f64; 3],
    coordinate: [f64; 2],
    dimensions: [f64; 2],
    amount: f64,
    midpoint: f64,
    roundness: f64,
    feather: f64,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        color[0],
        color[1],
        color[2],
        coordinate[0],
        coordinate[1],
        dimensions[0],
        dimensions[1],
        amount,
        midpoint,
        roundness,
        feather,
    ])?;
    if dimensions[0] <= 0.0 || dimensions[1] <= 0.0 {
        return Err(ReferenceError::OutOfDomain);
    }
    let centered = [
        coordinate[0] / dimensions[0] * 2.0 - 1.0,
        coordinate[1] / dimensions[1] * 2.0 - 1.0,
    ];
    let power = 1.0 - roundness;
    let shaped = centered.map(|value| value.signum() * value.abs().powf(power));
    let distance =
        (shaped[0].powi(2) + (shaped[1] * dimensions[1] / dimensions[0]).powi(2)).sqrt() * 0.5;
    let mask = smoothstep(midpoint - feather * 0.5, midpoint + feather * 0.5, distance);
    Ok(if amount < 0.0 {
        color.map(|channel| channel * (1.0 + amount * mask))
    } else {
        color.map(|channel| mix(channel, 1.0, amount * mask))
    })
}

pub fn apply_grain(
    color: [f64; 3],
    absolute_coordinate: [f64; 2],
    dimensions: [f64; 2],
    amount: f64,
    size: f64,
    roughness: f64,
) -> Result<[f64; 3], ReferenceError> {
    finite(&[
        color[0],
        color[1],
        color[2],
        absolute_coordinate[0],
        absolute_coordinate[1],
        dimensions[0],
        dimensions[1],
        amount,
        size,
        roughness,
    ])?;
    if amount <= 0.0 {
        return Ok(color);
    }
    let scale = (dimensions[0].min(dimensions[1]) / 1080.0).max(0.1);
    let frequency = (1.0 / size.max(0.1)) / scale;
    let base = gradient_noise([
        absolute_coordinate[0] * frequency,
        absolute_coordinate[1] * frequency,
    ]);
    let rough = gradient_noise([
        absolute_coordinate[0] * frequency * 0.6 + 5.2,
        absolute_coordinate[1] * frequency * 0.6 + 1.3,
    ]);
    let noise = mix(base, rough, roughness);
    let value_luma = luma(color).max(0.0);
    let mask = smoothstep(0.0, 0.15, value_luma) * (1.0 - smoothstep(0.6, 1.0, value_luma));
    Ok(color.map(|channel| channel + noise * amount * 0.5 * mask))
}

fn gradient_noise(point: [f64; 2]) -> f64 {
    let integer = point.map(f64::floor);
    let fraction = [point[0] - integer[0], point[1] - integer[1]];
    let u = fraction.map(|value| value * value * (3.0 - 2.0 * value));
    let gradient = |x: f64, y: f64| {
        [
            hash2([integer[0] + x, integer[1] + y]) * 2.0 - 1.0,
            hash2([integer[0] + x + 11.0, integer[1] + y + 37.0]) * 2.0 - 1.0,
        ]
    };
    let dot =
        |gradient: [f64; 2], offset: [f64; 2]| gradient[0] * offset[0] + gradient[1] * offset[1];
    let a = dot(gradient(0.0, 0.0), fraction);
    let b = dot(gradient(1.0, 0.0), [fraction[0] - 1.0, fraction[1]]);
    let c = dot(gradient(0.0, 1.0), [fraction[0], fraction[1] - 1.0]);
    let d = dot(gradient(1.0, 1.0), [fraction[0] - 1.0, fraction[1] - 1.0]);
    mix(mix(a, b, u[0]), mix(c, d, u[0]), u[1])
}

fn hash2(point: [f64; 2]) -> f64 {
    let mut p = [
        fract(point[0] * 0.1031),
        fract(point[1] * 0.1031),
        fract(point[0] * 0.1031),
    ];
    let dot = p[0] * (p[1] + 33.33) + p[1] * (p[2] + 33.33) + p[2] * (p[0] + 33.33);
    p.iter_mut().for_each(|value| *value += dot);
    fract((p[0] + p[1]) * p[2])
}

fn fract(value: f64) -> f64 {
    value - value.floor()
}

fn agx_channel(value: f64) -> f64 {
    const MIN_EV: f64 = -15.2;
    const RANGE_EV: f64 = 20.2;
    let mapped = ((value.max(1.0e-6) / 0.18).log2() - MIN_EV) / RANGE_EV;
    agx_curve(mapped.clamp(0.0, 1.0)).max(0.0).powf(2.4)
}

fn agx_curve(value: f64) -> f64 {
    const TRANSITION_X: f64 = 0.606_060_6;
    const TRANSITION_Y: f64 = 0.434_46;
    const SLOPE: f64 = 2.3843;
    let result = if value < TRANSITION_X {
        agx_scaled_sigmoid(value, -1.0359, SLOPE, TRANSITION_X, TRANSITION_Y)
    } else if value <= TRANSITION_X {
        SLOPE * value - 1.0112
    } else {
        agx_scaled_sigmoid(value, 1.3475, SLOPE, TRANSITION_X, TRANSITION_Y)
    };
    result.clamp(0.0, 1.0)
}

fn agx_scaled_sigmoid(
    value: f64,
    scale: f64,
    slope: f64,
    transition_x: f64,
    transition_y: f64,
) -> f64 {
    let x = slope * (value - transition_x) / scale;
    scale * (x / (1.0 + x.powf(1.5)).powf(1.0 / 1.5)) + transition_y
}

fn luma(rgb: [f64; 3]) -> f64 {
    rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]
}

fn mix(left: f64, right: f64, amount: f64) -> f64 {
    left + (right - left) * amount
}

fn smoothstep(edge0: f64, edge1: f64, value: f64) -> f64 {
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn hsl_influence(hue: f64, center: f64, width: f64) -> f64 {
    let absolute = (hue - center).abs();
    let distance = absolute.min(360.0 - absolute);
    (-1.5 * (distance / (width * 0.5)).powi(2)).exp()
}

fn rgb_to_hsv(rgb: [f64; 3]) -> [f64; 3] {
    let maximum = rgb.into_iter().fold(f64::NEG_INFINITY, f64::max);
    let minimum = rgb.into_iter().fold(f64::INFINITY, f64::min);
    let delta = maximum - minimum;
    let mut hue = if delta == 0.0 {
        0.0
    } else if maximum == rgb[0] {
        60.0 * ((rgb[1] - rgb[2]) / delta).rem_euclid(6.0)
    } else if maximum == rgb[1] {
        60.0 * ((rgb[2] - rgb[0]) / delta + 2.0)
    } else {
        60.0 * ((rgb[0] - rgb[1]) / delta + 4.0)
    };
    if hue < 0.0 {
        hue += 360.0;
    }
    [
        hue,
        if maximum > 0.0 { delta / maximum } else { 0.0 },
        maximum,
    ]
}

fn hsv_to_rgb(hsv: [f64; 3]) -> [f64; 3] {
    let chroma = hsv[2] * hsv[1];
    let x = chroma * (1.0 - ((hsv[0] / 60.0).rem_euclid(2.0) - 1.0).abs());
    let m = hsv[2] - chroma;
    let prime = if hsv[0] < 60.0 {
        [chroma, x, 0.0]
    } else if hsv[0] < 120.0 {
        [x, chroma, 0.0]
    } else if hsv[0] < 180.0 {
        [0.0, chroma, x]
    } else if hsv[0] < 240.0 {
        [0.0, x, chroma]
    } else if hsv[0] < 300.0 {
        [x, 0.0, chroma]
    } else {
        [chroma, 0.0, x]
    };
    prime.map(|channel| channel + m)
}
