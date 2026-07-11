pub(crate) const RADIANCE_ALGORITHM_ID: &str = "static_scene_linear_radiance_v1";

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Sample {
    pub clipped: bool,
    pub exposure_scale: f32,
    pub valid: bool,
    pub value: f32,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Estimate {
    pub effective_samples: u8,
    pub radiance: f32,
    pub residual: f32,
    pub variance: f32,
    pub weight: f32,
}

pub(crate) fn estimate(samples: &[Sample]) -> Estimate {
    let mut candidates = samples
        .iter()
        .filter(|sample| {
            sample.valid
                && !sample.clipped
                && sample.value.is_finite()
                && sample.exposure_scale > 0.0
        })
        .map(|sample| sample.value / sample.exposure_scale)
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Estimate::default();
    }
    candidates.sort_by(f32::total_cmp);
    let provisional = candidates[candidates.len() / 2];
    let mut weighted_sum = 0.0f64;
    let mut weight_sum = 0.0f64;
    let mut weighted_square_sum = 0.0f64;
    let mut residual_sum = 0.0f64;
    let mut effective_samples = 0u8;
    for sample in samples {
        if !sample.valid
            || sample.clipped
            || !sample.value.is_finite()
            || sample.exposure_scale <= 0.0
        {
            continue;
        }
        let value = sample.value / sample.exposure_scale;
        if !value.is_finite() {
            continue;
        }
        let signal = sample.value.max(0.0);
        let noise_variance = 0.000_025 + 0.002 * signal;
        let shadow_weight = signal / (signal + 0.01);
        let normalized_residual =
            (value - provisional).abs() / (noise_variance.sqrt() / sample.exposure_scale + 0.002);
        let robust_weight = if normalized_residual <= 3.0 {
            1.0
        } else {
            3.0 / normalized_residual
        };
        let weight = (shadow_weight * robust_weight / noise_variance) as f64;
        weighted_sum += value as f64 * weight;
        weighted_square_sum += (value as f64 * value as f64) * weight;
        residual_sum += (value - provisional).abs() as f64 * weight;
        weight_sum += weight;
        effective_samples = effective_samples.saturating_add(1);
    }
    if weight_sum == 0.0 {
        return Estimate::default();
    }
    let radiance = (weighted_sum / weight_sum) as f32;
    Estimate {
        effective_samples,
        radiance,
        residual: (residual_sum / weight_sum) as f32,
        variance: ((weighted_square_sum / weight_sum) - (radiance as f64).powi(2)).max(0.0) as f32,
        weight: weight_sum as f32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconstructs_exposure_normalized_radiance_and_ignores_clipping() {
        let result = estimate(&[
            Sample {
                value: 0.1,
                exposure_scale: 0.5,
                valid: true,
                clipped: false,
            },
            Sample {
                value: 0.2,
                exposure_scale: 1.0,
                valid: true,
                clipped: false,
            },
            Sample {
                value: 1.0,
                exposure_scale: 4.0,
                valid: true,
                clipped: true,
            },
        ]);
        assert!((result.radiance - 0.2).abs() < 1e-6);
        assert_eq!(result.effective_samples, 2);
    }

    #[test]
    fn deterministic_forward_model_meets_radiometric_error_bound() {
        let mut absolute_relative_error = 0.0;
        for index in 1..=200 {
            let expected = index as f32 / 80.0;
            let samples = [0.25, 1.0, 4.0].map(|exposure_scale| {
                let sensor_value = expected * exposure_scale;
                Sample {
                    clipped: sensor_value >= 0.995,
                    exposure_scale,
                    valid: true,
                    value: sensor_value.min(1.0),
                }
            });
            let reconstructed = estimate(&samples).radiance;
            if samples.iter().any(|sample| !sample.clipped) {
                absolute_relative_error += (reconstructed - expected).abs() / expected;
            }
        }
        assert!(absolute_relative_error / 200.0 <= 0.015);
    }

    #[test]
    fn invalid_and_non_finite_samples_have_zero_weight() {
        let result = estimate(&[
            Sample {
                value: f32::NAN,
                exposure_scale: 1.0,
                valid: true,
                clipped: false,
            },
            Sample {
                value: 0.5,
                exposure_scale: 1.0,
                valid: false,
                clipped: false,
            },
        ]);
        assert_eq!(result.weight, 0.0);
        assert_eq!(result.effective_samples, 0);
    }
}
