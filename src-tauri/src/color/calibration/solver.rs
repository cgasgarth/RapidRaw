use super::{
    CALIBRATION_CONTRACT, CALIBRATION_SOLVER_VERSION, CalibrationFitReceipt,
    CalibrationQualityStatus, ChartSamplingReceipt, ColorErrorMetrics, IlluminantCoordinates,
    PatchRole,
};
use crate::color::calibration::ChartDefinition;
use anyhow::{Result, anyhow, ensure};
use nalgebra::{DMatrix, Matrix3, Vector3};

const REGULARIZATION: f64 = 1e-7;
const UNAVAILABLE_FINITE_METRIC: f64 = 1.0e12;

pub(crate) fn fit_calibration(
    sampling: &ChartSamplingReceipt,
    chart: &ChartDefinition,
    illuminant: IlluminantCoordinates,
) -> Result<CalibrationFitReceipt> {
    ensure!(
        sampling.contract == CALIBRATION_CONTRACT,
        "chart_calibration_contract_mismatch"
    );
    ensure!(
        sampling.chart_id == chart.id,
        "chart_calibration_chart_mismatch"
    );
    ensure!(
        sampling.samples.len() == chart.patches.len(),
        "chart_calibration_patch_count_mismatch"
    );
    ensure!(
        valid_illuminant(illuminant),
        "chart_calibration_illuminant_invalid"
    );

    let target_white = xy_to_xyz([illuminant.x, illuminant.y]);
    let d65_white = xy_to_xyz([0.3127, 0.3290]);
    let adaptation = bradford_adaptation(d65_white, target_white)?;
    let targets: Vec<[f64; 3]> = chart
        .patches
        .iter()
        .map(|patch| matrix_vector(adaptation, patch.xyz_d65))
        .collect();
    let validation_indexes: Vec<usize> = (0..sampling.samples.len())
        .filter(|index| index % 4 == 1)
        .collect();
    let train_indexes: Vec<usize> = (0..sampling.samples.len())
        .filter(|index| !validation_indexes.contains(index))
        .collect();
    ensure!(
        train_indexes.len() >= 12,
        "chart_calibration_underdetermined"
    );

    if !sampling.capture_quality.accepted {
        return Ok(failed_capture_receipt(
            sampling,
            chart,
            illuminant,
            train_indexes,
            validation_indexes,
        ));
    }

    let mut robust_weights = vec![1.0; train_indexes.len()];
    let mut matrix = Matrix3::identity();
    for _ in 0..5 {
        matrix = solve_weighted_matrix(sampling, &targets, &train_indexes, &robust_weights)?;
        let residuals: Vec<f64> = train_indexes
            .iter()
            .map(|index| {
                let predicted = matrix_vector(
                    matrix_to_array(matrix),
                    sampling.samples[*index].camera_rgb_median,
                );
                euclidean(predicted, targets[*index])
            })
            .collect();
        let scale = median(&residuals).max(1e-7) * 1.4826;
        for (weight, residual) in robust_weights.iter_mut().zip(residuals) {
            let normalized = residual / (1.5 * scale);
            *weight = if normalized <= 1.0 {
                1.0
            } else {
                1.0 / normalized
            };
        }
    }

    let svd = matrix.svd(false, false);
    let minimum = svd.singular_values.min();
    let maximum = svd.singular_values.max();
    let condition_number = maximum / minimum.max(1e-12);
    ensure!(
        condition_number.is_finite() && condition_number <= 1e5,
        "chart_calibration_matrix_ill_conditioned"
    );
    ensure!(
        matrix.determinant() > 1e-10,
        "chart_calibration_matrix_orientation_invalid"
    );

    let train_metrics = metrics_for_indexes(
        matrix,
        sampling,
        chart,
        &targets,
        &train_indexes,
        target_white,
    );
    let validation_metrics = metrics_for_indexes(
        matrix,
        sampling,
        chart,
        &targets,
        &validation_indexes,
        target_white,
    );
    let validation_gap = validation_metrics.mean_delta_e00 - train_metrics.mean_delta_e00;
    let quality_status =
        if validation_metrics.mean_delta_e00 <= 1.5 && validation_metrics.p95_delta_e00 <= 3.0 {
            CalibrationQualityStatus::Excellent
        } else if validation_metrics.mean_delta_e00 <= 3.0
            && validation_metrics.p95_delta_e00 <= 6.0
            && validation_gap <= 2.0
        {
            CalibrationQualityStatus::Acceptable
        } else if validation_metrics.mean_delta_e00 <= 5.0
            && validation_metrics.p95_delta_e00 <= 10.0
            && validation_gap <= 4.0
        {
            CalibrationQualityStatus::WarningPublishable
        } else {
            CalibrationQualityStatus::FailedValidationOverfit
        };
    let rejected_patch_ids = train_indexes
        .iter()
        .zip(robust_weights.iter())
        .filter(|(_, weight)| **weight < 0.4)
        .map(|(index, _)| sampling.samples[*index].patch_id.clone())
        .collect::<Vec<_>>();
    let mut warning_codes = sampling.capture_quality.warning_codes.clone();
    if !rejected_patch_ids.is_empty() {
        warning_codes.push("chart_calibration_robust_outliers_rejected".into());
    }
    warning_codes
        .push("chart_calibration_residual_model_not_accepted_without_held_out_improvement".into());
    let camera_to_xyz = matrix_to_array(matrix);
    let solver_fingerprint = solver_fingerprint(
        sampling,
        chart,
        illuminant,
        camera_to_xyz,
        &train_indexes,
        &validation_indexes,
    );
    Ok(CalibrationFitReceipt {
        contract: CALIBRATION_CONTRACT.to_string(),
        implementation_version: CALIBRATION_SOLVER_VERSION,
        camera_identity: sampling.camera_identity.clone(),
        source_revision: sampling.source_revision.clone(),
        raw_processing_profile:
            "balanced:demosaic_standard:sensor_defect_v1:no_wb:no_profile:no_view".into(),
        chart_id: chart.id.to_string(),
        chart_version: chart.version,
        chart_reference_illuminant: chart.reference_illuminant.into(),
        chart_observer: chart.observer.into(),
        chart_provenance: chart.provenance.into(),
        chart_license: chart.license_id.into(),
        chart_source_url: chart.source_url.into(),
        illuminant,
        adaptation: "Bradford D65 to measured chart white".into(),
        train_patch_ids: train_indexes
            .iter()
            .map(|index| sampling.samples[*index].patch_id.clone())
            .collect(),
        validation_patch_ids: validation_indexes
            .iter()
            .map(|index| sampling.samples[*index].patch_id.clone())
            .collect(),
        camera_to_xyz,
        condition_number,
        rejected_patch_ids,
        train_metrics,
        validation_metrics,
        residual_model_accepted: false,
        quality_status,
        warning_codes,
        solver_fingerprint,
    })
}

