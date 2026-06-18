#![cfg(all(test, feature = "tauri-test"))]

use std::path::PathBuf;

use crate::private_decode_raw_proof::{PrivateDecodeProofConfig, run_private_decode_proof};

const SOURCE_RELATIVE_PATHS: [&str; 4] = [
    "private-fixtures/super-resolution/subpixel-detail-v1/frame-01.nef",
    "private-fixtures/super-resolution/subpixel-detail-v1/frame-02.nef",
    "private-fixtures/super-resolution/subpixel-detail-v1/frame-03.nef",
    "private-fixtures/super-resolution/subpixel-detail-v1/frame-04.nef",
];

const NON_CLAIMS: [&str; 5] = [
    "not_registration_quality_verified",
    "not_reconstruction_quality_verified",
    "not_runtime_apply_capable",
    "not_ui_verified",
    "not_preview_export_parity_verified",
];

const CONFIG: PrivateDecodeProofConfig = PrivateDecodeProofConfig {
    decode_report_file: "sr-subpixel-decode-report.json",
    expected_format_label: "nef",
    feature_family: "super_resolution",
    fixture_id: "validation.computational-merge.super-resolution-subpixel.v1",
    implementation_issue: 1506,
    metric_source_count: SOURCE_RELATIVE_PATHS.len(),
    notes: "Private NEF super-resolution direct decode smoke only. This proves production RAW loader ingest, nonzero decoded dimensions, finite decoded pixel payloads, source hashing, and metadata-only report collection. It does not claim registration quality, reconstruction quality, app-server apply, preview/export parity, or UI review.",
    quality_file: "sr-subpixel-quality.json",
    report_file: "sr-subpixel-private-run-report.json",
    report_id: "computational-merge-run.super-resolution-subpixel.v1",
    source_dir: "private-fixtures/super-resolution/subpixel-detail-v1",
    source_relative_paths: &SOURCE_RELATIVE_PATHS,
    ui_issue: 1335,
};

#[test]
fn private_decode_smoke_generates_sr_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_SR_REAL_RAW_DECODE_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private super-resolution real RAW decode smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_decode_proof(&private_root, &CONFIG, &NON_CLAIMS)
        .expect("private super-resolution real RAW decode proof runs");
}
