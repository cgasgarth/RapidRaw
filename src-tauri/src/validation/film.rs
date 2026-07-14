//! Native trust-boundary and production-render checks for governed Film validation.

use crate::render::film_emulation::{
    AP1_LUMINANCE, FilmEmulationParams, FilmEmulationProfileRef, REFERENCE_PROFILE_CONTENT_SHA256,
    REFERENCE_PROFILE_ID, REFERENCE_PROFILE_VERSION, REFERENCE_SHAPER_P, apply_pixel,
};
use glam::Vec3;
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
    optical_leakage: f32,
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
            fixture.thresholds.optical_leakage,
        ]
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0)
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
}