fn solve_weighted_matrix(
    sampling: &ChartSamplingReceipt,
    targets: &[[f64; 3]],
    indexes: &[usize],
    robust_weights: &[f64],
) -> Result<Matrix3<f64>> {
    let mut x = DMatrix::<f64>::zeros(indexes.len(), 3);
    let mut y = DMatrix::<f64>::zeros(indexes.len(), 3);
    for (row, (index, robust_weight)) in indexes.iter().zip(robust_weights).enumerate() {
        let sample = &sampling.samples[*index];
        let role_weight: f64 = match sample.role {
            PatchRole::Neutral => 3.0,
            PatchRole::Skin => 2.0,
            PatchRole::Chromatic => 1.0,
        };
        let capture_weight = (sample.valid_fraction * (1.0 - sample.clipped_fraction)).max(0.05);
        let weight = (role_weight * capture_weight * robust_weight).sqrt();
        for channel in 0..3 {
            x[(row, channel)] = sample.camera_rgb_median[channel] * weight;
            y[(row, channel)] = targets[*index][channel] * weight;
        }
    }
    let xtx = x.transpose() * &x + DMatrix::<f64>::identity(3, 3) * REGULARIZATION;
    let xty = x.transpose() * y;
    let solution = xtx
        .lu()
        .solve(&xty)
        .ok_or_else(|| anyhow!("chart_calibration_solver_singular"))?;
    Ok(Matrix3::new(
        solution[(0, 0)],
        solution[(1, 0)],
        solution[(2, 0)],
        solution[(0, 1)],
        solution[(1, 1)],
        solution[(2, 1)],
        solution[(0, 2)],
        solution[(1, 2)],
        solution[(2, 2)],
    ))
}

