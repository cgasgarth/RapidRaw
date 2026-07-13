use super::{
    CALIBRATION_CONTRACT, CaptureQualityReceipt, ChartDefinition, ChartGeometry, ChartSample,
    NormalizedPoint,
};
use crate::raw::raw_processing::CameraLinearCalibrationFrame;
use anyhow::{Result, ensure};

const SAMPLE_GRID: usize = 9;

pub(crate) fn sample_chart(
    frame: &CameraLinearCalibrationFrame,
    chart: &ChartDefinition,
    geometry: &ChartGeometry,
    source_revision: String,
) -> Result<super::ChartSamplingReceipt> {
    validate_geometry(geometry)?;
    ensure!(
        frame.width >= 64 && frame.height >= 64,
        "chart_calibration_source_too_small"
    );
    let chart_area_fraction = polygon_area(&geometry.corners);
    ensure!(
        chart_area_fraction >= 0.01,
        "chart_calibration_chart_area_too_small"
    );
    let minimum_patch_area_pixels = chart_area_fraction * f64::from(frame.width * frame.height)
        / (chart.rows * chart.columns) as f64;
    ensure!(
        minimum_patch_area_pixels >= 64.0,
        "chart_calibration_patch_area_too_small"
    );

    let mut samples = Vec::with_capacity(chart.patches.len());
    for row in 0..chart.rows {
        for column in 0..chart.columns {
            let logical_column = if geometry.mirrored {
                chart.columns - 1 - column
            } else {
                column
            };
            let reference = &chart.patches[row * chart.columns + logical_column];
            samples.push(sample_patch(
                frame, chart, geometry, row, column, reference,
            )?);
        }
    }
    let maximum_clipped_fraction = samples
        .iter()
        .map(|sample| sample.clipped_fraction)
        .fold(0.0, f64::max);
    let maximum_spatial_gradient = samples
        .iter()
        .map(|sample| sample.spatial_gradient)
        .fold(0.0, f64::max);
    let minimum_patch_sharpness = samples
        .iter()
        .map(|sample| sample.sharpness)
        .fold(f64::INFINITY, f64::min);
    let minimum_valid_fraction = samples
        .iter()
        .map(|sample| sample.valid_fraction)
        .fold(1.0, f64::min);
    let mut warning_codes = Vec::new();
    if maximum_clipped_fraction > 0.02 {
        warning_codes.push("chart_capture_clipped".to_string());
    }
    if maximum_spatial_gradient > 0.18 {
        warning_codes.push("chart_capture_uneven_patch".to_string());
    }
    if minimum_patch_sharpness < 0.002 {
        warning_codes.push("chart_capture_focus_low".to_string());
    }
    if minimum_valid_fraction < 0.8 {
        warning_codes.push("chart_capture_valid_fraction_low".to_string());
    }
    let accepted = maximum_clipped_fraction <= 0.1
        && maximum_spatial_gradient <= 0.35
        && minimum_valid_fraction >= 0.5;
    Ok(super::ChartSamplingReceipt {
        contract: CALIBRATION_CONTRACT.to_string(),
        chart_id: chart.id.to_string(),
        chart_version: chart.version,
        source_revision,
        camera_identity: frame.camera_identity.clone(),
        input_domain: "raw_camera_linear_after_sensor_correction_before_wb_profile_view_output"
            .to_string(),
        geometry: geometry.clone(),
        samples,
        capture_quality: CaptureQualityReceipt {
            chart_area_fraction,
            minimum_patch_area_pixels,
            maximum_clipped_fraction,
            maximum_spatial_gradient,
            minimum_patch_sharpness,
            warning_codes,
            accepted,
        },
    })
}

fn sample_patch(
    frame: &CameraLinearCalibrationFrame,
    chart: &ChartDefinition,
    geometry: &ChartGeometry,
    row: usize,
    column: usize,
    reference: &super::catalog::ReferencePatch,
) -> Result<ChartSample> {
    let mut values = Vec::with_capacity(SAMPLE_GRID * SAMPLE_GRID);
    let mut clipped = 0usize;
    let mut rejected = 0usize;
    for sample_y in 0..SAMPLE_GRID {
        for sample_x in 0..SAMPLE_GRID {
            let local_x = (sample_x as f64 + 0.5) / SAMPLE_GRID as f64;
            let local_y = (sample_y as f64 + 0.5) / SAMPLE_GRID as f64;
            let u = (column as f64 + 0.18 + 0.64 * local_x) / chart.columns as f64;
            let v = (row as f64 + 0.18 + 0.64 * local_y) / chart.rows as f64;
            let pixel = sample_frame(frame, quad_point(&geometry.corners, u, v));
            let is_clipped = pixel.iter().any(|channel| *channel >= 0.985);
            let is_near_black = pixel.iter().sum::<f64>() <= 0.000_3;
            if is_clipped {
                clipped += 1;
            }
            if is_clipped || is_near_black || pixel.iter().any(|value| !value.is_finite()) {
                rejected += 1;
            } else {
                values.push(pixel);
            }
        }
    }
    ensure!(
        values.len() >= 16,
        "chart_calibration_patch_has_too_few_valid_pixels"
    );
    let mean = channel_mean(&values);
    let median = channel_median(&values);
    let covariance = covariance(&values, mean);
    let total = SAMPLE_GRID * SAMPLE_GRID;
    Ok(ChartSample {
        patch_id: reference.id.to_string(),
        role: reference.role,
        camera_rgb_mean: mean,
        camera_rgb_median: median,
        covariance,
        clipped_fraction: clipped as f64 / total as f64,
        valid_fraction: (total - rejected) as f64 / total as f64,
        spatial_gradient: spatial_gradient(&values, mean),
        sharpness: patch_edge_sharpness(frame, chart, geometry, row, column),
        sample_count: values.len(),
    })
}

