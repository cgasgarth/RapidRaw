//! Display/output-referred curve boundary.
//!
//! Coordinates are encoded values relative to SDR reference white. They are
//! never interpreted as scene exposure values, and the domain identity is part
//! of the compiled fingerprint.

use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

use super::curves::{
    CurveDomain, MonotonePoint, OutputProfileId, ViewProcessId, evaluate_monotone,
    monotone_tangents,
};

pub const OUTPUT_CURVE_IMPLEMENTATION_VERSION: u32 = 1;
pub const OUTPUT_CURVE_INPUT_DOMAIN: &str = "display_or_output_encoded_extended_v1";
pub const OUTPUT_CURVE_OUTPUT_DOMAIN: &str = "display_or_output_encoded_extended_v1";
pub const MAX_OUTPUT_CURVE_POINTS: usize = 32;
const MIN_POINT_DISTANCE: f32 = 1.0 / 65_536.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OutputCurveTargetV1 {
    pub domain: CurveDomain,
    pub sdr_reference_white_nits: f32,
    pub peak_nits: f32,
}

impl OutputCurveTargetV1 {
    pub const fn view_encoded(
        view_process_fingerprint: u64,
        sdr_reference_white_nits: f32,
        peak_nits: f32,
    ) -> Self {
        Self {
            domain: CurveDomain::ViewEncoded(ViewProcessId(view_process_fingerprint)),
            sdr_reference_white_nits,
            peak_nits,
        }
    }

    pub const fn output_encoded(
        output_profile_fingerprint: u64,
        sdr_reference_white_nits: f32,
        peak_nits: f32,
    ) -> Self {
        Self {
            domain: CurveDomain::OutputEncoded(OutputProfileId(output_profile_fingerprint)),
            sdr_reference_white_nits,
            peak_nits,
        }
    }

