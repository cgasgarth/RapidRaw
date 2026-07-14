//! Native trust-boundary and production-render checks for governed Film validation.

use crate::render::film_emulation::{
    AP1_LUMINANCE, FilmEmulationParams, FilmEmulationProfileRef, REFERENCE_PROFILE_CONTENT_SHA256,
    REFERENCE_PROFILE_ID, REFERENCE_PROFILE_VERSION, REFERENCE_SHAPER_P, apply_pixel,
};
use crate::render::film_execution_plan::{FilmExecutionPlanV1, FilmFrameContextV1, execute_cpu};
use crate::render::film_optical_scatter::{
    apply as apply_optical_scatter, reference as reference_optical_scatter,
};
use glam::Vec3;
use image::{ImageBuffer, Rgb32FImage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilmValidationMetricsV1 {
    pub max_abs: f32,
    pub rmse: f32,
    pub neutral_axis_drift: f32,
    pub negative_component_count: u32,
    pub high_component_count: u32,
}

pub(crate) fn validate_metrics(metrics: &FilmValidationMetricsV1) -> Result<(), &'static str> {
    if !metrics.max_abs.is_finite()
        || !metrics.rmse.is_finite()
        || !metrics.neutral_axis_drift.is_finite()
        || metrics.max_abs < 0.0
        || metrics.rmse < 0.0
        || metrics.neutral_axis_drift < 0.0
    {
        return Err("film_validation_non_finite_metrics");
    }
    if metrics.max_abs > 0.1 || metrics.rmse > 0.1 || metrics.neutral_axis_drift > 0.1 {
        return Err("film_validation_metric_ceiling_failed");
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmValidationFixtureV1 {
    contract: String,
    id: String,
    proof_level: String,
    source: FilmValidationSourceV1,
    input: FilmValidationInputV1,
    regions: Vec<FilmValidationRegionV1>,
    render: FilmValidationRenderV1,
    thresholds: FilmValidationThresholdsV1,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmValidationSourceV1 {
    logical_id: String,
    path_or_private_ref: String,
    sha256: String,
    media_type: String,
    license_spdx: Vec<String>,
    notice_paths: Vec<String>,
    public_repo_allowed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmValidationInputV1 {
    domain: String,
    input_transform_id: String,
    input_profile_id: Option<String>,
    input_profile_sha256: Option<String>,
    illuminant: Option<String>,
    white_balance: Option<[f32; 3]>,
    exposure_offset_ev: Option<f32>,
    orientation: Option<u16>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmValidationRegionV1 {
    id: String,
    kind: String,
    bounds: [f32; 4],
    reference_rgb: Option<[f32; 3]>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmValidationRenderV1 {
    profile_refs: Vec<FilmEmulationProfileRef>,
    view_transforms: Vec<String>,
    output_profiles: Vec<String>,
    bit_depths: Vec<u8>,
    proof_crops: Vec<[f32; 4]>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmValidationThresholdsV1 {
    max_abs: f32,
    rmse: f32,
    neutral_axis_drift: f32,
    identity_delta_e00: f32,
    monotonic_tolerance: f32,
    grain_repeat_tolerance: f32,
    grain_mean_drift: f32,
    grain_variance_min: f32,
    grain_variance_max: f32,
    grain_correlation_min: f32,
    grain_correlation_max: f32,
    grain_frequency_energy_min: f32,
    grain_frequency_energy_max: f32,
    grain_density_variance_ratio_min: f32,
    optical_leakage: f32,
    optical_energy_max: f32,
    optical_continuity_max_step: f32,
    optical_halation_red_ratio_min: f32,
    optical_bloom_neutral_drift: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum FilmAnalyticAssertionV1 {
    IdentityDisabled,
    IdentityMixZero,
    FiniteFullMix,
    NeutralFullMix,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmAnalyticVectorSetV1 {
    contract: String,
    profile_ref: FilmEmulationProfileRef,
    working_space: String,
    samples: Vec<FilmAnalyticSampleV1>,
    neutral_ramp: FilmAnalyticNeutralRampV1,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmAnalyticSampleV1 {
    id: String,
    input: [f32; 3],
    assertions: BTreeSet<FilmAnalyticAssertionV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilmAnalyticNeutralRampV1 {
    id: String,
    values: Vec<f32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilmNativeAnalyticSampleReportV1 {
    id: String,
    input: [f32; 3],
    disabled_output: [f32; 3],
    mix_zero_output: [f32; 3],
    full_mix_output: [f32; 3],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilmNativeAnalyticReportV1 {
    contract: &'static str,
    fixture_id: String,
    source_sha256: String,
    profile_ref: FilmEmulationProfileRef,
    post_film_domain: &'static str,
    max_abs: f32,
    rmse: f32,
    neutral_axis_drift: f32,
    monotonic_violation_count: u32,
    negative_component_count: u32,
    high_component_count: u32,
    deterministic_hash: String,
    samples: Vec<FilmNativeAnalyticSampleReportV1>,
    passed: bool,
    failures: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilmNativeGrainReportV1 {
    deterministic_hash: String,
    repeat_hash: String,
    mean_residual: [f32; 3],
    variance_by_channel: [f32; 3],
    density_variance: [f32; 3],
    channel_correlation: [f32; 3],
    adjacent_correlation: [f32; 3],
    frequency_energy_ratio: [f32; 3],
    tile_max_abs: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilmNativeOpticalReportV1 {
    supported_subset: &'static str,
    bypass_max_abs: f32,
    subthreshold_leakage: f32,
    halation_energy: f32,
    bloom_energy: f32,
    halation_red_ratio: f32,
    bloom_neutral_drift: f32,
    halation_weighted_radius_px: f32,
    bloom_weighted_radius_px: f32,
    continuity_max_step: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilmNativeStochasticOpticalReportV1 {
    contract: &'static str,
    fixture_id: String,
    source_sha256: String,
    profile_ref: FilmEmulationProfileRef,
    post_film_domain: &'static str,
    grain: FilmNativeGrainReportV1,
    optical: FilmNativeOpticalReportV1,
    passed: bool,
    failures: Vec<String>,
}

fn reference_profile_ref() -> FilmEmulationProfileRef {
    FilmEmulationProfileRef {
        id: REFERENCE_PROFILE_ID.to_string(),
        version: REFERENCE_PROFILE_VERSION.to_string(),
        content_sha256: REFERENCE_PROFILE_CONTENT_SHA256.to_string(),
    }
}

fn validate_governance(
    fixture: &FilmValidationFixtureV1,
    vectors: &FilmAnalyticVectorSetV1,
    vector_bytes: &[u8],
) -> Result<(), &'static str> {
    let source_hash = format!("sha256:{}", hex::encode(Sha256::digest(vector_bytes)));
    if fixture.contract != "rapidraw.film_validation_fixture.v1"
        || fixture.proof_level != "analytic_numeric"
        || fixture.source.sha256 != source_hash
        || !fixture.source.public_repo_allowed
        || fixture.source.logical_id.trim().is_empty()
        || fixture.source.path_or_private_ref
            != "fixtures/film/validation/reference-film-analytic-v1.json"
        || fixture.source.media_type != "application/json"
        || fixture.source.license_spdx.is_empty()
        || fixture.source.notice_paths.is_empty()
        || fixture.input.domain != "acescg_linear_v1"
        || fixture.input.input_transform_id != "generated_ap1_identity_v1"
        || fixture.input.input_profile_id.is_some() != fixture.input.input_profile_sha256.is_some()
        || fixture
            .input
            .illuminant
            .as_ref()
            .is_some_and(|value| value.trim().is_empty())
        || fixture
            .input
            .white_balance
            .is_some_and(|rgb| rgb.iter().any(|value| !value.is_finite()))
        || fixture
            .input
            .exposure_offset_ev
            .is_some_and(|value| !value.is_finite())
        || fixture.input.orientation.is_some_and(|value| value > 359)
        || fixture.regions.is_empty()
        || fixture.regions.iter().any(|region| {
            region.id.trim().is_empty()
                || !matches!(
                    region.kind.as_str(),
                    "neutral" | "ramp" | "edge" | "uniform" | "color_patch"
                )
                || region.bounds.iter().any(|value| !value.is_finite())
                || region.bounds[0] < 0.0
                || region.bounds[1] < 0.0
                || region.bounds[2] <= 0.0
                || region.bounds[3] <= 0.0
                || region.bounds[0] + region.bounds[2] > 1.0
                || region.bounds[1] + region.bounds[3] > 1.0
                || region
                    .reference_rgb
                    .is_some_and(|rgb| rgb.iter().any(|value| !value.is_finite()))
        })
        || fixture.render.profile_refs != vec![reference_profile_ref()]
        || fixture.render.view_transforms.is_empty()
        || fixture.render.output_profiles.is_empty()
        || fixture
            .render
            .bit_depths
            .iter()
            .any(|depth| !matches!(depth, 8 | 16 | 32))
        || fixture.render.proof_crops.is_empty()
        || fixture.render.proof_crops.iter().any(|crop| {
            crop.iter().any(|value| !value.is_finite())
                || crop[0] < 0.0
                || crop[1] < 0.0
                || crop[2] <= 0.0
                || crop[3] <= 0.0
                || crop[0] + crop[2] > 1.0
                || crop[1] + crop[3] > 1.0
        })
        || [
            fixture.thresholds.max_abs,
            fixture.thresholds.rmse,
            fixture.thresholds.neutral_axis_drift,
            fixture.thresholds.identity_delta_e00,
            fixture.thresholds.monotonic_tolerance,
            fixture.thresholds.grain_repeat_tolerance,
            fixture.thresholds.grain_mean_drift,
            fixture.thresholds.grain_variance_min,
            fixture.thresholds.grain_variance_max,
            fixture.thresholds.grain_correlation_min,
            fixture.thresholds.grain_correlation_max,
            fixture.thresholds.grain_frequency_energy_min,
            fixture.thresholds.grain_frequency_energy_max,
            fixture.thresholds.grain_density_variance_ratio_min,
            fixture.thresholds.optical_leakage,
            fixture.thresholds.optical_energy_max,
            fixture.thresholds.optical_continuity_max_step,
            fixture.thresholds.optical_halation_red_ratio_min,
            fixture.thresholds.optical_bloom_neutral_drift,
        ]
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0)
        || fixture.thresholds.grain_variance_min >= fixture.thresholds.grain_variance_max
        || fixture.thresholds.grain_correlation_min >= fixture.thresholds.grain_correlation_max
        || fixture.thresholds.grain_frequency_energy_min
            >= fixture.thresholds.grain_frequency_energy_max
        || vectors.contract != "rapidraw.film_analytic_vectors.v1"
        || vectors.profile_ref != reference_profile_ref()
        || vectors.profile_ref != fixture.render.profile_refs[0]
        || vectors.working_space != "acescg_linear_v1"
        || vectors.samples.len() < 4
        || vectors.neutral_ramp.values.len() < 5
    {
        return Err("film_validation_governance_invalid");
    }
    let mut ids = BTreeSet::new();
    let assertions = vectors
        .samples
        .iter()
        .flat_map(|sample| sample.assertions.iter().copied())
        .collect::<BTreeSet<_>>();
    if vectors.samples.iter().any(|sample| {
        sample.id.trim().is_empty()
            || !ids.insert(sample.id.as_str())
            || sample.input.iter().any(|value| !value.is_finite())
            || sample.assertions.is_empty()
    }) || !ids.insert(vectors.neutral_ramp.id.as_str())
        || vectors
            .neutral_ramp
            .values
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
        || vectors
            .neutral_ramp
            .values
            .windows(2)
            .any(|window| window[0] >= window[1])
        || assertions.len() != 4
    {
        return Err("film_validation_vectors_invalid");
    }
    Ok(())
}

fn run_reference_analytic_gate(
    fixture_json: &str,
    vector_bytes: &[u8],
) -> Result<FilmNativeAnalyticReportV1, &'static str> {
    let fixture: FilmValidationFixtureV1 =
        serde_json::from_str(fixture_json).map_err(|_| "film_validation_manifest_invalid")?;
    let vectors: FilmAnalyticVectorSetV1 =
        serde_json::from_slice(vector_bytes).map_err(|_| "film_validation_vectors_invalid")?;
    validate_governance(&fixture, &vectors, vector_bytes)?;

    let disabled = FilmEmulationParams {
        enabled: false,
        mix: 1.0,
        shaper_p: REFERENCE_SHAPER_P,
        grain_amount: 0.0,
    };
    let mix_zero = FilmEmulationParams {
        enabled: true,
        mix: 0.0,
        ..disabled
    };
    let full_mix = FilmEmulationParams {
        enabled: true,
        mix: 1.0,
        ..disabled
    };
    let mut identity_deltas = Vec::new();
    let mut neutral_axis_drift = 0.0_f32;
    let mut negative_component_count = 0_u32;
    let mut high_component_count = 0_u32;
    let mut failures = Vec::new();
    let mut samples = Vec::with_capacity(vectors.samples.len());

    for sample in &vectors.samples {
        let input = Vec3::from_array(sample.input);
        let disabled_output = apply_pixel(input, disabled);
        let mix_zero_output = apply_pixel(input, mix_zero);
        let full_mix_output = apply_pixel(input, full_mix);
        if sample
            .assertions
            .contains(&FilmAnalyticAssertionV1::IdentityDisabled)
        {
            identity_deltas.extend((disabled_output - input).abs().to_array());
        }
        if sample
            .assertions
            .contains(&FilmAnalyticAssertionV1::IdentityMixZero)
        {
            identity_deltas.extend((mix_zero_output - input).abs().to_array());
        }
        if sample
            .assertions
            .contains(&FilmAnalyticAssertionV1::FiniteFullMix)
            && !full_mix_output.is_finite()
        {
            failures.push(format!("non_finite_full_mix:{}", sample.id));
        }
        if sample
            .assertions
            .contains(&FilmAnalyticAssertionV1::NeutralFullMix)
        {
            neutral_axis_drift = neutral_axis_drift
                .max(full_mix_output.max_element() - full_mix_output.min_element());
        }
        negative_component_count += full_mix_output
            .to_array()
            .iter()
            .filter(|value| **value < 0.0)
            .count() as u32;
        high_component_count += full_mix_output
            .to_array()
            .iter()
            .filter(|value| **value > 1.0)
            .count() as u32;
        samples.push(FilmNativeAnalyticSampleReportV1 {
            id: sample.id.clone(),
            input: sample.input,
            disabled_output: disabled_output.to_array(),
            mix_zero_output: mix_zero_output.to_array(),
            full_mix_output: full_mix_output.to_array(),
        });
    }

    let max_abs = identity_deltas.iter().copied().fold(0.0_f32, f32::max);
    let rmse = if identity_deltas.is_empty() {
        0.0
    } else {
        (identity_deltas
            .iter()
            .map(|delta| delta * delta)
            .sum::<f32>()
            / identity_deltas.len() as f32)
            .sqrt()
    };
    if max_abs > fixture.thresholds.max_abs {
        failures.push("max_abs_threshold_failed".to_string());
    }
    if rmse > fixture.thresholds.rmse {
        failures.push("rmse_threshold_failed".to_string());
    }
    if neutral_axis_drift > fixture.thresholds.neutral_axis_drift {
        failures.push("neutral_axis_threshold_failed".to_string());
    }

    let mut monotonic_violation_count = 0_u32;
    let mut previous_luminance = f32::NEG_INFINITY;
    for value in &vectors.neutral_ramp.values {
        let output = apply_pixel(Vec3::splat(*value), full_mix);
        if !output.is_finite() {
            failures.push(format!(
                "non_finite_neutral_ramp:{}",
                vectors.neutral_ramp.id
            ));
            continue;
        }
        neutral_axis_drift = neutral_axis_drift.max(output.max_element() - output.min_element());
        let luminance = AP1_LUMINANCE.dot(output);
        if luminance + fixture.thresholds.monotonic_tolerance < previous_luminance {
            monotonic_violation_count += 1;
        }
        previous_luminance = luminance;
    }
    if monotonic_violation_count > 0 {
        failures.push("neutral_response_not_monotone".to_string());
    }

    let source_sha256 = fixture.source.sha256.clone();
    let deterministic_hash = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(
            serde_json::to_vec(&samples).map_err(|_| "film_validation_report_invalid")?
        ))
    );
    Ok(FilmNativeAnalyticReportV1 {
        contract: "rapidraw.film_native_analytic_report.v1",
        fixture_id: fixture.id,
        source_sha256,
        profile_ref: reference_profile_ref(),
        post_film_domain: "acescg_linear_v1",
        max_abs,
        rmse,
        neutral_axis_drift,
        monotonic_violation_count,
        negative_component_count,
        high_component_count,
        deterministic_hash,
        samples,
        passed: failures.is_empty(),
        failures,
    })
}

fn grain_frame_context(width: u32, height: u32, origin: [u32; 2]) -> FilmFrameContextV1 {
    FilmFrameContextV1 {
        source_identity: "film-validation.synthetic-uniform.v1".to_string(),
        source_dimensions: [width, height],
        full_resolution_origin: origin,
        render_scale_milli: 1000,
        quality: "settled_preview_v1".to_string(),
        deterministic_seed_inputs: "film-validation:reference-profile:seed-v1".to_string(),
        revision: "film-validation-stochastic-v1".to_string(),
    }
}

fn render_grain_frame(
    value: f32,
    width: u32,
    height: u32,
    origin: [u32; 2],
    grain_amount: f32,
) -> Result<Rgb32FImage, &'static str> {
    let source = ImageBuffer::from_pixel(width, height, image::Rgb([value; 3]));
    let plan = FilmExecutionPlanV1::reference(
        REFERENCE_PROFILE_CONTENT_SHA256,
        REFERENCE_PROFILE_CONTENT_SHA256,
    );
    execute_cpu(
        &source,
        FilmEmulationParams {
            enabled: true,
            mix: 1.0,
            shaper_p: REFERENCE_SHAPER_P,
            grain_amount,
        },
        &plan,
        &grain_frame_context(width, height, origin),
    )
    .map(|(image, _)| image)
}

fn hash_f32_image(image: &Rgb32FImage) -> String {
    let mut hasher = Sha256::new();
    for pixel in image.pixels() {
        for channel in pixel.0 {
            hasher.update(channel.to_le_bytes());
        }
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn residual_field(grained: &Rgb32FImage, baseline: &Rgb32FImage) -> Vec<[f32; 3]> {
    grained
        .pixels()
        .zip(baseline.pixels())
        .map(|(grain, base)| {
            [
                grain.0[0] - base.0[0],
                grain.0[1] - base.0[1],
                grain.0[2] - base.0[2],
            ]
        })
        .collect()
}

fn mean_and_variance(field: &[[f32; 3]]) -> ([f32; 3], [f32; 3]) {
    let count = field.len() as f32;
    let mut mean = [0.0_f32; 3];
    for sample in field {
        for channel in 0..3 {
            mean[channel] += sample[channel] / count;
        }
    }
    let mut variance = [0.0_f32; 3];
    for sample in field {
        for channel in 0..3 {
            let delta = sample[channel] - mean[channel];
            variance[channel] += delta * delta / count;
        }
    }
    (mean, variance)
}

fn grain_correlations(
    field: &[[f32; 3]],
    width: usize,
    mean: [f32; 3],
    variance: [f32; 3],
) -> ([f32; 3], [f32; 3], [f32; 3]) {
    let pairs = [(0_usize, 1_usize), (0, 2), (1, 2)];
    let mut channel = [0.0_f32; 3];
    for (index, (left, right)) in pairs.into_iter().enumerate() {
        let covariance = field
            .iter()
            .map(|sample| (sample[left] - mean[left]) * (sample[right] - mean[right]))
            .sum::<f32>()
            / field.len() as f32;
        channel[index] = covariance / (variance[left] * variance[right]).sqrt().max(1.0e-12);
    }

    let mut adjacent = [0.0_f32; 3];
    let mut frequency = [0.0_f32; 3];
    let mut adjacent_count = 0_usize;
    for (index, sample) in field.iter().enumerate() {
        if index % width + 1 >= width {
            continue;
        }
        let neighbor = field[index + 1];
        adjacent_count += 1;
        for channel_index in 0..3 {
            adjacent[channel_index] += (sample[channel_index] - mean[channel_index])
                * (neighbor[channel_index] - mean[channel_index]);
            let difference = sample[channel_index] - neighbor[channel_index];
            frequency[channel_index] += difference * difference;
        }
    }
    for channel_index in 0..3 {
        adjacent[channel_index] /= (adjacent_count as f32 * variance[channel_index]).max(1.0e-12);
        frequency[channel_index] /=
            (2.0 * adjacent_count as f32 * variance[channel_index]).max(1.0e-12);
    }
    (channel, adjacent, frequency)
}

fn weighted_radius(radii: &[f32], weights: &[f32]) -> f32 {
    radii
        .iter()
        .zip(weights)
        .map(|(radius, weight)| radius * weight)
        .sum::<f32>()
        / weights.iter().sum::<f32>().max(1.0e-12)
}

fn max_abs(vector: Vec3) -> f32 {
    vector.abs().max_element()
}

fn run_reference_stochastic_optical_gate(
    fixture_json: &str,
    vector_bytes: &[u8],
) -> Result<FilmNativeStochasticOpticalReportV1, &'static str> {
    let fixture: FilmValidationFixtureV1 =
        serde_json::from_str(fixture_json).map_err(|_| "film_validation_manifest_invalid")?;
    let vectors: FilmAnalyticVectorSetV1 =
        serde_json::from_slice(vector_bytes).map_err(|_| "film_validation_vectors_invalid")?;
    validate_governance(&fixture, &vectors, vector_bytes)?;

    const SIZE: u32 = 64;
    const GRAIN_AMOUNT: f32 = 0.8;
    let baseline = render_grain_frame(0.18, SIZE, SIZE, [0, 0], 0.0)?;
    let grained = render_grain_frame(0.18, SIZE, SIZE, [0, 0], GRAIN_AMOUNT)?;
    let repeat = render_grain_frame(0.18, SIZE, SIZE, [0, 0], GRAIN_AMOUNT)?;
    let deterministic_hash = hash_f32_image(&grained);
    let repeat_hash = hash_f32_image(&repeat);
    let field = residual_field(&grained, &baseline);
    let (mean_residual, variance_by_channel) = mean_and_variance(&field);
    let (channel_correlation, adjacent_correlation, frequency_energy_ratio) =
        grain_correlations(&field, SIZE as usize, mean_residual, variance_by_channel);

    let mut density_variance = [0.0_f32; 3];
    for (index, value) in [0.05_f32, 0.18, 0.5].into_iter().enumerate() {
        let density_baseline = render_grain_frame(value, SIZE, SIZE, [0, 0], 0.0)?;
        let density_grained = render_grain_frame(value, SIZE, SIZE, [0, 0], GRAIN_AMOUNT)?;
        let (_, variance) = mean_and_variance(&residual_field(&density_grained, &density_baseline));
        density_variance[index] = variance.iter().sum::<f32>() / 3.0;
    }

    let tile_baseline = render_grain_frame(0.18, SIZE / 2, SIZE, [SIZE / 2, 0], 0.0)?;
    let tile_grained = render_grain_frame(0.18, SIZE / 2, SIZE, [SIZE / 2, 0], GRAIN_AMOUNT)?;
    let tile_field = residual_field(&tile_grained, &tile_baseline);
    let mut tile_max_abs = 0.0_f32;
    for y in 0..SIZE as usize {
        for x in 0..(SIZE / 2) as usize {
            let full = field[y * SIZE as usize + x + (SIZE / 2) as usize];
            let tile = tile_field[y * (SIZE / 2) as usize + x];
            for channel in 0..3 {
                tile_max_abs = tile_max_abs.max((full[channel] - tile[channel]).abs());
            }
        }
    }
    let grain = FilmNativeGrainReportV1 {
        deterministic_hash,
        repeat_hash,
        mean_residual,
        variance_by_channel,
        density_variance,
        channel_correlation,
        adjacent_correlation,
        frequency_energy_ratio,
        tile_max_abs,
    };

    let optical_profile = reference_optical_scatter();
    optical_profile.validate()?;
    let highlight = Vec3::splat(20.0);
    let blur = Vec3::splat(5.0);
    let mut bypass_profile = optical_profile.clone();
    bypass_profile.halation.amount_default = 0.0;
    if let Some(bloom) = &mut bypass_profile.bloom {
        bloom.amount_default = 0.0;
    }
    let bypass_max_abs =
        max_abs(apply_optical_scatter(highlight, blur, blur, &bypass_profile) - highlight);
    let subthreshold = Vec3::splat(0.18);
    let subthreshold_leakage = max_abs(
        apply_optical_scatter(subthreshold, highlight, highlight, &optical_profile) - subthreshold,
    );

    let mut halation_profile = optical_profile.clone();
    if let Some(bloom) = &mut halation_profile.bloom {
        bloom.amount_default = 0.0;
    }
    let halation_delta =
        apply_optical_scatter(highlight, blur, Vec3::ZERO, &halation_profile) - highlight;
    let halation_energy = AP1_LUMINANCE.dot(halation_delta);
    let halation_red_ratio = halation_delta.x / halation_delta.y.max(halation_delta.z).max(1.0e-12);

    let mut bloom_profile = optical_profile.clone();
    bloom_profile.halation.amount_default = 0.0;
    let bloom_delta =
        apply_optical_scatter(highlight, Vec3::ZERO, blur, &bloom_profile) - highlight;
    let bloom_energy = AP1_LUMINANCE.dot(bloom_delta);
    let bloom_neutral_drift = bloom_delta.max_element() - bloom_delta.min_element();
    let halation_weighted_radius_px = weighted_radius(
        &optical_profile.halation.radii_px_full_res,
        &optical_profile.halation.weights,
    );
    let bloom = optical_profile
        .bloom
        .as_ref()
        .ok_or("film_optical_scatter_missing_bloom")?;
    let bloom_weighted_radius_px = weighted_radius(&bloom.radii_px_full_res, &bloom.weights);

    let mut continuity_max_step = 0.0_f32;
    let mut previous_energy: Option<f32> = None;
    for index in 0..=16 {
        let exposure_ev = 0.5 + index as f32 * 0.25;
        let source_luma = 0.18 * 2.0_f32.powf(exposure_ev);
        let source = Vec3::splat(source_luma);
        let output = apply_optical_scatter(source, Vec3::ONE, Vec3::ONE, &optical_profile);
        let normalized_energy = AP1_LUMINANCE.dot(output - source) / source_luma;
        if let Some(previous) = previous_energy {
            continuity_max_step = continuity_max_step.max((normalized_energy - previous).abs());
        }
        previous_energy = Some(normalized_energy);
    }
    let optical = FilmNativeOpticalReportV1 {
        supported_subset: "preblurred_scatter_kernel_v1",
        bypass_max_abs,
        subthreshold_leakage,
        halation_energy,
        bloom_energy,
        halation_red_ratio,
        bloom_neutral_drift,
        halation_weighted_radius_px,
        bloom_weighted_radius_px,
        continuity_max_step,
    };

    let thresholds = &fixture.thresholds;
    let mut failures = Vec::new();
    if grain.deterministic_hash != grain.repeat_hash {
        failures.push("grain_repeat_hash_mismatch".to_string());
    }
    if grain.tile_max_abs > thresholds.grain_repeat_tolerance {
        failures.push("grain_tile_continuity_failed".to_string());
    }
    if grain
        .mean_residual
        .iter()
        .any(|value| value.abs() > thresholds.grain_mean_drift)
    {
        failures.push("grain_mean_drift_failed".to_string());
    }
    if grain.variance_by_channel.iter().any(|value| {
        *value < thresholds.grain_variance_min || *value > thresholds.grain_variance_max
    }) {
        failures.push("grain_variance_bounds_failed".to_string());
    }
    if grain
        .channel_correlation
        .iter()
        .chain(grain.adjacent_correlation.iter())
        .any(|value| {
            *value < thresholds.grain_correlation_min || *value > thresholds.grain_correlation_max
        })
    {
        failures.push("grain_correlation_bounds_failed".to_string());
    }
    if grain.frequency_energy_ratio.iter().any(|value| {
        *value < thresholds.grain_frequency_energy_min
            || *value > thresholds.grain_frequency_energy_max
    }) {
        failures.push("grain_frequency_energy_failed".to_string());
    }
    let density_min = grain
        .density_variance
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let density_max = grain
        .density_variance
        .iter()
        .copied()
        .fold(0.0_f32, f32::max);
    if density_max / density_min.max(1.0e-12) < thresholds.grain_density_variance_ratio_min {
        failures.push("grain_density_selectivity_failed".to_string());
    }
    if optical.bypass_max_abs > thresholds.grain_repeat_tolerance {
        failures.push("optical_bypass_failed".to_string());
    }
    if optical.subthreshold_leakage > thresholds.optical_leakage {
        failures.push("optical_subthreshold_leakage_failed".to_string());
    }
    if optical.halation_energy <= 0.0
        || optical.bloom_energy <= 0.0
        || optical.halation_energy > thresholds.optical_energy_max
        || optical.bloom_energy > thresholds.optical_energy_max
    {
        failures.push("optical_energy_bounds_failed".to_string());
    }
    if optical.halation_red_ratio < thresholds.optical_halation_red_ratio_min {
        failures.push("optical_halation_selectivity_failed".to_string());
    }
    if optical.bloom_neutral_drift > thresholds.optical_bloom_neutral_drift {
        failures.push("optical_bloom_neutrality_failed".to_string());
    }
    if optical.halation_weighted_radius_px <= optical_profile.halation.core_radius_px_full_res
        || optical.bloom_weighted_radius_px <= optical.halation_weighted_radius_px
    {
        failures.push("optical_radius_support_failed".to_string());
    }
    if optical.continuity_max_step > thresholds.optical_continuity_max_step {
        failures.push("optical_continuity_failed".to_string());
    }

    Ok(FilmNativeStochasticOpticalReportV1 {
        contract: "rapidraw.film_native_stochastic_optical_report.v1",
        fixture_id: fixture.id,
        source_sha256: fixture.source.sha256,
        profile_ref: reference_profile_ref(),
        post_film_domain: "acescg_linear_v1",
        grain,
        optical,
        passed: failures.is_empty(),
        failures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = include_str!(
        "../../../fixtures/film/validation/reference-film-validation-manifest-v1.json"
    );
    const VECTORS: &[u8] =
        include_bytes!("../../../fixtures/film/validation/reference-film-analytic-v1.json");

    #[test]
    fn accepts_finite_metrics_and_preserves_out_of_gamut_counts() {
        let metrics = FilmValidationMetricsV1 {
            max_abs: 0.0001,
            rmse: 0.00002,
            neutral_axis_drift: 0.00001,
            negative_component_count: 2,
            high_component_count: 3,
        };
        assert_eq!(validate_metrics(&metrics), Ok(()));
        assert_eq!(metrics.negative_component_count, 2);
        assert_eq!(metrics.high_component_count, 3);
    }

    #[test]
    fn rejects_non_finite_or_unbounded_metrics() {
        let mut metrics = FilmValidationMetricsV1 {
            max_abs: 0.0001,
            rmse: 0.00002,
            neutral_axis_drift: 0.00001,
            negative_component_count: 0,
            high_component_count: 0,
        };
        metrics.max_abs = f32::NAN;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_validation_non_finite_metrics")
        );
        metrics.max_abs = 0.2;
        assert_eq!(
            validate_metrics(&metrics),
            Err("film_validation_metric_ceiling_failed")
        );
    }

    #[test]
    fn reference_profile_release_gate() {
        let report = run_reference_analytic_gate(MANIFEST, VECTORS)
            .expect("governed Film gate must execute");
        let repeat =
            run_reference_analytic_gate(MANIFEST, VECTORS).expect("governed Film gate must repeat");
        assert!(report.passed, "Film gate failures: {:?}", report.failures);
        assert_eq!(report.max_abs, 0.0);
        assert_eq!(report.rmse, 0.0);
        assert_eq!(report.monotonic_violation_count, 0);
        assert!(report.negative_component_count > 0);
        assert!(report.high_component_count > 0);
        assert_eq!(report.deterministic_hash, repeat.deterministic_hash);
        println!(
            "FILM_NATIVE_ANALYTIC_REPORT={}",
            serde_json::to_string(&report).expect("report serialization")
        );
    }

    #[test]
    fn reference_profile_release_gate_fails_closed_on_source_hash_drift() {
        let mut tampered = VECTORS.to_vec();
        tampered.push(b' ');
        assert_eq!(
            run_reference_analytic_gate(MANIFEST, &tampered).map(|_| ()),
            Err("film_validation_governance_invalid")
        );
    }

    #[test]
    fn reference_profile_release_gate_stochastic_optical() {
        let report = run_reference_stochastic_optical_gate(MANIFEST, VECTORS)
            .expect("governed stochastic/optical gate must execute");
        println!(
            "FILM_NATIVE_STOCHASTIC_OPTICAL_REPORT={}",
            serde_json::to_string(&report).expect("report serialization")
        );
        assert!(report.passed, "Film gate failures: {:?}", report.failures);
        assert_eq!(report.grain.deterministic_hash, report.grain.repeat_hash);
        assert_eq!(report.grain.tile_max_abs, 0.0);
        assert!(
            report
                .grain
                .variance_by_channel
                .iter()
                .all(|value| *value > 0.0)
        );
        assert!(report.optical.halation_energy > report.optical.bloom_energy);
        assert!(report.optical.halation_red_ratio > 1.0);
    }

    #[test]
    fn reference_profile_release_gate_stochastic_optical_fails_closed_on_policy() {
        let mut manifest: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
        manifest["thresholds"]["grainVarianceMin"] = serde_json::json!(0.000000000001);
        manifest["thresholds"]["grainVarianceMax"] = serde_json::json!(0.000000001);
        let report = run_reference_stochastic_optical_gate(
            &serde_json::to_string(&manifest).unwrap(),
            VECTORS,
        )
        .expect("tightened policy still produces a report");
        assert!(!report.passed);
        assert!(
            report
                .failures
                .contains(&"grain_variance_bounds_failed".to_string())
        );
    }
}
