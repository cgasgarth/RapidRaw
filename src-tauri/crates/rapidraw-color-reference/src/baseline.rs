//! Executable, fail-closed governance for versioned color-quality baselines.

use std::{
    collections::BTreeMap,
    fmt, fs,
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};

pub const BASELINE_SCHEMA_VERSION: u32 = 1;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub enum BaselineError {
    MissingBaseline,
    CorruptManifest,
    UnsupportedSchema,
    InvalidField(&'static str),
    HardwareMismatch,
    BindingMismatch,
    PolicyMismatch,
    MeasurementShapeMismatch,
    CandidateFailed,
    Io(std::io::Error),
}

impl fmt::Display for BaselineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingBaseline => formatter.write_str("baseline is missing"),
            Self::CorruptManifest => {
                formatter.write_str("manifest is corrupt or its integrity hash is stale")
            }
            Self::UnsupportedSchema => {
                formatter.write_str("manifest schema version is unsupported")
            }
            Self::InvalidField(field) => write!(formatter, "manifest field is invalid: {field}"),
            Self::HardwareMismatch => {
                formatter.write_str("candidate hardware identity does not match baseline")
            }
            Self::BindingMismatch => formatter
                .write_str("candidate fixture or operation binding does not match baseline"),
            Self::PolicyMismatch => formatter
                .write_str("candidate metric conditions or tolerance policy do not match baseline"),
            Self::MeasurementShapeMismatch => {
                formatter.write_str("candidate measurement shape does not match baseline")
            }
            Self::CandidateFailed => formatter.write_str("failed candidate cannot be approved"),
            Self::Io(error) => write!(formatter, "baseline I/O failed: {error}"),
        }
    }
}

impl std::error::Error for BaselineError {}

