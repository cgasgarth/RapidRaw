use super::{
    alignment::{RectF64, SimilarityTransform},
    raw_frame::{DecodedFocusSource, RegistrationFrame},
};

pub(crate) const POLICY_ID: &str = "focus_hybrid_response_v1";

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FocusMeasurePolicy {
    pub sigmas: [f32; 3],
    pub scale_weights: [f32; 3],
    pub laplacian_weight: f32,
    pub tenengrad_weight: f32,
    pub evidence_floor: f32,
    pub clip_guard: f32,
    pub support_radius: u32,
    pub normalization_formula: &'static str,
}

impl Default for FocusMeasurePolicy {
    fn default() -> Self {
        Self {
            sigmas: [0.7, 1.4, 2.8],
            scale_weights: [0.5, 0.3, 0.2],
            laplacian_weight: 0.8,
            tenengrad_weight: 0.2,
            evidence_floor: 1.5,
            clip_guard: 0.985,
            support_radius: 9,
            normalization_formula: "hybrid_response/max(robust_noise_sigma*sqrt(local_signal+1e-4),1e-6)",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AlignedSource {
    pub source_index: usize,
    pub luma: Vec<f32>,
    pub rgb: Vec<[f32; 3]>,
    pub valid: Vec<bool>,
    pub clipped: Vec<bool>,
    pub noise_sigma: f32,
    pub alignment_confidence: f32,
}

#[derive(Clone, Debug)]
pub(crate) struct ResponseStack {
    pub width: u32,
    pub height: u32,
    pub sources: Vec<AlignedSource>,
    pub responses: Vec<Vec<f32>>,
    pub scale_winners: Vec<Vec<u16>>,
    pub reference_luma: Vec<f32>,
    pub policy: FocusMeasurePolicy,
}

pub(crate) fn compute(
    sources: &[DecodedFocusSource],
    transforms: &[SimilarityTransform],
    crop: &RectF64,
    reference_source_index: usize,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<ResponseStack, String> {
    let reference = sources
        .iter()
        .find(|source| source.source_index == reference_source_index)
        .ok_or_else(|| "focus_measure_reference_missing".to_string())?;
    let width = ((crop.width * reference.registration.width as f64
        / reference.registration.full_width as f64)
        .floor() as u32)
        .max(1);
    let height = ((crop.height * reference.registration.height as f64
        / reference.registration.full_height as f64)
        .floor() as u32)
        .max(1);
    let policy = FocusMeasurePolicy::default();
    let aligned = transforms
        .iter()
        .filter(|transform| transform.status == "accepted")
        .map(|transform| {
            let source = sources
                .iter()
                .find(|source| source.source_index == transform.source_index)
                .ok_or_else(|| "focus_measure_source_missing".to_string())?;
            sample_tile(
                source,
                transform,
                crop,
                width,
                height,
                policy.clip_guard,
                cancelled,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut responses = Vec::with_capacity(aligned.len());
    let mut per_source_scales = Vec::with_capacity(aligned.len());
    for source in &aligned {
        if cancelled() {
            return Err("focus_stack_plan_cancelled:response_convolution".to_string());
        }
        let scales = policy
            .sigmas
            .iter()
            .map(|sigma| {
                response_at_scale(source, width as usize, height as usize, *sigma, &policy)
            })
            .collect::<Vec<_>>();
        let response = (0..source.luma.len())
            .map(|index| {
                if !source.valid[index] || source.clipped[index] {
                    return f32::NAN;
                }
                scales
                    .iter()
                    .zip(policy.scale_weights)
                    .map(|(scale, weight)| scale[index] * weight)
                    .sum::<f32>()
            })
            .collect();
        per_source_scales.push(scales);
        responses.push(response);
    }
    let scale_winners = (0..policy.sigmas.len())
        .map(|scale| {
            (0..width as usize * height as usize)
                .map(|index| {
                    per_source_scales
                        .iter()
                        .enumerate()
                        .filter(|(source, _)| aligned[*source].valid[index])
                        .max_by(|(a_index, a), (b_index, b)| {
                            a[scale][index]
                                .total_cmp(&b[scale][index])
                                .then_with(|| b_index.cmp(a_index))
                        })
                        .map(|(source, _)| aligned[source].source_index as u16)
                        .unwrap_or(u16::MAX)
                })
                .collect()
        })
        .collect();
    let reference_luma = aligned
        .iter()
        .find(|source| source.source_index == reference_source_index)
        .map(|source| source.luma.clone())
        .ok_or_else(|| "focus_measure_aligned_reference_missing".to_string())?;
    Ok(ResponseStack {
        width,
        height,
        sources: aligned,
        responses,
        scale_winners,
        reference_luma,
        policy,
    })
}

fn sample_tile(
    source: &DecodedFocusSource,
    transform: &SimilarityTransform,
    crop: &RectF64,
    width: u32,
    height: u32,
    clip_guard: f32,
    cancelled: impl Fn() -> bool + Copy,
) -> Result<AlignedSource, String> {
    let frame = &source.registration;
    let mut luma = Vec::with_capacity(width as usize * height as usize);
    let mut rgb = Vec::with_capacity(luma.capacity());
    let mut valid = Vec::with_capacity(luma.capacity());
    let mut clipped = Vec::with_capacity(luma.capacity());
    let scalar = transform.exposure_normalization.scalar as f32;
    for y in 0..height {
        if y % 16 == 0 && cancelled() {
            return Err("focus_stack_plan_cancelled:aligned_sampling".to_string());
        }
        for x in 0..width {
            let reference_x = crop.x + (x as f64 + 0.5) * crop.width / width as f64;
            let reference_y = crop.y + (y as f64 + 0.5) * crop.height / height as f64;
            let sx = transform.inverse_matrix[0] * reference_x
                + transform.inverse_matrix[1] * reference_y
                + transform.inverse_matrix[2];
            let sy = transform.inverse_matrix[3] * reference_x
                + transform.inverse_matrix[4] * reference_y
                + transform.inverse_matrix[5];
            let px = sx * frame.width as f64 / frame.full_width as f64 - 0.5;
            let py = sy * frame.height as f64 / frame.full_height as f64 - 0.5;
            let sample = bilinear(frame, px, py);
            let is_valid = sample.is_some_and(|(_, _, ok, _)| ok);
            let (sample_luma, sample_rgb, _, sample_clipped) =
                sample.unwrap_or((0.0, [0.0; 3], false, true));
            luma.push(sample_luma * scalar);
            rgb.push(sample_rgb.map(|channel| channel * scalar));
            valid.push(
                is_valid && sample_luma.is_finite() && sample_rgb.iter().all(|v| v.is_finite()),
            );
            clipped.push(
                sample_clipped
                    || sample_rgb
                        .iter()
                        .any(|channel| *channel * scalar >= clip_guard),
            );
        }
    }
    Ok(AlignedSource {
        source_index: source.source_index,
        luma,
        rgb,
        valid,
        clipped,
        noise_sigma: source.noise.max(1e-5) * scalar,
        alignment_confidence: transform.confidence as f32,
    })
}

fn bilinear(frame: &RegistrationFrame, x: f64, y: f64) -> Option<(f32, [f32; 3], bool, bool)> {
    let x0 = x.floor() as isize;
    let y0 = y.floor() as isize;
    if x0 < 0 || y0 < 0 || x0 + 1 >= frame.width as isize || y0 + 1 >= frame.height as isize {
        return None;
    }
    let tx = (x - x0 as f64) as f32;
    let ty = (y - y0 as f64) as f32;
    let indexes = [
        y0 as usize * frame.width + x0 as usize,
        y0 as usize * frame.width + x0 as usize + 1,
        (y0 as usize + 1) * frame.width + x0 as usize,
        (y0 as usize + 1) * frame.width + x0 as usize + 1,
    ];
    let weights = [
        (1.0 - tx) * (1.0 - ty),
        tx * (1.0 - ty),
        (1.0 - tx) * ty,
        tx * ty,
    ];
    let mut luma = 0.0;
    let mut color = [0.0; 3];
    for (index, weight) in indexes.into_iter().zip(weights) {
        luma += frame.luma[index] * weight;
        for (channel, value) in color.iter_mut().enumerate() {
            *value += frame.color[index][channel] * weight;
        }
    }
    Some((
        luma,
        color,
        indexes.iter().all(|index| frame.valid[*index]),
        indexes.iter().any(|index| frame.clipped[*index]),
    ))
}

fn response_at_scale(
    source: &AlignedSource,
    width: usize,
    height: usize,
    sigma: f32,
    policy: &FocusMeasurePolicy,
) -> Vec<f32> {
    let blurred = gaussian(&source.luma, width, height, sigma);
    let radius = (sigma * 3.0).ceil() as usize;
    let mut output = vec![0.0; blurred.len()];
    for y in radius.max(1)..height.saturating_sub(radius.max(1)) {
        for x in radius.max(1)..width.saturating_sub(radius.max(1)) {
            let i = y * width + x;
            if !source.valid[i] || source.clipped[i] {
                continue;
            }
            let dxx = (blurred[i - 1] - 2.0 * blurred[i] + blurred[i + 1]).abs();
            let dyy = (blurred[i - width] - 2.0 * blurred[i] + blurred[i + width]).abs();
            let gx = 3.0 * (blurred[i - width + 1] - blurred[i - width - 1])
                + 10.0 * (blurred[i + 1] - blurred[i - 1])
                + 3.0 * (blurred[i + width + 1] - blurred[i + width - 1]);
            let gy = 3.0 * (blurred[i + width - 1] - blurred[i - width - 1])
                + 10.0 * (blurred[i + width] - blurred[i - width])
                + 3.0 * (blurred[i + width + 1] - blurred[i - width + 1]);
            let hybrid = policy.laplacian_weight * (dxx + dyy)
                + policy.tenengrad_weight * (gx.mul_add(gx, gy * gy)).sqrt() / 16.0;
            output[i] = hybrid / (source.noise_sigma * (blurred[i].abs() + 1e-4).sqrt()).max(1e-6);
        }
    }
    output
}

fn gaussian(input: &[f32], width: usize, height: usize, sigma: f32) -> Vec<f32> {
    let radius = (sigma * 3.0).ceil() as isize;
    let mut kernel = (-radius..=radius)
        .map(|x| (-(x * x) as f32 / (2.0 * sigma * sigma)).exp())
        .collect::<Vec<_>>();
    let sum: f32 = kernel.iter().sum();
    for value in &mut kernel {
        *value /= sum;
    }
    let mut temp = vec![0.0; input.len()];
    let mut output = vec![0.0; input.len()];
    for y in 0..height {
        for x in 0..width {
            temp[y * width + x] = kernel
                .iter()
                .enumerate()
                .map(|(k, w)| {
                    let sx =
                        (x as isize + k as isize - radius).clamp(0, width as isize - 1) as usize;
                    input[y * width + sx] * w
                })
                .sum();
        }
    }
    for y in 0..height {
        for x in 0..width {
            output[y * width + x] = kernel
                .iter()
                .enumerate()
                .map(|(k, w)| {
                    let sy =
                        (y as isize + k as isize - radius).clamp(0, height as isize - 1) as usize;
                    temp[sy * width + x] * w
                })
                .sum();
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_response_prefers_sharp_low_noise_texture() {
        let width = 48;
        let height = 32;
        let sharp_luma = (0..width * height)
            .map(|index| {
                let x = index % width;
                let y = index / width;
                if (x / 3 + y / 3) % 2 == 0 { 0.2 } else { 0.8 }
            })
            .collect::<Vec<_>>();
        let blurred_luma = gaussian(&sharp_luma, width, height, 2.4)
            .into_iter()
            .enumerate()
            .map(|(index, value)| value + ((index * 17 % 11) as f32 - 5.0) * 0.004)
            .collect::<Vec<_>>();
        let source = |luma: Vec<f32>, noise_sigma| AlignedSource {
            source_index: 0,
            rgb: luma.iter().map(|value| [*value; 3]).collect(),
            luma,
            valid: vec![true; width * height],
            clipped: vec![false; width * height],
            noise_sigma,
            alignment_confidence: 1.0,
        };
        let policy = FocusMeasurePolicy::default();
        let sharp = response_at_scale(&source(sharp_luma, 0.01), width, height, 1.4, &policy);
        let noisy_blurred =
            response_at_scale(&source(blurred_luma, 0.04), width, height, 1.4, &policy);
        let sharp_total: f32 = sharp.iter().sum();
        let blurred_total: f32 = noisy_blurred.iter().sum();
        assert!(
            sharp_total > blurred_total * 3.0,
            "{sharp_total} <= {blurred_total}"
        );
    }
}
