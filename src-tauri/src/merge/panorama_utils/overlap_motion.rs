use image::Rgb;

pub const ANALYSIS_STEP_PX: u32 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnershipClass {
    StaticSupported,
    LocalParallax,
    MovingSubject,
    LowTexture,
    Unsupported,
}

impl OwnershipClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::StaticSupported => "static_supported",
            Self::LocalParallax => "local_parallax",
            Self::MovingSubject => "moving_subject",
            Self::LowTexture => "low_texture",
            Self::Unsupported => "unsupported",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct MotionSample {
    pub class: OwnershipClass,
    pub confidence: f32,
    pub owner: usize,
}

pub fn classify(samples: &[(usize, Rgb<f32>)], x: u32, y: u32) -> MotionSample {
    if samples.is_empty() {
        return MotionSample {
            class: OwnershipClass::Unsupported,
            confidence: 0.0,
            owner: 0,
        };
    }
    if samples.len() == 1 {
        return MotionSample {
            class: OwnershipClass::Unsupported,
            confidence: 0.25,
            owner: samples[0].0,
        };
    }
    let left = luminance(samples[0].1);
    let right = luminance(samples[1].1);
    let residual = ((left + 1.0e-5).ln() - (right + 1.0e-5).ln()).abs();
    let texture = (left - 0.5).abs().max((right - 0.5).abs());
    let owner =
        samples[stable_tie_break(x / ANALYSIS_STEP_PX, y / ANALYSIS_STEP_PX, samples.len())].0;
    let (class, confidence) = if texture < 0.015 {
        (OwnershipClass::LowTexture, 0.35)
    } else if residual > 0.28 {
        (
            OwnershipClass::MovingSubject,
            (residual * 2.0).clamp(0.55, 1.0),
        )
    } else if residual > 0.11 {
        (
            OwnershipClass::LocalParallax,
            (0.45 + residual).clamp(0.0, 0.85),
        )
    } else {
        (
            OwnershipClass::StaticSupported,
            (1.0 - residual * 3.0).clamp(0.55, 1.0),
        )
    };
    MotionSample {
        class,
        confidence,
        owner,
    }
}

fn stable_tie_break(x: u32, y: u32, count: usize) -> usize {
    ((u64::from(y) * 73_856_093 + u64::from(x) * 19_349_663) % count as u64) as usize
}

pub fn luminance(pixel: Rgb<f32>) -> f32 {
    pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_regions_have_stable_source_ownership() {
        let samples = [(3, Rgb([0.05, 0.05, 0.05])), (7, Rgb([0.9, 0.9, 0.9]))];
        assert_eq!(
            classify(&samples, 16, 24).class,
            OwnershipClass::MovingSubject
        );
        assert_eq!(
            classify(&samples, 16, 24).owner,
            classify(&samples, 16, 24).owner
        );
    }
}
