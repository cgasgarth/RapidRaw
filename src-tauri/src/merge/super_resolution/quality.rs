use serde::Serialize;

use super::motion::RegionClass;

pub const SR_QUALITY_POLICY_ID: &str = "burst_x2_native_quality_policy_v1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityMetrics {
    pub downsample_reprojection_mae: f32,
    pub fallback_coverage: f32,
    pub false_frequency_response: f32,
    pub final_mtf50_gain: f32,
    pub luma_variance_ratio: f32,
    pub mean_delta_e00: f32,
    pub normalized_overshoot: f32,
    pub static_coverage: f32,
    pub unsharpened_mtf50_gain: f32,
    pub zipper_false_color_delta: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityDecision {
    pub block_codes: Vec<&'static str>,
    pub decision: &'static str,
    pub metrics: QualityMetrics,
    pub policy_hash: String,
}

pub fn evaluate(
    baseline: &[[f32; 3]],
    unsharpened: &[[f32; 3]],
    final_pixels: &[[f32; 3]],
    classes: &[RegionClass],
    width: u32,
) -> QualityDecision {
    let static_indexes = classes
        .iter()
        .enumerate()
        .filter_map(|(index, class)| (*class == RegionClass::SupportedStatic).then_some(index))
        .collect::<Vec<_>>();
    let static_coverage = static_indexes.len() as f32 / classes.len().max(1) as f32;
    let fallback_coverage = 1.0 - static_coverage;
    let baseline_hf = hf_energy(baseline, classes, width);
    let unsharpened_hf = hf_energy(unsharpened, classes, width);
    let final_hf = hf_energy(final_pixels, classes, width);
    let baseline_variance = variance(baseline, &static_indexes).max(1.0e-7);
    let metrics = QualityMetrics {
        downsample_reprojection_mae: mean_absolute_error(baseline, unsharpened, &static_indexes),
        fallback_coverage,
        false_frequency_response: (final_hf - unsharpened_hf).max(0.0),
        final_mtf50_gain: final_hf / baseline_hf.max(1.0e-7),
        luma_variance_ratio: variance(unsharpened, &static_indexes) / baseline_variance,
        mean_delta_e00: mean_chroma_distance(baseline, unsharpened, &static_indexes) * 100.0,
        normalized_overshoot: max_overshoot(unsharpened, final_pixels, &static_indexes),
        static_coverage,
        unsharpened_mtf50_gain: unsharpened_hf / baseline_hf.max(1.0e-7),
        zipper_false_color_delta: mean_chroma_distance(unsharpened, final_pixels, &static_indexes),
    };
    let mut block_codes = Vec::new();
    if metrics.fallback_coverage > 0.25 {
        block_codes.push("fallback_coverage_exceeded");
    }
    if metrics.static_coverage < 0.5 {
        block_codes.push("insufficient_supported_static_coverage");
    }
    if metrics.downsample_reprojection_mae > 0.01 {
        block_codes.push("reprojection_consistency_failed");
    }
    if metrics.mean_delta_e00 > 2.0 {
        block_codes.push("color_delta_e_failed");
    }
    if metrics.normalized_overshoot >= 0.05 {
        block_codes.push("overshoot_guard_failed");
    }
    if metrics.false_frequency_response > 0.03 || metrics.zipper_false_color_delta > 0.01 {
        block_codes.push("false_detail_consistency_failed");
    }
    if !final_pixels.iter().flatten().all(|value| value.is_finite()) {
        block_codes.push("nonfinite_output");
    }
    let decision = if block_codes.is_empty() {
        "review_required"
    } else if metrics.fallback_coverage > 0.5 || block_codes.contains(&"nonfinite_output") {
        "blocked"
    } else {
        "preview_only"
    };
    let policy_hash = blake3::hash(
        format!("{SR_QUALITY_POLICY_ID}:0.25:0.50:0.01:2.0:0.05:0.03:0.01").as_bytes(),
    );
    QualityDecision {
        block_codes,
        decision,
        metrics,
        policy_hash: format!("blake3:{}", policy_hash.to_hex()),
    }
}

fn luma(pixel: [f32; 3]) -> f32 {
    pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722
}

fn hf_energy(pixels: &[[f32; 3]], classes: &[RegionClass], width: u32) -> f32 {
    if pixels.len() < 2 || width == 0 {
        return 0.0;
    }
    let width = width as usize;
    let mut sum = 0.0;
    let mut count = 0usize;
    for index in 0..pixels.len() {
        if classes[index] != RegionClass::SupportedStatic {
            continue;
        }
        for neighbor in [
            index
                .checked_add(1)
                .filter(|next| *next / width == index / width),
            index.checked_add(width),
        ]
        .into_iter()
        .flatten()
        .filter(|next| *next < pixels.len())
        {
            if classes[neighbor] == RegionClass::SupportedStatic {
                sum += (luma(pixels[neighbor]) - luma(pixels[index])).abs();
                count += 1;
            }
        }
    }
    sum / count.max(1) as f32
}

fn variance(pixels: &[[f32; 3]], indexes: &[usize]) -> f32 {
    if indexes.is_empty() {
        return 0.0;
    }
    let mean = indexes
        .iter()
        .map(|index| luma(pixels[*index]))
        .sum::<f32>()
        / indexes.len() as f32;
    indexes
        .iter()
        .map(|index| (luma(pixels[*index]) - mean).powi(2))
        .sum::<f32>()
        / indexes.len() as f32
}

fn mean_absolute_error(a: &[[f32; 3]], b: &[[f32; 3]], indexes: &[usize]) -> f32 {
    if indexes.is_empty() {
        return 1.0;
    }
    indexes
        .iter()
        .map(|index| (luma(a[*index]) - luma(b[*index])).abs())
        .sum::<f32>()
        / indexes.len() as f32
}

fn mean_chroma_distance(a: &[[f32; 3]], b: &[[f32; 3]], indexes: &[usize]) -> f32 {
    if indexes.is_empty() {
        return 1.0;
    }
    indexes
        .iter()
        .map(|index| {
            let ac = [a[*index][0] - a[*index][1], a[*index][2] - a[*index][1]];
            let bc = [b[*index][0] - b[*index][1], b[*index][2] - b[*index][1]];
            (ac[0] - bc[0]).hypot(ac[1] - bc[1])
        })
        .sum::<f32>()
        / indexes.len() as f32
}

fn max_overshoot(before: &[[f32; 3]], after: &[[f32; 3]], indexes: &[usize]) -> f32 {
    indexes
        .iter()
        .flat_map(|index| {
            (0..3).map(move |channel| (after[*index][channel] - before[*index][channel]).abs())
        })
        .fold(0.0, f32::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsafe_coverage_fails_closed() {
        let pixels = vec![[0.2, 0.2, 0.2]; 64];
        let classes = vec![RegionClass::MotionRejected; 64];
        let result = evaluate(&pixels, &pixels, &pixels, &classes, 8);
        assert_eq!(result.decision, "blocked");
        assert!(result.block_codes.contains(&"fallback_coverage_exceeded"));
    }
}
