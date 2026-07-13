//! Executable typed stage-vector harness for the independent f64 oracle.

use sha2::{Digest, Sha256};

use crate::{
    ReferenceError,
    difference::{delta_e_2000, delta_e_itp},
    matrix::LinearRgbToXyzMatrix,
    transfer::{decode_srgb, encode_srgb, hlg_inverse_oetf, hlg_oetf, pq_eotf, pq_inverse_eotf},
    types::{
        AbsoluteLuminanceNits, CieLab, EncodedSrgb, HlgSignal, ICtCp, LinearRgb, PqSignal,
        SceneLinearHlg,
    },
};

pub const STAGE_HARNESS_CONTRACT_ID: &str = "rapidraw.color-reference.stage-harness.v1";
pub const REFERENCE_IMPLEMENTATION_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StageImplementation {
    ReferenceF64,
    /// Identifies a production/candidate result. The reference executor rejects it.
    ProductionCandidate,
}

impl StageImplementation {
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::ReferenceF64 => "rapidraw.reference-f64",
            Self::ProductionCandidate => "rapidraw.production-candidate",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StageDomain {
    EncodedSrgb,
    LinearSrgb,
    LinearAcesCgD60,
    CieXyzD60,
    PqSignal,
    AbsoluteLuminanceNits,
    HlgSignal,
    HlgSceneLinear,
    CieLabPair,
    ICtCpPair,
    ScalarMetric,
    LinearRec2100Absolute,
    ICtCp,
    CieXyzD50,
    CieLab,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReferenceOperation {
    DecodeSrgbV1,
    EncodeSrgbV1,
    AcesCgToXyzD60V1,
    PqEotfV1,
    PqInverseEotfV1,
    HlgOetfV1,
    HlgInverseOetfV1,
    DeltaE2000V1,
    DeltaEItpV1,
    Rec2100NitsToICtCpV1,
    XyzD50ToLabV1,
    LabToXyzD50V1,
}

impl ReferenceOperation {
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::DecodeSrgbV1 => "decode-srgb.v1",
            Self::EncodeSrgbV1 => "encode-srgb.v1",
            Self::AcesCgToXyzD60V1 => "acescg-to-xyz-d60.v1",
            Self::PqEotfV1 => "pq-eotf.v1",
            Self::PqInverseEotfV1 => "pq-inverse-eotf.v1",
            Self::HlgOetfV1 => "hlg-oetf.v1",
            Self::HlgInverseOetfV1 => "hlg-inverse-oetf.v1",
            Self::DeltaE2000V1 => "delta-e-2000.v1",
            Self::DeltaEItpV1 => "delta-e-itp.v1",
            Self::Rec2100NitsToICtCpV1 => "rec2100-nits-to-ictcp.v1",
            Self::XyzD50ToLabV1 => "xyz-d50-to-lab.v1",
            Self::LabToXyzD50V1 => "lab-to-xyz-d50.v1",
        }
    }

