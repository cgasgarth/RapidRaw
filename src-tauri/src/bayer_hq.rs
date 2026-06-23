use rawler::{
    cfa::{CFA, CFA_COLOR_B, CFA_COLOR_G, CFA_COLOR_R},
    imgop::Rect,
    pixarray::{Color2D, PixF32},
};

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
}
