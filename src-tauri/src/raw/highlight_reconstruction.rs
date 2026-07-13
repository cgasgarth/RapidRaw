use std::collections::{BTreeMap, VecDeque};

use anyhow::{Result, anyhow};

pub const HIGHLIGHT_RECONSTRUCTION_ALGORITHM_ID: &str = "sensor_linear_confidence_hierarchy_v2";
pub const HIGHLIGHT_RECONSTRUCTION_IMPLEMENTATION_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HighlightReconstructionMode {
    Off,
    Conservative,
    Auto,
    Strong,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HighlightReconstructionMethod {
    SameChannelSpatial,
    CrossChannelRatio,
    ColorLine,
    RegionPropagation,
    PostDemosaicChroma,
    NeutralSpecularFallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CfaKind {
    Bayer,
    XTrans,
    OtherRgb,
    Unsupported,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightReconstructionReportV2 {
    pub algorithm_id: &'static str,
    pub implementation_version: u32,
    pub mode: HighlightReconstructionMode,
    pub cfa_kind: CfaKind,
    pub clipped_samples: u64,
    pub near_clipped_samples: u64,
    pub invalid_samples: u64,
    pub reconstructed_samples: u64,
    pub partially_reconstructed_samples: u64,
    pub unrecoverable_samples: u64,
    pub method_counts: BTreeMap<HighlightReconstructionMethod, u64>,
    pub confidence_percentiles: [f32; 5],
    pub largest_clipped_region: u64,
    pub post_demosaic_fallback_samples: u64,
    pub warning_codes: Vec<&'static str>,
}

impl HighlightReconstructionReportV2 {
    pub fn bypassed(mode: HighlightReconstructionMode, cfa_kind: CfaKind) -> Self {
        Self {
            algorithm_id: HIGHLIGHT_RECONSTRUCTION_ALGORITHM_ID,
            implementation_version: HIGHLIGHT_RECONSTRUCTION_IMPLEMENTATION_VERSION,
            mode,
            cfa_kind,
            clipped_samples: 0,
            near_clipped_samples: 0,
            invalid_samples: 0,
            reconstructed_samples: 0,
            partially_reconstructed_samples: 0,
            unrecoverable_samples: 0,
            method_counts: BTreeMap::new(),
            confidence_percentiles: [0.0; 5],
            largest_clipped_region: 0,
            post_demosaic_fallback_samples: 0,
            warning_codes: Vec::new(),
        }
    }
}

impl Default for HighlightReconstructionReportV2 {
    fn default() -> Self {
        Self::bypassed(HighlightReconstructionMode::Off, CfaKind::Unsupported)
    }
}

#[derive(Debug, Clone)]
pub struct CfaTopology {
    width: usize,
    height: usize,
    colors: Vec<usize>,
    pub kind: CfaKind,
}

impl CfaTopology {
    pub fn new(width: usize, height: usize, colors: Vec<usize>) -> Self {
        let rgb = width > 0
            && height > 0
            && colors.len() == width.saturating_mul(height)
            && colors.iter().all(|color| *color <= 2);
        let kind = if !rgb {
            CfaKind::Unsupported
        } else if width == 2 && height == 2 {
            CfaKind::Bayer
        } else if width == 6 && height == 6 {
            CfaKind::XTrans
        } else {
            CfaKind::OtherRgb
        };
        Self {
            width,
            height,
            colors,
            kind,
        }
    }

    pub fn color_at(&self, x: usize, y: usize) -> Option<usize> {
        if self.kind == CfaKind::Unsupported {
            return None;
        }
        self.colors
            .get((y % self.height) * self.width + (x % self.width))
            .copied()
    }

    fn phase_radius(&self) -> usize {
        self.width.max(self.height).max(2)
    }
}

pub struct SensorReconstructionInput<'a> {
    pub width: usize,
    pub height: usize,
    pub active_bounds: (usize, usize, usize, usize),
    pub topology: CfaTopology,
    pub black_levels: &'a [f32],
    pub black_width: usize,
    pub black_height: usize,
    pub black_cpp: usize,
    pub white_levels: &'a [f32],
}

impl SensorReconstructionInput<'_> {
    fn black_at(&self, x: usize, y: usize) -> Option<f32> {
        if self.black_levels.is_empty() || self.black_width == 0 || self.black_height == 0 {
            return Some(0.0);
        }
        let index = ((y % self.black_height) * self.black_width + (x % self.black_width))
            * self.black_cpp.max(1);
        self.black_levels
            .get(index)
            .copied()
            .or_else(|| self.black_levels.first().copied())
            .filter(|value| value.is_finite())
    }

    fn white_at(&self, x: usize, y: usize) -> Option<f32> {
        let color = self.topology.color_at(x, y)?;
        self.white_levels
            .get(color)
            .copied()
            .or_else(|| self.white_levels.first().copied())
            .filter(|value| value.is_finite())
    }

    fn normalized(&self, pixels: &[u16], x: usize, y: usize) -> Option<f32> {
        let black = self.black_at(x, y)?;
        let white = self.white_at(x, y)?;
        let range = white - black;
        if range <= 1.0 {
            return None;
        }
        Some((pixels[y * self.width + x] as f32 - black) / range)
    }
}

#[derive(Debug)]
pub struct HighlightReconstructionOutput {
    pub report: HighlightReconstructionReportV2,
    pub confidence: Vec<f32>,
    pub unrecoverable_sensor_indices: Vec<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SampleState {
    Unclipped,
    NearClipped,
    Clipped,
    Invalid,
}

#[derive(Clone, Copy)]
struct Candidate {
    signal: f32,
    confidence: f32,
    method: HighlightReconstructionMethod,
}

#[derive(Clone, Copy)]
struct NeighborSample {
    signal: f32,
    dx: isize,
    dy: isize,
    distance: f32,
}

fn percentile_summary(values: &mut [f32]) -> [f32; 5] {
    if values.is_empty() {
        return [0.0; 5];
    }
    values.sort_by(f32::total_cmp);
    let value = |quantile: f32| values[((values.len() - 1) as f32 * quantile).round() as usize];
    [value(0.0), value(0.25), value(0.5), value(0.75), value(1.0)]
}

fn median(values: &mut [f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f32::total_cmp);
    Some(values[values.len() / 2])
}

fn mad(values: &[f32], center: f32) -> f32 {
    let mut deviations = values
        .iter()
        .map(|value| (value - center).abs())
        .collect::<Vec<_>>();
    median(&mut deviations).unwrap_or(1.0)
}

fn same_color_neighbors(
    pixels: &[u16],
    input: &SensorReconstructionInput<'_>,
    states: &[SampleState],
    x: usize,
    y: usize,
    radius: usize,
) -> Vec<NeighborSample> {
    let Some(target_color) = input.topology.color_at(x, y) else {
        return Vec::new();
    };
    let mut samples = Vec::new();
    let radius = radius as isize;
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            if dx == 0 && dy == 0 {
                continue;
            }
            let nx = x as isize + dx;
            let ny = y as isize + dy;
            if nx < 0 || ny < 0 || nx as usize >= input.width || ny as usize >= input.height {
                continue;
            }
            let nx = nx as usize;
            let ny = ny as usize;
            let index = ny * input.width + nx;
            if states[index] != SampleState::Unclipped
                || input.topology.color_at(nx, ny) != Some(target_color)
            {
                continue;
            }
            if let Some(signal) = input.normalized(pixels, nx, ny)
                && signal >= 0.02
            {
                samples.push(NeighborSample {
                    signal,
                    dx,
                    dy,
                    distance: ((dx * dx + dy * dy) as f32).sqrt(),
                });
            }
        }
    }
    samples
}

