use std::sync::atomic::AtomicBool;

use super::cfa_observations::{CfaObservation, SceneRect, stream_observations};
use super::raw_frame::{CfaClass, SuperResolutionRawFrame, check_cancel};
use super::registration::SuperResolutionRegistrationTransform;
use super::support::SampleEstimate;

pub const SR_RECONSTRUCTION_ALGORITHM_ID: &str = "positive_adaptive_cfa_kernel_huber2_v1";
pub const KERNEL_SIGMA_MIN: f32 = 0.35;
pub const KERNEL_SIGMA_MAX: f32 = 1.25;
pub const KERNEL_CUTOFF: f32 = 2.5;
const HUBER_K: f32 = 0.75;

#[derive(Clone, Copy, Debug)]
pub struct OutputTile {
    pub height: u32,
    pub width: u32,
    pub x: u32,
    pub y: u32,
}

#[derive(Clone, Debug)]
pub struct PlaneTile {
    pub estimates: Vec<SampleEstimate>,
    pub height: u32,
    pub width: u32,
}

#[derive(Clone, Copy)]
struct Contribution {
    sensor_order: u64,
    source_index: usize,
    value: f32,
    weight: f32,
}

pub fn reconstruct_plane_tile(
    frames: &[SuperResolutionRawFrame],
    transforms: &[SuperResolutionRegistrationTransform],
    overlap: SceneRect,
    class: CfaClass,
    tile: OutputTile,
    cancellation_token: &AtomicBool,
) -> Result<PlaneTile, String> {
    let output_width = overlap.width * 2;
    let output_height = overlap.height * 2;
    if tile.x + tile.width > output_width || tile.y + tile.height > output_height {
        return Err("reconstruction_tile_outside_common_overlap".to_string());
    }
    let mut buckets = vec![Vec::<Contribution>::new(); (tile.width * tile.height) as usize];
    stream_observations(frames, transforms, overlap, |observation| {
        if observation.class != class || observation.confidence <= 0.0 {
            return;
        }
        deposit(observation, overlap, tile, &mut buckets);
    })?;
    let mut estimates = Vec::with_capacity(buckets.len());
    for (index, bucket) in buckets.iter().enumerate() {
        if index % 4096 == 0 {
            check_cancel(cancellation_token)?;
        }
        estimates.push(robust_estimate(bucket));
    }
    Ok(PlaneTile {
        estimates,
        height: tile.height,
        width: tile.width,
    })
}

fn deposit(
    observation: CfaObservation,
    overlap: SceneRect,
    tile: OutputTile,
    buckets: &mut [Vec<Contribution>],
) {
    let center_x = (observation.scene_x - overlap.left) * 2.0 - 0.5;
    let center_y = (observation.scene_y - overlap.top) * 2.0 - 0.5;
    let radius = (KERNEL_SIGMA_MAX * KERNEL_CUTOFF * 2.0).ceil() as i32;
    let min_x = (center_x.floor() as i32 - radius).max(tile.x as i32);
    let max_x = (center_x.ceil() as i32 + radius).min((tile.x + tile.width) as i32 - 1);
    let min_y = (center_y.floor() as i32 - radius).max(tile.y as i32);
    let max_y = (center_y.ceil() as i32 + radius).min((tile.y + tile.height) as i32 - 1);
    // Sensor-space sigma is adaptive to local registration confidence and remains positive.
    let base_sigma =
        (0.7 + (1.0 - observation.confidence) * 0.55).clamp(KERNEL_SIGMA_MIN, KERNEL_SIGMA_MAX);
    let gradient_magnitude = observation
        .green_gradient_x
        .hypot(observation.green_gradient_y);
    let edge_strength = (gradient_magnitude / 0.08).clamp(0.0, 1.0);
    let sigma_across =
        (base_sigma * (1.0 - edge_strength * 0.5)).clamp(KERNEL_SIGMA_MIN, KERNEL_SIGMA_MAX);
    let sigma_along =
        (base_sigma * (1.0 + edge_strength * 0.6)).clamp(KERNEL_SIGMA_MIN, KERNEL_SIGMA_MAX);
    let (normal_x, normal_y) = if gradient_magnitude > 1.0e-6 {
        (
            observation.green_gradient_x / gradient_magnitude,
            observation.green_gradient_y / gradient_magnitude,
        )
    } else {
        (1.0, 0.0)
    };
    let cutoff2 = KERNEL_CUTOFF * KERNEL_CUTOFF;
    for output_y in min_y..=max_y {
        for output_x in min_x..=max_x {
            let dx = (output_x as f32 - center_x) * 0.5;
            let dy = (output_y as f32 - center_y) * 0.5;
            let across = dx.mul_add(normal_x, dy * normal_y);
            let along = (-dx).mul_add(normal_y, dy * normal_x);
            let distance2 = across * across / (sigma_across * sigma_across)
                + along * along / (sigma_along * sigma_along);
            if distance2 > cutoff2 {
                continue;
            }
            let spatial = (-0.5 * distance2).exp();
            let weight = spatial * observation.confidence / observation.variance.max(1.0e-7);
            let local_x = (output_x as u32 - tile.x) as usize;
            let local_y = (output_y as u32 - tile.y) as usize;
            buckets[local_y * tile.width as usize + local_x].push(Contribution {
                sensor_order: ((observation.sensor_y as u64) << 32) | observation.sensor_x as u64,
                source_index: observation.source_index,
                value: observation.value,
                weight,
            });
        }
    }
}

