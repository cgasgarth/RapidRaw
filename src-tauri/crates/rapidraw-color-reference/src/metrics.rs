//! Versioned scalar quality metrics over explicit reference conditions.

use crate::{
    ReferenceError, finite,
    types::{CieLab, WhitePointXyz},
};

pub const TONE_METRICS_CONTRACT_ID: &str = "rapidraw.color-reference.metrics.tone.v1";
pub const COLOR_METRICS_CONTRACT_ID: &str = "rapidraw.color-reference.metrics.color.v1";
pub const GAMUT_METRICS_CONTRACT_ID: &str = "rapidraw.color-reference.metrics.gamut.v1";
pub const DETAIL_METRICS_CONTRACT_ID: &str = "rapidraw.color-reference.metrics.detail.v1";

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ToneSample {
    pub input: f64,
    pub output: f64,
}

impl ToneSample {
    pub fn new(input: f64, output: f64) -> Result<Self, ReferenceError> {
        finite(&[input, output])?;
        Ok(Self { input, output })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ToneInputDomain {
    Normalized,
    ExposureValue,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ToneOutputDomain {
    Normalized,
    SceneLinear,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ToneMetricCondition {
    pub input_domain: ToneInputDomain,
    pub output_domain: ToneOutputDomain,
    pub monotonicity_epsilon: f64,
    pub derivative_jump_threshold: f64,
}

impl ToneMetricCondition {
    pub fn new(
        input_domain: ToneInputDomain,
        output_domain: ToneOutputDomain,
        monotonicity_epsilon: f64,
        derivative_jump_threshold: f64,
    ) -> Result<Self, ReferenceError> {
        finite(&[monotonicity_epsilon, derivative_jump_threshold])?;
        if monotonicity_epsilon < 0.0 || derivative_jump_threshold < 0.0 {
            return Err(ReferenceError::InvalidMetricCondition);
        }
        Ok(Self {
            input_domain,
            output_domain,
            monotonicity_epsilon,
            derivative_jump_threshold,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ToneCurveMetrics {
    pub monotonicity_violations: usize,
    pub maximum_negative_step: f64,
    pub derivative_discontinuities: usize,
    pub maximum_derivative_jump: f64,
}

pub fn measure_tone_curve(
    samples: &[ToneSample],
    condition: ToneMetricCondition,
) -> Result<ToneCurveMetrics, ReferenceError> {
    if samples.len() < 2 {
        return Err(ReferenceError::InsufficientSamples);
    }
    let mut monotonicity_violations = 0;
    let mut maximum_negative_step: f64 = 0.0;
    let mut slopes = Vec::with_capacity(samples.len() - 1);
    for pair in samples.windows(2) {
        let input_step = pair[1].input - pair[0].input;
        if input_step <= 0.0 {
            return Err(ReferenceError::NonIncreasingInput);
        }
        let output_step = pair[1].output - pair[0].output;
        if output_step < -condition.monotonicity_epsilon {
            monotonicity_violations += 1;
        }
        maximum_negative_step = maximum_negative_step.max(-output_step);
        slopes.push(output_step / input_step);
    }
    let derivative_jumps = slopes.windows(2).map(|pair| (pair[1] - pair[0]).abs());
    let (derivative_discontinuities, maximum_derivative_jump) =
        derivative_jumps.fold((0, 0.0_f64), |(count, maximum), jump| {
            (
                count + usize::from(jump > condition.derivative_jump_threshold),
                maximum.max(jump),
            )
        });
    Ok(ToneCurveMetrics {
        monotonicity_violations,
        maximum_negative_step,
        derivative_discontinuities,
        maximum_derivative_jump,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StandardObserver {
    Cie1931TwoDegree,
    Cie1964TenDegree,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LabReferenceCondition {
    pub white_point: WhitePointXyz,
    pub observer: StandardObserver,
    pub neutral_chroma_epsilon: f64,
}

impl LabReferenceCondition {
    pub fn new(
        white_point: WhitePointXyz,
        observer: StandardObserver,
        neutral_chroma_epsilon: f64,
    ) -> Result<Self, ReferenceError> {
        finite(&[neutral_chroma_epsilon])?;
        if neutral_chroma_epsilon < 0.0 {
            return Err(ReferenceError::InvalidMetricCondition);
        }
        Ok(Self {
            white_point,
            observer,
            neutral_chroma_epsilon,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PerceptualColorError {
    pub signed_hue_error_degrees: Option<f64>,
    pub signed_chroma_error: f64,
    pub signed_lightness_error: f64,
}

pub fn measure_perceptual_color_error(
    reference: CieLab,
    candidate: CieLab,
    condition: LabReferenceCondition,
) -> Result<PerceptualColorError, ReferenceError> {
    finite(&[
        reference.lightness,
        reference.a,
        reference.b,
        candidate.lightness,
        candidate.a,
        candidate.b,
    ])?;
    let reference_chroma = reference.a.hypot(reference.b);
    let candidate_chroma = candidate.a.hypot(candidate.b);
    let signed_hue_error_degrees = if reference_chroma <= condition.neutral_chroma_epsilon
        || candidate_chroma <= condition.neutral_chroma_epsilon
    {
        None
    } else {
        let reference_hue = reference.b.atan2(reference.a).to_degrees();
        let candidate_hue = candidate.b.atan2(candidate.a).to_degrees();
        Some((candidate_hue - reference_hue + 180.0).rem_euclid(360.0) - 180.0)
    };
    Ok(PerceptualColorError {
        signed_hue_error_degrees,
        signed_chroma_error: candidate_chroma - reference_chroma,
        signed_lightness_error: candidate.lightness - reference.lightness,
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GamutSample {
    pub source: CieLab,
    pub mapped: CieLab,
    pub target_max_chroma: f64,
}

impl GamutSample {
    pub fn new(
        source: CieLab,
        mapped: CieLab,
        target_max_chroma: f64,
    ) -> Result<Self, ReferenceError> {
        finite(&[target_max_chroma])?;
        if target_max_chroma < 0.0 {
            return Err(ReferenceError::InvalidMetricCondition);
        }
        Ok(Self {
            source,
            mapped,
            target_max_chroma,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GamutMetricCondition {
    pub containment_epsilon: f64,
    pub lab: LabReferenceCondition,
}

impl GamutMetricCondition {
    pub fn new(
        containment_epsilon: f64,
        lab: LabReferenceCondition,
    ) -> Result<Self, ReferenceError> {
        finite(&[containment_epsilon])?;
        if containment_epsilon < 0.0 {
            return Err(ReferenceError::InvalidMetricCondition);
        }
        Ok(Self {
            containment_epsilon,
            lab,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GamutSampleMetrics {
    pub contained: bool,
    pub chroma_excess: f64,
    pub compression_ratio: Option<f64>,
    pub signed_hue_deviation_degrees: Option<f64>,
}

pub fn measure_gamut_sample(
    sample: GamutSample,
    condition: GamutMetricCondition,
) -> Result<GamutSampleMetrics, ReferenceError> {
    let color_error = measure_perceptual_color_error(sample.source, sample.mapped, condition.lab)?;
    let source_chroma = sample.source.a.hypot(sample.source.b);
    let mapped_chroma = sample.mapped.a.hypot(sample.mapped.b);
    let chroma_excess = (mapped_chroma - sample.target_max_chroma).max(0.0);
    Ok(GamutSampleMetrics {
        contained: chroma_excess <= condition.containment_epsilon,
        chroma_excess,
        compression_ratio: (source_chroma > condition.lab.neutral_chroma_epsilon)
            .then_some(mapped_chroma / source_chroma),
        signed_hue_deviation_degrees: color_error.signed_hue_error_degrees,
    })
}

#[derive(Clone, Debug, PartialEq)]
pub enum DetailSignalDomain {
    LinearLight,
    Encoded,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DetailMetricCondition {
    pub domain: DetailSignalDomain,
    pub sample_spacing_pixels: f64,
    pub edge_index: usize,
    pub halo_radius: usize,
    pub ringing_epsilon: f64,
    pub tile_boundaries: Vec<usize>,
}

impl DetailMetricCondition {
    pub fn new(
        domain: DetailSignalDomain,
        sample_spacing_pixels: f64,
        edge_index: usize,
        halo_radius: usize,
        ringing_epsilon: f64,
        tile_boundaries: Vec<usize>,
    ) -> Result<Self, ReferenceError> {
        finite(&[sample_spacing_pixels, ringing_epsilon])?;
        if sample_spacing_pixels <= 0.0 || ringing_epsilon < 0.0 {
            return Err(ReferenceError::InvalidMetricCondition);
        }
        Ok(Self {
            domain,
            sample_spacing_pixels,
            edge_index,
            halo_radius,
            ringing_epsilon,
            tile_boundaries,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DetailSignalMetrics {
    pub overshoot: f64,
    pub undershoot: f64,
    pub halo_amplitude: f64,
    pub ringing_sign_changes: usize,
    pub maximum_tile_seam_error: f64,
}

pub fn measure_detail_signal(
    reference: &[f64],
    candidate: &[f64],
    condition: &DetailMetricCondition,
) -> Result<DetailSignalMetrics, ReferenceError> {
    if reference.len() != candidate.len() {
        return Err(ReferenceError::MismatchedSampleLength);
    }
    if reference.len() < 2 {
        return Err(ReferenceError::InsufficientSamples);
    }
    finite(reference)?;
    finite(candidate)?;
    if condition.edge_index >= reference.len()
        || condition
            .tile_boundaries
            .iter()
            .any(|&boundary| boundary == 0 || boundary >= reference.len())
    {
        return Err(ReferenceError::InvalidMetricCondition);
    }
    let reference_min = reference.iter().copied().fold(f64::INFINITY, f64::min);
    let reference_max = reference.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let candidate_min = candidate.iter().copied().fold(f64::INFINITY, f64::min);
    let candidate_max = candidate.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let errors: Vec<f64> = candidate
        .iter()
        .zip(reference)
        .map(|(actual, expected)| actual - expected)
        .collect();
    let start = condition.edge_index.saturating_sub(condition.halo_radius);
    let end = condition
        .edge_index
        .saturating_add(condition.halo_radius)
        .min(reference.len() - 1);
    let halo_errors = &errors[start..=end];
    let mut ringing_sign_changes = 0;
    let mut previous_sign = 0_i8;
    for &error in halo_errors {
        let sign = if error > condition.ringing_epsilon {
            1
        } else if error < -condition.ringing_epsilon {
            -1
        } else {
            0
        };
        if sign != 0 {
            if previous_sign != 0 && sign != previous_sign {
                ringing_sign_changes += 1;
            }
            previous_sign = sign;
        }
    }
    let maximum_tile_seam_error = condition
        .tile_boundaries
        .iter()
        .map(|&boundary| (errors[boundary] - errors[boundary - 1]).abs())
        .fold(0.0_f64, f64::max);
    Ok(DetailSignalMetrics {
        overshoot: (candidate_max - reference_max).max(0.0),
        undershoot: (reference_min - candidate_min).max(0.0),
        halo_amplitude: halo_errors
            .iter()
            .map(|error| error.abs())
            .fold(0.0_f64, f64::max),
        ringing_sign_changes,
        maximum_tile_seam_error,
    })
}
