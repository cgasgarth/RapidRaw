use std::cmp::Ordering;
use std::sync::atomic::AtomicBool;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::{ColorType, ImageEncoder, codecs::png::PngEncoder};
use serde::Serialize;

use super::raw_frame::{
    GreenPhaseProxy, SR_GREEN_PROXY_ALGORITHM_ID, SR_PROXY_CROP_VERSION,
    SR_PROXY_NORMALIZATION_VERSION, SuperResolutionRawFrame, check_cancel,
};

pub const SR_REGISTRATION_ALGORITHM_ID: &str = "native_green_phase_global_se2_registration_v1";
const PYRAMID_LEVELS: usize = 4;
const MAX_SOURCE_TRANSLATION_PX: f32 = 48.0;
const MAX_ROTATION_DEGREES: f32 = 3.0;
const MIN_CORRELATION: f32 = 0.70;
const MIN_PEAK_RATIO: f32 = 1.002;
const MIN_OVERLAP_RATIO: f32 = 0.55;
const MIN_INLIER_RATIO: f32 = 0.75;
const MAX_P95_RESIDUAL_PX: f32 = 0.20;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionRegistrationProxy {
    pub algorithm_id: &'static str,
    pub crop_version: &'static str,
    pub height: usize,
    pub normalization_version: &'static str,
    pub pyramid_levels: usize,
    pub width: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionReferenceSelectionScore {
    pub clipping_score: f32,
    pub overlap_score: f32,
    pub quality_score: f32,
    pub source_index: usize,
    pub total_score: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionRegistrationTransform {
    pub confidence: f32,
    pub correlation_peak_ratio: f32,
    pub inlier_ratio: f32,
    pub overlap_ratio: f32,
    pub p50_residual_px: f32,
    pub p95_residual_px: f32,
    pub rotation_degrees: f32,
    pub source_index: usize,
    pub translation_x_px: f32,
    pub translation_y_px: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionRegistrationExclusion {
    pub code: String,
    pub confidence: Option<f32>,
    pub overlap_ratio: Option<f32>,
    pub p95_residual_px: Option<f32>,
    pub rotation_degrees: Option<f32>,
    pub source_index: usize,
    pub translation_x_px: Option<f32>,
    pub translation_y_px: Option<f32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionRegistrationSummary {
    pub confidence: f32,
    pub coverage_ratio: f32,
    pub p50_residual_px: f32,
    pub p95_residual_px: f32,
    pub sampling_diversity_ratio: f32,
    pub unique_x2_sampling_phases: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionRegistrationPreview {
    pub content_hash: String,
    pub data_url: String,
    pub height: u32,
    pub width: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperResolutionRegistrationResult {
    pub algorithm_id: &'static str,
    pub excluded_sources: Vec<SuperResolutionRegistrationExclusion>,
    pub preview: SuperResolutionRegistrationPreview,
    pub proxy: SuperResolutionRegistrationProxy,
    pub reference_selection_scores: Vec<SuperResolutionReferenceSelectionScore>,
    pub reference_source_index: usize,
    pub selected_source_indexes: Vec<usize>,
    pub summary: SuperResolutionRegistrationSummary,
    pub transforms: Vec<SuperResolutionRegistrationTransform>,
}

#[derive(Clone, Copy, Debug)]
struct Se2 {
    rotation_radians: f32,
    translation_x: f32,
    translation_y: f32,
}

impl Se2 {
    const IDENTITY: Self = Self {
        rotation_radians: 0.0,
        translation_x: 0.0,
        translation_y: 0.0,
    };

    fn apply(self, x: f32, y: f32, center_x: f32, center_y: f32) -> (f32, f32) {
        let cos = self.rotation_radians.cos();
        let sin = self.rotation_radians.sin();
        let local_x = x - center_x;
        let local_y = y - center_y;
        (
            cos.mul_add(local_x, -sin * local_y) + center_x + self.translation_x,
            sin.mul_add(local_x, cos * local_y) + center_y + self.translation_y,
        )
    }

    fn inverse(self) -> Self {
        let cos = self.rotation_radians.cos();
        let sin = self.rotation_radians.sin();
        Self {
            rotation_radians: -self.rotation_radians,
            translation_x: -(cos.mul_add(self.translation_x, sin * self.translation_y)),
            translation_y: sin.mul_add(self.translation_x, -cos * self.translation_y),
        }
    }

    fn compose(self, other: Self) -> Self {
        let cos = self.rotation_radians.cos();
        let sin = self.rotation_radians.sin();
        Self {
            rotation_radians: self.rotation_radians + other.rotation_radians,
            translation_x: cos.mul_add(other.translation_x, -sin * other.translation_y)
                + self.translation_x,
            translation_y: sin.mul_add(other.translation_x, cos * other.translation_y)
                + self.translation_y,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct AlignmentEstimate {
    peak_ratio: f32,
    transform: Se2,
}

#[derive(Clone, Copy, Debug)]
struct RegistrationMetrics {
    confidence: f32,
    correlation: f32,
    inlier_ratio: f32,
    overlap_ratio: f32,
    p50_residual_px: f32,
    p95_residual_px: f32,
}

pub fn solve_global_se2_registration(
    frames: &[SuperResolutionRawFrame],
    cancellation_token: &AtomicBool,
) -> Result<(SuperResolutionRegistrationResult, Vec<String>), String> {
    if frames.len() < 2 {
        return Err("insufficient_sources".to_string());
    }
    let first_proxy = &frames[0].proxy;
    if frames.iter().any(|frame| {
        frame.proxy.width != first_proxy.width
            || frame.proxy.height != first_proxy.height
            || (frame.proxy.proxy_pixel_scale - first_proxy.proxy_pixel_scale).abs() > f32::EPSILON
    }) {
        return Err("inconsistent_registration_proxy_geometry".to_string());
    }

    let seed_index = select_seed_index(frames);
    let seed_proxy = &frames[seed_index].proxy;
    let mut estimates = vec![None; frames.len()];
    let mut exclusions = Vec::new();
    estimates[seed_index] = Some(AlignmentEstimate {
        peak_ratio: 1.0,
        transform: Se2::IDENTITY,
    });

    for (frame_index, frame) in frames.iter().enumerate() {
        check_cancel(cancellation_token)?;
        if frame_index == seed_index {
            continue;
        }
        match estimate_transform(seed_proxy, &frame.proxy, cancellation_token) {
            Ok(estimate) => estimates[frame_index] = Some(estimate),
            Err(code) => exclusions.push(exclusion_without_measurements(
                frame.source.source_index,
                code,
            )),
        }
    }

    let reference_selection_scores =
        build_reference_selection_scores(frames, seed_proxy, &estimates, cancellation_token)?;
    let reference_index =
        select_reference_index(&reference_selection_scores, frames, &estimates, seed_index);
    let reference_proxy = &frames[reference_index].proxy;
    let seed_to_reference = estimates[reference_index]
        .map(|estimate| estimate.transform)
        .unwrap_or(Se2::IDENTITY);
    let reference_to_seed = seed_to_reference.inverse();

    let mut transforms = Vec::new();
    let mut selected_frame_indexes = Vec::new();
    for (frame_index, frame) in frames.iter().enumerate() {
        check_cancel(cancellation_token)?;
        if frame_index == reference_index {
            transforms.push(reference_transform(frame.source.source_index));
            selected_frame_indexes.push(frame_index);
            continue;
        }
        let Some(estimate) = estimates[frame_index] else {
            continue;
        };
        let transform = estimate.transform.compose(reference_to_seed);
        let metrics =
            registration_metrics(reference_proxy, &frame.proxy, transform, cancellation_token)?;
        if let Some(code) = rejection_code(
            transform,
            estimate.peak_ratio,
            metrics,
            frame.proxy.proxy_pixel_scale,
        ) {
            exclusions.push(exclusion_from_metrics(
                frame.source.source_index,
                code,
                transform,
                metrics,
                frame.proxy.proxy_pixel_scale,
            ));
            continue;
        }
        transforms.push(transform_from_metrics(
            frame.source.source_index,
            transform,
            estimate.peak_ratio,
            metrics,
            frame.proxy.proxy_pixel_scale,
        ));
        selected_frame_indexes.push(frame_index);
    }

    transforms.sort_by_key(|transform| transform.source_index);
    exclusions.sort_by_key(|exclusion| exclusion.source_index);
    let selected_source_indexes = selected_frame_indexes
        .iter()
        .map(|index| frames[*index].source.source_index)
        .collect::<Vec<_>>();
    let summary = summarize_registration(&transforms);
    let mut block_codes = Vec::new();
    if selected_source_indexes.len() < 2 {
        block_codes.push("insufficient_registered_sources".to_string());
    }
    if summary.unique_x2_sampling_phases < 4 {
        block_codes.push("insufficient_x2_sampling_diversity".to_string());
    }
    let preview = render_preview(
        reference_proxy,
        frames,
        &selected_frame_indexes,
        &transforms,
        cancellation_token,
    )?;

    Ok((
        SuperResolutionRegistrationResult {
            algorithm_id: SR_REGISTRATION_ALGORITHM_ID,
            excluded_sources: exclusions,
            preview,
            proxy: SuperResolutionRegistrationProxy {
                algorithm_id: SR_GREEN_PROXY_ALGORITHM_ID,
                crop_version: SR_PROXY_CROP_VERSION,
                height: reference_proxy.height,
                normalization_version: SR_PROXY_NORMALIZATION_VERSION,
                pyramid_levels: PYRAMID_LEVELS,
                width: reference_proxy.width,
            },
            reference_selection_scores,
            reference_source_index: frames[reference_index].source.source_index,
            selected_source_indexes,
            summary,
            transforms,
        },
        block_codes,
    ))
}

fn select_seed_index(frames: &[SuperResolutionRawFrame]) -> usize {
    frames
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| {
            left.proxy
                .quality_score
                .partial_cmp(&right.proxy.quality_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| right.source.source_index.cmp(&left.source.source_index))
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn build_reference_selection_scores(
    frames: &[SuperResolutionRawFrame],
    seed_proxy: &GreenPhaseProxy,
    estimates: &[Option<AlignmentEstimate>],
    cancellation_token: &AtomicBool,
) -> Result<Vec<SuperResolutionReferenceSelectionScore>, String> {
    frames
        .iter()
        .enumerate()
        .map(|(frame_index, frame)| {
            check_cancel(cancellation_token)?;
            let mut overlap_sum = 0.0;
            let mut overlap_count = 0usize;
            if let Some(estimate) = estimates[frame_index] {
                let metrics = registration_metrics(
                    seed_proxy,
                    &frame.proxy,
                    estimate.transform,
                    cancellation_token,
                )?;
                overlap_sum += metrics.overlap_ratio;
                overlap_count += 1;
            }
            let overlap_score = overlap_sum / overlap_count.max(1) as f32;
            let clipping_score = 1.0 - frame.proxy.clipped_ratio;
            let total_score =
                0.60 * frame.proxy.quality_score + 0.20 * clipping_score + 0.20 * overlap_score;
            Ok(SuperResolutionReferenceSelectionScore {
                clipping_score: round_metric(clipping_score),
                overlap_score: round_metric(overlap_score),
                quality_score: round_metric(frame.proxy.quality_score),
                source_index: frame.source.source_index,
                total_score: round_metric(total_score),
            })
        })
        .collect()
}

fn select_reference_index(
    scores: &[SuperResolutionReferenceSelectionScore],
    frames: &[SuperResolutionRawFrame],
    estimates: &[Option<AlignmentEstimate>],
    fallback: usize,
) -> usize {
    let selected_source_index = scores
        .iter()
        .filter(|score| {
            frames
                .iter()
                .position(|frame| frame.source.source_index == score.source_index)
                .and_then(|frame_index| estimates.get(frame_index))
                .is_some_and(Option::is_some)
        })
        .max_by(|left, right| {
            left.total_score
                .partial_cmp(&right.total_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| right.source_index.cmp(&left.source_index))
        })
        .map(|score| score.source_index);
    selected_source_index
        .and_then(|source_index| {
            frames
                .iter()
                .position(|frame| frame.source.source_index == source_index)
        })
        .unwrap_or(fallback)
}

fn estimate_transform(
    reference: &GreenPhaseProxy,
    source: &GreenPhaseProxy,
    cancellation_token: &AtomicBool,
) -> Result<AlignmentEstimate, String> {
    let reference_pyramid = build_pyramid(reference);
    let source_pyramid = build_pyramid(source);
    let mut transform = Se2::IDENTITY;
    let mut peak_ratio = 1.0;
    for level in (0..reference_pyramid.len()).rev() {
        check_cancel(cancellation_token)?;
        if level + 1 < reference_pyramid.len() {
            transform.translation_x *= 2.0;
            transform.translation_y *= 2.0;
        }
        let reference_level = &reference_pyramid[level];
        let source_level = &source_pyramid[level];
        let range = if level + 1 == reference_pyramid.len() {
            (MAX_SOURCE_TRANSLATION_PX / source_level.proxy_pixel_scale).ceil() as i32
        } else {
            3
        };
        let search = search_translation(
            reference_level,
            source_level,
            transform,
            range,
            cancellation_token,
        )?;
        transform.translation_x = search.0.translation_x;
        transform.translation_y = search.0.translation_y;
        peak_ratio = search.1;
    }
    transform = refine_transform(reference, source, transform, cancellation_token)?;
    Ok(AlignmentEstimate {
        peak_ratio,
        transform,
    })
}

fn build_pyramid(proxy: &GreenPhaseProxy) -> Vec<GreenPhaseProxy> {
    let mut pyramid = vec![proxy.clone()];
    while pyramid.len() < PYRAMID_LEVELS {
        let Some(previous) = pyramid.last() else {
            break;
        };
        if previous.width < 96 || previous.height < 96 {
            break;
        }
        pyramid.push(half_proxy(previous));
    }
    pyramid
}

fn half_proxy(proxy: &GreenPhaseProxy) -> GreenPhaseProxy {
    let width = proxy.width / 2;
    let height = proxy.height / 2;
    let mut values = vec![0.0; width * height];
    let mut valid = vec![false; width * height];
    for y in 0..height {
        for x in 0..width {
            let mut sum = 0.0;
            let mut count = 0usize;
            for offset_y in 0..2 {
                for offset_x in 0..2 {
                    let index = (y * 2 + offset_y) * proxy.width + x * 2 + offset_x;
                    if proxy.valid[index] {
                        sum += proxy.values[index];
                        count += 1;
                    }
                }
            }
            let index = y * width + x;
            if count >= 3 {
                values[index] = sum / count as f32;
                valid[index] = true;
            }
        }
    }
    GreenPhaseProxy {
        clipped_ratio: proxy.clipped_ratio,
        height,
        proxy_pixel_scale: proxy.proxy_pixel_scale * 2.0,
        quality_score: proxy.quality_score,
        valid,
        values,
        width,
    }
}

fn search_translation(
    reference: &GreenPhaseProxy,
    source: &GreenPhaseProxy,
    center: Se2,
    range: i32,
    cancellation_token: &AtomicBool,
) -> Result<(Se2, f32), String> {
    let mut candidates = Vec::new();
    for y in -range..=range {
        check_cancel(cancellation_token)?;
        for x in -range..=range {
            let transform = Se2 {
                translation_x: center.translation_x + x as f32,
                translation_y: center.translation_y + y as f32,
                ..center
            };
            if let Some(correlation) = normalized_correlation(reference, source, transform, 1) {
                candidates.push((transform, correlation));
            }
        }
    }
    let Some((best, best_score)) = candidates.iter().copied().max_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                let left_distance = (left.0.translation_x - center.translation_x)
                    .hypot(left.0.translation_y - center.translation_y);
                let right_distance = (right.0.translation_x - center.translation_x)
                    .hypot(right.0.translation_y - center.translation_y);
                right_distance
                    .partial_cmp(&left_distance)
                    .unwrap_or(Ordering::Equal)
            })
    }) else {
        return Err("inadequate_overlap".to_string());
    };
    let second_score = candidates
        .iter()
        .filter(|(candidate, _)| {
            (candidate.translation_x - best.translation_x).abs() > 1.0
                || (candidate.translation_y - best.translation_y).abs() > 1.0
        })
        .map(|(_, score)| *score)
        .max_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal))
        .unwrap_or(-1.0);
    let peak_ratio = (best_score + 1.0) / (second_score + 1.0).max(0.001);
    Ok((best, peak_ratio))
}

fn refine_transform(
    reference: &GreenPhaseProxy,
    source: &GreenPhaseProxy,
    mut transform: Se2,
    cancellation_token: &AtomicBool,
) -> Result<Se2, String> {
    let center_x = (reference.width.saturating_sub(1)) as f32 * 0.5;
    let center_y = (reference.height.saturating_sub(1)) as f32 * 0.5;
    let max_translation = MAX_SOURCE_TRANSLATION_PX / source.proxy_pixel_scale;
    let max_rotation = MAX_ROTATION_DEGREES.to_radians();
    for iteration in 0..12 {
        check_cancel(cancellation_token)?;
        let (gain, bias) = source_fit(reference, source, transform);
        let mut normal = [[0.0; 3]; 3];
        let mut rhs = [0.0; 3];
        let mut sample_count = 0usize;
        let step = (reference.width.min(reference.height) / 192).max(1);
        let margin = (reference.width.min(reference.height) / 12).max(8);
        for y in (margin..reference.height.saturating_sub(margin)).step_by(step) {
            if y % 16 == 0 {
                check_cancel(cancellation_token)?;
            }
            for x in (margin..reference.width.saturating_sub(margin)).step_by(step) {
                let reference_index = y * reference.width + x;
                if !reference.valid[reference_index] {
                    continue;
                }
                let (source_x, source_y) = transform.apply(x as f32, y as f32, center_x, center_y);
                let Some((source_value, gradient_x, gradient_y)) =
                    sample_with_gradient(source, source_x, source_y)
                else {
                    continue;
                };
                let residual = (source_value - bias) / gain - reference.values[reference_index];
                let local_x = x as f32 - center_x;
                let local_y = y as f32 - center_y;
                let sin = transform.rotation_radians.sin();
                let cos = transform.rotation_radians.cos();
                let rotation_x = -sin.mul_add(local_x, cos * local_y);
                let rotation_y = cos.mul_add(local_x, -sin * local_y);
                let jacobian = [
                    gradient_x / gain,
                    gradient_y / gain,
                    (gradient_x * rotation_x + gradient_y * rotation_y) / gain,
                ];
                let weight = huber_weight(residual, 0.025);
                for row in 0..3 {
                    rhs[row] -= weight * jacobian[row] * residual;
                    for column in 0..3 {
                        normal[row][column] += weight * jacobian[row] * jacobian[column];
                    }
                }
                sample_count += 1;
            }
        }
        if sample_count < 256 {
            return Err("inadequate_overlap".to_string());
        }
        let Some(delta) = solve_normal_equations(normal, rhs) else {
            return Err("residual_inlier_coverage_failure".to_string());
        };
        transform.translation_x =
            (transform.translation_x + delta[0]).clamp(-max_translation, max_translation);
        transform.translation_y =
            (transform.translation_y + delta[1]).clamp(-max_translation, max_translation);
        transform.rotation_radians =
            (transform.rotation_radians + delta[2]).clamp(-max_rotation, max_rotation);
        if iteration >= 3 && delta[0].hypot(delta[1]) < 0.002 && delta[2].abs() < 0.00001 {
            break;
        }
    }
    Ok(transform)
}

fn source_fit(reference: &GreenPhaseProxy, source: &GreenPhaseProxy, transform: Se2) -> (f32, f32) {
    let center_x = (reference.width.saturating_sub(1)) as f32 * 0.5;
    let center_y = (reference.height.saturating_sub(1)) as f32 * 0.5;
    let step = (reference.width.min(reference.height) / 160).max(1);
    let margin = (reference.width.min(reference.height) / 12).max(8);
    let mut count = 0.0_f32;
    let mut reference_sum = 0.0;
    let mut source_sum = 0.0;
    let mut reference_square_sum = 0.0;
    let mut product_sum = 0.0;
    for y in (margin..reference.height.saturating_sub(margin)).step_by(step) {
        for x in (margin..reference.width.saturating_sub(margin)).step_by(step) {
            let reference_index = y * reference.width + x;
            if !reference.valid[reference_index] {
                continue;
            }
            let (source_x, source_y) = transform.apply(x as f32, y as f32, center_x, center_y);
            let Some(source_value) = bilinear_sample(source, source_x, source_y) else {
                continue;
            };
            let reference_value = reference.values[reference_index];
            count += 1.0;
            reference_sum += reference_value;
            source_sum += source_value;
            reference_square_sum += reference_value * reference_value;
            product_sum += reference_value * source_value;
        }
    }
    if count < 64.0 {
        return (1.0, 0.0);
    }
    let denominator = count.mul_add(reference_square_sum, -reference_sum * reference_sum);
    let gain = if denominator.abs() < 1e-6 {
        1.0
    } else {
        (count.mul_add(product_sum, -reference_sum * source_sum) / denominator).clamp(0.5, 2.0)
    };
    let bias = (source_sum - gain * reference_sum) / count;
    (gain, bias)
}

fn registration_metrics(
    reference: &GreenPhaseProxy,
    source: &GreenPhaseProxy,
    transform: Se2,
    cancellation_token: &AtomicBool,
) -> Result<RegistrationMetrics, String> {
    let center_x = (reference.width.saturating_sub(1)) as f32 * 0.5;
    let center_y = (reference.height.saturating_sub(1)) as f32 * 0.5;
    let (gain, bias) = source_fit(reference, source, transform);
    let step = (reference.width.min(reference.height) / 192).max(1);
    let margin = (reference.width.min(reference.height) / 12).max(8);
    let mut attempted = 0usize;
    let mut matched = 0usize;
    let mut residuals = Vec::new();
    let mut inliers = 0usize;
    for y in (margin..reference.height.saturating_sub(margin)).step_by(step) {
        if y % 16 == 0 {
            check_cancel(cancellation_token)?;
        }
        for x in (margin..reference.width.saturating_sub(margin)).step_by(step) {
            let reference_index = y * reference.width + x;
            if !reference.valid[reference_index] {
                continue;
            }
            attempted += 1;
            let (source_x, source_y) = transform.apply(x as f32, y as f32, center_x, center_y);
            let Some((source_value, gradient_x, gradient_y)) =
                sample_with_gradient(source, source_x, source_y)
            else {
                continue;
            };
            matched += 1;
            let gradient = gradient_x.hypot(gradient_y);
            if gradient < 0.01 {
                continue;
            }
            let residual_px = (((source_value - bias) / gain - reference.values[reference_index])
                .abs()
                / gradient)
                * source.proxy_pixel_scale;
            if residual_px.is_finite() && residual_px <= 2.0 {
                if residual_px <= MAX_P95_RESIDUAL_PX {
                    inliers += 1;
                }
                residuals.push(residual_px);
            }
        }
    }
    if attempted == 0 || residuals.len() < 64 {
        return Err("inadequate_overlap".to_string());
    }
    residuals.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let correlation = normalized_correlation(reference, source, transform, step).unwrap_or(-1.0);
    let coverage_ratio = matched as f32 / attempted as f32;
    let p50_residual_px = percentile(&residuals, 0.50);
    let p95_residual_px = percentile(&residuals, 0.95);
    let inlier_ratio = inliers as f32 / residuals.len() as f32;
    let confidence = (correlation.max(0.0)
        * coverage_ratio
        * inlier_ratio
        * (1.0 - p95_residual_px / 0.5).clamp(0.0, 1.0))
    .clamp(0.0, 1.0);
    Ok(RegistrationMetrics {
        confidence,
        correlation,
        inlier_ratio,
        overlap_ratio: coverage_ratio,
        p50_residual_px,
        p95_residual_px,
    })
}

fn normalized_correlation(
    reference: &GreenPhaseProxy,
    source: &GreenPhaseProxy,
    transform: Se2,
    step: usize,
) -> Option<f32> {
    let center_x = (reference.width.saturating_sub(1)) as f32 * 0.5;
    let center_y = (reference.height.saturating_sub(1)) as f32 * 0.5;
    let margin = (reference.width.min(reference.height) / 12).max(8);
    let mut pairs = Vec::new();
    for y in (margin..reference.height.saturating_sub(margin)).step_by(step.max(1)) {
        for x in (margin..reference.width.saturating_sub(margin)).step_by(step.max(1)) {
            let reference_index = y * reference.width + x;
            if !reference.valid[reference_index] {
                continue;
            }
            let (source_x, source_y) = transform.apply(x as f32, y as f32, center_x, center_y);
            if let Some(source_value) = bilinear_sample(source, source_x, source_y) {
                pairs.push((reference.values[reference_index], source_value));
            }
        }
    }
    if pairs.len() < 256 {
        return None;
    }
    let count = pairs.len() as f32;
    let reference_mean = pairs.iter().map(|(reference, _)| reference).sum::<f32>() / count;
    let source_mean = pairs.iter().map(|(_, source)| source).sum::<f32>() / count;
    let mut numerator = 0.0;
    let mut reference_energy = 0.0;
    let mut source_energy = 0.0;
    for (reference_value, source_value) in pairs {
        let centered_reference = reference_value - reference_mean;
        let centered_source = source_value - source_mean;
        numerator += centered_reference * centered_source;
        reference_energy += centered_reference * centered_reference;
        source_energy += centered_source * centered_source;
    }
    let denominator = (reference_energy * source_energy).sqrt();
    (denominator > 1e-6).then_some(numerator / denominator)
}

fn bilinear_sample(proxy: &GreenPhaseProxy, x: f32, y: f32) -> Option<f32> {
    let left = x.floor() as isize;
    let top = y.floor() as isize;
    if left < 0 || top < 0 || left as usize + 1 >= proxy.width || top as usize + 1 >= proxy.height {
        return None;
    }
    let left = left as usize;
    let top = top as usize;
    let top_left = top * proxy.width + left;
    let top_right = top_left + 1;
    let bottom_left = top_left + proxy.width;
    let bottom_right = bottom_left + 1;
    if !proxy.valid[top_left]
        || !proxy.valid[top_right]
        || !proxy.valid[bottom_left]
        || !proxy.valid[bottom_right]
    {
        return None;
    }
    let horizontal = x - left as f32;
    let vertical = y - top as f32;
    let top_value =
        proxy.values[top_left].mul_add(1.0 - horizontal, proxy.values[top_right] * horizontal);
    let bottom_value = proxy.values[bottom_left]
        .mul_add(1.0 - horizontal, proxy.values[bottom_right] * horizontal);
    Some(top_value.mul_add(1.0 - vertical, bottom_value * vertical))
}

fn sample_with_gradient(proxy: &GreenPhaseProxy, x: f32, y: f32) -> Option<(f32, f32, f32)> {
    let value = bilinear_sample(proxy, x, y)?;
    let left = bilinear_sample(proxy, x - 1.0, y)?;
    let right = bilinear_sample(proxy, x + 1.0, y)?;
    let up = bilinear_sample(proxy, x, y - 1.0)?;
    let down = bilinear_sample(proxy, x, y + 1.0)?;
    Some((value, (right - left) * 0.5, (down - up) * 0.5))
}

fn solve_normal_equations(mut matrix: [[f32; 3]; 3], mut rhs: [f32; 3]) -> Option<[f32; 3]> {
    for pivot_column in 0..3 {
        let pivot_row = (pivot_column..3).max_by(|left, right| {
            matrix[*left][pivot_column]
                .abs()
                .partial_cmp(&matrix[*right][pivot_column].abs())
                .unwrap_or(Ordering::Equal)
        })?;
        if matrix[pivot_row][pivot_column].abs() < 1e-7 {
            return None;
        }
        matrix.swap(pivot_column, pivot_row);
        rhs.swap(pivot_column, pivot_row);
        let pivot = matrix[pivot_column][pivot_column];
        for value in &mut matrix[pivot_column][pivot_column..] {
            *value /= pivot;
        }
        rhs[pivot_column] /= pivot;
        let normalized_pivot_row = matrix[pivot_column];
        for row in 0..3 {
            if row == pivot_column {
                continue;
            }
            let factor = matrix[row][pivot_column];
            for (value, pivot_value) in matrix[row][pivot_column..]
                .iter_mut()
                .zip(normalized_pivot_row[pivot_column..].iter())
            {
                *value -= factor * pivot_value;
            }
            rhs[row] -= factor * rhs[pivot_column];
        }
    }
    Some(rhs)
}

fn rejection_code(
    transform: Se2,
    peak_ratio: f32,
    metrics: RegistrationMetrics,
    proxy_pixel_scale: f32,
) -> Option<String> {
    let translation = transform.translation_x.hypot(transform.translation_y) * proxy_pixel_scale;
    if translation > MAX_SOURCE_TRANSLATION_PX - 0.05
        || transform.rotation_radians.to_degrees().abs() > MAX_ROTATION_DEGREES - 0.005
    {
        return Some("transform_bound_failure".to_string());
    }
    if metrics.overlap_ratio < MIN_OVERLAP_RATIO {
        return Some("inadequate_overlap".to_string());
    }
    if metrics.correlation < MIN_CORRELATION || peak_ratio < MIN_PEAK_RATIO {
        return Some("poor_correlation_peak_ratio".to_string());
    }
    if metrics.inlier_ratio < MIN_INLIER_RATIO || metrics.p95_residual_px > MAX_P95_RESIDUAL_PX {
        return Some("residual_inlier_coverage_failure".to_string());
    }
    None
}

fn reference_transform(source_index: usize) -> SuperResolutionRegistrationTransform {
    SuperResolutionRegistrationTransform {
        confidence: 1.0,
        correlation_peak_ratio: 1.0,
        inlier_ratio: 1.0,
        overlap_ratio: 1.0,
        p50_residual_px: 0.0,
        p95_residual_px: 0.0,
        rotation_degrees: 0.0,
        source_index,
        translation_x_px: 0.0,
        translation_y_px: 0.0,
    }
}

fn exclusion_without_measurements(
    source_index: usize,
    code: String,
) -> SuperResolutionRegistrationExclusion {
    SuperResolutionRegistrationExclusion {
        code,
        confidence: None,
        overlap_ratio: None,
        p95_residual_px: None,
        rotation_degrees: None,
        source_index,
        translation_x_px: None,
        translation_y_px: None,
    }
}

fn exclusion_from_metrics(
    source_index: usize,
    code: String,
    transform: Se2,
    metrics: RegistrationMetrics,
    proxy_pixel_scale: f32,
) -> SuperResolutionRegistrationExclusion {
    SuperResolutionRegistrationExclusion {
        code,
        confidence: Some(round_metric(metrics.confidence)),
        overlap_ratio: Some(round_metric(metrics.overlap_ratio)),
        p95_residual_px: Some(round_metric(metrics.p95_residual_px)),
        rotation_degrees: Some(round_metric(transform.rotation_radians.to_degrees())),
        source_index,
        translation_x_px: Some(round_metric(transform.translation_x * proxy_pixel_scale)),
        translation_y_px: Some(round_metric(transform.translation_y * proxy_pixel_scale)),
    }
}

fn transform_from_metrics(
    source_index: usize,
    transform: Se2,
    peak_ratio: f32,
    metrics: RegistrationMetrics,
    proxy_pixel_scale: f32,
) -> SuperResolutionRegistrationTransform {
    SuperResolutionRegistrationTransform {
        confidence: round_metric(metrics.confidence),
        correlation_peak_ratio: round_metric(peak_ratio),
        inlier_ratio: round_metric(metrics.inlier_ratio),
        overlap_ratio: round_metric(metrics.overlap_ratio),
        p50_residual_px: round_metric(metrics.p50_residual_px),
        p95_residual_px: round_metric(metrics.p95_residual_px),
        rotation_degrees: round_metric(transform.rotation_radians.to_degrees()),
        source_index,
        translation_x_px: round_metric(transform.translation_x * proxy_pixel_scale),
        translation_y_px: round_metric(transform.translation_y * proxy_pixel_scale),
    }
}

fn summarize_registration(
    transforms: &[SuperResolutionRegistrationTransform],
) -> SuperResolutionRegistrationSummary {
    let mut p50_values = transforms
        .iter()
        .map(|transform| transform.p50_residual_px)
        .collect::<Vec<_>>();
    let mut p95_values = transforms
        .iter()
        .map(|transform| transform.p95_residual_px)
        .collect::<Vec<_>>();
    p50_values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    p95_values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let phase_count = x2_phase_count(transforms);
    let count = transforms.len().max(1) as f32;
    SuperResolutionRegistrationSummary {
        confidence: round_metric(
            transforms
                .iter()
                .map(|transform| transform.confidence)
                .sum::<f32>()
                / count,
        ),
        coverage_ratio: round_metric(
            transforms
                .iter()
                .map(|transform| transform.overlap_ratio)
                .sum::<f32>()
                / count,
        ),
        p50_residual_px: round_metric(percentile(&p50_values, 0.5)),
        p95_residual_px: round_metric(percentile(&p95_values, 0.95)),
        sampling_diversity_ratio: round_metric(phase_count as f32 / 4.0),
        unique_x2_sampling_phases: phase_count,
    }
}

fn x2_phase_count(transforms: &[SuperResolutionRegistrationTransform]) -> usize {
    let mut phases = std::collections::BTreeSet::new();
    for transform in transforms {
        let phase_x =
            ((transform.translation_x_px.rem_euclid(1.0) * 2.0).round() as i32).rem_euclid(2);
        let phase_y =
            ((transform.translation_y_px.rem_euclid(1.0) * 2.0).round() as i32).rem_euclid(2);
        phases.insert((phase_x, phase_y));
    }
    phases.len()
}

fn render_preview(
    reference: &GreenPhaseProxy,
    frames: &[SuperResolutionRawFrame],
    selected_frame_indexes: &[usize],
    transforms: &[SuperResolutionRegistrationTransform],
    cancellation_token: &AtomicBool,
) -> Result<SuperResolutionRegistrationPreview, String> {
    let width = reference.width.clamp(1, 256);
    let height = reference.height.clamp(1, 256);
    let center_x = (reference.width.saturating_sub(1)) as f32 * 0.5;
    let center_y = (reference.height.saturating_sub(1)) as f32 * 0.5;
    let transform_by_source = transforms
        .iter()
        .map(|transform| (transform.source_index, transform))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut pixels = vec![0u8; width * height * 3];
    for y in 0..height {
        if y % 8 == 0 {
            check_cancel(cancellation_token)?;
        }
        for x in 0..width {
            let reference_x = ((x as f32 + 0.5) * reference.width as f32 / width as f32 - 0.5)
                .clamp(0.0, reference.width.saturating_sub(1) as f32);
            let reference_y = ((y as f32 + 0.5) * reference.height as f32 / height as f32 - 0.5)
                .clamp(0.0, reference.height.saturating_sub(1) as f32);
            let reference_value =
                bilinear_sample(reference, reference_x, reference_y).unwrap_or(0.0);
            let mut aligned_sum = 0.0;
            let mut aligned_count = 0usize;
            for frame_index in selected_frame_indexes {
                let frame = &frames[*frame_index];
                let Some(transform) = transform_by_source.get(&frame.source.source_index) else {
                    continue;
                };
                let rotation = transform.rotation_degrees.to_radians();
                let se2 = Se2 {
                    rotation_radians: rotation,
                    translation_x: transform.translation_x_px / frame.proxy.proxy_pixel_scale,
                    translation_y: transform.translation_y_px / frame.proxy.proxy_pixel_scale,
                };
                let (source_x, source_y) = se2.apply(reference_x, reference_y, center_x, center_y);
                if let Some(value) = bilinear_sample(&frame.proxy, source_x, source_y) {
                    aligned_sum += value;
                    aligned_count += 1;
                }
            }
            let aligned_value = aligned_sum / aligned_count.max(1) as f32;
            let difference = (reference_value - aligned_value).abs();
            let pixel = (y * width + x) * 3;
            pixels[pixel] = (aligned_value.clamp(0.0, 1.0) * 255.0).round() as u8;
            pixels[pixel + 1] = (reference_value.clamp(0.0, 1.0) * 255.0).round() as u8;
            pixels[pixel + 2] = (difference * 1020.0).clamp(0.0, 255.0).round() as u8;
        }
    }
    let mut encoded = Vec::new();
    PngEncoder::new(&mut encoded)
        .write_image(&pixels, width as u32, height as u32, ColorType::Rgb8.into())
        .map_err(|error| format!("Failed to encode registration preview: {error}"))?;
    let content_hash = format!("blake3:{}", blake3::hash(&encoded).to_hex());
    Ok(SuperResolutionRegistrationPreview {
        content_hash,
        data_url: format!("data:image/png;base64,{}", BASE64.encode(encoded)),
        height: height as u32,
        width: width as u32,
    })
}

fn percentile(values: &[f32], ratio: f32) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let index = ((values.len() - 1) as f32 * ratio).round() as usize;
    values[index.min(values.len() - 1)]
}

fn huber_weight(value: f32, delta: f32) -> f32 {
    if value.abs() <= delta {
        1.0
    } else {
        delta / value.abs()
    }
}

fn round_metric(value: f32) -> f32 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;
    use crate::merge::super_resolution::raw_frame::{
        CalibratedBayerSensor, CfaClass, SuperResolutionBayerBurstSource,
        SuperResolutionBayerCalibration,
    };

    #[test]
    fn native_global_se2_registration_is_deterministic_and_measured_from_pixels() {
        let frames = fixture_frames(Se2::IDENTITY);
        let token = AtomicBool::new(false);
        let (first, first_blocks) =
            solve_global_se2_registration(&frames, &token).expect("fixture registers");
        let (second, second_blocks) =
            solve_global_se2_registration(&frames, &token).expect("fixture reruns");

        assert!(
            first_blocks.is_empty(),
            "unexpected blocks: {first_blocks:?}; exclusions: {:?}; transforms: {:?}",
            first.excluded_sources,
            first.transforms
        );
        assert_eq!(first_blocks, second_blocks);
        assert_eq!(
            serde_json::to_vec(&first).expect("first result serializes"),
            serde_json::to_vec(&second).expect("second result serializes"),
            "registration result must be byte-identical across CPU runs"
        );
        assert_eq!(first.selected_source_indexes.len(), 4);
        assert_eq!(first.summary.unique_x2_sampling_phases, 4);
        assert!(first.summary.p95_residual_px <= MAX_P95_RESIDUAL_PX);
        for transform in &first.transforms {
            let expected = expected_transform(transform.source_index);
            assert!(
                (transform.translation_x_px - expected.translation_x).abs() <= 0.05,
                "source {} translation x was {}, expected {}",
                transform.source_index,
                transform.translation_x_px,
                expected.translation_x
            );
            assert!(
                (transform.translation_y_px - expected.translation_y).abs() <= 0.05,
                "source {} translation y was {}, expected {}",
                transform.source_index,
                transform.translation_y_px,
                expected.translation_y
            );
            assert!(
                (transform.rotation_degrees - expected.rotation_degrees).abs() <= 0.02,
                "source {} rotation was {}, expected {}",
                transform.source_index,
                transform.rotation_degrees,
                expected.rotation_degrees
            );
        }
    }

    #[test]
    fn source_content_changes_registration_without_metadata_changes() {
        let token = AtomicBool::new(false);
        let baseline_frames = fixture_frames(Se2::IDENTITY);
        let (baseline, baseline_blocks) =
            solve_global_se2_registration(&baseline_frames, &token).expect("baseline registers");
        assert!(
            baseline_blocks.is_empty(),
            "baseline exclusions: {:?}",
            baseline.excluded_sources
        );

        let mut changed_frames = fixture_frames(Se2::IDENTITY);
        changed_frames[3].proxy = synthetic_proxy(Se2 {
            rotation_radians: 0.008_f32.to_radians(),
            translation_x: 0.65,
            translation_y: 0.65,
        });
        let (changed, changed_blocks) = solve_global_se2_registration(&changed_frames, &token)
            .expect("changed pixels register");
        assert!(changed_blocks.is_empty());
        assert_eq!(
            baseline_frames[3].source.content_hash, changed_frames[3].source.content_hash,
            "fixture keeps source metadata identity fixed"
        );
        assert_ne!(baseline.preview.content_hash, changed.preview.content_hash);
        let baseline_transform = baseline
            .transforms
            .iter()
            .find(|transform| transform.source_index == 3)
            .expect("baseline source transform");
        let changed_transform = changed
            .transforms
            .iter()
            .find(|transform| transform.source_index == 3)
            .expect("changed source transform");
        assert!(
            (baseline_transform.translation_x_px - changed_transform.translation_x_px).abs() > 0.1
                || (baseline_transform.translation_y_px - changed_transform.translation_y_px).abs()
                    > 0.1,
            "source pixels, not declared metadata, must determine measured transforms"
        );
    }

    #[test]
    fn excessive_motion_and_cancellation_fail_closed() {
        let token = AtomicBool::new(false);
        let mut frames = fixture_frames(Se2::IDENTITY);
        frames[1].proxy = synthetic_proxy(Se2 {
            rotation_radians: 0.0,
            translation_x: 80.0,
            translation_y: 0.0,
        });
        let (result, blocks) =
            solve_global_se2_registration(&frames, &token).expect("blocked result renders preview");
        assert!(blocks.contains(&"insufficient_x2_sampling_diversity".to_string()));
        assert!(
            result
                .excluded_sources
                .iter()
                .any(|exclusion| exclusion.source_index == 1)
        );

        let cancelled = AtomicBool::new(true);
        assert_eq!(
            solve_global_se2_registration(&fixture_frames(Se2::IDENTITY), &cancelled).unwrap_err(),
            "super_resolution_registration_cancelled"
        );
    }

    fn fixture_frames(_unused: Se2) -> Vec<SuperResolutionRawFrame> {
        [
            Se2::IDENTITY,
            Se2 {
                rotation_radians: 0.35_f32.to_radians(),
                translation_x: 0.5,
                translation_y: 0.0,
            },
            Se2 {
                rotation_radians: -0.28_f32.to_radians(),
                translation_x: 0.0,
                translation_y: 0.5,
            },
            Se2 {
                rotation_radians: 0.42_f32.to_radians(),
                translation_x: 0.5,
                translation_y: 0.5,
            },
        ]
        .into_iter()
        .enumerate()
        .map(|(source_index, transform)| SuperResolutionRawFrame {
            sensor: fixture_sensor(),
            proxy: synthetic_proxy(transform),
            source: fixture_source(source_index),
        })
        .collect()
    }

    fn fixture_sensor() -> CalibratedBayerSensor {
        let width = 512;
        let height = 384;
        let classes = (0..height)
            .flat_map(|y| {
                (0..width).map(move |x| match (y % 2, x % 2) {
                    (0, 0) => CfaClass::R,
                    (0, 1) => CfaClass::G1,
                    (1, 0) => CfaClass::G2,
                    _ => CfaClass::B,
                })
            })
            .collect::<Vec<_>>();
        CalibratedBayerSensor {
            classes,
            height,
            valid: vec![true; width * height],
            values: vec![0.5; width * height],
            variances: vec![0.01; width * height],
            width,
        }
    }

    fn expected_transform(source_index: usize) -> ExpectedTransform {
        match source_index {
            0 => ExpectedTransform {
                rotation_degrees: 0.0,
                translation_x: 0.0,
                translation_y: 0.0,
            },
            1 => ExpectedTransform {
                rotation_degrees: 0.35,
                translation_x: 0.5,
                translation_y: 0.0,
            },
            2 => ExpectedTransform {
                rotation_degrees: -0.28,
                translation_x: 0.0,
                translation_y: 0.5,
            },
            _ => ExpectedTransform {
                rotation_degrees: 0.42,
                translation_x: 0.5,
                translation_y: 0.5,
            },
        }
    }

    struct ExpectedTransform {
        rotation_degrees: f32,
        translation_x: f32,
        translation_y: f32,
    }

    fn fixture_source(source_index: usize) -> SuperResolutionBayerBurstSource {
        SuperResolutionBayerBurstSource {
            block_codes: Vec::new(),
            calibration: SuperResolutionBayerCalibration {
                bayer_pattern: "RGGB".to_string(),
                black_level: vec![512.0],
                black_level_repeat: [1, 1, 1],
                bits_per_sample: 14,
                white_balance: [2.0, 1.0, 1.0, 1.5],
                white_level: vec![16_383],
            },
            calibration_identity:
                "blake3:2ce6a709f2938ead48e9d5034a12744a181b6b4c350b8af0f02575dcece852f7"
                    .to_string(),
            camera_make: "Example".to_string(),
            camera_model: "BurstCam".to_string(),
            content_hash: format!("blake3:{source_index:064x}"),
            graph_revision: format!("raw_content:{source_index}"),
            height: 384,
            path: format!("/fixture/{source_index}.dng"),
            source_index,
            width: 512,
        }
    }

    fn synthetic_proxy(transform: Se2) -> GreenPhaseProxy {
        let width = 256usize;
        let height = 192usize;
        let center_x = (width - 1) as f32 * 0.5;
        let center_y = (height - 1) as f32 * 0.5;
        let inverse = transform.inverse();
        let mut values = Vec::with_capacity(width * height);
        let mut valid = Vec::with_capacity(width * height);
        for y in 0..height {
            for x in 0..width {
                let (scene_x, scene_y) = inverse.apply(x as f32, y as f32, center_x, center_y);
                let grain = ((x as f32 * 17.0 + y as f32 * 31.0).sin() * 0.0015).abs();
                let defect = matches!((x, y), (21, 19) | (117, 41) | (202, 146));
                let clipped = matches!((x, y), (82, 93) | (83, 93));
                let sample = if clipped {
                    1.0
                } else if defect {
                    if x % 2 == 0 { 1.0 } else { 0.0 }
                } else {
                    (scene(scene_x, scene_y) + grain).clamp(0.0, 1.0)
                };
                values.push(sample);
                valid.push(
                    x >= 4 && y >= 4 && x + 4 < width && y + 4 < height && !defect && !clipped,
                );
            }
        }
        GreenPhaseProxy {
            clipped_ratio: 0.01,
            height,
            proxy_pixel_scale: 1.0,
            quality_score: 0.9,
            valid,
            values,
            width,
        }
    }

    fn scene(x: f32, y: f32) -> f32 {
        let broad = 0.32 + 0.12 * (x * 0.061).sin() + 0.10 * (y * 0.047).cos();
        let diagonal = 0.08 * ((x + y) * 0.17).sin() + 0.06 * ((x - y) * 0.11).cos();
        let feature = ((x - 142.0).hypot(y - 64.0) < 18.0) as u8 as f32 * 0.18;
        (broad + diagonal + feature).clamp(0.02, 0.95)
    }
}
