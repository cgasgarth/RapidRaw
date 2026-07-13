use std::{fs, process::Command};

use rapidraw_color_reference::{
    REFERENCE_CONTRACT_ID,
    baseline::{
        BASELINE_SCHEMA_VERSION, BaselineBinding, BaselineManifest, HardwareIdentity,
        TolerancePolicy, VersionedContract, write_baseline_atomic,
    },
    harness::REFERENCE_IMPLEMENTATION_VERSION,
    lab::{
        CacheDisposition, ColorLabConfig, ColorLabError, ColorLabTier, LabClock,
        color_lab_metric_conditions, human_report, machine_report, portable_cpu_identity,
        run_color_lab_with_clock, write_reports,
    },
    metrics::COLOR_METRICS_CONTRACT_ID,
};
use tempfile::tempdir;

struct FixedClock {
    current: u64,
    step: u64,
}

impl FixedClock {
    fn new(step: u64) -> Self {
        Self { current: 0, step }
    }
}

impl LabClock for FixedClock {
    fn elapsed_micros(&mut self) -> u64 {
        let value = self.current;
        self.current += self.step;
        value
    }
}

fn config(tier: ColorLabTier) -> ColorLabConfig {
    ColorLabConfig {
        tier,
        graph_fingerprint: "ab".repeat(32),
        affected_fixtures: vec![],
        hardware: None,
        baseline_path: None,
        cache_directory: None,
        no_cache: true,
    }
}

fn hardware(device: &str) -> HardwareIdentity {
    HardwareIdentity {
        backend: "metal".into(),
        vendor: "apple".into(),
        device: device.into(),
        driver: "macos-26.0".into(),
    }
}

#[test]
fn fast_selects_the_small_affected_pack_while_full_runs_every_fixture() {
    let fast =
        run_color_lab_with_clock(&config(ColorLabTier::Fast), &mut FixedClock::new(10)).unwrap();
    let full =
        run_color_lab_with_clock(&config(ColorLabTier::Full), &mut FixedClock::new(10)).unwrap();
    assert_eq!(fast.fixtures.len(), 4);
    assert_eq!(fast.stages.len(), 2);
    assert_eq!(
        fast.fixtures
            .iter()
            .map(|fixture| fixture.id.as_str())
            .collect::<Vec<_>>(),
        [
            "neutral-extended-ramp",
            "smooth-gradient",
            "spatial-stepedge",
            "pq-ramp"
        ]
    );
    assert_eq!(full.fixtures.len(), 14);
    assert_eq!(full.stages.len(), 8);
    assert!(full.observed_values.len() > fast.observed_values.len());
}