fn spatial_candidate(samples: &[NeighborSample], clipping_threshold: f32) -> Option<Candidate> {
    if samples.len() < 2 {
        return None;
    }
    let directions = [(1, 0), (0, 1), (1, 1), (1, -1)];
    let mut pairs = Vec::new();
    for (dir_x, dir_y) in directions {
        let positive = samples
            .iter()
            .filter(|sample| {
                sample.dx * dir_x + sample.dy * dir_y > 0
                    && (sample.dx * dir_y - sample.dy * dir_x).abs() <= 1
            })
            .min_by(|left, right| left.distance.total_cmp(&right.distance));
        let negative = samples
            .iter()
            .filter(|sample| {
                sample.dx * dir_x + sample.dy * dir_y < 0
                    && (sample.dx * dir_y - sample.dy * dir_x).abs() <= 1
            })
            .min_by(|left, right| left.distance.total_cmp(&right.distance));
        if let (Some(positive), Some(negative)) = (positive, negative) {
            pairs.push((
                (positive.signal + negative.signal) * 0.5,
                (positive.signal - negative.signal).abs(),
                positive.distance + negative.distance,
            ));
        }
    }
    let (estimate, gradient, distance) = pairs
        .into_iter()
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .unwrap_or_else(|| {
            let weighted_sum = samples
                .iter()
                .map(|sample| sample.signal / sample.distance.max(1.0))
                .sum::<f32>();
            let weight = samples
                .iter()
                .map(|sample| 1.0 / sample.distance.max(1.0))
                .sum::<f32>();
            (weighted_sum / weight.max(f32::EPSILON), 0.2, 8.0)
        });
    let headroom = (1.0 - estimate.clamp(0.0, 1.0)) * 0.35;
    let signal = (1.0 + headroom).max(clipping_threshold + 0.002);
    let confidence = ((samples.len() as f32 / 10.0).min(1.0)
        * (1.0 - gradient * 2.0).clamp(0.1, 1.0)
        * (1.0 / (1.0 + distance * 0.04)))
        .clamp(0.0, 1.0);
    Some(Candidate {
        signal,
        confidence,
        method: HighlightReconstructionMethod::SameChannelSpatial,
    })
}

