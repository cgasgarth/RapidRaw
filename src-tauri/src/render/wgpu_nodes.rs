//! WGPU ownership derived from the compiled edit graph.
//!
//! The renderer may fuse several nodes into one dispatch, but resource
//! ownership remains inspectable at node granularity.  Keeping this receipt
//! next to the graph prevents a new typed node from silently relying on a
//! second, handwritten GPU ordering table.

use std::sync::Arc;

use crate::edit_graph::{
    CompiledEditGraph, EditNodeKind, LEGACY_PIPELINE_VERSION, SCENE_REFERRED_PIPELINE_VERSION,
    SpatialSupport, WgpuBindGroupLayoutKind, runtime_descriptor,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WgpuShaderSource {
    SceneCurve,
    OutputCurve,
    FusedProduction,
    External,
}

impl WgpuShaderSource {
    #[cfg(feature = "tauri-test")]
    #[allow(dead_code)]
    fn wgsl(self) -> Option<String> {
        match self {
            Self::SceneCurve => Some(crate::tone::curves::SCENE_CURVE_WGSL.to_owned()),
            Self::OutputCurve => Some(crate::tone::output_curves::OUTPUT_CURVE_WGSL.to_owned()),
            Self::FusedProduction => Some(format!(
                "{}\n{}",
                include_str!("../shaders/generated_bindings.wgsl"),
                include_str!("../shaders/shader.wgsl"),
            )),
            Self::External => None,
        }
    }
}

fn shader_source_for(implementation: &'static str) -> Result<WgpuShaderSource, &'static str> {
    match implementation {
        "scene_curve_wgsl_v1" => Ok(WgpuShaderSource::SceneCurve),
        "output_curve_wgsl_v1" => Ok(WgpuShaderSource::OutputCurve),
        "shader_wgsl_scene_phase_v2"
        | "shader_wgsl_view_display_phase_v2"
        | "shader_wgsl_legacy_scene_view_v1" => Ok(WgpuShaderSource::FusedProduction),
        "film_emulation_wgsl_v1" | "clipping_overlay_wgsl_v1" | "shader_transport_dither_v1" => {
            Ok(WgpuShaderSource::External)
        }
        _ => Err("edit_graph.wgpu_shader_source_unknown"),
    }
}

fn shader_accepts_layout(shader_source: WgpuShaderSource, layout: WgpuBindGroupLayoutKind) -> bool {
    match shader_source {
        WgpuShaderSource::SceneCurve | WgpuShaderSource::OutputCurve => {
            layout == WgpuBindGroupLayoutKind::CurveStorageV1
        }
        WgpuShaderSource::FusedProduction => matches!(
            layout,
            WgpuBindGroupLayoutKind::FusedSceneSpatialV2
                | WgpuBindGroupLayoutKind::FusedSceneSpatialMaskV2
                | WgpuBindGroupLayoutKind::FusedViewLutV2
                | WgpuBindGroupLayoutKind::FusedDisplayLutMaskV2
                | WgpuBindGroupLayoutKind::FusedLegacySceneViewV1
        ),
        WgpuShaderSource::External => layout == WgpuBindGroupLayoutKind::ExternalPointwiseV1,
    }
}

#[cfg(all(test, feature = "tauri-test"))]
pub(crate) fn create_curve_bind_group_layout(
    device: &wgpu::Device,
    kind: EditNodeKind,
) -> Result<wgpu::BindGroupLayout, &'static str> {
    let descriptor = runtime_descriptor(kind);
    let implementation = descriptor
        .wgpu_implementation
        .ok_or("edit_graph.wgpu_missing_implementation")?;
    let shader_source = shader_source_for(implementation)?;
    let layout = descriptor
        .wgpu_bind_group_layout
        .ok_or("edit_graph.wgpu_missing_bind_group_layout")?;
    if !layout.accepts_resources(descriptor.resource_requirements) {
        return Err("edit_graph.wgpu_bind_group_layout_resource_mismatch");
    }
    if !shader_accepts_layout(shader_source, layout) {
        return Err("edit_graph.wgpu_shader_layout_mismatch");
    }
    if layout != WgpuBindGroupLayoutKind::CurveStorageV1 {
        return Err("edit_graph.wgpu_curve_layout_required");
    }

    Ok(
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(layout.stable_id()),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        }),
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WgpuResourceKind {
    SampledTexture2d,
    SampledTexture3d,
    SampledTexture2dArray,
}

impl WgpuResourceKind {
    fn stable_id(self) -> &'static str {
        match self {
            Self::SampledTexture2d => "sampled_texture_2d",
            Self::SampledTexture3d => "sampled_texture_3d",
            Self::SampledTexture2dArray => "sampled_texture_2d_array",
        }
    }

    fn binding_type(self) -> wgpu::BindingType {
        wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: match self {
                Self::SampledTexture2d => wgpu::TextureViewDimension::D2,
                Self::SampledTexture3d => wgpu::TextureViewDimension::D3,
                Self::SampledTexture2dArray => wgpu::TextureViewDimension::D2Array,
            },
            multisampled: false,
        }
    }
}

