use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const RAPID_VIEW_IMPLEMENTATION_VERSION: u32 = 1;
const AP1_LUMA: [f64; 3] = [0.272_228_72, 0.674_081_74, 0.053_689_52];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewTransformProcess {
    LegacyBasicV1,
    LegacyAgxV1,
    RapidViewV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewColorStrategy {
    LuminanceRatio,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewTransformSettingsV1 {
    pub process: ViewTransformProcess,
    pub middle_grey: f64,
    pub source_black_ev: f64,
    pub source_white_ev: f64,
    pub contrast: f64,
    pub latitude: f64,
    pub toe: f64,
    pub shoulder: f64,
    pub target_black_linear: f64,
    pub target_white_linear: f64,
    pub color_strategy: ViewColorStrategy,
    pub chroma_compression: f64,
}

impl Default for ViewTransformSettingsV1 {
    fn default() -> Self {
        Self {
            process: ViewTransformProcess::RapidViewV1,
            middle_grey: 0.18,
            source_black_ev: -10.0,
            source_white_ev: 6.5,
            contrast: 1.15,
            latitude: 0.55,
            toe: 0.35,
            shoulder: 0.5,
            target_black_linear: 0.0,
            target_white_linear: 1.0,
            color_strategy: ViewColorStrategy::LuminanceRatio,
            chroma_compression: 0.25,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewTransformPlanV1 {
    pub process: ViewTransformProcess,
    pub scene_grey: f32,
    pub source_black_ev: f32,
    pub source_white_ev: f32,
    pub target_black_linear: f32,
    pub target_white_linear: f32,
    pub toe_width_ev: f32,
    pub shoulder_width_ev: f32,
    pub exposure_scale: f32,
    pub output_power: f32,
    pub chroma_compression: f32,
    pub color_strategy: ViewColorStrategy,
    pub fingerprint: u64,
    pub implementation_version: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(any(test, feature = "validation-harness")), allow(dead_code))]
pub struct ViewTransformReceiptV1 {
    pub contract: String,
    pub process: ViewTransformProcess,
    pub implementation_version: u32,
    pub fingerprint: String,
    pub source_black_ev: f32,
    pub source_white_ev: f32,
    pub target_black_linear: f32,
    pub target_white_linear: f32,
    pub color_strategy: ViewColorStrategy,
}

impl ViewTransformPlanV1 {
    pub fn compile(settings: ViewTransformSettingsV1) -> Result<Self, String> {
        validate_settings(settings)?;
        if settings.process != ViewTransformProcess::RapidViewV1 {
            return Err("view_transform_legacy_process_requires_legacy_executor".to_string());
        }
        let span = settings.source_white_ev - settings.source_black_ev;
        let latitude = settings.latitude.clamp(0.0, 1.0);
        let toe_width_ev = (0.12 + settings.toe * 1.35 + (1.0 - latitude) * 0.35).min(span * 0.2);
        let shoulder_width_ev =
            (0.12 + settings.shoulder * 1.6 + (1.0 - latitude) * 0.45).min(span * 0.2);
        let exposure_scale = settings.contrast;
        let grey_q = normalized_curve_position(
            0.0,
            settings.source_black_ev,
            settings.source_white_ev,
            toe_width_ev,
            shoulder_width_ev,
            exposure_scale,
        );
        let target_grey_position = ((settings.middle_grey - settings.target_black_linear)
            / (settings.target_white_linear - settings.target_black_linear))
            .clamp(1.0e-6, 1.0 - 1.0e-6);
        if !(0.0..1.0).contains(&grey_q) {
            return Err("view_transform_invalid_compiled_grey_position".to_string());
        }
        let output_power = target_grey_position.ln() / grey_q.ln();
        if !output_power.is_finite() || output_power <= 0.0 {
            return Err("view_transform_invalid_output_power".to_string());
        }
        let canonical = serde_json::to_vec(&settings)
            .map_err(|error| format!("view_transform_settings_encode:{error}"))?;
        let digest = Sha256::digest(canonical);
        let fingerprint = u64::from_le_bytes(digest[..8].try_into().expect("sha256 prefix"));
        Ok(Self {
            process: settings.process,
            scene_grey: settings.middle_grey as f32,
            source_black_ev: settings.source_black_ev as f32,
            source_white_ev: settings.source_white_ev as f32,
            target_black_linear: settings.target_black_linear as f32,
            target_white_linear: settings.target_white_linear as f32,
            toe_width_ev: toe_width_ev as f32,
            shoulder_width_ev: shoulder_width_ev as f32,
            exposure_scale: exposure_scale as f32,
            output_power: output_power as f32,
            chroma_compression: settings.chroma_compression as f32,
            color_strategy: settings.color_strategy,
            fingerprint,
            implementation_version: RAPID_VIEW_IMPLEMENTATION_VERSION,
        })
    }

    #[cfg_attr(not(any(test, feature = "validation-harness")), allow(dead_code))]
    pub fn receipt(self) -> ViewTransformReceiptV1 {
        ViewTransformReceiptV1 {
            contract: "rapidraw.view-transform-receipt.v1".to_string(),
            process: self.process,
            implementation_version: self.implementation_version,
            fingerprint: format!("{:016x}", self.fingerprint),
            source_black_ev: self.source_black_ev,
            source_white_ev: self.source_white_ev,
            target_black_linear: self.target_black_linear,
            target_white_linear: self.target_white_linear,
            color_strategy: self.color_strategy,
        }
    }

    pub fn apply_rgb(self, rgb: [f32; 3]) -> [f32; 3] {
        apply_rgb_f32(self, rgb)
    }

    pub fn gpu_parameters(self) -> [[f32; 4]; 3] {
        [
            [
                self.scene_grey,
                self.source_black_ev,
                self.source_white_ev,
                self.target_black_linear,
            ],
            [
                self.target_white_linear,
                self.toe_width_ev,
                self.shoulder_width_ev,
                self.exposure_scale,
            ],
            [
                self.output_power,
                self.chroma_compression,
                f32::from_bits(self.fingerprint as u32),
                f32::from_bits((self.fingerprint >> 32) as u32),
            ],
        ]
    }
}

fn validate_settings(settings: ViewTransformSettingsV1) -> Result<(), String> {
    let values = [
        settings.middle_grey,
        settings.source_black_ev,
        settings.source_white_ev,
        settings.contrast,
        settings.latitude,
        settings.toe,
        settings.shoulder,
        settings.target_black_linear,
        settings.target_white_linear,
        settings.chroma_compression,
    ];
    if values.into_iter().any(|value| !value.is_finite()) {
        return Err("view_transform_non_finite_setting".to_string());
    }
    if !(0.08..=0.3).contains(&settings.middle_grey) {
        return Err("view_transform_middle_grey_out_of_range".to_string());
    }
    if settings.source_black_ev >= -1.0
        || settings.source_white_ev <= 1.0
        || settings.source_white_ev - settings.source_black_ev < 6.0
    {
        return Err("view_transform_invalid_source_ev_bounds".to_string());
    }
    if !(0.5..=2.0).contains(&settings.contrast)
        || !(0.0..=1.0).contains(&settings.latitude)
        || !(0.0..=1.0).contains(&settings.toe)
        || !(0.0..=1.0).contains(&settings.shoulder)
        || !(0.0..=1.0).contains(&settings.chroma_compression)
    {
        return Err("view_transform_control_out_of_range".to_string());
    }
    if settings.target_black_linear < 0.0
        || settings.target_white_linear <= settings.target_black_linear
        || settings.middle_grey <= settings.target_black_linear
        || settings.middle_grey >= settings.target_white_linear
    {
        return Err("view_transform_invalid_target_range".to_string());
    }
    Ok(())
}

fn softplus(value: f64, width: f64) -> f64 {
    let scaled = value / width;
    if scaled > 40.0 {
        value
    } else if scaled < -40.0 {
        width * scaled.exp()
    } else {
        width * scaled.exp().ln_1p()
    }
}

fn bounded_ev(ev: f64, black: f64, white: f64, toe_width: f64, shoulder_width: f64) -> f64 {
    if ev > (black + white) * 0.5 {
        white - softplus(white - ev, shoulder_width) + softplus(black - ev, toe_width)
    } else {
        black + softplus(ev - black, toe_width) - softplus(ev - white, shoulder_width)
    }
}

fn normalized_curve_position(
    ev: f64,
    black: f64,
    white: f64,
    toe_width: f64,
    shoulder_width: f64,
    exposure_scale: f64,
) -> f64 {
    let scaled_ev = ev * exposure_scale;
    if scaled_ev <= black - 40.0 * toe_width {
        return 0.0;
    }
    if scaled_ev >= white + 40.0 * shoulder_width {
        return 1.0;
    }
    let bounded = bounded_ev(scaled_ev, black, white, toe_width, shoulder_width);
    (bounded - black) / (white - black)
}

#[cfg(test)]
fn scalar_reference(plan: ViewTransformPlanV1, value: f64) -> f64 {
    if value == 0.0 {
        return f64::from(plan.target_black_linear);
    }
    let sign = value.signum();
    let ev = (value.abs() / f64::from(plan.scene_grey)).log2();
    let q = normalized_curve_position(
        ev,
        f64::from(plan.source_black_ev),
        f64::from(plan.source_white_ev),
        f64::from(plan.toe_width_ev),
        f64::from(plan.shoulder_width_ev),
        f64::from(plan.exposure_scale),
    );
    let normalized = q.powf(f64::from(plan.output_power));
    sign * (f64::from(plan.target_black_linear)
        + (f64::from(plan.target_white_linear) - f64::from(plan.target_black_linear)) * normalized)
}

#[cfg(test)]
pub fn apply_rgb_reference(plan: ViewTransformPlanV1, rgb: [f64; 3]) -> [f64; 3] {
    if rgb.into_iter().any(|channel| !channel.is_finite()) {
        return [0.0; 3];
    }
    let luminance = rgb
        .into_iter()
        .zip(AP1_LUMA)
        .map(|(channel, weight)| channel * weight)
        .sum::<f64>();
    if luminance > 1.0e-8 {
        let mapped = scalar_reference(plan, luminance);
        let scaled = rgb.map(|channel| channel * mapped / luminance);
        let headroom = (mapped / f64::from(plan.target_white_linear)).clamp(0.0, 1.0);
        let compression = f64::from(plan.chroma_compression) * smoothstep(0.65, 1.0, headroom);
        scaled.map(|channel| channel + (mapped - channel) * compression)
    } else {
        rgb.map(|channel| scalar_reference(plan, channel))
    }
}

fn apply_rgb_f32(plan: ViewTransformPlanV1, rgb: [f32; 3]) -> [f32; 3] {
    if rgb.into_iter().any(|channel| !channel.is_finite()) {
        return [0.0; 3];
    }
    let luminance = rgb
        .into_iter()
        .zip(AP1_LUMA.map(|value| value as f32))
        .map(|(channel, weight)| channel * weight)
        .sum::<f32>();
    if luminance > 1.0e-8 {
        let mapped = scalar_f32(plan, luminance);
        let scaled = rgb.map(|channel| channel * mapped / luminance);
        let headroom = (mapped / plan.target_white_linear).clamp(0.0, 1.0);
        let compression = plan.chroma_compression * smoothstep_f32(0.65, 1.0, headroom);
        scaled.map(|channel| channel + (mapped - channel) * compression)
    } else {
        rgb.map(|channel| scalar_f32(plan, channel))
    }
}

fn scalar_f32(plan: ViewTransformPlanV1, value: f32) -> f32 {
    if value == 0.0 {
        return plan.target_black_linear;
    }
    let value_sign = value.signum();
    let ev = (value.abs() / plan.scene_grey).log2();
    let scaled_ev = ev * plan.exposure_scale;
    let q = if scaled_ev <= plan.source_black_ev - 16.0 * plan.toe_width_ev {
        0.0
    } else if scaled_ev >= plan.source_white_ev + 16.0 * plan.shoulder_width_ev {
        1.0
    } else {
        let bounded = bounded_ev_f32(
            scaled_ev,
            plan.source_black_ev,
            plan.source_white_ev,
            plan.toe_width_ev,
            plan.shoulder_width_ev,
        );
        (bounded - plan.source_black_ev) / (plan.source_white_ev - plan.source_black_ev)
    };
    value_sign
        * (plan.target_black_linear
            + (plan.target_white_linear - plan.target_black_linear) * q.powf(plan.output_power))
}

fn softplus_f32(value: f32, width: f32) -> f32 {
    let scaled = value / width;
    if scaled > 16.0 {
        value
    } else if scaled < -16.0 {
        width * scaled.exp()
    } else {
        width * (1.0 + scaled.exp()).ln()
    }
}

fn bounded_ev_f32(ev: f32, black: f32, white: f32, toe_width: f32, shoulder_width: f32) -> f32 {
    if ev > (black + white) * 0.5 {
        white - softplus_f32(white - ev, shoulder_width) + softplus_f32(black - ev, toe_width)
    } else {
        black + softplus_f32(ev - black, toe_width) - softplus_f32(ev - white, shoulder_width)
    }
}

#[cfg(test)]
fn smoothstep(edge0: f64, edge1: f64, value: f64) -> f64 {
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn smoothstep_f32(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_plan_is_versioned_stable_and_places_middle_grey() {
        let first = ViewTransformPlanV1::compile(ViewTransformSettingsV1::default()).unwrap();
        let second = ViewTransformPlanV1::compile(ViewTransformSettingsV1::default()).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.implementation_version, 1);
        assert_eq!(
            first.receipt().contract,
            "rapidraw.view-transform-receipt.v1"
        );
        let grey = first.apply_rgb([0.18; 3]);
        assert!((grey[0] - 0.18).abs() < 2.0e-5, "middle grey={grey:?}");
        assert_eq!(grey[0], grey[1]);
        assert_eq!(grey[1], grey[2]);
    }

    #[test]
    fn response_is_monotonic_finite_smooth_and_has_no_premature_white_clip() {
        let plan = ViewTransformPlanV1::compile(ViewTransformSettingsV1::default()).unwrap();
        let mut previous = f32::NEG_INFINITY;
        for index in 0..4097 {
            let ev = -16.0 + index as f32 * (32.0 / 4096.0);
            let value = 0.18 * 2.0_f32.powf(ev);
            let output = plan.apply_rgb([value; 3])[0];
            assert!(output.is_finite());
            assert!(
                output + 2.0e-7 >= previous,
                "non-monotonic at {ev} EV: {previous:.9} -> {output:.9}"
            );
            previous = output;
        }
        let over_range = plan.apply_rgb([16.0, 0.2, -0.1]);
        assert!(over_range[0] > over_range[1]);
        assert!(
            over_range[0] > 1.0,
            "view stage must not channel-clip before gamut fit"
        );

        let h = 1.0e-3;
        for join in [plan.source_black_ev, plan.source_white_ev] {
            let at = |ev: f32| plan.apply_rgb([0.18 * 2.0_f32.powf(ev); 3])[0];
            let left = (at(join) - at(join - h)) / h;
            let right = (at(join + h) - at(join)) / h;
            assert!(
                (left - right).abs() < 0.01,
                "derivative join={join}: {left} vs {right}"
            );
        }
    }

    #[test]
    fn saturated_and_negative_vectors_preserve_order_and_match_f64_reference() {
        let plan = ViewTransformPlanV1::compile(ViewTransformSettingsV1::default()).unwrap();
        let vectors = [
            [-0.2, 0.18, 1.4],
            [4.0, 0.4, 0.08],
            [0.02, 1.8, 0.35],
            [0.0, 0.0, 0.0],
            [-0.3, -0.1, -0.05],
        ];
        for vector in vectors {
            let actual = plan.apply_rgb(vector);
            let expected = apply_rgb_reference(plan, vector.map(f64::from));
            for (actual, expected) in actual.into_iter().zip(expected) {
                assert!(actual.is_finite());
                assert!((f64::from(actual) - expected).abs() < 2.0e-6);
            }
        }
        let saturated = plan.apply_rgb([4.0, 0.4, 0.08]);
        assert!(saturated[0] > saturated[1] && saturated[1] > saturated[2]);
    }

    #[test]
    fn invalid_settings_and_non_finite_pixels_fail_closed() {
        let mut invalid = ViewTransformSettingsV1::default();
        invalid.source_white_ev = invalid.source_black_ev;
        assert_eq!(
            ViewTransformPlanV1::compile(invalid).unwrap_err(),
            "view_transform_invalid_source_ev_bounds"
        );
        let plan = ViewTransformPlanV1::compile(ViewTransformSettingsV1::default()).unwrap();
        assert_eq!(plan.apply_rgb([f32::NAN, 0.2, 0.3]), [0.0; 3]);
    }
}
