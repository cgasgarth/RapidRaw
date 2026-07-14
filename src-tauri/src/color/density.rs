//! Shared, explicit log-density math for Film and Negative Lab adapters.

use anyhow::{Result, anyhow};

pub const DENSITY_CONTRACT_V1: &str = "rapidraw.density.v1";
pub const DENSITY_EQUATION_V1: &str = "d_neg_log10_v1";
pub const DENSITY_NUMERIC_POLICY_V1: &str = "density_floor_roundtrip_f64_v1";

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct DensityTransformDescriptorV1 {
    pub contract: &'static str,
    pub interpretation: &'static str,
    pub polarity: &'static str,
    pub equation: &'static str,
    pub floor: f64,
    pub base_or_white_reference: [f64; 3],
    pub flare_or_black_offset: [f64; 3],
    pub channel_order: &'static str,
    pub numeric_policy_version: &'static str,
}

impl DensityTransformDescriptorV1 {
    pub const fn negative_transmittance(base: [f64; 3], flare: [f64; 3]) -> Self {
        Self {
            contract: DENSITY_CONTRACT_V1,
            interpretation: "negative_transmittance",
            polarity: "negative",
            equation: DENSITY_EQUATION_V1,
            floor: 1.0e-6,
            base_or_white_reference: base,
            flare_or_black_offset: flare,
            channel_order: "rgb",
            numeric_policy_version: DENSITY_NUMERIC_POLICY_V1,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.contract != DENSITY_CONTRACT_V1
            || self.equation != DENSITY_EQUATION_V1
            || self.channel_order != "rgb"
            || self.polarity != "negative"
            || self.interpretation != "negative_transmittance"
            || !(self.floor.is_finite() && self.floor > 0.0 && self.floor < 1.0)
            || self
                .base_or_white_reference
                .iter()
                .chain(self.flare_or_black_offset.iter())
                .any(|value| !value.is_finite())
            || self
                .base_or_white_reference
                .iter()
                .any(|value| *value <= 0.0)
        {
            return Err(anyhow!("density_descriptor_invalid"));
        }
        Ok(())
    }
}

pub fn signal_to_density(
    signal: [f64; 3],
    descriptor: &DensityTransformDescriptorV1,
) -> Result<[f64; 3]> {
    descriptor.validate()?;
    if signal.iter().any(|value| !value.is_finite()) {
        return Err(anyhow!("density_signal_non_finite"));
    }
    Ok(std::array::from_fn(|channel| {
        let transmittance = ((signal[channel] - descriptor.flare_or_black_offset[channel])
            / descriptor.base_or_white_reference[channel])
            .max(descriptor.floor);
        -transmittance.log10()
    }))
}

pub fn density_to_signal(
    density: [f64; 3],
    descriptor: &DensityTransformDescriptorV1,
) -> Result<[f64; 3]> {
    descriptor.validate()?;
    if density
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0)
    {
        return Err(anyhow!("density_value_invalid"));
    }
    Ok(std::array::from_fn(|channel| {
        descriptor.base_or_white_reference[channel] * 10_f64.powf(-density[channel])
            + descriptor.flare_or_black_offset[channel]
    }))
}

/// Compatibility adapter for the existing Negative Lab `negative_log_density_v1`
/// path. It keeps the legacy scalar API while routing the equation and floor
/// through the shared descriptor.
pub fn negative_log_density_channel(value: f32) -> f32 {
    let descriptor = DensityTransformDescriptorV1::negative_transmittance([1.0; 3], [0.0; 3]);
    signal_to_density([f64::from(value); 3], &descriptor)
        .map(|density| density[0] as f32)
        .unwrap_or(f32::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_log_density_round_trips_reference_values() {
        let descriptor =
            DensityTransformDescriptorV1::negative_transmittance([1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        for (density, signal) in [(0.0, 1.0), (1.0, 0.1), (2.0, 0.01)] {
            let measured = signal_to_density([signal; 3], &descriptor).unwrap();
            assert!((measured[0] - density).abs() < 1.0e-12);
            let restored = density_to_signal(measured, &descriptor).unwrap();
            assert!((restored[0] - signal).abs() < 1.0e-12);
        }
    }

    #[test]
    fn floor_and_non_finite_inputs_fail_closed() {
        let descriptor =
            DensityTransformDescriptorV1::negative_transmittance([1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        let clamped = signal_to_density([0.0, 0.0, 0.0], &descriptor).unwrap();
        assert!((clamped[0] - 6.0).abs() < 1.0e-12);
        assert!(signal_to_density([f64::NAN; 3], &descriptor).is_err());
        assert!(density_to_signal([-1.0, 0.0, 0.0], &descriptor).is_err());
    }
}
