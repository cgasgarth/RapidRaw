use serde::{Deserialize, Serialize};

const fn default_iso_r_grade() -> f32 {
    1.0
}
const fn default_anchor_density() -> f32 {
    0.5
}
const fn default_density_offset() -> f32 {
    0.0
}
const fn default_d_min() -> f32 {
    0.04
}
const fn default_d_max() -> f32 {
    1.65
}
const fn default_toe_width() -> f32 {
    0.25
}
const fn default_shoulder_width() -> f32 {
    0.25
}
const fn default_toe_strength() -> f32 {
    0.25
}
const fn default_shoulder_strength() -> f32 {
    0.25
}
const fn default_midtone_shape() -> f32 {
    0.0
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NegativeLabDensityPrintAlgorithm {
    #[default]
    NegativeDensityPrintV2,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct NegativeLabHdPaperCurveParams {
    pub iso_r_grade: f32,
    pub anchor_density: f32,
    pub density_offset: f32,
    pub d_min: f32,
    pub d_max: f32,
    pub toe_width: f32,
    pub shoulder_width: f32,
    pub toe_strength: f32,
    pub shoulder_strength: f32,
    pub midtone_shape: f32,
    pub algorithm_version: u8,
    pub schema_version: u8,
    pub output_domain: String,
}

fn default_output_domain() -> String {
    "scene_linear_print".to_string()
}

impl Default for NegativeLabHdPaperCurveParams {
    fn default() -> Self {
        Self {
            iso_r_grade: default_iso_r_grade(),
            anchor_density: default_anchor_density(),
            density_offset: default_density_offset(),
            d_min: default_d_min(),
            d_max: default_d_max(),
            toe_width: default_toe_width(),
            shoulder_width: default_shoulder_width(),
            toe_strength: default_toe_strength(),
            shoulder_strength: default_shoulder_strength(),
            midtone_shape: default_midtone_shape(),
            algorithm_version: 1,
            schema_version: 2,
            output_domain: default_output_domain(),
        }
    }
}

impl NegativeLabHdPaperCurveParams {
    pub fn validate_current_contract(&self) -> Result<(), String> {
        let finite_in = |name: &str, value: f32, min: f32, max: f32| {
            if !value.is_finite() || !(min..=max).contains(&value) {
                Err(format!(
                    "Negative Lab density-print {name} must be finite and within [{min}, {max}]."
                ))
            } else {
                Ok(())
            }
        };

        finite_in("iso_r_grade", self.iso_r_grade, 0.5, 3.0)?;
        finite_in("anchor_density", self.anchor_density, 0.0, 1.0)?;
        finite_in("density_offset", self.density_offset, -0.5, 0.5)?;
        finite_in("d_min", self.d_min, 0.0, 1.0)?;
        finite_in("d_max", self.d_max, 1.1, 3.0)?;
        finite_in("toe_width", self.toe_width, 0.01, 0.5)?;
        finite_in("shoulder_width", self.shoulder_width, 0.01, 0.5)?;
        finite_in("toe_strength", self.toe_strength, 0.0, 1.0)?;
        finite_in("shoulder_strength", self.shoulder_strength, 0.0, 1.0)?;
        finite_in("midtone_shape", self.midtone_shape, -1.0, 1.0)?;

        if self.d_max - self.d_min < 0.8 {
            return Err(
                "Negative Lab density-print d_max must remain at least 0.8 above d_min."
                    .to_string(),
            );
        }
        if self.algorithm_version != 1 {
            return Err("Negative Lab density-print algorithm_version must be 1.".to_string());
        }
        if self.schema_version != 2 {
            return Err("Negative Lab density-print schema_version must be 2.".to_string());
        }
        if self.output_domain != "scene_linear_print" {
            return Err(
                "Negative Lab density-print output_domain must be scene_linear_print.".to_string(),
            );
        }

        Ok(())
    }

    pub fn sanitized(self) -> Self {
        let defaults = Self::default();
        let finite = |v: f32, fallback: f32| if v.is_finite() { v } else { fallback };
        let d_min = finite(self.d_min, defaults.d_min).clamp(0.0, 1.0);
        let d_max = finite(self.d_max, defaults.d_max).clamp(d_min + 0.8, 3.0);
        Self {
            iso_r_grade: finite(self.iso_r_grade, defaults.iso_r_grade).clamp(0.5, 3.0),
            anchor_density: finite(self.anchor_density, defaults.anchor_density).clamp(0.0, 1.0),
            density_offset: finite(self.density_offset, defaults.density_offset).clamp(-0.5, 0.5),
            d_min,
            d_max,
            toe_width: finite(self.toe_width, defaults.toe_width).clamp(0.01, 0.5),
            shoulder_width: finite(self.shoulder_width, defaults.shoulder_width).clamp(0.01, 0.5),
            toe_strength: finite(self.toe_strength, defaults.toe_strength).clamp(0.0, 1.0),
            shoulder_strength: finite(self.shoulder_strength, defaults.shoulder_strength)
                .clamp(0.0, 1.0),
            midtone_shape: finite(self.midtone_shape, defaults.midtone_shape).clamp(-1.0, 1.0),
            algorithm_version: 1,
            schema_version: 2,
            output_domain: "scene_linear_print".to_string(),
        }
    }
}

/// Converts normalized negative density to scene-linear paper reflectance.
/// This function intentionally has no display transfer function.
pub fn scene_linear_reflectance(
    density_signal: f32,
    params: &NegativeLabHdPaperCurveParams,
) -> f32 {
    let p = params.clone().sanitized();
    let x = (density_signal + p.density_offset).clamp(0.0, 1.0);
    let slope = p.iso_r_grade.max(0.01);
    let centered = ((x - p.anchor_density) * slope + p.anchor_density).clamp(0.0, 1.0);
    let mid = (centered + p.midtone_shape * centered * (1.0 - centered) * 0.45).clamp(0.0, 1.0);
    let toe = (mid / p.toe_width).clamp(0.0, 1.0);
    let toe_curve = mid + (toe.powf(1.0 + p.toe_strength * 1.5) - toe) * p.toe_width;
    let shoulder = ((1.0 - mid) / p.shoulder_width).clamp(0.0, 1.0);
    let shoulder_curve =
        1.0 - ((shoulder.powf(1.0 + p.shoulder_strength * 1.5)) * p.shoulder_width);
    let tone = (toe_curve * (1.0 - mid) + shoulder_curve * mid).clamp(0.0, 1.0);
    let density = p.d_max - tone * (p.d_max - p.d_min);
    10.0_f32.powf(-density).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hd_curve_is_finite_monotone_and_scene_linear() {
        let params = NegativeLabHdPaperCurveParams::default();
        let samples: Vec<f32> = (0..=100)
            .map(|step| scene_linear_reflectance(step as f32 / 100.0, &params))
            .collect();
        assert!(
            samples
                .iter()
                .all(|value| value.is_finite() && *value >= 0.0 && *value <= 1.0)
        );
        assert!(samples.windows(2).all(|pair| pair[1] >= pair[0]));
        assert!((samples[0] - 10.0_f32.powf(-params.d_max)).abs() < 0.02);
        assert!((samples[100] - 10.0_f32.powf(-params.d_min)).abs() < 0.02);
    }

    #[test]
    fn current_contract_rejects_missing_and_invalid_fields_without_defaulting() {
        let complete = serde_json::to_value(NegativeLabHdPaperCurveParams::default())
            .expect("serialize complete density-print params");

        for field in [
            "iso_r_grade",
            "anchor_density",
            "density_offset",
            "d_min",
            "d_max",
            "toe_width",
            "shoulder_width",
            "toe_strength",
            "shoulder_strength",
            "midtone_shape",
            "algorithm_version",
            "schema_version",
            "output_domain",
        ] {
            let mut incomplete = complete.clone();
            incomplete
                .as_object_mut()
                .expect("density-print params object")
                .remove(field);
            assert!(
                serde_json::from_value::<NegativeLabHdPaperCurveParams>(incomplete).is_err(),
                "missing {field} must be rejected"
            );
        }

        let invalid = NegativeLabHdPaperCurveParams {
            iso_r_grade: f32::NAN,
            ..NegativeLabHdPaperCurveParams::default()
        };
        assert!(invalid.validate_current_contract().is_err());
        let invalid = NegativeLabHdPaperCurveParams {
            schema_version: 1,
            ..NegativeLabHdPaperCurveParams::default()
        };
        assert!(invalid.validate_current_contract().is_err());
        let invalid = NegativeLabHdPaperCurveParams {
            output_domain: "display_referred".to_string(),
            ..NegativeLabHdPaperCurveParams::default()
        };
        assert!(invalid.validate_current_contract().is_err());
    }
}
