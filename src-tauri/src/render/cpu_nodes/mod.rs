//! CPU executors selected directly from compiled graph nodes.
//!
//! The production CPU loop still fuses compatible pointwise work for cache
//! locality. This registry owns the node-specific dispatch points so adding a
//! typed node cannot silently require a second handwritten ordering list.

use glam::Vec3;

use crate::edit_graph::{CompiledEditGraph, CompiledNodePayload, EditNodeKind, runtime_descriptor};
use crate::tone::curves::CompiledCurvePlanV1;
use crate::tone::output_curves::CompiledOutputCurvePlanV1;

#[derive(Clone, Debug)]
pub(crate) enum CpuNodeExecutor {
    SceneCurve(CompiledCurvePlanV1),
    OutputCurve(CompiledOutputCurvePlanV1),
}

impl CpuNodeExecutor {
    pub(crate) fn apply(&self, color: Vec3) -> Vec3 {
        match self {
            Self::SceneCurve(plan) => Vec3::from_array(plan.evaluate_rgb(color.to_array())),
            Self::OutputCurve(plan) => Vec3::from_array(plan.evaluate_rgb(color.to_array())),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CpuNodeBinding {
    kind: EditNodeKind,
    implementation: &'static str,
    resource_requirements: &'static [&'static str],
    executor: Option<CpuNodeExecutor>,
}

impl CpuNodeBinding {
    pub(crate) fn executor(&self) -> Option<&CpuNodeExecutor> {
        self.executor.as_ref()
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct CpuNodeRuntime {
    bindings: Vec<CpuNodeBinding>,
}

impl CpuNodeRuntime {
    pub(crate) fn from_graph(graph: &CompiledEditGraph) -> Result<Self, &'static str> {
        let mut runtime = Self::default();
        for node in graph.nodes.iter() {
            let Some(implementation) = node.cpu_implementation else {
                continue;
            };
            let descriptor = runtime_descriptor(node.kind);
            if descriptor.cpu_implementation != Some(implementation) {
                return Err("edit_graph.cpu_runtime_ownership_mismatch");
            }
            if runtime
                .bindings
                .iter()
                .any(|binding| binding.kind == node.kind)
            {
                return Err("edit_graph.cpu_node_duplicate_executor");
            }
            let executor = match (&node.payload, node.kind) {
                (CompiledNodePayload::SceneCurve(plan), EditNodeKind::SceneCurve) => {
                    Some(CpuNodeExecutor::SceneCurve(plan.clone()))
                }
                (CompiledNodePayload::OutputCurve(plan), EditNodeKind::OutputCurve) => {
                    Some(CpuNodeExecutor::OutputCurve(plan.clone()))
                }
                _ => None,
            };
            let binding = CpuNodeBinding {
                kind: node.kind,
                implementation,
                resource_requirements: descriptor.resource_requirements,
                executor,
            };
            if binding.implementation != implementation {
                return Err("edit_graph.cpu_runtime_binding_mismatch");
            }
            runtime.bindings.push(binding);
        }
        Ok(runtime)
    }

    pub(crate) fn binding(&self, kind: EditNodeKind) -> Option<&CpuNodeBinding> {
        self.bindings.iter().find(|binding| binding.kind == kind)
    }

    pub(crate) fn diagnostic_receipt(&self) -> serde_json::Value {
        let mut active_resources = Vec::new();
        for binding in &self.bindings {
            for resource in binding.resource_requirements {
                if !active_resources.contains(resource) {
                    active_resources.push(*resource);
                }
            }
        }
        serde_json::json!({
            "bindings": self.bindings.iter().map(|binding| serde_json::json!({
                "id": binding.kind.stable_id(),
                "implementation": binding.implementation,
                "resourceRequirements": binding.resource_requirements,
                "typedExecutor": binding.executor.is_some(),
            })).collect::<Vec<_>>(),
            "activeResources": active_resources,
        })
    }

    pub(crate) fn scene_curve(&self) -> Option<&CpuNodeExecutor> {
        self.binding(EditNodeKind::SceneCurve)
            .and_then(CpuNodeBinding::executor)
    }

    pub(crate) fn output_curve(&self) -> Option<&CpuNodeExecutor> {
        self.binding(EditNodeKind::OutputCurve)
            .and_then(CpuNodeBinding::executor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit_graph::{EditGraphCompileInputs, SCENE_REFERRED_PIPELINE_VERSION};
    use crate::tone::curves::{CurveChannelMode, CurvePoint, compile_scene_curve};
    use crate::tone::output_curves::{OutputCurvePoint, OutputCurveTargetV1, compile_output_curve};

    #[test]
    fn graph_nodes_select_curve_executors_without_a_second_order_list() {
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
        let adjustments = crate::adjustments::abi::AllAdjustments::default();
        let graph = CompiledEditGraph::compile(EditGraphCompileInputs {
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
            scene_curve: Some(&scene_curve),
            film_emulation: None,
            output_curve: Some(&output_curve),
            has_geometry_or_retouch: false,
            has_detail: false,
            has_masks: false,
            has_lut: false,
            show_clipping: false,
        });
        let runtime = CpuNodeRuntime::from_graph(&graph).unwrap();
        for node in graph.nodes.iter() {
            let Some(implementation) = node.cpu_implementation else {
                continue;
            };
            let binding = runtime
                .binding(node.kind)
                .expect("every CPU-owned graph node has one runtime binding");
            assert_eq!(binding.implementation, implementation);
            assert_eq!(binding.kind, node.kind);
        }
        assert_eq!(
            runtime.binding(EditNodeKind::SceneCurve).unwrap().kind,
            EditNodeKind::SceneCurve
        );
        assert_eq!(
            runtime.binding(EditNodeKind::OutputCurve).unwrap().kind,
            EditNodeKind::OutputCurve
        );
        let input = Vec3::new(0.18, 0.32, 0.64);
        assert_eq!(
            runtime.scene_curve().unwrap().apply(input).to_array(),
            scene_curve.evaluate_rgb(input.to_array())
        );
        assert_eq!(
            runtime.output_curve().unwrap().apply(input).to_array(),
            output_curve.evaluate_rgb(input.to_array())
        );
    }

    #[test]
    fn cpu_resource_receipts_follow_active_graph_node_descriptors() {
        let adjustments = crate::adjustments::abi::AllAdjustments::default();
        let graph = CompiledEditGraph::compile(EditGraphCompileInputs {
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
            has_geometry_or_retouch: true,
            has_detail: true,
            has_masks: false,
            has_lut: false,
            show_clipping: false,
        });
        let runtime = CpuNodeRuntime::from_graph(&graph).unwrap();
        let receipt = runtime.diagnostic_receipt();
        let resources = receipt["activeResources"]
            .as_array()
            .expect("CPU resource receipt is an array");
        assert!(
            resources
                .iter()
                .any(|resource| resource == "geometry_tiles_v1")
        );
        assert!(
            resources
                .iter()
                .any(|resource| resource == "detail_guidance_v1")
        );
    }
}
