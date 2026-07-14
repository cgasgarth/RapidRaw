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
    DensityRgbV1,
    NegativeDensityPrintV2,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct NegativeLabHdPaperCurveParams {
    #[serde(default = "default_iso_r_grade")]
    pub iso_r_grade: f32,
    #[serde(default = "default_anchor_density")]
    pub anchor_density: f32,
    #[serde(default = "default_density_offset")]
    pub density_offset: f32,
    #[serde(default = "default_d_min")]
    pub d_min: f32,
    #[serde(default = "default_d_max")]
    pub d_max: f32,
    #[serde(default = "default_toe_width")]
    pub toe_width: f32,
    #[serde(default = "default_shoulder_width")]
    pub shoulder_width: f32,
    #[serde(default = "default_toe_strength")]
    pub toe_strength: f32,
    #[serde(default = "default_shoulder_strength")]
    pub shoulder_strength: f32,
    #[serde(default = "default_midtone_shape")]
    pub midtone_shape: f32,
    #[serde(default)]
    pub algorithm_version: u8,
    #[serde(default)]
    pub schema_version: u8,
    #[serde(default = "default_output_domain")]
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
}