    pub fn encoded_headroom(self) -> f32 {
        self.peak_nits / self.sdr_reference_white_nits
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OutputCurvePoint {
    pub input: f32,
    pub output: f32,
}

impl OutputCurvePoint {
    pub const fn new(input: f32, output: f32) -> Self {
        Self { input, output }
    }
}

impl MonotonePoint for OutputCurvePoint {
    fn x(&self) -> f32 {
        self.input
    }

    fn y(&self) -> f32 {
        self.output
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutputCurveCompileError {
    SceneDomainNotAllowed,
    InvalidTargetLuminance,
    InvalidPointCount,
    NonFinitePoint,
    PointOutsideTargetRange,
    PointsNotStrictlyIncreasing,
    OutputNotMonotone,
}

#[derive(Clone, Debug)]
pub struct CompiledOutputCurvePlanV1 {
    pub target: OutputCurveTargetV1,
    pub points: Arc<[OutputCurvePoint]>,
    tangents: Arc<[f32]>,
    pub fingerprint: u64,
    pub implementation_version: u32,
}

#[derive(Clone, Debug)]
pub struct CompiledOutputCurveNodeV1 {
    pub input_domain: &'static str,
    pub output_domain: &'static str,
    pub plan: CompiledOutputCurvePlanV1,
}

impl CompiledOutputCurveNodeV1 {
    pub fn compile(
        target: OutputCurveTargetV1,
        points: &[OutputCurvePoint],
    ) -> Result<Self, OutputCurveCompileError> {
        let plan = compile_output_curve(target, points)?;
        Ok(Self {
            input_domain: OUTPUT_CURVE_INPUT_DOMAIN,
            output_domain: OUTPUT_CURVE_OUTPUT_DOMAIN,
            plan,
        })
    }

    pub fn evaluate_rgb(&self, rgb: [f32; 3]) -> [f32; 3] {
        self.plan.evaluate_rgb(rgb)
    }
}

pub fn compile_output_curve(
    target: OutputCurveTargetV1,
    points: &[OutputCurvePoint],
) -> Result<CompiledOutputCurvePlanV1, OutputCurveCompileError> {
    if matches!(target.domain, CurveDomain::SceneLog2Ev) {
        return Err(OutputCurveCompileError::SceneDomainNotAllowed);
    }
    if !target.sdr_reference_white_nits.is_finite()
        || !target.peak_nits.is_finite()
        || target.sdr_reference_white_nits <= 0.0
        || target.peak_nits < target.sdr_reference_white_nits
        || target.peak_nits > 10_000.0
    {
        return Err(OutputCurveCompileError::InvalidTargetLuminance);
    }
    if !(2..=MAX_OUTPUT_CURVE_POINTS).contains(&points.len()) {
        return Err(OutputCurveCompileError::InvalidPointCount);
    }
    if points
        .iter()
        .any(|point| !point.input.is_finite() || !point.output.is_finite())
    {
        return Err(OutputCurveCompileError::NonFinitePoint);
    }
    let headroom = target.encoded_headroom();
    if points.iter().any(|point| {
        !(0.0..=headroom).contains(&point.input) || !(0.0..=headroom).contains(&point.output)
    }) {
        return Err(OutputCurveCompileError::PointOutsideTargetRange);
    }
    if points
        .windows(2)
        .any(|pair| pair[1].input - pair[0].input < MIN_POINT_DISTANCE)
    {
        return Err(OutputCurveCompileError::PointsNotStrictlyIncreasing);
    }
    if points
        .windows(2)
        .any(|pair| pair[1].output < pair[0].output)
    {
        return Err(OutputCurveCompileError::OutputNotMonotone);
    }

    let tangents = monotone_tangents(points);
    let fingerprint = fingerprint(target, points, &tangents);
    Ok(CompiledOutputCurvePlanV1 {
        target,
        points: points.to_vec().into(),
        tangents: tangents.into(),
        fingerprint,
        implementation_version: OUTPUT_CURVE_IMPLEMENTATION_VERSION,
    })
}

impl CompiledOutputCurvePlanV1 {
    pub fn evaluate(&self, value: f32) -> f32 {
        if !value.is_finite() {
            return value;
        }
        evaluate_monotone(&self.points, &self.tangents, value)
    }

    pub fn evaluate_rgb(&self, rgb: [f32; 3]) -> [f32; 3] {
        rgb.map(|channel| self.evaluate(channel))
    }

    pub fn gpu_knots(&self) -> Vec<GpuOutputCurveKnot> {
        self.points
            .iter()
            .zip(self.tangents.iter())
            .map(|(point, tangent)| GpuOutputCurveKnot {
                input: point.input,
                output: point.output,
                tangent: *tangent,
                _padding: 0.0,
            })
            .collect()
    }

    pub fn gpu_parameters(&self) -> GpuOutputCurveParameters {
        GpuOutputCurveParameters {
            point_count: self.points.len() as u32,
            _padding: [0; 3],
        }
    }
}

fn fingerprint(target: OutputCurveTargetV1, points: &[OutputCurvePoint], tangents: &[f32]) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"rapidraw.output-monotone-curve.v1");
    hasher.update(&OUTPUT_CURVE_IMPLEMENTATION_VERSION.to_le_bytes());
    match target.domain {
        CurveDomain::SceneLog2Ev => unreachable!("scene target rejected before hashing"),
        CurveDomain::ViewEncoded(ViewProcessId(identity)) => {
            hasher.update(b"view");
            hasher.update(&identity.to_le_bytes());
        }
        CurveDomain::OutputEncoded(OutputProfileId(identity)) => {
            hasher.update(b"output");
            hasher.update(&identity.to_le_bytes());
        }
    }
    hasher.update(&target.sdr_reference_white_nits.to_bits().to_le_bytes());
    hasher.update(&target.peak_nits.to_bits().to_le_bytes());
    for (point, tangent) in points.iter().zip(tangents) {
        hasher.update(&point.input.to_bits().to_le_bytes());
        hasher.update(&point.output.to_bits().to_le_bytes());
        hasher.update(&tangent.to_bits().to_le_bytes());
    }
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Pod, Serialize, Zeroable)]
pub struct GpuOutputCurveKnot {
    pub input: f32,
    pub output: f32,
    pub tangent: f32,
    pub _padding: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Deserialize, Pod, Serialize, Zeroable)]