fn metrics_for_indexes(
    matrix: Matrix3<f64>,
    sampling: &ChartSamplingReceipt,
    chart: &ChartDefinition,
    targets: &[[f64; 3]],
    indexes: &[usize],
    white: [f64; 3],
) -> ColorErrorMetrics {
    let mut all = Vec::with_capacity(indexes.len());
    let mut neutral = Vec::new();
    let mut skin = Vec::new();
    for index in indexes {
        let predicted = matrix_vector(
            matrix_to_array(matrix),
            sampling.samples[*index].camera_rgb_median,
        );
        let error = delta_e00(
            xyz_to_lab(predicted, white),
            xyz_to_lab(targets[*index], white),
        );
        all.push(error);
        match chart.patches[*index].role {
            PatchRole::Neutral => neutral.push(error),
            PatchRole::Skin => skin.push(error),
            PatchRole::Chromatic => {}
        }
    }
    all.sort_by(f64::total_cmp);
    ColorErrorMetrics {
        mean_delta_e00: mean(&all),
        median_delta_e00: percentile(&all, 0.5),
        p95_delta_e00: percentile(&all, 0.95),
        max_delta_e00: all.last().copied().unwrap_or(f64::INFINITY),
        neutral_axis_error: if neutral.is_empty() {
            0.0
        } else {
            mean(&neutral)
        },
        skin_mean_delta_e00: (!skin.is_empty()).then(|| mean(&skin)),
    }
}

fn failed_capture_receipt(
    sampling: &ChartSamplingReceipt,
    chart: &ChartDefinition,
    illuminant: IlluminantCoordinates,
    train_indexes: Vec<usize>,
    validation_indexes: Vec<usize>,
) -> CalibrationFitReceipt {
    let unavailable = ColorErrorMetrics {
        mean_delta_e00: UNAVAILABLE_FINITE_METRIC,
        median_delta_e00: UNAVAILABLE_FINITE_METRIC,
        p95_delta_e00: UNAVAILABLE_FINITE_METRIC,
        max_delta_e00: UNAVAILABLE_FINITE_METRIC,
        neutral_axis_error: UNAVAILABLE_FINITE_METRIC,
        skin_mean_delta_e00: None,
    };
    CalibrationFitReceipt {
        contract: CALIBRATION_CONTRACT.into(),
        implementation_version: CALIBRATION_SOLVER_VERSION,
        camera_identity: sampling.camera_identity.clone(),
        source_revision: sampling.source_revision.clone(),
        raw_processing_profile:
            "balanced:demosaic_standard:sensor_defect_v1:no_wb:no_profile:no_view".into(),
        chart_id: chart.id.into(),
        chart_version: chart.version,
        chart_reference_illuminant: chart.reference_illuminant.into(),
        chart_observer: chart.observer.into(),
        chart_provenance: chart.provenance.into(),
        chart_license: chart.license_id.into(),
        chart_source_url: chart.source_url.into(),
        illuminant,
        adaptation: "not_run_capture_quality_failed".into(),
        train_patch_ids: train_indexes
            .iter()
            .map(|index| sampling.samples[*index].patch_id.clone())
            .collect(),
        validation_patch_ids: validation_indexes
            .iter()
            .map(|index| sampling.samples[*index].patch_id.clone())
            .collect(),
        camera_to_xyz: [[0.0; 3]; 3],
        condition_number: UNAVAILABLE_FINITE_METRIC,
        rejected_patch_ids: Vec::new(),
        train_metrics: unavailable.clone(),
        validation_metrics: unavailable,
        residual_model_accepted: false,
        quality_status: CalibrationQualityStatus::FailedCaptureQuality,
        warning_codes: sampling.capture_quality.warning_codes.clone(),
        solver_fingerprint: "not_fit".into(),
    }
}

