use rawler::{
    cfa::{CFA, CFA_COLOR_B, CFA_COLOR_G, CFA_COLOR_R},
    imgop::Rect,
    pixarray::{Color2D, PixF32},
};

pub const XTRANS_HQ_ALGORITHM_ID: &str = "rawengine_xtrans_directional_hq_v1";

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XTransHqReport {
    pub border_fallback_pixels: usize,
    pub chroma_interpolated_pixels: usize,
    pub chroma_limited_pixels: usize,
    pub chroma_refined_pixels: usize,
    pub evaluated_pixels: usize,
    pub green_directional_pixels: usize,
    pub green_high_confidence_pixels: usize,
    pub green_low_confidence_pixels: usize,
    pub green_medium_confidence_pixels: usize,
    pub green_second_order_corrected_pixels: usize,
    pub period6_chroma_suppressed_pixels: usize,
}

fn pixel_index(width: usize, row: usize, col: usize) -> usize {
    row * width + col
}

fn sample_same_color(
    pixels: &PixF32,
    cfa: &CFA,
    sensor_row: usize,
    sensor_col: usize,
    target_color: usize,
    radius: isize,
) -> Option<f32> {
    let mut sum = 0.0;
    let mut count = 0usize;
    let row = sensor_row as isize;
    let col = sensor_col as isize;

    for dy in -radius..=radius {
        for dx in -radius..=radius {
            if dx == 0 && dy == 0 {
                continue;
            }

            let sample_row = row + dy;
            let sample_col = col + dx;
            if sample_row < 0
                || sample_col < 0
                || sample_row as usize >= pixels.height
                || sample_col as usize >= pixels.width
            {
                continue;
            }

            let sample_row = sample_row as usize;
            let sample_col = sample_col as usize;
            if cfa.color_at(sample_row, sample_col) == target_color {
                sum += *pixels.at(sample_row, sample_col);
                count += 1;
            }
        }
    }

    (count > 0).then_some(sum / count as f32)
}

#[derive(Debug, Clone, Copy)]
struct DirectionalGreenCandidate {
    value: f32,
    gradient: f32,
    second_order_corrected: bool,
}

fn same_color_samples_in_direction(
    pixels: &PixF32,
    cfa: &CFA,
    sensor_row: usize,
    sensor_col: usize,
    delta_row: isize,
    delta_col: isize,
    target_color: usize,
) -> Vec<(usize, f32)> {
    let mut samples = Vec::with_capacity(2);
    let row = sensor_row as isize;
    let col = sensor_col as isize;

    for distance in 1..=8usize {
        let sample_row = row + delta_row * distance as isize;
        let sample_col = col + delta_col * distance as isize;
        if sample_row < 0
            || sample_col < 0
            || sample_row as usize >= pixels.height
            || sample_col as usize >= pixels.width
        {
            break;
        }

        let sample_row = sample_row as usize;
        let sample_col = sample_col as usize;
        if cfa.color_at(sample_row, sample_col) == target_color {
            samples.push((distance, *pixels.at(sample_row, sample_col)));
            if samples.len() == 2 {
                break;
            }
        }
    }

    samples
}

fn directional_green_candidate(
    pixels: &PixF32,
    cfa: &CFA,
    sensor_row: usize,
    sensor_col: usize,
    delta_row: isize,
    delta_col: isize,
) -> Option<DirectionalGreenCandidate> {
    let before = same_color_samples_in_direction(
        pixels,
        cfa,
        sensor_row,
        sensor_col,
        -delta_row,
        -delta_col,
        CFA_COLOR_G,
    );
    let after = same_color_samples_in_direction(
        pixels,
        cfa,
        sensor_row,
        sensor_col,
        delta_row,
        delta_col,
        CFA_COLOR_G,
    );
    let before_near = before.first()?;
    let after_near = after.first()?;
    let near_avg = (before_near.1 + after_near.1) * 0.5;
    let gradient = (before_near.1 - after_near.1).abs()
        / ((before_near.0 + after_near.0) as f32 * 0.5).max(1.0);

    let Some(before_outer) = before.get(1) else {
        return Some(DirectionalGreenCandidate {
            value: near_avg,
            gradient,
            second_order_corrected: false,
        });
    };
    let Some(after_outer) = after.get(1) else {
        return Some(DirectionalGreenCandidate {
            value: near_avg,
            gradient,
            second_order_corrected: false,
        });
    };

    let outer_avg = (before_outer.1 + after_outer.1) * 0.5;
    let correction = (near_avg - outer_avg) * 0.18;
    let min_near = before_near.1.min(after_near.1);
    let max_near = before_near.1.max(after_near.1);
    Some(DirectionalGreenCandidate {
        value: (near_avg + correction).clamp(min_near, max_near),
        gradient,
        second_order_corrected: true,
    })
}

