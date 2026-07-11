use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Instant,
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::merge::{
    computational_job::{
        ComputationalMergeCancellationToken, ComputationalMergeJobId, ComputationalMergeJobRegistry,
    },
    derived_output_provenance::stable_hash,
    tile_runtime::AcceptedTilePlan,
};

use super::{
    fallback::compose_reference_fallback,
    fused_color::reconstruct_color,
    motion::classify_regions,
    quality::evaluate,
    raw_frame::{CfaClass, SuperResolutionBayerBurstSource, SuperResolutionReadinessSettings},
    reconstruction::{OutputTile, reconstruct_plane_tile},
    registration::SuperResolutionRegistrationResult,
    sharpen::sharpen_supported,
};

const FORMAT_ID: &str = "rapidraw_burst_sr_candidate_v1";

struct StagingGuard(PathBuf);
impl Drop for StagingGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedBurstSrIdentity {
    pub review_id: String,
    pub plan_id: String,
    pub plan_hash: String,
    pub source_hashes: Vec<String>,
    pub sources: Vec<SuperResolutionBayerBurstSource>,
    pub settings: SuperResolutionReadinessSettings,
    pub registration: SuperResolutionRegistrationResult,
    pub reconstruction_policy_hash: String,
    pub preview_hash: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug)]
