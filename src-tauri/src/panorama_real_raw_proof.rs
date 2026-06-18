#![cfg(all(test, feature = "tauri-test"))]

use std::path::PathBuf;

use crate::private_decode_raw_proof::{PrivateDecodeProofConfig, run_private_decode_proof};

const SOURCE_RELATIVE_PATHS: [&str; 3] = [
    "private-fixtures/panorama/overlap-stitch-v1/frame-01.raf",
    "private-fixtures/panorama/overlap-stitch-v1/frame-02.raf",
    "private-fixtures/panorama/overlap-stitch-v1/frame-03.raf",
];

const NON_CLAIMS: [&str; 4] = [
    "not_stitch_quality_verified",
    "not_runtime_apply_capable",
    "not_ui_verified",
    "not_preview_export_parity_verified",
];

const CONFIG: PrivateDecodeProofConfig = PrivateDecodeProofConfig {
    decode_report_file: "panorama-overlap-decode-report.json",
    expected_format_label: "raf",
    feature_family: "panorama_stitch",
    fixture_id: "validation.computational-merge.panorama-overlap.v1",
    implementation_issue: 1508,
    metric_source_count: SOURCE_RELATIVE_PATHS.len(),
    notes: "Private RAF panorama overlap direct decode smoke only. This proves production RAW loader ingest, nonzero decoded dimensions, finite decoded pixel payloads, source hashing, and metadata-only report collection. It does not claim panorama alignment, stitch quality, app-server apply, preview/export parity, or UI review.",
    quality_file: "panorama-overlap-quality.json",
    report_file: "panorama-overlap-private-run-report.json",
    report_id: "computational-merge-run.panorama-overlap.v1",
    source_dir: "private-fixtures/panorama/overlap-stitch-v1",
    source_relative_paths: &SOURCE_RELATIVE_PATHS,
    ui_issue: 1333,
};

#[test]
fn private_decode_smoke_generates_panorama_real_raw_report_when_enabled() {
    if std::env::var("RAWENGINE_RUN_PRIVATE_PANORAMA_REAL_RAW_DECODE_PROOF")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!("skipping private panorama real RAW decode smoke");
        return;
    }

    let private_root = PathBuf::from(
        std::env::var("RAWENGINE_PRIVATE_RAW_ROOT")
            .unwrap_or_else(|_| "/tmp/rawengine-private-root".to_string()),
    );
    run_private_decode_proof(&private_root, &CONFIG, &NON_CLAIMS)
        .expect("private panorama real RAW decode proof runs");
}
