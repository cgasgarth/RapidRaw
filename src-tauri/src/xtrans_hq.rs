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
    pub chroma_refined_pixels: usize,
    pub evaluated_pixels: usize,
    pub green_directional_pixels: usize,
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

fn directional_pair(
    pixels: &PixF32,
    sensor_row: usize,
    sensor_col: usize,
    delta_row: isize,
    delta_col: isize,
) -> Option<(f32, f32)> {
    let row = sensor_row as isize;
    let col = sensor_col as isize;
    let before_row = row - delta_row;
    let before_col = col - delta_col;
    let after_row = row + delta_row;
    let after_col = col + delta_col;

    if before_row < 0
        || before_col < 0
        || after_row < 0
        || after_col < 0
        || before_row as usize >= pixels.height
        || after_row as usize >= pixels.height
        || before_col as usize >= pixels.width
        || after_col as usize >= pixels.width
    {
        return None;
    }

    let before = *pixels.at(before_row as usize, before_col as usize);
    let after = *pixels.at(after_row as usize, after_col as usize);
    Some(((before + after) * 0.5, (before - after).abs()))
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
        directional_pair(pixels, sensor_row, sensor_col, 0, 1),
        directional_pair(pixels, sensor_row, sensor_col, 1, 0),
        directional_pair(pixels, sensor_row, sensor_col, 1, 1),
        directional_pair(pixels, sensor_row, sensor_col, 1, -1),
    ];
    let candidates: Vec<(f32, f32)> = candidates.into_iter().flatten().collect();

    if candidates.is_empty() {
        report.border_fallback_pixels += 1;
        return sample_same_color(pixels, cfa, sensor_row, sensor_col, CFA_COLOR_G, 3)
            .unwrap_or_else(|| *pixels.at(sensor_row, sensor_col));
    }

    report.green_directional_pixels += 1;
    let min_gradient = candidates
        .iter()
        .map(|(_, gradient)| *gradient)
        .fold(f32::INFINITY, f32::min);
    let mut weighted_sum = 0.0;
    let mut weight_sum = 0.0;

    for (value, gradient) in candidates {
        let weight = 1.0 / (0.000_1 + gradient + min_gradient * 0.25);
        weighted_sum += value * weight;
        weight_sum += weight;
    }

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
    const CHROMA_DELTA_THRESHOLD: f32 = 0.06;
    const CHROMA_BLEND: f32 = 0.42;

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

            image.data[index] = [
                (center[1] + center_rg + (target_rg - center_rg) * CHROMA_BLEND).max(0.0),
                center[1].max(0.0),
                (center[1] + center_bg + (target_bg - center_bg) * CHROMA_BLEND).max(0.0),
            ];
            report.chroma_refined_pixels += 1;
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

    #[test]
    fn xtrans_hq_demosaic_preserves_dimensions_and_known_green_samples() {
        let cfa = CFA::new("GGRGGBGGBGGRBRGRGGGGRGGBGGBGGRBRGRGG");
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
    }
}
