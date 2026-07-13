//! Fast, full, and hardware-bound orchestration for the color reference laboratory.

use std::{
    collections::BTreeMap,
    fmt, fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    REFERENCE_CONTRACT_ID, ReferenceError,
    baseline::{
        BASELINE_SCHEMA_VERSION, BaselineError, CandidateManifest, ComparisonReport,
        HardwareIdentity, load_baseline,
    },
    fixtures::{FixtureData, FixtureId, FixturePack, SpatialPattern, generate_fixture_packs},
    harness::{
        REFERENCE_IMPLEMENTATION_VERSION, ReferenceOperation, StageImplementation, StageSample,
        StageVectorRequest, execute_reference_stage,
    },
    metrics::{
        COLOR_METRICS_CONTRACT_ID, DetailMetricCondition, DetailSignalDomain, ToneInputDomain,
        ToneMetricCondition, ToneOutputDomain, ToneSample, measure_detail_signal,
        measure_tone_curve,
    },
    types::CieLab,
};

pub const COLOR_LAB_CONTRACT_ID: &str = "rapidraw.color-lab.v1";
pub const COLOR_LAB_VERSION: u32 = 1;
static REPORT_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub enum ColorLabError {
    InvalidConfiguration(&'static str),
    Reference(ReferenceError),
    Baseline(BaselineError),
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl fmt::Display for ColorLabError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration(message) => formatter.write_str(message),
            Self::Reference(error) => write!(formatter, "reference execution failed: {error:?}"),
            Self::Baseline(error) => write!(formatter, "baseline comparison failed: {error}"),
            Self::Io(error) => write!(formatter, "color-lab I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "color-lab JSON failed: {error}"),
        }
    }
}

impl std::error::Error for ColorLabError {}

impl From<ReferenceError> for ColorLabError {
    fn from(error: ReferenceError) -> Self {
        Self::Reference(error)
    }
}

impl From<BaselineError> for ColorLabError {
    fn from(error: BaselineError) -> Self {
        Self::Baseline(error)
    }
}

