use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use image::DynamicImage;
use serde::Serialize;
use tauri::Emitter;

use crate::ImageDimensions;
use crate::app_settings::load_settings_or_default;
use crate::app_state::AppState;
use crate::exif_processing::{read_exposure_time_secs, read_iso};
use crate::file_management::parse_virtual_path;
use crate::hdr_artifact_sidecar::write_hdr_output_sidecar;
use crate::image_codecs::encode_png_data_url;
use crate::image_loader::load_base_image_from_bytes;
use crate::image_processing::apply_srgb_to_linear;
use crate::merge::atomic_derived_output::{AtomicDerivedOutputTransaction, DerivedOutputManifest};

use super::ALIGNMENT_POLICY_ID;
use super::planning_service::{HdrSavePayload, PendingHdrSourceRef};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HdrApplyReceipt {
    accepted_dry_run_plan_hash: String,
    accepted_dry_run_plan_id: String,
    merge_method: String,
    merge_version: String,
    output_handle: String,
    output_content_hash: String,
    preview_dimensions: ImageDimensions,
    source_roles: Vec<HdrApplySourceRole>,
    source_paths: Vec<String>,
    warning_codes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HdrApplySourceRole {
    exposure_ev: f32,
    role: String,
    source_index: usize,
}

type LoadedHdrMergeItem = (String, String, DynamicImage, Duration, f32);

fn validate_hdr_merge_dimensions(loaded_items: &[LoadedHdrMergeItem]) -> Result<(), String> {
    if let Some((first_path, _, first_img, _, _)) = loaded_items.first() {
        let (width, height) = (first_img.width(), first_img.height());

        for (path, _, img, _, _) in loaded_items.iter().skip(1) {
            if img.width() != width || img.height() != height {
                return Err(format!(
                    "Dimension mismatch detected.\n\nBase image ({}): {}x{}\nTarget image ({}): {}x{}\n\nHDR merge requires all images to be exactly the same size.",
                    Path::new(first_path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    width,
                    height,
                    Path::new(path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    img.width(),
                    img.height()
                ));
            }
        }
    }

    Ok(())
}

fn load_hdr_merge_items(
    paths: &[String],
    app_handle: &tauri::AppHandle,
    emit_progress: bool,
) -> Result<Vec<LoadedHdrMergeItem>, String> {
    let settings = load_settings_or_default(app_handle);

    paths
        .iter()
        .map(|path| {
            if emit_progress {
                let _ = app_handle.emit(
                    crate::events::HDR_PROGRESS,
                    format!(
                        "Processing '{}'",
                        Path::new(path)
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    ),
                );
            }

            let file_bytes =
                fs::read(path).map_err(|e| format!("Failed to read image {}: {}", path, e))?;
            let content_hash = format!("blake3:{}", blake3::hash(&file_bytes).to_hex());
            let mut dynamic_image =
                load_base_image_from_bytes(&file_bytes, path, false, &settings, None)
                    .map_err(|e| format!("Failed to load image {}: {}", path, e))?;

            if !crate::formats::is_raw_file(path) {
                dynamic_image = apply_srgb_to_linear(dynamic_image);
            }

            let gains = match read_iso(path, &file_bytes) {
                None => return Err(format!("Image {} is missing ISO/Sensitivity data", path)),
                Some(gains) => gains as f32,
            };

            let exposure = match read_exposure_time_secs(path, &file_bytes) {
                None => return Err(format!("Image {} is missing ExposureTime data", path)),
                Some(exp) => Duration::from_secs_f32(exp),
            };

            Ok((path.clone(), content_hash, dynamic_image, exposure, gains))
        })
        .collect::<Result<Vec<_>, String>>()
}

fn build_hdr_source_refs(loaded_items: &[LoadedHdrMergeItem]) -> Vec<PendingHdrSourceRef> {
    loaded_items
        .iter()
        .enumerate()
        .map(
            |(source_index, (path, content_hash, img, exposure, iso))| PendingHdrSourceRef {
                content_hash: content_hash.clone(),
                image_path: parse_virtual_path(path).0.to_string_lossy().into_owned(),
                width: img.width(),
                height: img.height(),
                exposure_time_seconds: exposure.as_secs_f32(),
                iso: *iso,
                source_index,
            },
        )
        .collect::<Vec<_>>()
}

#[tauri::command]
pub(crate) async fn merge_hdr(
    paths: Vec<String>,
    accepted_dry_run_plan_hash: Option<String>,
    accepted_dry_run_plan_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if paths.len() < 2 {
        return Err("Please select at least two images to merge.".to_string());
    }
    let accepted = state.services.hdr.accepted_plan().map_err(str::to_string)?;
    let mut accepted_plan = accepted.plan.clone();
    if accepted_plan.alignment_policy_id != ALIGNMENT_POLICY_ID
        || accepted_dry_run_plan_hash.as_ref() != Some(&accepted_plan.accepted_dry_run_plan_hash)
        || accepted_dry_run_plan_id.as_ref() != Some(&accepted_plan.accepted_dry_run_plan_id)
        || paths != accepted_plan.source_paths
    {
        return Err("hdr_apply_stale_accepted_artifacts".to_string());
    }
    if accepted_plan
        .unresolved_fraction
        .is_some_and(|value| value > 0.0)
    {
        return Err("hdr_apply_blocked_unresolved_deghost_ownership".to_string());
    }
    let job = state.computational_merge_jobs.begin(
        crate::merge::computational_job::ComputationalMergeFamily::Hdr,
        "decode",
        3,
        3,
    )?;
    let result = async {
        job.cancellation_token.checkpoint()?;
        let _ = app_handle.emit(
            crate::events::HDR_PROGRESS,
            "Decoding calibrated RAW sources...",
        );

        let loaded_items = load_hdr_merge_items(&paths, &app_handle, true)?;
        job.cancellation_token.checkpoint()?;
        state.computational_merge_jobs.publish_progress(
            &job.job_id,
            "merge",
            1,
            3,
            1,
            Some(&app_handle),
        )?;
        let _ = app_handle.emit(
            crate::events::HDR_PROGRESS,
            "Reconstructing full-resolution radiance...",
        );

        validate_hdr_merge_dimensions(&loaded_items)?;

        let source_refs = build_hdr_source_refs(&loaded_items);

        let developed_images = loaded_items
            .iter()
            .map(|(_, _, image, _, _)| image.clone())
            .collect::<Vec<_>>();
        log::info!(
            "Starting calibrated native HDR merge of {} images",
            developed_images.len()
        );
        let native = crate::merge::hdr::runtime::reconstruct(
            &developed_images,
            &accepted_plan.planned_sources,
            || job.cancellation_token.checkpoint().is_err(),
        )?;
        let hdr_merged = native.scene_linear;
        job.cancellation_token.checkpoint()?;
        state.computational_merge_jobs.publish_progress(
            &job.job_id,
            "preview",
            2,
            3,
            2,
            Some(&app_handle),
        )?;
        let _ = app_handle.emit(
            crate::events::HDR_PROGRESS,
            "Preparing atomic HDR package...",
        );
        log::info!("HDR merge completed");

        let final_base64 = encode_png_data_url(&native.preview)?;
        let output_content_hash = native.scene_linear_hash.clone();
        let current_hashes = source_refs
            .iter()
            .map(|source| source.content_hash.clone())
            .collect::<Vec<_>>();
        if current_hashes != accepted_plan.source_content_hashes {
            return Err("hdr_apply_stale_source_content".to_string());
        }
        accepted_plan.motion_probability_hash = Some(format!(
            "blake3:{}",
            blake3::hash(&native.motion_probability).to_hex()
        ));
        accepted_plan.ownership_hash = Some(format!(
            "blake3:{}",
            blake3::hash(&native.ownership).to_hex()
        ));
        accepted_plan.feather_hash =
            Some(format!("blake3:{}", blake3::hash(&native.feather).to_hex()));
        accepted_plan.motion_probability_bytes = native.motion_probability;
        accepted_plan.ownership_bytes = native.ownership;
        accepted_plan.feather_bytes = native.feather;
        accepted_plan.scene_linear_artifact_hash = Some(native.scene_linear_hash);
        accepted_plan.tone_mapped_preview_hash = Some(native.preview_hash);
        accepted_plan.motion_coverage = Some(native.motion_coverage);
        accepted_plan.confidence_mean = Some(native.confidence_mean);
        let runtime_plan = accepted_plan;
        let receipt = HdrApplyReceipt {
            accepted_dry_run_plan_hash: runtime_plan.accepted_dry_run_plan_hash.clone(),
            accepted_dry_run_plan_id: runtime_plan.accepted_dry_run_plan_id.clone(),
            merge_method: "exposure_weighted_radiance".to_string(),
            merge_version: "0.1.0".to_string(),
            output_content_hash,
            output_handle: "memory:hdr_result".to_string(),
            preview_dimensions: ImageDimensions {
                height: hdr_merged.height(),
                width: hdr_merged.width(),
            },
            source_roles: build_hdr_apply_source_roles(&source_refs),
            source_paths: source_refs
                .iter()
                .map(|source| source.image_path.clone())
                .collect(),
            warning_codes: Vec::new(),
        };
        let _ = app_handle.emit(crate::events::HDR_PROGRESS, "Creating preview...");

        state
            .services
            .hdr
            .publish_merge(&accepted, runtime_plan, source_refs, hdr_merged)
            .map_err(str::to_string)?;
        state.computational_merge_jobs.publish_progress(
            &job.job_id,
            "ready_to_publish",
            3,
            3,
            3,
            Some(&app_handle),
        )?;
        let _ = app_handle.emit(
            crate::events::HDR_COMPLETE,
            serde_json::json!({
                "base64": final_base64,
                "receipt": receipt,
            }),
        );
        Ok(())
    }
    .await;
    state.computational_merge_jobs.settle(&job.job_id, result)
}

fn build_hdr_apply_source_roles(source_refs: &[PendingHdrSourceRef]) -> Vec<HdrApplySourceRole> {
    let reference_index = source_refs.len() / 2;
    source_refs
        .iter()
        .map(|source| HdrApplySourceRole {
            exposure_ev: source.exposure_time_seconds.log2(),
            role: if source.source_index == reference_index {
                "reference".to_string()
            } else if source.source_index < reference_index {
                "under_exposed".to_string()
            } else {
                "over_exposed".to_string()
            },
            source_index: source.source_index,
        })
        .collect::<Vec<_>>()
}

#[tauri::command]
pub(crate) async fn save_hdr(
    first_path_str: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let HdrSavePayload {
        lease,
        image: hdr_image,
        plan: mut runtime_plan,
        source_refs,
    } = state
        .services
        .hdr
        .acquire_save_payload()
        .map_err(str::to_string)?;

    let (first_path, _) = parse_virtual_path(&first_path_str);
    let parent_dir = first_path
        .parent()
        .ok_or_else(|| "Could not determine parent directory of the first image.".to_string())?;
    let stem = first_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("hdr");

    if source_refs.len() < 2 || runtime_plan.alignment_policy_id != ALIGNMENT_POLICY_ID {
        return Err("hdr_apply_missing_calibrated_lineage".to_string());
    }
    let tile_plan = crate::merge::hdr::full_resolution::build_tile_plan(
        u64::from(hdr_image.width()),
        u64::from(hdr_image.height()),
        source_refs.len() as u64,
    )?;
    let payload_name = format!("{stem}_Hdr.tiff");
    let mut payload = std::io::Cursor::new(Vec::new());
    hdr_image
        .write_to(&mut payload, image::ImageFormat::Tiff)
        .map_err(|error| format!("hdr_payload_encode_failed:{error}"))?;
    let mut preview = std::io::Cursor::new(Vec::new());
    crate::merge::hdr::runtime::tone_map(&hdr_image, 1.0)?
        .write_to(&mut preview, image::ImageFormat::Png)
        .map_err(|error| format!("hdr_preview_encode_failed:{error}"))?;
    let scene_linear_f16 = hdr_image
        .to_rgb32f()
        .pixels()
        .flat_map(|pixel| {
            pixel
                .0
                .into_iter()
                .flat_map(|value| half::f16::from_f32(value).to_bits().to_le_bytes())
        })
        .collect::<Vec<_>>();
    runtime_plan.scene_linear_artifact_hash = Some(format!(
        "blake3:{}",
        blake3::hash(&scene_linear_f16).to_hex()
    ));
    let map_lineage = serde_json::to_vec(&serde_json::json!({
        "deghostRadianceHash": runtime_plan.deghost_radiance_hash,
        "featherHash": runtime_plan.feather_hash,
        "motionProbabilityHash": runtime_plan.motion_probability_hash,
        "ownershipHash": runtime_plan.ownership_hash,
        "staticRadianceHash": runtime_plan.static_radiance_hash,
        "unresolvedFraction": runtime_plan.unresolved_fraction,
    }))
    .map_err(|error| format!("hdr_map_lineage_encode_failed:{error}"))?;
    let manifest = DerivedOutputManifest {
        schema_version: 1,
        family: "hdr".to_string(),
        width: u64::from(hdr_image.width()),
        height: u64::from(hdr_image.height()),
        payload_path: payload_name.clone(),
        preview_paths: vec!["preview.png".to_string()],
        map_paths: vec![
            "maps/accepted-artifacts.json".to_string(),
            "maps/motion-probability.bin".to_string(),
            "maps/source-selection.bin".to_string(),
            "maps/confidence-feather.bin".to_string(),
            "scene-linear.rgb16f".to_string(),
        ],
        source_immutability_hashes: runtime_plan.source_content_hashes.clone(),
    };
    let mut transaction =
        AtomicDerivedOutputTransaction::begin(parent_dir, &format!("{stem}_Hdr.rrhdr"))?;
    transaction.write_file(&payload_name, payload.get_ref())?;
    transaction.write_file("preview.png", preview.get_ref())?;
    transaction.write_file("maps/accepted-artifacts.json", &map_lineage)?;
    transaction.write_file(
        "maps/motion-probability.bin",
        &runtime_plan.motion_probability_bytes,
    )?;
    transaction.write_file("maps/source-selection.bin", &runtime_plan.ownership_bytes)?;
    transaction.write_file("maps/confidence-feather.bin", &runtime_plan.feather_bytes)?;
    transaction.write_file("scene-linear.rgb16f", &scene_linear_f16)?;
    transaction.write_file(
        "lineage.json",
        &serde_json::to_vec(&serde_json::json!({
            "acceptedDryRunPlanHash": runtime_plan.accepted_dry_run_plan_hash,
            "acceptedDryRunPlanId": runtime_plan.accepted_dry_run_plan_id,
            "alignmentPolicyId": runtime_plan.alignment_policy_id,
            "applyAlgorithmId": crate::merge::hdr::full_resolution::FULL_RESOLUTION_APPLY_ALGORITHM_ID,
            "graphRevision": "hdr_scene_linear_base_v1",
            "ownershipPolicy": "deterministic_source_index_then_exposure_distance_v1",
            "sourcePaths": runtime_plan.source_paths,
            "tileCount": tile_plan.tile_count,
            "tilePlanHash": tile_plan.plan_hash,
            "observedPeakMemoryBytes": tile_plan.memory.estimated_peak_bytes,
            "workingDomain": "acescg_ap1_scene_linear_v1",
            "internalArtifact": {
                "encoding": "rgb_half_float_little_endian",
                "hash": format!("blake3:{}", blake3::hash(&scene_linear_f16).to_hex()),
                "path": "scene-linear.rgb16f"
            },
        }))
        .map_err(|error| format!("hdr_lineage_encode_failed:{error}"))?,
    )?;
    transaction.stage_manifest(&manifest)?;
    let receipt = transaction.commit_guarded(
        &manifest,
        || lease.authorize_publication(),
        |package| {
            if package.join(&payload_name).is_file() {
                Ok(())
            } else {
                Err("hdr_registration_payload_missing".to_string())
            }
        },
    )?;
    let output_path = PathBuf::from(&receipt.final_package_path).join(&payload_name);
    write_hdr_output_sidecar(
        &output_path,
        &source_refs,
        &runtime_plan,
        hdr_image.width(),
        hdr_image.height(),
    )?;
    let _ = lease.complete();

    let (real_path, _) = crate::file_management::parse_virtual_path(&first_path_str);
    let _ =
        crate::exif_processing::write_rrexif_sidecar(&real_path.to_string_lossy(), &output_path);

    Ok(output_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hdr_test_item(path: &str, width: u32, height: u32) -> LoadedHdrMergeItem {
        (
            path.to_string(),
            format!("blake3:test-hash-{path}"),
            DynamicImage::new_rgb8(width, height),
            Duration::from_millis(125),
            100.0,
        )
    }

    #[test]
    fn validate_hdr_merge_dimensions_accepts_matching_inputs() {
        let items = vec![
            hdr_test_item("/tmp/base.exr", 64, 48),
            hdr_test_item("/tmp/bright.exr", 64, 48),
            hdr_test_item("/tmp/dark.exr", 64, 48),
        ];

        assert!(validate_hdr_merge_dimensions(&items).is_ok());
    }

    #[test]
    fn validate_hdr_merge_dimensions_reports_target_mismatch() {
        let items = vec![
            hdr_test_item("/tmp/base.exr", 64, 48),
            hdr_test_item("/tmp/wrong-size.exr", 32, 48),
        ];

        let error =
            validate_hdr_merge_dimensions(&items).expect_err("dimension mismatch should fail");

        assert!(error.contains("Dimension mismatch detected."));
        assert!(error.contains("Base image (base.exr): 64x48"));
        assert!(error.contains("Target image (wrong-size.exr): 32x48"));
    }
}
