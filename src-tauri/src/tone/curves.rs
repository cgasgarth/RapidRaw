//! Scene-referred curve contract shared by CPU and WGPU execution.
//!
//! Control points live in physical log2 exposure values around middle grey.
//! This is deliberately separate from the legacy/display-encoded 0-255 curve.

use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

pub const SCENE_CURVE_IMPLEMENTATION_VERSION: u32 = 1;
pub const SCENE_CURVE_INPUT_DOMAIN: &str = "acescg_scene_linear_extended_v1";
pub const SCENE_CURVE_OUTPUT_DOMAIN: &str = "acescg_scene_linear_extended_v1";
pub const SCENE_CURVE_MIN_EV: f32 = -16.0;
pub const SCENE_CURVE_MAX_EV: f32 = 16.0;
pub const MAX_SCENE_CURVE_POINTS: usize = 32;
const MIN_POINT_DISTANCE_EV: f32 = 1.0 / 4096.0;
const MAX_EXTRAPOLATION_SLOPE: f32 = 8.0;
const MIN_SAFE_OUTPUT_EV: f32 = -126.0;
const MAX_SAFE_LINEAR_LOG2: f32 = 127.0;
const AP1_LUMINANCE: [f32; 3] = [0.272_228_72, 0.674_081_74, 0.053_689_52];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CurveDomain {
    SceneLog2Ev,
    ViewEncoded(ViewProcessId),
    OutputEncoded(OutputProfileId),
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ViewProcessId(pub u64);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct OutputProfileId(pub u64);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
#[repr(u32)]
pub enum CurveChannelMode {
    LuminancePreserving = 0,
    LinkedRgb = 1,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CurveExtrapolation {
    LinearTangent,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CurveColorPreservation {
    Ap1LuminanceRatio,
    PerChannel,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SceneNegativePolicy {
    PreserveNonPositive,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurvePoint {
    pub x_ev: f32,
    pub y_ev: f32,
}

impl CurvePoint {
    pub const fn new(x_ev: f32, y_ev: f32) -> Self {
        Self { x_ev, y_ev }
    }
}

pub(super) trait MonotonePoint {
    fn x(&self) -> f32;
    fn y(&self) -> f32;
}

impl MonotonePoint for CurvePoint {
    fn x(&self) -> f32 {
        self.x_ev
    }

    fn y(&self) -> f32 {
        self.y_ev
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurveCompileError {
    InvalidMiddleGrey,
    InvalidPointCount,
    NonFinitePoint,
    PointOutsideSceneRange,
    PointsNotStrictlyIncreasing,
    OutputNotMonotone,
}

#[derive(Clone, Debug)]
pub struct CompiledCurvePlanV1 {
    pub domain: CurveDomain,
    pub channel_mode: CurveChannelMode,
    pub middle_grey: f32,
    pub points: Arc<[CurvePoint]>,
    pub low_extrapolation: CurveExtrapolation,
    pub high_extrapolation: CurveExtrapolation,
    pub color_preservation: CurveColorPreservation,
    pub negative_policy: SceneNegativePolicy,
    tangents: Arc<[f32]>,
    pub fingerprint: u64,
    pub implementation_version: u32,
}

#[derive(Clone, Debug)]
pub struct CompiledSceneCurveNodeV1 {
    pub input_domain: &'static str,
    pub output_domain: &'static str,
    pub plan: CompiledCurvePlanV1,
}

impl CompiledSceneCurveNodeV1 {
    pub fn compile(
        points: &[CurvePoint],
        middle_grey: f32,
        channel_mode: CurveChannelMode,
    ) -> Result<Self, CurveCompileError> {
        let plan = compile_scene_curve(points, middle_grey, channel_mode)?;
        Ok(Self {
            input_domain: SCENE_CURVE_INPUT_DOMAIN,
            output_domain: SCENE_CURVE_OUTPUT_DOMAIN,
            plan,
        })
    }

    pub fn evaluate_rgb(&self, rgb: [f32; 3]) -> [f32; 3] {
        self.plan.evaluate_rgb(rgb)
    }
}

pub fn compile_scene_curve(
    points: &[CurvePoint],
    middle_grey: f32,
    channel_mode: CurveChannelMode,
) -> Result<CompiledCurvePlanV1, CurveCompileError> {
    if !middle_grey.is_finite() || !(1.0e-6..=1.0).contains(&middle_grey) {
        return Err(CurveCompileError::InvalidMiddleGrey);
    }
    if !(2..=MAX_SCENE_CURVE_POINTS).contains(&points.len()) {
        return Err(CurveCompileError::InvalidPointCount);
    }
    if points
        .iter()
        .any(|point| !point.x_ev.is_finite() || !point.y_ev.is_finite())
    {
        return Err(CurveCompileError::NonFinitePoint);
    }
    if points.iter().any(|point| {
        !(SCENE_CURVE_MIN_EV..=SCENE_CURVE_MAX_EV).contains(&point.x_ev)
            || !(SCENE_CURVE_MIN_EV..=SCENE_CURVE_MAX_EV).contains(&point.y_ev)
    }) {
        return Err(CurveCompileError::PointOutsideSceneRange);
    }
    if points
        .windows(2)
        .any(|pair| pair[1].x_ev - pair[0].x_ev < MIN_POINT_DISTANCE_EV)
    {
        return Err(CurveCompileError::PointsNotStrictlyIncreasing);
    }
    if points.windows(2).any(|pair| pair[1].y_ev < pair[0].y_ev) {
        return Err(CurveCompileError::OutputNotMonotone);
    }

    let tangents = monotone_tangents(points);
    let fingerprint = fingerprint(points, &tangents, middle_grey, channel_mode);
    Ok(CompiledCurvePlanV1 {
        domain: CurveDomain::SceneLog2Ev,
        channel_mode,
        middle_grey,
        points: points.to_vec().into(),
        low_extrapolation: CurveExtrapolation::LinearTangent,
        high_extrapolation: CurveExtrapolation::LinearTangent,
        color_preservation: match channel_mode {
            CurveChannelMode::LuminancePreserving => CurveColorPreservation::Ap1LuminanceRatio,
            CurveChannelMode::LinkedRgb => CurveColorPreservation::PerChannel,
        },
        negative_policy: SceneNegativePolicy::PreserveNonPositive,
        tangents: tangents.into(),
        fingerprint,
        implementation_version: SCENE_CURVE_IMPLEMENTATION_VERSION,
    })
}

impl CompiledCurvePlanV1 {
    pub fn evaluate_ev(&self, input_ev: f32) -> f32 {
        if !input_ev.is_finite() {
            return input_ev;
        }
        evaluate_monotone(&self.points, &self.tangents, input_ev)
    }

    pub fn evaluate_rgb(&self, rgb: [f32; 3]) -> [f32; 3] {
        if !rgb.iter().all(|value| value.is_finite()) {
            return rgb;
        }
        match self.channel_mode {
            CurveChannelMode::LuminancePreserving => {
                let luminance = rgb
                    .iter()
                    .zip(AP1_LUMINANCE)
                    .map(|(channel, weight)| channel * weight)
                    .sum::<f32>();
                if luminance <= 1.0e-8 {
                    return rgb;
                }
                let output_luminance = self.evaluate_positive(luminance);
                let scale = output_luminance / luminance;
                rgb.map(|channel| channel * scale)
            }
            CurveChannelMode::LinkedRgb => rgb.map(|channel| {
                if channel > 1.0e-8 {
                    self.evaluate_positive(channel)
                } else {
                    channel
                }
            }),
        }
    }

    fn evaluate_positive(&self, value: f32) -> f32 {
        let input_ev = (value / self.middle_grey).log2();
        let maximum_output_ev = MAX_SAFE_LINEAR_LOG2 - self.middle_grey.log2();
        self.middle_grey
            * self
                .evaluate_ev(input_ev)
                .clamp(MIN_SAFE_OUTPUT_EV, maximum_output_ev)
                .exp2()
    }

    pub fn gpu_knots(&self) -> Vec<GpuCurveKnot> {
        self.points
            .iter()
            .zip(self.tangents.iter())
            .map(|(point, tangent)| GpuCurveKnot {
                x_ev: point.x_ev,
                y_ev: point.y_ev,
                tangent: *tangent,
                _padding: 0.0,
            })
            .collect()
    }

    pub fn gpu_parameters(&self) -> GpuCurveParameters {
        GpuCurveParameters {
            point_count: self.points.len() as u32,
            channel_mode: self.channel_mode as u32,
            middle_grey: self.middle_grey,
            _padding: 0,
        }
    }
}

pub(super) fn monotone_tangents<P: MonotonePoint>(points: &[P]) -> Vec<f32> {
    let intervals = points
        .windows(2)
        .map(|pair| pair[1].x() - pair[0].x())
        .collect::<Vec<_>>();
    let slopes = points
        .windows(2)
        .zip(&intervals)
        .map(|(pair, interval)| (pair[1].y() - pair[0].y()) / interval)
        .collect::<Vec<_>>();
    if points.len() == 2 {
        let slope = slopes[0].clamp(0.0, MAX_EXTRAPOLATION_SLOPE);
        return vec![slope, slope];
    }

    let mut tangents = vec![0.0; points.len()];
    tangents[0] = endpoint_tangent(intervals[0], intervals[1], slopes[0], slopes[1]);
    for index in 1..points.len() - 1 {
        let before = slopes[index - 1];
        let after = slopes[index];
        if before <= 0.0 || after <= 0.0 {
            tangents[index] = 0.0;
            continue;
        }
        let before_width = intervals[index - 1];
        let after_width = intervals[index];
        let first_weight = 2.0 * after_width + before_width;
        let second_weight = after_width + 2.0 * before_width;
        tangents[index] =
            (first_weight + second_weight) / (first_weight / before + second_weight / after);
    }
    let last = points.len() - 1;
    tangents[last] = endpoint_tangent(
        intervals[last - 1],
        intervals[last - 2],
        slopes[last - 1],
        slopes[last - 2],
    );
    tangents
        .into_iter()
        .map(|tangent| tangent.clamp(0.0, MAX_EXTRAPOLATION_SLOPE))
        .collect()
}

fn endpoint_tangent(width: f32, adjacent_width: f32, slope: f32, adjacent_slope: f32) -> f32 {
    let tangent = ((2.0 * width + adjacent_width) * slope - width * adjacent_slope)
        / (width + adjacent_width);
    if tangent.signum() != slope.signum() {
        0.0
    } else if slope.signum() != adjacent_slope.signum() && tangent.abs() > 3.0 * slope.abs() {
        3.0 * slope
    } else {
        tangent
    }
}

pub(super) fn evaluate_monotone<P: MonotonePoint>(
    points: &[P],
    tangents: &[f32],
    input: f32,
) -> f32 {
    let first = &points[0];
    if input <= first.x() {
        return first.y() + (input - first.x()) * tangents[0];
    }
    let last_index = points.len() - 1;
    let last = &points[last_index];
    if input >= last.x() {
        return last.y() + (input - last.x()) * tangents[last_index];
    }
    let upper = points.partition_point(|point| point.x() < input);
    hermite(
        input,
        &points[upper - 1],
        &points[upper],
        tangents[upper - 1],
        tangents[upper],
    )
}

fn hermite<P: MonotonePoint>(input: f32, lower: &P, upper: &P, m0: f32, m1: f32) -> f32 {
    let width = upper.x() - lower.x();
    let t = (input - lower.x()) / width;
    let t2 = t * t;
    let t3 = t2 * t;
    (2.0 * t3 - 3.0 * t2 + 1.0) * lower.y()
        + (t3 - 2.0 * t2 + t) * m0 * width
        + (-2.0 * t3 + 3.0 * t2) * upper.y()
        + (t3 - t2) * m1 * width
}

fn fingerprint(
    points: &[CurvePoint],
    tangents: &[f32],
    middle_grey: f32,
    channel_mode: CurveChannelMode,
) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"rapidraw.scene-monotone-curve.v1");
    hasher.update(&SCENE_CURVE_IMPLEMENTATION_VERSION.to_le_bytes());
    hasher.update(&middle_grey.to_bits().to_le_bytes());
    hasher.update(&(channel_mode as u32).to_le_bytes());
    for (point, tangent) in points.iter().zip(tangents) {
        hasher.update(&point.x_ev.to_bits().to_le_bytes());
        hasher.update(&point.y_ev.to_bits().to_le_bytes());
        hasher.update(&tangent.to_bits().to_le_bytes());
    }
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Pod, Serialize, Zeroable)]
pub struct GpuCurveKnot {
    pub x_ev: f32,
    pub y_ev: f32,
    pub tangent: f32,
    pub _padding: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Pod, Serialize, Zeroable)]
pub struct GpuCurveParameters {
    pub point_count: u32,
    pub channel_mode: u32,
    pub middle_grey: f32,
    pub _padding: u32,
}

/// Production WGPU evaluator for the compiled scene-curve ABI.
pub const SCENE_CURVE_WGSL: &str = r#"
struct Knot { x_ev: f32, y_ev: f32, tangent: f32, padding: f32 }
struct Parameters { point_count: u32, channel_mode: u32, middle_grey: f32, padding: u32 }
@group(0) @binding(0) var<storage, read> source: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> destination: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> knots: array<Knot>;
@group(0) @binding(3) var<uniform> parameters: Parameters;

fn evaluate_ev(input_ev: f32) -> f32 {
    let first = knots[0];
    if (input_ev <= first.x_ev) { return first.y_ev + (input_ev - first.x_ev) * first.tangent; }
    let last = knots[parameters.point_count - 1u];
    if (input_ev >= last.x_ev) { return last.y_ev + (input_ev - last.x_ev) * last.tangent; }
    for (var index = 0u; index + 1u < parameters.point_count; index += 1u) {
        let lower = knots[index]; let upper = knots[index + 1u];
        if (input_ev <= upper.x_ev) {
            let width = upper.x_ev - lower.x_ev; let t = (input_ev - lower.x_ev) / width;
            let t2 = t * t; let t3 = t2 * t;
            return (2.0*t3 - 3.0*t2 + 1.0)*lower.y_ev
                + (t3 - 2.0*t2 + t)*lower.tangent*width
                + (-2.0*t3 + 3.0*t2)*upper.y_ev + (t3 - t2)*upper.tangent*width;
        }
    }
    return input_ev;
}

fn evaluate_positive(value: f32) -> f32 {
    let maximum_output_ev = 127.0 - log2(parameters.middle_grey);
    let output_ev = clamp(evaluate_ev(log2(value / parameters.middle_grey)), -126.0, maximum_output_ev);
    return parameters.middle_grey * exp2(output_ev);
}

fn evaluate_rgb(rgb: vec3<f32>) -> vec3<f32> {
    if (parameters.channel_mode == 0u) {
        let luminance = dot(rgb, vec3<f32>(0.27222872, 0.67408174, 0.05368952));
        if (luminance <= 1e-8) { return rgb; }
        return rgb * (evaluate_positive(luminance) / luminance);
    }
    var output = rgb;
    if (rgb.r > 1e-8) { output.r = evaluate_positive(rgb.r); }
    if (rgb.g > 1e-8) { output.g = evaluate_positive(rgb.g); }
    if (rgb.b > 1e-8) { output.b = evaluate_positive(rgb.b); }
    return output;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= arrayLength(&source)) { return; }
    let input = source[id.x];
    destination[id.x] = vec4<f32>(evaluate_rgb(input.rgb), input.a);
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn curve(mode: CurveChannelMode) -> CompiledSceneCurveNodeV1 {
        CompiledSceneCurveNodeV1::compile(
            &[
                CurvePoint::new(-16.0, -16.0),
                CurvePoint::new(-4.0, -3.0),
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(4.0, 2.5),
                CurvePoint::new(16.0, 10.0),
            ],
            0.18,
            mode,
        )
        .unwrap()
    }

    #[test]
    fn compiler_separates_scene_domain_and_rejects_invalid_points() {
        let node = curve(CurveChannelMode::LuminancePreserving);
        assert_eq!(node.input_domain, SCENE_CURVE_INPUT_DOMAIN);
        assert_eq!(node.output_domain, SCENE_CURVE_OUTPUT_DOMAIN);
        assert_eq!(node.plan.domain, CurveDomain::SceneLog2Ev);
        assert_ne!(node.plan.fingerprint, 0);
        assert_eq!(
            node.plan.fingerprint,
            curve(CurveChannelMode::LuminancePreserving)
                .plan
                .fingerprint
        );
        assert_ne!(
            node.plan.fingerprint,
            curve(CurveChannelMode::LinkedRgb).plan.fingerprint
        );
        assert_eq!(
            compile_scene_curve(
                &[CurvePoint::new(0.0, 0.0), CurvePoint::new(0.0, 1.0)],
                0.18,
                CurveChannelMode::LinkedRgb,
            )
            .unwrap_err(),
            CurveCompileError::PointsNotStrictlyIncreasing
        );
        assert_eq!(
            compile_scene_curve(
                &[CurvePoint::new(-1.0, 1.0), CurvePoint::new(1.0, 0.0)],
                0.18,
                CurveChannelMode::LinkedRgb,
            )
            .unwrap_err(),
            CurveCompileError::OutputNotMonotone
        );
    }

    #[test]
    fn monotone_curve_passes_points_has_no_overshoot_and_extrapolates() {
        let plan = curve(CurveChannelMode::LinkedRgb).plan;
        for point in plan.points.iter() {
            assert!((plan.evaluate_ev(point.x_ev) - point.y_ev).abs() <= 2.0e-6);
        }
        let outputs = (0..=4096)
            .map(|index| plan.evaluate_ev(-20.0 + index as f32 * 40.0 / 4096.0))
            .collect::<Vec<_>>();
        assert!(outputs.windows(2).all(|pair| pair[0] <= pair[1] + 1.0e-6));
        assert!(plan.evaluate_ev(-20.0) < plan.evaluate_ev(-16.0));
        assert!(plan.evaluate_ev(20.0) > plan.evaluate_ev(16.0));
    }

    #[test]
    fn identity_and_luminance_preservation_cover_negative_sdr_and_hdr_values() {
        let identity = CompiledSceneCurveNodeV1::compile(
            &[CurvePoint::new(-16.0, -16.0), CurvePoint::new(16.0, 16.0)],
            0.18,
            CurveChannelMode::LuminancePreserving,
        )
        .unwrap();
        for rgb in [[-0.2, 0.3, 1.5], [0.18; 3], [4.0, 2.0, 0.5], [32.0; 3]] {
            let output = identity.evaluate_rgb(rgb);
            for (actual, expected) in output.into_iter().zip(rgb) {
                assert!((actual - expected).abs() <= expected.abs().max(1.0) * 2.0e-6);
            }
        }

        let plan = curve(CurveChannelMode::LuminancePreserving).plan;
        let input = [4.0, 1.0, -0.1];
        let output = plan.evaluate_rgb(input);
        let ratios = output
            .into_iter()
            .zip(input)
            .filter(|(_, source)| source.abs() > 1.0e-6)
            .map(|(mapped, source)| mapped / source)
            .collect::<Vec<_>>();
        assert!(
            ratios
                .windows(2)
                .all(|pair| (pair[0] - pair[1]).abs() <= 2.0e-6)
        );
        assert!(output.iter().all(|value| value.is_finite()));
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn production_wgpu_matches_cpu_for_scene_negative_sdr_and_hdr_samples() {
        for mode in [
            CurveChannelMode::LuminancePreserving,
            CurveChannelMode::LinkedRgb,
        ] {
            let plan = curve(mode).plan;
            let samples = [
                [-0.25, 0.0, 0.2, 1.0],
                [0.001, 0.01, 0.1, 0.8],
                [0.18, 0.18, 0.18, 1.0],
                [1.0, 0.4, 0.05, 1.0],
                [4.0, 2.0, 0.5, 0.5],
                [32.0, 12.0, 1.0, 1.0],
            ];
            let expected = samples.map(|sample| {
                let rgb = plan.evaluate_rgb([sample[0], sample[1], sample[2]]);
                [rgb[0], rgb[1], rgb[2], sample[3]]
            });
            let actual = run_gpu(&plan, &samples).expect("WGPU scene curve executes");
            for (gpu, cpu) in actual.iter().zip(expected) {
                for (actual, expected) in gpu.iter().zip(cpu) {
                    assert!(
                        (actual - expected).abs() <= expected.abs().max(1.0) * 3.0e-5,
                        "mode={mode:?} actual={actual} expected={expected}"
                    );
                }
            }
        }
    }

    #[cfg(feature = "tauri-test")]
    fn run_gpu(plan: &CompiledCurvePlanV1, samples: &[[f32; 4]]) -> Result<Vec<[f32; 4]>, String> {
        use std::sync::mpsc;
        use wgpu::util::DeviceExt;

        let instance =
            wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            ..Default::default()
        }))
        .map_err(|error| error.to_string())?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("scene curve parity device"),
            required_features: wgpu::Features::empty(),
            required_limits: adapter.limits(),
            experimental_features: wgpu::ExperimentalFeatures::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .map_err(|error| error.to_string())?;
        let init = |label, contents: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage,
            })
        };
        let source = init(
            "scene curve source",
            bytemuck::cast_slice(samples),
            wgpu::BufferUsages::STORAGE,
        );
        let destination = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene curve destination"),
            size: std::mem::size_of_val(samples) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let knots = plan.gpu_knots();
        let knots = init(
            "scene curve knots",
            bytemuck::cast_slice(&knots),
            wgpu::BufferUsages::STORAGE,
        );
        let parameters = init(
            "scene curve parameters",
            bytemuck::bytes_of(&plan.gpu_parameters()),
            wgpu::BufferUsages::UNIFORM,
        );
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene curve shader"),
            source: wgpu::ShaderSource::Wgsl(SCENE_CURVE_WGSL.into()),
        });
        let bind_group_layout = crate::render::wgpu_nodes::create_curve_bind_group_layout(
            &device,
            crate::edit_graph::EditNodeKind::SceneCurve,
        )
        .map_err(str::to_owned)?;
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene curve descriptor-owned layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("scene curve pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene curve bindings"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: source.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: destination.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: knots.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: parameters.as_entire_binding(),
                },
            ],
        });
        let staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene curve readback"),
            size: std::mem::size_of_val(samples) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("scene curve encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("scene curve pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(samples.len().div_ceil(64) as u32, 1, 1);
        }
        encoder.copy_buffer_to_buffer(
            &destination,
            0,
            &staging,
            0,
            std::mem::size_of_val(samples) as u64,
        );
        queue.submit(Some(encoder.finish()));
        let slice = staging.slice(..);
        let (sender, receiver) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(std::time::Duration::from_secs(60)),
            })
            .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?;
        let output = bytemuck::cast_slice::<u8, [f32; 4]>(&slice.get_mapped_range()).to_vec();
        staging.unmap();
        Ok(output)
    }
}
