use anyhow::{Context, Result, ensure};
use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use super::camera_profile::DcpProfileV1;

pub(crate) const CHART_CALIBRATION_CONTRACT: &str = "rapidraw.chart_calibration.v1";
const SOLVER_VERSION: u32 = 1;
const GENERATED_PROFILE_EXTENSION: &str = "rapidraw-profile.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CalibrationPatchRole {
    Train,
    Validation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartPatchSampleV1 {
    pub patch_id: String,
    pub camera_rgb: [f64; 3],
    pub reference_xyz: [f64; 3],
    pub role: CalibrationPatchRole,
    pub neutral: bool,
    pub clipped_fraction: f64,
    pub valid_fraction: f64,
    #[serde(default = "unit_weight")]
    pub weight: f64,
}

fn unit_weight() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartCalibrationRequestV1 {
    pub profile_name: String,
    pub camera_identity: String,
    pub source_revision: String,
    pub raw_processing_profile: String,
    pub chart_id: String,
    pub chart_version: u32,
    pub illuminant_code: u16,
    pub illuminant_xy: [f64; 2],
    pub adaptation_method: String,
    pub reference_white_xyz: [f64; 3],
    pub samples: Vec<ChartPatchSampleV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CalibrationQualityStatus {
    Excellent,
    Acceptable,
    WarningPublishable,
    FailedValidation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColorErrorMetricsV1 {
    pub sample_count: usize,
    pub delta_e00_mean: f64,
    pub delta_e00_median: f64,
    pub delta_e00_p95: f64,
    pub delta_e00_max: f64,
    pub neutral_delta_e00_mean: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatchFitReceiptV1 {
    pub patch_id: String,
    pub role: CalibrationPatchRole,
    pub delta_e00: f64,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalibrationFitReceiptV1 {
    pub contract: String,
    pub implementation_version: u32,
    pub camera_identity: String,
    pub source_revision: String,
    pub raw_processing_profile: String,
    pub chart_id: String,
    pub chart_version: u32,
    pub illuminant_code: u16,
    pub illuminant_xy: [f64; 2],
    pub adaptation_method: String,
    pub camera_to_xyz_matrix: [[f64; 3]; 3],
    pub xyz_to_camera_matrix: [[f64; 3]; 3],
    pub condition_number: f64,
    pub train_metrics: ColorErrorMetricsV1,
    pub validation_metrics: ColorErrorMetricsV1,
    pub patch_receipts: Vec<PatchFitReceiptV1>,
    pub rejected_patch_ids: Vec<String>,
    pub quality_status: CalibrationQualityStatus,
    pub profile_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratedCameraProfileArtifactV1 {
    pub contract: String,
    pub profile: DcpProfileV1,
    pub calibration: CalibrationFitReceiptV1,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalibrationPublishReportV1 {
    pub profile_id: String,
    pub artifact_path_token: String,
    pub calibration: CalibrationFitReceiptV1,
}

struct ProfileFingerprint<'a> {
    implementation_version: u32,
    camera_identity: &'a str,
    source_revision: &'a str,
    raw_processing_profile: &'a str,
    chart_id: &'a str,
    chart_version: u32,
    illuminant_code: u16,
    illuminant_xy: [f64; 2],
    adaptation_method: &'a str,
    camera_to_xyz_matrix: [[f64; 3]; 3],
}

pub(crate) fn fit_chart_calibration(
    request: &ChartCalibrationRequestV1,
) -> Result<GeneratedCameraProfileArtifactV1> {
    validate_request(request)?;
    let mut rejected_patch_ids = Vec::new();
    let usable: Vec<_> = request
        .samples
        .iter()
        .filter(|sample| {
            let accepted = sample.valid_fraction >= 0.8 && sample.clipped_fraction <= 0.02;
            if !accepted {
                rejected_patch_ids.push(sample.patch_id.clone());
            }
            accepted
        })
        .collect();
    let train: Vec<_> = usable
        .iter()
        .copied()
        .filter(|sample| sample.role == CalibrationPatchRole::Train)
        .collect();
    let validation: Vec<_> = usable
        .iter()
        .copied()
        .filter(|sample| sample.role == CalibrationPatchRole::Validation)
        .collect();
    ensure!(
        train.len() >= 6,
        "chart_calibration_insufficient_train_patches"
    );
    ensure!(
        validation.len() >= 3,
        "chart_calibration_insufficient_validation_patches"
    );

    let (camera_to_xyz, condition_number, robust_weights) = robust_matrix_fit(&train)?;
    let determinant = camera_to_xyz.determinant();
    ensure!(
        determinant.is_finite() && determinant > 1e-8,
        "chart_calibration_negative_or_singular_orientation"
    );
    let xyz_to_camera = camera_to_xyz
        .try_inverse()
        .context("chart_calibration_matrix_not_invertible")?;
    for (sample, weight) in train.iter().zip(&robust_weights) {
        if *weight < base_weight(sample) * 0.5 {
            rejected_patch_ids.push(sample.patch_id.clone());
        }
    }
    rejected_patch_ids.sort();
    rejected_patch_ids.dedup();

    let train_metrics = metrics(&train, &camera_to_xyz, request.reference_white_xyz)?;
    let validation_metrics = metrics(&validation, &camera_to_xyz, request.reference_white_xyz)?;
    let quality_status = quality_status(&validation_metrics);
    let matrix_array = matrix_to_array(&camera_to_xyz);
    let inverse_array = matrix_to_array(&xyz_to_camera);
    let fingerprint = ProfileFingerprint {
        implementation_version: SOLVER_VERSION,
        camera_identity: &request.camera_identity,
        source_revision: &request.source_revision,
        raw_processing_profile: &request.raw_processing_profile,
        chart_id: &request.chart_id,
        chart_version: request.chart_version,
        illuminant_code: request.illuminant_code,
        illuminant_xy: request.illuminant_xy,
        adaptation_method: &request.adaptation_method,
        camera_to_xyz_matrix: matrix_array,
    };
    let profile_sha256 = hash_fingerprint(&fingerprint)?;
    let patch_receipts = usable
        .iter()
        .map(|sample| PatchFitReceiptV1 {
            patch_id: sample.patch_id.clone(),
            role: sample.role,
            delta_e00: patch_delta_e00(sample, &camera_to_xyz, request.reference_white_xyz),
            accepted: !rejected_patch_ids.contains(&sample.patch_id),
        })
        .collect();
    let receipt = CalibrationFitReceiptV1 {
        contract: CHART_CALIBRATION_CONTRACT.to_string(),
        implementation_version: SOLVER_VERSION,
        camera_identity: request.camera_identity.clone(),
        source_revision: request.source_revision.clone(),
        raw_processing_profile: request.raw_processing_profile.clone(),
        chart_id: request.chart_id.clone(),
        chart_version: request.chart_version,
        illuminant_code: request.illuminant_code,
        illuminant_xy: request.illuminant_xy,
        adaptation_method: request.adaptation_method.clone(),
        camera_to_xyz_matrix: matrix_array,
        xyz_to_camera_matrix: inverse_array,
        condition_number,
        train_metrics,
        validation_metrics,
        patch_receipts,
        rejected_patch_ids,
        quality_status,
        profile_sha256: profile_sha256.clone(),
    };
    let profile = DcpProfileV1 {
        name: request.profile_name.trim().to_string(),
        camera_model: Some(request.camera_identity.trim().to_string()),
        calibration_illuminants: [Some(request.illuminant_code), None],
        color_matrices: [Some(inverse_array), None],
        camera_calibrations: [None, None],
        reduction_matrices: [None, None],
        analog_balance: [1.0; 3],
        forward_matrices: [None, None],
        hue_sat_maps: [None, None],
        look_table: None,
        tone_curve: Vec::new(),
        baseline_exposure_ev: 0.0,
        default_black_render: Some(1),
        calibration_signature: Some(format!(
            "rapidraw:{}:{}:v{}",
            request.chart_id, request.source_revision, SOLVER_VERSION
        )),
        copyright: Some(
            "User-generated calibration; chart reference rights remain with provider".into(),
        ),
        embed_policy: Some(1),
        content_sha256: profile_sha256,
        unsupported_tag_ids: Vec::new(),
    };
    Ok(GeneratedCameraProfileArtifactV1 {
        contract: CHART_CALIBRATION_CONTRACT.to_string(),
        profile,
        calibration: receipt,
    })
}

pub(crate) fn publish_generated_profile(
    generated_root: &Path,
    artifact: &GeneratedCameraProfileArtifactV1,
    confirm_warning: bool,
) -> Result<CalibrationPublishReportV1> {
    match artifact.calibration.quality_status {
        CalibrationQualityStatus::Excellent | CalibrationQualityStatus::Acceptable => {}
        CalibrationQualityStatus::WarningPublishable if confirm_warning => {}
        CalibrationQualityStatus::WarningPublishable => {
            anyhow::bail!("chart_calibration_warning_confirmation_required")
        }
        CalibrationQualityStatus::FailedValidation => {
            anyhow::bail!("chart_calibration_failed_profile_not_publishable")
        }
    }
    ensure!(
        artifact.contract == CHART_CALIBRATION_CONTRACT
            && artifact.calibration.contract == CHART_CALIBRATION_CONTRACT,
        "chart_calibration_contract_mismatch"
    );
    ensure!(
        artifact.profile.content_sha256 == artifact.calibration.profile_sha256,
        "chart_calibration_profile_hash_mismatch"
    );
    ensure!(
        expected_profile_sha256(&artifact.calibration)? == artifact.profile.content_sha256,
        "chart_calibration_profile_integrity_failed"
    );
    ensure!(
        artifact.profile.color_matrices[0] == Some(artifact.calibration.xyz_to_camera_matrix),
        "chart_calibration_profile_matrix_integrity_failed"
    );
    ensure!(
        artifact.profile.camera_model.as_deref()
            == Some(artifact.calibration.camera_identity.as_str())
            && artifact.profile.calibration_illuminants[0]
                == Some(artifact.calibration.illuminant_code),
        "chart_calibration_profile_identity_integrity_failed"
    );
    let digest = profile_digest(&artifact.profile.content_sha256)?;
    fs::create_dir_all(generated_root).context("chart_calibration_create_registry_failed")?;
    let destination = generated_root.join(format!("{digest}.{GENERATED_PROFILE_EXTENSION}"));
    if destination.exists() {
        load_generated_profile(&destination)
            .context("chart_calibration_existing_profile_invalid")?;
    } else {
        let mut temporary = tempfile::NamedTempFile::new_in(generated_root)
            .context("chart_calibration_temp_profile_failed")?;
        let bytes = serde_json::to_vec_pretty(artifact)?;
        temporary.write_all(&bytes)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(&destination)
            .map_err(|error| error.error)
            .context("chart_calibration_persist_profile_failed")?;
    }
    Ok(CalibrationPublishReportV1 {
        profile_id: format!("dcp:{digest}"),
        artifact_path_token: format!("generated:{digest}"),
        calibration: artifact.calibration.clone(),
    })
}

pub(crate) fn load_generated_profile(path: &Path) -> Result<GeneratedCameraProfileArtifactV1> {
    let metadata = fs::metadata(path).context("generated_camera_profile_metadata_failed")?;
    ensure!(
        metadata.is_file(),
        "generated_camera_profile_not_regular_file"
    );
    ensure!(
        metadata.len() <= 2 * 1024 * 1024,
        "generated_camera_profile_too_large"
    );
    let artifact: GeneratedCameraProfileArtifactV1 = serde_json::from_slice(&fs::read(path)?)
        .context("generated_camera_profile_invalid_json")?;
    ensure!(
        artifact.contract == CHART_CALIBRATION_CONTRACT
            && artifact.calibration.contract == CHART_CALIBRATION_CONTRACT,
        "generated_camera_profile_contract_mismatch"
    );
    ensure!(
        artifact.profile.content_sha256 == artifact.calibration.profile_sha256,
        "generated_camera_profile_hash_mismatch"
    );
    ensure!(
        expected_profile_sha256(&artifact.calibration)? == artifact.profile.content_sha256,
        "generated_camera_profile_fingerprint_integrity_failed"
    );
    ensure!(
        artifact.profile.color_matrices[0] == Some(artifact.calibration.xyz_to_camera_matrix),
        "generated_camera_profile_matrix_integrity_failed"
    );
    ensure!(
        artifact.profile.camera_model.as_deref()
            == Some(artifact.calibration.camera_identity.as_str()),
        "generated_camera_profile_camera_integrity_failed"
    );
    ensure!(
        artifact.profile.calibration_illuminants[0] == Some(artifact.calibration.illuminant_code),
        "generated_camera_profile_illuminant_integrity_failed"
    );
    let digest = profile_digest(&artifact.profile.content_sha256)?;
    let expected_file_name = format!("{digest}.{GENERATED_PROFILE_EXTENSION}");
    ensure!(
        path.file_name().and_then(|name| name.to_str()) == Some(expected_file_name.as_str()),
        "generated_camera_profile_noncanonical_path"
    );
    Ok(artifact)
}

#[tauri::command]
pub(crate) async fn fit_chart_calibration_report(
    request: ChartCalibrationRequestV1,
) -> Result<CalibrationFitReceiptV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fit_chart_calibration(&request)
            .map(|artifact| artifact.calibration)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn fit_and_publish_chart_calibration(
    app: tauri::AppHandle,
    request: ChartCalibrationRequestV1,
    confirm_warning: bool,
) -> Result<CalibrationPublishReportV1, String> {
    let root = super::camera_profile::registry::managed_profile_root(&app)
        .map_err(|error| error.to_string())?
        .join("generated");
    tauri::async_runtime::spawn_blocking(move || {
        let artifact = fit_chart_calibration(&request).map_err(|error| error.to_string())?;
        publish_generated_profile(&root, &artifact, confirm_warning)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn validate_request(request: &ChartCalibrationRequestV1) -> Result<()> {
    ensure!(
        !request.profile_name.trim().is_empty(),
        "chart_calibration_name_required"
    );
    ensure!(
        !request.camera_identity.trim().is_empty(),
        "chart_calibration_camera_required"
    );
    ensure!(
        request.profile_name == request.profile_name.trim()
            && request.camera_identity == request.camera_identity.trim(),
        "chart_calibration_identity_must_be_trimmed"
    );
    ensure!(
        !request.source_revision.trim().is_empty(),
        "chart_calibration_source_revision_required"
    );
    ensure!(
        !request.chart_id.trim().is_empty(),
        "chart_calibration_chart_required"
    );
    ensure!(
        request.chart_version > 0,
        "chart_calibration_chart_version_invalid"
    );
    for value in request
        .illuminant_xy
        .into_iter()
        .chain(request.reference_white_xyz)
    {
        ensure!(
            value.is_finite() && value > 0.0,
            "chart_calibration_illuminant_invalid"
        );
    }
    for sample in &request.samples {
        ensure!(
            !sample.patch_id.is_empty(),
            "chart_calibration_patch_id_required"
        );
        ensure!(
            sample
                .camera_rgb
                .into_iter()
                .chain(sample.reference_xyz)
                .all(|value| value.is_finite()),
            "chart_calibration_nonfinite_sample"
        );
        ensure!(
            sample.weight.is_finite()
                && sample.weight > 0.0
                && (0.0..=1.0).contains(&sample.clipped_fraction)
                && (0.0..=1.0).contains(&sample.valid_fraction),
            "chart_calibration_invalid_sample_quality"
        );
    }
    Ok(())
}

fn robust_matrix_fit(samples: &[&ChartPatchSampleV1]) -> Result<(Matrix3<f64>, f64, Vec<f64>)> {
    let base_weights: Vec<_> = samples.iter().map(|sample| base_weight(sample)).collect();
    let mut seed_candidates = Vec::new();
    for excluded in 0..samples.len() {
        let mut candidate_weights = base_weights.clone();
        candidate_weights[excluded] = 0.0;
        if let Ok((candidate, _)) = solve_weighted(samples, &candidate_weights) {
            let mut residuals: Vec<_> = samples
                .iter()
                .map(|sample| {
                    let predicted = candidate * Vector3::from_row_slice(&sample.camera_rgb);
                    let target = Vector3::from_row_slice(&sample.reference_xyz);
                    (predicted - target).norm()
                })
                .collect();
            residuals.sort_by(f64::total_cmp);
            seed_candidates.push((residuals[residuals.len() / 2], candidate));
        }
    }
    let (_, seed) = seed_candidates
        .into_iter()
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .context("chart_calibration_rank_deficient")?;
    let mut weights: Vec<_> = samples
        .iter()
        .zip(&base_weights)
        .map(|(sample, base)| {
            let predicted = seed * Vector3::from_row_slice(&sample.camera_rgb);
            let target = Vector3::from_row_slice(&sample.reference_xyz);
            let residual = (predicted - target).norm();
            *base
                * if residual <= 0.025 {
                    1.0
                } else {
                    0.025 / residual
                }
        })
        .collect();
    let mut fitted = seed;
    let mut condition_number = 0.0;
    for _ in 0..6 {
        (fitted, condition_number) = solve_weighted(samples, &weights)?;
        for ((sample, weight), base) in samples.iter().zip(&mut weights).zip(&base_weights) {
            let predicted = fitted * Vector3::from_row_slice(&sample.camera_rgb);
            let target = Vector3::from_row_slice(&sample.reference_xyz);
            let residual = (predicted - target).norm();
            let huber = if residual <= 0.025 {
                1.0
            } else {
                0.025 / residual
            };
            *weight = *base * huber;
        }
    }
    Ok((fitted, condition_number, weights))
}

fn solve_weighted(samples: &[&ChartPatchSampleV1], weights: &[f64]) -> Result<(Matrix3<f64>, f64)> {
    let mut normal = Matrix3::zeros();
    let mut rhs = Matrix3::zeros();
    for (sample, weight) in samples.iter().zip(weights) {
        let camera = Vector3::from_row_slice(&sample.camera_rgb);
        let reference = Vector3::from_row_slice(&sample.reference_xyz);
        normal += camera * camera.transpose() * *weight;
        rhs += camera * reference.transpose() * *weight;
    }
    let eigen = normal.symmetric_eigen().eigenvalues;
    let min = eigen.min();
    let max = eigen.max();
    ensure!(min > 1e-10, "chart_calibration_rank_deficient");
    let condition_number = (max / min).sqrt();
    ensure!(
        condition_number.is_finite() && condition_number <= 1e6,
        "chart_calibration_ill_conditioned"
    );
    let coefficients = normal
        .try_inverse()
        .context("chart_calibration_normal_matrix_singular")?
        * rhs;
    Ok((coefficients.transpose(), condition_number))
}

fn base_weight(sample: &ChartPatchSampleV1) -> f64 {
    sample.weight * if sample.neutral { 3.0 } else { 1.0 }
}

fn metrics(
    samples: &[&ChartPatchSampleV1],
    matrix: &Matrix3<f64>,
    white: [f64; 3],
) -> Result<ColorErrorMetricsV1> {
    ensure!(!samples.is_empty(), "chart_calibration_metrics_empty");
    let mut values: Vec<_> = samples
        .iter()
        .map(|sample| patch_delta_e00(sample, matrix, white))
        .collect();
    ensure!(
        values.iter().all(|value| value.is_finite()),
        "chart_calibration_nonfinite_metric"
    );
    values.sort_by(f64::total_cmp);
    let neutral: Vec<_> = samples
        .iter()
        .filter(|sample| sample.neutral)
        .map(|sample| patch_delta_e00(sample, matrix, white))
        .collect();
    let percentile_index = ((values.len() - 1) as f64 * 0.95).ceil() as usize;
    Ok(ColorErrorMetricsV1 {
        sample_count: values.len(),
        delta_e00_mean: values.iter().sum::<f64>() / values.len() as f64,
        delta_e00_median: values[values.len() / 2],
        delta_e00_p95: values[percentile_index],
        delta_e00_max: *values.last().expect("metrics are non-empty"),
        neutral_delta_e00_mean: (!neutral.is_empty())
            .then(|| neutral.iter().sum::<f64>() / neutral.len() as f64),
    })
}

fn quality_status(metrics: &ColorErrorMetricsV1) -> CalibrationQualityStatus {
    if metrics.delta_e00_mean <= 2.0 && metrics.delta_e00_p95 <= 4.0 {
        CalibrationQualityStatus::Excellent
    } else if metrics.delta_e00_mean <= 4.0 && metrics.delta_e00_p95 <= 8.0 {
        CalibrationQualityStatus::Acceptable
    } else if metrics.delta_e00_mean <= 7.0 && metrics.delta_e00_p95 <= 12.0 {
        CalibrationQualityStatus::WarningPublishable
    } else {
        CalibrationQualityStatus::FailedValidation
    }
}

fn patch_delta_e00(sample: &ChartPatchSampleV1, matrix: &Matrix3<f64>, white: [f64; 3]) -> f64 {
    let predicted = matrix * Vector3::from_row_slice(&sample.camera_rgb);
    delta_e00(
        xyz_to_lab([predicted.x, predicted.y, predicted.z], white),
        xyz_to_lab(sample.reference_xyz, white),
    )
}

fn xyz_to_lab(xyz: [f64; 3], white: [f64; 3]) -> [f64; 3] {
    let f = |value: f64| {
        const EPSILON: f64 = 216.0 / 24_389.0;
        const KAPPA: f64 = 24_389.0 / 27.0;
        if value > EPSILON {
            value.cbrt()
        } else {
            (KAPPA * value + 16.0) / 116.0
        }
    };
    let fx = f(xyz[0] / white[0]);
    let fy = f(xyz[1] / white[1]);
    let fz = f(xyz[2] / white[2]);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

// Sharma et al. CIEDE2000, unit weighting factors.
fn delta_e00(first: [f64; 3], second: [f64; 3]) -> f64 {
    let [l1, a1, b1] = first;
    let [l2, a2, b2] = second;
    let c1 = a1.hypot(b1);
    let c2 = a2.hypot(b2);
    let c_bar = (c1 + c2) * 0.5;
    let c7 = c_bar.powi(7);
    let g = 0.5 * (1.0 - (c7 / (c7 + 25.0_f64.powi(7))).sqrt());
    let ap1 = (1.0 + g) * a1;
    let ap2 = (1.0 + g) * a2;
    let cp1 = ap1.hypot(b1);
    let cp2 = ap2.hypot(b2);
    let hp = |a: f64, b: f64| {
        if a == 0.0 && b == 0.0 {
            0.0
        } else {
            b.atan2(a).to_degrees().rem_euclid(360.0)
        }
    };
    let hp1 = hp(ap1, b1);
    let hp2 = hp(ap2, b2);
    let delta_l = l2 - l1;
    let delta_c = cp2 - cp1;
    let hue_distance = hp2 - hp1;
    let delta_h_degrees = if cp1 * cp2 == 0.0 {
        0.0
    } else if hue_distance.abs() <= 180.0 {
        hue_distance
    } else if hue_distance > 180.0 {
        hue_distance - 360.0
    } else {
        hue_distance + 360.0
    };
    let delta_h = 2.0 * (cp1 * cp2).sqrt() * (delta_h_degrees.to_radians() * 0.5).sin();
    let l_bar = (l1 + l2) * 0.5;
    let cp_bar = (cp1 + cp2) * 0.5;
    let hp_bar = if cp1 * cp2 == 0.0 {
        hp1 + hp2
    } else if (hp1 - hp2).abs() <= 180.0 {
        (hp1 + hp2) * 0.5
    } else if hp1 + hp2 < 360.0 {
        (hp1 + hp2 + 360.0) * 0.5
    } else {
        (hp1 + hp2 - 360.0) * 0.5
    };
    let t = 1.0 - 0.17 * (hp_bar - 30.0).to_radians().cos()
        + 0.24 * (2.0 * hp_bar).to_radians().cos()
        + 0.32 * (3.0 * hp_bar + 6.0).to_radians().cos()
        - 0.20 * (4.0 * hp_bar - 63.0).to_radians().cos();
    let sl = 1.0 + 0.015 * (l_bar - 50.0).powi(2) / (20.0 + (l_bar - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * cp_bar;
    let sh = 1.0 + 0.015 * cp_bar * t;
    let rotation = 30.0 * (-((hp_bar - 275.0) / 25.0).powi(2)).exp();
    let rc = 2.0 * (cp_bar.powi(7) / (cp_bar.powi(7) + 25.0_f64.powi(7))).sqrt();
    let rt = -rc * (2.0 * rotation).to_radians().sin();
    let dl = delta_l / sl;
    let dc = delta_c / sc;
    let dh = delta_h / sh;
    (dl * dl + dc * dc + dh * dh + rt * dc * dh).max(0.0).sqrt()
}

fn matrix_to_array(matrix: &Matrix3<f64>) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| std::array::from_fn(|column| matrix[(row, column)]))
}

fn profile_digest(hash: &str) -> Result<&str> {
    let digest = hash
        .strip_prefix("sha256:")
        .context("generated_camera_profile_hash_prefix")?;
    ensure!(
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        "generated_camera_profile_hash_invalid"
    );
    Ok(digest)
}

fn hash_fingerprint(fingerprint: &ProfileFingerprint<'_>) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(fingerprint.implementation_version.to_le_bytes());
    for value in [
        fingerprint.camera_identity,
        fingerprint.source_revision,
        fingerprint.raw_processing_profile,
        fingerprint.chart_id,
        fingerprint.adaptation_method,
    ] {
        hasher.update((value.len() as u64).to_le_bytes());
        hasher.update(value.as_bytes());
    }
    hasher.update(fingerprint.chart_version.to_le_bytes());
    hasher.update(fingerprint.illuminant_code.to_le_bytes());
    for value in fingerprint
        .illuminant_xy
        .into_iter()
        .chain(fingerprint.camera_to_xyz_matrix.into_iter().flatten())
    {
        ensure!(
            value.is_finite(),
            "generated_camera_profile_nonfinite_fingerprint"
        );
        hasher.update(format!("{value:.12e}").as_bytes());
        hasher.update([0]);
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn expected_profile_sha256(receipt: &CalibrationFitReceiptV1) -> Result<String> {
    hash_fingerprint(&ProfileFingerprint {
        implementation_version: receipt.implementation_version,
        camera_identity: &receipt.camera_identity,
        source_revision: &receipt.source_revision,
        raw_processing_profile: &receipt.raw_processing_profile,
        chart_id: &receipt.chart_id,
        chart_version: receipt.chart_version,
        illuminant_code: receipt.illuminant_code,
        illuminant_xy: receipt.illuminant_xy,
        adaptation_method: &receipt.adaptation_method,
        camera_to_xyz_matrix: receipt.camera_to_xyz_matrix,
    })
}

pub(crate) fn generated_profile_path(root: &Path, digest: &str) -> PathBuf {
    root.join(format!("{digest}.{GENERATED_PROFILE_EXTENSION}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::camera_profile::{
        CameraProfileSource,
        execute::compile_camera_profile,
        registry::{CameraProfileRegistry, resolve_managed_profile},
    };

    const TRUE_MATRIX: [[f64; 3]; 3] = [[0.64, 0.18, 0.12], [0.22, 0.71, 0.07], [0.03, 0.12, 0.81]];

    fn multiply(matrix: [[f64; 3]; 3], rgb: [f64; 3]) -> [f64; 3] {
        std::array::from_fn(|row| (0..3).map(|column| matrix[row][column] * rgb[column]).sum())
    }

    fn request(validation_bias: f64) -> ChartCalibrationRequestV1 {
        let colors = [
            [0.12, 0.18, 0.24],
            [0.72, 0.18, 0.11],
            [0.11, 0.68, 0.17],
            [0.16, 0.20, 0.73],
            [0.62, 0.52, 0.12],
            [0.18, 0.58, 0.61],
            [0.80, 0.72, 0.64],
            [0.38, 0.36, 0.34],
            [0.21, 0.21, 0.21],
            [0.52, 0.24, 0.38],
            [0.30, 0.46, 0.20],
            [0.19, 0.31, 0.48],
        ];
        let samples = colors
            .into_iter()
            .enumerate()
            .map(|(index, camera_rgb)| {
                let role = if index < 8 {
                    CalibrationPatchRole::Train
                } else {
                    CalibrationPatchRole::Validation
                };
                let mut reference_xyz = multiply(TRUE_MATRIX, camera_rgb);
                if role == CalibrationPatchRole::Validation {
                    reference_xyz[0] += validation_bias;
                }
                ChartPatchSampleV1 {
                    patch_id: format!("patch-{index:02}"),
                    camera_rgb,
                    reference_xyz,
                    role,
                    neutral: matches!(index, 6..=8),
                    clipped_fraction: 0.0,
                    valid_fraction: 1.0,
                    weight: 1.0,
                }
            })
            .collect();
        ChartCalibrationRequestV1 {
            profile_name: "Studio D50".into(),
            camera_identity: "Synthetic Camera 1".into(),
            source_revision: "raw:fixture-v1".into(),
            raw_processing_profile: "maximum:demosaic-v2".into(),
            chart_id: "synthetic-redistributable-12".into(),
            chart_version: 1,
            illuminant_code: 23,
            illuminant_xy: [0.34567, 0.35850],
            adaptation_method: "bradford".into(),
            reference_white_xyz: [0.96422, 1.0, 0.82521],
            samples,
        }
    }

    #[test]
    fn recovers_exact_matrix_deterministically_with_measured_holdout_error() {
        let first = fit_chart_calibration(&request(0.0)).unwrap();
        let second = fit_chart_calibration(&request(0.0)).unwrap();
        assert_eq!(
            first.calibration.profile_sha256,
            second.calibration.profile_sha256
        );
        assert_eq!(
            first.calibration.camera_to_xyz_matrix,
            second.calibration.camera_to_xyz_matrix
        );
        for (row, expected_row) in TRUE_MATRIX.iter().enumerate() {
            for (column, expected) in expected_row.iter().enumerate() {
                assert!(
                    (first.calibration.camera_to_xyz_matrix[row][column] - expected).abs() < 1e-10
                );
            }
        }
        assert!(first.calibration.validation_metrics.delta_e00_max < 1e-9);
        assert_eq!(
            first.calibration.quality_status,
            CalibrationQualityStatus::Excellent
        );
    }

    #[test]
    fn rejects_rank_deficient_capture_and_blocks_failed_validation_publish() {
        let mut deficient = request(0.0);
        for sample in &mut deficient.samples {
            sample.camera_rgb = [0.2, 0.2, 0.2];
        }
        assert!(
            fit_chart_calibration(&deficient)
                .unwrap_err()
                .to_string()
                .contains("rank_deficient")
        );

        let failed = fit_chart_calibration(&request(0.35)).unwrap();
        assert_eq!(
            failed.calibration.quality_status,
            CalibrationQualityStatus::FailedValidation
        );
        let root = tempfile::tempdir().unwrap();
        assert!(
            publish_generated_profile(root.path(), &failed, true)
                .unwrap_err()
                .to_string()
                .contains("not_publishable")
        );
    }

    #[test]
    fn warning_profile_requires_explicit_confirmation_but_keeps_its_receipt() {
        let artifact = [0.015, 0.025, 0.035, 0.05]
            .into_iter()
            .map(|bias| fit_chart_calibration(&request(bias)).unwrap())
            .find(|artifact| {
                artifact.calibration.quality_status == CalibrationQualityStatus::WarningPublishable
            })
            .expect("fixture must exercise the warning quality band");
        let root = tempfile::tempdir().unwrap();
        assert!(
            publish_generated_profile(root.path(), &artifact, false)
                .unwrap_err()
                .to_string()
                .contains("confirmation_required")
        );
        let published = publish_generated_profile(root.path(), &artifact, true).unwrap();
        assert_eq!(
            published.calibration.quality_status,
            CalibrationQualityStatus::WarningPublishable
        );
    }

    #[test]
    fn robust_fit_downweights_a_corrupt_training_patch() {
        let mut noisy = request(0.0);
        noisy.samples[2].reference_xyz = [0.95, 0.05, 0.80];
        let artifact = fit_chart_calibration(&noisy).unwrap();
        assert!(
            artifact
                .calibration
                .rejected_patch_ids
                .contains(&"patch-02".to_string())
        );
        assert!(artifact.calibration.validation_metrics.delta_e00_mean < 4.0);
    }

    #[test]
    fn persisted_generated_profile_reopens_and_changes_production_output() {
        let root = tempfile::tempdir().unwrap();
        let artifact = fit_chart_calibration(&request(0.0)).unwrap();
        let report =
            publish_generated_profile(&root.path().join("generated"), &artifact, false).unwrap();
        let digest = report.profile_id.strip_prefix("dcp:").unwrap();
        let canonical_path = generated_profile_path(&root.path().join("generated"), digest);
        assert!(canonical_path.is_file());
        fs::copy(
            &canonical_path,
            root.path().join("generated/renamed.rapidraw-profile.json"),
        )
        .unwrap();

        let mut registry = CameraProfileRegistry::default();
        registry
            .scan(
                &[(
                    root.path().join("generated"),
                    CameraProfileSource::Generated,
                )],
                Some("Synthetic Camera 1"),
                Default::default(),
            )
            .unwrap();
        assert_eq!(
            registry.entries(None, true).len(),
            1,
            "quarantine={:?}",
            registry.quarantine()
        );
        assert_eq!(registry.quarantine().len(), 1);
        let (profile, source) = resolve_managed_profile(&report.profile_id, root.path()).unwrap();
        let plan = compile_camera_profile(
            &profile,
            source,
            Some("Synthetic Camera 1"),
            None,
            None,
            0.0,
        )
        .unwrap();
        let camera = [0.27, 0.42, 0.16];
        let expected = multiply(TRUE_MATRIX, camera);
        let mapped = multiply(plan.matrix, camera);
        let profile_error: f64 = mapped
            .iter()
            .zip(expected)
            .map(|(a, b)| (a - b).abs())
            .sum();
        let identity_error: f64 = camera
            .iter()
            .zip(expected)
            .map(|(a, b)| (a - b).abs())
            .sum();
        assert!(
            profile_error < 1e-9,
            "generated profile must execute the fitted output matrix"
        );
        assert!(profile_error < identity_error * 1e-6);

        let mut tampered = artifact;
        tampered.profile.color_matrices[0].as_mut().unwrap()[0][0] += 0.1;
        assert!(
            publish_generated_profile(&root.path().join("generated"), &tampered, false)
                .unwrap_err()
                .to_string()
                .contains("integrity_failed")
        );
    }

    #[test]
    fn ciede2000_matches_published_reference_pair() {
        let measured = delta_e00([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485]);
        assert!((measured - 2.0425).abs() < 0.0001);
    }
}
