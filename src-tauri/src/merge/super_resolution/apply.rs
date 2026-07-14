use std::{
    fs,
    path::Path,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use serde_json::json;
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
    candidate::{AcceptedBurstSrRuntime, validate},
};

static APPLY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BurstSrApplyRequest {
    candidate_id: String,
    accepted_review_hash: String,
    destination_directory: String,
    requested_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BurstSrApplyReceipt {
    schema_version: u32,
    candidate_id: String,
    candidate_hash: String,
    accepted_review_hash: String,
    derived_asset_id: String,
    payload_path: String,
    provenance_status: String,
    package: AtomicDerivedOutputReceipt,
}

#[tauri::command]
pub fn apply_burst_sr_candidate(
    request: BurstSrApplyRequest,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<BurstSrApplyReceipt, String> {
    validate_request(&request)?;
    let accepted = state
        .services
        .burst_sr
        .accepted_for_apply()
        .map_err(str::to_string)?;
    let cache_root = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| format!("invalid_candidate_cache_unavailable:{error}"))?
        .join("burst-sr-candidates");
    apply(&request, &accepted.runtime, &cache_root, || {
        state.services.burst_sr.authorize(&accepted)
    })
}

fn apply<A>(
    request: &BurstSrApplyRequest,
    accepted: &AcceptedBurstSrRuntime,
    cache_root: &Path,
    authorize_publish: A,
) -> Result<BurstSrApplyReceipt, String>
where
    A: FnOnce() -> Result<(), String>,
{
    let _guard = APPLY_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "sr_apply_lock_unavailable")?;
    let candidate = cache_root.join(&request.candidate_id);
    if !candidate.is_dir() {
        return Err("invalid_candidate_not_found".into());
    }
    let destination = Path::new(&request.destination_directory);
    reject_source_destination(destination, &accepted.paths)?;
    validate(&candidate, &accepted.identity).map_err(normalize_candidate_error)?;
    let candidate_hash = hash_file(
        &candidate.join("manifest.json"),
        "invalid_candidate_manifest_read",
    )?;
    if request.accepted_review_hash != candidate_hash {
        return Err("review_stale_hash".into());
    }
    if let Some(receipt) = replay(&candidate, request, &candidate_hash)? {
        return Ok(receipt);
    }
    validate_sources(accepted)?;

    let artifact = artifact::build(&candidate)?;
    let mut tx = AtomicDerivedOutputTransaction::begin(
        destination,
        &normalized_name(&request.requested_name),
    )?;
    tx.write_file("payload.tiff", &artifact.tiff)?;
    tx.write_file("previews/final.png", &artifact.preview)?;
    tx.write_file("previews/unsharpened.png", &artifact.preview)?;
    tx.write_file("previews/reference-baseline.png", &artifact.preview)?;
    let candidate_manifest = fs::read(candidate.join("manifest.json"))
        .map_err(|error| format!("invalid_candidate_manifest_missing:{error}"))?;
    let candidate_receipt = fs::read(candidate.join("receipt.json"))
        .map_err(|error| format!("invalid_candidate_receipt_missing:{error}"))?;
    tx.write_file("candidate/manifest.json", &candidate_manifest)?;
    tx.write_file("candidate/receipt.json", &candidate_receipt)?;
    let mut map_paths = vec![
        "candidate/manifest.json".into(),
        "candidate/receipt.json".into(),
    ];
    for (path, bytes) in artifact.rgb_tiles {
        tx.write_file(&path, &bytes)?;
        map_paths.push(path);
    }
    for (path, bytes) in artifact.map_tiles {
        tx.write_file(&path, &bytes)?;
        map_paths.push(path);
    }

    let derived_asset_id = format!("burst-sr:{}", candidate_hash.trim_start_matches("blake3:"));
    let graph_revisions: Vec<_> = accepted
        .identity
        .sources
        .iter()
        .map(|source| source.graph_revision.clone())
        .collect();
    let provenance = json!({
        "schemaVersion": 1, "family": "burst_super_resolution_x2", "format": "rapidraw_burst_sr_package_v1",
        "derivedAssetId": derived_asset_id, "candidateId": request.candidate_id, "candidateHash": candidate_hash,
        "acceptedReviewHash": request.accepted_review_hash, "sourceState": "current",
        "orderedSources": accepted.identity.sources, "sourceContentHashes": accepted.identity.source_hashes,
        "sourceGraphRevisions": graph_revisions, "planId": accepted.identity.plan_id, "planHash": accepted.identity.plan_hash,
        "registration": accepted.identity.registration, "reconstructionPolicyHash": accepted.identity.reconstruction_policy_hash,
        "previewHash": accepted.identity.preview_hash, "settings": accepted.identity.settings,
        "width": accepted.identity.width, "height": accepted.identity.height, "orientation": 1,
        "colorState": "scene_linear_camera_rgb", "basePayloadImmutable": true,
        "normalEditsUseDerivedGraph": true, "originalSourcesRequiredForExport": false,
        "enhancementEligibility": "already_super_resolved_x2"
    });
    tx.write_file(
        "provenance.json",
        &serde_json::to_vec(&provenance)
            .map_err(|error| format!("sr_apply_provenance_serialize_failed:{error}"))?,
    )?;
    let payload_hash = format!("blake3:{}", blake3::hash(&artifact.tiff).to_hex());
    let sidecar = build_derived_output_provenance_sidecar(DerivedOutputProvenanceInput {
        accepted_apply_id: Some(&derived_asset_id),
        accepted_dry_run_id: Some(&accepted.identity.plan_id),
        family: "burst_super_resolution_x2",
        output_artifact_id: &derived_asset_id,
        output_content_hash: &payload_hash,
        output_path: Path::new("payload.tiff"),
        settings_hash: accepted.identity.reconstruction_policy_hash.clone(),
        sources: accepted
            .paths
            .iter()
            .zip(&accepted.identity.sources)
            .map(|(path, source)| DerivedOutputProvenanceSource {
                content_hash: source.content_hash.clone(),
                graph_revision: &source.graph_revision,
                path,
            })
            .collect(),
        warnings: Vec::new(),
    });
    tx.write_file(
        "payload.tiff.rrdata",
        &serde_json::to_vec(&sidecar)
            .map_err(|error| format!("sr_apply_sidecar_serialize_failed:{error}"))?,
    )?;
    map_paths.extend(["provenance.json".into(), "payload.tiff.rrdata".into()]);
    let manifest = DerivedOutputManifest {
        schema_version: 1,
        family: "burst_super_resolution_x2".into(),
        width: accepted.identity.width.into(),
        height: accepted.identity.height.into(),
        payload_path: "payload.tiff".into(),
        preview_paths: vec![
            "previews/final.png".into(),
            "previews/unsharpened.png".into(),
            "previews/reference-baseline.png".into(),
        ],
        map_paths,
        source_immutability_hashes: accepted.identity.source_hashes.clone(),
    };
    tx.stage_manifest(&manifest)?;
    validate(&candidate, &accepted.identity).map_err(normalize_candidate_error)?;
    validate_sources(accepted)?;
    let package = tx.commit_guarded(&manifest, authorize_publish, |_| Ok(()))?;
    let payload_path = Path::new(&package.final_package_path)
        .join("payload.tiff")
        .to_string_lossy()
        .into_owned();
    let receipt = BurstSrApplyReceipt {
        schema_version: 1,
        candidate_id: request.candidate_id.clone(),
        candidate_hash,
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
    .map_err(|error| format!("sr_apply_consumed_marker_failed:{error}"))?;
    Ok(receipt)
}

fn validate_request(request: &BurstSrApplyRequest) -> Result<(), String> {
    if request.candidate_id.is_empty() || request.candidate_id.contains(['/', '\\']) {
        return Err("invalid_candidate_id".into());
    }
    if request.accepted_review_hash.is_empty() {
        return Err("review_acceptance_missing".into());
    }
    if request.destination_directory.trim().is_empty() || request.requested_name.trim().is_empty() {
        return Err("destination_invalid".into());
    }
    Ok(())
}

fn validate_sources(accepted: &AcceptedBurstSrRuntime) -> Result<(), String> {
    if accepted.paths.len() != accepted.identity.source_hashes.len() {
        return Err("stale_source_order".into());
    }
    for (path, expected) in accepted.paths.iter().zip(&accepted.identity.source_hashes) {
        if hash_file(Path::new(path), "stale_source_unavailable")? != *expected {
            return Err("stale_source_bytes".into());
        }
    }
    Ok(())
}

fn reject_source_destination(destination: &Path, sources: &[String]) -> Result<(), String> {
    let destination = destination
        .canonicalize()
        .map_err(|error| format!("destination_unwritable:{error}"))?;
    if sources.iter().any(|source| {
        Path::new(source) == destination
            || Path::new(source)
                .canonicalize()
                .is_ok_and(|path| path == destination)
    }) {
        return Err("destination_is_source_path".into());
    }
    Ok(())
}

fn hash_file(path: &Path, code: &str) -> Result<String, String> {
    fs::read(path)
        .map(|bytes| format!("blake3:{}", blake3::hash(&bytes).to_hex()))
        .map_err(|error| format!("{code}:{error}"))
}

fn normalized_name(name: &str) -> String {
    format!("{}.rrsr", name.trim().trim_end_matches(".rrsr"))
}
fn normalize_candidate_error(error: String) -> String {
    if error.contains("identity") {
        "stale_candidate_identity".into()
    } else if error.contains("hash") {
        "invalid_candidate_hash".into()
    } else {
        format!("invalid_candidate:{error}")
    }
}

fn replay(
    candidate: &Path,
    request: &BurstSrApplyRequest,
    candidate_hash: &str,
) -> Result<Option<BurstSrApplyReceipt>, String> {
    let path = candidate.join("CONSUMED.json");
    if !path.exists() {
        return Ok(None);
    }
    let receipt: BurstSrApplyReceipt =
        serde_json::from_slice(&fs::read(path).map_err(|_| "invalid_candidate_consumed_receipt")?)
            .map_err(|_| "invalid_candidate_consumed_receipt")?;
    if receipt.candidate_hash != candidate_hash
        || receipt.accepted_review_hash != request.accepted_review_hash
    {
        return Err("invalid_candidate_consumed_identity".into());
    }
    let package = Path::new(&receipt.package.final_package_path);
    if !package.join("COMMIT_READY").is_file()
        || !package.join("inventory.json").is_file()
        || !Path::new(&receipt.payload_path).is_file()
    {
        return Err("invalid_candidate_consumed_output_missing".into());
    }
    Ok(Some(receipt))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> BurstSrApplyRequest {
        BurstSrApplyRequest {
            candidate_id: "burst-sr-candidate-abc".into(),
            accepted_review_hash: "blake3:review".into(),
            destination_directory: "/tmp".into(),
            requested_name: "IMG_0001-Burst-SR-x2".into(),
        }
    }

    #[test]
    fn request_rejects_paths_and_missing_review_acceptance() {
        let mut invalid = request();
        invalid.candidate_id = "../candidate".into();
        assert_eq!(
            validate_request(&invalid).unwrap_err(),
            "invalid_candidate_id"
        );
        invalid = request();
        invalid.accepted_review_hash.clear();
        assert_eq!(
            validate_request(&invalid).unwrap_err(),
            "review_acceptance_missing"
        );
    }

    #[test]
    fn package_name_is_burst_specific_and_not_overwriting_source_format() {
        assert_eq!(
            normalized_name("IMG_0001-Burst-SR-x2"),
            "IMG_0001-Burst-SR-x2.rrsr"
        );
        assert_eq!(normalized_name("result.rrsr"), "result.rrsr");
    }
}