    #[must_use]
    pub const fn domains(self) -> (StageDomain, StageDomain) {
        match self {
            Self::DecodeSrgbV1 => (StageDomain::EncodedSrgb, StageDomain::LinearSrgb),
            Self::EncodeSrgbV1 => (StageDomain::LinearSrgb, StageDomain::EncodedSrgb),
            Self::AcesCgToXyzD60V1 => (StageDomain::LinearAcesCgD60, StageDomain::CieXyzD60),
            Self::PqEotfV1 => (StageDomain::PqSignal, StageDomain::AbsoluteLuminanceNits),
            Self::PqInverseEotfV1 => (StageDomain::AbsoluteLuminanceNits, StageDomain::PqSignal),
            Self::HlgOetfV1 => (StageDomain::HlgSceneLinear, StageDomain::HlgSignal),
            Self::HlgInverseOetfV1 => (StageDomain::HlgSignal, StageDomain::HlgSceneLinear),
            Self::DeltaE2000V1 => (StageDomain::CieLabPair, StageDomain::ScalarMetric),
            Self::DeltaEItpV1 => (StageDomain::ICtCpPair, StageDomain::ScalarMetric),
            Self::Rec2100NitsToICtCpV1 => (StageDomain::LinearRec2100Absolute, StageDomain::ICtCp),
            Self::XyzD50ToLabV1 => (StageDomain::CieXyzD50, StageDomain::CieLab),
            Self::LabToXyzD50V1 => (StageDomain::CieLab, StageDomain::CieXyzD50),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StageSample {
    Rgb([f64; 3]),
    Scalar(f64),
    LabPair(CieLab, CieLab),
    ICtCpPair(ICtCp, ICtCp),
    ICtCp(ICtCp),
    Lab(CieLab),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StageSampleKind {
    Rgb,
    Scalar,
    LabPair,
    ICtCpPair,
    ICtCp,
    Lab,
}

impl StageSample {
    const fn kind(self) -> StageSampleKind {
        match self {
            Self::Rgb(_) => StageSampleKind::Rgb,
            Self::Scalar(_) => StageSampleKind::Scalar,
            Self::LabPair(_, _) => StageSampleKind::LabPair,
            Self::ICtCpPair(_, _) => StageSampleKind::ICtCpPair,
            Self::ICtCp(_) => StageSampleKind::ICtCp,
            Self::Lab(_) => StageSampleKind::Lab,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct StageVectorRequest {
    pub operation: ReferenceOperation,
    pub implementation: StageImplementation,
    pub implementation_version: u32,
    pub input_domain: StageDomain,
    pub output_domain: StageDomain,
    pub samples: Vec<StageSample>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StageContentHash([u8; 32]);

impl StageContentHash {
    #[must_use]
    pub fn to_hex(self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StageDiagnostics {
    pub negative_input_components: usize,
    pub over_range_input_components: usize,
    pub negative_output_components: usize,
    pub over_range_output_components: usize,
    pub clamps_applied: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StageVectorReceipt {
    pub contract_id: &'static str,
    pub operation_id: &'static str,
    pub implementation_id: &'static str,
    pub implementation_version: u32,
    pub input_domain: StageDomain,
    pub output_domain: StageDomain,
    pub input_hash: StageContentHash,
    pub output_hash: StageContentHash,
    pub sample_count: usize,
    pub diagnostics: StageDiagnostics,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StageVectorResult {
    pub output: Vec<StageSample>,
    pub receipt: StageVectorReceipt,
}

pub fn execute_reference_stage(
    request: &StageVectorRequest,
) -> Result<StageVectorResult, ReferenceError> {
    validate_request(request)?;
    let output: Result<Vec<_>, _> = request
        .samples
        .iter()
        .copied()
        .map(|sample| dispatch(request.operation, sample))
        .collect();
    let output = output?;
    let input_components = scalar_components(&request.samples);
    let output_components = scalar_components(&output);
    let diagnostics = StageDiagnostics {
        negative_input_components: input_components
            .iter()
            .filter(|&&value| value < 0.0)
            .count(),
        over_range_input_components: input_components
            .iter()
            .filter(|&&value| value > 1.0)
            .count(),
        negative_output_components: output_components
            .iter()
            .filter(|&&value| value < 0.0)
            .count(),
        over_range_output_components: output_components
            .iter()
            .filter(|&&value| value > 1.0)
            .count(),
        clamps_applied: 0,
    };
    Ok(StageVectorResult {
        receipt: StageVectorReceipt {
            contract_id: STAGE_HARNESS_CONTRACT_ID,
            operation_id: request.operation.id(),
            implementation_id: request.implementation.id(),
            implementation_version: request.implementation_version,
            input_domain: request.input_domain,
            output_domain: request.output_domain,
            input_hash: hash_samples(request.operation, request.input_domain, &request.samples),
            output_hash: hash_samples(request.operation, request.output_domain, &output),
            sample_count: output.len(),
            diagnostics,
        },
        output,
    })
}

pub fn execute_reference_batch(
    requests: &[StageVectorRequest],
) -> Result<Vec<StageVectorResult>, ReferenceError> {
    if requests.is_empty() {
        return Err(ReferenceError::EmptyBatch);
    }
    requests.iter().map(execute_reference_stage).collect()
}

pub fn execute_reference_pipeline(
    requests: &[StageVectorRequest],
) -> Result<Vec<StageVectorResult>, ReferenceError> {
    if requests.is_empty() {
        return Err(ReferenceError::EmptyBatch);
    }
    for pair in requests.windows(2) {
        if pair[0].output_domain != pair[1].input_domain {
            return Err(ReferenceError::StageDomainMismatch);
        }
    }
    execute_reference_batch(requests)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StageComparisonDiagnostics {
    pub mismatched_components: usize,
    pub maximum_absolute_error: f64,
    pub premature_clamp_components: usize,
}

pub fn compare_stage_outputs(
    reference: &[StageSample],
    candidate: &[StageSample],
    absolute_tolerance: f64,
) -> Result<StageComparisonDiagnostics, ReferenceError> {
    if !absolute_tolerance.is_finite() || absolute_tolerance < 0.0 {
        return Err(ReferenceError::InvalidMetricCondition);
    }
    if reference.len() != candidate.len() {
        return Err(ReferenceError::MismatchedOutputLength);
    }
    if reference
        .iter()
        .zip(candidate)
        .any(|(expected, actual)| expected.kind() != actual.kind())
    {
        return Err(ReferenceError::MismatchedSampleKind);
    }
    let reference = scalar_components(reference);
    let candidate = scalar_components(candidate);
    let mut result = StageComparisonDiagnostics {
        mismatched_components: 0,
        maximum_absolute_error: 0.0,
        premature_clamp_components: 0,
    };
    for (&expected, actual) in reference.iter().zip(candidate) {
        let error = (expected - actual).abs();
        result.maximum_absolute_error = result.maximum_absolute_error.max(error);
        result.mismatched_components += usize::from(error > absolute_tolerance);
        result.premature_clamp_components +=
            usize::from((expected < 0.0 && actual == 0.0) || (expected > 1.0 && actual == 1.0));
    }
    Ok(result)
}

fn validate_request(request: &StageVectorRequest) -> Result<(), ReferenceError> {
    if request.implementation != StageImplementation::ReferenceF64 {
        return Err(ReferenceError::UnsupportedImplementation);
    }
    if request.implementation_version != REFERENCE_IMPLEMENTATION_VERSION {
        return Err(ReferenceError::UnsupportedVersion);
    }
    let (input, output) = request.operation.domains();
    if request.input_domain != input || request.output_domain != output {
        return Err(ReferenceError::StageDomainMismatch);
    }
    if request.samples.is_empty() {
        return Err(ReferenceError::InsufficientSamples);
    }
    Ok(())
}

fn dispatch(
    operation: ReferenceOperation,
    sample: StageSample,
) -> Result<StageSample, ReferenceError> {
    match (operation, sample) {
        (ReferenceOperation::DecodeSrgbV1, StageSample::Rgb(rgb)) => {
            let decoded = decode_srgb(EncodedSrgb::new(rgb[0], rgb[1], rgb[2])?)?;
            Ok(StageSample::Rgb(decoded.components()))
        }
        (ReferenceOperation::EncodeSrgbV1, StageSample::Rgb(rgb)) => {
            let encoded = encode_srgb(LinearRgb::new(rgb[0], rgb[1], rgb[2])?)?;
            Ok(StageSample::Rgb([encoded.red, encoded.green, encoded.blue]))
        }
        (ReferenceOperation::AcesCgToXyzD60V1, StageSample::Rgb(rgb)) => {
            let matrix = LinearRgbToXyzMatrix::new([
                [0.662_454_181_1, 0.134_004_206_5, 0.156_187_687_0],
                [0.272_228_716_8, 0.674_081_765_8, 0.053_689_517_4],
                [-0.005_574_649_5, 0.004_060_733_5, 1.010_339_100_3],
            ])?;
            let xyz = matrix.transform(LinearRgb::new(rgb[0], rgb[1], rgb[2])?)?;
            Ok(StageSample::Rgb(xyz.components()))
        }
        (ReferenceOperation::PqEotfV1, StageSample::Scalar(value)) => {
            Ok(StageSample::Scalar(pq_eotf(PqSignal::new(value)?)?.value()))
        }
        (ReferenceOperation::PqInverseEotfV1, StageSample::Scalar(value)) => Ok(
            StageSample::Scalar(pq_inverse_eotf(AbsoluteLuminanceNits::new(value)?)?.value()),
        ),
        (ReferenceOperation::HlgOetfV1, StageSample::Scalar(value)) => Ok(StageSample::Scalar(
            hlg_oetf(SceneLinearHlg::new(value)?)?.value(),
        )),
        (ReferenceOperation::HlgInverseOetfV1, StageSample::Scalar(value)) => Ok(
            StageSample::Scalar(hlg_inverse_oetf(HlgSignal::new(value)?)?.value()),
        ),
        (ReferenceOperation::DeltaE2000V1, StageSample::LabPair(left, right)) => {
            Ok(StageSample::Scalar(delta_e_2000(left, right)))
        }
        (ReferenceOperation::DeltaEItpV1, StageSample::ICtCpPair(left, right)) => {
            Ok(StageSample::Scalar(delta_e_itp(left, right)?.value()))
        }
        (ReferenceOperation::Rec2100NitsToICtCpV1, StageSample::Rgb(rgb)) => Ok(
            StageSample::ICtCp(crate::hdr::rec2100_linear_nits_to_ictcp(rgb)?),
        ),
        (ReferenceOperation::XyzD50ToLabV1, StageSample::Rgb(xyz)) => {
            let white = crate::types::WhitePointXyz::new(0.96422, 1.0, 0.82521)?;
            let xyz = crate::types::CieXyz::new(xyz[0], xyz[1], xyz[2])?;
            Ok(StageSample::Lab(crate::perceptual::xyz_to_lab(xyz, white)?))
        }
        (ReferenceOperation::LabToXyzD50V1, StageSample::Lab(lab)) => {
            let white = crate::types::WhitePointXyz::new(0.96422, 1.0, 0.82521)?;
            Ok(StageSample::Rgb(
                crate::perceptual::lab_to_xyz(lab, white)?.components(),
            ))
        }
        _ => Err(ReferenceError::MismatchedSampleKind),
    }
}

fn scalar_components(samples: &[StageSample]) -> Vec<f64> {
    let mut values = Vec::new();
    for sample in samples {
        match sample {
            StageSample::Rgb(rgb) => values.extend(rgb),
            StageSample::Scalar(value) => values.push(*value),
            StageSample::LabPair(left, right) => values.extend([
                left.lightness,
                left.a,
                left.b,
                right.lightness,
                right.a,
                right.b,
            ]),
            StageSample::ICtCpPair(left, right) => values.extend([
                left.intensity,
                left.tritan,
                left.protan,
                right.intensity,
                right.tritan,
                right.protan,
            ]),
            StageSample::ICtCp(value) => {
                values.extend([value.intensity, value.tritan, value.protan]);
            }
            StageSample::Lab(value) => values.extend([value.lightness, value.a, value.b]),
        }
    }
    values
}

fn hash_samples(
    operation: ReferenceOperation,
    domain: StageDomain,
    samples: &[StageSample],
) -> StageContentHash {
    let mut hash = Sha256::new();
    hash.update(STAGE_HARNESS_CONTRACT_ID.as_bytes());
    hash.update(operation.id().as_bytes());
    hash.update([domain as u8]);
    hash.update((samples.len() as u64).to_le_bytes());
    for sample in samples {
        hash.update([sample.kind() as u8]);
        for value in scalar_components(std::slice::from_ref(sample)) {
            hash.update(value.to_bits().to_le_bytes());
        }
    }
    StageContentHash(hash.finalize().into())
}