fn adaptive_green(
    pixels: &PixF32,
    cfa: &CFA,
    sensor_row: usize,
    sensor_col: usize,
    report: &mut XTransHqReport,
) -> f32 {
    if cfa.color_at(sensor_row, sensor_col) == CFA_COLOR_G {
        return *pixels.at(sensor_row, sensor_col);
    }

    let candidates = [
        directional_green_candidate(pixels, cfa, sensor_row, sensor_col, 0, 1),
        directional_green_candidate(pixels, cfa, sensor_row, sensor_col, 1, 0),
        directional_green_candidate(pixels, cfa, sensor_row, sensor_col, 1, 1),
        directional_green_candidate(pixels, cfa, sensor_row, sensor_col, 1, -1),
    ];
    let candidates: Vec<DirectionalGreenCandidate> = candidates.into_iter().flatten().collect();

    if candidates.is_empty() {
        report.border_fallback_pixels += 1;
        return sample_same_color(pixels, cfa, sensor_row, sensor_col, CFA_COLOR_G, 3)
            .unwrap_or_else(|| *pixels.at(sensor_row, sensor_col));
    }

    report.green_directional_pixels += 1;
    let min_gradient = candidates
        .iter()
        .map(|candidate| candidate.gradient)
        .fold(f32::INFINITY, f32::min);
    let mut weighted_sum = 0.0;
    let mut weight_sum = 0.0;
    let mut corrected_count = 0usize;

    for candidate in candidates {
        let weight = 1.0 / (0.000_1 + candidate.gradient + min_gradient * 0.25);
        weighted_sum += candidate.value * weight;
        weight_sum += weight;
        corrected_count += usize::from(candidate.second_order_corrected);
    }

    if min_gradient <= 0.018 {
        report.green_high_confidence_pixels += 1;
    } else if min_gradient <= 0.055 {
        report.green_medium_confidence_pixels += 1;
    } else {
        report.green_low_confidence_pixels += 1;
    }
    report.green_second_order_corrected_pixels += corrected_count;

    if weight_sum > 0.0 {
        weighted_sum / weight_sum
    } else {
        sample_same_color(pixels, cfa, sensor_row, sensor_col, CFA_COLOR_G, 3)
            .unwrap_or_else(|| *pixels.at(sensor_row, sensor_col))
    }
}

fn sample_color_difference(
    pixels: &PixF32,
    cfa: &CFA,
    greens: &[f32],
    width: usize,
    sensor_row: usize,
    sensor_col: usize,
    color: usize,
) -> Option<f32> {
    let mut sum = 0.0;
    let mut count = 0usize;
    let row = sensor_row as isize;
    let col = sensor_col as isize;

    for radius in [2isize, 3, 4] {
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let sample_row = row + dy;
                let sample_col = col + dx;
                if sample_row < 0
                    || sample_col < 0
                    || sample_row as usize >= pixels.height
                    || sample_col as usize >= pixels.width
                    || cfa.color_at(sample_row as usize, sample_col as usize) != color
                {
                    continue;
                }

                let sample_index = pixel_index(width, sample_row as usize, sample_col as usize);
                sum += *pixels.at(sample_row as usize, sample_col as usize) - greens[sample_index];
                count += 1;
            }
        }

        if count > 0 {
            return Some(sum / count as f32);
        }
    }

    None
}

fn luma(pixel: [f32; 3]) -> f32 {
    pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722
}