impl From<std::io::Error> for ColorLabError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ColorLabError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColorLabTier {
    Fast,
    Full,
    Hardware,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CacheDisposition {
    Hit,
    Miss,
    Bypassed,
}

#[derive(Clone, Debug)]
pub struct ColorLabConfig {
    pub tier: ColorLabTier,
    pub graph_fingerprint: String,
    pub affected_fixtures: Vec<String>,
    pub hardware: Option<HardwareIdentity>,
    pub baseline_path: Option<PathBuf>,
    pub cache_directory: Option<PathBuf>,
    pub no_cache: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColorLabCacheIdentity {
    pub contract_id: String,
    pub contract_version: u32,
    pub tier: ColorLabTier,
    pub fixture_set_hash: String,
    pub graph_fingerprint: String,
    pub operation_fingerprint: String,
    pub reference_version: u32,
    pub metric_version: u32,
    pub hardware_fingerprint: String,
    pub hardware: HardwareIdentity,
    pub baseline_hash: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixtureRunReport {
    pub id: String,
    pub content_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StageRunReport {
    pub fixture_id: String,
    pub operation_id: String,
    pub implementation_id: String,
    pub input_hash: String,
    pub output_hash: String,
    pub sample_count: usize,
    pub negative_output_components: usize,
    pub over_range_output_components: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LabTimings {
    pub fixture_selection_micros: u64,
    pub stage_execution_micros: u64,
    pub metric_execution_micros: u64,
    pub baseline_comparison_micros: u64,
    pub total_micros: u64,
    pub time_to_first_failure_micros: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ColorLabReport {
    pub contract_id: String,
    pub contract_version: u32,
    pub tier: ColorLabTier,
    pub passed: bool,
    pub cache: CacheDisposition,
    pub cache_identity: ColorLabCacheIdentity,
    pub fixtures: Vec<FixtureRunReport>,
    pub stages: Vec<StageRunReport>,
    pub metric_contract_id: String,
    pub metric_version: u32,
    pub observed_values: Vec<f64>,
    pub baseline: Option<ComparisonReport>,
    pub timings: LabTimings,
}

pub trait LabClock {
    fn elapsed_micros(&mut self) -> u64;
}

pub struct SystemLabClock(Instant);

impl Default for SystemLabClock {
    fn default() -> Self {
        Self(Instant::now())
    }
}

impl LabClock for SystemLabClock {
    fn elapsed_micros(&mut self) -> u64 {
        self.0.elapsed().as_micros().try_into().unwrap_or(u64::MAX)
    }
}

pub fn run_color_lab(config: &ColorLabConfig) -> Result<ColorLabReport, ColorLabError> {
    run_color_lab_with_clock(config, &mut SystemLabClock::default())
}

pub fn run_color_lab_with_clock(
    config: &ColorLabConfig,
    clock: &mut impl LabClock,
) -> Result<ColorLabReport, ColorLabError> {
    validate_config(config)?;
    let started = clock.elapsed_micros();
    let fixture_packs = generate_fixture_packs()?;
    let selected = select_fixtures(config, &fixture_packs)?;
    let fixture_finished = clock.elapsed_micros();
    let fixture_reports = selected
        .iter()
        .map(|fixture| FixtureRunReport {
            id: fixture_name(fixture.manifest.id),
            content_hash: fixture.manifest.content_hash.to_hex(),
        })
        .collect::<Vec<_>>();
    let fixture_set_hash = hash_json(&fixture_reports)?;
    let operations = selected
        .iter()
        .filter_map(|fixture| operation_for(fixture.manifest.id, &fixture.data))
        .map(|operation| operation.id())
        .collect::<Vec<_>>();
    let operation_fingerprint = hash_json(&operations)?;
    let hardware = config
        .hardware
        .clone()
        .unwrap_or_else(portable_cpu_identity);
    let baseline_hash = config.baseline_path.as_deref().map(hash_file).transpose()?;
    let identity = ColorLabCacheIdentity {
        contract_id: COLOR_LAB_CONTRACT_ID.to_owned(),
        contract_version: COLOR_LAB_VERSION,
        tier: config.tier,
        fixture_set_hash,
        graph_fingerprint: config.graph_fingerprint.clone(),
        operation_fingerprint,
        reference_version: REFERENCE_IMPLEMENTATION_VERSION,
        metric_version: 1,
        hardware_fingerprint: hardware.fingerprint(),
        hardware: hardware.clone(),
        baseline_hash,
    };
    let bypass_cache = config.no_cache || config.tier == ColorLabTier::Full;
    if !bypass_cache && let Some(cached) = load_cache(config.cache_directory.as_deref(), &identity)?
    {
        return Ok(ColorLabReport {
            cache: CacheDisposition::Hit,
            ..cached
        });
    }

    let mut stages = Vec::new();
    let mut observed_values = Vec::new();
    for fixture in &selected {
        if let Some(request) = stage_request(fixture)? {
            let result = execute_reference_stage(&request)?;
            append_samples(&mut observed_values, &result.output);
            stages.push(StageRunReport {
                fixture_id: fixture_name(fixture.manifest.id),
                operation_id: request.operation.id().to_owned(),
                implementation_id: result.receipt.implementation_id.to_owned(),
                input_hash: result.receipt.input_hash.to_hex(),
                output_hash: result.receipt.output_hash.to_hex(),
                sample_count: result.receipt.sample_count,
                negative_output_components: result.receipt.diagnostics.negative_output_components,
                over_range_output_components: result
                    .receipt
                    .diagnostics
                    .over_range_output_components,
            });
        }
    }
    let stage_finished = clock.elapsed_micros();
    append_metrics(&selected, &mut observed_values)?;
    let metric_finished = clock.elapsed_micros();

    let baseline = if let Some(path) = &config.baseline_path {
        let baseline = load_baseline(path)?;
        let candidate = CandidateManifest {
            schema_version: BASELINE_SCHEMA_VERSION,
            binding: crate::baseline::BaselineBinding {
                fixture_hash: identity.fixture_set_hash.clone(),
                graph_fingerprint: identity.graph_fingerprint.clone(),
                operation_fingerprint: identity.operation_fingerprint.clone(),
                reference: crate::baseline::VersionedContract {
                    id: REFERENCE_CONTRACT_ID.to_owned(),
                    version: REFERENCE_IMPLEMENTATION_VERSION,
                },
                metric: crate::baseline::VersionedContract {
                    id: COLOR_METRICS_CONTRACT_ID.to_owned(),
                    version: identity.metric_version,
                },
                metric_conditions: color_lab_metric_conditions(),
                hardware,
            },
            tolerance: baseline.tolerance.clone(),
            observed_values: observed_values.clone(),
        };
        Some(crate::baseline::compare(&baseline, &candidate)?)
    } else {
        None
    };
    let baseline_finished = clock.elapsed_micros();
    let passed = baseline.as_ref().is_none_or(|comparison| comparison.passed);
    let finished = clock.elapsed_micros();
    let report = ColorLabReport {
        contract_id: COLOR_LAB_CONTRACT_ID.to_owned(),
        contract_version: COLOR_LAB_VERSION,
        tier: config.tier,
        passed,
        cache: if bypass_cache {
            CacheDisposition::Bypassed
        } else {
            CacheDisposition::Miss
        },
        cache_identity: identity,
        fixtures: fixture_reports,
        stages,
        metric_contract_id: COLOR_METRICS_CONTRACT_ID.to_owned(),
        metric_version: 1,
        observed_values,
        baseline,
        timings: LabTimings {
            fixture_selection_micros: fixture_finished.saturating_sub(started),
            stage_execution_micros: stage_finished.saturating_sub(fixture_finished),
            metric_execution_micros: metric_finished.saturating_sub(stage_finished),
            baseline_comparison_micros: baseline_finished.saturating_sub(metric_finished),
            total_micros: finished.saturating_sub(started),
            time_to_first_failure_micros: (!passed)
                .then_some(baseline_finished.saturating_sub(started)),
        },
    };
    if !bypass_cache && report.passed {
        store_cache(config.cache_directory.as_deref(), &report)?;
    }
    Ok(report)
}

pub fn machine_report(report: &ColorLabReport) -> Result<String, ColorLabError> {
    Ok(format!("{}\n", serde_json::to_string_pretty(report)?))
}

#[must_use]
pub fn human_report(report: &ColorLabReport) -> String {
    let baseline = match &report.baseline {
        Some(result) if result.passed => "passed",
        Some(_) => "failed",
        None => "not requested",
    };
    format!(
        "Color lab {:?}: {}\nfixtures={} stages={} measurements={} cache={:?}\nbaseline={} total={}us first_failure={}\n",
        report.tier,
        if report.passed { "PASS" } else { "FAIL" },
        report.fixtures.len(),
        report.stages.len(),
        report.observed_values.len(),
        report.cache,
        baseline,
        report.timings.total_micros,
        report
            .timings
            .time_to_first_failure_micros
            .map_or_else(|| "none".to_owned(), |value| format!("{value}us"))
    )
}

pub fn write_reports(directory: &Path, report: &ColorLabReport) -> Result<(), ColorLabError> {
    fs::create_dir_all(directory)?;
    write_atomic(
        &directory.join("color-lab-report.json"),
        machine_report(report)?.as_bytes(),
    )?;
    write_atomic(
        &directory.join("color-lab-report.txt"),
        human_report(report).as_bytes(),
    )?;
    Ok(())
}

#[must_use]
pub fn portable_cpu_identity() -> HardwareIdentity {
    HardwareIdentity {
        backend: "reference-cpu".to_owned(),
        vendor: "portable".to_owned(),
        device: "f64-scalar".to_owned(),
        driver: "rust-standard-library".to_owned(),
    }
}

#[must_use]
pub fn color_lab_metric_conditions() -> crate::baseline::MetricConditions {
    crate::baseline::MetricConditions {
        id: "rapidraw.color-lab.observed-components.v1".to_owned(),
        parameters: BTreeMap::from([
            ("tone_monotonicity_epsilon".to_owned(), 0.0),
            ("tone_derivative_jump_threshold".to_owned(), 0.000_001),
            ("detail_ringing_epsilon".to_owned(), 0.000_001),
            ("detail_sample_spacing_pixels".to_owned(), 1.0),
        ]),
    }
}

fn validate_config(config: &ColorLabConfig) -> Result<(), ColorLabError> {
    if !valid_hash(&config.graph_fingerprint) {
        return Err(ColorLabError::InvalidConfiguration(
            "graph fingerprint must be 64 hexadecimal characters",
        ));
    }
    if config.tier == ColorLabTier::Hardware && config.hardware.is_none() {
        return Err(ColorLabError::InvalidConfiguration(
            "hardware tier requires backend, vendor, device, and driver identity",
        ));
    }
    Ok(())
}

fn select_fixtures<'a>(
    config: &ColorLabConfig,
    fixtures: &'a [FixturePack],
) -> Result<Vec<&'a FixturePack>, ColorLabError> {
    if config.tier != ColorLabTier::Fast {
        return Ok(fixtures.iter().collect());
    }
    let wanted = if config.affected_fixtures.is_empty() {
        vec![
            "neutral-extended-ramp".to_owned(),
            "smooth-gradient".to_owned(),
            "spatial-stepedge".to_owned(),
            "pq-ramp".to_owned(),
        ]
    } else {
        config.affected_fixtures.clone()
    };
    let selected = fixtures
        .iter()
        .filter(|fixture| wanted.contains(&fixture_name(fixture.manifest.id)))
        .collect::<Vec<_>>();
    if selected.len() != wanted.len() {
        return Err(ColorLabError::InvalidConfiguration(
            "affected fixture name is unknown or duplicated",
        ));
    }
    Ok(selected)
}

fn fixture_name(id: FixtureId) -> String {
    match id {
        FixtureId::NeutralExtendedRamp => "neutral-extended-ramp".to_owned(),
        FixtureId::HueChromaLuminanceSweep => "hue-chroma-luminance-sweep".to_owned(),
        FixtureId::SemanticCloud(class) => format!("semantic-{class:?}").to_lowercase(),
        FixtureId::SmoothGradient => "smooth-gradient".to_owned(),
        FixtureId::Cfa(pattern) => format!("cfa-{pattern:?}").to_lowercase(),
        FixtureId::Spatial(pattern) => format!("spatial-{pattern:?}").to_lowercase(),
        FixtureId::PqRamp => "pq-ramp".to_owned(),
        FixtureId::HlgRamp => "hlg-ramp".to_owned(),
        FixtureId::Rec2100HdrColors => "rec2100-hdr-colors".to_owned(),
        FixtureId::D50XyzVectors => "d50-xyz-vectors".to_owned(),
    }
}

fn operation_for(id: FixtureId, data: &FixtureData) -> Option<ReferenceOperation> {
    match (id, data) {
        (FixtureId::NeutralExtendedRamp, FixtureData::Rgb(_)) => {
            Some(ReferenceOperation::EncodeSrgbV1)
        }
        (FixtureId::SemanticCloud(_), FixtureData::SemanticCloud(_)) => {
            Some(ReferenceOperation::AcesCgToXyzD60V1)
        }
        (FixtureId::HueChromaLuminanceSweep, FixtureData::PolarLab(_)) => {
            Some(ReferenceOperation::DeltaE2000V1)
        }
        (FixtureId::PqRamp, FixtureData::Transfer(_)) => Some(ReferenceOperation::PqInverseEotfV1),
        (FixtureId::HlgRamp, FixtureData::Transfer(_)) => Some(ReferenceOperation::HlgOetfV1),
        (FixtureId::Rec2100HdrColors, FixtureData::Rgb(_)) => {
            Some(ReferenceOperation::Rec2100NitsToICtCpV1)
        }
        (FixtureId::D50XyzVectors, FixtureData::Rgb(_)) => Some(ReferenceOperation::XyzD50ToLabV1),
        _ => None,
    }
}

fn stage_request(fixture: &FixturePack) -> Result<Option<StageVectorRequest>, ColorLabError> {
    let Some(operation) = operation_for(fixture.manifest.id, &fixture.data) else {
        return Ok(None);
    };
    let samples = match &fixture.data {
        FixtureData::Rgb(samples) => samples
            .iter()
            .map(|sample| StageSample::Rgb([sample.red, sample.green, sample.blue]))
            .collect(),
        FixtureData::SemanticCloud(samples) => samples
            .iter()
            .map(|sample| StageSample::Rgb([sample.rgb.red, sample.rgb.green, sample.rgb.blue]))
            .collect(),
        FixtureData::PolarLab(samples) => samples
            .iter()
            .map(|sample| {
                let radians = sample.hue_degrees.to_radians();
                let lab = CieLab::new(
                    sample.lightness,
                    sample.chroma * radians.cos(),
                    sample.chroma * radians.sin(),
                )?;
                Ok(StageSample::LabPair(lab, lab))
            })
            .collect::<Result<Vec<_>, ReferenceError>>()?,
        FixtureData::Transfer(samples) => samples
            .iter()
            .map(|sample| StageSample::Scalar(sample.input))
            .collect(),
        _ => return Ok(None),
    };
    let (input_domain, output_domain) = operation.domains();
    Ok(Some(StageVectorRequest {
        operation,
        implementation: StageImplementation::ReferenceF64,
        implementation_version: REFERENCE_IMPLEMENTATION_VERSION,
        input_domain,
        output_domain,
        samples,
    }))
}

fn append_samples(values: &mut Vec<f64>, samples: &[StageSample]) {
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
}

fn append_metrics(fixtures: &[&FixturePack], values: &mut Vec<f64>) -> Result<(), ColorLabError> {
    for fixture in fixtures {
        match (&fixture.manifest.id, &fixture.data) {
            (FixtureId::SmoothGradient, FixtureData::Scalar(samples)) => {
                let tone = samples
                    .iter()
                    .enumerate()
                    .map(|(index, &output)| ToneSample::new(index as f64, output))
                    .collect::<Result<Vec<_>, _>>()?;
                let metrics = measure_tone_curve(
                    &tone,
                    ToneMetricCondition::new(
                        ToneInputDomain::Normalized,
                        ToneOutputDomain::SceneLinear,
                        0.0,
                        0.000_001,
                    )?,
                )?;
                values.extend([
                    metrics.monotonicity_violations as f64,
                    metrics.maximum_negative_step,
                    metrics.derivative_discontinuities as f64,
                    metrics.maximum_derivative_jump,
                ]);
            }
            (FixtureId::Spatial(SpatialPattern::StepEdge), FixtureData::Spatial(spatial)) => {
                let metrics = measure_detail_signal(
                    &spatial.samples,
                    &spatial.samples,
                    &DetailMetricCondition::new(
                        DetailSignalDomain::LinearLight,
                        1.0,
                        spatial.samples.len() / 2,
                        8,
                        0.000_001,
                        vec![spatial.samples.len() / 2],
                    )?,
                )?;
                values.extend([
                    metrics.overshoot,
                    metrics.undershoot,
                    metrics.halo_amplitude,
                    metrics.ringing_sign_changes as f64,
                    metrics.maximum_tile_seam_error,
                ]);
            }
            _ => {}
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct CachedReport {
    report_json: String,
    integrity_sha256: String,
}

fn load_cache(
    directory: Option<&Path>,
    identity: &ColorLabCacheIdentity,
) -> Result<Option<ColorLabReport>, ColorLabError> {
    let Some(directory) = directory else {
        return Ok(None);
    };
    let path = cache_path(directory, identity)?;
    let Ok(bytes) = fs::read(path) else {
        return Ok(None);
    };
    let Ok(cached) = serde_json::from_slice::<CachedReport>(&bytes) else {
        return Ok(None);
    };
    if hex_digest(cached.report_json.as_bytes()) != cached.integrity_sha256 {
        return Ok(None);
    }
    let Ok(report) = serde_json::from_str::<ColorLabReport>(&cached.report_json) else {
        return Ok(None);
    };
    if report.cache_identity != *identity {
        return Ok(None);
    }
    Ok(Some(report))
}

fn store_cache(directory: Option<&Path>, report: &ColorLabReport) -> Result<(), ColorLabError> {
    let Some(directory) = directory else {
        return Ok(());
    };
    fs::create_dir_all(directory)?;
    let report_json = serde_json::to_string(report)?;
    let cached = CachedReport {
        integrity_sha256: hex_digest(report_json.as_bytes()),
        report_json,
    };
    write_atomic(
        &cache_path(directory, &report.cache_identity)?,
        &serde_json::to_vec_pretty(&cached)?,
    )
}

fn cache_path(
    directory: &Path,
    identity: &ColorLabCacheIdentity,
) -> Result<PathBuf, ColorLabError> {
    Ok(directory.join(format!("{}.json", hash_json(identity)?)))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), ColorLabError> {
    let sequence = REPORT_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_extension(format!("tmp-{}-{sequence}", std::process::id()));
    fs::write(&temporary, bytes)?;
    fs::File::open(&temporary)?.sync_all()?;
    fs::rename(&temporary, path)?;
    Ok(())
}

fn hash_file(path: &Path) -> Result<String, ColorLabError> {
    Ok(hex_digest(&fs::read(path)?))
}

fn hash_json(value: &impl Serialize) -> Result<String, ColorLabError> {
    Ok(hex_digest(&serde_json::to_vec(value)?))
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