fn valid_illuminant(value: IlluminantCoordinates) -> bool {
    value.x.is_finite()
        && value.y.is_finite()
        && value.x > 0.0
        && value.y > 0.0
        && value.x + value.y < 1.0
}

fn xy_to_xyz(xy: [f64; 2]) -> [f64; 3] {
    [xy[0] / xy[1], 1.0, (1.0 - xy[0] - xy[1]) / xy[1]]
}

fn bradford_adaptation(source: [f64; 3], destination: [f64; 3]) -> Result<[[f64; 3]; 3]> {
    let cone = Matrix3::new(
        0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296,
    );
    let inverse = cone
        .try_inverse()
        .ok_or_else(|| anyhow!("chart_calibration_adaptation_singular"))?;
    let source_cone = cone * Vector3::from_column_slice(&source);
    let destination_cone = cone * Vector3::from_column_slice(&destination);
    ensure!(
        source_cone.iter().all(|value| value.abs() > 1e-12),
        "chart_calibration_adaptation_invalid_white"
    );
    let scale = Matrix3::from_diagonal(&destination_cone.component_div(&source_cone));
    Ok(matrix_to_array(inverse * scale * cone))
}

fn matrix_vector(matrix: [[f64; 3]; 3], vector: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|row| {
        matrix[row][0] * vector[0] + matrix[row][1] * vector[1] + matrix[row][2] * vector[2]
    })
}

fn matrix_to_array(matrix: Matrix3<f64>) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| std::array::from_fn(|column| matrix[(row, column)]))
}