fn resource_kind(resource: &str) -> Result<WgpuResourceKind, &'static str> {
    match resource {
        "scene_guidance_v1" | "detail_guidance_v1" | "legacy_scene_blur_v1" => {
            Ok(WgpuResourceKind::SampledTexture2d)
        }
        "view_transform_lut_v1" | "display_lut_v1" => Ok(WgpuResourceKind::SampledTexture3d),
        "mask_layers_v1" => Ok(WgpuResourceKind::SampledTexture2dArray),
        _ => Err("edit_graph.wgpu_unknown_resource_kind"),
    }
}

pub(crate) fn resource_binding_type(resource: &str) -> Result<wgpu::BindingType, &'static str> {
    resource_kind(resource).map(WgpuResourceKind::binding_type)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WgpuNodeModule {
    pub(crate) kind: EditNodeKind,
    pub(crate) implementation: &'static str,
    pub(crate) shader_source: WgpuShaderSource,
    pub(crate) bind_group_layout: WgpuBindGroupLayoutKind,
    pub(crate) entry_point: &'static str,
    pub(crate) fused_phase: &'static str,
    pub(crate) resource_requirements: &'static [&'static str],
    pub(crate) halo_pixels: u16,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum WgpuDispatchPhase {
    Legacy,
    Scene,
    View,
    DisplayTransport,
}