pub struct AcceptedBurstSrRuntime {
    pub identity: AcceptedBurstSrIdentity,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BurstSrCandidateHandle {
    pub package_id: String,
    pub manifest_handle: String,
    pub candidate_hash: String,
    pub commit_ready: bool,
    pub capability_state: String,
    pub width: u32,
    pub height: u32,
    pub tile_count: u64,
    pub observed_peak_memory_bytes: u64,
    pub memory_budget_bytes: u64,
    pub quality_decision: String,
}

pub(crate) struct CandidateOutput {
    pub handle: BurstSrCandidateHandle,
    pub path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TileEntry {
    index: u64,
    x: u64,
    y: u64,
    width: u32,
    height: u32,
    rgb_hash: String,
    maps_hash: String,
}

fn checkpoint(token: &ComputationalMergeCancellationToken) -> Result<(), String> {
    token
        .checkpoint()
        .map_err(|_| "computational_merge_cancelled".into())
}
fn file_hash(path: &Path) -> Result<String, String> {
    Ok(format!(
        "blake3:{}",
        blake3::hash(&fs::read(path).map_err(|e| format!("sr_candidate_read_failed:{e}"))?)
            .to_hex()
    ))
}
fn write(path: &Path, bytes: &[u8]) -> Result<String, String> {
    fs::write(path, bytes).map_err(|e| format!("sr_candidate_write_failed:{e}"))?;
    Ok(format!("blake3:{}", blake3::hash(bytes).to_hex()))
}

fn resident_memory_bytes() -> u64 {
    let mut system = sysinfo::System::new();
    if let Ok(pid) = sysinfo::get_current_pid() {
        system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
        return system.process(pid).map_or(0, |process| process.memory());
    }
    0
}

pub(crate) fn prepare(
    root: &Path,
    accepted: &AcceptedBurstSrRuntime,
    plan: &AcceptedTilePlan,
    job_id: &ComputationalMergeJobId,
    token: &ComputationalMergeCancellationToken,
    registry: &ComputationalMergeJobRegistry,
) -> Result<CandidateOutput, String> {
    if accepted.paths.len() != accepted.identity.source_hashes.len() {
        return Err("sr_candidate_source_identity_mismatch".into());
    }
    let package_id = format!(
        "burst-sr-candidate-{}",
        accepted
            .identity
            .plan_hash
            .trim_start_matches("blake3:")
            .get(..24)
            .unwrap_or("invalid")
    );
    let final_path = root.join(&package_id);
    let staging = root.join(format!(".{package_id}.staging-{job_id}"));
    let _ = fs::remove_dir_all(&staging);
    let _guard = StagingGuard(staging.clone());
    fs::create_dir_all(staging.join("rgb"))
        .map_err(|e| format!("sr_candidate_staging_failed:{e}"))?;
    fs::create_dir_all(staging.join("maps"))
        .map_err(|e| format!("sr_candidate_staging_failed:{e}"))?;
    let cache_root = staging.join("cfa-cache");
    fs::create_dir_all(&cache_root).map_err(|e| format!("sr_cfa_cache_create_failed:{e}"))?;
    checkpoint(token)?;
    let started = Instant::now();
    let baseline_memory = resident_memory_bytes();
    let mut observed_peak = baseline_memory;
    let cancel = AtomicBool::new(false);
    let mut caches = Vec::new();
    for (index, path) in accepted.paths.iter().enumerate() {
        checkpoint(token)?;
        let frame = super::raw_frame::decode_bayer_burst_frame(
            path,
            index,
            accepted.identity.settings.max_preview_dimension_px,
            &cancel,
        )?;
        if frame.source.content_hash != accepted.identity.source_hashes[index] {
            return Err("sr_candidate_source_stale".into());
        }
        caches.push(super::cfa_cache::write(&cache_root, frame)?);
        observed_peak = observed_peak.max(resident_memory_bytes());
        if observed_peak.saturating_sub(baseline_memory) > plan.memory_budget_bytes * 110 / 100 {
            return Err("sr_candidate_memory_budget_exceeded".into());
        }
        checkpoint(token)?;
        registry.publish_progress(
            job_id,
            "sequential_cfa_cache",
            (index + 1) as u64,
            accepted.paths.len() as u64 + plan.tile_count,
            12,
            None,
        )?;
        observed_peak = observed_peak.max(resident_memory_bytes());
        if observed_peak.saturating_sub(baseline_memory) > plan.memory_budget_bytes * 110 / 100 {
            return Err("sr_candidate_memory_budget_exceeded".into());
        }
    }
    let mut frames = Vec::with_capacity(caches.len());
    for cache in &caches {
        checkpoint(token)?;
        frames.push(super::cfa_cache::read_frame(&cache_root, cache)?);
    }
    let overlap = super::cfa_observations::common_overlap(
        &frames,
        &accepted.identity.registration.transforms,
    )?;
    let reference = frames
        .iter()
        .find(|frame| {
            frame.source.source_index == accepted.identity.registration.reference_source_index
        })
        .ok_or("registration_reference_identity_mismatch")?;
    let mut entries = Vec::new();
    let mut quality_decisions = Vec::new();
    for tile in &plan.tiles {
        checkpoint(token)?;
        let halo = u64::from(plan.halo.left);
        let x0 = tile.core_x.saturating_sub(halo) as u32;
        let y0 = tile.core_y.saturating_sub(halo) as u32;
        let x1 = (tile.core_x + u64::from(tile.core_width) + halo)
            .min(u64::from(accepted.identity.width)) as u32;
        let y1 = (tile.core_y + u64::from(tile.core_height) + halo)
            .min(u64::from(accepted.identity.height)) as u32;
        let work = OutputTile {
            x: x0,
            y: y0,
            width: x1 - x0,
            height: y1 - y0,
        };
        let mut planes = Vec::new();
        for class in [CfaClass::R, CfaClass::G1, CfaClass::G2, CfaClass::B] {
            checkpoint(token)?;
            planes.push(reconstruct_plane_tile(
                &frames,
                &accepted.identity.registration.transforms,
                overlap,
                class,
                work,
                &cancel,
            )?);
        }
        let count = (work.width * work.height) as usize;
        let mut fused = vec![[0.0; 3]; count];
        let mut baseline = vec![[0.0; 3]; count];
        for y in 0..work.height {
            for x in 0..work.width {
                let at = (y * work.width + x) as usize;
                let base = super::runtime::baseline_rgb_at(reference, overlap, work, x, y);
                let color = reconstruct_color(
                    planes[0].estimates[at],
                    planes[1].estimates[at],
                    planes[2].estimates[at],
                    planes[3].estimates[at],
                    base,
                    reference.source.calibration.white_balance,
                );
                baseline[at] = base;
                fused[at] = if color.fallback { base } else { color.rgb };
            }
        }
        let analysis = classify_regions(
            &planes,
            accepted
                .identity
                .registration
                .summary
                .p95_residual_px
                .max(0.01),
        );
        let (fallback, _) = compose_reference_fallback(
            &fused,
            &baseline,
            &analysis.classes,
            work.width,
            work.height,
        );
        let (final_rgb, strengths) = sharpen_supported(
            &fallback,
            &analysis.classes,
            &analysis.confidence,
            work.width,
            work.height,
        );
        let quality = evaluate(
            &baseline,
            &fallback,
            &final_rgb,
            &analysis.classes,
            work.width,
        );
        quality_decisions.push(quality.decision);
        let core_dx = tile.core_x as u32 - x0;
        let core_dy = tile.core_y as u32 - y0;
        let mut rgb_bytes =
            Vec::with_capacity(tile.core_width as usize * tile.core_height as usize * 12);
        let mut map_bytes =
            Vec::with_capacity(tile.core_width as usize * tile.core_height as usize * 68);
        for y in 0..tile.core_height {
            for x in 0..tile.core_width {
                let at = ((core_dy + y) * work.width + core_dx + x) as usize;
                for channel in final_rgb[at] {
                    rgb_bytes.extend_from_slice(&channel.to_le_bytes());
                }
                for plane in &planes {
                    let sample = plane.estimates[at];
                    for value in [
                        sample.effective_samples,
                        sample.variance,
                        sample.residual,
                        sample.outlier_ratio,
                    ] {
                        map_bytes.extend_from_slice(&value.to_le_bytes());
                    }
                }
                map_bytes.push(analysis.classes[at] as u8);
                map_bytes.extend_from_slice(&strengths[at].to_le_bytes());
            }
        }
        let name = format!("{:08}.bin", tile.index);
        entries.push(TileEntry {
            index: tile.index,
            x: tile.core_x,
            y: tile.core_y,
            width: tile.core_width,
            height: tile.core_height,
            rgb_hash: write(&staging.join("rgb").join(&name), &rgb_bytes)?,
            maps_hash: write(&staging.join("maps").join(name), &map_bytes)?,
        });
        registry.publish_progress(
            job_id,
            "full_resolution_tiles",
            accepted.paths.len() as u64 + tile.index + 1,
            accepted.paths.len() as u64 + plan.tile_count,
            75,
            None,
        )?;
    }
    checkpoint(token)?;
    let commit_ready = quality_decisions
        .iter()
        .all(|decision| *decision == "apply_ready");
    let quality_decision = if commit_ready {
        "commit_ready"
    } else {
        "review_required"
    };
    let inventory = json!({"formatId": FORMAT_ID, "tiles": entries});
    let manifest = json!({"schemaVersion": 1, "formatId": FORMAT_ID, "packageId": package_id, "temporary": true, "commitReady": commit_ready, "capabilityState": if commit_ready { "durable_commit_pending" } else { "review_required" }, "qualityDecision": quality_decision, "acceptedReview": accepted.identity, "tilePlan": plan, "inventoryHash": stable_hash(&inventory), "inventory": inventory, "supportMath": {"reconstructionRadius": super::tiles::RECONSTRUCTION_RADIUS, "motionBlock": super::tiles::MOTION_BLOCK, "motionDilation": super::tiles::MOTION_DILATION, "fallbackTransition": super::tiles::FALLBACK_TRANSITION, "sharpenRadius": super::tiles::SHARPEN_RADIUS, "influenceHaloPx": super::tiles::influence_halo()}, "edgePolicy": "real_neighbor_halo_clamp_only_at_image_boundary"});
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    let candidate_hash = write(&staging.join("manifest.json"), &manifest_bytes)?;
    let observed_peak = observed_peak.saturating_sub(baseline_memory);
    write(&staging.join("receipt.json"), &serde_json::to_vec_pretty(&json!({"schemaVersion":1,"observedPeakMemoryBytes":observed_peak,"memoryBudgetBytes":plan.memory_budget_bytes,"elapsedMs":started.elapsed().as_secs_f64()*1000.0,"tileCount":plan.tile_count,"backend":"cpu"})).map_err(|e| e.to_string())?)?;
    validate(&staging, &accepted.identity)?;
    checkpoint(token)?;
    let _ = fs::remove_dir_all(&final_path);
    fs::rename(&staging, &final_path).map_err(|e| format!("sr_candidate_finalize_failed:{e}"))?;
    if token.checkpoint().is_err() {
        let _ = fs::remove_dir_all(&final_path);
        return Err("computational_merge_cancelled".into());
    }
    registry
        .publish_progress(job_id, "complete", 1, 1, 100, None)
        .inspect_err(|_error| {
            let _ = fs::remove_dir_all(&final_path);
        })?;
    Ok(CandidateOutput {
        path: final_path,
        handle: BurstSrCandidateHandle {
            package_id: package_id.clone(),
            manifest_handle: format!("rawengine-cache://{package_id}/manifest.json"),
            candidate_hash,
            commit_ready,
            capability_state: if commit_ready {
                "durable_commit_pending".into()
            } else {
                "review_required".into()
            },
            width: accepted.identity.width,
            height: accepted.identity.height,
            tile_count: plan.tile_count,
            observed_peak_memory_bytes: observed_peak,
            memory_budget_bytes: plan.memory_budget_bytes,
            quality_decision: quality_decision.into(),
        },
    })
}

pub(crate) fn validate(path: &Path, identity: &AcceptedBurstSrIdentity) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_slice(
        &fs::read(path.join("manifest.json"))
            .map_err(|e| format!("sr_candidate_manifest_missing:{e}"))?,
    )
    .map_err(|e| format!("sr_candidate_manifest_invalid:{e}"))?;
    if value["formatId"] != FORMAT_ID
        || value["temporary"] != true
        || value["commitReady"] != true
        || value["qualityDecision"] != "commit_ready"
        || value["acceptedReview"]["planHash"] != identity.plan_hash
        || value["acceptedReview"]["reviewId"] != identity.review_id
        || value["acceptedReview"]["previewHash"] != identity.preview_hash
        || value["acceptedReview"]["reconstructionPolicyHash"]
            != identity.reconstruction_policy_hash
        || value["acceptedReview"]["sourceHashes"]
            != serde_json::to_value(&identity.source_hashes).unwrap_or_default()
        || value["acceptedReview"]["sources"]
            != serde_json::to_value(&identity.sources).unwrap_or_default()
        || value["acceptedReview"]["registration"]
            != serde_json::to_value(&identity.registration).unwrap_or_default()
        || value["acceptedReview"]["settings"]
            != serde_json::to_value(&identity.settings).unwrap_or_default()
        || value["acceptedReview"]["width"] != identity.width
        || value["acceptedReview"]["height"] != identity.height
        || value["inventoryHash"] != stable_hash(&value["inventory"])
    {
        return Err("sr_candidate_manifest_identity_mismatch".into());
    }
    let tiles = value["inventory"]["tiles"]
        .as_array()
        .ok_or("sr_candidate_tiles_missing")?;
    if tiles.is_empty() || value["tilePlan"]["tileCount"].as_u64() != Some(tiles.len() as u64) {
        return Err("sr_candidate_tile_inventory_invalid".into());
    }
    for (expected_index, tile) in tiles.iter().enumerate() {
        if tile["index"].as_u64() != Some(expected_index as u64)
            || tile["width"].as_u64().unwrap_or(0) == 0
            || tile["height"].as_u64().unwrap_or(0) == 0
        {
            return Err("sr_candidate_tile_index_invalid".into());
        }
        let name = format!(
            "{:08}.bin",
            tile["index"]
                .as_u64()
                .ok_or("sr_candidate_tile_index_invalid")?
        );
        let pixels = tile["width"].as_u64().unwrap() * tile["height"].as_u64().unwrap();
        if fs::metadata(path.join("rgb").join(&name))
            .map_err(|_| "sr_candidate_rgb_missing")?
            .len()
            != pixels * 12
            || fs::metadata(path.join("maps").join(&name))
                .map_err(|_| "sr_candidate_maps_missing")?
                .len()
                != pixels * 68
        {
            return Err("sr_candidate_tile_length_mismatch".into());
        }
        if file_hash(&path.join("rgb").join(&name))? != tile["rgbHash"].as_str().unwrap_or_default()
            || file_hash(&path.join("maps").join(name))?
                != tile["mapsHash"].as_str().unwrap_or_default()
        {
            return Err("sr_candidate_tile_hash_mismatch".into());
        }
    }
    Ok(())
}