fn nearest_color_signal(
    pixels: &[u16],
    input: &SensorReconstructionInput<'_>,
    states: &[SampleState],
    coordinate: (usize, usize),
    color: usize,
    radius: usize,
    require_unclipped: bool,
) -> Option<f32> {
    let (x, y) = coordinate;
    let radius = radius as isize;
    let mut best: Option<(f32, f32)> = None;
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let nx = x as isize + dx;
            let ny = y as isize + dy;
            if nx < 0 || ny < 0 || nx as usize >= input.width || ny as usize >= input.height {
                continue;
            }
            let nx = nx as usize;
            let ny = ny as usize;
            let index = ny * input.width + nx;
            if input.topology.color_at(nx, ny) != Some(color)
                || (require_unclipped && states[index] != SampleState::Unclipped)
            {
                continue;
            }
            let distance = ((dx * dx + dy * dy) as f32).sqrt();
            if let Some(signal) = input.normalized(pixels, nx, ny)
                && best.is_none_or(|(_, prior_distance)| distance < prior_distance)
            {
                best = Some((signal, distance));
            }
        }
    }
    best.map(|(signal, _)| signal)
}

fn cross_channel_candidate(
    pixels: &[u16],
    input: &SensorReconstructionInput<'_>,
    states: &[SampleState],
    x: usize,
    y: usize,
    target_samples: &[NeighborSample],
    clipping_threshold: f32,
) -> Option<Candidate> {
    let target_color = input.topology.color_at(x, y)?;
    let mut target_values = target_samples
        .iter()
        .map(|sample| sample.signal)
        .collect::<Vec<_>>();
    let target_median = median(&mut target_values)?;
    let mut estimates = Vec::new();
    for reference_color in 0..3 {
        if reference_color == target_color {
            continue;
        }
        let local_peak = nearest_color_signal(
            pixels,
            input,
            states,
            (x, y),
            reference_color,
            input.topology.phase_radius(),
            false,
        )?;
        let mut reference_values = Vec::new();
        for sample in target_samples.iter().take(24) {
            let sx = (x as isize + sample.dx).max(0) as usize;
            let sy = (y as isize + sample.dy).max(0) as usize;
            if let Some(reference) = nearest_color_signal(
                pixels,
                input,
                states,
                (sx, sy),
                reference_color,
                input.topology.phase_radius(),
                true,
            ) {
                reference_values.push(reference);
            }
        }
        let reference_median = median(&mut reference_values)?;
        if reference_median > 0.04 {
            estimates.push((local_peak * target_median / reference_median).max(1.0));
        }
    }
    let estimate = median(&mut estimates)?;
    let dispersion = mad(&estimates, estimate);
    let method = if estimates.len() > 1 && dispersion < 0.05 {
        HighlightReconstructionMethod::ColorLine
    } else {
        HighlightReconstructionMethod::CrossChannelRatio
    };
    Some(Candidate {
        signal: estimate.clamp(clipping_threshold + 0.002, 1.2),
        confidence: ((target_samples.len() as f32 / 12.0).min(1.0)
            * (1.0 - dispersion * 4.0).clamp(0.15, 1.0))
        .clamp(0.0, 1.0),
        method,
    })
}

