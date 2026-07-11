use super::motion::RegionClass;

pub const SR_FALLBACK_ALGORITHM_ID: &str = "reference_baseline_hard_core_taper_v1";

pub fn compose_reference_fallback(
    fused: &[[f32; 3]],
    baseline: &[[f32; 3]],
    classes: &[RegionClass],
    width: u32,
    height: u32,
) -> (Vec<[f32; 3]>, f32) {
    let mut output = baseline.to_vec();
    let mut fallback = 0usize;
    for y in 0..height {
        for x in 0..width {
            let index = (y * width + x) as usize;
            if classes[index] == RegionClass::SupportedStatic {
                let unsafe_distance = nearest_unsafe_distance(classes, width, height, x, y, 2);
                let fused_weight = (unsafe_distance as f32 / 2.0).clamp(0.0, 1.0);
                for channel in 0..3 {
                    output[index][channel] = baseline[index][channel]
                        .mul_add(1.0 - fused_weight, fused[index][channel] * fused_weight);
                }
            } else {
                fallback += 1;
            }
        }
    }
    (output, fallback as f32 / classes.len().max(1) as f32)
}

fn nearest_unsafe_distance(
    classes: &[RegionClass],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    radius: i32,
) -> u32 {
    let mut distance = (radius + 1) as u32;
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx >= 0
                && ny >= 0
                && nx < width as i32
                && ny < height as i32
                && classes[(ny as u32 * width + nx as u32) as usize].unsafe_for_detail()
            {
                distance = distance.min(dx.unsigned_abs().max(dy.unsigned_abs()));
            }
        }
    }
    distance
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejected_core_contains_only_reference_pixels() {
        let fused = vec![[0.9, 0.1, 0.1]; 16];
        let baseline = vec![[0.2, 0.3, 0.4]; 16];
        let mut classes = vec![RegionClass::SupportedStatic; 16];
        classes[5] = RegionClass::MotionRejected;
        let (output, ratio) = compose_reference_fallback(&fused, &baseline, &classes, 4, 4);
        assert_eq!(output[5], baseline[5]);
        assert_eq!(ratio, 1.0 / 16.0);
    }
}
