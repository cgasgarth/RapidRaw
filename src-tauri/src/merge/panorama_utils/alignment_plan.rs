use image::{DynamicImage, GrayImage, imageops};
use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};

const PYRAMID_LEVELS: u8 = 3;
const MAX_FEATURES_PER_LEVEL: usize = 700;
const MATCH_RATIO_NUMERATOR: u32 = 72;
const MATCH_RATIO_DENOMINATOR: u32 = 100;
const MAX_DESCRIPTOR_DISTANCE: u32 = 104;
const MIN_EDGE_INLIERS: usize = 12;
const MIN_SPATIAL_CELLS: usize = 3;
const INLIER_THRESHOLD_PX: f64 = 3.0;
const HUBER_DELTA_PX: f64 = 2.0;
const SOLVE_ITERATIONS: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationEvidence {
    pub source: String,
    pub focal_length_35mm: Option<f64>,
    pub focal_length_px: Option<f64>,
    pub principal_point_px: [f64; 2],
    pub radial_k1: Option<f64>,
    pub observable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSource {
    pub source_index: usize,
    pub content_hash: String,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
    pub calibration: CalibrationEvidence,
    pub feature_count: usize,
    pub feature_artifact_hash: String,
    pub texture_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchOverlayArtifact {
    pub artifact_id: String,
    pub artifact_hash: String,
    pub sampled_inlier_count: usize,
    pub width: u32,
    pub height: u32,
    pub sampled_lines: Vec<MatchOverlayLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchOverlayLine {
    pub source_px: [f64; 2],
    pub target_px: [f64; 2],
    pub error_px: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentEdge {
    pub source_index: usize,
    pub target_index: usize,
    pub status: String,
    pub rejection_reasons: Vec<String>,
    pub candidate_match_count: usize,
    pub reciprocal_match_count: usize,
    pub inlier_count: usize,
    pub inlier_ratio: f64,
    pub spatial_support_cell_count: usize,
    pub transform_condition_number: Option<f64>,
    pub transform_model: String,
    pub transform_3x3: [f64; 9],
    pub translation_px: [f64; 2],
    pub symmetric_error_rms_px: f64,
    pub symmetric_error_p95_px: f64,
    pub overlap_ratio: f64,
    pub match_artifact_hash: String,
    pub overlay: MatchOverlayArtifact,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraPose {
    pub source_index: usize,
    pub yaw_degrees: f64,
    pub pitch_degrees: f64,
    pub translation_px: [f64; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSolution {
    pub reference_source_index: usize,
    pub converged: bool,
    pub iterations: usize,
    pub robust_loss: String,
    pub residual_rms_px: f64,
    pub residual_p95_px: f64,
    pub cycle_closure_error_px: f64,
    pub camera_poses: Vec<CameraPose>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverlapSeamHandoff {
    pub source_index: usize,
    pub target_index: usize,
    pub overlap_ratio: f64,
    pub confidence: String,
    pub seam_search_ready: bool,
    pub source_bounds_px: [f64; 4],
    pub target_bounds_px: [f64; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalibratedAlignmentPlan {
    pub schema_version: String,
    pub readiness: String,
    pub algorithm_id: String,
    pub policy_hash: String,
    pub plan_hash: String,
    pub sources: Vec<AlignmentSource>,
    pub edges: Vec<AlignmentEdge>,
    pub global_solution: Option<GlobalSolution>,
    pub excluded_source_indices: Vec<usize>,
    pub overlap_seam_handoff: Vec<OverlapSeamHandoff>,
    pub estimated_horizontal_fov_degrees: Option<f64>,
    pub warning_codes: Vec<String>,
    pub blocked_reasons: Vec<String>,
    pub completed_stages: Vec<String>,
}

#[derive(Default)]
pub struct AlignmentCancellation {
    cancelled: AtomicBool,
}

impl AlignmentCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
    fn check(&self, stage: &str) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(format!(
                "Panorama alignment cancelled during {stage}; no plan was published."
            ))
        } else {
            Ok(())
        }
    }
}

#[derive(Clone)]
struct OrientedFeature {
    x: f64,
    y: f64,
    descriptor: [u8; 32],
}

#[derive(Clone, Copy)]
struct FeatureMatch {
    a: usize,
    b: usize,
    distance: u32,
}

pub fn build_calibrated_alignment_plan<F>(
    paths: &[String],
    images: &[DynamicImage],
    cancellation: &AlignmentCancellation,
    mut progress: F,
) -> Result<CalibratedAlignmentPlan, String>
where
    F: FnMut(&str),
{
    if paths.len() != images.len() || paths.len() < 2 {
        return Err(
            "Panorama alignment requires matching path/image arrays with at least two sources."
                .into(),
        );
    }
    let mut completed_stages = Vec::new();
    stage(
        cancellation,
        &mut progress,
        &mut completed_stages,
        "source_decode",
    )?;
    let mut sources = Vec::with_capacity(paths.len());
    let mut feature_sets = Vec::with_capacity(paths.len());
    for (source_index, (path, image)) in paths.iter().zip(images).enumerate() {
        cancellation.check("calibration")?;
        let gray = image.to_luma8();
        let calibration =
            calibration_for_path(path, gray.width(), gray.height(), &bytes_for_path(path)?);
        let features = extract_features(&gray);
        let feature_bytes = feature_bytes(&features);
        let bytes = bytes_for_path(path)?;
        sources.push(AlignmentSource {
            source_index,
            content_hash: blake3_hash(&bytes),
            width: gray.width(),
            height: gray.height(),
            orientation: 1,
            calibration,
            feature_count: features.len(),
            feature_artifact_hash: blake3_hash(&feature_bytes),
            texture_score: texture_score(&gray),
        });
        feature_sets.push(features);
    }
    stage(
        cancellation,
        &mut progress,
        &mut completed_stages,
        "calibration",
    )?;
    stage(
        cancellation,
        &mut progress,
        &mut completed_stages,
        "pyramid_features",
    )?;

    let mut edges = Vec::new();
    for source_index in 0..paths.len() {
        for target_index in source_index + 1..paths.len() {
            cancellation.check("pair_matching")?;
            edges.push(estimate_edge(
                source_index,
                target_index,
                &sources[source_index],
                &sources[target_index],
                &feature_sets[source_index],
                &feature_sets[target_index],
            ));
        }
    }
    edges.sort_by_key(|edge| (edge.source_index, edge.target_index));
    stage(
        cancellation,
        &mut progress,
        &mut completed_stages,
        "pair_matching",
    )?;

    let mut accepted: Vec<_> = edges
        .iter()
        .filter(|edge| edge.status == "accepted")
        .cloned()
        .collect();
    let connected = connected_sources(paths.len(), &accepted, 0);
    let excluded_source_indices = (0..paths.len())
        .filter(|index| !connected.contains(index))
        .collect::<Vec<_>>();
    stage(
        cancellation,
        &mut progress,
        &mut completed_stages,
        "graph_validation",
    )?;

    let calibration_ready = sources.iter().all(|source| source.calibration.observable);
    let mut graph_ready =
        excluded_source_indices.is_empty() && accepted.len() >= paths.len().saturating_sub(1);
    let mut global_solution = if graph_ready {
        Some(solve_global(&sources, &accepted, cancellation)?)
    } else {
        None
    };
    if let Some(solution) = &global_solution {
        let mut global_edge_residuals = edges
            .iter()
            .filter(|edge| edge.status == "accepted")
            .map(|edge| {
                let source = solution.camera_poses[edge.source_index].translation_px;
                let target = solution.camera_poses[edge.target_index].translation_px;
                distance(
                    [target[0] - source[0], target[1] - source[1]],
                    edge.translation_px,
                )
            })
            .collect::<Vec<_>>();
        global_edge_residuals.sort_by(f64::total_cmp);
        let residual_limit =
            (percentile(&global_edge_residuals, 0.4) * 3.0).max(INLIER_THRESHOLD_PX * 1.5);
        for edge in &mut edges {
            if edge.status != "accepted" {
                continue;
            }
            let source = solution.camera_poses[edge.source_index].translation_px;
            let target = solution.camera_poses[edge.target_index].translation_px;
            let residual = distance(
                [target[0] - source[0], target[1] - source[1]],
                edge.translation_px,
            );
            if residual > residual_limit {
                edge.status = "rejected".into();
                edge.rejection_reasons
                    .push("global_residual_outlier".into());
            }
        }
        accepted = edges
            .iter()
            .filter(|edge| edge.status == "accepted")
            .cloned()
            .collect();
        graph_ready = connected_sources(paths.len(), &accepted, 0).len() == paths.len()
            && accepted.len() >= paths.len().saturating_sub(1);
        if graph_ready {
            global_solution = Some(solve_global(&sources, &accepted, cancellation)?);
        } else {
            global_solution = None;
        }
    }
    stage(
        cancellation,
        &mut progress,
        &mut completed_stages,
        "global_solve",
    )?;
    stage(
        cancellation,
        &mut progress,
        &mut completed_stages,
        "overlay_encode",
    )?;

    let mut blocked_reasons = Vec::new();
    let mut warning_codes = Vec::new();
    if !calibration_ready {
        blocked_reasons.push("calibration_unobservable".into());
    }
    if !graph_ready {
        blocked_reasons.push("match_graph_disconnected".into());
    }
    if edges.iter().any(|edge| edge.status == "rejected") {
        warning_codes.push("rejected_match_edges_present".into());
    }
    if sources.iter().any(|source| source.texture_score < 0.02) {
        warning_codes.push("low_texture_source".into());
    }
    let solve_ready = global_solution
        .as_ref()
        .is_some_and(|solve| solve.residual_p95_px <= 2.0 && solve.cycle_closure_error_px <= 1.0);
    if graph_ready && !solve_ready {
        blocked_reasons.push("global_residual_exceeded".into());
    }
    let readiness = if blocked_reasons.is_empty() {
        "global_alignment_plan_ready"
    } else {
        "blocked"
    }
    .to_string();
    let overlap_seam_handoff = accepted
        .iter()
        .map(|edge| OverlapSeamHandoff {
            source_index: edge.source_index,
            target_index: edge.target_index,
            overlap_ratio: edge.overlap_ratio,
            confidence: if edge.inlier_ratio >= 0.7 && edge.spatial_support_cell_count >= 6 {
                "high"
            } else {
                "medium"
            }
            .into(),
            seam_search_ready: readiness == "global_alignment_plan_ready",
            source_bounds_px: overlap_bounds(edge, &sources[edge.source_index], true),
            target_bounds_px: overlap_bounds(edge, &sources[edge.target_index], false),
        })
        .collect();
    let estimated_horizontal_fov_degrees =
        estimate_horizontal_fov(&sources, global_solution.as_ref());
    let mut plan = CalibratedAlignmentPlan {
        schema_version: "panorama_calibrated_alignment_plan_v1".into(),
        readiness,
        algorithm_id: "rapidraw_oriented_brief_calibrated_global_pose_v1".into(),
        policy_hash: blake3_hash(
            b"pyramid=3;features=700;ratio=.72;distance=104;inlier=3;huber=2;iterations=24",
        ),
        plan_hash: String::new(),
        sources,
        edges,
        global_solution,
        excluded_source_indices,
        overlap_seam_handoff,
        estimated_horizontal_fov_degrees,
        warning_codes,
        blocked_reasons,
        completed_stages,
    };
    cancellation.check("plan_publish")?;
    plan.completed_stages.push("plan_publish".into());
    plan.plan_hash = canonical_plan_hash(&plan)?;
    progress("plan_publish");
    Ok(plan)
}

fn stage<F: FnMut(&str)>(
    cancellation: &AlignmentCancellation,
    progress: &mut F,
    completed: &mut Vec<String>,
    name: &str,
) -> Result<(), String> {
    cancellation.check(name)?;
    progress(name);
    completed.push(name.into());
    Ok(())
}

fn bytes_for_path(path: &str) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("Failed to read panorama source {path}: {error}"))
}

fn calibration_for_path(path: &str, width: u32, height: u32, bytes: &[u8]) -> CalibrationEvidence {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Sidecar {
        focal_length_35mm: Option<f64>,
        radial_k1: Option<f64>,
    }
    let sidecar_path = format!("{path}.panorama-calibration.json");
    let sidecar = fs::read(&sidecar_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Sidecar>(&bytes).ok());
    let exif = crate::exif_processing::read_exif_data_from_bytes(path, bytes);
    let exif_focal = exif
        .get("FocalLengthIn35mmFilm")
        .and_then(|value| parse_first_positive_number(value));
    let focal_35 = sidecar
        .as_ref()
        .and_then(|value| value.focal_length_35mm)
        .or(exif_focal)
        .filter(|value| *value >= 8.0 && *value <= 800.0);
    let focal_px = focal_35.map(|focal| width as f64 * focal / 36.0);
    CalibrationEvidence {
        source: if sidecar.is_some() {
            "verified_sidecar"
        } else if exif_focal.is_some() {
            "embedded_exif_35mm"
        } else {
            "missing"
        }
        .into(),
        focal_length_35mm: focal_35,
        focal_length_px: focal_px,
        principal_point_px: [width as f64 / 2.0, height as f64 / 2.0],
        radial_k1: sidecar.and_then(|value| value.radial_k1),
        observable: focal_px.is_some(),
    }
}

fn parse_first_positive_number(value: &str) -> Option<f64> {
    value
        .split(|character: char| !(character.is_ascii_digit() || character == '.'))
        .find_map(|token| token.parse::<f64>().ok().filter(|number| *number > 0.0))
}

fn extract_features(gray: &GrayImage) -> Vec<OrientedFeature> {
    let mut all = Vec::new();
    let mut level_image = gray.clone();
    for level in 0..PYRAMID_LEVELS {
        let scale = (1u32 << level) as f64;
        let mut candidates = Vec::new();
        let (width, height) = level_image.dimensions();
        if width < 18 || height < 18 {
            break;
        }
        for y in (8..height - 8).step_by(3) {
            for x in (8..width - 8).step_by(3) {
                let gx = level_image.get_pixel(x + 1, y)[0] as i32
                    - level_image.get_pixel(x - 1, y)[0] as i32;
                let gy = level_image.get_pixel(x, y + 1)[0] as i32
                    - level_image.get_pixel(x, y - 1)[0] as i32;
                let score = gx.unsigned_abs() + gy.unsigned_abs();
                if score >= 28 {
                    candidates.push((score, y, x, gx, gy));
                }
            }
        }
        candidates.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let mut occupied = BTreeSet::new();
        for (_, y, x, gx, gy) in candidates {
            let cell = (x / 6, y / 6);
            if !occupied.insert(cell) {
                continue;
            }
            all.push(OrientedFeature {
                x: x as f64 * scale,
                y: y as f64 * scale,
                descriptor: oriented_descriptor(&level_image, x, y, gx, gy),
            });
            if occupied.len() >= MAX_FEATURES_PER_LEVEL {
                break;
            }
        }
        level_image = imageops::resize(
            &level_image,
            (width / 2).max(1),
            (height / 2).max(1),
            imageops::FilterType::Triangle,
        );
    }
    all.sort_by(|a, b| {
        a.y.total_cmp(&b.y)
            .then(a.x.total_cmp(&b.x))
            .then(a.descriptor.cmp(&b.descriptor))
    });
    all
}

fn oriented_descriptor(gray: &GrayImage, x: u32, y: u32, gx: i32, gy: i32) -> [u8; 32] {
    let quarter_turn = if gx.abs() >= gy.abs() {
        if gx >= 0 { 0 } else { 2 }
    } else if gy >= 0 {
        1
    } else {
        3
    };
    let mut descriptor = [0u8; 32];
    for bit in 0..256usize {
        let seed = (bit as i32)
            .wrapping_mul(1_103_515_245)
            .wrapping_add(12_345);
        let ax = ((seed >> 3) % 13) - 6;
        let ay = ((seed >> 11) % 13) - 6;
        let bx = ((seed >> 19) % 13) - 6;
        let by = ((seed >> 25) % 13) - 6;
        let (ax, ay) = rotate_quarter(ax, ay, quarter_turn);
        let (bx, by) = rotate_quarter(bx, by, quarter_turn);
        let sample = |dx: i32, dy: i32| {
            gray.get_pixel(
                (x as i32 + dx).clamp(0, gray.width() as i32 - 1) as u32,
                (y as i32 + dy).clamp(0, gray.height() as i32 - 1) as u32,
            )[0]
        };
        if sample(ax, ay) < sample(bx, by) {
            descriptor[bit / 8] |= 1 << (bit % 8);
        }
    }
    descriptor
}

fn rotate_quarter(x: i32, y: i32, turn: i32) -> (i32, i32) {
    match turn {
        1 => (-y, x),
        2 => (-x, -y),
        3 => (y, -x),
        _ => (x, y),
    }
}

fn match_features(a: &[OrientedFeature], b: &[OrientedFeature]) -> (usize, Vec<FeatureMatch>) {
    let forward = nearest_matches(a, b);
    let reverse = nearest_matches(b, a);
    let candidate_count = forward.iter().filter(|item| item.is_some()).count();
    let mut matches = Vec::new();
    for (a_index, candidate) in forward.into_iter().enumerate() {
        if let Some((b_index, distance)) = candidate
            && reverse
                .get(b_index)
                .and_then(|value| *value)
                .is_some_and(|(reverse_index, _)| reverse_index == a_index)
        {
            matches.push(FeatureMatch {
                a: a_index,
                b: b_index,
                distance,
            });
        }
    }
    matches.sort_by_key(|item| (item.distance, item.a, item.b));
    (candidate_count, matches)
}

fn nearest_matches(
    query: &[OrientedFeature],
    train: &[OrientedFeature],
) -> Vec<Option<(usize, u32)>> {
    query
        .iter()
        .map(|feature| {
            let mut distances = train
                .iter()
                .enumerate()
                .map(|(index, other)| (hamming(&feature.descriptor, &other.descriptor), index))
                .collect::<Vec<_>>();
            distances.sort_by_key(|item| (item.0, item.1));
            match (distances.first(), distances.get(1)) {
                (Some(&(best, index)), Some(&(second, _)))
                    if best <= MAX_DESCRIPTOR_DISTANCE
                        && best * MATCH_RATIO_DENOMINATOR < second * MATCH_RATIO_NUMERATOR =>
                {
                    Some((index, best))
                }
                _ => None,
            }
        })
        .collect()
}

fn estimate_edge(
    source_index: usize,
    target_index: usize,
    source: &AlignmentSource,
    target: &AlignmentSource,
    a: &[OrientedFeature],
    b: &[OrientedFeature],
) -> AlignmentEdge {
    let (candidate_match_count, matches) = match_features(a, b);
    let mut hypotheses = matches
        .iter()
        .map(|m| [b[m.b].x - a[m.a].x, b[m.b].y - a[m.a].y])
        .collect::<Vec<_>>();
    hypotheses.sort_by(|left, right| {
        left[0]
            .total_cmp(&right[0])
            .then(left[1].total_cmp(&right[1]))
    });
    let mut best_translation = [0.0, 0.0];
    let mut best_inliers: Vec<&FeatureMatch> = Vec::new();
    for hypothesis in hypotheses.iter().take(512) {
        let inliers = matches
            .iter()
            .filter(|m| {
                distance([b[m.b].x - a[m.a].x, b[m.b].y - a[m.a].y], *hypothesis)
                    <= INLIER_THRESHOLD_PX
            })
            .collect::<Vec<_>>();
        if inliers.len() > best_inliers.len() {
            best_translation = *hypothesis;
            best_inliers = inliers;
        }
    }
    if !best_inliers.is_empty() {
        best_translation[0] = median(best_inliers.iter().map(|m| b[m.b].x - a[m.a].x).collect());
        best_translation[1] = median(best_inliers.iter().map(|m| b[m.b].y - a[m.a].y).collect());
    }
    let keypoints_a = a
        .iter()
        .map(|feature| crate::panorama_stitching::KeyPoint {
            x: feature.x.round() as u32,
            y: feature.y.round() as u32,
        })
        .collect::<Vec<_>>();
    let keypoints_b = b
        .iter()
        .map(|feature| crate::panorama_stitching::KeyPoint {
            x: feature.x.round() as u32,
            y: feature.y.round() as u32,
        })
        .collect::<Vec<_>>();
    let native_matches = matches
        .iter()
        .map(|item| crate::panorama_stitching::Match {
            index1: item.a,
            index2: item.b,
        })
        .collect::<Vec<_>>();
    let robust_transform =
        super::processing::find_homography_ransac(&native_matches, &keypoints_a, &keypoints_b);
    if let Some((homography, robust_inliers)) = &robust_transform {
        let inlier_pairs = robust_inliers
            .iter()
            .map(|item| (item.index1, item.index2))
            .collect::<BTreeSet<_>>();
        best_inliers = matches
            .iter()
            .filter(|item| inlier_pairs.contains(&(item.a, item.b)))
            .collect();
        best_translation = [homography[(0, 2)], homography[(1, 2)]];
    }
    let mut errors = best_inliers
        .iter()
        .map(|item| {
            robust_transform
                .as_ref()
                .and_then(|(transform, _)| {
                    symmetric_transfer_error(transform, &a[item.a], &b[item.b])
                })
                .unwrap_or_else(|| {
                    distance(
                        [b[item.b].x - a[item.a].x, b[item.b].y - a[item.a].y],
                        best_translation,
                    )
                })
        })
        .collect::<Vec<_>>();
    errors.sort_by(f64::total_cmp);
    let sampled_lines = best_inliers
        .iter()
        .take(96)
        .map(|item| MatchOverlayLine {
            source_px: [a[item.a].x, a[item.a].y],
            target_px: [b[item.b].x, b[item.b].y],
            error_px: robust_transform
                .as_ref()
                .and_then(|(transform, _)| {
                    symmetric_transfer_error(transform, &a[item.a], &b[item.b])
                })
                .unwrap_or_else(|| {
                    distance(
                        [b[item.b].x - a[item.a].x, b[item.b].y - a[item.a].y],
                        best_translation,
                    )
                }),
        })
        .collect::<Vec<_>>();
    let cells = best_inliers
        .iter()
        .map(|m| {
            (
                (a[m.a].x / source.width as f64 * 4.0).floor() as u8,
                (a[m.a].y / source.height as f64 * 4.0).floor() as u8,
            )
        })
        .collect::<BTreeSet<_>>()
        .len();
    let overlap_x = (source.width as f64 - best_translation[0].abs()).max(0.0);
    let overlap_y = (source.height.min(target.height) as f64 - best_translation[1].abs()).max(0.0);
    let overlap_ratio = overlap_x * overlap_y / (source.width * source.height).max(1) as f64;
    let mut rejection_reasons = Vec::new();
    if best_inliers.len() < MIN_EDGE_INLIERS {
        rejection_reasons.push("insufficient_inliers".into());
    }
    if cells < MIN_SPATIAL_CELLS {
        rejection_reasons.push("insufficient_spatial_support".into());
    }
    if overlap_ratio < 0.08 {
        rejection_reasons.push("insufficient_overlap".into());
    }
    if robust_transform.is_none() {
        rejection_reasons.push("robust_transform_failed".into());
    }
    let match_bytes = matches
        .iter()
        .flat_map(|m| [m.a as u64, m.b as u64, m.distance as u64])
        .flat_map(u64::to_le_bytes)
        .collect::<Vec<_>>();
    let artifact_hash = blake3_hash(&match_bytes);
    let transform = robust_transform
        .as_ref()
        .map(|(homography, _)| *homography)
        .unwrap_or_else(|| {
            Matrix3::new(
                1.0,
                0.0,
                best_translation[0],
                0.0,
                1.0,
                best_translation[1],
                0.0,
                0.0,
                1.0,
            )
        });
    AlignmentEdge {
        source_index,
        target_index,
        status: if rejection_reasons.is_empty() {
            "accepted"
        } else {
            "rejected"
        }
        .into(),
        rejection_reasons,
        candidate_match_count,
        reciprocal_match_count: matches.len(),
        inlier_count: best_inliers.len(),
        inlier_ratio: best_inliers.len() as f64 / matches.len().max(1) as f64,
        spatial_support_cell_count: cells,
        transform_condition_number: matrix_condition_number(&transform),
        transform_model: if robust_transform.is_some() {
            "deterministic_homography_ransac"
        } else {
            "translation_fallback_rejected"
        }
        .into(),
        transform_3x3: matrix_to_array(&transform),
        translation_px: best_translation,
        symmetric_error_rms_px: rms(&errors),
        symmetric_error_p95_px: percentile(&errors, 0.95),
        overlap_ratio,
        match_artifact_hash: artifact_hash.clone(),
        overlay: MatchOverlayArtifact {
            artifact_id: format!("panorama-match-{source_index}-{target_index}"),
            artifact_hash,
            sampled_inlier_count: best_inliers.len().min(96),
            width: source.width + target.width,
            height: source.height.max(target.height),
            sampled_lines,
        },
    }
}

fn matrix_to_array(matrix: &Matrix3<f64>) -> [f64; 9] {
    [
        matrix[(0, 0)],
        matrix[(0, 1)],
        matrix[(0, 2)],
        matrix[(1, 0)],
        matrix[(1, 1)],
        matrix[(1, 2)],
        matrix[(2, 0)],
        matrix[(2, 1)],
        matrix[(2, 2)],
    ]
}

fn matrix_condition_number(matrix: &Matrix3<f64>) -> Option<f64> {
    let singular = matrix.svd(false, false).singular_values;
    let minimum = singular.min();
    (minimum.is_finite() && minimum > f64::EPSILON)
        .then(|| singular.max() / minimum)
        .filter(|value| value.is_finite())
}

fn symmetric_transfer_error(
    transform: &Matrix3<f64>,
    source: &OrientedFeature,
    target: &OrientedFeature,
) -> Option<f64> {
    let inverse = transform.try_inverse()?;
    let forward = project(transform, [source.x, source.y])?;
    let reverse = project(&inverse, [target.x, target.y])?;
    Some(
        ((distance(forward, [target.x, target.y]).powi(2)
            + distance(reverse, [source.x, source.y]).powi(2))
            / 2.0)
            .sqrt(),
    )
}

fn project(transform: &Matrix3<f64>, point: [f64; 2]) -> Option<[f64; 2]> {
    let projected = transform * Vector3::new(point[0], point[1], 1.0);
    (projected[2].is_finite() && projected[2].abs() > f64::EPSILON)
        .then(|| [projected[0] / projected[2], projected[1] / projected[2]])
}

fn solve_global(
    sources: &[AlignmentSource],
    edges: &[AlignmentEdge],
    cancellation: &AlignmentCancellation,
) -> Result<GlobalSolution, String> {
    let reference = sources.len() / 2;
    let mut positions = vec![[0.0, 0.0]; sources.len()];
    let mut initialized = BTreeSet::from([reference]);
    while initialized.len() < sources.len() {
        let next = edges
            .iter()
            .filter(|edge| {
                initialized.contains(&edge.source_index) ^ initialized.contains(&edge.target_index)
            })
            .max_by_key(|edge| (edge.inlier_count, edge.spatial_support_cell_count));
        let Some(edge) = next else { break };
        if initialized.contains(&edge.source_index) {
            positions[edge.target_index] = [
                positions[edge.source_index][0] + edge.translation_px[0],
                positions[edge.source_index][1] + edge.translation_px[1],
            ];
            initialized.insert(edge.target_index);
        } else {
            positions[edge.source_index] = [
                positions[edge.target_index][0] - edge.translation_px[0],
                positions[edge.target_index][1] - edge.translation_px[1],
            ];
            initialized.insert(edge.source_index);
        }
    }
    let anchor = positions[reference];
    for position in &mut positions {
        position[0] -= anchor[0];
        position[1] -= anchor[1];
    }
    let mut previous_cost = f64::INFINITY;
    let mut converged = false;
    let mut completed_iterations = 0;
    for iteration in 0..SOLVE_ITERATIONS {
        cancellation.check("global_solve")?;
        let mut sums = vec![[0.0, 0.0]; sources.len()];
        let mut weights = vec![0.0; sources.len()];
        for edge in edges {
            let residual = [
                positions[edge.target_index][0]
                    - positions[edge.source_index][0]
                    - edge.translation_px[0],
                positions[edge.target_index][1]
                    - positions[edge.source_index][1]
                    - edge.translation_px[1],
            ];
            let norm = distance(residual, [0.0, 0.0]);
            let robust_weight = if norm <= HUBER_DELTA_PX {
                1.0
            } else {
                HUBER_DELTA_PX / norm
            };
            let evidence_weight = (edge.inlier_count as f64 * edge.inlier_ratio.max(0.05)).sqrt();
            let weight = robust_weight * evidence_weight;
            let target_from_source = [
                positions[edge.source_index][0] + edge.translation_px[0],
                positions[edge.source_index][1] + edge.translation_px[1],
            ];
            let source_from_target = [
                positions[edge.target_index][0] - edge.translation_px[0],
                positions[edge.target_index][1] - edge.translation_px[1],
            ];
            for axis in 0..2 {
                sums[edge.target_index][axis] += weight * target_from_source[axis];
                sums[edge.source_index][axis] += weight * source_from_target[axis];
            }
            weights[edge.target_index] += weight;
            weights[edge.source_index] += weight;
        }
        let cost = edges
            .iter()
            .map(|edge| {
                let residual = distance(
                    [
                        positions[edge.target_index][0] - positions[edge.source_index][0],
                        positions[edge.target_index][1] - positions[edge.source_index][1],
                    ],
                    edge.translation_px,
                );
                if residual <= HUBER_DELTA_PX {
                    0.5 * residual * residual
                } else {
                    HUBER_DELTA_PX * (residual - 0.5 * HUBER_DELTA_PX)
                }
            })
            .sum::<f64>();
        completed_iterations = iteration + 1;
        if (previous_cost - cost).abs() <= 1e-7 * previous_cost.max(1.0) {
            converged = true;
            break;
        }
        previous_cost = cost;
        for index in 0..positions.len() {
            if index != reference && weights[index] > 0.0 {
                positions[index] = [
                    sums[index][0] / weights[index],
                    sums[index][1] / weights[index],
                ];
            }
        }
    }
    let mut residuals = edges
        .iter()
        .map(|edge| {
            distance(
                [
                    positions[edge.target_index][0] - positions[edge.source_index][0],
                    positions[edge.target_index][1] - positions[edge.source_index][1],
                ],
                edge.translation_px,
            )
        })
        .collect::<Vec<_>>();
    residuals.sort_by(f64::total_cmp);
    let focal = sources[reference]
        .calibration
        .focal_length_px
        .unwrap_or(sources[reference].width as f64);
    Ok(GlobalSolution {
        reference_source_index: reference,
        converged,
        iterations: completed_iterations,
        robust_loss: "huber".into(),
        residual_rms_px: rms(&residuals),
        residual_p95_px: percentile(&residuals, 0.95),
        cycle_closure_error_px: percentile(&residuals, 1.0),
        camera_poses: positions
            .iter()
            .enumerate()
            .map(|(source_index, position)| CameraPose {
                source_index,
                yaw_degrees: position[0].atan2(focal).to_degrees(),
                pitch_degrees: position[1].atan2(focal).to_degrees(),
                translation_px: *position,
            })
            .collect(),
    })
}

fn overlap_bounds(edge: &AlignmentEdge, source: &AlignmentSource, source_space: bool) -> [f64; 4] {
    let dx = edge.translation_px[0];
    let dy = edge.translation_px[1];
    let (left, top) = if source_space {
        (dx.max(0.0), dy.max(0.0))
    } else {
        ((-dx).max(0.0), (-dy).max(0.0))
    };
    let width = (source.width as f64 - dx.abs()).max(0.0);
    let height = (source.height as f64 - dy.abs()).max(0.0);
    [left, top, width, height]
}

fn connected_sources(count: usize, edges: &[AlignmentEdge], root: usize) -> BTreeSet<usize> {
    let mut adjacency = vec![Vec::new(); count];
    for edge in edges {
        adjacency[edge.source_index].push(edge.target_index);
        adjacency[edge.target_index].push(edge.source_index);
    }
    let mut seen = BTreeSet::new();
    let mut queue = VecDeque::from([root]);
    while let Some(index) = queue.pop_front() {
        if seen.insert(index) {
            for next in &adjacency[index] {
                queue.push_back(*next);
            }
        }
    }
    seen
}
fn estimate_horizontal_fov(
    sources: &[AlignmentSource],
    solution: Option<&GlobalSolution>,
) -> Option<f64> {
    let solve = solution?;
    let min = solve
        .camera_poses
        .iter()
        .map(|pose| pose.yaw_degrees)
        .min_by(f64::total_cmp)?;
    let max = solve
        .camera_poses
        .iter()
        .map(|pose| pose.yaw_degrees)
        .max_by(f64::total_cmp)?;
    let source = &sources[solve.reference_source_index];
    let focal = source.calibration.focal_length_px?;
    Some((max - min + 2.0 * (source.width as f64 / (2.0 * focal)).atan().to_degrees()).min(180.0))
}
fn feature_bytes(features: &[OrientedFeature]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for feature in features {
        bytes.extend_from_slice(&feature.x.to_le_bytes());
        bytes.extend_from_slice(&feature.y.to_le_bytes());
        bytes.extend_from_slice(&feature.descriptor);
    }
    bytes
}
fn texture_score(gray: &GrayImage) -> f64 {
    let mut sum = 0u64;
    let mut count = 0u64;
    for y in 1..gray.height().saturating_sub(1) {
        for x in 1..gray.width().saturating_sub(1) {
            sum += (gray.get_pixel(x + 1, y)[0] as i32 - gray.get_pixel(x - 1, y)[0] as i32)
                .unsigned_abs() as u64;
            count += 1;
        }
    }
    sum as f64 / count.max(1) as f64 / 255.0
}
fn hamming(a: &[u8; 32], b: &[u8; 32]) -> u32 {
    a.iter()
        .zip(b)
        .map(|(left, right)| (left ^ right).count_ones())
        .sum()
}
fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    percentile(&values, 0.5)
}
fn percentile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values[((values.len() - 1) as f64 * percentile).round() as usize]
}
fn rms(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        (values.iter().map(|value| value * value).sum::<f64>() / values.len() as f64).sqrt()
    }
}
fn blake3_hash(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}
fn canonical_plan_hash(plan: &CalibratedAlignmentPlan) -> Result<String, String> {
    let mut value = serde_json::to_value(plan).map_err(|error| error.to_string())?;
    value["planHash"] = serde_json::Value::String(String::new());
    let canonical = canonical_json(&value);
    Ok(blake3_hash(canonical.as_bytes()))
}
fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => {
            let sorted = map.iter().collect::<BTreeMap<_, _>>();
            format!(
                "{{{}}}",
                sorted
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        canonical_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        serde_json::Value::Array(items) => format!(
            "[{}]",
            items
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        _ => serde_json::to_string(value).unwrap(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Luma};
    use tempfile::tempdir;

    fn fixture() -> (tempfile::TempDir, Vec<String>, Vec<DynamicImage>) {
        let dir = tempdir().unwrap();
        let scene = ImageBuffer::from_fn(517, 120, |x, y| {
            let mut value = x.wrapping_mul(0x9e37_79b9) ^ y.wrapping_mul(0x85eb_ca6b);
            value ^= value >> 16;
            value = value.wrapping_mul(0x7feb_352d);
            value ^= value >> 15;
            Luma([(value ^ (value >> 8)) as u8])
        });
        let mut paths = Vec::new();
        let mut images = Vec::new();
        for index in 0..4 {
            let crop = imageops::crop_imm(&scene, index * 99, 0, 220, 120).to_image();
            let path = dir.path().join(format!("source-{index}.png"));
            crop.save(&path).unwrap();
            fs::write(
                format!("{}.panorama-calibration.json", path.display()),
                r#"{"focalLength35mm":50.0,"radialK1":0.0}"#,
            )
            .unwrap();
            paths.push(path.to_string_lossy().into_owned());
            images.push(DynamicImage::ImageLuma8(crop));
        }
        (dir, paths, images)
    }

    #[test]
    fn deterministic_native_fixture_builds_calibrated_global_plan() {
        let (_dir, paths, images) = fixture();
        let first = build_calibrated_alignment_plan(
            &paths,
            &images,
            &AlignmentCancellation::default(),
            |_| {},
        )
        .unwrap();
        let second = build_calibrated_alignment_plan(
            &paths,
            &images,
            &AlignmentCancellation::default(),
            |_| {},
        )
        .unwrap();
        assert_eq!(first.plan_hash, second.plan_hash);
        assert_eq!(
            first.readiness,
            "global_alignment_plan_ready",
            "blocked={:?} edges={:?} solve={:?}",
            first.blocked_reasons,
            first
                .edges
                .iter()
                .map(|edge| (
                    &edge.status,
                    &edge.rejection_reasons,
                    edge.inlier_count,
                    edge.translation_px
                ))
                .collect::<Vec<_>>(),
            first.global_solution,
        );
        assert!(
            first
                .edges
                .iter()
                .filter(|edge| edge.status == "accepted")
                .count()
                >= 3
        );
        let solve = first.global_solution.unwrap();
        assert!(solve.residual_p95_px <= 2.0);
        assert!(solve.cycle_closure_error_px <= 1.0);
    }

    #[test]
    fn cancellation_never_publishes_a_plan() {
        let (_dir, paths, images) = fixture();
        let cancellation = AlignmentCancellation::default();
        cancellation.cancel();
        let error =
            build_calibrated_alignment_plan(&paths, &images, &cancellation, |_| {}).unwrap_err();
        assert!(error.contains("no plan was published"));
    }

    #[test]
    fn cancellation_is_observed_after_every_prepublication_stage() {
        for cancelled_stage in [
            "source_decode",
            "calibration",
            "pyramid_features",
            "pair_matching",
            "graph_validation",
            "global_solve",
            "overlay_encode",
        ] {
            let (_dir, paths, images) = fixture();
            let cancellation = AlignmentCancellation::default();
            let result = build_calibrated_alignment_plan(&paths, &images, &cancellation, |stage| {
                if stage == cancelled_stage {
                    cancellation.cancel();
                }
            });
            let error = result.expect_err(cancelled_stage);
            assert!(
                error.contains("no plan was published"),
                "{cancelled_stage}: {error}"
            );
        }
    }

    #[test]
    fn missing_calibration_blocks_without_hiding_match_artifacts() {
        let (_dir, paths, images) = fixture();
        for path in &paths {
            fs::remove_file(format!("{path}.panorama-calibration.json")).unwrap();
        }
        let plan = build_calibrated_alignment_plan(
            &paths,
            &images,
            &AlignmentCancellation::default(),
            |_| {},
        )
        .unwrap();
        assert_eq!(plan.readiness, "blocked");
        assert!(
            plan.blocked_reasons
                .contains(&"calibration_unobservable".into())
        );
        assert!(
            plan.edges
                .iter()
                .any(|edge| !edge.overlay.sampled_lines.is_empty())
        );
        assert!(
            plan.overlap_seam_handoff
                .iter()
                .all(|handoff| !handoff.seam_search_ready)
        );
    }
}
