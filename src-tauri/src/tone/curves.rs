use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use serde_json::Value;

pub const CURVE_IMPLEMENTATION_VERSION: u32 = 1;
pub const DEFAULT_CURVE_LUT_SIZE: usize = 4096;
pub const MAX_CURVE_POINTS: usize = 64;
pub const SCENE_EV_MIN: f64 = -16.0;
pub const SCENE_EV_MAX: f64 = 16.0;
pub const DEFAULT_MIDDLE_GREY: f64 = 0.18;
pub const CURVE_GPU_HEADER_FLOATS: usize = 20;

#[derive(Clone, Debug, PartialEq)]
pub enum CurveDomain {
    SceneLog2Ev,
    ViewEncoded,
    OutputEncoded {
        profile_id: Arc<str>,
        reference_white: f64,
        maximum_value: f64,
    },
}

impl CurveDomain {
    fn bounds(&self) -> Result<(f64, f64)> {
        match self {
            Self::SceneLog2Ev => Ok((SCENE_EV_MIN, SCENE_EV_MAX)),
            Self::ViewEncoded => Ok((0.0, 1.0)),
            Self::OutputEncoded {
                reference_white,
                maximum_value,
                ..
            } if reference_white.is_finite()
                && *reference_white > 0.0
                && maximum_value.is_finite()
                && *maximum_value >= *reference_white =>
            {
                Ok((0.0, *maximum_value))
            }
            Self::OutputEncoded { .. } => bail!("curve_output_domain_invalid_range"),
        }
    }

