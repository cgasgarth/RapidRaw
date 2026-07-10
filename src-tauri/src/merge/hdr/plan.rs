use super::{
    alignment::{ALIGNMENT_POLICY_ID, AlignmentReceipt, align},
    source_frame::{SourceFrame, decode_source},
};

pub(crate) const PLAN_SCHEMA_VERSION: u32 = 2;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannedSource {
    #[serde(flatten)]
    pub frame: SourceFrame,
    pub alignment: AlignmentReceipt,
    pub is_reference: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HdrAlignmentArtifact {
    pub artifact_hash: String,
    pub handle: String,
    pub height: usize,
    pub kind: &'static str,
    pub width: usize,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HdrAlignmentPlanResponse {
    pub accepted: bool,
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    pub alignment_artifact: HdrAlignmentArtifact,
    pub block_codes: Vec<String>,
    pub bracket_count: usize,
    pub common_overlap_fraction: f32,
    pub readiness: &'static str,
    pub reference_source_index: usize,
    pub schema_version: u32,
    pub sources: Vec<PlannedSource>,
    pub warning_codes: Vec<String>,
}

fn validate_compatibility(frames: &[SourceFrame]) -> Vec<String> {
    let Some(first) = frames.first() else {
        return vec!["insufficient_bracket_count".to_string()];
    };
    let mut blocks = Vec::new();
    if frames.len() < 2 {
        blocks.push("insufficient_bracket_count".to_string());
    }
    if frames.iter().any(|frame| {
        frame.camera_make != first.camera_make || frame.camera_model != first.camera_model
    }) {
        blocks.push("mixed_camera".to_string());
    }
    if frames
        .iter()
        .any(|frame| frame.cfa_pattern != first.cfa_pattern)
    {
        blocks.push("cfa_mismatch".to_string());
    }
    if frames.iter().any(|frame| {
        frame.width != first.width
            || frame.height != first.height
            || frame.active_area.width != first.active_area.width
            || frame.active_area.height != first.active_area.height
    }) {
        blocks.push("active_area_mismatch".to_string());
    }
    if frames
        .iter()
        .any(|frame| frame.orientation != first.orientation)
    {
        blocks.push("orientation_mismatch".to_string());
    }
    if frames.iter().any(|frame| {
        (frame.focal_length_mm - first.focal_length_mm).abs() > 0.1
            || frame.lens_model != first.lens_model
    }) {
        blocks.push("focal_state_mismatch".to_string());
    }
    blocks
}

pub(crate) fn build_alignment_plan(
    paths: &[String],
    cancelled: impl Fn() -> bool,
) -> Result<HdrAlignmentPlanResponse, String> {
    if cancelled() {
        return Err("hdr_plan_cancelled:file_read".to_string());
    }
    let frames = paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            if cancelled() {
                return Err("hdr_plan_cancelled:raw_decode".to_string());
            }
            let frame = decode_source(path, index)?;
            if cancelled() {
                return Err("hdr_plan_cancelled:proxy_generation".to_string());
            }
            Ok(frame)
        })
        .collect::<Result<Vec<_>, _>>()?;
    build_alignment_plan_from_frames(frames, cancelled)
}