fn robust_estimate(contributions: &[Contribution]) -> SampleEstimate {
    if contributions.is_empty() {
        return SampleEstimate::default();
    }
    let mut robust_weights = contributions
        .iter()
        .map(|item| item.weight)
        .collect::<Vec<_>>();
    let mut mean = weighted_mean(contributions, &robust_weights);
    let mut base_residual = 0.0;
    for _pass in 0..2 {
        let scale = weighted_scale(contributions, &robust_weights, mean).max(1.0e-5);
        base_residual = scale;
        for (index, contribution) in contributions.iter().enumerate() {
            let normalized = (contribution.value - mean).abs() / scale;
            let huber = if normalized <= HUBER_K {
                1.0
            } else {
                HUBER_K / normalized
            };
            robust_weights[index] = contribution.weight * huber;
        }
        mean = weighted_mean(contributions, &robust_weights);
    }
    let weight_sum = kahan_sum(robust_weights.iter().copied());
    let weight_square_sum = kahan_sum(robust_weights.iter().map(|weight| weight * weight));
    let effective_samples = if weight_square_sum > 0.0 {
        weight_sum * weight_sum / weight_square_sum
    } else {
        0.0
    };
    let rejected = contributions
        .iter()
        .zip(&robust_weights)
        .filter(|(item, robust)| **robust < item.weight * 0.999)
        .count();
    let source_mask = contributions.iter().fold(0u8, |mask, item| {
        mask | (1u8.checked_shl(item.source_index as u32).unwrap_or(0))
    });
    debug_assert!(contributions.windows(2).all(|pair| {
        pair[0].source_index < pair[1].source_index
            || (pair[0].source_index == pair[1].source_index
                && pair[0].sensor_order <= pair[1].sensor_order)
    }));
    SampleEstimate {
        effective_samples,
        estimate: mean,
        outlier_ratio: rejected as f32 / contributions.len() as f32,
        residual: base_residual,
        source_mask,
        variance: if weight_sum > 0.0 {
            1.0 / weight_sum
        } else {
            0.0
        },
        weight_sum,
    }
}

fn weighted_mean(items: &[Contribution], weights: &[f32]) -> f32 {
    let denominator = kahan_sum(weights.iter().copied());
    if denominator <= 0.0 {
        return 0.0;
    }
    kahan_sum(
        items
            .iter()
            .zip(weights)
            .map(|(item, weight)| item.value * weight),
    ) / denominator
}

fn weighted_scale(items: &[Contribution], weights: &[f32], mean: f32) -> f32 {
    let denominator = kahan_sum(weights.iter().copied());
    if denominator <= 0.0 {
        return 0.0;
    }
    (kahan_sum(items.iter().zip(weights).map(|(item, weight)| {
        let residual = item.value - mean;
        residual * residual * weight
    })) / denominator)
        .sqrt()
}

