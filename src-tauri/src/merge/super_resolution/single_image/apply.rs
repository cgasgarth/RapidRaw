use std::io::Cursor;
use std::path::Path;
#[cfg(feature = "ai")]
use std::path::PathBuf;

use image::{DynamicImage, ImageFormat, Rgb32FImage};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::app_state::AppState;
#[cfg(feature = "ai")]
use crate::merge::atomic_derived_output::AtomicDerivedOutputTransaction;
use crate::merge::atomic_derived_output::{AtomicDerivedOutputReceipt, DerivedOutputManifest};
#[cfg(feature = "ai")]
use crate::merge::computational_job::ComputationalMergeFamily;

#[cfg(feature = "ai")]
use super::inference::{OrtSwinIrRunner, run_tiled_x2, tile_count};
#[cfg(feature = "ai")]
use super::model::verify_provisioned_model;
use super::model::{MODEL_ID, MODEL_SHA256};
#[cfg(feature = "ai")]
use super::preprocess::{
    apply_highlight_safe_residual, bicubic_scene_linear_x2, scene_linear_to_encoded_srgb,
};
#[cfg(feature = "ai")]
use super::review::build_review;
#[cfg(feature = "ai")]
use super::{SingleImageX2PreviewRequest, current_frame};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SingleImageX2ApplyRequest {
    pub source_path: String,
    pub graph_revision: String,
    pub accepted_review_hash: String,
    pub destination_directory: String,
    pub requested_name: String,
    pub memory_budget_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleImageX2ApplyReceipt {
    pub schema_version: u32,
    pub job_id: String,
    pub source_path: String,
    pub graph_revision: String,
    pub review_hash: String,
    pub model_id: &'static str,
    pub model_sha256: &'static str,
    pub width: u32,
    pub height: u32,
    pub payload_path: String,
    pub package: AtomicDerivedOutputReceipt,
}

#[tauri::command]
pub async fn apply_single_image_x2(
    request: SingleImageX2ApplyRequest,
    state: tauri::State<'_, AppState>,
) -> Result<SingleImageX2ApplyReceipt, String> {
    apply_request(request, &state).await
}

pub(crate) async fn apply_request(
    request: SingleImageX2ApplyRequest,
    state: &AppState,
) -> Result<SingleImageX2ApplyReceipt, String> {
    #[cfg(not(feature = "ai"))]
    {
        let _ = (request, state);
        Err("ai_super_resolution_unavailable:build_without_ai_feature".to_string())
    }
    #[cfg(feature = "ai")]
    {
        validate_request(&request)?;
        let model_path = std::env::var_os("RAWENGINE_SWINIR_X2_MODEL_PATH")
            .map(PathBuf::from)
            .ok_or_else(|| "swinir_x2_disabled_weight_redistribution_unverified".to_string())?;
        verify_provisioned_model(&model_path)?;
        let preview_request = SingleImageX2PreviewRequest {
            source_path: request.source_path.clone(),
            graph_revision: request.graph_revision.clone(),
            memory_budget_bytes: request.memory_budget_bytes,
        };
        let frame = current_frame(state, &preview_request)?;
        if let Some(receipt) = find_committed_replay(&request)? {
            return Ok(receipt);
        }
        let source = frame.pixels.image().to_rgb32f();
        let tiles = tile_count(source.width(), source.height(), request.memory_budget_bytes)?;
        let total_units = tiles.saturating_add(3);
        let job = state.computational_merge_jobs.begin(
            ComputationalMergeFamily::SuperResolution,
            "rendering",
            total_units,
            total_units,
        )?;
        let job_id = job.job_id.to_string();
        let token = job.cancellation_token.clone();
        let model_for_worker = model_path.clone();
        let budget = request.memory_budget_bytes;
        let rendered = tokio::task::spawn_blocking(move || {
            let mut runner = OrtSwinIrRunner::open(&model_for_worker)?;
            let encoded = scene_linear_to_encoded_srgb(&source);
            let ai = run_tiled_x2(&encoded, budget, &token, &mut runner)?;
            let baseline = bicubic_scene_linear_x2(&source);
            let output = apply_highlight_safe_residual(&source, &baseline, &ai);
            let review = build_review(&source, &baseline, &output, &ai, &model_for_worker)?;
            Ok::<_, String>((baseline, output, review))
        })
        .await
        .map_err(|error| format!("single_image_x2_apply_worker_failed:{error}"))?;
        let (baseline, output, review) = match rendered {
            Ok(value) => value,
            Err(error) => {
                let _ = state.computational_merge_jobs.fail(&job.job_id);
                return Err(error);
            }
        };
        job.cancellation_token.checkpoint()?;
        current_frame(state, &preview_request)?;
        if review.decision != "preview_only_manual_review" {
            let _ = state.computational_merge_jobs.fail(&job.job_id);
            return Err("single_image_x2_review_blocked".to_string());
        }
        if review.output_hash != request.accepted_review_hash {
            let _ = state.computational_merge_jobs.fail(&job.job_id);
            return Err("single_image_x2_stale_review".to_string());
        }

        let mut transaction = AtomicDerivedOutputTransaction::begin(
            Path::new(&request.destination_directory),
            &normalized_package_name(&request.requested_name),
        )?;
        let payload_hash = transaction.write_file("payload.tiff", &tiff_bytes(&output)?)?;
        transaction.write_file("preview.png", &png_bytes(&output)?)?;
        transaction.write_file("bicubic.png", &png_bytes(&baseline)?)?;
        let provenance = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1,
            "derivativeKind": "single_image_ai_sr",
            "renderedRgb": true,
            "sourceGraphRevision": request.graph_revision,
            "sourceInputHash": review.input_hash,
            "outputHash": review.output_hash,
            "payloadHash": payload_hash,
            "modelId": MODEL_ID,
            "modelSha256": MODEL_SHA256,
            "tilePolicyId": review.tile_policy_id,
            "colorPolicyId": review.color_policy_id,
            "acceptedReviewHash": request.accepted_review_hash,
        }))
        .map_err(|error| format!("single_image_x2_provenance_serialize_failed:{error}"))?;
        transaction.write_file("provenance.json", &provenance)?;
        let manifest = DerivedOutputManifest {
            schema_version: 1,
            family: "single_image_ai_sr".to_string(),
            width: u64::from(output.width()),
            height: u64::from(output.height()),
            payload_path: "payload.tiff".to_string(),
            preview_paths: vec!["preview.png".to_string(), "bicubic.png".to_string()],
            map_paths: vec!["provenance.json".to_string()],
            source_immutability_hashes: vec![review.input_hash.clone()],
        };
        transaction.stage_manifest(&manifest)?;
        job.cancellation_token.checkpoint()?;
        current_frame(state, &preview_request)?;
        let package = transaction.commit(&manifest, |_| Ok(()))?;
        let payload_path = Path::new(&package.final_package_path)
            .join("payload.tiff")
            .to_string_lossy()
            .into_owned();
        if !state.computational_merge_jobs.finish(&job.job_id)? {
            return Err("single_image_x2_cancelled_before_registration".to_string());
        }
        Ok(SingleImageX2ApplyReceipt {
            schema_version: 1,
            job_id,
            source_path: preview_request.source_path,
            graph_revision: preview_request.graph_revision,
            review_hash: review.output_hash,
            model_id: MODEL_ID,
            model_sha256: MODEL_SHA256,
            width: output.width(),
            height: output.height(),
            payload_path,
            package,
        })
    }
}

