use super::overlap_motion::{MotionSample, OwnershipClass};
use image::Rgb;

pub const PYRAMID_LEVELS: u32 = 4;
pub const TILE_HALO_PX: u32 = 1 << PYRAMID_LEVELS;

#[derive(Clone, Copy)]
pub struct BlendSample {
    pub base: Rgb<f32>,
    pub detail: Rgb<f32>,
    pub source: usize,
}

pub fn blend(samples: &[BlendSample], motion: MotionSample) -> Rgb<f32> {
    if samples.is_empty() {
        return Rgb([0.0; 3]);
    }
    let owner = samples
        .iter()
        .find(|sample| sample.source == motion.owner)
        .unwrap_or(&samples[0]);
    if matches!(
        motion.class,
        OwnershipClass::MovingSubject | OwnershipClass::Unsupported
    ) {
        return Rgb(std::array::from_fn(|channel| {
            owner.base[channel] + owner.detail[channel]
        }));
    }
    let mut low_frequency = [0.0f32; 3];
    let mut total = 0.0f32;
    for sample in samples {
        let weight = if sample.source == motion.owner {
            1.0 + motion.confidence * 0.25
        } else {
            1.0
        };
        for (channel, value) in low_frequency.iter_mut().enumerate() {
            *value += sample.base[channel] * weight;
        }
        total += weight;
    }
    Rgb(std::array::from_fn(|channel| {
        low_frequency[channel] / total.max(f32::EPSILON) + owner.detail[channel]
    }))
}
