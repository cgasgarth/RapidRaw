pub(crate) const TONE_MAP_ALGORITHM_ID: &str = "global_reinhard_review_v1";

pub(crate) fn render_rgb8(radiance: &[[f32; 3]], exposure: f32) -> Vec<u8> {
    radiance
        .iter()
        .flat_map(|pixel| {
            pixel.iter().map(|value| {
                let linear = (value * exposure).max(0.0);
                let mapped = linear / (1.0 + linear);
                (mapped.powf(1.0 / 2.2) * 255.0).round().clamp(0.0, 255.0) as u8
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposure_changes_review_pixels_without_mutating_radiance() {
        let radiance = vec![[0.25, 1.0, 4.0]];
        let original = radiance.clone();
        assert_ne!(render_rgb8(&radiance, 1.0), render_rgb8(&radiance, 2.0));
        assert_eq!(radiance, original);
    }
}