fn refine_chroma(image: &mut Color2D<f32, 3>, report: &mut XTransHqReport) {
    const CHROMA_DELTA_THRESHOLD: f32 = 0.044;
    const MAX_CHROMA_BLEND: f32 = 0.66;
    const MIN_EDGE_CHROMA_BLEND: f32 = 0.24;

    if image.width < 3 || image.height < 3 {
        return;
    }

    let original = image.data.clone();
    for row in 1..image.height - 1 {
        for col in 1..image.width - 1 {
            report.evaluated_pixels += 1;
            let index = pixel_index(image.width, row, col);
            let center = original[index];
            let west = original[pixel_index(image.width, row, col - 1)];
            let east = original[pixel_index(image.width, row, col + 1)];
            let north = original[pixel_index(image.width, row - 1, col)];
            let south = original[pixel_index(image.width, row + 1, col)];
            let horizontal_gradient = (luma(west) - luma(east)).abs();
            let vertical_gradient = (luma(north) - luma(south)).abs();
            let local_luma_structure = horizontal_gradient.max(vertical_gradient);
            let (a, b, gradient) = if horizontal_gradient <= vertical_gradient {
                (west, east, horizontal_gradient)
            } else {
                (north, south, vertical_gradient)
            };
            let center_rg = center[0] - center[1];
            let center_bg = center[2] - center[1];
            let target_rg = ((a[0] - a[1]) + (b[0] - b[1])) * 0.5;
            let target_bg = ((a[2] - a[1]) + (b[2] - b[1])) * 0.5;
            let delta = (center_rg - target_rg)
                .abs()
                .max((center_bg - target_bg).abs());
            if delta <= CHROMA_DELTA_THRESHOLD + gradient * 0.4 {
                continue;
            }

            let period6_phase = (row + col) % 6 == 0 || row % 6 == col % 6;
            let edge_protection = (local_luma_structure * 3.5).clamp(0.0, 0.32);
            let period6_boost = if period6_phase && local_luma_structure < 0.09 {
                0.10
            } else {
                0.0
            };
            let chroma_blend = (MAX_CHROMA_BLEND - edge_protection + period6_boost)
                .clamp(MIN_EDGE_CHROMA_BLEND, MAX_CHROMA_BLEND);
            image.data[index] = [
                (center[1] + center_rg + (target_rg - center_rg) * chroma_blend).max(0.0),
                center[1].max(0.0),
                (center[1] + center_bg + (target_bg - center_bg) * chroma_blend).max(0.0),
            ];
            report.chroma_refined_pixels += 1;
            report.chroma_limited_pixels += 1;
            if period6_phase {
                report.period6_chroma_suppressed_pixels += 1;
            }
        }
    }
}