fn find_committed_replay(
    request: &SingleImageX2ApplyRequest,
) -> Result<Option<SingleImageX2ApplyReceipt>, String> {
    let parent = Path::new(&request.destination_directory);
    if !parent.is_dir() {
        return Ok(None);
    }
    let mut paths = std::fs::read_dir(parent)
        .map_err(|error| format!("single_image_x2_replay_scan_failed:{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "rrsr")
        })
        .collect::<Vec<_>>();
    paths.sort();
    for path in paths {
        let provenance: serde_json::Value = match std::fs::read(path.join("provenance.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        {
            Some(value) => value,
            None => continue,
        };
        if provenance["acceptedReviewHash"] != request.accepted_review_hash
            || provenance["sourceGraphRevision"] != request.graph_revision
            || provenance["modelSha256"] != MODEL_SHA256
        {
            continue;
        }
        let package: AtomicDerivedOutputReceipt = serde_json::from_slice(
            &std::fs::read(path.join("REGISTRATION.json"))
                .map_err(|error| format!("single_image_x2_replay_receipt_read_failed:{error}"))?,
        )
        .map_err(|error| format!("single_image_x2_replay_receipt_invalid:{error}"))?;
        if package.commit_status != "committed" {
            continue;
        }
        let manifest: DerivedOutputManifest = serde_json::from_slice(
            &std::fs::read(path.join("manifest.json"))
                .map_err(|error| format!("single_image_x2_replay_manifest_read_failed:{error}"))?,
        )
        .map_err(|error| format!("single_image_x2_replay_manifest_invalid:{error}"))?;
        return Ok(Some(SingleImageX2ApplyReceipt {
            schema_version: 1,
            job_id: Uuid::new_v4().to_string(),
            source_path: request.source_path.clone(),
            graph_revision: request.graph_revision.clone(),
            review_hash: request.accepted_review_hash.clone(),
            model_id: MODEL_ID,
            model_sha256: MODEL_SHA256,
            width: u32::try_from(manifest.width)
                .map_err(|_| "single_image_x2_replay_dimensions_invalid".to_string())?,
            height: u32::try_from(manifest.height)
                .map_err(|_| "single_image_x2_replay_dimensions_invalid".to_string())?,
            payload_path: path
                .join(&manifest.payload_path)
                .to_string_lossy()
                .into_owned(),
            package,
        }));
    }
    Ok(None)
}

fn validate_request(request: &SingleImageX2ApplyRequest) -> Result<(), String> {
    if request.accepted_review_hash.is_empty() {
        return Err("single_image_x2_review_not_accepted".to_string());
    }
    if request.requested_name.trim().is_empty() || request.destination_directory.trim().is_empty() {
        return Err("single_image_x2_destination_invalid".to_string());
    }
    Ok(())
}

fn normalized_package_name(name: &str) -> String {
    let name = name.trim().trim_end_matches(".rrsr");
    format!("{name}.rrsr")
}

fn tiff_bytes(image: &Rgb32FImage) -> Result<Vec<u8>, String> {
    encode(
        DynamicImage::ImageRgb32F(image.clone()).to_rgb16(),
        ImageFormat::Tiff,
    )
}

fn png_bytes(image: &Rgb32FImage) -> Result<Vec<u8>, String> {
    encode(
        DynamicImage::ImageRgb32F(image.clone()).to_rgb8(),
        ImageFormat::Png,
    )
}

fn encode(image: impl Into<DynamicImage>, format: ImageFormat) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    image
        .into()
        .write_to(&mut cursor, format)
        .map_err(|error| format!("single_image_x2_encode_failed:{error}"))?;
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use image::{Rgb, Rgb32FImage};

    use super::{SingleImageX2ApplyRequest, normalized_package_name, tiff_bytes, validate_request};

    fn request() -> SingleImageX2ApplyRequest {
        SingleImageX2ApplyRequest {
            source_path: "/source/input.raw".to_string(),
            graph_revision: "graph-1".to_string(),
            accepted_review_hash: "sha256:accepted".to_string(),
            destination_directory: "/output".to_string(),
            requested_name: "input-Enhanced-x2".to_string(),
            memory_budget_bytes: None,
        }
    }

    #[test]
    fn rejects_apply_without_review_acceptance() {
        let mut request = request();
        request.accepted_review_hash.clear();
        assert_eq!(
            validate_request(&request),
            Err("single_image_x2_review_not_accepted".to_string())
        );
    }

    #[test]
    fn normalizes_package_extension_once() {
        assert_eq!(
            normalized_package_name("image-Enhanced-x2"),
            "image-Enhanced-x2.rrsr"
        );
        assert_eq!(
            normalized_package_name("image-Enhanced-x2.rrsr"),
            "image-Enhanced-x2.rrsr"
        );
    }

    #[test]
    fn writes_reopenable_sixteen_bit_tiff_payload() {
        let image = Rgb32FImage::from_pixel(3, 2, Rgb([0.1, 0.5, 0.9]));
        let bytes = tiff_bytes(&image).unwrap();
        let decoded =
            image::load_from_memory_with_format(&bytes, image::ImageFormat::Tiff).unwrap();
        assert_eq!(decoded.to_rgb16().dimensions(), (3, 2));
    }
}
