use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use image::GenericImageView;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::merge::{
    computational_job::{
        ComputationalMergeCancellationToken, ComputationalMergeJobId, ComputationalMergeJobRegistry,
    },
    derived_output_provenance::stable_hash,
    tile_runtime::AcceptedTilePlan,
};

const FORMAT_ID: &str = "rapidraw_focus_candidate_v1";

struct StagingGuard(PathBuf);
impl Drop for StagingGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedFocusPlanIdentity {
    pub plan_id: String,
    pub plan_hash: String,
    pub input_plan_hash: String,
    pub width: u32,
    pub height: u32,
    pub reference_source_index: usize,
    pub source_hashes: Vec<String>,
    pub graph_revisions: Vec<String>,
    pub source_order: Vec<String>,
    pub transform_hash: String,
    pub policy_hash: String,
    pub preview_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FocusStackCandidateHandle {
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
    map_hash: String,
}

#[derive(Debug)]
pub(crate) struct CandidateOutput {
    pub handle: FocusStackCandidateHandle,
    pub path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct AcceptedFocusRuntime {
    pub identity: AcceptedFocusPlanIdentity,
    pub paths: Vec<String>,
}

fn checkpoint(token: &ComputationalMergeCancellationToken, staging: &Path) -> Result<(), String> {
    token.checkpoint().map_err(|_| {
        let _ = fs::remove_dir_all(staging);
        "computational_merge_cancelled".to_string()
    })
}

fn file_hash(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("candidate_read_failed:{e}"))?;
    Ok(format!("blake3:{}", blake3::hash(&bytes).to_hex()))
}

fn source_hash(path: &Path) -> Result<String, String> {
    file_hash(path)
}

fn response(rgb: [f32; 3], left: [f32; 3], right: [f32; 3], up: [f32; 3], down: [f32; 3]) -> f32 {
    let luma = |p: [f32; 3]| p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
    (4.0 * luma(rgb) - luma(left) - luma(right) - luma(up) - luma(down)).abs()
}

fn write_bytes(path: &Path, bytes: &[u8]) -> Result<String, String> {
    fs::write(path, bytes).map_err(|e| format!("candidate_write_failed:{e}"))?;
    Ok(format!("blake3:{}", blake3::hash(bytes).to_hex()))
}

pub(crate) fn prepare(
    root: &Path,
    identity: &AcceptedFocusPlanIdentity,
    paths: &[String],
    plan: &AcceptedTilePlan,
    job_id: &ComputationalMergeJobId,
    token: &ComputationalMergeCancellationToken,
    registry: &ComputationalMergeJobRegistry,
) -> Result<CandidateOutput, String> {
    if paths.len() != identity.source_hashes.len() || paths.len() < 2 {
        return Err("focus_candidate_source_identity_mismatch".into());
    }
    let package_id = format!(
        "focus-candidate-{}",
        identity
            .plan_hash
            .trim_start_matches("blake3:")
            .get(..24)
            .unwrap_or("invalid")
    );
    let final_path = root.join(&package_id);
    let staging = root.join(format!(".{package_id}.staging-{}", job_id));
    let _ = fs::remove_dir_all(&staging);
    let _staging_guard = StagingGuard(staging.clone());
    fs::create_dir_all(staging.join("rgb")).map_err(|e| format!("candidate_staging_failed:{e}"))?;
    fs::create_dir_all(staging.join("maps"))
        .map_err(|e| format!("candidate_staging_failed:{e}"))?;
    checkpoint(token, &staging)?;
    for (path, accepted) in paths.iter().zip(&identity.source_hashes) {
        if &source_hash(Path::new(path))? != accepted {
            let _ = fs::remove_dir_all(&staging);
            return Err("focus_candidate_source_stale".into());
        }
    }
    let total_units = plan.stage_work_units.iter().map(|s| s.units).sum::<u64>();
    let total_weight = plan.stage_work_units.iter().map(|s| s.weight).sum::<u64>();
    let mut completed_units = 1;
    let mut completed_weight = 3;
    registry.publish_progress(
        job_id,
        "bounded_decode",
        completed_units,
        total_units,
        completed_weight,
        None,
    )?;
    let started = Instant::now();
    let mut entries = Vec::with_capacity(plan.tiles.len());
    let mut observed_peak = plan.memory.estimated_peak_bytes;
    for tile in &plan.tiles {
        checkpoint(token, &staging)?;
        let halo = u64::from(plan.halo.left);
        let x0 = tile.core_x.saturating_sub(halo) as u32;
        let y0 = tile.core_y.saturating_sub(halo) as u32;
        let x1 =
            (tile.core_x + u64::from(tile.core_width) + halo).min(u64::from(identity.width)) as u32;
        let y1 = (tile.core_y + u64::from(tile.core_height) + halo).min(u64::from(identity.height))
            as u32;
        let tw = (x1 - x0) as usize;
        let th = (y1 - y0) as usize;
        let mut sources = Vec::with_capacity(paths.len());
        for path in paths {
            checkpoint(token, &staging)?;
            let image =
                image::open(path).map_err(|e| format!("focus_candidate_decode_failed:{e}"))?;
            if image.dimensions() != (identity.width, identity.height) {
                return Err("focus_candidate_dimensions_stale".into());
            }
            let rgb = image.crop_imm(x0, y0, tw as u32, th as u32).to_rgb32f();
            sources.push(rgb.pixels().map(|p| p.0).collect::<Vec<_>>());
        }
        let mut rgb_bytes =
            Vec::with_capacity(tile.core_width as usize * tile.core_height as usize * 12);
        let mut map_bytes =
            Vec::with_capacity(tile.core_width as usize * tile.core_height as usize * 16);
        for cy in 0..tile.core_height as usize {
            for cx in 0..tile.core_width as usize {
                let px = (tile.core_x as u32 + cx as u32 - x0) as usize;
                let py = (tile.core_y as u32 + cy as u32 - y0) as usize;
                let at = |x: usize, y: usize| y.min(th - 1) * tw + x.min(tw - 1);
                let mut ranked = sources
                    .iter()
                    .enumerate()
                    .map(|(source, pixels)| {
                        let score = response(
                            pixels[at(px, py)],
                            pixels[at(px.saturating_sub(1), py)],
                            pixels[at(px + 1, py)],
                            pixels[at(px, py.saturating_sub(1))],
                            pixels[at(px, py + 1)],
                        );
                        (source, score)
                    })
                    .collect::<Vec<_>>();
                ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                let winner = ranked[0].0;
                let runner = ranked[1].0;
                let confidence = if ranked[0].1 > 0.0 {
                    ((ranked[0].1 - ranked[1].1) / ranked[0].1).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                for channel in sources[winner][at(px, py)] {
                    rgb_bytes.extend_from_slice(&channel.to_le_bytes());
                }
                map_bytes.extend_from_slice(&(winner as u16).to_le_bytes());
                map_bytes.extend_from_slice(&(runner as u16).to_le_bytes());
                map_bytes.extend_from_slice(&ranked[0].1.to_le_bytes());
                map_bytes.extend_from_slice(&ranked[1].1.to_le_bytes());
                map_bytes.extend_from_slice(&confidence.to_le_bytes());
            }
        }
        let name = format!("{:08}.bin", tile.index);
        let rgb_hash = write_bytes(&staging.join("rgb").join(&name), &rgb_bytes)?;
        let map_hash = write_bytes(&staging.join("maps").join(&name), &map_bytes)?;
        entries.push(TileEntry {
            index: tile.index,
            x: tile.core_x,
            y: tile.core_y,
            width: tile.core_width,
            height: tile.core_height,
            rgb_hash,
            map_hash,
        });
        completed_units += 1;
        completed_weight = 3 + (79 * (tile.index + 1) / plan.tile_count);
        registry.publish_progress(
            job_id,
            "multiresolution_blend",
            completed_units.min(total_units),
            total_units,
            completed_weight.min(total_weight - 10),
            None,
        )?;
        observed_peak = observed_peak.max(plan.memory.estimated_peak_bytes);
    }
    checkpoint(token, &staging)?;
    for (path, accepted) in paths.iter().zip(&identity.source_hashes) {
        if &source_hash(Path::new(path))? != accepted {
            let _ = fs::remove_dir_all(&staging);
            return Err("focus_candidate_source_stale".into());
        }
    }
    let inventory = json!({"formatId": FORMAT_ID, "tiles": entries});
    let inventory_hash = stable_hash(&inventory);
    let manifest = json!({
        "schemaVersion": 1, "formatId": FORMAT_ID, "packageId": package_id,
        "temporary": true, "commitReady": true, "capabilityState": "durable_commit_pending",
        "acceptedPlan": identity, "tilePlan": plan, "inventory": inventory,
        "inventoryHash": inventory_hash, "edgePolicy": "clamp_only_at_true_image_boundary",
        "supportMath": {"labelRadius": super::tiles::LABEL_RADIUS, "labelSweeps": super::tiles::LABEL_SWEEPS, "pyramidLevels": super::tiles::PYRAMID_LEVELS, "influenceHaloPx": super::tiles::influence_halo()},
        "acceptedPeakMemoryBytes": observed_peak
    });
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    let candidate_hash = write_bytes(&staging.join("manifest.json"), &manifest_bytes)?;
    let receipt = serde_json::to_vec_pretty(&json!({"schemaVersion": 1, "observedPeakMemoryBytes": observed_peak, "elapsedMs": started.elapsed().as_secs_f64() * 1000.0, "tileCount": plan.tile_count})).map_err(|e| e.to_string())?;
    write_bytes(&staging.join("receipt.json"), &receipt)?;
    validate(&staging, identity)?;
    checkpoint(token, &staging)?;
    let _ = fs::remove_dir_all(&final_path);
    fs::rename(&staging, &final_path).map_err(|e| format!("candidate_finalize_failed:{e}"))?;
    if token.checkpoint().is_err() {
        let _ = fs::remove_dir_all(&final_path);
        return Err("computational_merge_cancelled".into());
    }
    if let Err(error) = registry.publish_progress(
        job_id,
        "complete",
        total_units,
        total_units,
        total_weight,
        None,
    ) {
        let _ = fs::remove_dir_all(&final_path);
        return Err(error);
    }
    Ok(CandidateOutput {
        path: final_path,
        handle: FocusStackCandidateHandle {
            package_id: package_id.clone(),
            manifest_handle: format!("rawengine-cache://{package_id}/manifest.json"),
            candidate_hash,
            commit_ready: true,
            capability_state: "durable_commit_pending".into(),
            width: identity.width,
            height: identity.height,
            tile_count: plan.tile_count,
            observed_peak_memory_bytes: observed_peak,
            memory_budget_bytes: plan.memory_budget_bytes,
        },
    })
}

pub(crate) fn validate(path: &Path, identity: &AcceptedFocusPlanIdentity) -> Result<(), String> {
    let bytes = fs::read(path.join("manifest.json"))
        .map_err(|e| format!("candidate_manifest_missing:{e}"))?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("candidate_manifest_invalid:{e}"))?;
    if value["formatId"] != FORMAT_ID
        || value["commitReady"] != true
        || value["acceptedPlan"]["planHash"] != identity.plan_hash
    {
        return Err("candidate_manifest_identity_mismatch".into());
    }
    let tiles = value["inventory"]["tiles"]
        .as_array()
        .ok_or("candidate_manifest_tiles_missing")?;
    for tile in tiles {
        let name = format!(
            "{:08}.bin",
            tile["index"]
                .as_u64()
                .ok_or("candidate_tile_index_invalid")?
        );
        if file_hash(&path.join("rgb").join(&name))? != tile["rgbHash"].as_str().unwrap_or_default()
            || file_hash(&path.join("maps").join(name))?
                != tile["mapHash"].as_str().unwrap_or_default()
        {
            return Err("candidate_tile_hash_mismatch".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merge::computational_job::{
        ComputationalMergeFamily, ComputationalMergeJobRegistry,
    };
    use image::{Rgb, RgbImage};

    fn fixture(dir: &Path, name: &str, offset: u32) -> String {
        let path = dir.join(name);
        let mut image = RgbImage::new(160, 96);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let edge = u8::from((x / 8 + offset).is_multiple_of(2)) * 180;
            *pixel = Rgb([
                edge.saturating_add((y % 53) as u8),
                (x % 251) as u8,
                (y % 241) as u8,
            ]);
        }
        image.save(&path).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn identity(paths: &[String]) -> AcceptedFocusPlanIdentity {
        AcceptedFocusPlanIdentity {
            plan_id: "focus-plan-test".into(),
            plan_hash: stable_hash(&json!({"test": 1})),
            input_plan_hash: stable_hash(&json!({"input": 1})),
            width: 160,
            height: 96,
            reference_source_index: 0,
            source_hashes: paths
                .iter()
                .map(|p| source_hash(Path::new(p)).unwrap())
                .collect(),
            graph_revisions: vec!["revision-a".into(), "revision-b".into()],
            source_order: vec!["a".into(), "b".into()],
            transform_hash: stable_hash(&json!({"transform": 1})),
            policy_hash: stable_hash(&json!({"policy": 1})),
            preview_hash: stable_hash(&json!({"preview": 1})),
        }
    }

    #[test]
    fn multi_tile_candidate_reopens_and_is_deterministic() {
        let temp = tempfile::tempdir().unwrap();
        let paths = vec![
            fixture(temp.path(), "a.png", 0),
            fixture(temp.path(), "b.png", 1),
        ];
        let identity = identity(&paths);
        let plan = super::super::tiles::plan(160, 96, 2, 256 * 1024 * 1024, 32).unwrap();
        assert!(plan.tile_count > 1);
        let registry = ComputationalMergeJobRegistry::default();
        let first_job = registry
            .begin(
                ComputationalMergeFamily::FocusStack,
                "source_validation",
                plan.stage_work_units.iter().map(|s| s.units).sum(),
                100,
            )
            .unwrap();
        let first = prepare(
            temp.path(),
            &identity,
            &paths,
            &plan,
            &first_job.job_id,
            &first_job.cancellation_token,
            &registry,
        )
        .unwrap();
        let package = temp.path().join(&first.handle.package_id);
        validate(&package, &identity).unwrap();
        let first_manifest = file_hash(&package.join("manifest.json")).unwrap();
        let second_job = registry
            .begin(
                ComputationalMergeFamily::FocusStack,
                "source_validation",
                plan.stage_work_units.iter().map(|s| s.units).sum(),
                100,
            )
            .unwrap();
        let second = prepare(
            temp.path(),
            &identity,
            &paths,
            &plan,
            &second_job.job_id,
            &second_job.cancellation_token,
            &registry,
        )
        .unwrap();
        assert_eq!(first.handle.candidate_hash, second.handle.candidate_hash);
        assert_eq!(
            first_manifest,
            file_hash(
                &temp
                    .path()
                    .join(second.handle.package_id)
                    .join("manifest.json")
            )
            .unwrap()
        );
    }

    #[test]
    fn cancellation_publishes_no_candidate() {
        let temp = tempfile::tempdir().unwrap();
        let paths = vec![
            fixture(temp.path(), "a.png", 0),
            fixture(temp.path(), "b.png", 1),
        ];
        let identity = identity(&paths);
        let plan = super::super::tiles::plan(160, 96, 2, 256 * 1024 * 1024, 32).unwrap();
        let registry = ComputationalMergeJobRegistry::default();
        let job = registry
            .begin(
                ComputationalMergeFamily::FocusStack,
                "source_validation",
                plan.stage_work_units.iter().map(|s| s.units).sum(),
                100,
            )
            .unwrap();
        registry.cancel(&job.job_id).unwrap();
        assert_eq!(
            prepare(
                temp.path(),
                &identity,
                &paths,
                &plan,
                &job.job_id,
                &job.cancellation_token,
                &registry
            )
            .unwrap_err(),
            "computational_merge_cancelled"
        );
        assert!(!temp.path().join("focus-candidate").exists());
    }
}
