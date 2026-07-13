//! DNG 1.7.1 dual-illuminant and DCP hue/saturation-map reference evaluation.

use crate::{ReferenceError, finite, matrix::Matrix3};

pub const DCP_REFERENCE_CONTRACT_ID: &str = "rapidraw.color-reference.dcp.v1";

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ColorTemperatureKelvin(f64);

impl ColorTemperatureKelvin {
    pub fn new(value: f64) -> Result<Self, ReferenceError> {
        finite(&[value])?;
        if value <= 0.0 || !value.recip().is_finite() {
            return Err(ReferenceError::OutOfDomain);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub const fn value(self) -> f64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryPolicy {
    Reject,
    Clamp,
    Extrapolate,
}

/// DNG dual-illuminant interpolation in reciprocal-temperature space.
pub fn interpolate_dual_illuminant_matrix(
    first_temperature: ColorTemperatureKelvin,
    first: Matrix3,
    second_temperature: ColorTemperatureKelvin,
    second: Matrix3,
    target_temperature: ColorTemperatureKelvin,
    boundary_policy: BoundaryPolicy,
) -> Result<Matrix3, ReferenceError> {
    let first_mired = first_temperature.value().recip();
    let second_mired = second_temperature.value().recip();
    let denominator = second_mired - first_mired;
    if denominator == 0.0 {
        return Err(ReferenceError::CoincidentIlluminants);
    }
    let raw_weight = (target_temperature.value().recip() - first_mired) / denominator;
    let weight = apply_boundary(raw_weight, boundary_policy)?;
    Matrix3::new(std::array::from_fn(|row| {
        std::array::from_fn(|column| {
            (second.0[row][column] - first.0[row][column]).mul_add(weight, first.0[row][column])
        })
    }))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HueSatMapDimensions {
    pub hue: usize,
    pub saturation: usize,
    pub value: usize,
}

impl HueSatMapDimensions {
    pub fn new(hue: usize, saturation: usize, value: usize) -> Result<Self, ReferenceError> {
        if hue == 0 || saturation == 0 || value == 0 {
            return Err(ReferenceError::InvalidTableDimensions);
        }
        Ok(Self {
            hue,
            saturation,
            value,
        })
    }

    fn entry_count(self) -> Result<usize, ReferenceError> {
        self.hue
            .checked_mul(self.saturation)
            .and_then(|count| count.checked_mul(self.value))
            .ok_or(ReferenceError::InvalidTableDimensions)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HueSatMapEntry {
    pub hue_shift_degrees: f64,
    pub saturation_scale: f64,
    pub value_scale: f64,
}

impl HueSatMapEntry {
    pub fn new(
        hue_shift_degrees: f64,
        saturation_scale: f64,
        value_scale: f64,
    ) -> Result<Self, ReferenceError> {
        finite(&[hue_shift_degrees, saturation_scale, value_scale])?;
        if saturation_scale < 0.0 || value_scale < 0.0 {
            return Err(ReferenceError::NegativeScale);
        }
        Ok(Self {
            hue_shift_degrees,
            saturation_scale,
            value_scale,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HueSatCoordinates {
    pub hue_degrees: f64,
    pub saturation: f64,
    pub value: f64,
}

/// Evaluated table sample. Extrapolation may intentionally produce signed scales even though
/// stored DCP entries require nonnegative scales.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HueSatMapSample {
    pub hue_shift_degrees: f64,
    pub saturation_scale: f64,
    pub value_scale: f64,
}

impl HueSatMapSample {
    fn new(
        hue_shift_degrees: f64,
        saturation_scale: f64,
        value_scale: f64,
    ) -> Result<Self, ReferenceError> {
        finite(&[hue_shift_degrees, saturation_scale, value_scale])?;
        Ok(Self {
            hue_shift_degrees,
            saturation_scale,
            value_scale,
        })
    }
}

impl HueSatCoordinates {
    pub fn new(hue_degrees: f64, saturation: f64, value: f64) -> Result<Self, ReferenceError> {
        finite(&[hue_degrees, saturation, value])?;
        Ok(Self {
            hue_degrees,
            saturation,
            value,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HueSatMap {
    dimensions: HueSatMapDimensions,
    entries: Vec<HueSatMapEntry>,
}

#[derive(Clone, Copy)]
struct AxisSample {
    lower: usize,
    upper: usize,
    fraction: f64,
}

impl HueSatMap {
    pub fn new(
        dimensions: HueSatMapDimensions,
        entries: Vec<HueSatMapEntry>,
    ) -> Result<Self, ReferenceError> {
        if entries.len() != dimensions.entry_count()? {
            return Err(ReferenceError::InvalidTableLength);
        }
        Ok(Self {
            dimensions,
            entries,
        })
    }

    /// Evaluates DCP data ordered hue-fastest, then saturation, then value.
    /// Hue is always cyclic. Saturation/value use the explicit caller policy.
    pub fn evaluate(
        &self,
        coordinates: HueSatCoordinates,
        boundary_policy: BoundaryPolicy,
    ) -> Result<HueSatMapSample, ReferenceError> {
        let hue = cyclic_axis(coordinates.hue_degrees, self.dimensions.hue);
        let saturation = bounded_axis(
            coordinates.saturation,
            self.dimensions.saturation,
            boundary_policy,
        )?;
        let value = bounded_axis(coordinates.value, self.dimensions.value, boundary_policy)?;
        let corners = [
            (
                hue.lower,
                saturation.lower,
                value.lower,
                (1.0 - hue.fraction) * (1.0 - saturation.fraction) * (1.0 - value.fraction),
            ),
            (
                hue.upper,
                saturation.lower,
                value.lower,
                hue.fraction * (1.0 - saturation.fraction) * (1.0 - value.fraction),
            ),
            (
                hue.lower,
                saturation.upper,
                value.lower,
                (1.0 - hue.fraction) * saturation.fraction * (1.0 - value.fraction),
            ),
            (
                hue.upper,
                saturation.upper,
                value.lower,
                hue.fraction * saturation.fraction * (1.0 - value.fraction),
            ),
            (
                hue.lower,
                saturation.lower,
                value.upper,
                (1.0 - hue.fraction) * (1.0 - saturation.fraction) * value.fraction,
            ),
            (
                hue.upper,
                saturation.lower,
                value.upper,
                hue.fraction * (1.0 - saturation.fraction) * value.fraction,
            ),
            (
                hue.lower,
                saturation.upper,
                value.upper,
                (1.0 - hue.fraction) * saturation.fraction * value.fraction,
            ),
            (
                hue.upper,
                saturation.upper,
                value.upper,
                hue.fraction * saturation.fraction * value.fraction,
            ),
        ];
        let interpolate = |component: fn(HueSatMapEntry) -> f64| {
            corners
                .iter()
                .map(|&(h, s, v, weight)| component(self.entry(h, s, v)) * weight)
                .sum()
        };
        HueSatMapSample::new(
            interpolate(|entry| entry.hue_shift_degrees),
            interpolate(|entry| entry.saturation_scale),
            interpolate(|entry| entry.value_scale),
        )
    }

    fn entry(&self, hue: usize, saturation: usize, value: usize) -> HueSatMapEntry {
        self.entries[hue + self.dimensions.hue * (saturation + self.dimensions.saturation * value)]
    }
}

fn apply_boundary(value: f64, policy: BoundaryPolicy) -> Result<f64, ReferenceError> {
    if (0.0..=1.0).contains(&value) || policy == BoundaryPolicy::Extrapolate {
        Ok(value)
    } else if policy == BoundaryPolicy::Clamp {
        Ok(value.clamp(0.0, 1.0))
    } else {
        Err(ReferenceError::OutOfDomain)
    }
}

fn cyclic_axis(hue_degrees: f64, divisions: usize) -> AxisSample {
    if divisions == 1 {
        return AxisSample {
            lower: 0,
            upper: 0,
            fraction: 0.0,
        };
    }
    let coordinate = hue_degrees.rem_euclid(360.0) / 360.0 * divisions as f64;
    let floor = coordinate.floor();
    let lower = floor as usize % divisions;
    AxisSample {
        lower,
        upper: (lower + 1) % divisions,
        fraction: coordinate - floor,
    }
}

fn bounded_axis(
    value: f64,
    divisions: usize,
    policy: BoundaryPolicy,
) -> Result<AxisSample, ReferenceError> {
    if divisions == 1 {
        if policy == BoundaryPolicy::Reject && !(0.0..=1.0).contains(&value) {
            return Err(ReferenceError::OutOfDomain);
        }
        return Ok(AxisSample {
            lower: 0,
            upper: 0,
            fraction: 0.0,
        });
    }
    let coordinate = apply_boundary(value, policy)? * (divisions - 1) as f64;
    if coordinate <= 0.0 {
        return Ok(AxisSample {
            lower: 0,
            upper: 1,
            fraction: coordinate,
        });
    }
    let last = divisions - 1;
    if coordinate >= last as f64 {
        return Ok(AxisSample {
            lower: last - 1,
            upper: last,
            fraction: coordinate - (last - 1) as f64,
        });
    }
    let lower = coordinate.floor() as usize;
    Ok(AxisSample {
        lower,
        upper: lower + 1,
        fraction: coordinate - lower as f64,
    })
}
