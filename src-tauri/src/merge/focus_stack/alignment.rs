use super::raw_frame::{DecodedFocusSource, RegistrationFrame};

pub(crate) const ALGORITHM_ID: &str = "focus_similarity_gradient_v1";
pub(crate) const POLICY_ID: &str = "focus_similarity_bounds_v1";
const MAX_SCALE_DELTA: f64 = 0.03;
const MAX_ROTATION_DEGREES: f64 = 1.0;
const MIN_OVERLAP: f64 = 0.90;
const MAX_CROP_LOSS: f64 = 0.05;
const MIN_INLIER_RATIO: f64 = 0.75;
const MAX_P95_RESIDUAL_PX: f64 = 0.50;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PointF64 {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RectF64 {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExposureNormalization {
    pub scalar: f64,
    pub fit_within_bounds: bool,
    pub log_residual: f64,
    pub sample_coverage: f64,
    pub metadata_delta_ev: Option<f64>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SimilarityTransform {
    pub source_index: usize,
    pub scale: f64,
    pub rotation_degrees: f64,
    pub translation_x_px: f64,
    pub translation_y_px: f64,
    pub center_x_px: f64,
    pub center_y_px: f64,
    pub source_center_x_px: f64,
    pub source_center_y_px: f64,
    pub reference_center_x_px: f64,
    pub reference_center_y_px: f64,
    pub forward_matrix: [f64; 9],
    pub inverse_matrix: [f64; 9],
    pub valid_domain: Vec<PointF64>,
    pub overlap_ratio: f64,
    pub crop_loss_ratio: f64,
    pub inlier_ratio: f64,
    pub p50_residual_px: f64,
    pub p95_residual_px: f64,
    pub confidence: f64,
    pub status: &'static str,
    pub reason_codes: Vec<String>,
    pub exposure_normalization: ExposureNormalization,
}

#[derive(Clone, Debug)]
struct EdgeFrame {
    width: usize,
    height: usize,
    values: Vec<f64>,
    valid: Vec<bool>,
}

#[derive(Clone, Copy, Debug)]
struct ProxyTransform {
    tx: f64,
    ty: f64,
    log_scale: f64,
    theta: f64,
}

#[derive(Clone, Copy)]
struct Score {
    mean: f64,
    p50: f64,
    p95: f64,
    coverage: f64,
    inliers: f64,
}

pub(crate) fn solve_all(
    sources: &[DecodedFocusSource],
    reference_source_index: usize,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<Vec<SimilarityTransform>, String> {
    let reference = sources
        .iter()
        .find(|source| source.source_index == reference_source_index)
        .ok_or_else(|| "focus_alignment_reference_missing".to_string())?;
    let reference_edges = edge_frame(&reference.registration);
    sources
        .iter()
        .map(|source| {
            if cancelled() {
                return Err("focus_stack_alignment_cancelled:source".to_string());
            }
            if source.source_index == reference_source_index {
                Ok(identity(source, reference))
            } else {
                solve(reference, &reference_edges, source, cancelled)
            }
        })
        .collect()
}

fn identity(source: &DecodedFocusSource, reference: &DecodedFocusSource) -> SimilarityTransform {
    let width = reference.registration.full_width as f64;
    let height = reference.registration.full_height as f64;
    let center_x = (width - 1.0) * 0.5;
    let center_y = (height - 1.0) * 0.5;
    SimilarityTransform {
        source_index: source.source_index,
        scale: 1.0,
        rotation_degrees: 0.0,
        translation_x_px: 0.0,
        translation_y_px: 0.0,
        center_x_px: center_x,
        center_y_px: center_y,
        source_center_x_px: center_x,
        source_center_y_px: center_y,
        reference_center_x_px: center_x,
        reference_center_y_px: center_y,
        forward_matrix: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        inverse_matrix: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        valid_domain: frame_domain(width, height, [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]),
        overlap_ratio: 1.0,
        crop_loss_ratio: 0.0,
        inlier_ratio: 1.0,
        p50_residual_px: 0.0,
        p95_residual_px: 0.0,
        confidence: 1.0,
        status: "accepted",
        reason_codes: Vec::new(),
        exposure_normalization: exposure_normalization(
            reference,
            source,
            ProxyTransform {
                tx: 0.0,
                ty: 0.0,
                log_scale: 0.0,
                theta: 0.0,
            },
        ),
    }
}

fn solve(
    reference: &DecodedFocusSource,
    reference_edges: &EdgeFrame,
    source: &DecodedFocusSource,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<SimilarityTransform, String> {
    let edges = edge_frame(&source.registration);
    if edges.width != reference_edges.width || edges.height != reference_edges.height {
        return Ok(rejected_geometry(
            reference,
            source,
            "alignment_proxy_geometry_mismatch",
        ));
    }
    let reference_pyramid = pyramid(reference_edges, 4);
    let source_pyramid = pyramid(&edges, 4);
    let coarsest_reference = reference_pyramid.last().expect("pyramid is nonempty");
    let coarsest_source = source_pyramid.last().expect("pyramid is nonempty");
    let max_translation =
        ((coarsest_reference.width.min(coarsest_reference.height) as f64) * 0.05).ceil() as isize;
    let mut transform = coarse_translation(
        coarsest_reference,
        coarsest_source,
        max_translation,
        cancelled,
    )?;
    for level in (0..reference_pyramid.len()).rev() {
        if level + 1 < reference_pyramid.len() {
            transform.tx *=
                reference_pyramid[level].width as f64 / reference_pyramid[level + 1].width as f64;
            transform.ty *=
                reference_pyramid[level].height as f64 / reference_pyramid[level + 1].height as f64;
        }
        transform = refine_level(
            &reference_pyramid[level],
            &source_pyramid[level],
            transform,
            cancelled,
        )?;
    }
    let metric = score(reference_edges, &edges, transform, 1);
    if !metric.mean.is_finite() || metric.coverage <= 0.0 {
        return Ok(rejected_geometry(
            reference,
            source,
            "alignment_nonfinite_solution",
        ));
    }
    Ok(make_transform(reference, source, transform, metric))
}

fn refine_level(
    reference: &EdgeFrame,
    source: &EdgeFrame,
    mut transform: ProxyTransform,
    cancelled: impl Fn() -> bool,
) -> Result<ProxyTransform, String> {
    let mut steps = [0.75, 0.75, 0.004, 0.15f64.to_radians()];
    for iteration in 0..12 {
        if cancelled() {
            return Err("focus_stack_alignment_cancelled:refinement".to_string());
        }
        let mut best = score(reference, source, transform, 2).mean;
        for (parameter, step) in steps.iter().copied().enumerate() {
            for direction in [-1.0, 1.0] {
                let mut candidate = transform;
                adjust(&mut candidate, parameter, direction * step);
                if candidate.log_scale.exp() < 1.0 - MAX_SCALE_DELTA
                    || candidate.log_scale.exp() > 1.0 + MAX_SCALE_DELTA
                    || candidate.theta.abs() > MAX_ROTATION_DEGREES.to_radians()
                {
                    continue;
                }
                let candidate_score = score(reference, source, candidate, 2).mean;
                if candidate_score < best {
                    transform = candidate;
                    best = candidate_score;
                }
            }
        }
        if iteration % 2 == 1 {
            for step in &mut steps {
                *step *= 0.5;
            }
        }
    }
    Ok(transform)
}

fn pyramid(frame: &EdgeFrame, levels: usize) -> Vec<EdgeFrame> {
    let mut result = vec![frame.clone()];
    while result.len() < levels {
        let previous = result.last().expect("pyramid is nonempty");
        if previous.width < 8 || previous.height < 8 {
            break;
        }
        let width = previous.width.div_ceil(2);
        let height = previous.height.div_ceil(2);
        let mut values = vec![0.0; width * height];
        let mut valid = vec![false; width * height];
        for y in 0..height {
            for x in 0..width {
                let mut sum = 0.0;
                let mut count = 0usize;
                for sy in y * 2..(y * 2 + 2).min(previous.height) {
                    for sx in x * 2..(x * 2 + 2).min(previous.width) {
                        let index = sy * previous.width + sx;
                        if previous.valid[index] {
                            sum += previous.values[index];
                            count += 1;
                        }
                    }
                }
                if count == 4 {
                    values[y * width + x] = sum / count as f64;
                    valid[y * width + x] = true;
                }
            }
        }
        result.push(EdgeFrame {
            width,
            height,
            values,
            valid,
        });
    }
    result
}

fn coarse_translation(
    reference: &EdgeFrame,
    source: &EdgeFrame,
    radius: isize,
    cancelled: impl Fn() -> bool,
) -> Result<ProxyTransform, String> {
    let mut best = (f64::INFINITY, 0isize, 0isize);
    for dy in -radius..=radius {
        if cancelled() {
            return Err("focus_stack_alignment_cancelled:initialization".to_string());
        }
        for dx in -radius..=radius {
            let candidate = ProxyTransform {
                tx: dx as f64,
                ty: dy as f64,
                log_scale: 0.0,
                theta: 0.0,
            };
            let value = score(reference, source, candidate, 3).mean;
            if value.total_cmp(&best.0).is_lt() {
                best = (value, dx, dy);
            }
        }
    }
    Ok(ProxyTransform {
        tx: best.1 as f64,
        ty: best.2 as f64,
        log_scale: 0.0,
        theta: 0.0,
    })
}

fn adjust(transform: &mut ProxyTransform, parameter: usize, delta: f64) {
    match parameter {
        0 => transform.tx += delta,
        1 => transform.ty += delta,
        2 => transform.log_scale += delta,
        _ => transform.theta += delta,
    }
}

fn edge_frame(frame: &RegistrationFrame) -> EdgeFrame {
    let mut values = vec![0.0; frame.luma.len()];
    let mut valid = vec![false; frame.luma.len()];
    if frame.width < 3 || frame.height < 3 {
        return EdgeFrame {
            width: frame.width,
            height: frame.height,
            values,
            valid,
        };
    }
    for y in 1..frame.height - 1 {
        for x in 1..frame.width - 1 {
            let index = y * frame.width + x;
            if frame.clipped[index] || !frame.valid[index] || !frame.luma[index].is_finite() {
                continue;
            }
            let gx = (frame.luma[index + 1] - frame.luma[index - 1]) as f64 * 0.5;
            let gy =
                (frame.luma[index + frame.width] - frame.luma[index - frame.width]) as f64 * 0.5;
            let magnitude = gx.hypot(gy);
            if magnitude.is_finite() {
                values[index] = magnitude.ln_1p();
                valid[index] = true;
            }
        }
    }
    let mut sample = values
        .iter()
        .zip(&valid)
        .filter_map(|(value, valid)| valid.then_some(*value))
        .collect::<Vec<_>>();
    sample.sort_by(f64::total_cmp);
    let median = sample.get(sample.len() / 2).copied().unwrap_or(0.0);
    let mut deviations = sample
        .iter()
        .map(|value| (value - median).abs())
        .collect::<Vec<_>>();
    deviations.sort_by(f64::total_cmp);
    let scale = deviations
        .get(deviations.len() / 2)
        .copied()
        .unwrap_or(1.0)
        .max(1e-8);
    for (value, is_valid) in values.iter_mut().zip(&valid) {
        if *is_valid {
            *value = ((*value - median) / (scale * 4.0)).clamp(-1.0, 1.0);
        }
    }
    EdgeFrame {
        width: frame.width,
        height: frame.height,
        values,
        valid,
    }
}

fn score(
    reference: &EdgeFrame,
    source: &EdgeFrame,
    transform: ProxyTransform,
    stride: usize,
) -> Score {
    let cx = (reference.width as f64 - 1.0) * 0.5;
    let cy = (reference.height as f64 - 1.0) * 0.5;
    let scale = transform.log_scale.exp();
    let (sin, cos) = transform.theta.sin_cos();
    let mut residuals = Vec::new();
    let mut valid_reference = 0usize;
    for y in (1..reference.height.saturating_sub(1)).step_by(stride) {
        for x in (1..reference.width.saturating_sub(1)).step_by(stride) {
            let index = y * reference.width + x;
            if !reference.valid[index] || reference.values[index].abs() < 0.04 {
                continue;
            }
            valid_reference += 1;
            let rx = x as f64 - cx - transform.tx;
            let ry = y as f64 - cy - transform.ty;
            let sx = cx + (cos * rx + sin * ry) / scale;
            let sy = cy + (-sin * rx + cos * ry) / scale;
            if let Some(value) = bilinear(source, sx, sy) {
                residuals.push((reference.values[index] - value).abs());
            }
        }
    }
    if residuals.is_empty() {
        return Score {
            mean: f64::INFINITY,
            p50: f64::INFINITY,
            p95: f64::INFINITY,
            coverage: 0.0,
            inliers: 0.0,
        };
    }
    residuals.sort_by(f64::total_cmp);
    let p50 = percentile(&residuals, 0.50);
    let p95 = percentile(&residuals, 0.95);
    let huber_delta = 0.20;
    let mean = residuals
        .iter()
        .map(|value| {
            if *value <= huber_delta {
                0.5 * value * value
            } else {
                huber_delta * (value - 0.5 * huber_delta)
            }
        })
        .sum::<f64>()
        / residuals.len() as f64;
    let inliers =
        residuals.iter().filter(|value| **value <= 0.35).count() as f64 / residuals.len() as f64;
    Score {
        mean,
        p50,
        p95,
        coverage: residuals.len() as f64 / valid_reference.max(1) as f64,
        inliers,
    }
}

fn bilinear(frame: &EdgeFrame, x: f64, y: f64) -> Option<f64> {
    if !x.is_finite()
        || !y.is_finite()
        || x < 0.0
        || y < 0.0
        || x >= (frame.width - 1) as f64
        || y >= (frame.height - 1) as f64
    {
        return None;
    }
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let indexes = [
        y0 * frame.width + x0,
        y0 * frame.width + x0 + 1,
        (y0 + 1) * frame.width + x0,
        (y0 + 1) * frame.width + x0 + 1,
    ];
    if indexes.iter().any(|index| !frame.valid[*index]) {
        return None;
    }
    let fx = x - x0 as f64;
    let fy = y - y0 as f64;
    Some(
        frame.values[indexes[0]] * (1.0 - fx) * (1.0 - fy)
            + frame.values[indexes[1]] * fx * (1.0 - fy)
            + frame.values[indexes[2]] * (1.0 - fx) * fy
            + frame.values[indexes[3]] * fx * fy,
    )
}

fn percentile(values: &[f64], quantile: f64) -> f64 {
    values[((values.len() - 1) as f64 * quantile).round() as usize]
}

fn make_transform(
    reference: &DecodedFocusSource,
    source: &DecodedFocusSource,
    proxy: ProxyTransform,
    score: Score,
) -> SimilarityTransform {
    let full_per_proxy_x =
        reference.registration.full_width as f64 / reference.registration.width as f64;
    let full_per_proxy_y =
        reference.registration.full_height as f64 / reference.registration.height as f64;
    let tx = proxy.tx * full_per_proxy_x;
    let ty = proxy.ty * full_per_proxy_y;
    let scale = proxy.log_scale.exp();
    let rotation_degrees = proxy.theta.to_degrees();
    let center_x = (reference.registration.full_width as f64 - 1.0) * 0.5;
    let center_y = (reference.registration.full_height as f64 - 1.0) * 0.5;
    let forward = matrix(scale, proxy.theta, tx, ty, center_x, center_y);
    let inverse = inverse_matrix(scale, proxy.theta, tx, ty, center_x, center_y);
    let domain = frame_domain(
        source.registration.full_width as f64,
        source.registration.full_height as f64,
        forward,
    );
    let overlap = transformed_overlap_ratio(
        &domain,
        reference.registration.full_width as f64,
        reference.registration.full_height as f64,
    );
    let crop_loss = 1.0 - overlap;
    let residual_scale = full_per_proxy_x.max(full_per_proxy_y);
    let p50 = (score.p50 * residual_scale * 0.25).min(99.0);
    let p95 = (score.p95 * residual_scale * 0.25).min(99.0);
    let mut reasons = Vec::new();
    if (scale - 1.0).abs() > MAX_SCALE_DELTA {
        reasons.push("alignment_scale_out_of_bounds".to_string());
    }
    if rotation_degrees.abs() > MAX_ROTATION_DEGREES {
        reasons.push("alignment_rotation_out_of_bounds".to_string());
    }
    if tx.hypot(ty)
        > reference
            .registration
            .full_width
            .min(reference.registration.full_height) as f64
            * 0.05
    {
        reasons.push("alignment_translation_out_of_bounds".to_string());
    }
    if overlap < MIN_OVERLAP {
        reasons.push("alignment_insufficient_overlap".to_string());
    }
    if crop_loss > MAX_CROP_LOSS {
        reasons.push("alignment_excessive_crop_loss".to_string());
    }
    if score.inliers < MIN_INLIER_RATIO {
        reasons.push("alignment_low_inlier_ratio".to_string());
    }
    if p95 > MAX_P95_RESIDUAL_PX {
        reasons.push("alignment_high_residual".to_string());
    }
    let exposure_normalization = exposure_normalization(reference, source, proxy);
    if !exposure_normalization.fit_within_bounds {
        reasons.push("exposure_scalar_out_of_bounds".to_string());
    }
    if (scale - (1.0 - MAX_SCALE_DELTA)).abs() < 0.000_01
        || (scale - (1.0 + MAX_SCALE_DELTA)).abs() < 0.000_01
        || (rotation_degrees.abs() - MAX_ROTATION_DEGREES).abs() < 0.000_1
    {
        reasons.push("alignment_transform_at_bound".to_string());
    }
    let confidence =
        (overlap * score.inliers * (1.0 - (p95 / MAX_P95_RESIDUAL_PX).min(1.0))).clamp(0.0, 1.0);
    SimilarityTransform {
        source_index: source.source_index,
        scale,
        rotation_degrees,
        translation_x_px: tx,
        translation_y_px: ty,
        center_x_px: center_x,
        center_y_px: center_y,
        source_center_x_px: (source.registration.full_width as f64 - 1.0) * 0.5,
        source_center_y_px: (source.registration.full_height as f64 - 1.0) * 0.5,
        reference_center_x_px: center_x,
        reference_center_y_px: center_y,
        forward_matrix: forward,
        inverse_matrix: inverse,
        valid_domain: domain,
        overlap_ratio: overlap,
        crop_loss_ratio: crop_loss,
        inlier_ratio: score.inliers,
        p50_residual_px: p50,
        p95_residual_px: p95,
        confidence,
        status: if reasons.is_empty() {
            "accepted"
        } else {
            "excluded"
        },
        reason_codes: reasons,
        exposure_normalization,
    }
}

fn rejected_geometry(
    reference: &DecodedFocusSource,
    source: &DecodedFocusSource,
    code: &str,
) -> SimilarityTransform {
    let mut result = identity(source, reference);
    result.status = "excluded";
    result.confidence = 0.0;
    result.reason_codes = vec![code.to_string()];
    result
}

fn exposure_normalization(
    reference: &DecodedFocusSource,
    source: &DecodedFocusSource,
    transform: ProxyTransform,
) -> ExposureNormalization {
    let reference_frame = &reference.registration;
    let source_frame = &source.registration;
    let cx = (reference_frame.width as f64 - 1.0) * 0.5;
    let cy = (reference_frame.height as f64 - 1.0) * 0.5;
    let scale = transform.log_scale.exp();
    let (sin, cos) = transform.theta.sin_cos();
    let mut ratios = Vec::new();
    let mut candidates = 0usize;
    for y in (1..reference_frame.height.saturating_sub(1)).step_by(2) {
        for x in (1..reference_frame.width.saturating_sub(1)).step_by(2) {
            let index = y * reference_frame.width + x;
            if !reference_frame.valid[index]
                || reference_frame.clipped[index]
                || !(0.02..0.90).contains(&reference_frame.luma[index])
            {
                continue;
            }
            candidates += 1;
            let rx = x as f64 - cx - transform.tx;
            let ry = y as f64 - cy - transform.ty;
            let sx = cx + (cos * rx + sin * ry) / scale;
            let sy = cy + (-sin * rx + cos * ry) / scale;
            if let Some(value) = sample_luma(source_frame, sx, sy)
                && (0.02..0.90).contains(&value)
            {
                ratios.push((reference_frame.luma[index] as f64 / value).ln());
            }
        }
    }
    ratios.sort_by(f64::total_cmp);
    let log_scalar = ratios.get(ratios.len() / 2).copied().unwrap_or(0.0);
    let fitted_scalar = log_scalar.exp();
    let scalar = fitted_scalar.clamp(0.5, 2.0);
    let mut residuals = ratios
        .iter()
        .map(|value| (value - scalar.ln()).abs())
        .collect::<Vec<_>>();
    residuals.sort_by(f64::total_cmp);
    ExposureNormalization {
        scalar,
        fit_within_bounds: (0.5..=2.0).contains(&fitted_scalar),
        log_residual: residuals.get(residuals.len() / 2).copied().unwrap_or(0.0),
        sample_coverage: ratios.len() as f64 / candidates.max(1) as f64,
        metadata_delta_ev: reference
            .exposure_ev
            .zip(source.exposure_ev)
            .map(|(a, b)| scalar.log2() - (a - b) as f64),
    }
}

fn sample_luma(frame: &RegistrationFrame, x: f64, y: f64) -> Option<f64> {
    if x < 0.0 || y < 0.0 || x >= (frame.width - 1) as f64 || y >= (frame.height - 1) as f64 {
        return None;
    }
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let indexes = [
        y0 * frame.width + x0,
        y0 * frame.width + x0 + 1,
        (y0 + 1) * frame.width + x0,
        (y0 + 1) * frame.width + x0 + 1,
    ];
    if indexes
        .iter()
        .any(|index| !frame.valid[*index] || frame.clipped[*index])
    {
        return None;
    }
    let fx = x - x0 as f64;
    let fy = y - y0 as f64;
    Some(
        frame.luma[indexes[0]] as f64 * (1.0 - fx) * (1.0 - fy)
            + frame.luma[indexes[1]] as f64 * fx * (1.0 - fy)
            + frame.luma[indexes[2]] as f64 * (1.0 - fx) * fy
            + frame.luma[indexes[3]] as f64 * fx * fy,
    )
}

fn matrix(scale: f64, theta: f64, tx: f64, ty: f64, cx: f64, cy: f64) -> [f64; 9] {
    let (sin, cos) = theta.sin_cos();
    let a = scale * cos;
    let b = -scale * sin;
    let c = scale * sin;
    let d = scale * cos;
    [
        a,
        b,
        cx + tx - a * cx - b * cy,
        c,
        d,
        cy + ty - c * cx - d * cy,
        0.0,
        0.0,
        1.0,
    ]
}

fn inverse_matrix(scale: f64, theta: f64, tx: f64, ty: f64, cx: f64, cy: f64) -> [f64; 9] {
    let (sin, cos) = theta.sin_cos();
    let a = cos / scale;
    let b = sin / scale;
    let c = -sin / scale;
    let d = cos / scale;
    [
        a,
        b,
        cx - a * (cx + tx) - b * (cy + ty),
        c,
        d,
        cy - c * (cx + tx) - d * (cy + ty),
        0.0,
        0.0,
        1.0,
    ]
}

fn frame_domain(width: f64, height: f64, transform: [f64; 9]) -> Vec<PointF64> {
    [
        (0.0, 0.0),
        (width - 1.0, 0.0),
        (width - 1.0, height - 1.0),
        (0.0, height - 1.0),
    ]
    .into_iter()
    .map(|(x, y)| PointF64 {
        x: transform[0] * x + transform[1] * y + transform[2],
        y: transform[3] * x + transform[4] * y + transform[5],
    })
    .collect()
}

fn transformed_overlap_ratio(domain: &[PointF64], width: f64, height: f64) -> f64 {
    let min_x = domain
        .iter()
        .map(|p| p.x)
        .fold(f64::INFINITY, f64::min)
        .max(0.0);
    let max_x = domain
        .iter()
        .map(|p| p.x)
        .fold(f64::NEG_INFINITY, f64::max)
        .min(width - 1.0);
    let min_y = domain
        .iter()
        .map(|p| p.y)
        .fold(f64::INFINITY, f64::min)
        .max(0.0);
    let max_y = domain
        .iter()
        .map(|p| p.y)
        .fold(f64::NEG_INFINITY, f64::max)
        .min(height - 1.0);
    (((max_x - min_x + 1.0).max(0.0) * (max_y - min_y + 1.0).max(0.0)) / (width * height).max(1.0))
        .clamp(0.0, 1.0)
}

pub(crate) fn common_crop(
    transforms: &[SimilarityTransform],
    width: f64,
    height: f64,
) -> Option<RectF64> {
    let accepted = transforms
        .iter()
        .filter(|transform| transform.status == "accepted")
        .collect::<Vec<_>>();
    if accepted.len() < 2 {
        return None;
    }
    let mut x0: f64 = 0.0;
    let mut y0: f64 = 0.0;
    let mut x1: f64 = width - 1.0;
    let mut y1: f64 = height - 1.0;
    for transform in &accepted {
        x0 = x0.max(
            transform
                .valid_domain
                .iter()
                .map(|p| p.x)
                .fold(f64::INFINITY, f64::min),
        );
        y0 = y0.max(
            transform
                .valid_domain
                .iter()
                .map(|p| p.y)
                .fold(f64::INFINITY, f64::min),
        );
        x1 = x1.min(
            transform
                .valid_domain
                .iter()
                .map(|p| p.x)
                .fold(f64::NEG_INFINITY, f64::max),
        );
        y1 = y1.min(
            transform
                .valid_domain
                .iter()
                .map(|p| p.y)
                .fold(f64::NEG_INFINITY, f64::max),
        );
    }
    x0 = x0.ceil();
    y0 = y0.ceil();
    x1 = x1.floor();
    y1 = y1.floor();
    let sampler_margin = 1.0;
    while x1 > x0 && y1 > y0 {
        let corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)];
        let all_sampler_safe = accepted.iter().all(|transform| {
            corners.iter().all(|(x, y)| {
                let matrix = transform.inverse_matrix;
                let source_x = matrix[0] * x + matrix[1] * y + matrix[2];
                let source_y = matrix[3] * x + matrix[4] * y + matrix[5];
                source_x >= sampler_margin
                    && source_y >= sampler_margin
                    && source_x <= width - 1.0 - sampler_margin
                    && source_y <= height - 1.0 - sampler_margin
            })
        });
        if all_sampler_safe {
            return Some(RectF64 {
                x: x0,
                y: y0,
                width: x1 - x0 + 1.0,
                height: y1 - y0 + 1.0,
            });
        }
        x0 += 1.0;
        y0 += 1.0;
        x1 -= 1.0;
        y1 -= 1.0;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: usize, height: usize, transform: ProxyTransform) -> RegistrationFrame {
        let base = |x: f64, y: f64| {
            (((x * 0.17).sin() + (y * 0.11).cos() + ((x + y) * 0.07).sin()) * 0.2 + 0.5) as f32
        };
        let (sin, cos) = transform.theta.sin_cos();
        let scale = transform.log_scale.exp();
        let cx = (width as f64 - 1.0) * 0.5;
        let cy = (height as f64 - 1.0) * 0.5;
        let luma = (0..height)
            .flat_map(|y| {
                (0..width).map(move |x| {
                    let rx = x as f64 - cx;
                    let ry = y as f64 - cy;
                    base(
                        cx + scale * (cos * rx - sin * ry) + transform.tx,
                        cy + scale * (sin * rx + cos * ry) + transform.ty,
                    )
                })
            })
            .collect::<Vec<_>>();
        RegistrationFrame {
            width,
            height,
            full_width: width,
            full_height: height,
            color: luma.iter().map(|v| [*v; 3]).collect(),
            luma,
            valid: vec![true; width * height],
            clipped: vec![false; width * height],
        }
    }

    fn source(index: usize, registration: RegistrationFrame) -> DecodedFocusSource {
        DecodedFocusSource {
            source_index: index,
            path_handle: format!("s{index}"),
            source_kind: "rendered_rgb_source",
            content_hash: format!("blake3:{index}"),
            graph_revision: "g".into(),
            width: registration.width as u32,
            height: registration.height as u32,
            active_area: super::super::raw_frame::RectU32 {
                x: 0,
                y: 0,
                width: registration.width as u32,
                height: registration.height as u32,
            },
            orientation: "Normal".into(),
            camera_make: "synthetic".into(),
            camera_model: "synthetic".into(),
            lens_model: None,
            focal_length_mm: None,
            aperture: None,
            focus_distance_mm: None,
            exposure_ev: None,
            iso: None,
            calibration_identity: "c".into(),
            render_identity: "r",
            cfa_pattern: None,
            clipping_ratio: 0.0,
            finite_pixel_ratio: 1.0,
            noise: 0.0,
            proxy_hash: format!("blake3:p{index}"),
            warnings: vec![],
            registration,
        }
    }

    #[test]
    fn deterministic_similarity_recovers_fractional_motion() {
        let truth = ProxyTransform {
            tx: 1.25,
            ty: -0.75,
            log_scale: 1.012f64.ln(),
            theta: 0.35f64.to_radians(),
        };
        let sources = vec![
            source(
                0,
                frame(
                    128,
                    96,
                    ProxyTransform {
                        tx: 0.0,
                        ty: 0.0,
                        log_scale: 0.0,
                        theta: 0.0,
                    },
                ),
            ),
            source(1, frame(128, 96, truth)),
        ];
        let first = solve_all(&sources, 0, || false).unwrap();
        let second = solve_all(&sources, 0, || false).unwrap();
        assert_eq!(
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&second).unwrap()
        );
        let solved = &first[1];
        assert!(
            (solved.translation_x_px - truth.tx).abs() <= 0.10,
            "{}",
            solved.translation_x_px
        );
        assert!(
            (solved.translation_y_px - truth.ty).abs() <= 0.10,
            "{}",
            solved.translation_y_px
        );
        assert!(
            (solved.scale - truth.log_scale.exp()).abs() <= 0.002,
            "{}",
            solved.scale
        );
        assert!(
            (solved.rotation_degrees - truth.theta.to_degrees()).abs() <= 0.03,
            "{}",
            solved.rotation_degrees
        );
    }

    #[test]
    fn cancellation_stops_before_transform_publication() {
        let sources = vec![
            source(
                0,
                frame(
                    32,
                    24,
                    ProxyTransform {
                        tx: 0.0,
                        ty: 0.0,
                        log_scale: 0.0,
                        theta: 0.0,
                    },
                ),
            ),
            source(
                1,
                frame(
                    32,
                    24,
                    ProxyTransform {
                        tx: 0.0,
                        ty: 0.0,
                        log_scale: 0.0,
                        theta: 0.0,
                    },
                ),
            ),
        ];
        assert!(
            solve_all(&sources, 0, || true)
                .unwrap_err()
                .contains("cancelled")
        );
    }

    #[test]
    fn textureless_and_excessive_motion_are_rejected_deterministically() {
        let flat = |index| {
            source(
                index,
                RegistrationFrame {
                    width: 64,
                    height: 48,
                    full_width: 64,
                    full_height: 48,
                    luma: vec![0.5; 64 * 48],
                    color: vec![[0.5; 3]; 64 * 48],
                    valid: vec![true; 64 * 48],
                    clipped: vec![false; 64 * 48],
                },
            )
        };
        let textureless = solve_all(&[flat(0), flat(1)], 0, || false).unwrap();
        assert_eq!(
            textureless[1].reason_codes,
            vec!["alignment_nonfinite_solution"]
        );

        let excessive = vec![
            source(
                0,
                frame(
                    128,
                    96,
                    ProxyTransform {
                        tx: 0.0,
                        ty: 0.0,
                        log_scale: 0.0,
                        theta: 0.0,
                    },
                ),
            ),
            source(
                1,
                frame(
                    128,
                    96,
                    ProxyTransform {
                        tx: 12.0,
                        ty: 0.0,
                        log_scale: 0.0,
                        theta: 0.0,
                    },
                ),
            ),
        ];
        let rejected = solve_all(&excessive, 0, || false).unwrap();
        assert_eq!(rejected[1].status, "excluded");
        assert!(!rejected[1].reason_codes.is_empty());
    }
}
