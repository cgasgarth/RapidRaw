use std::{collections::BTreeMap, fs, process::Command};

use rapidraw_color_reference::baseline::{
    ApprovalMetadata, BASELINE_SCHEMA_VERSION, BaselineBinding, BaselineError, BaselineManifest,
    CandidateManifest, HardwareIdentity, MetricConditions, TolerancePolicy, VersionedContract,
    approve, compare, isolated_baseline_path, load_baseline, write_baseline_atomic,
    write_candidate_atomic,
};
use tempfile::tempdir;

fn hardware(device: &str) -> HardwareIdentity {
    HardwareIdentity {
        backend: "metal".into(),
        vendor: "apple".into(),
        device: device.into(),
        driver: "macos-26.0".into(),
    }
}

fn binding(device: &str) -> BaselineBinding {
    BaselineBinding {
        fixture_hash: "11".repeat(32),
        graph_fingerprint: "22".repeat(32),
        operation_fingerprint: "33".repeat(32),
        reference: VersionedContract {
            id: "rapidraw.color-reference.v1".into(),
            version: 1,
        },
        metric: VersionedContract {
            id: "rapidraw.color-reference.metrics.color.v1".into(),
            version: 1,
        },
        metric_conditions: MetricConditions {
            id: "absolute-component-error".into(),
            parameters: BTreeMap::from([("observer_degrees".into(), 2.0)]),
        },
        hardware: hardware(device),
    }
}

fn tolerance() -> TolerancePolicy {
    TolerancePolicy {
        absolute_tolerance: 0.01,
        maximum_mismatched_components: 0,
    }
}

fn baseline() -> BaselineManifest {
    BaselineManifest {
        schema_version: BASELINE_SCHEMA_VERSION,
        binding: binding("m3-max"),
        tolerance: tolerance(),
        expected_values: vec![0.1, 0.5, 1.0],
        approvals: vec![],
    }
}

fn candidate(values: Vec<f64>) -> CandidateManifest {
    CandidateManifest {
        schema_version: BASELINE_SCHEMA_VERSION,
        binding: binding("m3-max"),
        tolerance: tolerance(),
        observed_values: values,
    }
}

fn metadata() -> ApprovalMetadata {
    ApprovalMetadata {
        reviewer: "color-reviewer".into(),
        issue: "#5413".into(),
        reason: "independent reference comparison passed".into(),
    }
}

#[test]
fn intentional_numeric_regression_fails_with_an_explanation() {
    let report = compare(&baseline(), &candidate(vec![0.1, 0.75, 1.0])).unwrap();
    assert!(!report.passed);
    assert_eq!(report.mismatched_components, 1);
    assert!((report.maximum_absolute_error - 0.25).abs() < f64::EPSILON);
    assert!(report.explanation.contains("failed"));
    assert!(report.explanation.contains("absolute tolerance 0.01"));
}

#[test]
fn corrupt_and_missing_baselines_fail_closed() {
    let directory = tempdir().unwrap();
    let missing = directory.path().join("missing.json");
    assert!(matches!(
        load_baseline(&missing),
        Err(BaselineError::MissingBaseline)
    ));

    let path = directory.path().join("baseline.json");
    write_baseline_atomic(&path, &baseline()).unwrap();
    let corrupt = fs::read_to_string(&path).unwrap().replace("0.1", "0.2");
    fs::write(&path, corrupt).unwrap();
    assert!(matches!(
        load_baseline(&path),
        Err(BaselineError::CorruptManifest)
    ));
}

#[test]
fn incompatible_hardware_is_rejected_and_has_an_isolated_path() {
    let baseline = baseline();
    let mut candidate = candidate(vec![0.1, 0.5, 1.0]);
    candidate.binding.hardware = hardware("different-gpu");
    assert!(matches!(
        compare(&baseline, &candidate),
        Err(BaselineError::HardwareMismatch)
    ));
    assert_ne!(
        isolated_baseline_path(
            std::path::Path::new("baselines"),
            &baseline.binding.hardware
        ),
        isolated_baseline_path(
            std::path::Path::new("baselines"),
            &candidate.binding.hardware
        )
    );
}

#[test]
fn changed_fixture_graph_operation_or_contract_binding_is_rejected() {
    let baseline = baseline();
    for mutate in 0..4 {
        let mut candidate = candidate(vec![0.1, 0.5, 1.0]);
        match mutate {
            0 => candidate.binding.fixture_hash = "44".repeat(32),
            1 => candidate.binding.graph_fingerprint = "44".repeat(32),
            2 => candidate.binding.operation_fingerprint = "44".repeat(32),
            3 => candidate.binding.reference.version += 1,
            _ => unreachable!(),
        }
        assert!(matches!(
            compare(&baseline, &candidate),
            Err(BaselineError::BindingMismatch)
        ));
    }
}