pub struct GpuOutputCurveParameters {
    pub point_count: u32,
    pub _padding: [u32; 3],
}

pub const OUTPUT_CURVE_WGSL: &str = r#"
struct Knot { input: f32, output: f32, tangent: f32, padding: f32 }
struct Parameters { point_count: u32, padding0: u32, padding1: u32, padding2: u32 }
@group(0) @binding(0) var<storage, read> source: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> destination: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> knots: array<Knot>;
@group(0) @binding(3) var<uniform> parameters: Parameters;

fn evaluate_curve(value: f32) -> f32 {
    let first = knots[0];
    if (value <= first.input) { return first.output + (value - first.input) * first.tangent; }
    let last = knots[parameters.point_count - 1u];
    if (value >= last.input) { return last.output + (value - last.input) * last.tangent; }
    for (var index = 0u; index + 1u < parameters.point_count; index += 1u) {
        let lower = knots[index]; let upper = knots[index + 1u];
        if (value <= upper.input) {
            let width = upper.input - lower.input; let t = (value - lower.input) / width;
            let t2 = t * t; let t3 = t2 * t;
            return (2.0*t3 - 3.0*t2 + 1.0)*lower.output
                + (t3 - 2.0*t2 + t)*lower.tangent*width
                + (-2.0*t3 + 3.0*t2)*upper.output + (t3 - t2)*upper.tangent*width;
        }
    }
    return value;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= arrayLength(&source)) { return; }
    let input = source[id.x];
    destination[id.x] = vec4<f32>(
        evaluate_curve(input.r), evaluate_curve(input.g), evaluate_curve(input.b), input.a
    );
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn hdr_target(identity: u64) -> OutputCurveTargetV1 {
        OutputCurveTargetV1::output_encoded(identity, 203.0, 1_000.0)
    }

    fn hdr_points() -> Vec<OutputCurvePoint> {
        let maximum = 1_000.0 / 203.0;
        vec![
            OutputCurvePoint::new(0.0, 0.0),
            OutputCurvePoint::new(0.18, 0.14),
            OutputCurvePoint::new(1.0, 1.0),
            OutputCurvePoint::new(maximum, 4.0),
        ]
    }

    #[test]
    fn compiler_binds_encoded_domain_target_and_hdr_range() {
        let plan = CompiledOutputCurveNodeV1::compile(hdr_target(77), &hdr_points()).unwrap();
        assert_eq!(plan.input_domain, OUTPUT_CURVE_INPUT_DOMAIN);
        assert_eq!(
            plan.plan.target.domain,
            CurveDomain::OutputEncoded(OutputProfileId(77))
        );
        assert!(plan.plan.target.encoded_headroom() > 4.9);
        assert_ne!(plan.plan.fingerprint, 0);
        let different_profile =
            CompiledOutputCurveNodeV1::compile(hdr_target(78), &hdr_points()).unwrap();
        assert_ne!(plan.plan.fingerprint, different_profile.plan.fingerprint);
        let different_view = CompiledOutputCurveNodeV1::compile(
            OutputCurveTargetV1::view_encoded(77, 203.0, 1_000.0),
            &hdr_points(),
        )
        .unwrap();
        assert_ne!(plan.plan.fingerprint, different_view.plan.fingerprint);
    }

    #[test]
    fn compiler_rejects_scene_domain_and_points_beyond_target_headroom() {
        assert_eq!(
            compile_output_curve(
                OutputCurveTargetV1 {
                    domain: CurveDomain::SceneLog2Ev,
                    sdr_reference_white_nits: 203.0,
                    peak_nits: 1_000.0,
                },
                &hdr_points(),
            )
            .unwrap_err(),
            OutputCurveCompileError::SceneDomainNotAllowed
        );
        assert_eq!(
            compile_output_curve(
                OutputCurveTargetV1::output_encoded(1, 203.0, 203.0),
                &hdr_points(),
            )
            .unwrap_err(),
            OutputCurveCompileError::PointOutsideTargetRange
        );
    }

    #[test]
    fn output_curve_is_monotone_point_exact_and_unbounded_past_hdr_peak() {
        let plan = compile_output_curve(hdr_target(77), &hdr_points()).unwrap();
        for point in plan.points.iter() {
            assert!((plan.evaluate(point.input) - point.output).abs() <= 2.0e-6);
        }
        let values = (0..=4096)
            .map(|index| plan.evaluate(-0.25 + index as f32 * 7.0 / 4096.0))
            .collect::<Vec<_>>();
        assert!(values.windows(2).all(|pair| pair[0] <= pair[1] + 1.0e-6));
        assert!(plan.evaluate(6.0) > plan.evaluate(plan.target.encoded_headroom()));
        assert!(plan.evaluate(-0.1) < 0.0);
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn production_wgpu_matches_cpu_across_sdr_white_and_hdr_headroom() {
        let plan = compile_output_curve(hdr_target(77), &hdr_points()).unwrap();
        let samples = [
            [-0.1, 0.0, 0.01, 1.0],
            [0.18, 0.4, 1.0, 0.8],
            [1.0, 2.0, 4.0, 1.0],
            [4.9, 5.5, 6.0, 0.5],
        ];
        let expected = samples.map(|sample| {
            let rgb = plan.evaluate_rgb([sample[0], sample[1], sample[2]]);
            [rgb[0], rgb[1], rgb[2], sample[3]]
        });
        let actual = run_gpu(&plan, &samples).expect("WGPU output curve executes");
        for (gpu, cpu) in actual.iter().zip(expected) {
            for (actual, expected) in gpu.iter().zip(cpu) {
                assert!((actual - expected).abs() <= expected.abs().max(1.0) * 3.0e-5);
            }
        }
    }

    #[cfg(feature = "tauri-test")]
    fn run_gpu(
        plan: &CompiledOutputCurvePlanV1,
        samples: &[[f32; 4]],
    ) -> Result<Vec<[f32; 4]>, String> {
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
            label: Some("output curve parity device"),
            required_features: wgpu::Features::empty(),
            required_limits: adapter.limits(),
            experimental_features: wgpu::ExperimentalFeatures::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .map_err(|error| error.to_string())?;
        let create = |label, contents: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage,
            })
        };
        let source = create(
            "output curve source",
            bytemuck::cast_slice(samples),
            wgpu::BufferUsages::STORAGE,
        );
        let size = std::mem::size_of_val(samples) as u64;
        let destination = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("output curve destination"),
            size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let knots = plan.gpu_knots();
        let knots = create(
            "output curve knots",
            bytemuck::cast_slice(&knots),
            wgpu::BufferUsages::STORAGE,
        );
        let parameters = create(
            "output curve parameters",
            bytemuck::bytes_of(&plan.gpu_parameters()),
            wgpu::BufferUsages::UNIFORM,
        );
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("output curve shader"),
            source: wgpu::ShaderSource::Wgsl(OUTPUT_CURVE_WGSL.into()),
        });
        let bind_group_layout = crate::render::wgpu_nodes::create_curve_bind_group_layout(
            &device,
            crate::edit_graph::EditNodeKind::OutputCurve,
        )
        .map_err(str::to_owned)?;
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("output curve descriptor-owned layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("output curve pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        let bindings = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("output curve bindings"),
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
            label: Some("output curve readback"),
            size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("output curve encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("output curve pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bindings, &[]);
            pass.dispatch_workgroups(samples.len().div_ceil(64) as u32, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&destination, 0, &staging, 0, size);
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