fn xyz_to_lab(xyz: [f64; 3], white: [f64; 3]) -> [f64; 3] {
    let f = |value: f64| {
        if value > 216.0 / 24_389.0 {
            value.cbrt()
        } else {
            (24_389.0 / 27.0 * value + 16.0) / 116.0
        }
    };
    let fx = f(xyz[0] / white[0]);
    let fy = f(xyz[1] / white[1]);
    let fz = f(xyz[2] / white[2]);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

// CIEDE2000, Sharma et al. 2005.
fn delta_e00(left: [f64; 3], right: [f64; 3]) -> f64 {
    let [l1, a1, b1] = left;
    let [l2, a2, b2] = right;
    let c1 = a1.hypot(b1);
    let c2 = a2.hypot(b2);
    let mean_c = (c1 + c2) * 0.5;
    let g = 0.5 * (1.0 - (mean_c.powi(7) / (mean_c.powi(7) + 25f64.powi(7))).sqrt());
    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = a1p.hypot(b1);
    let c2p = a2p.hypot(b2);
    let hp = |a: f64, b: f64| {
        let angle = b.atan2(a).to_degrees();
        if angle < 0.0 { angle + 360.0 } else { angle }
    };
    let h1p = hp(a1p, b1);
    let h2p = hp(a2p, b2);
    let delta_l = l2 - l1;
    let delta_c = c2p - c1p;
    let hue_difference = h2p - h1p;
    let delta_h_degrees = if c1p * c2p == 0.0 {
        0.0
    } else if hue_difference.abs() <= 180.0 {
        hue_difference
    } else if hue_difference > 180.0 {
        hue_difference - 360.0
    } else {
        hue_difference + 360.0
    };
    let delta_h = 2.0 * (c1p * c2p).sqrt() * (delta_h_degrees.to_radians() * 0.5).sin();
    let mean_l = (l1 + l2) * 0.5;
    let mean_cp = (c1p + c2p) * 0.5;
    let mean_h = if c1p * c2p == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) * 0.5
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) * 0.5
    } else {
        (h1p + h2p - 360.0) * 0.5
    };
    let t = 1.0 - 0.17 * (mean_h - 30.0).to_radians().cos()
        + 0.24 * (2.0 * mean_h).to_radians().cos()
        + 0.32 * (3.0 * mean_h + 6.0).to_radians().cos()
        - 0.20 * (4.0 * mean_h - 63.0).to_radians().cos();
    let sl = 1.0 + 0.015 * (mean_l - 50.0).powi(2) / (20.0 + (mean_l - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * mean_cp;
    let sh = 1.0 + 0.015 * mean_cp * t;
    let rotation = 30.0 * (-((mean_h - 275.0) / 25.0).powi(2)).exp();
    let rc = 2.0 * (mean_cp.powi(7) / (mean_cp.powi(7) + 25f64.powi(7))).sqrt();
    let rt = -rc * (2.0 * rotation).to_radians().sin();
    let dl = delta_l / sl;
    let dc = delta_c / sc;
    let dh = delta_h / sh;
    (dl * dl + dc * dc + dh * dh + rt * dc * dh).max(0.0).sqrt()
}

fn solver_fingerprint(
    sampling: &ChartSamplingReceipt,
    chart: &ChartDefinition,
    illuminant: IlluminantCoordinates,
    matrix: [[f64; 3]; 3],
    train: &[usize],
    validation: &[usize],
) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"rapidraw.chart_calibration.solver.v1\0");
    hasher.update(sampling.source_revision.as_bytes());
    hasher.update(chart.id.as_bytes());
    hasher.update(&illuminant.x.to_le_bytes());
    hasher.update(&illuminant.y.to_le_bytes());
    for row in matrix {
        for value in row {
            hasher.update(&value.to_le_bytes());
        }
    }
    for index in train.iter().chain(validation) {
        hasher.update(&(*index as u64).to_le_bytes());
    }
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn euclidean(left: [f64; 3], right: [f64; 3]) -> f64 {
    ((left[0] - right[0]).powi(2) + (left[1] - right[1]).powi(2) + (left[2] - right[2]).powi(2))
        .sqrt()
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len().max(1) as f64
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    percentile(&sorted, 0.5)
}

