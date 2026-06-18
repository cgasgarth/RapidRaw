#![cfg(all(test, feature = "tauri-test"))]

use std::path::PathBuf;

use crate::private_decode_raw_proof::{PrivateDecodeProofConfig, run_private_decode_proof};

const SOURCE_RELATIVE_PATHS: [&str; 3] = [
    "private-fixtures/focus-stack/plane-transition-v1/frame-01.cr3",
    "private-fixtures/focus-stack/plane-transition-v1/frame-02.cr3",
    "private-fixtures/focus-stack/plane-transition-v1/frame-03.cr3",
];

const NON_CLAIMS: [&str; 4] = [
    "not_stack_quality_verified",
    "not_runtime_apply_capable",
    "not_ui_verified",
    "not_preview_export_parity_verified",
];

const CONFIG: PrivateDecodeProofConfig = PrivateDecodeProofConfig {
    decode_report_file: "focus-plane-decode-report.json",
    expected_format_label: "cr3",
    feature_family: "focus_stack",
    fixture_id: "validation.computational-merge.focus-plane-transition.v1",
    implementation_issue: 1507,
    metric_source_count: SOURCE_RELATIVE_PATHS.len(),
    notes: "Private CR3 focus-stack direct decode smoke only. This proves production RAW loader ingest, nonzero decoded dimensions, finite decoded pixel payloads, source hashing, and metadata-only report collection. It does not claim focus alignment, stack quality, app-server apply, preview/export parity, or UI review.",
    quality_file: "focus-plane-quality.json",
    report_file: "focus-plane-private-run-report.json",
    report_id: "computational-merge-run.focus-plane-transition.v1",
    source_dir: "private-fixtures/focus-stack/plane-transition-v1",
    source_relative_paths: &SOURCE_RELATIVE_PATHS,
    ui_issue: 1334,
};

#[test]
fn private_decode_smoke_generates_focus_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_FOCUS_REAL_RAW_DECODE_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private focus-stack real RAW decode smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_decode_proof(&private_root, &CONFIG, &NON_CLAIMS)
        .expect("private focus-stack real RAW decode proof runs");
}