fn classify_samples(
    pixels: &[u16],
    input: &SensorReconstructionInput<'_>,
    clipping_threshold: f32,
    report: &mut HighlightReconstructionReportV2,
    check_cancel: &mut impl FnMut() -> Result<()>,
) -> Result<Vec<SampleState>> {
    let mut states = vec![SampleState::Invalid; pixels.len()];
    let (left, top, right, bottom) = input.active_bounds;
    for y in top.min(input.height)..bottom.min(input.height) {
        if (y - top.min(input.height)).is_multiple_of(64) {
            check_cancel()?;
        }
        for x in left.min(input.width)..right.min(input.width) {
            let index = y * input.width + x;
            states[index] = match input.normalized(pixels, x, y) {
                None => {
                    report.invalid_samples += 1;
                    SampleState::Invalid
                }
                Some(signal) if signal >= clipping_threshold => {
                    report.clipped_samples += 1;
                    SampleState::Clipped
                }
                Some(signal) if signal >= clipping_threshold - 0.03 => {
                    report.near_clipped_samples += 1;
                    SampleState::NearClipped
                }
                Some(_) => SampleState::Unclipped,
            };
        }
    }
    Ok(states)
}

fn clipped_regions(
    states: &[SampleState],
    input: &SensorReconstructionInput<'_>,
    check_cancel: &mut impl FnMut() -> Result<()>,
) -> Result<Vec<Vec<usize>>> {
    let mut visited = vec![false; states.len()];
    let mut regions = Vec::new();
    let (left, top, right, bottom) = input.active_bounds;
    for y in top.min(input.height)..bottom.min(input.height) {
        if (y - top.min(input.height)).is_multiple_of(64) {
            check_cancel()?;
        }
        for x in left.min(input.width)..right.min(input.width) {
            let start = y * input.width + x;
            if visited[start] || states[start] != SampleState::Clipped {
                continue;
            }
            visited[start] = true;
            let mut queue = VecDeque::from([start]);
            let mut region = Vec::new();
            while let Some(index) = queue.pop_front() {
                if region.len().is_multiple_of(65_536) {
                    check_cancel()?;
                }
                region.push(index);
                let px = index % input.width;
                let py = index / input.width;
                for (dx, dy) in [(1_isize, 0_isize), (-1, 0), (0, 1), (0, -1)] {
                    let nx = px as isize + dx;
                    let ny = py as isize + dy;
                    if nx < left as isize
                        || ny < top as isize
                        || nx >= right as isize
                        || ny >= bottom as isize
                        || nx < 0
                        || ny < 0
                        || nx as usize >= input.width
                        || ny as usize >= input.height
                    {
                        continue;
                    }
                    let neighbor = ny as usize * input.width + nx as usize;
                    if !visited[neighbor] && states[neighbor] == SampleState::Clipped {
                        visited[neighbor] = true;
                        queue.push_back(neighbor);
                    }
                }
            }
            regions.push(region);
        }
    }
    Ok(regions)
}