fn build_alignment_plan_from_frames(
    mut frames: Vec<SourceFrame>,
    cancelled: impl Fn() -> bool,
) -> Result<HdrAlignmentPlanResponse, String> {
    let blocks = validate_compatibility(&frames);
    if !blocks.is_empty() {
        return Err(blocks.join(","));
    }
    let mut exposure_order = (0..frames.len()).collect::<Vec<_>>();
    exposure_order.sort_by(|a, b| {
        frames[*a]
            .exposure
            .exposure_scale
            .total_cmp(&frames[*b].exposure.exposure_scale)
            .then_with(|| a.cmp(b))
    });
    let reference_source_index = exposure_order[exposure_order.len() / 2];
    let reference = frames[reference_source_index].proxy.clone();
    let mut planned = Vec::with_capacity(frames.len());
    for frame in frames.drain(..) {
        if cancelled() {
            return Err("hdr_plan_cancelled:coarse_alignment".to_string());
        }
        let is_reference = frame.source_index == reference_source_index;
        let alignment = if is_reference {
            AlignmentReceipt {
                confidence: 1.0,
                converged: true,
                iterations: 0,
                matrix: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
                model: "identity",
                overlap_fraction: 1.0,
                policy_id: ALIGNMENT_POLICY_ID,
                residual_p95: 0.0,
                residual_rms: 0.0,
            }
        } else {
            align(&reference, &frame.proxy)?
        };
        if cancelled() {
            return Err("hdr_plan_cancelled:refinement".to_string());
        }
        planned.push(PlannedSource {
            frame,
            alignment,
            is_reference,
        });
    }
    let common_overlap_fraction = planned
        .iter()
        .map(|source| source.alignment.overlap_fraction)
        .fold(1.0, f32::min);
    let artifact_payload = serde_json::to_vec(&planned).map_err(|error| error.to_string())?;
    if cancelled() {
        return Err("hdr_plan_cancelled:artifact_publication".to_string());
    }
    let artifact_hash = format!("blake3:{}", blake3::hash(&artifact_payload).to_hex());
    let canonical = serde_json::json!({
        "alignmentArtifactHash": artifact_hash,
        "alignmentPolicyId": ALIGNMENT_POLICY_ID,
        "referenceSourceIndex": reference_source_index,
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "sources": planned,
    });
    let bytes = serde_json::to_vec(&canonical).map_err(|error| error.to_string())?;
    let hash = format!("blake3:{}", blake3::hash(&bytes).to_hex());
    Ok(HdrAlignmentPlanResponse {
        accepted: true,
        accepted_dry_run_plan_id: format!("hdr_alignment_plan_{}", &hash[7..23]),
        accepted_dry_run_plan_hash: hash,
        alignment_artifact: HdrAlignmentArtifact {
            artifact_hash,
            handle: "native:hdr/alignment-proxy/v1".to_string(),
            height: reference.height,
            kind: "scene_linear_alignment_proxy",
            width: reference.width,
        },
        block_codes: Vec::new(),
        bracket_count: planned.len(),
        common_overlap_fraction,
        readiness: "alignment_plan_ready",
        reference_source_index,
        schema_version: PLAN_SCHEMA_VERSION,
        sources: planned,
        warning_codes: vec!["radiance_reconstruction_pending".to_string()],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merge::hdr::source_frame::{
        ActiveArea, AlignmentProxy, CALIBRATION_ID, CalibrationReceipt, DECODER_ID,
        ExposureReceipt, PROXY_ID,
    };

    fn frame(index: usize, exposure_scale: f32, shift_x: i32) -> SourceFrame {
        let width = 64usize;
        let height = 64usize;
        let scene = (0..width * height)
            .map(|pixel| (((pixel * 7919) % 997) as f32 / 997.0 + 0.01) * exposure_scale)
            .collect::<Vec<_>>();
        let mut pixels = vec![0.0; scene.len()];
        for y in 0..height {
            for x in 0..width {
                let target_x = x as i32 + shift_x;
                if (0..width as i32).contains(&target_x) {
                    pixels[y * width + target_x as usize] = scene[y * width + x];
                }
            }
        }
        SourceFrame {
            active_area: ActiveArea {
                height,
                width,
                x: 0,
                y: 0,
            },
            calibration: CalibrationReceipt {
                algorithm_id: CALIBRATION_ID,
                black_levels: vec![64.0; 4],
                linearization_id: "identity_declared_by_decoder",
                white_balance: vec![2.0, 1.0, 1.5, 1.0],
                white_levels: vec![4095.0; 4],
            },
            camera_make: "Synthetic".to_string(),
            camera_model: "Bracket".to_string(),
            cfa_pattern: "RGGB".to_string(),
            content_hash: format!("blake3:source{index}"),
            decoder_id: DECODER_ID,
            exposure: ExposureReceipt {
                aperture: 8.0,
                exposure_scale,
                exposure_time_seconds: exposure_scale,
                iso: 100.0,
            },
            focal_length_mm: 35.0,
            graph_revision: "source_bytes_v1",
            height,
            lens_model: "Synthetic 35mm".to_string(),
            orientation: "Normal".to_string(),
            path: format!("/synthetic/{index}.dng"),
            proxy_hash: format!("blake3:proxy{index}"),
            proxy_id: PROXY_ID,
            proxy: AlignmentProxy {
                height,
                pixels,
                scale: 1.0,
                width,
            },
            source_index: index,
            width,
        }
    }

    #[test]
    fn plan_is_deterministic_and_selects_middle_exposure() {
        let frames = vec![frame(0, 0.25, 2), frame(1, 1.0, 0), frame(2, 4.0, -3)];
        let first = build_alignment_plan_from_frames(frames.clone(), || false).unwrap();
        let second = build_alignment_plan_from_frames(frames, || false).unwrap();
        assert_eq!(first.reference_source_index, 1);
        assert_eq!(
            first.accepted_dry_run_plan_hash,
            second.accepted_dry_run_plan_hash
        );
        assert_eq!(first.sources[0].alignment.matrix[2], -2.0);
        assert_eq!(first.sources[2].alignment.matrix[2], 3.0);
    }

    #[test]
    fn cancellation_never_returns_an_accepted_plan() {
        let error =
            build_alignment_plan_from_frames(vec![frame(0, 1.0, 0), frame(1, 2.0, 0)], || true)
                .unwrap_err();
        assert!(error.starts_with("hdr_plan_cancelled:"));
    }

    #[test]
    fn incompatible_camera_blocks() {
        let mut other = frame(1, 2.0, 0);
        other.camera_model = "Other".to_string();
        assert_eq!(
            build_alignment_plan_from_frames(vec![frame(0, 1.0, 0), other], || false).unwrap_err(),
            "mixed_camera"
        );
    }
}