fn percentile(sorted: &[f64], percentile: f64) -> f64 {
    if sorted.is_empty() {
        return f64::INFINITY;
    }
    let index = ((sorted.len() - 1) as f64 * percentile).round() as usize;
    sorted[index]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::calibration::{
        CaptureQualityReceipt, ChartGeometry, ChartSample, NormalizedPoint, chart_definition,
    };

    fn synthetic_sampling(outlier: bool) -> ChartSamplingReceipt {
        let chart = chart_definition("colorchecker_classic_24_cc0_srgb_d65_v1").unwrap();
        let camera_to_xyz = Matrix3::new(0.72, 0.14, 0.05, 0.18, 0.81, 0.08, 0.03, 0.06, 0.91);
        let xyz_to_camera = camera_to_xyz.try_inverse().unwrap();
        let samples = chart
            .patches
            .iter()
            .enumerate()
            .map(|(index, patch)| {
                let mut rgb = xyz_to_camera * Vector3::from_column_slice(&patch.xyz_d65);
                if outlier && index == 7 {
                    rgb[0] *= 1.8;
                }
                ChartSample {
                    patch_id: patch.id.into(),
                    role: patch.role,
                    camera_rgb_mean: [rgb[0], rgb[1], rgb[2]],
                    camera_rgb_median: [rgb[0], rgb[1], rgb[2]],
                    covariance: [[1e-8; 3]; 3],
                    clipped_fraction: 0.0,
                    valid_fraction: 1.0,
                    spatial_gradient: 0.01,
                    sharpness: 0.1,
                    sample_count: 81,
                }
            })
            .collect();
        ChartSamplingReceipt {
            contract: CALIBRATION_CONTRACT.into(),
            chart_id: chart.id.into(),
            chart_version: chart.version,
            source_revision: "source-revision-v1:synthetic".into(),
            camera_identity: "Synthetic Camera".into(),
            input_domain: "raw_camera_linear_after_sensor_correction_before_wb_profile_view_output"
                .into(),
            geometry: ChartGeometry {
                corners: [
                    NormalizedPoint { x: 0.1, y: 0.1 },
                    NormalizedPoint { x: 0.9, y: 0.1 },
                    NormalizedPoint { x: 0.9, y: 0.9 },
                    NormalizedPoint { x: 0.1, y: 0.9 },
                ],
                mirrored: false,
            },
            samples,
            capture_quality: CaptureQualityReceipt {
                chart_area_fraction: 0.64,
                minimum_patch_area_pixels: 1000.0,
                maximum_clipped_fraction: 0.0,
                maximum_spatial_gradient: 0.01,
                minimum_patch_sharpness: 0.1,
                warning_codes: Vec::new(),
                accepted: true,
            },
        }
    }

    #[test]
    fn exact_synthetic_matrix_is_recovered_with_held_out_receipt() {
        let chart = chart_definition("colorchecker_classic_24_cc0_srgb_d65_v1").unwrap();
        let receipt = fit_calibration(
            &synthetic_sampling(false),
            &chart,
            IlluminantCoordinates {
                x: 0.3127,
                y: 0.3290,
                cct_kelvin: Some(6504.0),
                duv: Some(0.0),
            },
        )
        .unwrap();
        assert_eq!(receipt.validation_patch_ids.len(), 6);
        assert!(
            receipt.validation_metrics.mean_delta_e00 < 0.001,
            "{receipt:?}"
        );
        assert_eq!(receipt.quality_status, CalibrationQualityStatus::Excellent);
        assert!(!receipt.residual_model_accepted);
    }

    #[test]
    fn robust_fit_rejects_outlier_without_overfitting_validation() {
        let chart = chart_definition("colorchecker_classic_24_cc0_srgb_d65_v1").unwrap();
        let receipt = fit_calibration(
            &synthetic_sampling(true),
            &chart,
            IlluminantCoordinates {
                x: 0.3127,
                y: 0.3290,
                cct_kelvin: Some(6504.0),
                duv: Some(0.0),
            },
        )
        .unwrap();
        assert!(
            receipt
                .rejected_patch_ids
                .contains(&"purplish_blue".to_string())
        );
        assert!(receipt.validation_metrics.mean_delta_e00 < 1.0);
    }

    #[test]
    fn failed_capture_receipt_remains_finite_and_ipc_serializable() {
        let chart = chart_definition("colorchecker_classic_24_cc0_srgb_d65_v1").unwrap();
        let mut sampling = synthetic_sampling(false);
        sampling.capture_quality.accepted = false;
        sampling
            .capture_quality
            .warning_codes
            .push("chart_capture_clipped".into());
        let receipt = fit_calibration(
            &sampling,
            &chart,
            IlluminantCoordinates {
                x: 0.3127,
                y: 0.3290,
                cct_kelvin: Some(6504.0),
                duv: Some(0.0),
            },
        )
        .unwrap();

        assert_eq!(
            receipt.quality_status,
            CalibrationQualityStatus::FailedCaptureQuality
        );
        assert!(receipt.condition_number.is_finite());
        assert!(receipt.validation_metrics.mean_delta_e00.is_finite());
        serde_json::to_value(receipt).expect("failed receipt crosses the Tauri IPC boundary");
    }

    #[test]
    fn delta_e_reference_matches_sharma_pair() {
        let left = [50.0, 2.6772, -79.7751];
        let right = [50.0, 0.0, -82.7485];
        assert!((delta_e00(left, right) - 2.0425).abs() < 0.0001);
    }
}