pub fn reconstruct_integer_sensor(
    pixels: &mut [u16],
    input: &SensorReconstructionInput<'_>,
    mode: HighlightReconstructionMode,
    mut check_cancel: impl FnMut() -> Result<()>,
) -> Result<HighlightReconstructionOutput> {
    if pixels.len() != input.width.saturating_mul(input.height) {
        return Err(anyhow!(
            "highlight_reconstruction_invalid_sensor_dimensions"
        ));
    }
    let mut report = HighlightReconstructionReportV2::bypassed(mode, input.topology.kind);
    if mode == HighlightReconstructionMode::Off {
        return Ok(HighlightReconstructionOutput {
            report,
            confidence: Vec::new(),
            unrecoverable_sensor_indices: Vec::new(),
        });
    }
    if input.topology.kind == CfaKind::Unsupported || input.white_levels.is_empty() {
        report.warning_codes.push("unsupported_cfa_or_white_levels");
        return Ok(HighlightReconstructionOutput {
            report,
            confidence: Vec::new(),
            unrecoverable_sensor_indices: Vec::new(),
        });
    }

    let clipping_threshold = match mode {
        HighlightReconstructionMode::Conservative => 0.997,
        HighlightReconstructionMode::Auto => 0.995,
        HighlightReconstructionMode::Strong => 0.99,
        HighlightReconstructionMode::Off => unreachable!(),
    };
    let confidence_threshold = match mode {
        HighlightReconstructionMode::Conservative => 0.62,
        HighlightReconstructionMode::Auto => 0.48,
        HighlightReconstructionMode::Strong => 0.34,
        HighlightReconstructionMode::Off => unreachable!(),
    };
    let states = classify_samples(
        pixels,
        input,
        clipping_threshold,
        &mut report,
        &mut check_cancel,
    )?;
    if report.clipped_samples == 0 {
        return Ok(HighlightReconstructionOutput {
            report,
            confidence: Vec::new(),
            unrecoverable_sensor_indices: Vec::new(),
        });
    }
    let regions = clipped_regions(&states, input, &mut check_cancel)?;
    let mut confidence = vec![0.0; pixels.len()];
    report.largest_clipped_region = regions.iter().map(Vec::len).max().unwrap_or(0) as u64;
    let original = pixels.to_vec();
    let mut replacements = Vec::new();
    let mut confidence_values = Vec::new();
    let mut unrecoverable = Vec::new();

    for (region_index, region) in regions.iter().enumerate() {
        if region_index % 16 == 0 {
            check_cancel()?;
        }
        for &index in region {
            let x = index % input.width;
            let y = index / input.width;
            let radius = input.topology.phase_radius() + usize::from(region.len() > 12) * 4;
            let samples = same_color_neighbors(&original, input, &states, x, y, radius);
            let spatial = spatial_candidate(&samples, clipping_threshold);
            let cross = cross_channel_candidate(
                &original,
                input,
                &states,
                x,
                y,
                &samples,
                clipping_threshold,
            );
            let mut candidate = [spatial, cross]
                .into_iter()
                .flatten()
                .max_by(|left, right| {
                    (left.confidence * (left.signal - clipping_threshold).max(0.0)).total_cmp(
                        &(right.confidence * (right.signal - clipping_threshold).max(0.0)),
                    )
                });

            if candidate.is_none() && !samples.is_empty() {
                let weighted = samples
                    .iter()
                    .map(|sample| sample.signal / sample.distance.max(1.0))
                    .sum::<f32>()
                    / samples
                        .iter()
                        .map(|sample| 1.0 / sample.distance.max(1.0))
                        .sum::<f32>()
                        .max(f32::EPSILON);
                candidate = Some(Candidate {
                    signal: (1.0 + (1.0 - weighted.clamp(0.0, 1.0)) * 0.15).clamp(1.0, 1.12),
                    confidence: (samples.len() as f32 / 20.0).clamp(0.12, 0.4),
                    method: HighlightReconstructionMethod::RegionPropagation,
                });
            }

            let Some(candidate) = candidate else {
                unrecoverable.push(index);
                continue;
            };
            if candidate.confidence < confidence_threshold * 0.5 {
                unrecoverable.push(index);
                continue;
            }
            let Some(black) = input.black_at(x, y) else {
                unrecoverable.push(index);
                continue;
            };
            let Some(white) = input.white_at(x, y) else {
                unrecoverable.push(index);
                continue;
            };
            let original_signal = input.normalized(&original, x, y).unwrap_or(1.0);
            let blend = (0.5 + candidate.confidence * 0.5).clamp(0.0, 1.0);
            let reconstructed_signal =
                (original_signal + (candidate.signal - original_signal) * blend).clamp(0.0, 1.2);
            let replacement =
                (black + reconstructed_signal * (white - black)).clamp(0.0, u16::MAX as f32);
            if replacement.is_finite() && replacement > original[index] as f32 {
                replacements.push((index, replacement.round() as u16));
                confidence[index] = candidate.confidence;
                confidence_values.push(candidate.confidence);
                *report.method_counts.entry(candidate.method).or_default() += 1;
                if candidate.confidence >= confidence_threshold {
                    report.reconstructed_samples += 1;
                } else {
                    report.partially_reconstructed_samples += 1;
                }
            } else {
                unrecoverable.push(index);
            }
        }
    }

    for (index, replacement) in replacements {
        pixels[index] = replacement;
    }
    report.unrecoverable_samples = unrecoverable.len() as u64;
    report.confidence_percentiles = percentile_summary(&mut confidence_values);
    if report.unrecoverable_samples > 0 {
        report.warning_codes.push("unrecoverable_sensor_highlights");
    }
    Ok(HighlightReconstructionOutput {
        report,
        confidence,
        unrecoverable_sensor_indices: unrecoverable,
    })
}

