use std::{
    fs,
    path::Path,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::Manager;

use crate::{
    app_state::AppState,
    merge::{
        atomic_derived_output::{
            AtomicDerivedOutputReceipt, AtomicDerivedOutputTransaction, DerivedOutputManifest,
        },
        derived_output_provenance::{
            DerivedOutputProvenanceInput, DerivedOutputProvenanceSource,
            build_derived_output_provenance_sidecar,
        },
    },
};

use super::{
    artifact,
    candidate::{AcceptedFocusRuntime, validate},
};

static APPLY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusStackApplyRequest {
    candidate_id: String,
    accepted_preview_hash: String,
    accepted_review_hash: String,
    destination_directory: String,
    requested_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusStackApplyReceipt {
    schema_version: u32,
    candidate_id: String,
    candidate_hash: String,
    accepted_preview_hash: String,
    accepted_review_hash: String,
    derived_asset_id: String,
    payload_path: String,
    provenance_status: String,
    package: AtomicDerivedOutputReceipt,
}

#[tauri::command]
pub fn apply_focus_stack_candidate(
    request: FocusStackApplyRequest,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<FocusStackApplyReceipt, String> {
    validate_request(&request)?;
    let accepted = state
        .focus_stack_accepted_runtime
        .lock()
        .map_err(|_| "invalid_candidate_runtime_unavailable")?
        .clone()
        .ok_or("stale_candidate_runtime")?;
    let cache_root = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| format!("invalid_candidate_cache_unavailable:{error}"))?
        .join("focus-candidates");
    apply(&request, &accepted, &cache_root)
}

fn apply(
    request: &FocusStackApplyRequest,
    accepted: &AcceptedFocusRuntime,
    cache_root: &Path,
) -> Result<FocusStackApplyReceipt, String> {
    let _apply_guard = APPLY_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "focus_apply_lock_unavailable")?;
    let candidate = cache_root.join(&request.candidate_id);
    if !candidate.is_dir() {
        return Err("invalid_candidate_not_found".into());
    }
    let destination = Path::new(&request.destination_directory);
    reject_source_destination(destination, &accepted.paths)?;
    validate(&candidate, &accepted.identity).map_err(normalize_candidate_error)?;
    let candidate_hash = hash_file(&candidate.join("manifest.json"))?;
    if request.accepted_preview_hash != accepted.identity.preview_hash {
        return Err("stale_preview_hash".into());
    }
    if request.accepted_review_hash != candidate_hash {
        return Err("stale_review_hash".into());
    }
    if let Some(receipt) = find_replay(destination, request, &candidate_hash)? {
        return Ok(receipt);
    }
    validate_sources(accepted)?;

    let artifact = artifact::build(&candidate)?;
    let mut tx = AtomicDerivedOutputTransaction::begin(
        destination,
        &normalized_name(&request.requested_name),
    )?;
    tx.write_file("payload.tiff", &artifact.tiff)?;
    tx.write_file("preview.png", &artifact.preview)?;
    let candidate_manifest = fs::read(candidate.join("manifest.json"))
        .map_err(|error| format!("invalid_candidate_manifest_missing:{error}"))?;
    tx.write_file("focus-manifest.json", &candidate_manifest)?;
    let candidate_receipt = fs::read(candidate.join("receipt.json"))
        .map_err(|error| format!("invalid_candidate_receipt_missing:{error}"))?;
    tx.write_file("candidate-receipt.json", &candidate_receipt)?;
    let mut map_paths = vec![
        "focus-manifest.json".to_string(),
        "candidate-receipt.json".to_string(),
    ];
    for (path, bytes) in artifact.rgb_tiles {
        tx.write_file(&path, &bytes)?;
    }
    for (path, bytes) in artifact.map_tiles {
        tx.write_file(&path, &bytes)?;
        map_paths.push(path);
    }
    let derived_asset_id = format!("focus:{}", candidate_hash.trim_start_matches("blake3:"));
    let provenance = json!({
        "schemaVersion": 1,
        "family": "focus_stack",
        "derivedAssetId": derived_asset_id,
        "candidateId": request.candidate_id,
        "candidateHash": candidate_hash,
        "acceptedPreviewHash": request.accepted_preview_hash,
        "acceptedReviewHash": request.accepted_review_hash,
        "sourceState": "current",
        "sourceContentHashes": accepted.identity.source_hashes,
        "sourceGraphRevisions": accepted.identity.graph_revisions,
        "sourceOrder": accepted.identity.source_order,
        "planId": accepted.identity.plan_id,
        "planHash": accepted.identity.plan_hash,
        "transformHash": accepted.identity.transform_hash,
        "policyHash": accepted.identity.policy_hash,
        "width": accepted.identity.width,
        "height": accepted.identity.height,
        "basePayloadImmutable": true,
        "normalEditsUseDerivedGraph": true,
        "originalSourcesRequiredForExport": false
    });
    let provenance_bytes = serde_json::to_vec(&provenance)
        .map_err(|error| format!("focus_apply_provenance_serialize_failed:{error}"))?;
    tx.write_file("provenance.json", &provenance_bytes)?;
    let payload_hash = format!("blake3:{}", blake3::hash(&artifact.tiff).to_hex());
    let editor_sidecar = build_derived_output_provenance_sidecar(DerivedOutputProvenanceInput {
        accepted_apply_id: Some(&derived_asset_id),
        accepted_dry_run_id: Some(&accepted.identity.plan_id),
        family: "focus_stack",
        output_artifact_id: &derived_asset_id,
        output_content_hash: &payload_hash,
        output_path: Path::new("payload.tiff"),
        settings_hash: accepted.identity.policy_hash.clone(),
        sources: accepted
            .paths
            .iter()
            .zip(&accepted.identity.source_hashes)
            .zip(&accepted.identity.graph_revisions)
            .map(
                |((path, content_hash), graph_revision)| DerivedOutputProvenanceSource {
                    content_hash: content_hash.clone(),
                    graph_revision,
                    path,
                },
            )
            .collect(),
        warnings: Vec::new(),
    });
    tx.write_file(
        "payload.tiff.rrdata",
        &serde_json::to_vec(&editor_sidecar)
            .map_err(|error| format!("focus_apply_sidecar_serialize_failed:{error}"))?,
    )?;
    map_paths.extend(["provenance.json".into(), "payload.tiff.rrdata".into()]);
    let manifest = DerivedOutputManifest {
        schema_version: 1,
        family: "focus_stack".into(),
        width: accepted.identity.width.into(),
        height: accepted.identity.height.into(),
        payload_path: "payload.tiff".into(),
        preview_paths: vec!["preview.png".into()],
        map_paths,
        source_immutability_hashes: accepted.identity.source_hashes.clone(),
    };
    tx.stage_manifest(&manifest)?;
    validate_sources(accepted)?;
    let package = tx.commit(&manifest, |_| Ok(()))?;
    let payload_path = Path::new(&package.final_package_path)
        .join("payload.tiff")
        .to_string_lossy()
        .into_owned();
    let receipt = FocusStackApplyReceipt {
        schema_version: 1,
        candidate_id: request.candidate_id.clone(),
        candidate_hash,
        accepted_preview_hash: request.accepted_preview_hash.clone(),
        accepted_review_hash: request.accepted_review_hash.clone(),
        derived_asset_id,
        payload_path,
        provenance_status: "current".into(),
        package,
    };
    fs::write(
        candidate.join("CONSUMED.json"),
        serde_json::to_vec(&receipt).unwrap(),
    )
    .map_err(|error| format!("focus_apply_consumed_marker_failed:{error}"))?;
    Ok(receipt)
}

fn validate_request(request: &FocusStackApplyRequest) -> Result<(), String> {
    if request.candidate_id.is_empty() || request.candidate_id.contains(['/', '\\']) {
        return Err("invalid_candidate_id".into());
    }
    if request.accepted_preview_hash.is_empty() || request.accepted_review_hash.is_empty() {
        return Err("invalid_candidate_acceptance_missing".into());
    }
    if request.destination_directory.trim().is_empty() || request.requested_name.trim().is_empty() {
        return Err("destination_invalid".into());
    }
    Ok(())
}

fn validate_sources(accepted: &AcceptedFocusRuntime) -> Result<(), String> {
    for (path, expected) in accepted.paths.iter().zip(&accepted.identity.source_hashes) {
        if hash_file(Path::new(path))? != *expected {
            return Err("stale_source_bytes".into());
        }
    }
    Ok(())
}

fn reject_source_destination(destination: &Path, sources: &[String]) -> Result<(), String> {
    let destination = destination
        .canonicalize()
        .map_err(|error| format!("destination_unwritable:{error}"))?;
    for source in sources {
        let source = Path::new(source);
        if source == destination
            || source
                .canonicalize()
                .is_ok_and(|source| source == destination)
        {
            return Err("destination_is_source_path".into());
        }
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<String, String> {
    fs::read(path)
        .map(|bytes| format!("blake3:{}", blake3::hash(&bytes).to_hex()))
        .map_err(|error| format!("invalid_candidate_read_failed:{error}"))
}

fn normalize_candidate_error(error: String) -> String {
    if error.contains("hash") {
        "invalid_candidate_hash".into()
    } else {
        format!("invalid_candidate:{error}")
    }
}

fn normalized_name(name: &str) -> String {
    format!("{}.rrfocus", name.trim().trim_end_matches(".rrfocus"))
}

fn find_replay(
    destination: &Path,
    request: &FocusStackApplyRequest,
    candidate_hash: &str,
) -> Result<Option<FocusStackApplyReceipt>, String> {
    let Ok(entries) = fs::read_dir(destination) else {
        return Ok(None);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(bytes) = fs::read(path.join("provenance.json")) else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        if value["candidateHash"] != candidate_hash
            || value["acceptedReviewHash"] != request.accepted_review_hash
        {
            continue;
        }
        let package: AtomicDerivedOutputReceipt = serde_json::from_slice(
            &fs::read(path.join("REGISTRATION.json"))
                .map_err(|error| format!("invalid_candidate_replay_receipt:{error}"))?,
        )
        .map_err(|error| format!("invalid_candidate_replay_receipt:{error}"))?;
        if package.commit_status != "committed" {
            continue;
        }
        return Ok(Some(FocusStackApplyReceipt {
            schema_version: 1,
            candidate_id: request.candidate_id.clone(),
            candidate_hash: candidate_hash.into(),
            accepted_preview_hash: request.accepted_preview_hash.clone(),
            accepted_review_hash: request.accepted_review_hash.clone(),
            derived_asset_id: value["derivedAssetId"].as_str().unwrap_or_default().into(),
            payload_path: path.join("payload.tiff").to_string_lossy().into_owned(),
            provenance_status: "current".into(),
            package,
        }));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merge::{
        computational_job::{ComputationalMergeFamily, ComputationalMergeJobRegistry},
        derived_output_provenance::stable_hash,
    };
    use image::{Rgb, RgbImage};

    fn source(root: &Path, name: &str, phase: u32) -> String {
        let path = root.join(name);
        let mut image = RgbImage::new(160, 96);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let edge = u8::from((x / 8 + phase).is_multiple_of(2)) * 180;
            *pixel = Rgb([edge, (x % 251) as u8, (y % 241) as u8]);
        }
        image.save(&path).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn validates_identity_only_apply_contract() {
        let request = FocusStackApplyRequest {
            candidate_id: "focus-candidate-123".into(),
            accepted_preview_hash: "blake3:preview".into(),
            accepted_review_hash: "blake3:review".into(),
            destination_directory: "/tmp".into(),
            requested_name: "frame-Focus-Stack".into(),
        };
        assert!(validate_request(&request).is_ok());
        assert_eq!(
            normalized_name("frame-Focus-Stack.rrfocus"),
            "frame-Focus-Stack.rrfocus"
        );
    }

    #[test]
    fn rejects_path_like_candidate_identity() {
        let request = FocusStackApplyRequest {
            candidate_id: "../candidate".into(),
            accepted_preview_hash: "p".into(),
            accepted_review_hash: "r".into(),
            destination_directory: "/tmp".into(),
            requested_name: "x".into(),
        };
        assert_eq!(
            validate_request(&request),
            Err("invalid_candidate_id".into())
        );
    }

    #[test]
    fn applies_replays_and_reopens_without_sources() {
        let root = tempfile::tempdir().unwrap();
        let cache = root.path().join("cache");
        let destination = root.path().join("output");
        fs::create_dir_all(&cache).unwrap();
        fs::create_dir_all(&destination).unwrap();
        let paths = vec![
            source(root.path(), "a.png", 0),
            source(root.path(), "b.png", 1),
        ];
        let identity = super::super::candidate::AcceptedFocusPlanIdentity {
            plan_id: "focus-plan-apply-test".into(),
            plan_hash: stable_hash(&json!({"plan": 1})),
            input_plan_hash: stable_hash(&json!({"input": 1})),
            width: 160,
            height: 96,
            reference_source_index: 0,
            source_hashes: paths
                .iter()
                .map(|path| hash_file(Path::new(path)).unwrap())
                .collect(),
            graph_revisions: vec!["graph-a".into(), "graph-b".into()],
            source_order: vec!["a".into(), "b".into()],
            transform_hash: stable_hash(&json!({"transform": 1})),
            policy_hash: stable_hash(&json!({"policy": 1})),
            preview_hash: stable_hash(&json!({"preview": 1})),
        };
        let accepted = AcceptedFocusRuntime {
            identity: identity.clone(),
            paths: paths.clone(),
        };
        let tile_plan = super::super::tiles::plan(160, 96, 2, 256 * 1024 * 1024, 32).unwrap();
        let registry = ComputationalMergeJobRegistry::default();
        let job = registry
            .begin(
                ComputationalMergeFamily::FocusStack,
                "source_validation",
                tile_plan
                    .stage_work_units
                    .iter()
                    .map(|stage| stage.units)
                    .sum(),
                tile_plan
                    .stage_work_units
                    .iter()
                    .map(|stage| stage.weight)
                    .sum(),
            )
            .unwrap();
        let candidate = super::super::candidate::prepare(
            &cache,
            &identity,
            &paths,
            &tile_plan,
            &job.job_id,
            &job.cancellation_token,
            &registry,
        )
        .unwrap();
        let request = FocusStackApplyRequest {
            candidate_id: candidate.handle.package_id,
            accepted_preview_hash: identity.preview_hash,
            accepted_review_hash: candidate.handle.candidate_hash,
            destination_directory: destination.to_string_lossy().into_owned(),
            requested_name: "a-Focus-Stack".into(),
        };
        let before = paths
            .iter()
            .map(|path| hash_file(Path::new(path)).unwrap())
            .collect::<Vec<_>>();
        let receipt = apply(&request, &accepted, &cache).unwrap();
        assert_eq!(receipt.package.commit_status, "committed");
        assert_eq!(
            before,
            paths
                .iter()
                .map(|path| hash_file(Path::new(path)).unwrap())
                .collect::<Vec<_>>()
        );
        let package = Path::new(&receipt.package.final_package_path);
        assert!(package.join("inventory.json").is_file());
        assert!(package.join("maps/00000000.bin").is_file());
        assert_eq!(
            image::open(&receipt.payload_path)
                .unwrap()
                .to_rgb16()
                .dimensions(),
            (160, 96)
        );
        for path in &paths {
            fs::remove_file(path).unwrap();
        }
        let replay = apply(&request, &accepted, &cache).unwrap();
        assert_eq!(replay.derived_asset_id, receipt.derived_asset_id);
        assert_eq!(
            replay.package.final_package_path,
            receipt.package.final_package_path
        );
        assert_eq!(
            image::open(replay.payload_path)
                .unwrap()
                .to_rgb16()
                .dimensions(),
            (160, 96)
        );
    }
}
