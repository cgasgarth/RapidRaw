use super::{
    alignment::{self, RectF64, SimilarityTransform},
    raw_frame::{self, DecodedFocusSource, PROXY_ID, RectU32},
    warp::{self, SourcePreview},
};

const SCHEMA_VERSION: u32 = 1;
const POLICY_ID: &str = "focus_stack_intake_policy_v1";

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FocusStackReadinessSettings {
    pub common_crop_identity: String,
    pub lens_correction_identity: String,
    pub neutral_raw_state: bool,
    pub orientation_identity: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceScore {
    order_delta: usize,
    clipping_invalid_ratio: f32,
    luma_noise_estimate: f32,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InputSource {
    source_index: usize,
    path_handle: String,
    source_kind: &'static str,
    content_hash: String,
    graph_revision: String,
    width: u32,
    height: u32,
    active_area: RectU32,
    orientation: String,
    camera_make: String,
    camera_model: String,
    lens_model: Option<String>,
    focal_length_mm: Option<f32>,
    aperture: Option<f32>,
    focus_distance_mm: Option<f32>,
    exposure_ev: Option<f32>,
    iso: Option<u32>,
    calibration_identity: String,
    effective_calibration_identity: String,
    scene_linear_render_identity: &'static str,
    clipping_ratio: f32,
    invalid_border_ratio: f32,
    finite_pixel_ratio: f32,
    luma_noise_estimate: f32,
    proxy_hash: String,
    reference_score: ReferenceScore,
    warnings: Vec<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FocusStackInputPlan {
    pub accepted: bool,
    pub accepted_dry_run_plan_hash: String,
    pub accepted_dry_run_plan_id: String,
    schema_version: u32,
    policy_id: &'static str,
    proxy_algorithm_id: &'static str,
    focus_order_source: &'static str,
    coordinate_convention: &'static str,
    reference_source_index: usize,
    common_geometry: RectU32,
    effective_calibration_identity: String,
    settings: FocusStackReadinessSettings,
    sources: Vec<InputSource>,
    warning_codes: Vec<String>,
    block_codes: Vec<String>,
    input_plan_hash: String,
    alignment_algorithm_id: &'static str,
    alignment_policy_id: &'static str,
    interpolation_policy_id: &'static str,
    common_overlap: Option<RectF64>,
    transforms: Vec<SimilarityTransform>,
    previews: Vec<SourcePreview>,
}

pub(crate) fn build_input_plan(
    paths: &[String],
    handles: &[String],
    revisions: &[String],
    settings: FocusStackReadinessSettings,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<FocusStackInputPlan, String> {
    if !(2..=128).contains(&paths.len()) {
        return Err("focus_stack_source_count_out_of_range".to_string());
    }
    if handles.len() != paths.len() || revisions.len() != paths.len() {
        return Err("focus_stack_source_identity_count_mismatch".to_string());
    }
    let decoded = paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            if cancelled() {
                return Err("focus_stack_plan_cancelled:file_read".to_string());
            }
            let source = raw_frame::decode(
                path,
                handles[index].clone(),
                revisions[index].clone(),
                index,
            )?;
            if cancelled() {
                return Err("focus_stack_plan_cancelled:proxy_creation".to_string());
            }
            Ok(source)
        })
        .collect::<Result<Vec<_>, _>>()?;
    finish(decoded, settings, cancelled)
}

fn finish(
    decoded: Vec<DecodedFocusSource>,
    settings: FocusStackReadinessSettings,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<FocusStackInputPlan, String> {
    let first = &decoded[0];
    let mut blocks = Vec::new();
    let mut warnings = decoded
        .iter()
        .flat_map(|source| source.warnings.clone())
        .collect::<Vec<_>>();
    if decoded.iter().any(|s| s.camera_model != first.camera_model) {
        blocks.push("incompatible_camera_model".to_string());
    }
    if decoded.iter().any(|s| {
        s.width != first.width
            || s.height != first.height
            || s.active_area.width != first.active_area.width
            || s.active_area.height != first.active_area.height
    }) {
        blocks.push("incompatible_dimensions".to_string());
    }
    if decoded.iter().any(|s| s.orientation != first.orientation) {
        blocks.push("incompatible_orientation".to_string());
    }
    if decoded.iter().any(|s| s.cfa_pattern != first.cfa_pattern) {
        blocks.push("incompatible_bayer_layout".to_string());
    }
    if decoded.iter().any(|s| s.lens_model != first.lens_model) {
        blocks.push("incompatible_lens_profile".to_string());
    }
    if relative_span(&decoded, |s| s.focal_length_mm) > 0.005 {
        blocks.push("incompatible_focal_length".to_string());
    }
    if log_span(&decoded, |s| s.aperture) > 1.0 / 6.0 {
        blocks.push("incompatible_aperture".to_string());
    }
    let exposure_span = absolute_span(&decoded, |s| s.exposure_ev);
    if exposure_span > 3.0 {
        blocks.push("incompatible_exposure_span".to_string());
    } else if exposure_span > 1.0 {
        warnings.push("radiometric_normalization_required".to_string());
    }
    if !settings.neutral_raw_state
        && (!settings.common_crop_identity.starts_with("common:")
            || !settings.orientation_identity.starts_with("common:"))
    {
        blocks.push("incompatible_source_graph_geometry".to_string());
    }
    if decoded.iter().any(|s| s.finite_pixel_ratio < 1.0) {
        blocks.push("non_finite_scene_linear_pixels".to_string());
    }
    blocks.sort();
    blocks.dedup();
    warnings.sort();
    warnings.dedup();
    let middle = (decoded.len() - 1) / 2;
    let mut reliable_focus = decoded
        .iter()
        .filter_map(|source| source.focus_distance_mm)
        .collect::<Vec<_>>();
    reliable_focus.sort_by(f32::total_cmp);
    let median_focus =
        (reliable_focus.len() >= 2).then(|| reliable_focus[reliable_focus.len() / 2]);
    let monotonic = decoded.windows(2).all(|pair| {
        match (pair[0].focus_distance_mm, pair[1].focus_distance_mm) {
            (Some(a), Some(b)) => a <= b,
            _ => true,
        }
    });
    if reliable_focus.len() >= 2 && !monotonic {
        warnings.push("non_monotonic_focus_order".to_string());
    }
    warnings.sort();
    warnings.dedup();
    let scores = decoded
        .iter()
        .map(|s| ReferenceScore {
            order_delta: median_focus
                .zip(s.focus_distance_mm)
                .map(|(median, value)| (median - value).abs().round() as usize)
                .unwrap_or_else(|| s.source_index.abs_diff(middle)),
            clipping_invalid_ratio: s.clipping_ratio,
            luma_noise_estimate: s.noise,
        })
        .collect::<Vec<_>>();
    let reference_source_index = (0..decoded.len())
        .min_by(|a, b| {
            scores[*a]
                .order_delta
                .cmp(&scores[*b].order_delta)
                .then_with(|| {
                    scores[*a]
                        .clipping_invalid_ratio
                        .total_cmp(&scores[*b].clipping_invalid_ratio)
                })
                .then_with(|| {
                    scores[*a]
                        .luma_noise_estimate
                        .total_cmp(&scores[*b].luma_noise_estimate)
                })
                .then_with(|| a.cmp(b))
        })
        .unwrap_or(0);
    let effective = decoded[reference_source_index].calibration_identity.clone();
    let common_geometry = decoded[reference_source_index].active_area.clone();
    let sources = decoded
        .iter()
        .zip(scores)
        .map(|(s, reference_score)| InputSource {
            source_index: s.source_index,
            path_handle: s.path_handle.clone(),
            source_kind: s.source_kind,
            content_hash: s.content_hash.clone(),
            graph_revision: s.graph_revision.clone(),
            width: s.width,
            height: s.height,
            active_area: s.active_area.clone(),
            orientation: s.orientation.clone(),
            camera_make: s.camera_make.clone(),
            camera_model: s.camera_model.clone(),
            lens_model: s.lens_model.clone(),
            focal_length_mm: s.focal_length_mm,
            aperture: s.aperture,
            focus_distance_mm: s.focus_distance_mm,
            exposure_ev: s.exposure_ev,
            iso: s.iso,
            calibration_identity: s.calibration_identity.clone(),
            effective_calibration_identity: effective.clone(),
            scene_linear_render_identity: s.render_identity,
            clipping_ratio: s.clipping_ratio,
            invalid_border_ratio: 0.0,
            finite_pixel_ratio: s.finite_pixel_ratio,
            luma_noise_estimate: s.noise,
            proxy_hash: s.proxy_hash.clone(),
            reference_score,
            warnings: s.warnings.clone(),
        })
        .collect::<Vec<_>>();
    let input_canonical = serde_json::json!({"schemaVersion": SCHEMA_VERSION, "policyId": POLICY_ID, "proxyAlgorithmId": PROXY_ID, "focusOrderSource": "user_selection", "coordinateConvention": "full_resolution_active_area_pixel_centers", "referenceSourceIndex": reference_source_index, "commonGeometry": common_geometry, "effectiveCalibrationIdentity": effective, "settings": settings, "sources": sources, "warningCodes": warnings, "blockCodes": blocks});
    let input_plan_hash = format!(
        "blake3:{}",
        blake3::hash(&serde_json::to_vec(&input_canonical).map_err(|error| error.to_string())?)
            .to_hex()
    );
    let transforms = alignment::solve_all(&decoded, reference_source_index, cancelled)?;
    for transform in &transforms {
        warnings.extend(transform.reason_codes.iter().cloned());
    }
    if blocks.is_empty() {
        if transforms
            .iter()
            .filter(|transform| transform.status == "accepted")
            .count()
            < 2
        {
            blocks.push("alignment_fewer_than_two_sources".to_string());
        }
        if transforms
            .first()
            .is_some_and(|transform| transform.status != "accepted")
            || transforms
                .last()
                .is_some_and(|transform| transform.status != "accepted")
        {
            blocks.push("alignment_focus_endpoint_excluded".to_string());
        }
    }
    let common_overlap = alignment::common_crop(
        &transforms,
        common_geometry.width as f64,
        common_geometry.height as f64,
    );
    if blocks.is_empty() && common_overlap.is_none() {
        blocks.push("alignment_common_crop_unavailable".to_string());
    }
    if blocks.is_empty()
        && common_overlap.as_ref().is_some_and(|crop| {
            1.0 - (crop.width * crop.height)
                / (common_geometry.width as f64 * common_geometry.height as f64)
                > 0.05
        })
    {
        blocks.push("alignment_common_crop_loss_exceeded".to_string());
    }
    warnings.sort();
    warnings.dedup();
    blocks.sort();
    blocks.dedup();
    let previews = if blocks.is_empty() {
        warp::render_previews(
            &decoded,
            &transforms,
            reference_source_index,
            common_overlap.as_ref().expect("checked common crop"),
            cancelled,
        )?
    } else {
        Vec::new()
    };
    let preview_hashes = previews
        .iter()
        .map(|preview| (&preview.source_index, &preview.preview_hash))
        .collect::<Vec<_>>();
    let canonical = serde_json::json!({"inputPlanHash": input_plan_hash, "alignmentAlgorithmId": alignment::ALGORITHM_ID, "alignmentPolicyId": alignment::POLICY_ID, "interpolationPolicyId": warp::WARP_ID, "transforms": transforms, "commonOverlap": common_overlap, "previewHashes": preview_hashes, "warningCodes": warnings, "blockCodes": blocks});
    if cancelled() {
        return Err("focus_stack_plan_cancelled:plan_publication".to_string());
    }
    let hash = format!(
        "blake3:{}",
        blake3::hash(&serde_json::to_vec(&canonical).map_err(|error| error.to_string())?).to_hex()
    );
    Ok(FocusStackInputPlan {
        accepted: blocks.is_empty(),
        accepted_dry_run_plan_id: format!("focus_stack_input_plan_{}", &hash[7..23]),
        accepted_dry_run_plan_hash: hash,
        schema_version: SCHEMA_VERSION,
        policy_id: POLICY_ID,
        proxy_algorithm_id: PROXY_ID,
        focus_order_source: "user_selection",
        coordinate_convention: "full_resolution_active_area_pixel_centers",
        reference_source_index,
        common_geometry,
        effective_calibration_identity: effective,
        settings,
        sources,
        warning_codes: warnings,
        block_codes: blocks,
        input_plan_hash,
        alignment_algorithm_id: alignment::ALGORITHM_ID,
        alignment_policy_id: alignment::POLICY_ID,
        interpolation_policy_id: warp::WARP_ID,
        common_overlap,
        transforms,
        previews,
    })
}

fn values(
    sources: &[DecodedFocusSource],
    f: impl Fn(&DecodedFocusSource) -> Option<f32>,
) -> Option<Vec<f32>> {
    let v = sources.iter().filter_map(f).collect::<Vec<_>>();
    (v.len() == sources.len()).then_some(v)
}
fn absolute_span(s: &[DecodedFocusSource], f: impl Fn(&DecodedFocusSource) -> Option<f32>) -> f32 {
    values(s, f)
        .map(|v| {
            v.iter().copied().fold(f32::NEG_INFINITY, f32::max)
                - v.iter().copied().fold(f32::INFINITY, f32::min)
        })
        .unwrap_or(0.0)
}
fn relative_span(
    s: &[DecodedFocusSource],
    f: impl Fn(&DecodedFocusSource) -> Option<f32> + Copy,
) -> f32 {
    values(s, f)
        .map(|v| absolute_span(s, f) / v[0].abs().max(f32::EPSILON))
        .unwrap_or(0.0)
}
fn log_span(s: &[DecodedFocusSource], f: impl Fn(&DecodedFocusSource) -> Option<f32>) -> f32 {
    values(s, f)
        .map(|v| {
            v.iter()
                .copied()
                .map(f32::log2)
                .fold(f32::NEG_INFINITY, f32::max)
                - v.iter()
                    .copied()
                    .map(f32::log2)
                    .fold(f32::INFINITY, f32::min)
        })
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};
    use tempfile::TempDir;

    fn settings() -> FocusStackReadinessSettings {
        FocusStackReadinessSettings {
            common_crop_identity: "common:uncropped".to_string(),
            lens_correction_identity: "none".to_string(),
            neutral_raw_state: true,
            orientation_identity: "common:normal".to_string(),
        }
    }

    fn fixtures(count: usize) -> (TempDir, Vec<String>) {
        let directory = TempDir::new().unwrap();
        let paths = (0..count)
            .map(|index| {
                let path = directory.path().join(format!("focus-{index:03}.png"));
                RgbImage::from_fn(160, 120, |x, y| {
                    Rgb([
                        ((x * 7) % 255) as u8,
                        ((y * 11) % 255) as u8,
                        if x == 0 && y == 0 {
                            64 + index as u8
                        } else {
                            64
                        },
                    ])
                })
                .save(&path)
                .unwrap();
                path.to_string_lossy().into_owned()
            })
            .collect();
        (directory, paths)
    }

    fn plan(paths: &[String], revisions: &[String]) -> FocusStackInputPlan {
        let handles = (0..paths.len())
            .map(|index| format!("source-{index}"))
            .collect::<Vec<_>>();
        build_input_plan(paths, &handles, revisions, settings(), || false).unwrap()
    }

    #[test]
    fn rendered_file_boundary_is_deterministic_for_supported_stack_sizes() {
        for count in [3, 12, 64] {
            let (_directory, paths) = fixtures(count);
            let revisions = vec!["graph-v1".to_string(); count];
            let first = plan(&paths, &revisions);
            let second = plan(&paths, &revisions);
            assert!(
                first.accepted,
                "{:?} {:?}",
                first.block_codes,
                first
                    .transforms
                    .iter()
                    .map(|transform| (&transform.status, &transform.reason_codes))
                    .collect::<Vec<_>>()
            );
            assert_eq!(
                first.accepted_dry_run_plan_hash,
                second.accepted_dry_run_plan_hash
            );
            assert_eq!(first.sources.len(), count);
            assert!(
                first
                    .sources
                    .iter()
                    .all(|source| source.source_kind == "rendered_rgb_source")
            );
        }
    }

    #[test]
    fn bytes_revisions_order_and_settings_change_plan_identity() {
        let (_directory, mut paths) = fixtures(3);
        let revisions = vec!["graph-v1".to_string(); 3];
        let baseline = plan(&paths, &revisions).accepted_dry_run_plan_hash;
        let mut changed_revisions = revisions.clone();
        changed_revisions[1] = "graph-v2".to_string();
        assert_ne!(
            baseline,
            plan(&paths, &changed_revisions).accepted_dry_run_plan_hash
        );
        paths.swap(0, 2);
        assert_ne!(
            baseline,
            plan(&paths, &revisions).accepted_dry_run_plan_hash
        );
        RgbImage::from_pixel(160, 120, Rgb([255, 0, 0]))
            .save(&paths[1])
            .unwrap();
        assert_ne!(
            baseline,
            plan(&paths, &revisions).accepted_dry_run_plan_hash
        );
    }

    #[test]
    fn incompatible_geometry_blocks_and_cancellation_publishes_nothing() {
        let (_directory, paths) = fixtures(3);
        RgbImage::new(12, 12).save(&paths[2]).unwrap();
        let revisions = vec!["graph-v1".to_string(); 3];
        let blocked = plan(&paths, &revisions);
        assert!(!blocked.accepted);
        assert_eq!(blocked.block_codes, vec!["incompatible_dimensions"]);
        let handles = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(
            build_input_plan(&paths, &handles, &revisions, settings(), || true).unwrap_err(),
            "focus_stack_plan_cancelled:file_read"
        );
    }

    fn decoded(index: usize, focus: Option<f32>) -> DecodedFocusSource {
        DecodedFocusSource {
            source_index: index,
            path_handle: format!("source-{index}"),
            source_kind: "raw_sensor_source",
            content_hash: format!("blake3:{index}"),
            graph_revision: "graph-v1".to_string(),
            width: 24,
            height: 16,
            active_area: RectU32 {
                x: 0,
                y: 0,
                width: 24,
                height: 16,
            },
            orientation: "Normal".to_string(),
            camera_make: "Synthetic".to_string(),
            camera_model: "Compatible".to_string(),
            lens_model: Some("Macro 90".to_string()),
            focal_length_mm: Some(90.0),
            aperture: Some(8.0),
            focus_distance_mm: focus,
            exposure_ev: Some(0.0),
            iso: Some(100),
            calibration_identity: "calibration-v1".to_string(),
            render_identity: "focus_raw_scene_linear_v1",
            cfa_pattern: Some("RGGB".to_string()),
            clipping_ratio: 0.0,
            finite_pixel_ratio: 1.0,
            noise: index as f32 * 0.001,
            proxy_hash: format!("blake3:proxy-{index}"),
            warnings: Vec::new(),
            registration: super::raw_frame::RegistrationFrame {
                width: 24,
                height: 16,
                full_width: 24,
                full_height: 16,
                luma: (0..16)
                    .flat_map(|y| {
                        (0..24).map(move |x| ((x * 7 + y * 11 + index) % 97) as f32 / 97.0)
                    })
                    .collect(),
                color: (0..16)
                    .flat_map(|y| {
                        (0..24).map(move |x| [((x * 7 + y * 11 + index) % 97) as f32 / 97.0; 3])
                    })
                    .collect(),
                valid: vec![true; 24 * 16],
                clipped: vec![false; 24 * 16],
            },
        }
    }

    #[test]
    fn focus_metadata_drives_reference_and_non_monotonic_warning() {
        let plan = finish(
            vec![
                decoded(0, Some(300.0)),
                decoded(1, Some(200.0)),
                decoded(2, Some(100.0)),
            ],
            settings(),
            || false,
        )
        .unwrap();
        assert_eq!(plan.reference_source_index, 1);
        assert!(
            plan.warning_codes
                .contains(&"non_monotonic_focus_order".to_string())
        );
    }

    #[test]
    fn compatibility_thresholds_fail_closed() {
        let base = decoded(0, None);
        let mut camera = decoded(1, None);
        camera.camera_model = "Other".to_string();
        let mut focal = decoded(2, None);
        focal.focal_length_mm = Some(91.0);
        let mut aperture = decoded(3, None);
        aperture.aperture = Some(9.0);
        let mut exposure = decoded(4, None);
        exposure.exposure_ev = Some(3.5);
        let plan = finish(
            vec![base, camera, focal, aperture, exposure],
            settings(),
            || false,
        )
        .unwrap();
        assert!(!plan.accepted);
        for code in [
            "incompatible_camera_model",
            "incompatible_focal_length",
            "incompatible_aperture",
            "incompatible_exposure_span",
        ] {
            assert!(
                plan.block_codes.contains(&code.to_string()),
                "missing {code}"
            );
        }
    }

    #[test]
    #[ignore = "requires private Alaska focus bracket"]
    fn private_alaska_intake_writes_sanitized_plan() {
        let root = std::env::var("RAWENGINE_PRIVATE_FOCUS_ROOT").expect("private focus root");
        let names = ["_DSC7509.ARW", "_DSC7510.ARW", "_DSC7511.ARW"];
        let paths = names
            .iter()
            .map(|name| {
                std::path::Path::new(&root)
                    .join(name)
                    .to_string_lossy()
                    .into_owned()
            })
            .collect::<Vec<_>>();
        assert!(
            paths
                .iter()
                .all(|path| std::path::Path::new(path).is_file()),
            "validated focus bracket is unavailable"
        );
        let revisions = vec!["private-proof-neutral-v1".to_string(); paths.len()];
        let result = plan(&paths, &revisions);
        let repeated = plan(&paths, &revisions);
        assert_eq!(
            result.accepted_dry_run_plan_hash,
            repeated.accepted_dry_run_plan_hash
        );
        assert_eq!(
            serde_json::to_vec(&result.transforms).unwrap(),
            serde_json::to_vec(&repeated.transforms).unwrap()
        );
        let sanitized = serde_json::json!({
            "fixtureId": "alaska-plane-v1",
            "accepted": result.accepted,
            "planHash": result.accepted_dry_run_plan_hash,
            "planId": result.accepted_dry_run_plan_id,
            "referenceSourceIndex": result.reference_source_index,
            "sourceIds": names,
            "sourceHashes": result.sources.iter().map(|source| source.content_hash.clone()).collect::<Vec<_>>(),
            "dimensions": result.sources.iter().map(|source| [source.width, source.height]).collect::<Vec<_>>(),
            "warningCodes": result.warning_codes,
            "blockCodes": result.block_codes,
            "inputPlanHash": result.input_plan_hash,
            "alignmentAlgorithmId": result.alignment_algorithm_id,
            "commonOverlap": result.common_overlap,
            "transforms": result.transforms.iter().map(|transform| serde_json::json!({
                "sourceIndex": transform.source_index,
                "scale": transform.scale,
                "rotationDegrees": transform.rotation_degrees,
                "translationXPx": transform.translation_x_px,
                "translationYPx": transform.translation_y_px,
                "overlapRatio": transform.overlap_ratio,
                "p95ResidualPx": transform.p95_residual_px,
                "confidence": transform.confidence,
                "status": transform.status,
                "reasonCodes": transform.reason_codes,
                "exposureScalar": transform.exposure_normalization.scalar,
            })).collect::<Vec<_>>(),
            "previewHashes": result.previews.iter().map(|preview| preview.preview_hash.clone()).collect::<Vec<_>>(),
            "nonClaims": ["no_focus_evidence", "no_label_map", "no_pyramid_blend", "no_durable_output"]
        });
        let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../private-artifacts/validation/computational-merge/focus-stack-intake/alaska-plan.json");
        std::fs::create_dir_all(output.parent().unwrap()).unwrap();
        std::fs::write(output, serde_json::to_vec_pretty(&sanitized).unwrap()).unwrap();
    }
}