impl WgpuDispatchPhase {
    pub(crate) const fn stable_id(self) -> &'static str {
        match self {
            Self::Legacy => "legacy",
            Self::Scene => "scene",
            Self::View => "view",
            Self::DisplayTransport => "display_transport",
        }
    }

    pub(crate) const fn shader_execution_phase(self) -> u32 {
        match self {
            Self::Legacy => 0,
            Self::Scene => 1,
            Self::View => 2,
            Self::DisplayTransport => 3,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WgpuDispatchGroup {
    pub(crate) phase: WgpuDispatchPhase,
    pub(crate) entry_point: &'static str,
    pub(crate) modules: Arc<[EditNodeKind]>,
    pub(crate) active_resources: Arc<[&'static str]>,
    pub(crate) max_halo_pixels: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WgpuNodeRuntime {
    modules: Arc<[WgpuNodeModule]>,
    fused_groups: Arc<[Arc<[EditNodeKind]>]>,
    dispatch_groups: Arc<[WgpuDispatchGroup]>,
    active_resources: Arc<[&'static str]>,
    max_halo_pixels: u16,
}

fn classify_dispatch_phase(
    pipeline_version: u32,
    modules: &[WgpuNodeModule],
) -> Result<WgpuDispatchPhase, &'static str> {
    let phases = modules
        .iter()
        .map(|module| module.fused_phase)
        .collect::<Vec<_>>();
    match pipeline_version {
        SCENE_REFERRED_PIPELINE_VERSION if phases.iter().all(|phase| *phase == "scene") => {
            Ok(WgpuDispatchPhase::Scene)
        }
        SCENE_REFERRED_PIPELINE_VERSION if phases.iter().all(|phase| *phase == "view") => {
            Ok(WgpuDispatchPhase::View)
        }
        SCENE_REFERRED_PIPELINE_VERSION
            if phases
                .iter()
                .all(|phase| matches!(*phase, "display" | "transport")) =>
        {
            Ok(WgpuDispatchPhase::DisplayTransport)
        }
        LEGACY_PIPELINE_VERSION
            if phases
                .iter()
                .all(|phase| matches!(*phase, "legacy" | "display" | "transport")) =>
        {
            Ok(WgpuDispatchPhase::Legacy)
        }
        _ => Err("edit_graph.wgpu_fused_phase_mismatch"),
    }
}

impl WgpuNodeRuntime {
    pub(crate) fn from_graph(graph: &CompiledEditGraph) -> Result<Self, &'static str> {
        graph.validate_contract()?;

        let mut modules = Vec::new();
        let mut active_resources = Vec::new();
        let mut max_halo_pixels = 0;
        for node in graph.nodes.iter() {
            let Some(implementation) = node.wgpu_implementation else {
                continue;
            };
            let descriptor = runtime_descriptor(node.kind);
            if descriptor.wgpu_implementation != Some(implementation) {
                return Err("edit_graph.wgpu_runtime_ownership_mismatch");
            }
            let shader_source = shader_source_for(implementation)?;
            let bind_group_layout = descriptor
                .wgpu_bind_group_layout
                .ok_or("edit_graph.wgpu_missing_bind_group_layout")?;
            if !bind_group_layout.accepts_resources(descriptor.resource_requirements) {
                return Err("edit_graph.wgpu_bind_group_layout_resource_mismatch");
            }
            if !shader_accepts_layout(shader_source, bind_group_layout) {
                return Err("edit_graph.wgpu_shader_layout_mismatch");
            }
            for resource in descriptor.resource_requirements {
                resource_kind(resource)?;
            }
            let halo_pixels = descriptor.wgpu_halo_pixels();
            let declared_halo = match node.spatial_support {
                SpatialSupport::Pointwise => 0,
                SpatialSupport::BoundedHalo { pixels } => pixels,
            };
            if declared_halo != halo_pixels {
                return Err("edit_graph.wgpu_halo_ownership_mismatch");
            }
            let module = WgpuNodeModule {
                kind: node.kind,
                implementation,
                shader_source,
                bind_group_layout,
                entry_point: descriptor
                    .wgpu_entry_point()
                    .ok_or("edit_graph.wgpu_missing_entry_point")?,
                fused_phase: descriptor
                    .fused_phase
                    .ok_or("edit_graph.wgpu_missing_fused_phase")?,
                resource_requirements: descriptor.resource_requirements,
                halo_pixels,
            };
            if modules
                .iter()
                .any(|existing: &WgpuNodeModule| existing.kind == module.kind)
            {
                return Err("edit_graph.wgpu_duplicate_module");
            }
            modules.push(module);
            max_halo_pixels = max_halo_pixels.max(halo_pixels);
            for resource in descriptor.resource_requirements {
                if !active_resources.contains(resource) {
                    active_resources.push(*resource);
                }
            }
        }

        let mut fused_groups: Vec<Arc<[EditNodeKind]>> = Vec::new();
        let mut dispatch_groups = Vec::new();
        for group in graph.receipt.fused_gpu_groups.iter() {
            let mut kinds = Vec::new();
            let mut group_modules = Vec::new();
            for stable_id in group.iter() {
                let Some(module) = modules
                    .iter()
                    .find(|module| module.kind.stable_id() == *stable_id)
                else {
                    return Err("edit_graph.wgpu_fused_group_missing_module");
                };
                if kinds.contains(&module.kind) {
                    return Err("edit_graph.wgpu_fused_group_duplicate_module");
                }
                kinds.push(module.kind);
                group_modules.push(*module);
            }
            if !kinds.is_empty() {
                let phase = classify_dispatch_phase(graph.pipeline_version, &group_modules)?;
                if group_modules
                    .iter()
                    .any(|module| module.entry_point != group_modules[0].entry_point)
                {
                    return Err("edit_graph.wgpu_fused_entry_point_mismatch");
                }
                let mut group_resources = Vec::new();
                for module in &group_modules {
                    for resource in module.resource_requirements {
                        if !group_resources.contains(resource) {
                            group_resources.push(*resource);
                        }
                    }
                }
                let kinds: Arc<[EditNodeKind]> = kinds.into();
                dispatch_groups.push(WgpuDispatchGroup {
                    phase,
                    entry_point: group_modules[0].entry_point,
                    modules: kinds.clone(),
                    active_resources: group_resources.into(),
                    max_halo_pixels: group_modules
                        .iter()
                        .map(|module| module.halo_pixels)
                        .max()
                        .unwrap_or(0),
                });
                fused_groups.push(kinds);
            }
        }
        let grouped_count: usize = fused_groups.iter().map(|group| group.len()).sum();
        if grouped_count != modules.len() {
            return Err("edit_graph.wgpu_fused_group_incomplete");
        }
        let expected_phases: &[WgpuDispatchPhase] = match graph.pipeline_version {
            SCENE_REFERRED_PIPELINE_VERSION => &[
                WgpuDispatchPhase::Scene,
                WgpuDispatchPhase::View,
                WgpuDispatchPhase::DisplayTransport,
            ],
            LEGACY_PIPELINE_VERSION => &[WgpuDispatchPhase::Legacy],
            _ => return Err("edit_graph.wgpu_unsupported_pipeline_version"),
        };
        let phases = dispatch_groups
            .iter()
            .map(|group| group.phase)
            .collect::<Vec<_>>();
        let phase_ranks = phases
            .iter()
            .map(|phase| {
                expected_phases
                    .iter()
                    .position(|expected| expected == phase)
            })
            .collect::<Option<Vec<_>>>()
            .ok_or("edit_graph.wgpu_dispatch_phase_order_mismatch")?;
        if phase_ranks.windows(2).any(|pair| pair[0] >= pair[1]) {
            return Err("edit_graph.wgpu_dispatch_phase_order_mismatch");
        }
        let dispatch_groups = expected_phases
            .iter()
            .map(|phase| {
                dispatch_groups
                    .iter()
                    .find(|group| group.phase == *phase)
                    .cloned()
                    .unwrap_or_else(|| WgpuDispatchGroup {
                        phase: *phase,
                        entry_point: "main",
                        modules: Arc::from([]),
                        active_resources: Arc::from([]),
                        max_halo_pixels: 0,
                    })
            })
            .collect::<Vec<_>>();

        Ok(Self {
            modules: modules.into(),
            fused_groups: fused_groups.into(),
            dispatch_groups: dispatch_groups.into(),
            active_resources: active_resources.into(),
            max_halo_pixels,
        })
    }

    pub(crate) fn modules(&self) -> &[WgpuNodeModule] {
        &self.modules
    }

    pub(crate) fn fused_groups(&self) -> &[Arc<[EditNodeKind]>] {
        &self.fused_groups
    }

    pub(crate) fn dispatch_groups(&self) -> &[WgpuDispatchGroup] {
        &self.dispatch_groups
    }

    pub(crate) fn validates_bound_resources(
        &self,
        has_lut: bool,
        mask_count: usize,
    ) -> Result<(), &'static str> {
        if has_lut && !self.active_resources.contains(&"display_lut_v1") {
            return Err("edit_graph.wgpu_lut_resource_without_owner");
        }
        if mask_count > 0 && !self.active_resources.contains(&"mask_layers_v1") {
            return Err("edit_graph.wgpu_mask_resource_without_owner");
        }
        Ok(())
    }

    pub(crate) fn execution_fingerprint(&self) -> u64 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"rapidraw.wgpu-node-runtime.v1");
        for group in self.dispatch_groups.iter() {
            hasher.update(group.phase.stable_id().as_bytes());
            hasher.update(group.entry_point.as_bytes());
            for kind in group.modules.iter() {
                hasher.update(kind.stable_id().as_bytes());
            }
            for resource in group.active_resources.iter() {
                hasher.update(resource.as_bytes());
            }
            hasher.update(&group.max_halo_pixels.to_le_bytes());
        }
        u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
    }

    pub(crate) fn active_resources(&self) -> &[&'static str] {
        &self.active_resources
    }

    pub(crate) fn max_halo_pixels(&self) -> u16 {
        self.max_halo_pixels
    }

    pub(crate) fn diagnostic_receipt(&self) -> serde_json::Value {
        serde_json::json!({
            "modules": self.modules.iter().map(|module| serde_json::json!({
                "id": module.kind.stable_id(),
                "implementation": module.implementation,
                "shaderSource": format!("{:?}", module.shader_source),
                "bindGroupLayout": module.bind_group_layout.stable_id(),
                "entryPoint": module.entry_point,
                "fusedPhase": module.fused_phase,
                "resourceRequirements": module.resource_requirements,
                "resourceBindings": module.resource_requirements.iter().map(|resource| {
                    serde_json::json!({
                        "id": resource,
                        "kind": resource_kind(resource)
                            .expect("WGPU runtime validated every resource")
                            .stable_id(),
                    })
                }).collect::<Vec<_>>(),
                "haloPixels": module.halo_pixels,
            })).collect::<Vec<_>>(),
            "fusedGroups": self.fused_groups.iter().map(|group| {
                group.iter().map(|kind| kind.stable_id()).collect::<Vec<_>>()
            }).collect::<Vec<_>>(),
            "dispatchGroups": self.dispatch_groups.iter().map(|group| serde_json::json!({
                "phase": group.phase.stable_id(),
                "shaderExecutionPhase": group.phase.shader_execution_phase(),
                "entryPoint": group.entry_point,
                "modules": group.modules.iter().map(|kind| kind.stable_id()).collect::<Vec<_>>(),
                "activeResources": group.active_resources,
                "maxHaloPixels": group.max_halo_pixels,
            })).collect::<Vec<_>>(),
            "executionFingerprint": format!("{:016x}", self.execution_fingerprint()),
            "activeResources": self.active_resources,
            "maxHaloPixels": self.max_halo_pixels,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adjustments::abi::AllAdjustments;
    use crate::edit_graph::{EditGraphCompileInputs, SCENE_REFERRED_PIPELINE_VERSION};
    use crate::tone::curves::{CurveChannelMode, CurvePoint, compile_scene_curve};
    use crate::tone::output_curves::{OutputCurvePoint, OutputCurveTargetV1, compile_output_curve};

    fn graph_with_curves_and_local_resources() -> crate::edit_graph::CompiledEditGraph {
        let adjustments = AllAdjustments::default();
        let scene_curve = compile_scene_curve(
            &[
                CurvePoint {
                    x_ev: -2.0,
                    y_ev: -1.0,
                },
                CurvePoint {
                    x_ev: 2.0,
                    y_ev: 1.0,
                },
            ],
            0.18,
            CurveChannelMode::LinkedRgb,
        )
        .unwrap();
        let output_curve = compile_output_curve(
            OutputCurveTargetV1::view_encoded(1, 100.0, 100.0),
            &[
                OutputCurvePoint {
                    input: 0.0,
                    output: 0.0,
                },
                OutputCurvePoint {
                    input: 1.0,
                    output: 1.0,
                },
            ],
        )
        .unwrap();
        crate::edit_graph::CompiledEditGraph::compile(EditGraphCompileInputs {
            pipeline_version: SCENE_REFERRED_PIPELINE_VERSION,
            version_was_explicit: true,
            source_fingerprint: 1,
            geometry_fingerprint: 2,
            retouch_fingerprint: 3,
            detail_fingerprint: 4,
            color_fingerprint: 5,
            output_fingerprint: 6,
            adjustments: &adjustments,
            neutral_adjustments: &AllAdjustments {
                global: crate::adjustments::abi::GlobalAdjustments {
                    exposure: 1.0,
                    ..adjustments.global
                },
                ..adjustments
            },
            scene_curve: Some(&scene_curve),
            film_emulation: None,
            output_curve: Some(&output_curve),
            has_geometry_or_retouch: true,
            has_detail: true,
            has_masks: true,
            has_lut: true,
            show_clipping: false,
        })
    }

    fn graph_without_bound_resources() -> crate::edit_graph::CompiledEditGraph {
        let adjustments = AllAdjustments::default();
        crate::edit_graph::CompiledEditGraph::compile(EditGraphCompileInputs {
            pipeline_version: SCENE_REFERRED_PIPELINE_VERSION,
            version_was_explicit: true,
            source_fingerprint: 1,
            geometry_fingerprint: 2,
            retouch_fingerprint: 3,
            detail_fingerprint: 4,
            color_fingerprint: 5,
            output_fingerprint: 6,
            adjustments: &adjustments,
            neutral_adjustments: &adjustments,
            scene_curve: None,
            film_emulation: None,
            output_curve: None,
            has_geometry_or_retouch: false,
            has_detail: false,
            has_masks: false,
            has_lut: false,
            show_clipping: false,
        })
    }

    #[test]
    fn shader_source_registry_fails_closed_for_unknown_implementation() {
        assert_eq!(
            shader_source_for("film_emulation_wgsl_v1"),
            Ok(WgpuShaderSource::External)
        );
        assert_eq!(
            shader_source_for("shader_wgsl_scene_phase_v2"),
            Ok(WgpuShaderSource::FusedProduction)
        );
        assert_eq!(
            shader_source_for("shader_wgsl_unregistered_v9"),
            Err("edit_graph.wgpu_shader_source_unknown")
        );
        assert_eq!(
            shader_source_for("unregistered_wgpu_implementation_v9"),
            Err("edit_graph.wgpu_shader_source_unknown")
        );
    }

    #[test]
    fn graph_owns_fused_modules_resources_and_halo() {
        let graph = graph_with_curves_and_local_resources();
        let runtime = WgpuNodeRuntime::from_graph(&graph).unwrap();
        assert!(
            runtime
                .modules()
                .iter()
                .any(|module| module.kind == EditNodeKind::SceneCurve)
        );
        assert!(
            runtime
                .modules()
                .iter()
                .any(|module| module.kind == EditNodeKind::OutputCurve)
        );
        assert!(runtime.active_resources().contains(&"scene_guidance_v1"));
        assert_eq!(runtime.max_halo_pixels(), 64);
        assert_eq!(
            runtime
                .fused_groups()
                .iter()
                .map(|group| group.len())
                .sum::<usize>(),
            runtime.modules().len()
        );
        assert_eq!(
            runtime
                .dispatch_groups()
                .iter()
                .map(|group| group.phase)
                .collect::<Vec<_>>(),
            vec![
                WgpuDispatchPhase::Scene,
                WgpuDispatchPhase::View,
                WgpuDispatchPhase::DisplayTransport,
            ]
        );
        assert!(
            runtime
                .dispatch_groups()
                .iter()
                .all(|group| group.entry_point == "main" && !group.modules.is_empty())
        );
        assert_ne!(runtime.execution_fingerprint(), 0);
        let scene_curve = runtime
            .modules()
            .iter()
            .find(|module| module.kind == EditNodeKind::SceneCurve)
            .expect("scene curve module is present");
        assert_eq!(
            scene_curve.bind_group_layout,
            WgpuBindGroupLayoutKind::CurveStorageV1
        );
    }

    #[test]
    fn dispatch_registry_rejects_cross_phase_fusion() {
        let mut graph = graph_with_curves_and_local_resources();
        let mut groups = graph.receipt.fused_gpu_groups.to_vec();
        groups[0] = Arc::from([
            EditNodeKind::SceneGlobalColorTone.stable_id(),
            EditNodeKind::SceneToViewTransform.stable_id(),
        ]);
        graph.receipt.fused_gpu_groups = groups.into();
        assert_eq!(
            WgpuNodeRuntime::from_graph(&graph),
            Err("edit_graph.wgpu_fused_phase_mismatch")
        );
    }

    #[test]
    fn runtime_validates_bound_resource_ownership() {
        let local_runtime = WgpuNodeRuntime::from_graph(&graph_with_curves_and_local_resources())
            .expect("local graph has a WGPU runtime");
        assert_eq!(local_runtime.validates_bound_resources(false, 1), Ok(()));
        assert_eq!(local_runtime.validates_bound_resources(true, 1), Ok(()));

        let neutral_runtime = WgpuNodeRuntime::from_graph(&graph_without_bound_resources())
            .expect("neutral graph has a WGPU runtime");
        assert_eq!(neutral_runtime.validates_bound_resources(false, 0), Ok(()));
        assert_eq!(
            neutral_runtime.validates_bound_resources(true, 0),
            Err("edit_graph.wgpu_lut_resource_without_owner")
        );
        assert_eq!(
            neutral_runtime.validates_bound_resources(false, 1),
            Err("edit_graph.wgpu_mask_resource_without_owner")
        );
    }

    #[test]
    fn shader_and_bind_group_layout_contract_fails_closed_on_drift() {
        assert!(shader_accepts_layout(
            WgpuShaderSource::FusedProduction,
            WgpuBindGroupLayoutKind::FusedSceneSpatialV2
        ));
        assert!(!shader_accepts_layout(
            WgpuShaderSource::SceneCurve,
            WgpuBindGroupLayoutKind::FusedSceneSpatialV2
        ));
        assert!(
            WgpuBindGroupLayoutKind::FusedSceneSpatialV2.accepts_resources(&["scene_guidance_v1"])
        );
        assert!(!WgpuBindGroupLayoutKind::CurveStorageV1.accepts_resources(&["scene_guidance_v1"]));
    }

    #[test]
    fn rejects_graph_halo_drift_from_registered_wgpu_owner() {
        let mut graph = graph_with_curves_and_local_resources();
        let mut nodes = graph.nodes.to_vec();
        let curve = nodes
            .iter_mut()
            .find(|node| node.kind == EditNodeKind::SceneCurve)
            .expect("scene curve node is present");
        curve.spatial_support = SpatialSupport::BoundedHalo { pixels: 64 };
        graph.nodes = nodes.into();
        assert_eq!(
            WgpuNodeRuntime::from_graph(&graph),
            Err("edit_graph.wgpu_halo_ownership_mismatch")
        );
    }

    #[test]
    fn registered_halo_sizes_match_compiled_graph_spatial_support() {
        let graph = graph_with_curves_and_local_resources();
        let runtime = WgpuNodeRuntime::from_graph(&graph).unwrap();
        for module in runtime.modules() {
            let node = graph
                .nodes
                .iter()
                .find(|node| node.kind == module.kind)
                .expect("every WGPU module must have a graph owner");
            let declared_halo = match node.spatial_support {
                SpatialSupport::Pointwise => 0,
                SpatialSupport::BoundedHalo { pixels } => pixels,
            };
            assert_eq!(module.halo_pixels, declared_halo);
        }
    }

    #[test]
    fn resource_registry_fails_closed_for_unknown_resources() {
        for descriptor in crate::edit_graph::EDIT_NODE_RUNTIME_REGISTRY
            .iter()
            .filter(|descriptor| descriptor.wgpu_implementation.is_some())
        {
            for resource in descriptor.resource_requirements {
                resource_kind(resource).unwrap_or_else(|error| {
                    panic!(
                        "{} has unregistered WGPU resource {resource}: {error}",
                        descriptor.kind.stable_id()
                    )
                });
            }
        }
        assert_eq!(
            resource_kind("scene_guidance_v1"),
            Ok(WgpuResourceKind::SampledTexture2d)
        );
        assert_eq!(
            resource_kind("display_lut_v1"),
            Ok(WgpuResourceKind::SampledTexture3d)
        );
        assert_eq!(
            resource_kind("mask_layers_v1"),
            Ok(WgpuResourceKind::SampledTexture2dArray)
        );
        assert_eq!(
            resource_kind("future_unregistered_resource_v1"),
            Err("edit_graph.wgpu_unknown_resource_kind")
        );
    }

    #[test]
    fn registered_resource_kinds_create_the_physical_shader_dimensions() {
        let dimension = |resource| match resource_binding_type(resource).unwrap() {
            wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension,
                multisampled: false,
            } => view_dimension,
            other => panic!("unexpected binding type for {resource}: {other:?}"),
        };
        assert_eq!(
            dimension("scene_guidance_v1"),
            wgpu::TextureViewDimension::D2
        );
        assert_eq!(
            dimension("legacy_scene_blur_v1"),
            wgpu::TextureViewDimension::D2
        );
        assert_eq!(
            dimension("view_transform_lut_v1"),
            wgpu::TextureViewDimension::D3
        );
        assert_eq!(dimension("display_lut_v1"), wgpu::TextureViewDimension::D3);
        assert_eq!(
            dimension("mask_layers_v1"),
            wgpu::TextureViewDimension::D2Array
        );
    }

    #[test]
    fn curve_modules_expose_real_wgsl_entry_points_for_parity_vectors() {
        let graph = graph_with_curves_and_local_resources();
        let runtime = WgpuNodeRuntime::from_graph(&graph).unwrap();
        for module in runtime.modules() {
            assert_eq!(
                module.halo_pixels,
                runtime_descriptor(module.kind).wgpu_halo_pixels()
            );
            assert_eq!(
                runtime_descriptor(module.kind).wgpu_entry_point(),
                Some(module.entry_point)
            );
            if matches!(
                module.kind,
                EditNodeKind::SceneCurve | EditNodeKind::OutputCurve
            ) {
                assert_eq!(module.entry_point, "main");
                assert!(module.implementation.ends_with("_wgsl_v1"));
                assert_eq!(
                    module.shader_source,
                    if module.kind == EditNodeKind::SceneCurve {
                        WgpuShaderSource::SceneCurve
                    } else {
                        WgpuShaderSource::OutputCurve
                    }
                );
            }
        }
        assert!(crate::tone::curves::SCENE_CURVE_WGSL.contains("fn main"));
        assert!(crate::tone::output_curves::OUTPUT_CURVE_WGSL.contains("fn main"));
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn executable_modules_create_real_wgpu_pipelines_from_registered_sources() {
        let graph = graph_with_curves_and_local_resources();
        let runtime = WgpuNodeRuntime::from_graph(&graph).unwrap();
        let instance =
            wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            ..Default::default()
        }))
        .expect("WGPU adapter is available for registered curve modules");
        let (device, _queue) =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                label: Some("registered curve module validation device"),
                required_features: wgpu::Features::empty(),
                required_limits: adapter.limits(),
                experimental_features: wgpu::ExperimentalFeatures::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            }))
            .expect("WGPU device is available for registered curve modules");

        let mut validated = 0;
        for module in runtime.modules() {
            let Some(source) = module.shader_source.wgsl() else {
                continue;
            };
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(module.implementation),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
            let bind_group_layout = (module.bind_group_layout
                == WgpuBindGroupLayoutKind::CurveStorageV1)
                .then(|| create_curve_bind_group_layout(&device, module.kind).unwrap());
            let pipeline_layout = bind_group_layout.as_ref().map(|layout| {
                device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some(module.bind_group_layout.stable_id()),
                    bind_group_layouts: &[Some(layout)],
                    immediate_size: 0,
                })
            });
            let _pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(module.implementation),
                layout: pipeline_layout.as_ref(),
                module: &shader,
                entry_point: Some(module.entry_point),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: None,
            });
            validated += 1;
        }
        assert!(validated >= 4, "validated={validated}");
    }
}
