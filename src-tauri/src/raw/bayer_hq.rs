use rawler::{
    cfa::{CFA, CFA_COLOR_B, CFA_COLOR_G, CFA_COLOR_R},
    imgop::Rect,
    pixarray::{Color2D, PixF32},
};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactSuppressionReport {
    pub adjusted_pixels: usize,
    pub evaluated_pixels: usize,
}

fn luma(pixel: [f32; 3]) -> f32 {
    pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722
}

fn chroma(pixel: [f32; 3]) -> (f32, f32) {
    (pixel[0] - pixel[1], pixel[2] - pixel[1])
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

fn sample_color(
    pixels: &PixF32,
    cfa: &CFA,
    sensor_row: usize,
    sensor_col: usize,
    color: usize,
) -> f32 {
    if cfa.color_at(sensor_row, sensor_col) == color {
        return *pixels.at(sensor_row, sensor_col);
    }

    sample_same_color(pixels, cfa, sensor_row, sensor_col, color, 2)
        .or_else(|| sample_same_color(pixels, cfa, sensor_row, sensor_col, color, 3))
        .unwrap_or_else(|| *pixels.at(sensor_row, sensor_col))
}

fn adaptive_green(pixels: &PixF32, cfa: &CFA, sensor_row: usize, sensor_col: usize) -> f32 {
    if cfa.color_at(sensor_row, sensor_col) == CFA_COLOR_G {
        return *pixels.at(sensor_row, sensor_col);
    }

    let center = *pixels.at(sensor_row, sensor_col);
    let horizontal = if sensor_col >= 1 && sensor_col + 1 < pixels.width {
        let west = *pixels.at(sensor_row, sensor_col - 1);
        let east = *pixels.at(sensor_row, sensor_col + 1);
        let gradient = if sensor_col >= 2 && sensor_col + 2 < pixels.width {
            (*pixels.at(sensor_row, sensor_col - 2) - center).abs()
                + (*pixels.at(sensor_row, sensor_col + 2) - center).abs()
        } else {
            (west - east).abs()
        };
        Some(((west + east) * 0.5, gradient))
    } else {
        None
    };

    let vertical = if sensor_row >= 1 && sensor_row + 1 < pixels.height {
        let north = *pixels.at(sensor_row - 1, sensor_col);
        let south = *pixels.at(sensor_row + 1, sensor_col);
        let gradient = if sensor_row >= 2 && sensor_row + 2 < pixels.height {
            (*pixels.at(sensor_row - 2, sensor_col) - center).abs()
                + (*pixels.at(sensor_row + 2, sensor_col) - center).abs()
        } else {
            (north - south).abs()
        };
        Some(((north + south) * 0.5, gradient))
    } else {
        None
    };

    match (horizontal, vertical) {
        (Some((h_value, h_gradient)), Some((v_value, v_gradient))) => {
            if h_gradient < v_gradient * 0.75 {
                h_value
            } else if v_gradient < h_gradient * 0.75 {
                v_value
            } else {
                (h_value + v_value) * 0.5
            }
        }
        (Some((value, _)), None) | (None, Some((value, _))) => value,
        (None, None) => sample_color(pixels, cfa, sensor_row, sensor_col, CFA_COLOR_G),
    }
}

pub fn demosaic_bayer_hq(pixels: &PixF32, cfa: &CFA, roi: Rect) -> Color2D<f32, 3> {
    let shifted_cfa = cfa.shift(roi.p.x, roi.p.y);
    let mut output = Vec::with_capacity(roi.d.w * roi.d.h);

    for row_out in 0..roi.d.h {
        let sensor_row = roi.p.y + row_out;
        for col_out in 0..roi.d.w {
            let sensor_col = roi.p.x + col_out;
            let cfa_color = shifted_cfa.color_at(row_out, col_out);
            let current = *pixels.at(sensor_row, sensor_col);
            let green = adaptive_green(pixels, cfa, sensor_row, sensor_col);
            let red = if cfa_color == CFA_COLOR_R {
                current
            } else {
                sample_color(pixels, cfa, sensor_row, sensor_col, CFA_COLOR_R)
            };
            let blue = if cfa_color == CFA_COLOR_B {
                current
            } else {
                sample_color(pixels, cfa, sensor_row, sensor_col, CFA_COLOR_B)
            };

            output.push([red.max(0.0), green.max(0.0), blue.max(0.0)]);
        }
    }

    Color2D::new_with(output, roi.d.w, roi.d.h)
}

pub fn suppress_false_color_and_zipper(image: &mut Color2D<f32, 3>) -> ArtifactSuppressionReport {
    const CHROMA_DELTA_THRESHOLD: f32 = 0.055;
    const CHROMA_BLEND: f32 = 0.58;

    if image.width < 3 || image.height < 3 {
        return ArtifactSuppressionReport::default();
    }

    let original = image.data.clone();
    let mut report = ArtifactSuppressionReport::default();

    for row in 1..image.height - 1 {
        for col in 1..image.width - 1 {
            let center_index = pixel_index(image.width, row, col);
            let center = original[center_index];
            let west = original[pixel_index(image.width, row, col - 1)];
            let east = original[pixel_index(image.width, row, col + 1)];
            let north = original[pixel_index(image.width, row - 1, col)];
            let south = original[pixel_index(image.width, row + 1, col)];
            let horizontal_gradient = (luma(west) - luma(east)).abs();
            let vertical_gradient = (luma(north) - luma(south)).abs();
            let (center_rg, center_bg) = chroma(center);
            let (first, second, gradient) = if horizontal_gradient <= vertical_gradient {
                (west, east, horizontal_gradient)
            } else {
                (north, south, vertical_gradient)
            };
            let (first_rg, first_bg) = chroma(first);
            let (second_rg, second_bg) = chroma(second);
            let target_rg = (first_rg + second_rg) * 0.5;
            let target_bg = (first_bg + second_bg) * 0.5;
            let delta = (center_rg - target_rg)
                .abs()
                .max((center_bg - target_bg).abs());
            let threshold = CHROMA_DELTA_THRESHOLD + gradient * 0.35;

            report.evaluated_pixels += 1;
            if delta <= threshold {
                continue;
            }

            let next_rg = center_rg + (target_rg - center_rg) * CHROMA_BLEND;
            let next_bg = center_bg + (target_bg - center_bg) * CHROMA_BLEND;
            image.data[center_index] = [
                (center[1] + next_rg).max(0.0),
                center[1].max(0.0),
                (center[1] + next_bg).max(0.0),
            ];
            report.adjusted_pixels += 1;
        }
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bayer_hq_demosaic_preserves_dimensions_and_known_samples() {
        let cfa = CFA::new("RGGB");
        let pixels = PixF32::new_with(vec![0.2; 64], 8, 8);
        let roi = Rect::new(
            rawler::imgop::Point::new(0, 0),
            rawler::imgop::Dim2::new(8, 8),
        );

        let demosaiced = demosaic_bayer_hq(&pixels, &cfa, roi);

        assert_eq!(demosaiced.width, 8);
        assert_eq!(demosaiced.height, 8);
        assert_eq!(demosaiced.data[0][0], 0.2);
    }

    #[test]
    fn false_color_suppression_reduces_flat_luma_chroma_outliers() {
        let mut image = Color2D::new_with(vec![[0.4, 0.4, 0.4]; 25], 5, 5);
        image.data[pixel_index(5, 2, 2)] = [0.9, 0.4, 0.0];

        let before = chroma(image.data[pixel_index(5, 2, 2)]).0.abs();
        let report = suppress_false_color_and_zipper(&mut image);
        let after = chroma(image.data[pixel_index(5, 2, 2)]).0.abs();

        assert_eq!(report.evaluated_pixels, 9);
        assert_eq!(report.adjusted_pixels, 1);
        assert!(after < before * 0.5);
    }
}