#[test]
fn candidate_cannot_silently_loosen_tolerance_or_metric_conditions() {
    let baseline = baseline();
    let mut loose = candidate(vec![0.1, 0.5, 1.0]);
    loose.tolerance.absolute_tolerance = 1.0;
    assert!(matches!(
        compare(&baseline, &loose),
        Err(BaselineError::PolicyMismatch)
    ));

    let mut changed_metric = candidate(vec![0.1, 0.5, 1.0]);
    changed_metric
        .binding
        .metric_conditions
        .parameters
        .insert("observer_degrees".into(), 10.0);
    assert!(matches!(
        compare(&baseline, &changed_metric),
        Err(BaselineError::PolicyMismatch)
    ));
}

#[test]
fn failed_candidate_cannot_be_approved_and_passing_approval_is_atomic_and_audited() {
    let directory = tempdir().unwrap();
    let baseline_path = directory.path().join("baseline.json");
    let candidate_path = directory.path().join("candidate.json");
    write_baseline_atomic(&baseline_path, &baseline()).unwrap();
    let original = fs::read(&baseline_path).unwrap();

    write_candidate_atomic(&candidate_path, &candidate(vec![0.1, 0.9, 1.0])).unwrap();
    assert!(matches!(
        approve(&baseline_path, &candidate_path, metadata()),
        Err(BaselineError::CandidateFailed)
    ));
    assert_eq!(fs::read(&baseline_path).unwrap(), original);

    write_candidate_atomic(&candidate_path, &candidate(vec![0.105, 0.5, 1.0])).unwrap();
    let updated = approve(&baseline_path, &candidate_path, metadata()).unwrap();
    assert_eq!(updated.expected_values, vec![0.105, 0.5, 1.0]);
    assert_eq!(updated.approvals.len(), 1);
    assert_eq!(updated.approvals[0].reviewer, "color-reviewer");
    assert_eq!(updated.approvals[0].issue, "#5413");
    assert_eq!(updated.approvals[0].prior_baseline_hash.len(), 64);
    assert_eq!(updated.approvals[0].candidate_hash.len(), 64);
    assert_eq!(load_baseline(&baseline_path).unwrap(), updated);
    assert!(fs::read_dir(directory.path()).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
}

#[test]
fn real_cli_compares_explains_and_approves() {
    let directory = tempdir().unwrap();
    let baseline_path = directory.path().join("baseline.json");
    let candidate_path = directory.path().join("candidate.json");
    write_baseline_atomic(&baseline_path, &baseline()).unwrap();
    let executable = env!("CARGO_BIN_EXE_rapidraw-color-baseline");

    write_candidate_atomic(&candidate_path, &candidate(vec![0.1, 0.9, 1.0])).unwrap();
    let failed = Command::new(executable)
        .args([
            "compare",
            baseline_path.to_str().unwrap(),
            candidate_path.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(!failed.status.success());
    assert!(
        String::from_utf8(failed.stderr)
            .unwrap()
            .contains("candidate failed")
    );

    write_candidate_atomic(&candidate_path, &candidate(vec![0.105, 0.5, 1.0])).unwrap();
    let compare = Command::new(executable)
        .args([
            "compare",
            baseline_path.to_str().unwrap(),
            candidate_path.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(compare.status.success());
    assert!(
        String::from_utf8(compare.stdout)
            .unwrap()
            .contains("\"passed\": true")
    );

    let explain = Command::new(executable)
        .args([
            "explain",
            baseline_path.to_str().unwrap(),
            candidate_path.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(explain.status.success());
    assert!(
        String::from_utf8(explain.stdout)
            .unwrap()
            .contains("candidate passed")
    );

    let approve = Command::new(executable)
        .args([
            "approve",
            baseline_path.to_str().unwrap(),
            candidate_path.to_str().unwrap(),
            "--reviewer",
            "cli-reviewer",
            "--issue",
            "#5413",
            "--reason",
            "CLI governance proof",
        ])
        .output()
        .unwrap();
    assert!(approve.status.success());
    assert!(
        String::from_utf8(approve.stdout)
            .unwrap()
            .contains("audit records: 1")
    );
    assert_eq!(
        load_baseline(&baseline_path).unwrap().approvals[0].reviewer,
        "cli-reviewer"
    );
}