fn kahan_sum(values: impl Iterator<Item = f32>) -> f32 {
    let mut sum = 0.0;
    let mut correction = 0.0;
    for value in values {
        let adjusted = value - correction;
        let next = sum + adjusted;
        correction = (next - sum) - adjusted;
        sum = next;
    }
    sum
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;
    use crate::merge::super_resolution::cfa_observations::SceneRect;
    use crate::merge::super_resolution::raw_frame::{
        CalibratedBayerSensor, GreenPhaseProxy, SuperResolutionBayerBurstSource,
        SuperResolutionBayerCalibration,
    };

    #[test]
    fn cfa_identity_is_preserved_and_output_is_deterministic() {
        let frames = vec![fixture_frame(0, 0.2, 0.9), fixture_frame(1, 0.2, 0.1)];
        let transforms = vec![fixture_transform(0, 0.0), fixture_transform(1, 0.35)];
        let tile = OutputTile {
            x: 0,
            y: 0,
            width: 8,
            height: 8,
        };
        let overlap = SceneRect {
            left: 0.0,
            top: 0.0,
            width: 4,
            height: 4,
        };
        let token = AtomicBool::new(false);
        let first =
            reconstruct_plane_tile(&frames, &transforms, overlap, CfaClass::R, tile, &token)
                .expect("red reconstruction");
        let second =
            reconstruct_plane_tile(&frames, &transforms, overlap, CfaClass::R, tile, &token)
                .expect("repeat reconstruction");
        assert_eq!(first.width, 8);
        assert_eq!(first.height, 8);
        assert_eq!(
            first
                .estimates
                .iter()
                .map(|sample| sample.estimate.to_bits())
                .collect::<Vec<_>>(),
            second
                .estimates
                .iter()
                .map(|sample| sample.estimate.to_bits())
                .collect::<Vec<_>>()
        );
        assert!(
            first
                .estimates
                .iter()
                .filter(|sample| sample.weight_sum > 0.0)
                .all(|sample| { (sample.estimate - 0.2).abs() <= 1.0e-6 })
        );
    }

    #[test]
    fn exactly_two_huber_passes_reduce_a_corrupted_source() {
        let items = [
            Contribution {
                sensor_order: 0,
                source_index: 0,
                value: 0.25,
                weight: 1.0,
            },
            Contribution {
                sensor_order: 0,
                source_index: 1,
                value: 0.26,
                weight: 1.0,
            },
            Contribution {
                sensor_order: 0,
                source_index: 2,
                value: 4.0,
                weight: 1.0,
            },
        ];
        let estimate = robust_estimate(&items);
        assert!(estimate.estimate < 1.0);
        assert!(estimate.outlier_ratio > 0.0);
        assert_eq!(estimate.source_mask, 0b111);
    }

    fn fixture_frame(source_index: usize, red: f32, blue: f32) -> SuperResolutionRawFrame {
        let classes = (0..4)
            .flat_map(|y| {
                (0..4).map(move |x| match (y % 2, x % 2) {
                    (0, 0) => CfaClass::R,
                    (0, 1) => CfaClass::G1,
                    (1, 0) => CfaClass::G2,
                    _ => CfaClass::B,
                })
            })
            .collect::<Vec<_>>();
        let values = classes
            .iter()
            .map(|class| match class {
                CfaClass::R => red,
                CfaClass::B => blue,
                _ => 0.5,
            })
            .collect::<Vec<_>>();
        SuperResolutionRawFrame {
            sensor: CalibratedBayerSensor {
                classes,
                height: 4,
                valid: vec![true; 16],
                values,
                variances: vec![0.01; 16],
                width: 4,
            },
            proxy: GreenPhaseProxy {
                clipped_ratio: 0.0,
                height: 2,
                proxy_pixel_scale: 2.0,
                quality_score: 1.0,
                valid: vec![true; 4],
                values: vec![0.5; 4],
                width: 2,
            },
            source: SuperResolutionBayerBurstSource {
                block_codes: Vec::new(),
                calibration: SuperResolutionBayerCalibration {
                    bayer_pattern: "RGGB".to_string(),
                    black_level: vec![0.0],
                    black_level_repeat: [1, 1, 1],
                    bits_per_sample: 16,
                    white_balance: [1.0; 4],
                    white_level: vec![65535],
                },
                calibration_identity: "blake3:fixture".to_string(),
                camera_make: "fixture".to_string(),
                camera_model: "fixture".to_string(),
                content_hash: format!("blake3:fixture-{source_index}"),
                graph_revision: format!("fixture-{source_index}"),
                height: 4,
                path: format!("fixture-{source_index}.dng"),
                source_index,
                width: 4,
            },
        }
    }

    fn fixture_transform(
        source_index: usize,
        translation_x_px: f32,
    ) -> SuperResolutionRegistrationTransform {
        SuperResolutionRegistrationTransform {
            confidence: 1.0,
            correlation_peak_ratio: 1.1,
            inlier_ratio: 1.0,
            overlap_ratio: 1.0,
            p50_residual_px: 0.0,
            p95_residual_px: 0.0,
            rotation_degrees: 0.0,
            source_index,
            translation_x_px,
            translation_y_px: 0.0,
        }
    }
}