#[test]
fn cache_identity_hits_only_when_affected_inputs_are_unchanged() {
    let directory = tempdir().unwrap();
    let mut config = config(ColorLabTier::Fast);
    config.no_cache = false;
    config.cache_directory = Some(directory.path().to_owned());
    let first = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    let second = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    assert_eq!(first.cache, CacheDisposition::Miss);
    assert_eq!(second.cache, CacheDisposition::Hit);
    assert_eq!(first.cache_identity, second.cache_identity);

    config.graph_fingerprint = "cd".repeat(32);
    let invalidated = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    assert_eq!(invalidated.cache, CacheDisposition::Miss);
    assert_ne!(invalidated.cache_identity, first.cache_identity);
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn cache_identity_includes_tier_fixture_set_graph_and_hardware() {
    let mut first_config = config(ColorLabTier::Fast);
    first_config.affected_fixtures = vec!["neutral-extended-ramp".into(), "pq-ramp".into()];
    let first = run_color_lab_with_clock(&first_config, &mut FixedClock::new(10)).unwrap();

    let mut fixtures_changed = first_config.clone();
    fixtures_changed.affected_fixtures = vec!["smooth-gradient".into(), "spatial-stepedge".into()];
    let fixtures_changed =
        run_color_lab_with_clock(&fixtures_changed, &mut FixedClock::new(10)).unwrap();
    assert_ne!(
        first.cache_identity.fixture_set_hash,
        fixtures_changed.cache_identity.fixture_set_hash
    );
    assert_ne!(first.cache_identity, fixtures_changed.cache_identity);

    let mut graph_changed = first_config.clone();
    graph_changed.graph_fingerprint = "cd".repeat(32);
    let graph_changed = run_color_lab_with_clock(&graph_changed, &mut FixedClock::new(10)).unwrap();
    assert_ne!(first.cache_identity, graph_changed.cache_identity);

    let mut hardware_changed = first_config;
    hardware_changed.tier = ColorLabTier::Hardware;
    hardware_changed.hardware = Some(hardware("m4-max"));
    let hardware_changed =
        run_color_lab_with_clock(&hardware_changed, &mut FixedClock::new(10)).unwrap();
    assert_ne!(first.cache_identity, hardware_changed.cache_identity);
}

#[test]
fn full_tier_always_bypasses_and_never_populates_cache() {
    let directory = tempdir().unwrap();
    let cache = directory.path().join("cache");
    let mut config = config(ColorLabTier::Full);
    config.no_cache = false;
    config.cache_directory = Some(cache.clone());
    let first = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    let second = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    assert_eq!(first.cache, CacheDisposition::Bypassed);
    assert_eq!(second.cache, CacheDisposition::Bypassed);
    assert!(!cache.exists());
}

#[test]
fn hardware_tier_requires_complete_identity_and_isolates_cache_entries() {
    let directory = tempdir().unwrap();
    let mut config = config(ColorLabTier::Hardware);
    config.no_cache = false;
    config.cache_directory = Some(directory.path().to_owned());
    assert!(matches!(
        run_color_lab_with_clock(&config, &mut FixedClock::new(10)),
        Err(ColorLabError::InvalidConfiguration(_))
    ));

    config.hardware = Some(hardware("m3-max"));
    let first = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    config.hardware = Some(hardware("m4-max"));
    let second = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    assert_eq!(first.cache, CacheDisposition::Miss);
    assert_eq!(second.cache, CacheDisposition::Miss);
    assert_ne!(
        first.cache_identity.hardware_fingerprint,
        second.cache_identity.hardware_fingerprint
    );
    assert_ne!(first.cache_identity, second.cache_identity);
}

#[test]
fn failed_baseline_records_deterministic_time_to_first_failure() {
    let directory = tempdir().unwrap();
    let baseline_path = directory.path().join("baseline.json");
    let mut config = config(ColorLabTier::Fast);
    let initial = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    let mut expected_values = initial.observed_values.clone();
    expected_values[0] += 1.0;
    write_baseline_atomic(
        &baseline_path,
        &BaselineManifest {
            schema_version: BASELINE_SCHEMA_VERSION,
            binding: BaselineBinding {
                fixture_hash: initial.cache_identity.fixture_set_hash.clone(),
                graph_fingerprint: initial.cache_identity.graph_fingerprint.clone(),
                operation_fingerprint: initial.cache_identity.operation_fingerprint.clone(),
                reference: VersionedContract {
                    id: REFERENCE_CONTRACT_ID.into(),
                    version: REFERENCE_IMPLEMENTATION_VERSION,
                },
                metric: VersionedContract {
                    id: COLOR_METRICS_CONTRACT_ID.into(),
                    version: initial.metric_version,
                },
                metric_conditions: color_lab_metric_conditions(),
                hardware: portable_cpu_identity(),
            },
            tolerance: TolerancePolicy {
                absolute_tolerance: 0.000_000_000_1,
                maximum_mismatched_components: 0,
            },
            expected_values,
            approvals: vec![],
        },
    )
    .unwrap();
    config.baseline_path = Some(baseline_path);
    let failed = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    assert!(!failed.passed);
    assert_eq!(failed.timings.time_to_first_failure_micros, Some(40));
    assert_eq!(failed.baseline.unwrap().mismatched_components, 1);
}

#[test]
fn machine_human_and_written_reports_are_deterministic() {
    let directory = tempdir().unwrap();
    let config = config(ColorLabTier::Full);
    let first = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    let second = run_color_lab_with_clock(&config, &mut FixedClock::new(10)).unwrap();
    assert_eq!(
        machine_report(&first).unwrap(),
        machine_report(&second).unwrap()
    );
    assert_eq!(human_report(&first), human_report(&second));
    write_reports(directory.path(), &first).unwrap();
    assert_eq!(
        fs::read_to_string(directory.path().join("color-lab-report.json")).unwrap(),
        machine_report(&first).unwrap()
    );
    assert_eq!(
        fs::read_to_string(directory.path().join("color-lab-report.txt")).unwrap(),
        human_report(&first)
    );
}

#[test]
fn real_color_lab_command_emits_machine_and_human_artifacts() {
    let directory = tempdir().unwrap();
    let output = directory.path().join("reports");
    let result = Command::new(env!("CARGO_BIN_EXE_rapidraw-color-lab"))
        .args([
            "run",
            "--affected",
            "--graph",
            &"ab".repeat(32),
            "--output",
            output.to_str().unwrap(),
            "--no-cache",
        ])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(
        String::from_utf8(result.stdout)
            .unwrap()
            .contains("Color lab Fast: PASS")
    );
    let machine = fs::read_to_string(output.join("color-lab-report.json")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&machine).unwrap();
    assert_eq!(parsed["tier"], "fast");
    assert_eq!(parsed["cache"], "bypassed");
    assert!(
        fs::read_to_string(output.join("color-lab-report.txt"))
            .unwrap()
            .contains("fixtures=4")
    );
}
