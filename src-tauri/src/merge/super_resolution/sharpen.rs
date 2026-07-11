use super::motion::RegionClass;

pub const SR_SHARPEN_ALGORITHM_ID: &str = "support_noise_unsharp_3x3_v1";
pub const MAX_AMOUNT: f32 = 0.65;

pub fn sharpen_supported(
    input: &[[f32; 3]],
    classes: &[RegionClass],
    confidence: &[f32],
    width: u32,
    height: u32,
) -> (Vec<[f32; 3]>, Vec<f32>) {
    let mut output = input.to_vec();
    let mut strengths = vec![0.0; input.len()];
    if width < 3 || height < 3 {
        return (output, strengths);
    }
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let index = (y * width + x) as usize;
            if classes[index] != RegionClass::SupportedStatic {
                continue;
            }
            let amount = (MAX_AMOUNT * confidence[index]).clamp(0.0, MAX_AMOUNT);
            strengths[index] = amount;
            for channel in 0..3 {
                let blur = (input[index][channel] * 4.0
                    + input[index - 1][channel]
                    + input[index + 1][channel]
                    + input[index - width as usize][channel]
                    + input[index + width as usize][channel])
                    / 8.0;
                let detail = input[index][channel] - blur;
                let limit = 0.045_f32.min(input[index][channel].max(0.0) * 0.05 + 0.005);
                output[index][channel] =
                    (input[index][channel] + amount * detail.clamp(-limit, limit)).clamp(0.0, 1.0);
            }
        }
    }
    (output, strengths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sharpening_is_zero_for_every_unsafe_class() {
        let input = vec![[0.2, 0.3, 0.4]; 25];
        let unsafe_classes = [
            RegionClass::WeakSupport,
            RegionClass::MotionRejected,
            RegionClass::OcclusionOrParallax,
            RegionClass::EdgeRisk,
            RegionClass::NoiseLimited,
            RegionClass::ClippedOrDefective,
            RegionClass::ReferenceFallback,
        ];
        for class in unsafe_classes {
            let classes = vec![class; 25];
            let (output, strengths) = sharpen_supported(&input, &classes, &[1.0; 25], 5, 5);
            assert_eq!(output, input);
            assert!(strengths.iter().all(|strength| *strength == 0.0));
        }
    }
}