impl From<std::io::Error> for BaselineError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionedContract {
    pub id: String,
    pub version: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HardwareIdentity {
    pub backend: String,
    pub vendor: String,
    pub device: String,
    pub driver: String,
}

impl HardwareIdentity {
    #[must_use]
    pub fn fingerprint(&self) -> String {
        hash_serializable(self).expect("hardware identity strings are serializable")
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MetricConditions {
    pub id: String,
    pub parameters: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TolerancePolicy {
    pub absolute_tolerance: f64,
    pub maximum_mismatched_components: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaselineBinding {
    pub fixture_hash: String,
    pub graph_fingerprint: String,
    pub operation_fingerprint: String,
    pub reference: VersionedContract,
    pub metric: VersionedContract,
    pub metric_conditions: MetricConditions,
    pub hardware: HardwareIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalRecord {
    pub reviewer: String,
    pub issue: String,
    pub reason: String,
    pub approved_unix_millis: u128,
    pub prior_baseline_hash: String,
    pub candidate_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaselineManifest {
    pub schema_version: u32,
    pub binding: BaselineBinding,
    pub tolerance: TolerancePolicy,
    pub expected_values: Vec<f64>,
    pub approvals: Vec<ApprovalRecord>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CandidateManifest {
    pub schema_version: u32,
    pub binding: BaselineBinding,
    pub tolerance: TolerancePolicy,
    pub observed_values: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovalMetadata {
    pub reviewer: String,
    pub issue: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ComparisonReport {
    pub passed: bool,
    pub mismatched_components: usize,
    pub maximum_absolute_error: f64,
    pub absolute_tolerance: f64,
    pub maximum_mismatched_components: usize,
    pub explanation: String,
}

#[derive(Serialize, Deserialize)]
struct IntegrityEnvelope {
    payload_json: String,
    integrity_sha256: String,
}

pub fn compare(
    baseline: &BaselineManifest,
    candidate: &CandidateManifest,
) -> Result<ComparisonReport, BaselineError> {
    validate_baseline(baseline)?;
    validate_candidate(candidate)?;
    validate_compatibility(baseline, candidate)?;
    if baseline.expected_values.len() != candidate.observed_values.len() {
        return Err(BaselineError::MeasurementShapeMismatch);
    }
    let mut mismatched_components = 0;
    let mut maximum_absolute_error = 0.0_f64;
    for (&expected, &actual) in baseline
        .expected_values
        .iter()
        .zip(&candidate.observed_values)
    {
        let error = (expected - actual).abs();
        maximum_absolute_error = maximum_absolute_error.max(error);
        mismatched_components += usize::from(error > baseline.tolerance.absolute_tolerance);
    }
    let passed = mismatched_components <= baseline.tolerance.maximum_mismatched_components;
    let status = if passed { "passed" } else { "failed" };
    Ok(ComparisonReport {
        passed,
        mismatched_components,
        maximum_absolute_error,
        absolute_tolerance: baseline.tolerance.absolute_tolerance,
        maximum_mismatched_components: baseline.tolerance.maximum_mismatched_components,
        explanation: format!(
            "candidate {status}: {mismatched_components} components exceeded absolute tolerance {}; policy permits {}",
            baseline.tolerance.absolute_tolerance, baseline.tolerance.maximum_mismatched_components
        ),
    })
}

pub fn compare_files(
    baseline_path: &Path,
    candidate_path: &Path,
) -> Result<ComparisonReport, BaselineError> {
    compare(
        &load_baseline(baseline_path)?,
        &load_candidate(candidate_path)?,
    )
}

pub fn approve(
    baseline_path: &Path,
    candidate_path: &Path,
    metadata: ApprovalMetadata,
) -> Result<BaselineManifest, BaselineError> {
    validate_approval(&metadata)?;
    let mut baseline = load_baseline(baseline_path)?;
    let candidate = load_candidate(candidate_path)?;
    let report = compare(&baseline, &candidate)?;
    if !report.passed {
        return Err(BaselineError::CandidateFailed);
    }
    let prior_baseline_hash = hash_serializable(&baseline)?;
    let candidate_hash = hash_serializable(&candidate)?;
    baseline.expected_values = candidate.observed_values;
    baseline.approvals.push(ApprovalRecord {
        reviewer: metadata.reviewer,
        issue: metadata.issue,
        reason: metadata.reason,
        approved_unix_millis: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| BaselineError::InvalidField("system clock"))?
            .as_millis(),
        prior_baseline_hash,
        candidate_hash,
    });
    write_baseline_atomic(baseline_path, &baseline)?;
    Ok(baseline)
}

pub fn load_baseline(path: &Path) -> Result<BaselineManifest, BaselineError> {
    let manifest = load_envelope(path, true)?;
    validate_baseline(&manifest)?;
    Ok(manifest)
}

pub fn load_candidate(path: &Path) -> Result<CandidateManifest, BaselineError> {
    let manifest = load_envelope(path, false)?;
    validate_candidate(&manifest)?;
    Ok(manifest)
}

pub fn write_baseline_atomic(
    path: &Path,
    manifest: &BaselineManifest,
) -> Result<(), BaselineError> {
    validate_baseline(manifest)?;
    write_envelope_atomic(path, manifest)
}

pub fn write_candidate_atomic(
    path: &Path,
    manifest: &CandidateManifest,
) -> Result<(), BaselineError> {
    validate_candidate(manifest)?;
    write_envelope_atomic(path, manifest)
}

#[must_use]
pub fn isolated_baseline_path(root: &Path, hardware: &HardwareIdentity) -> PathBuf {
    root.join(hardware.fingerprint()).join("baseline.json")
}

fn validate_baseline(manifest: &BaselineManifest) -> Result<(), BaselineError> {
    validate_common(
        manifest.schema_version,
        &manifest.binding,
        &manifest.tolerance,
        &manifest.expected_values,
    )?;
    for approval in &manifest.approvals {
        if approval.reviewer.trim().is_empty()
            || approval.issue.trim().is_empty()
            || approval.reason.trim().is_empty()
            || !valid_hash(&approval.prior_baseline_hash)
            || !valid_hash(&approval.candidate_hash)
        {
            return Err(BaselineError::InvalidField("approval audit trail"));
        }
    }
    Ok(())
}

fn validate_candidate(manifest: &CandidateManifest) -> Result<(), BaselineError> {
    validate_common(
        manifest.schema_version,
        &manifest.binding,
        &manifest.tolerance,
        &manifest.observed_values,
    )
}

fn validate_common(
    schema_version: u32,
    binding: &BaselineBinding,
    tolerance: &TolerancePolicy,
    values: &[f64],
) -> Result<(), BaselineError> {
    if schema_version != BASELINE_SCHEMA_VERSION {
        return Err(BaselineError::UnsupportedSchema);
    }
    for (name, hash) in [
        ("fixture_hash", &binding.fixture_hash),
        ("graph_fingerprint", &binding.graph_fingerprint),
        ("operation_fingerprint", &binding.operation_fingerprint),
    ] {
        if !valid_hash(hash) {
            return Err(BaselineError::InvalidField(name));
        }
    }
    if binding.reference.id.trim().is_empty()
        || binding.reference.version == 0
        || binding.metric.id.trim().is_empty()
        || binding.metric.version == 0
        || binding.metric_conditions.id.trim().is_empty()
    {
        return Err(BaselineError::InvalidField("versioned contracts"));
    }
    if binding.metric_conditions.parameters.is_empty()
        || binding
            .metric_conditions
            .parameters
            .values()
            .any(|value| !value.is_finite())
    {
        return Err(BaselineError::InvalidField("metric_conditions"));
    }
    if [
        &binding.hardware.backend,
        &binding.hardware.vendor,
        &binding.hardware.device,
        &binding.hardware.driver,
    ]
    .iter()
    .any(|value| value.trim().is_empty())
    {
        return Err(BaselineError::InvalidField("hardware"));
    }
    if !tolerance.absolute_tolerance.is_finite() || tolerance.absolute_tolerance < 0.0 {
        return Err(BaselineError::InvalidField("absolute_tolerance"));
    }
    if values.is_empty() || values.iter().any(|value| !value.is_finite()) {
        return Err(BaselineError::InvalidField("measurement values"));
    }
    Ok(())
}

fn validate_compatibility(
    baseline: &BaselineManifest,
    candidate: &CandidateManifest,
) -> Result<(), BaselineError> {
    if baseline.binding.hardware != candidate.binding.hardware {
        return Err(BaselineError::HardwareMismatch);
    }
    if baseline.binding.fixture_hash != candidate.binding.fixture_hash
        || baseline.binding.graph_fingerprint != candidate.binding.graph_fingerprint
        || baseline.binding.operation_fingerprint != candidate.binding.operation_fingerprint
        || baseline.binding.reference != candidate.binding.reference
        || baseline.binding.metric != candidate.binding.metric
    {
        return Err(BaselineError::BindingMismatch);
    }
    if baseline.binding.metric_conditions != candidate.binding.metric_conditions
        || baseline.tolerance != candidate.tolerance
    {
        return Err(BaselineError::PolicyMismatch);
    }
    Ok(())
}

fn validate_approval(metadata: &ApprovalMetadata) -> Result<(), BaselineError> {
    if metadata.reviewer.trim().is_empty() {
        return Err(BaselineError::InvalidField("reviewer"));
    }
    if metadata.issue.trim().is_empty() {
        return Err(BaselineError::InvalidField("issue"));
    }
    if metadata.reason.trim().is_empty() {
        return Err(BaselineError::InvalidField("reason"));
    }
    Ok(())
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn load_envelope<T: DeserializeOwned + Serialize>(
    path: &Path,
    baseline: bool,
) -> Result<T, BaselineError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && baseline => {
            return Err(BaselineError::MissingBaseline);
        }
        Err(error) => return Err(BaselineError::Io(error)),
    };
    let envelope: IntegrityEnvelope =
        serde_json::from_slice(&bytes).map_err(|_| BaselineError::CorruptManifest)?;
    if hash_bytes(envelope.payload_json.as_bytes()) != envelope.integrity_sha256 {
        return Err(BaselineError::CorruptManifest);
    }
    serde_json::from_str(&envelope.payload_json).map_err(|_| BaselineError::CorruptManifest)
}

fn write_envelope_atomic<T: Serialize>(path: &Path, payload: &T) -> Result<(), BaselineError> {
    let payload_json =
        serde_json::to_string(payload).map_err(|_| BaselineError::CorruptManifest)?;
    let envelope = IntegrityEnvelope {
        integrity_sha256: hash_bytes(payload_json.as_bytes()),
        payload_json,
    };
    let bytes = serde_json::to_vec_pretty(&envelope).map_err(|_| BaselineError::CorruptManifest)?;
    let parent = path
        .parent()
        .ok_or(BaselineError::InvalidField("baseline path"))?;
    fs::create_dir_all(parent)?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".rapidraw-baseline-{}-{sequence}.tmp",
        std::process::id()
    ));
    let write_result = (|| -> Result<(), BaselineError> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn hash_serializable<T: Serialize>(value: &T) -> Result<String, BaselineError> {
    let bytes = serde_json::to_vec(value).map_err(|_| BaselineError::CorruptManifest)?;
    Ok(hash_bytes(&bytes))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