pub fn demosaic_xtrans_hq(
    pixels: &PixF32,
    cfa: &CFA,
    roi: Rect,
) -> (Color2D<f32, 3>, XTransHqReport) {
    let shifted_cfa = cfa.shift(roi.p.x, roi.p.y);
    let mut report = XTransHqReport::default();
    let mut greens = vec![0.0; pixels.width * pixels.height];

    for sensor_row in 0..pixels.height {
        for sensor_col in 0..pixels.width {
            let index = pixel_index(pixels.width, sensor_row, sensor_col);
            greens[index] = adaptive_green(pixels, cfa, sensor_row, sensor_col, &mut report);
        }
    }

    let mut output = Vec::with_capacity(roi.d.w * roi.d.h);
    for row_out in 0..roi.d.h {
        let sensor_row = roi.p.y + row_out;
        for col_out in 0..roi.d.w {
            let sensor_col = roi.p.x + col_out;
            let sensor_index = pixel_index(pixels.width, sensor_row, sensor_col);
            let cfa_color = shifted_cfa.color_at(row_out, col_out);
            let current = *pixels.at(sensor_row, sensor_col);
            let green = greens[sensor_index];
            let red = if cfa_color == CFA_COLOR_R {
                current
            } else {
                report.chroma_interpolated_pixels += 1;
                green
                    + sample_color_difference(
                        pixels,
                        cfa,
                        &greens,
                        pixels.width,
                        sensor_row,
                        sensor_col,
                        CFA_COLOR_R,
                    )
                    .unwrap_or(0.0)
            };
            let blue = if cfa_color == CFA_COLOR_B {
                current
            } else {
                report.chroma_interpolated_pixels += 1;
                green
                    + sample_color_difference(
                        pixels,
                        cfa,
                        &greens,
                        pixels.width,
                        sensor_row,
                        sensor_col,
                        CFA_COLOR_B,
                    )
                    .unwrap_or(0.0)
            };

            output.push([red.max(0.0), green.max(0.0), blue.max(0.0)]);
        }
    }

    let mut image = Color2D::new_with(output, roi.d.w, roi.d.h);
    refine_chroma(&mut image, &mut report);
    (image, report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rawler::cfa::{CFA_COLOR_B, CFA_COLOR_G, CFA_COLOR_R};

    const XTRANS_PATTERN: &str = "GGRGGBGGBGGRBRGRGGGGRGGBGGBGGRBRGRGG";

    #[derive(Debug, Clone, Copy)]
    struct XTransSyntheticMetrics {
        rgb_mae_against_synthetic_truth: f32,
        green_plane_mae: f32,
        mtf50_relative: f32,
        false_chroma_energy: f32,
        zipper_edge_count: usize,
        maze_score: f32,
        edge_displacement_px: f32,
        flat_field_chroma_noise_amplification: f32,
        period6_artifact_energy: f32,
        color_detail_retention: f32,
    }

    fn synthetic_color(row: usize, col: usize, width: usize, fixture: &str) -> [f32; 3] {
        let x = col as f32 / (width.saturating_sub(1).max(1) as f32);
        let y = row as f32 / (width.saturating_sub(1).max(1) as f32);
        match fixture {
            "slanted_edge" => {
                let edge = x + y * 0.18;
                let luma = if edge > 0.58 { 0.78 } else { 0.18 };
                [luma * 1.04, luma, luma * 0.94]
            }
            "zone_plate" => {
                let dx = x - 0.5;
                let dy = y - 0.5;
                let wave = ((dx * dx + dy * dy) * 220.0).sin() * 0.18;
                [0.48 + wave, 0.50 + wave * 0.82, 0.52 - wave * 0.55]
            }
            "fabric" => {
                let weave = ((col as f32 * 0.72).sin() + (row as f32 * 0.64).cos()) * 0.08;
                let diagonal = ((row + col) as f32 * 0.37).sin() * 0.05;
                [0.46 + weave + diagonal, 0.50 + weave * 0.8, 0.55 - diagonal]
            }
            "flat_noisy" => {
                let noise = (((row * 37 + col * 17) % 23) as f32 - 11.0) * 0.0018;
                [0.50 + noise, 0.50 + noise, 0.50 + noise]
            }
            _ => [0.45 + x * 0.12, 0.47 + y * 0.1, 0.46 + (x - y) * 0.04],
        }
    }

    fn mosaic_truth(cfa: &CFA, truth: &[[f32; 3]], width: usize, height: usize) -> PixF32 {
        let mut pixels = Vec::with_capacity(width * height);
        for row in 0..height {
            for col in 0..width {
                let channel = match cfa.color_at(row, col) {
                    CFA_COLOR_R => 0,
                    CFA_COLOR_G => 1,
                    CFA_COLOR_B => 2,
                    _ => 1,
                };
                pixels.push(truth[pixel_index(width, row, col)][channel]);
            }
        }
        PixF32::new_with(pixels, width, height)
    }

    fn nearest_color_baseline(pixels: &PixF32, cfa: &CFA, roi: Rect) -> Color2D<f32, 3> {
        let mut output = Vec::with_capacity(roi.d.w * roi.d.h);
        for row_out in 0..roi.d.h {
            let row = roi.p.y + row_out;
            for col_out in 0..roi.d.w {
                let col = roi.p.x + col_out;
                let mut rgb = [0.0; 3];
                for (channel, color) in [CFA_COLOR_R, CFA_COLOR_G, CFA_COLOR_B]
                    .into_iter()
                    .enumerate()
                {
                    rgb[channel] = if cfa.color_at(row, col) == color {
                        *pixels.at(row, col)
                    } else {
                        sample_same_color(pixels, cfa, row, col, color, 3)
                            .unwrap_or_else(|| *pixels.at(row, col))
                    };
                }
                output.push(rgb);
            }
        }
        Color2D::new_with(output, roi.d.w, roi.d.h)
    }

    fn mean_abs_rgb(image: &Color2D<f32, 3>, truth: &[[f32; 3]]) -> f32 {
        let total: f32 = image
            .data
            .iter()
            .zip(truth.iter())
            .map(|(actual, expected)| {
                (actual[0] - expected[0]).abs()
                    + (actual[1] - expected[1]).abs()
                    + (actual[2] - expected[2]).abs()
            })
            .sum();
        total / (image.data.len().max(1) as f32 * 3.0)
    }

    fn green_mae(image: &Color2D<f32, 3>, truth: &[[f32; 3]]) -> f32 {
        image
            .data
            .iter()
            .zip(truth.iter())
            .map(|(actual, expected)| (actual[1] - expected[1]).abs())
            .sum::<f32>()
            / image.data.len().max(1) as f32
    }

    fn false_chroma_energy(image: &Color2D<f32, 3>, truth: &[[f32; 3]]) -> f32 {
        image
            .data
            .iter()
            .zip(truth.iter())
            .map(|(actual, expected)| {
                ((actual[0] - actual[1]) - (expected[0] - expected[1])).abs()
                    + ((actual[2] - actual[1]) - (expected[2] - expected[1])).abs()
            })
            .sum::<f32>()
            / (image.data.len().max(1) as f32 * 2.0)
    }

    fn edge_acutance(image: &Color2D<f32, 3>) -> f32 {
        let row = image.height / 2;
        (1..image.width)
            .map(|col| {
                let left = luma(image.data[pixel_index(image.width, row, col - 1)]);
                let right = luma(image.data[pixel_index(image.width, row, col)]);
                (right - left).abs()
            })
            .fold(0.0, f32::max)
    }

    fn edge_center(image: &Color2D<f32, 3>) -> f32 {
        let row = image.height / 2;
        let mut weighted_sum = 0.0;
        let mut weight_sum = 0.0;
        for col in 1..image.width {
            let left = luma(image.data[pixel_index(image.width, row, col - 1)]);
            let right = luma(image.data[pixel_index(image.width, row, col)]);
            let weight = (right - left).abs();
            weighted_sum += col as f32 * weight;
            weight_sum += weight;
        }
        if weight_sum > f32::EPSILON {
            weighted_sum / weight_sum
        } else {
            image.width as f32 * 0.5
        }
    }

    fn zipper_edge_count(image: &Color2D<f32, 3>, truth: &[[f32; 3]]) -> usize {
        let row = image.height / 2;
        let mut count = 0usize;
        let mut previous_sign = 0i8;
        for col in 1..image.width {
            let index = pixel_index(image.width, row, col);
            let error = image.data[index][1] - truth[index][1];
            let sign = if error > 0.018 {
                1
            } else if error < -0.018 {
                -1
            } else {
                0
            };
            if sign != 0 && previous_sign != 0 && sign != previous_sign {
                count += 1;
            }
            if sign != 0 {
                previous_sign = sign;
            }
        }
        count
    }

    fn maze_score(image: &Color2D<f32, 3>, truth: &[[f32; 3]]) -> f32 {
        if image.width < 3 || image.height < 3 {
            return 0.0;
        }
        let mut total = 0.0;
        let mut count = 0usize;
        for row in 1..image.height - 1 {
            for col in 1..image.width - 1 {
                let index = pixel_index(image.width, row, col);
                let residual = image.data[index][1] - truth[index][1];
                let neighbors = [
                    pixel_index(image.width, row - 1, col),
                    pixel_index(image.width, row + 1, col),
                    pixel_index(image.width, row, col - 1),
                    pixel_index(image.width, row, col + 1),
                ];
                let neighbor_residual = neighbors
                    .iter()
                    .map(|neighbor| image.data[*neighbor][1] - truth[*neighbor][1])
                    .sum::<f32>()
                    * 0.25;
                total += (residual - neighbor_residual).abs();
                count += 1;
            }
        }
        total / count.max(1) as f32
    }

    fn flat_field_chroma_noise(image: &Color2D<f32, 3>) -> f32 {
        let chroma_values: Vec<f32> = image
            .data
            .iter()
            .flat_map(|pixel| [pixel[0] - pixel[1], pixel[2] - pixel[1]])
            .collect();
        let mean = chroma_values.iter().sum::<f32>() / chroma_values.len().max(1) as f32;
        let variance = chroma_values
            .iter()
            .map(|value| (value - mean).powi(2))
            .sum::<f32>()
            / chroma_values.len().max(1) as f32;
        variance.sqrt()
    }

    fn chroma_detail_energy(image: &Color2D<f32, 3>) -> f32 {
        if image.width < 3 || image.height < 3 {
            return 0.0;
        }
        let mut total = 0.0;
        let mut count = 0usize;
        for row in 1..image.height - 1 {
            for col in 1..image.width - 1 {
                let center = image.data[pixel_index(image.width, row, col)];
                let west = image.data[pixel_index(image.width, row, col - 1)];
                let east = image.data[pixel_index(image.width, row, col + 1)];
                let north = image.data[pixel_index(image.width, row - 1, col)];
                let south = image.data[pixel_index(image.width, row + 1, col)];
                let center_rg = center[0] - center[1];
                let center_bg = center[2] - center[1];
                let neighbor_rg = ((west[0] - west[1])
                    + (east[0] - east[1])
                    + (north[0] - north[1])
                    + (south[0] - south[1]))
                    * 0.25;
                let neighbor_bg = ((west[2] - west[1])
                    + (east[2] - east[1])
                    + (north[2] - north[1])
                    + (south[2] - south[1]))
                    * 0.25;
                total += (center_rg - neighbor_rg).abs() + (center_bg - neighbor_bg).abs();
                count += 2;
            }
        }
        total / count.max(1) as f32
    }

    fn period6_artifact_energy(image: &Color2D<f32, 3>, truth: &[[f32; 3]]) -> f32 {
        let mut phase_sum = [0.0; 6];
        let mut phase_count = [0usize; 6];
        for row in 0..image.height {
            for col in 0..image.width {
                let index = pixel_index(image.width, row, col);
                let phase = (row + col) % 6;
                phase_sum[phase] += luma(image.data[index]) - luma(truth[index]);
                phase_count[phase] += 1;
            }
        }
        let phase_mean = phase_sum
            .iter()
            .zip(phase_count.iter())
            .map(|(sum, count)| sum / (*count).max(1) as f32)
            .collect::<Vec<_>>();
        let mean = phase_mean.iter().sum::<f32>() / phase_mean.len() as f32;
        phase_mean
            .iter()
            .map(|value| (value - mean).abs())
            .sum::<f32>()
            / phase_mean.len() as f32
    }

    fn synthetic_metrics(
        width: usize,
        height: usize,
    ) -> (XTransSyntheticMetrics, XTransSyntheticMetrics) {
        let cfa = CFA::new(XTRANS_PATTERN);
        let roi = Rect::new(
            rawler::imgop::Point::new(0, 0),
            rawler::imgop::Dim2::new(width, height),
        );
        let truth = (0..height)
            .flat_map(|row| {
                (0..width).map(move |col| synthetic_color(row, col, width, "slanted_edge"))
            })
            .collect::<Vec<_>>();
        let zone_truth = (0..height)
            .flat_map(|row| {
                (0..width).map(move |col| synthetic_color(row, col, width, "zone_plate"))
            })
            .collect::<Vec<_>>();
        let flat_truth = (0..height)
            .flat_map(|row| {
                (0..width).map(move |col| synthetic_color(row, col, width, "flat_noisy"))
            })
            .collect::<Vec<_>>();
        let fabric_truth = (0..height)
            .flat_map(|row| (0..width).map(move |col| synthetic_color(row, col, width, "fabric")))
            .collect::<Vec<_>>();

        let pixels = mosaic_truth(&cfa, &truth, width, height);
        let zone_pixels = mosaic_truth(&cfa, &zone_truth, width, height);
        let flat_pixels = mosaic_truth(&cfa, &flat_truth, width, height);
        let fabric_pixels = mosaic_truth(&cfa, &fabric_truth, width, height);

        let (hq, hq_report) = demosaic_xtrans_hq(&pixels, &cfa, roi);
        let baseline = nearest_color_baseline(&pixels, &cfa, roi);
        let (zone_hq, _) = demosaic_xtrans_hq(&zone_pixels, &cfa, roi);
        let zone_baseline = nearest_color_baseline(&zone_pixels, &cfa, roi);
        let (flat_hq, _) = demosaic_xtrans_hq(&flat_pixels, &cfa, roi);
        let flat_baseline = nearest_color_baseline(&flat_pixels, &cfa, roi);
        let (fabric_hq, _) = demosaic_xtrans_hq(&fabric_pixels, &cfa, roi);
        let fabric_baseline = nearest_color_baseline(&fabric_pixels, &cfa, roi);

        assert!(hq_report.chroma_limited_pixels > 0);
        assert!(hq_report.period6_chroma_suppressed_pixels > 0);

        let truth_image = Color2D::new_with(truth.clone(), width, height);
        let fabric_truth_image = Color2D::new_with(fabric_truth.clone(), width, height);
        let truth_acutance = edge_acutance(&truth_image).max(0.000_1);
        let fabric_truth_chroma_detail = chroma_detail_energy(&fabric_truth_image).max(0.000_1);
        let flat_truth_noise =
            flat_field_chroma_noise(&Color2D::new_with(flat_truth, width, height)).max(0.000_1);

        let metrics_for = |image: &Color2D<f32, 3>,
                           zone_image: &Color2D<f32, 3>,
                           flat_image: &Color2D<f32, 3>,
                           fabric_image: &Color2D<f32, 3>| {
            XTransSyntheticMetrics {
                rgb_mae_against_synthetic_truth: mean_abs_rgb(image, &truth),
                green_plane_mae: green_mae(image, &truth),
                mtf50_relative: edge_acutance(image) / truth_acutance,
                false_chroma_energy: false_chroma_energy(image, &truth),
                zipper_edge_count: zipper_edge_count(image, &truth),
                maze_score: maze_score(zone_image, &zone_truth)
                    .max(maze_score(fabric_image, &fabric_truth)),
                edge_displacement_px: (edge_center(image) - edge_center(&truth_image)).abs(),
                flat_field_chroma_noise_amplification: flat_field_chroma_noise(flat_image)
                    / flat_truth_noise,
                period6_artifact_energy: period6_artifact_energy(zone_image, &zone_truth),
                color_detail_retention: chroma_detail_energy(fabric_image)
                    .min(fabric_truth_chroma_detail)
                    / fabric_truth_chroma_detail,
            }
        };

        (
            metrics_for(&hq, &zone_hq, &flat_hq, &fabric_hq),
            metrics_for(&baseline, &zone_baseline, &flat_baseline, &fabric_baseline),
        )
    }

    #[test]
    fn xtrans_hq_demosaic_preserves_dimensions_and_known_green_samples() {
        let cfa = CFA::new(XTRANS_PATTERN);
        let pixels = PixF32::new_with(vec![0.2; 144], 12, 12);
        let roi = Rect::new(
            rawler::imgop::Point::new(0, 0),
            rawler::imgop::Dim2::new(12, 12),
        );

        let (demosaiced, report) = demosaic_xtrans_hq(&pixels, &cfa, roi);

        assert_eq!(demosaiced.width, 12);
        assert_eq!(demosaiced.height, 12);
        assert_eq!(demosaiced.data[0][1], 0.2);
        assert!(report.green_directional_pixels > 0);
        assert_eq!(
            report.green_high_confidence_pixels
                + report.green_medium_confidence_pixels
                + report.green_low_confidence_pixels,
            report.green_directional_pixels
        );
        assert!(report.green_second_order_corrected_pixels > 0);
    }

    #[test]
    fn xtrans_hq_reports_synthetic_reconstruction_metrics() {
        let (hq, baseline) = synthetic_metrics(48, 48);

        println!("xtrans synthetic metrics: hq={hq:?}; nearest_baseline={baseline:?}");

        assert!(hq.rgb_mae_against_synthetic_truth.is_finite());
        assert!(hq.green_plane_mae.is_finite());
        assert!(hq.mtf50_relative.is_finite());
        assert!(hq.false_chroma_energy.is_finite());
        assert!(hq.maze_score.is_finite());
        assert!(hq.edge_displacement_px.is_finite());
        assert!(hq.flat_field_chroma_noise_amplification.is_finite());
        assert!(hq.period6_artifact_energy.is_finite());
        assert!(hq.color_detail_retention.is_finite());

        assert!(hq.rgb_mae_against_synthetic_truth <= baseline.rgb_mae_against_synthetic_truth);
        assert!(hq.green_plane_mae <= baseline.green_plane_mae);
        assert!(hq.mtf50_relative >= baseline.mtf50_relative);
        assert!(hq.false_chroma_energy <= baseline.false_chroma_energy * 1.25);
        assert!(hq.zipper_edge_count <= baseline.zipper_edge_count + 2);
        assert!(
            hq.flat_field_chroma_noise_amplification
                <= baseline.flat_field_chroma_noise_amplification * 1.05
        );
        assert!(hq.period6_artifact_energy < 0.06);
        assert!(hq.edge_displacement_px < 3.0);
        assert!(hq.color_detail_retention > 0.65);
        assert!(hq.color_detail_retention <= 1.0);
    }
}