fn validate_geometry(geometry: &ChartGeometry) -> Result<()> {
    ensure!(
        geometry
            .corners
            .iter()
            .all(|point| point.x.is_finite() && point.y.is_finite()),
        "chart_calibration_geometry_non_finite"
    );
    ensure!(
        geometry
            .corners
            .iter()
            .all(|point| (0.0..=1.0).contains(&point.x) && (0.0..=1.0).contains(&point.y)),
        "chart_calibration_geometry_out_of_bounds"
    );
    let mut signs = Vec::with_capacity(4);
    for index in 0..4 {
        let a = geometry.corners[index];
        let b = geometry.corners[(index + 1) % 4];
        let c = geometry.corners[(index + 2) % 4];
        signs.push((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
    }
    let clockwise = signs.iter().all(|value| *value < -1e-8);
    let counter_clockwise = signs.iter().all(|value| *value > 1e-8);
    ensure!(
        clockwise || counter_clockwise,
        "chart_calibration_geometry_not_convex"
    );
    Ok(())
}

fn polygon_area(corners: &[NormalizedPoint; 4]) -> f64 {
    let mut area = 0.0;
    for index in 0..4 {
        let a = corners[index];
        let b = corners[(index + 1) % 4];
        area += a.x * b.y - b.x * a.y;
    }
    area.abs() * 0.5
}

fn quad_point(corners: &[NormalizedPoint; 4], u: f64, v: f64) -> NormalizedPoint {
    let top = lerp(corners[0], corners[1], u);
    let bottom = lerp(corners[3], corners[2], u);
    lerp(top, bottom, v)
}

fn lerp(a: NormalizedPoint, b: NormalizedPoint, weight: f64) -> NormalizedPoint {
    NormalizedPoint {
        x: a.x + (b.x - a.x) * weight,
        y: a.y + (b.y - a.y) * weight,
    }
}

fn sample_frame(frame: &CameraLinearCalibrationFrame, point: NormalizedPoint) -> [f64; 3] {
    let x = (point.x.clamp(0.0, 1.0) * f64::from(frame.width.saturating_sub(1))).round() as u32;
    let y = (point.y.clamp(0.0, 1.0) * f64::from(frame.height.saturating_sub(1))).round() as u32;
    frame.pixels[(y * frame.width + x) as usize].map(f64::from)
}

fn channel_mean(values: &[[f64; 3]]) -> [f64; 3] {
    let mut mean = [0.0; 3];
    for value in values {
        for channel in 0..3 {
            mean[channel] += value[channel];
        }
    }
    mean.map(|value| value / values.len() as f64)
}

fn channel_median(values: &[[f64; 3]]) -> [f64; 3] {
    std::array::from_fn(|channel| {
        let mut channel_values: Vec<_> = values.iter().map(|value| value[channel]).collect();
        channel_values.sort_by(f64::total_cmp);
        channel_values[channel_values.len() / 2]
    })
}

fn covariance(values: &[[f64; 3]], mean: [f64; 3]) -> [[f64; 3]; 3] {
    let mut covariance = [[0.0; 3]; 3];
    for value in values {
        for row in 0..3 {
            for column in 0..3 {
                covariance[row][column] +=
                    (value[row] - mean[row]) * (value[column] - mean[column]);
            }
        }
    }
    let denominator = (values.len().saturating_sub(1)).max(1) as f64;
    covariance.map(|row| row.map(|value| value / denominator))
}

fn spatial_gradient(values: &[[f64; 3]], mean: [f64; 3]) -> f64 {
    let mean_luma = luma(mean).max(1e-6);
    values
        .iter()
        .map(|value| (luma(*value) - mean_luma).abs() / mean_luma)
        .sum::<f64>()
        / values.len() as f64
}

fn patch_edge_sharpness(
    frame: &CameraLinearCalibrationFrame,
    chart: &ChartDefinition,
    geometry: &ChartGeometry,
    row: usize,
    column: usize,
) -> f64 {
    let center_u = (column as f64 + 0.5) / chart.columns as f64;
    let center_v = (row as f64 + 0.5) / chart.rows as f64;
    let du = 0.04 / chart.columns as f64;
    let dv = 0.04 / chart.rows as f64;
    let mut contrasts = Vec::new();
    if column > 0 {
        let edge = column as f64 / chart.columns as f64;
        contrasts.push(edge_contrast(
            frame,
            geometry,
            edge - du,
            edge + du,
            center_v,
            true,
        ));
    }
    if column + 1 < chart.columns {
        let edge = (column + 1) as f64 / chart.columns as f64;
        contrasts.push(edge_contrast(
            frame,
            geometry,
            edge - du,
            edge + du,
            center_v,
            true,
        ));
    }
    if row > 0 {
        let edge = row as f64 / chart.rows as f64;
        contrasts.push(edge_contrast(
            frame,
            geometry,
            edge - dv,
            edge + dv,
            center_u,
            false,
        ));
    }
    if row + 1 < chart.rows {
        let edge = (row + 1) as f64 / chart.rows as f64;
        contrasts.push(edge_contrast(
            frame,
            geometry,
            edge - dv,
            edge + dv,
            center_u,
            false,
        ));
    }
    if contrasts.is_empty() {
        return 0.0;
    }
    contrasts.iter().sum::<f64>() / contrasts.len() as f64
}

fn edge_contrast(
    frame: &CameraLinearCalibrationFrame,
    geometry: &ChartGeometry,
    before: f64,
    after: f64,
    fixed: f64,
    vertical_edge: bool,
) -> f64 {
    let first = if vertical_edge {
        sample_frame(frame, quad_point(&geometry.corners, before, fixed))
    } else {
        sample_frame(frame, quad_point(&geometry.corners, fixed, before))
    };
    let second = if vertical_edge {
        sample_frame(frame, quad_point(&geometry.corners, after, fixed))
    } else {
        sample_frame(frame, quad_point(&geometry.corners, fixed, after))
    };
    (luma(first) - luma(second)).abs()
}

fn luma(value: [f64; 3]) -> f64 {
    0.2126 * value[0] + 0.7152 * value[1] + 0.0722 * value[2]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::calibration::chart_definition;

    #[test]
    fn manual_geometry_samples_declared_camera_linear_domain() {
        let chart = chart_definition("colorchecker_classic_24_cc0_srgb_d65_v1").unwrap();
        let width = 600;
        let height = 400;
        let mut pixels = vec![[0.1f32; 3]; width * height];
        for row in 0..chart.rows {
            for column in 0..chart.columns {
                let value = 0.08 + (row * chart.columns + column) as f32 * 0.02;
                for y in row * 100..(row + 1) * 100 {
                    for x in column * 100..(column + 1) * 100 {
                        pixels[y * width + x] = [value, value * 0.9, value * 0.8];
                    }
                }
            }
        }
        let receipt = sample_chart(
            &CameraLinearCalibrationFrame {
                camera_identity: "Synthetic Camera".into(),
                width: width as u32,
                height: height as u32,
                pixels,
            },
            &chart,
            &ChartGeometry {
                corners: [
                    NormalizedPoint { x: 0.0, y: 0.0 },
                    NormalizedPoint { x: 1.0, y: 0.0 },
                    NormalizedPoint { x: 1.0, y: 1.0 },
                    NormalizedPoint { x: 0.0, y: 1.0 },
                ],
                mirrored: false,
            },
            "source-revision-v1:test".into(),
        )
        .unwrap();
        assert_eq!(receipt.samples.len(), 24);
        assert_eq!(
            receipt.input_domain,
            "raw_camera_linear_after_sensor_correction_before_wb_profile_view_output"
        );
        assert!(
            receipt
                .samples
                .iter()
                .all(|sample| sample.sample_count == 81)
        );
        assert!(receipt.capture_quality.accepted);
    }

    #[test]
    fn rejects_tiny_self_intersecting_and_clipped_chart_captures() {
        let chart = chart_definition("colorchecker_classic_24_cc0_srgb_d65_v1").unwrap();
        let frame = CameraLinearCalibrationFrame {
            camera_identity: "Synthetic".into(),
            width: 128,
            height: 128,
            pixels: vec![[1.0; 3]; 128 * 128],
        };
        let crossed = ChartGeometry {
            corners: [
                NormalizedPoint { x: 0.1, y: 0.1 },
                NormalizedPoint { x: 0.9, y: 0.9 },
                NormalizedPoint { x: 0.9, y: 0.1 },
                NormalizedPoint { x: 0.1, y: 0.9 },
            ],
            mirrored: false,
        };
        assert!(sample_chart(&frame, &chart, &crossed, "revision".into()).is_err());
    }
}