    fn fingerprint_bytes(&self, output: &mut Vec<u8>) {
        match self {
            Self::SceneLog2Ev => output.extend_from_slice(b"scene_log2_ev"),
            Self::ViewEncoded => output.extend_from_slice(b"view_encoded"),
            Self::OutputEncoded {
                profile_id,
                reference_white,
                maximum_value,
            } => {
                output.extend_from_slice(b"output_encoded");
                output.extend_from_slice(profile_id.as_bytes());
                output.extend_from_slice(&reference_white.to_bits().to_le_bytes());
                output.extend_from_slice(&maximum_value.to_bits().to_le_bytes());
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurveChannelMode {
    LuminancePreserving,
    LinkedRgb,
    IndependentRgb,
    Red,
    Green,
    Blue,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurveInterpolation {
    MonotoneCubic,
    Linear,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CurveExtrapolation {
    LinearTangent,
    Constant,
    SoftRollOff { strength: f64 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurveColorPreservation {
    LuminanceRatio,
    MaxRgbRatio,
    None,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurvePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub struct CurveCompileRequest {
    pub domain: CurveDomain,
    pub channel_mode: CurveChannelMode,
    pub interpolation: CurveInterpolation,
    pub middle_grey: f64,
    pub points: Vec<CurvePoint>,
    pub low_extrapolation: CurveExtrapolation,
    pub high_extrapolation: CurveExtrapolation,
    pub preserve_color: CurveColorPreservation,
    pub lut_size: usize,
}

#[derive(Clone, Debug)]
pub struct CompiledCurvePlanV1 {
    pub domain: CurveDomain,
    pub channel_mode: CurveChannelMode,
    pub interpolation: CurveInterpolation,
    pub middle_grey: f64,
    pub points: Arc<[CurvePoint]>,
    pub tangents: Arc<[f64]>,
    pub lut: Arc<[f32]>,
    pub lut_min: f64,
    pub lut_max: f64,
    pub low_extrapolation: CurveExtrapolation,
    pub high_extrapolation: CurveExtrapolation,
    pub preserve_color: CurveColorPreservation,
    pub fingerprint: u64,
    pub implementation_version: u32,
}

impl CurveCompileRequest {
    pub fn scene_identity() -> Self {
        Self {
            domain: CurveDomain::SceneLog2Ev,
            channel_mode: CurveChannelMode::LuminancePreserving,
            interpolation: CurveInterpolation::MonotoneCubic,
            middle_grey: DEFAULT_MIDDLE_GREY,
            points: vec![
                CurvePoint {
                    x: SCENE_EV_MIN,
                    y: SCENE_EV_MIN,
                },
                CurvePoint { x: 0.0, y: 0.0 },
                CurvePoint {
                    x: SCENE_EV_MAX,
                    y: SCENE_EV_MAX,
                },
            ],
            low_extrapolation: CurveExtrapolation::LinearTangent,
            high_extrapolation: CurveExtrapolation::LinearTangent,
            preserve_color: CurveColorPreservation::LuminanceRatio,
            lut_size: DEFAULT_CURVE_LUT_SIZE,
        }
    }

    pub fn output_identity(profile_id: impl Into<Arc<str>>, maximum_value: f64) -> Self {
        Self {
            domain: CurveDomain::OutputEncoded {
                profile_id: profile_id.into(),
                reference_white: 1.0,
                maximum_value,
            },
            channel_mode: CurveChannelMode::LinkedRgb,
            interpolation: CurveInterpolation::MonotoneCubic,
            middle_grey: DEFAULT_MIDDLE_GREY,
            points: vec![
                CurvePoint { x: 0.0, y: 0.0 },
                CurvePoint {
                    x: maximum_value,
                    y: maximum_value,
                },
            ],
            low_extrapolation: CurveExtrapolation::LinearTangent,
            high_extrapolation: CurveExtrapolation::LinearTangent,
            preserve_color: CurveColorPreservation::None,
            lut_size: DEFAULT_CURVE_LUT_SIZE,
        }
    }
}

fn parse_channel_mode(
    value: Option<&Value>,
    default: CurveChannelMode,
) -> Result<CurveChannelMode> {
    match value.and_then(Value::as_str) {
        None => Ok(default),
        Some("luminance_preserving") => Ok(CurveChannelMode::LuminancePreserving),
        Some("linked_rgb") => Ok(CurveChannelMode::LinkedRgb),
        Some("independent_rgb") => Ok(CurveChannelMode::IndependentRgb),
        Some("red") => Ok(CurveChannelMode::Red),
        Some("green") => Ok(CurveChannelMode::Green),
        Some("blue") => Ok(CurveChannelMode::Blue),
        Some(_) => bail!("curve_channel_mode_unsupported"),
    }
}

fn parse_interpolation(value: Option<&Value>) -> Result<CurveInterpolation> {
    match value.and_then(Value::as_str) {
        None | Some("monotone_cubic") => Ok(CurveInterpolation::MonotoneCubic),
        Some("linear") => Ok(CurveInterpolation::Linear),
        Some(_) => bail!("curve_interpolation_unsupported"),
    }
}

fn parse_extrapolation(value: Option<&Value>) -> Result<CurveExtrapolation> {
    let Some(value) = value else {
        return Ok(CurveExtrapolation::LinearTangent);
    };
    if let Some(name) = value.as_str() {
        return match name {
            "linear_tangent" => Ok(CurveExtrapolation::LinearTangent),
            "constant" => Ok(CurveExtrapolation::Constant),
            _ => Err(anyhow!("curve_extrapolation_unsupported")),
        };
    }
    let strength = value
        .get("softRollOffStrength")
        .and_then(Value::as_f64)
        .ok_or_else(|| anyhow!("curve_extrapolation_invalid"))?;
    Ok(CurveExtrapolation::SoftRollOff { strength })
}

fn parse_preserve_color(
    value: Option<&Value>,
    default: CurveColorPreservation,
) -> Result<CurveColorPreservation> {
    match value.and_then(Value::as_str) {
        None => Ok(default),
        Some("luminance_ratio") => Ok(CurveColorPreservation::LuminanceRatio),
        Some("max_rgb_ratio") => Ok(CurveColorPreservation::MaxRgbRatio),
        Some("none") => Ok(CurveColorPreservation::None),
        Some(_) => bail!("curve_color_preservation_unsupported"),
    }
}

fn parse_points(value: &Value, x_key: &str, y_key: &str) -> Result<Vec<CurvePoint>> {
    value
        .as_array()
        .ok_or_else(|| anyhow!("curve_points_not_array"))?
        .iter()
        .map(|point| {
            Ok(CurvePoint {
                x: point
                    .get(x_key)
                    .and_then(Value::as_f64)
                    .ok_or_else(|| anyhow!("curve_point_x_invalid"))?,
                y: point
                    .get(y_key)
                    .and_then(Value::as_f64)
                    .ok_or_else(|| anyhow!("curve_point_y_invalid"))?,
            })
        })
        .collect()
}

pub fn compile_scene_curve_from_adjustments(
    adjustments: &Value,
) -> Result<Option<CompiledCurvePlanV1>> {
    let Some(curve) = adjustments.get("sceneCurve") else {
        return Ok(None);
    };
    if curve.get("enabled").and_then(Value::as_bool) == Some(false) {
        return Ok(None);
    }
    let mut request = CurveCompileRequest::scene_identity();
    request.channel_mode = parse_channel_mode(
        curve.get("channelMode"),
        CurveChannelMode::LuminancePreserving,
    )?;
    request.interpolation = parse_interpolation(curve.get("interpolation"))?;
    request.middle_grey = curve
        .get("middleGrey")
        .and_then(Value::as_f64)
        .unwrap_or(DEFAULT_MIDDLE_GREY);
    request.points = parse_points(
        curve
            .get("points")
            .ok_or_else(|| anyhow!("scene_curve_points_missing"))?,
        "xEv",
        "yEv",
    )?;
    request.low_extrapolation = parse_extrapolation(curve.get("lowExtrapolation"))?;
    request.high_extrapolation = parse_extrapolation(curve.get("highExtrapolation"))?;
    request.preserve_color = parse_preserve_color(
        curve.get("preserveColor"),
        CurveColorPreservation::LuminanceRatio,
    )?;
    CompiledCurvePlanV1::compile(request).map(Some)
}

pub fn compile_output_curve_from_adjustments(
    adjustments: &Value,
) -> Result<Option<CompiledCurvePlanV1>> {
    let Some(curve) = adjustments.get("outputCurve") else {
        let Some(conversion) = adjustments.get("legacyCurveConversion") else {
            return Ok(None);
        };
        let samples = conversion
            .get("samples")
            .and_then(Value::as_array)
            .ok_or_else(|| anyhow!("legacy_curve_conversion_samples_missing"))?
            .iter()
            .map(|value| {
                value
                    .as_f64()
                    .map(|sample| sample as f32)
                    .ok_or_else(|| anyhow!("legacy_curve_conversion_sample_invalid"))
            })
            .collect::<Result<Vec<_>>>()?;
        let tolerance = conversion
            .get("maxErrorTolerance")
            .and_then(Value::as_f64)
            .unwrap_or(0.002);
        let profile_id = conversion
            .get("outputProfileId")
            .and_then(Value::as_str)
            .unwrap_or("current_output");
        let (plan, maximum_error, _rms_error) = fit_legacy_output_curve(&samples, profile_id)?;
        if !tolerance.is_finite() || tolerance < 0.0 || maximum_error > tolerance {
            bail!("legacy_curve_conversion_error_exceeds_tolerance");
        }
        return Ok(Some(plan));
    };
    if curve.get("enabled").and_then(Value::as_bool) == Some(false) {
        return Ok(None);
    }
    let maximum_value = curve
        .get("maximumValue")
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    let domain = match curve.get("domain").and_then(Value::as_str) {
        None | Some("output_encoded") => CurveDomain::OutputEncoded {
            profile_id: curve
                .get("outputProfileId")
                .and_then(Value::as_str)
                .unwrap_or("current_output")
                .into(),
            reference_white: curve
                .get("referenceWhite")
                .and_then(Value::as_f64)
                .unwrap_or(1.0),
            maximum_value,
        },
        Some("view_encoded") => CurveDomain::ViewEncoded,
        Some(_) => bail!("output_curve_domain_unsupported"),
    };
    let profile_id = curve
        .get("outputProfileId")
        .and_then(Value::as_str)
        .unwrap_or("current_output");
    let mut request = CurveCompileRequest::output_identity(profile_id, maximum_value);
    request.domain = domain;
    request.channel_mode =
        parse_channel_mode(curve.get("channelMode"), CurveChannelMode::LinkedRgb)?;
    request.interpolation = parse_interpolation(curve.get("interpolation"))?;
    request.points = parse_points(
        curve
            .get("points")
            .ok_or_else(|| anyhow!("output_curve_points_missing"))?,
        "x",
        "y",
    )?;
    request.low_extrapolation = parse_extrapolation(curve.get("lowExtrapolation"))?;
    request.high_extrapolation = parse_extrapolation(curve.get("highExtrapolation"))?;
    request.preserve_color =
        parse_preserve_color(curve.get("preserveColor"), CurveColorPreservation::None)?;
    CompiledCurvePlanV1::compile(request).map(Some)
}

fn validate_extrapolation(extrapolation: CurveExtrapolation) -> Result<()> {
    if let CurveExtrapolation::SoftRollOff { strength } = extrapolation
        && (!strength.is_finite() || strength <= 0.0)
    {
        bail!("curve_soft_rolloff_strength_invalid");
    }
    Ok(())
}

fn validate_and_sort_points(
    mut points: Vec<CurvePoint>,
    interpolation: CurveInterpolation,
) -> Result<Vec<CurvePoint>> {
    if !(2..=MAX_CURVE_POINTS).contains(&points.len()) {
        bail!("curve_point_count_out_of_range");
    }
    if points
        .iter()
        .any(|point| !point.x.is_finite() || !point.y.is_finite())
    {
        bail!("curve_point_non_finite");
    }
    points.sort_by(|left, right| left.x.total_cmp(&right.x));
    for pair in points.windows(2) {
        let scale = pair[0].x.abs().max(pair[1].x.abs()).max(1.0);
        if pair[1].x - pair[0].x <= scale * 1.0e-9 {
            bail!("curve_point_x_duplicate_or_too_close");
        }
        if interpolation == CurveInterpolation::MonotoneCubic && pair[1].y < pair[0].y {
            bail!("curve_monotone_points_descend");
        }
    }
    Ok(points)
}

fn monotone_tangents(points: &[CurvePoint]) -> Vec<f64> {
    let secants = points
        .windows(2)
        .map(|pair| (pair[1].y - pair[0].y) / (pair[1].x - pair[0].x))
        .collect::<Vec<_>>();
    let mut tangents = vec![0.0; points.len()];
    tangents[0] = secants[0];
    tangents[points.len() - 1] = secants[secants.len() - 1];
    for index in 1..points.len() - 1 {
        let before = secants[index - 1];
        let after = secants[index];
        tangents[index] = if before * after <= 0.0 {
            0.0
        } else {
            let before_width = points[index].x - points[index - 1].x;
            let after_width = points[index + 1].x - points[index].x;
            let first_weight = 2.0 * after_width + before_width;
            let second_weight = after_width + 2.0 * before_width;
            (first_weight + second_weight) / (first_weight / before + second_weight / after)
        };
    }
    for index in 0..secants.len() {
        let secant = secants[index];
        if secant == 0.0 {
            tangents[index] = 0.0;
            tangents[index + 1] = 0.0;
            continue;
        }
        let alpha = tangents[index] / secant;
        let beta = tangents[index + 1] / secant;
        let magnitude = alpha * alpha + beta * beta;
        if magnitude > 9.0 {
            let scale = 3.0 / magnitude.sqrt();
            tangents[index] = scale * alpha * secant;
            tangents[index + 1] = scale * beta * secant;
        }
    }
    tangents
}

fn linear_tangents(points: &[CurvePoint]) -> Vec<f64> {
    let mut tangents = Vec::with_capacity(points.len());
    for index in 0..points.len() {
        let pair = if index + 1 < points.len() {
            [points[index], points[index + 1]]
        } else {
            [points[index - 1], points[index]]
        };
        tangents.push((pair[1].y - pair[0].y) / (pair[1].x - pair[0].x));
    }
    tangents
}

fn evaluate_segment(
    interpolation: CurveInterpolation,
    left: CurvePoint,
    right: CurvePoint,
    left_tangent: f64,
    right_tangent: f64,
    x: f64,
) -> f64 {
    let width = right.x - left.x;
    let t = ((x - left.x) / width).clamp(0.0, 1.0);
    if interpolation == CurveInterpolation::Linear {
        return left.y + (right.y - left.y) * t;
    }
    let t2 = t * t;
    let t3 = t2 * t;
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;
    h00 * left.y + h10 * left_tangent * width + h01 * right.y + h11 * right_tangent * width
}

fn extrapolate(point: CurvePoint, tangent: f64, x: f64, mode: CurveExtrapolation) -> f64 {
    let distance = x - point.x;
    match mode {
        CurveExtrapolation::LinearTangent => point.y + tangent * distance,
        CurveExtrapolation::Constant => point.y,
        CurveExtrapolation::SoftRollOff { strength } => {
            point.y + tangent * distance.signum() * (distance.abs() * strength).ln_1p() / strength
        }
    }
}

impl CompiledCurvePlanV1 {
    pub fn compile(request: CurveCompileRequest) -> Result<Self> {
        if !request.middle_grey.is_finite() || request.middle_grey <= 0.0 {
            bail!("curve_middle_grey_invalid");
        }
        if !(256..=65_536).contains(&request.lut_size) {
            bail!("curve_lut_size_out_of_range");
        }
        validate_extrapolation(request.low_extrapolation)?;
        validate_extrapolation(request.high_extrapolation)?;
        let (lut_min, lut_max) = request.domain.bounds()?;
        let points = validate_and_sort_points(request.points, request.interpolation)?;
        let tangents = match request.interpolation {
            CurveInterpolation::MonotoneCubic => monotone_tangents(&points),
            CurveInterpolation::Linear => linear_tangents(&points),
        };
        let mut plan = Self {
            domain: request.domain,
            channel_mode: request.channel_mode,
            interpolation: request.interpolation,
            middle_grey: request.middle_grey,
            points: points.into(),
            tangents: tangents.into(),
            lut: Arc::new([]),
            lut_min,
            lut_max,
            low_extrapolation: request.low_extrapolation,
            high_extrapolation: request.high_extrapolation,
            preserve_color: request.preserve_color,
            fingerprint: 0,
            implementation_version: CURVE_IMPLEMENTATION_VERSION,
        };
        let denominator = (request.lut_size - 1) as f64;
        plan.lut = (0..request.lut_size)
            .map(|index| {
                let x = lut_min + (lut_max - lut_min) * index as f64 / denominator;
                plan.evaluate_analytic(x) as f32
            })
            .collect::<Vec<_>>()
            .into();
        plan.fingerprint = plan.compute_fingerprint();
        Ok(plan)
    }

    pub fn evaluate_analytic(&self, x: f64) -> f64 {
        if !x.is_finite() {
            return x;
        }
        let first = self.points[0];
        let last_index = self.points.len() - 1;
        let last = self.points[last_index];
        if x < first.x {
            return extrapolate(first, self.tangents[0], x, self.low_extrapolation);
        }
        if x > last.x {
            return extrapolate(last, self.tangents[last_index], x, self.high_extrapolation);
        }
        let right = self.points.partition_point(|point| point.x < x);
        if right == 0 {
            return first.y;
        }
        if right >= self.points.len() {
            return last.y;
        }
        evaluate_segment(
            self.interpolation,
            self.points[right - 1],
            self.points[right],
            self.tangents[right - 1],
            self.tangents[right],
            x,
        )
    }

    pub fn evaluate_lut(&self, x: f64) -> f64 {
        if !x.is_finite() || x < self.lut_min || x > self.lut_max {
            return self.evaluate_analytic(x);
        }
        let normalized = (x - self.lut_min) / (self.lut_max - self.lut_min);
        let position = normalized * (self.lut.len() - 1) as f64;
        let left = position.floor() as usize;
        let right = (left + 1).min(self.lut.len() - 1);
        let fraction = position - left as f64;
        self.lut[left] as f64 + (self.lut[right] as f64 - self.lut[left] as f64) * fraction
    }

    pub fn apply_rgb(&self, rgb: [f32; 3]) -> [f32; 3] {
        if rgb.iter().any(|channel| !channel.is_finite()) {
            return rgb;
        }
        match (&self.domain, self.channel_mode) {
            (CurveDomain::SceneLog2Ev, CurveChannelMode::LuminancePreserving) => {
                self.apply_scene_luminance(rgb)
            }
            (CurveDomain::SceneLog2Ev, CurveChannelMode::LinkedRgb)
            | (CurveDomain::SceneLog2Ev, CurveChannelMode::IndependentRgb) => {
                rgb.map(|channel| self.apply_scene_channel(channel))
            }
            (CurveDomain::SceneLog2Ev, CurveChannelMode::Red) => {
                [self.apply_scene_channel(rgb[0]), rgb[1], rgb[2]]
            }
            (CurveDomain::SceneLog2Ev, CurveChannelMode::Green) => {
                [rgb[0], self.apply_scene_channel(rgb[1]), rgb[2]]
            }
            (CurveDomain::SceneLog2Ev, CurveChannelMode::Blue) => {
                [rgb[0], rgb[1], self.apply_scene_channel(rgb[2])]
            }
            (_, CurveChannelMode::LuminancePreserving) => self.apply_encoded_luminance(rgb),
            (_, CurveChannelMode::Red) => {
                [self.evaluate_lut(f64::from(rgb[0])) as f32, rgb[1], rgb[2]]
            }
            (_, CurveChannelMode::Green) => {
                [rgb[0], self.evaluate_lut(f64::from(rgb[1])) as f32, rgb[2]]
            }
            (_, CurveChannelMode::Blue) => {
                [rgb[0], rgb[1], self.evaluate_lut(f64::from(rgb[2])) as f32]
            }
            (_, CurveChannelMode::LinkedRgb | CurveChannelMode::IndependentRgb) => {
                rgb.map(|channel| self.evaluate_lut(f64::from(channel)) as f32)
            }
        }
    }

    pub fn gpu_storage_payload(&self) -> Vec<f32> {
        let (low_mode, low_strength) = extrapolation_gpu_values(self.low_extrapolation);
        let (high_mode, high_strength) = extrapolation_gpu_values(self.high_extrapolation);
        let domain = if matches!(self.domain, CurveDomain::SceneLog2Ev) {
            0.0
        } else {
            1.0
        };
        let mode = match self.channel_mode {
            CurveChannelMode::LuminancePreserving => 0.0,
            CurveChannelMode::LinkedRgb => 1.0,
            CurveChannelMode::IndependentRgb => 2.0,
            CurveChannelMode::Red => 3.0,
            CurveChannelMode::Green => 4.0,
            CurveChannelMode::Blue => 5.0,
        };
        let preserve = match self.preserve_color {
            CurveColorPreservation::LuminanceRatio => 0.0,
            CurveColorPreservation::MaxRgbRatio => 1.0,
            CurveColorPreservation::None => 2.0,
        };
        let first = self.points[0];
        let last_index = self.points.len() - 1;
        let last = self.points[last_index];
        let mut payload = Vec::with_capacity(CURVE_GPU_HEADER_FLOATS + self.lut.len());
        payload.extend_from_slice(&[
            1.0,
            domain,
            mode,
            self.middle_grey as f32,
            self.lut_min as f32,
            self.lut_max as f32,
            self.lut.len() as f32,
            preserve,
            first.x as f32,
            first.y as f32,
            self.tangents[0] as f32,
            last.x as f32,
            last.y as f32,
            self.tangents[last_index] as f32,
            low_mode,
            low_strength,
            high_mode,
            high_strength,
            0.0,
            0.0,
        ]);
        payload.extend_from_slice(&self.lut);
        payload
    }

    fn apply_scene_channel(&self, channel: f32) -> f32 {
        if channel <= 0.0 {
            channel
        } else {
            let ev = (f64::from(channel) / self.middle_grey).log2();
            (self.middle_grey * 2.0_f64.powf(self.evaluate_lut(ev))) as f32
        }
    }

    fn apply_scene_luminance(&self, rgb: [f32; 3]) -> [f32; 3] {
        let luminance = f64::from(rgb[0]) * 0.272_228_72
            + f64::from(rgb[1]) * 0.674_081_74
            + f64::from(rgb[2]) * 0.053_689_52;
        if luminance <= 1.0e-12 {
            return rgb;
        }
        let reference = match self.preserve_color {
            CurveColorPreservation::MaxRgbRatio => rgb
                .iter()
                .copied()
                .fold(f32::NEG_INFINITY, f32::max)
                .max(1.0e-12) as f64,
            CurveColorPreservation::LuminanceRatio | CurveColorPreservation::None => luminance,
        };
        let ev = (reference / self.middle_grey).log2();
        let mapped = self.middle_grey * 2.0_f64.powf(self.evaluate_lut(ev));
        let scale = (mapped / reference).clamp(0.0, f32::MAX as f64) as f32;
        rgb.map(|channel| channel * scale)
    }

    fn apply_encoded_luminance(&self, rgb: [f32; 3]) -> [f32; 3] {
        let luminance =
            f64::from(rgb[0]) * 0.2126 + f64::from(rgb[1]) * 0.7152 + f64::from(rgb[2]) * 0.0722;
        if luminance.abs() <= 1.0e-12 {
            return rgb;
        }
        let mapped = self.evaluate_lut(luminance);
        let scale = (mapped / luminance).clamp(-f32::MAX as f64, f32::MAX as f64) as f32;
        rgb.map(|channel| channel * scale)
    }

    fn compute_fingerprint(&self) -> u64 {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&CURVE_IMPLEMENTATION_VERSION.to_le_bytes());
        self.domain.fingerprint_bytes(&mut bytes);
        bytes.push(self.channel_mode as u8);
        bytes.push(self.interpolation as u8);
        bytes.push(self.preserve_color as u8);
        bytes.extend_from_slice(&self.middle_grey.to_bits().to_le_bytes());
        for point in self.points.iter() {
            bytes.extend_from_slice(&point.x.to_bits().to_le_bytes());
            bytes.extend_from_slice(&point.y.to_bits().to_le_bytes());
        }
        let digest = blake3::hash(&bytes);
        u64::from_le_bytes(
            digest.as_bytes()[..8]
                .try_into()
                .expect("eight digest bytes"),
        )
    }
}

fn extrapolation_gpu_values(extrapolation: CurveExtrapolation) -> (f32, f32) {
    match extrapolation {
        CurveExtrapolation::LinearTangent => (0.0, 0.0),
        CurveExtrapolation::Constant => (1.0, 0.0),
        CurveExtrapolation::SoftRollOff { strength } => (2.0, strength as f32),
    }
}

pub fn fit_legacy_output_curve(
    legacy_samples: &[f32],
    profile_id: impl Into<Arc<str>>,
) -> Result<(CompiledCurvePlanV1, f64, f64)> {
    if legacy_samples.len() < 2 || legacy_samples.iter().any(|value| !value.is_finite()) {
        bail!("legacy_curve_samples_invalid");
    }
    let denominator = (legacy_samples.len() - 1) as f64;
    let mut request = CurveCompileRequest::output_identity(profile_id, 1.0);
    request.points = legacy_samples
        .iter()
        .enumerate()
        .map(|(index, value)| CurvePoint {
            x: index as f64 / denominator,
            y: f64::from(*value),
        })
        .collect();
    let plan = CompiledCurvePlanV1::compile(request)?;
    let errors = legacy_samples
        .iter()
        .enumerate()
        .map(|(index, expected)| {
            let x = index as f64 / denominator;
            (plan.evaluate_lut(x) - f64::from(*expected)).abs()
        })
        .collect::<Vec<_>>();
    let max_error = errors.iter().copied().fold(0.0, f64::max);
    let rms_error =
        (errors.iter().map(|error| error * error).sum::<f64>() / errors.len() as f64).sqrt();
    if !max_error.is_finite() || !rms_error.is_finite() {
        return Err(anyhow!("legacy_curve_fit_error_non_finite"));
    }
    Ok((plan, max_error, rms_error))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene_curve(points: &[(f64, f64)]) -> CompiledCurvePlanV1 {
        let mut request = CurveCompileRequest::scene_identity();
        request.points = points
            .iter()
            .map(|(x, y)| CurvePoint { x: *x, y: *y })
            .collect();
        CompiledCurvePlanV1::compile(request).unwrap()
    }

    #[test]
    fn identity_is_exact_at_points_and_unbounded_outside_endpoints() {
        let plan = scene_curve(&[(-4.0, -4.0), (0.0, 0.0), (4.0, 4.0)]);
        for value in [-12.0, -4.0, -1.0, 0.0, 2.0, 4.0, 12.0] {
            assert!((plan.evaluate_analytic(value) - value).abs() < 1.0e-12);
            assert!((plan.evaluate_lut(value) - value).abs() < 1.0e-5);
        }
    }

    #[test]
    fn monotone_curve_never_overshoots_segment_bounds() {
        let plan = scene_curve(&[
            (-8.0, -6.0),
            (-2.0, -1.0),
            (0.0, 0.0),
            (3.0, 1.0),
            (9.0, 4.0),
        ]);
        let mut previous = plan.evaluate_analytic(-8.0);
        for index in 1..=10_000 {
            let x = -8.0 + 17.0 * index as f64 / 10_000.0;
            let value = plan.evaluate_analytic(x);
            assert!(value >= previous - 1.0e-12);
            assert!((-6.0..=4.0).contains(&value));
            previous = value;
        }
    }

    #[test]
    fn lut_meets_declared_approximation_error() {
        let plan = scene_curve(&[
            (-16.0, -12.0),
            (-4.0, -3.0),
            (0.0, 0.0),
            (2.0, 1.3),
            (16.0, 10.0),
        ]);
        let mut maximum_error = 0.0_f64;
        for index in 0..100_000 {
            let x = SCENE_EV_MIN + (SCENE_EV_MAX - SCENE_EV_MIN) * index as f64 / 99_999.0;
            maximum_error =
                maximum_error.max((plan.evaluate_lut(x) - plan.evaluate_analytic(x)).abs());
        }
        assert!(maximum_error < 2.5e-5, "maximum LUT error {maximum_error}");
    }

    #[test]
    fn scene_ev_semantics_are_relative_to_middle_grey() {
        let plan = scene_curve(&[(-16.0, -16.0), (0.0, 0.0), (2.0, 1.0), (16.0, 16.0)]);
        let mapped = plan.apply_rgb([0.72, 0.72, 0.72]);
        for channel in mapped {
            assert!((channel - 0.36).abs() < 2.0e-4);
        }
    }

    #[test]
    fn ap1_luminance_ratio_preserves_hue_and_extended_values() {
        let plan = scene_curve(&[
            (-16.0, -16.0),
            (-2.0, -1.0),
            (0.0, 0.0),
            (3.0, 2.0),
            (16.0, 16.0),
        ]);
        let input = [1.8, 0.45, 0.12];
        let output = plan.apply_rgb(input);
        assert!(output.iter().all(|value| value.is_finite()));
        assert!((output[0] / output[1] - input[0] / input[1]).abs() < 1.0e-5);
        assert!((output[1] / output[2] - input[1] / input[2]).abs() < 1.0e-5);
        assert!(output[0] > 1.0);
    }

    #[test]
    fn negative_and_zero_scene_values_follow_stable_bypass_policy() {
        let plan = CurveCompileRequest::scene_identity();
        let plan = CompiledCurvePlanV1::compile(plan).unwrap();
        for input in [[-0.2, -0.1, -0.3], [0.0, 0.0, 0.0]] {
            assert_eq!(plan.apply_rgb(input), input);
        }
    }

    #[test]
    fn validation_rejects_non_finite_duplicate_and_descending_points() {
        for points in [
            vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 0.0, y: 1.0 }],
            vec![CurvePoint { x: 0.0, y: 1.0 }, CurvePoint { x: 1.0, y: 0.0 }],
            vec![
                CurvePoint {
                    x: f64::NAN,
                    y: 0.0,
                },
                CurvePoint { x: 1.0, y: 1.0 },
            ],
        ] {
            let mut request = CurveCompileRequest::scene_identity();
            request.points = points;
            assert!(CompiledCurvePlanV1::compile(request).is_err());
        }
    }

    #[test]
    fn fingerprint_is_deterministic_and_domain_sensitive() {
        let first = CompiledCurvePlanV1::compile(CurveCompileRequest::scene_identity()).unwrap();
        let second = CompiledCurvePlanV1::compile(CurveCompileRequest::scene_identity()).unwrap();
        let output =
            CompiledCurvePlanV1::compile(CurveCompileRequest::output_identity("srgb", 1.0))
                .unwrap();
        assert_eq!(first.fingerprint, second.fingerprint);
        assert_ne!(first.fingerprint, output.fingerprint);
    }

    #[test]
    fn hdr_output_domain_preserves_values_above_reference_white() {
        let plan =
            CompiledCurvePlanV1::compile(CurveCompileRequest::output_identity("rec2100-pq", 4.0))
                .unwrap();
        let output = plan.apply_rgb([0.5, 1.0, 3.2]);
        assert!((output[0] - 0.5).abs() < 1.0e-5);
        assert!((output[1] - 1.0).abs() < 1.0e-5);
        assert!((output[2] - 3.2).abs() < 1.0e-5);
    }

    #[test]
    fn legacy_fit_reports_measured_error() {
        let samples = (0..=15)
            .map(|index| (index as f32 / 15.0).powf(0.9))
            .collect::<Vec<_>>();
        let (_, maximum, rms) = fit_legacy_output_curve(&samples, "srgb").unwrap();
        assert!(maximum < 1.0e-5);
        assert!(rms < 2.0e-6);
    }

    #[test]
    fn gpu_payload_contains_versioned_metadata_and_full_precision_lut() {
        let plan = CompiledCurvePlanV1::compile(CurveCompileRequest::scene_identity()).unwrap();
        let payload = plan.gpu_storage_payload();
        assert_eq!(
            payload.len(),
            CURVE_GPU_HEADER_FLOATS + DEFAULT_CURVE_LUT_SIZE
        );
        assert_eq!(payload[0], 1.0);
        assert_eq!(payload[1], 0.0);
        assert_eq!(payload[6], DEFAULT_CURVE_LUT_SIZE as f32);
        assert_eq!(
            &payload[CURVE_GPU_HEADER_FLOATS..],
            plan.lut.as_ref(),
            "GPU evaluation consumes the same compiled LUT as CPU"
        );
    }

    #[test]
    fn optional_legacy_conversion_is_measured_and_tolerance_gated() {
        let samples = (0..=15)
            .map(|index| index as f32 / 15.0)
            .collect::<Vec<_>>();
        let converted = compile_output_curve_from_adjustments(&serde_json::json!({
            "legacyCurveConversion": {
                "samples": samples,
                "maxErrorTolerance": 0.00001,
                "outputProfileId": "srgb"
            }
        }))
        .unwrap();
        assert!(converted.is_some());
        assert!(
            compile_output_curve_from_adjustments(&serde_json::json!({
                "legacyCurveConversion": {
                    "samples": [0.0, 1.0, 0.0],
                    "maxErrorTolerance": 0.0
                }
            }))
            .is_err()
        );
    }

    #[test]
    fn strict_adjustment_parsers_compile_scene_and_hdr_output_domains() {
        let scene = serde_json::json!({
            "sceneCurve": {
                "enabled": true,
                "channelMode": "green",
                "interpolation": "linear",
                "middleGrey": 0.18,
                "points": [{"xEv": -4.0, "yEv": -3.0}, {"xEv": 4.0, "yEv": 2.0}],
                "lowExtrapolation": "constant",
                "highExtrapolation": {"softRollOffStrength": 0.5},
                "preserveColor": "max_rgb_ratio"
            }
        });
        let scene = compile_scene_curve_from_adjustments(&scene)
            .unwrap()
            .unwrap();
        assert_eq!(scene.channel_mode, CurveChannelMode::Green);
        assert_eq!(scene.interpolation, CurveInterpolation::Linear);
        assert_eq!(scene.implementation_version, CURVE_IMPLEMENTATION_VERSION);
        let mapped = scene.apply_rgb([0.2, 0.4, 0.6]);
        assert_eq!(mapped[0], 0.2);
        assert_ne!(mapped[1], 0.4);
        assert_eq!(mapped[2], 0.6);

        let output = serde_json::json!({
            "outputCurve": {
                "enabled": true,
                "domain": "output_encoded",
                "channelMode": "red",
                "outputProfileId": "rec2100-pq",
                "referenceWhite": 1.0,
                "maximumValue": 4.0,
                "points": [{"x": 0.0, "y": 0.0}, {"x": 4.0, "y": 3.0}]
            }
        });
        let output = compile_output_curve_from_adjustments(&output)
            .unwrap()
            .unwrap();
        assert!(matches!(output.domain, CurveDomain::OutputEncoded { .. }));
        assert_eq!(output.channel_mode, CurveChannelMode::Red);
    }

    #[test]
    fn absent_or_disabled_new_curves_preserve_legacy_path() {
        assert!(
            compile_scene_curve_from_adjustments(&serde_json::json!({}))
                .unwrap()
                .is_none()
        );
        assert!(
            compile_output_curve_from_adjustments(
                &serde_json::json!({"outputCurve": {"enabled": false}})
            )
            .unwrap()
            .is_none()
        );
    }
}
