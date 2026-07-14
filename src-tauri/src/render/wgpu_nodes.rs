//! WGPU ownership derived from the compiled edit graph.
//!
//! The renderer may fuse several nodes into one dispatch, but resource
//! ownership remains inspectable at node granularity.  Keeping this receipt
//! next to the graph prevents a new typed node from silently relying on a
//! second, handwritten GPU ordering table.

use std::sync::Arc;

use crate::edit_graph::{CompiledEditGraph, EditNodeKind, SpatialSupport, runtime_descriptor};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WgpuNodeModule {
    pub(crate) kind: EditNodeKind,
    pub(crate) implementation: &'static str,
    pub(crate) entry_point: &'static str,
    pub(crate) fused_phase: &'static str,
    pub(crate) resource_requirements: &'static [&'static str],
    pub(crate) halo_pixels: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WgpuNodeRuntime {
    modules: Arc<[WgpuNodeModule]>,
    fused_groups: Arc<[Arc<[EditNodeKind]>]>,
    active_resources: Arc<[&'static str]>,
    max_halo_pixels: u16,
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
            let halo_pixels = match node.spatial_support {
                SpatialSupport::Pointwise => 0,
                SpatialSupport::BoundedHalo { pixels } => pixels,
            };
            let module = WgpuNodeModule {
                kind: node.kind,
                implementation,
                // The current production shader keeps compatible nodes fused
                // behind one entry point.  Curve modules have standalone WGSL
                // test pipelines, whose entry point is also `main`.
                entry_point: "main",
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
        for group in graph.receipt.fused_gpu_groups.iter() {
            let mut kinds = Vec::new();
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
            }
            if !kinds.is_empty() {
                fused_groups.push(Arc::from(kinds));
            }
        }
        let grouped_count: usize = fused_groups.iter().map(|group| group.len()).sum();
        if grouped_count != modules.len() {
            return Err("edit_graph.wgpu_fused_group_incomplete");
        }

        Ok(Self {
            modules: modules.into(),
            fused_groups: fused_groups.into(),
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
                "entryPoint": module.entry_point,
                "fusedPhase": module.fused_phase,
                "resourceRequirements": module.resource_requirements,
                "haloPixels": module.halo_pixels,
            })).collect::<Vec<_>>(),
            "fusedGroups": self.fused_groups.iter().map(|group| {
                group.iter().map(|kind| kind.stable_id()).collect::<Vec<_>>()
            }).collect::<Vec<_>>(),
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
            has_lut: false,
            show_clipping: false,
        })
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
    }

    #[test]
    fn curve_modules_expose_real_wgsl_entry_points_for_parity_vectors() {
        let graph = graph_with_curves_and_local_resources();
        let runtime = WgpuNodeRuntime::from_graph(&graph).unwrap();
        for module in runtime.modules() {
            if matches!(
                module.kind,
                EditNodeKind::SceneCurve | EditNodeKind::OutputCurve
            ) {
                assert_eq!(module.entry_point, "main");
                assert!(module.implementation.ends_with("_wgsl_v1"));
            }
        }
        assert!(crate::tone::curves::SCENE_CURVE_WGSL.contains("fn main"));
        assert!(crate::tone::output_curves::OUTPUT_CURVE_WGSL.contains("fn main"));
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn curve_modules_create_real_wgpu_pipelines_from_registered_sources() {
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

        for module in runtime.modules() {
            let source = match module.kind {
                EditNodeKind::SceneCurve => crate::tone::curves::SCENE_CURVE_WGSL,
                EditNodeKind::OutputCurve => crate::tone::output_curves::OUTPUT_CURVE_WGSL,
                _ => continue,
            };
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(module.implementation),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
            let _pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(module.implementation),
                layout: None,
                module: &shader,
                entry_point: Some(module.entry_point),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: None,
            });
        }
    }
}