pub fn apply_post_demosaic_chroma_fallback(
    pixels: &mut [[f32; 3]],
    width: usize,
    height: usize,
    unrecoverable_sensor_indices: &[usize],
    report: &mut HighlightReconstructionReportV2,
) {
    if unrecoverable_sensor_indices.is_empty() || pixels.len() != width.saturating_mul(height) {
        return;
    }
    let original = pixels.to_vec();
    let mut replacements = Vec::new();
    for &index in unrecoverable_sensor_indices {
        let x = index % width;
        let y = index / width;
        if index >= original.len() || x == 0 || y == 0 || x + 1 >= width || y + 1 >= height {
            continue;
        }
        let pixel = original[index];
        if !pixel.iter().all(|value| value.is_finite())
            || pixel.iter().copied().fold(0.0, f32::max) < 0.995
        {
            continue;
        }
        let mut chroma = Vec::new();
        for dy in -1_isize..=1 {
            for dx in -1_isize..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let neighbor =
                    original[(y as isize + dy) as usize * width + (x as isize + dx) as usize];
                let energy = neighbor.iter().copied().sum::<f32>();
                if energy > 0.05 && neighbor.iter().copied().fold(0.0, f32::max) < 0.98 {
                    chroma.push([
                        neighbor[0] / energy,
                        neighbor[1] / energy,
                        neighbor[2] / energy,
                    ]);
                }
            }
        }
        let energy = pixel.iter().copied().sum::<f32>().max(0.0);
        if chroma.len() >= 3 {
            let mean = chroma.iter().fold([0.0; 3], |mut total, sample| {
                for channel in 0..3 {
                    total[channel] += sample[channel];
                }
                total
            });
            let scale = 1.0 / chroma.len() as f32;
            let estimate = [
                mean[0] * scale * energy,
                mean[1] * scale * energy,
                mean[2] * scale * energy,
            ];
            let blended = [
                pixel[0] * 0.65 + estimate[0] * 0.35,
                pixel[1] * 0.65 + estimate[1] * 0.35,
                pixel[2] * 0.65 + estimate[2] * 0.35,
            ];
            if blended.iter().all(|value| value.is_finite()) {
                replacements.push((
                    index,
                    blended,
                    HighlightReconstructionMethod::PostDemosaicChroma,
                ));
            }
        } else {
            let minimum = pixel.iter().copied().fold(f32::INFINITY, f32::min);
            let maximum = pixel.iter().copied().fold(f32::NEG_INFINITY, f32::max);
            if maximum - minimum <= maximum.max(1.0) * 0.03 {
                let neutral = [energy / 3.0; 3];
                replacements.push((
                    index,
                    neutral,
                    HighlightReconstructionMethod::NeutralSpecularFallback,
                ));
            }
        }
    }
    let recovered = replacements.len() as u64;
    for (index, replacement, method) in replacements {
        pixels[index] = replacement;
        report.post_demosaic_fallback_samples += 1;
        *report.method_counts.entry(method).or_default() += 1;
    }
    report.unrecoverable_samples = report.unrecoverable_samples.saturating_sub(recovered);
    if report.unrecoverable_samples == 0 {
        report
            .warning_codes
            .retain(|code| *code != "unrecoverable_sensor_highlights");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const XTRANS: &str = "GGRGGBGGBGGRBRGRGGGGRGGBGGBGGRBRGRGG";

    fn topology(pattern: &str, width: usize, height: usize) -> CfaTopology {
        CfaTopology::new(
            width,
            height,
            pattern
                .chars()
                .map(|color| match color {
                    'R' => 0,
                    'G' => 1,
                    'B' => 2,
                    _ => usize::MAX,
                })
                .collect(),
        )
    }

    fn mosaic_fixture(topology: CfaTopology, width: usize, height: usize) -> (Vec<u16>, Vec<f32>) {
        let white = [1000.0, 920.0, 1080.0];
        let black = 64.0;
        let mut pixels = Vec::with_capacity(width * height);
        let mut truth = Vec::with_capacity(width * height);
        for y in 0..height {
            for x in 0..width {
                let color = topology.color_at(x, y).unwrap();
                let signal = 0.72 + x as f32 * 0.006 + y as f32 * 0.002;
                truth.push(signal);
                pixels.push((black + signal.min(1.0) * (white[color] - black)).round() as u16);
            }
        }
        (pixels, truth)
    }

    fn input<'a>(
        topology: CfaTopology,
        width: usize,
        height: usize,
        black: &'a [f32],
        white: &'a [f32],
    ) -> SensorReconstructionInput<'a> {
        SensorReconstructionInput {
            width,
            height,
            active_bounds: (0, 0, width, height),
            topology,
            black_levels: black,
            black_width: 1,
            black_height: 1,
            black_cpp: 1,
            white_levels: white,
        }
    }

    fn v1_headroom_estimate(neighbor_signal: f32) -> f32 {
        1.0 + (1.0 - neighbor_signal) * 0.25
    }

    fn assert_recovery_beats_v1(pattern: &str, period: usize) {
        let width = 24;
        let height = 24;
        let topology = topology(pattern, period, period);
        let (mut pixels, mut truth) = mosaic_fixture(topology.clone(), width, height);
        let target = (12, 12);
        let index = target.1 * width + target.0;
        let color = topology.color_at(target.0, target.1).unwrap();
        let black = [64.0];
        let white = [1000.0, 920.0, 1080.0];
        truth[index] = 1.08;
        pixels[index] = white[color] as u16;
        let context = input(topology, width, height, &black, &white);
        let output = reconstruct_integer_sensor(
            &mut pixels,
            &context,
            HighlightReconstructionMode::Strong,
            || Ok(()),
        )
        .unwrap();
        let reconstructed = (pixels[index] as f32 - black[0]) / (white[color] - black[0]);
        let neighbor_signal = 0.72 + target.0 as f32 * 0.006 + target.1 as f32 * 0.002;
        let v1_error = (v1_headroom_estimate(neighbor_signal) - truth[index]).abs();
        let v2_error = (reconstructed - truth[index]).abs();
        assert!(
            v2_error < v1_error,
            "v2={reconstructed} error={v2_error}, v1_error={v1_error}"
        );
        assert_eq!(output.report.clipped_samples, 1);
        assert_eq!(
            output.report.reconstructed_samples + output.report.partially_reconstructed_samples,
            1
        );
        assert!(output.confidence[index] > 0.0);
    }

    #[test]
    fn topology_supports_bayer_and_xtrans_phase_maps() {
        let bayer = topology("RGGB", 2, 2);
        let xtrans = topology(XTRANS, 6, 6);
        assert_eq!(bayer.kind, CfaKind::Bayer);
        assert_eq!(xtrans.kind, CfaKind::XTrans);
        assert_eq!(xtrans.color_at(0, 0), xtrans.color_at(6, 6));
        assert_ne!(xtrans.color_at(0, 0), xtrans.color_at(2, 0));
    }

    #[test]
    fn bayer_ground_truth_error_is_lower_than_v1_headroom() {
        assert_recovery_beats_v1("RGGB", 2);
    }

    #[test]
    fn xtrans_ground_truth_error_is_lower_than_v1_headroom() {
        assert_recovery_beats_v1(XTRANS, 6);
    }

    #[test]
    fn disabled_and_no_clipping_paths_are_exact_bypasses() {
        let black = [64.0];
        let white = [1000.0, 920.0, 1080.0];
        let topology = topology("RGGB", 2, 2);
        let (pixels, _) = mosaic_fixture(topology.clone(), 16, 16);
        let context = input(topology, 16, 16, &black, &white);
        for mode in [
            HighlightReconstructionMode::Off,
            HighlightReconstructionMode::Conservative,
            HighlightReconstructionMode::Auto,
        ] {
            let mut candidate = pixels.clone();
            let output =
                reconstruct_integer_sensor(&mut candidate, &context, mode, || Ok(())).unwrap();
            assert_eq!(candidate, pixels);
            assert_eq!(output.report.reconstructed_samples, 0);
            assert!(output.confidence.is_empty());
        }
    }

    #[test]
    fn all_channel_region_without_boundary_evidence_is_truthfully_unrecoverable() {
        let black = [64.0];
        let white = [1000.0, 920.0, 1080.0];
        let topology = topology("RGGB", 2, 2);
        let mut pixels = vec![1000; 8 * 8];
        for y in 0..8 {
            for x in 0..8 {
                let color = topology.color_at(x, y).unwrap();
                pixels[y * 8 + x] = white[color] as u16;
            }
        }
        let original = pixels.clone();
        let context = input(topology, 8, 8, &black, &white);
        let output = reconstruct_integer_sensor(
            &mut pixels,
            &context,
            HighlightReconstructionMode::Strong,
            || Ok(()),
        )
        .unwrap();
        assert_eq!(pixels, original);
        assert_eq!(output.report.unrecoverable_samples, 64);
        assert_eq!(output.report.reconstructed_samples, 0);
    }

    #[test]
    fn per_channel_white_levels_drive_clipping_classification() {
        let black = [32.0];
        let white = [1000.0, 800.0, 1200.0];
        let topology = topology("RGGB", 2, 2);
        let mut pixels = vec![500; 4 * 4];
        pixels[1] = 799;
        pixels[2] = 999;
        let context = input(topology, 4, 4, &black, &white);
        let output = reconstruct_integer_sensor(
            &mut pixels,
            &context,
            HighlightReconstructionMode::Auto,
            || Ok(()),
        )
        .unwrap();
        assert_eq!(output.report.clipped_samples, 2);
    }

    #[test]
    fn cancellation_publishes_no_partial_sensor_reconstruction() {
        let black = [64.0];
        let white = [1000.0, 920.0, 1080.0];
        let topology = topology("RGGB", 2, 2);
        let (mut pixels, _) = mosaic_fixture(topology.clone(), 64, 64);
        for y in (4..60).step_by(8) {
            for x in (4..60).step_by(8) {
                let color = topology.color_at(x, y).unwrap();
                pixels[y * 64 + x] = white[color] as u16;
            }
        }
        let original = pixels.clone();
        let context = input(topology, 64, 64, &black, &white);
        let result = reconstruct_integer_sensor(
            &mut pixels,
            &context,
            HighlightReconstructionMode::Strong,
            || Err(anyhow!("cancelled")),
        );
        assert_eq!(result.unwrap_err().to_string(), "cancelled");
        assert_eq!(pixels, original);
    }

    #[test]
    fn post_demosaic_fallback_preserves_energy_and_finite_output() {
        let mut pixels = vec![[0.4, 0.5, 0.3]; 5 * 5];
        pixels[12] = [1.2, 0.4, 0.2];
        pixels[18] = [1.1, 0.3, 0.2];
        let unrelated = pixels[18];
        let energy = pixels[12].iter().sum::<f32>();
        let mut report = HighlightReconstructionReportV2::bypassed(
            HighlightReconstructionMode::Strong,
            CfaKind::Bayer,
        );
        report.unrecoverable_samples = 1;
        apply_post_demosaic_chroma_fallback(&mut pixels, 5, 5, &[12], &mut report);
        assert_eq!(report.post_demosaic_fallback_samples, 1);
        assert_eq!(report.unrecoverable_samples, 0);
        assert!(pixels[12].iter().all(|value| value.is_finite()));
        assert!((pixels[12].iter().sum::<f32>() - energy).abs() < 1.0e-5);
        assert!(pixels[12][0] < 1.2);
        assert_eq!(pixels[18], unrelated);
    }

    #[test]
    fn neutral_specular_fallback_is_explicit_and_energy_preserving() {
        let mut pixels = vec![[1.0, 1.01, 0.99]; 5 * 5];
        pixels[12] = [1.2, 1.19, 1.2];
        let energy = pixels[12].iter().sum::<f32>();
        let mut report = HighlightReconstructionReportV2::bypassed(
            HighlightReconstructionMode::Strong,
            CfaKind::Bayer,
        );
        report.unrecoverable_samples = 1;
        report.warning_codes.push("unrecoverable_sensor_highlights");

        apply_post_demosaic_chroma_fallback(&mut pixels, 5, 5, &[12], &mut report);

        assert_eq!(report.unrecoverable_samples, 0);
        assert!(report.warning_codes.is_empty());
        assert_eq!(
            report
                .method_counts
                .get(&HighlightReconstructionMethod::NeutralSpecularFallback),
            Some(&1)
        );
        assert_eq!(pixels[12][0], pixels[12][1]);
        assert_eq!(pixels[12][1], pixels[12][2]);
        assert!((pixels[12].iter().sum::<f32>() - energy).abs() < 1.0e-5);
    }
}
