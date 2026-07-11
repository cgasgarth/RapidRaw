pub(crate) const MOTION_ALGORITHM_ID: &str = "noise_normalized_motion_probability_v1";

pub(crate) fn probability(values: &[f32]) -> f32 {
    let mut valid = values
        .iter()
        .copied()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .collect::<Vec<_>>();
    if valid.len() < 2 {
        return 0.0;
    }
    valid.sort_by(f32::total_cmp);
    let median = valid[valid.len() / 2];
    let max_normalized = valid
        .iter()
        .map(|value| {
            let noise_sigma = (0.000_025 + 0.002 * value.max(median)).sqrt() + 0.002;
            (value - median).abs() / noise_sigma
        })
        .fold(0.0f32, f32::max);
    ((max_normalized - 2.5) / 5.0).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separates_static_noise_from_motion() {
        assert_eq!(probability(&[0.2, 0.201, 0.199]), 0.0);
        assert!(probability(&[0.2, 0.65, 0.21]) > 0.9);
    }
}
