//! CPU executors selected directly from compiled graph nodes.
//!
//! The production CPU loop still fuses compatible pointwise work for cache
//! locality. This registry owns the node-specific dispatch points so adding a
//! typed node cannot silently require a second handwritten ordering list.

use glam::Vec3;

use crate::edit_graph::{CompiledEditGraph, CompiledNodePayload, EditNodeKind};
use crate::tone::curves::CompiledCurvePlanV1;
use crate::tone::output_curves::CompiledOutputCurvePlanV1;

#[derive(Clone, Debug)]
pub(crate) enum CpuNodeExecutor {
    SceneCurve(CompiledCurvePlanV1),
    OutputCurve(CompiledOutputCurvePlanV1),
}

impl CpuNodeExecutor {
    pub(crate) fn kind(&self) -> EditNodeKind {
        match self {
            Self::SceneCurve(_) => EditNodeKind::SceneCurve,
            Self::OutputCurve(_) => EditNodeKind::OutputCurve,
        }
    }

    pub(crate) fn apply(&self, color: Vec3) -> Vec3 {
        match self {
            Self::SceneCurve(plan) => Vec3::from_array(plan.evaluate_rgb(color.to_array())),
            Self::OutputCurve(plan) => Vec3::from_array(plan.evaluate_rgb(color.to_array())),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct CpuNodeRuntime {
    scene_curve: Option<CpuNodeExecutor>,
    output_curve: Option<CpuNodeExecutor>,
}

impl CpuNodeRuntime {
    pub(crate) fn from_graph(graph: &CompiledEditGraph) -> Result<Self, &'static str> {
        let mut runtime = Self::default();
        for node in graph.nodes.iter() {
            let executor = match (&node.payload, node.kind) {
                (CompiledNodePayload::SceneCurve(plan), EditNodeKind::SceneCurve) => {
                    CpuNodeExecutor::SceneCurve(plan.clone())
                }
                (CompiledNodePayload::OutputCurve(plan), EditNodeKind::OutputCurve) => {
                    CpuNodeExecutor::OutputCurve(plan.clone())
                }
                _ => continue,
            };
            match executor.kind() {
                EditNodeKind::SceneCurve if runtime.scene_curve.is_none() => {
                    runtime.scene_curve = Some(executor);
                }
                EditNodeKind::OutputCurve if runtime.output_curve.is_none() => {
                    runtime.output_curve = Some(executor);
                }
                EditNodeKind::SceneCurve | EditNodeKind::OutputCurve => {
                    return Err("edit_graph.cpu_node_duplicate_executor");
                }
                _ => unreachable!("only curve nodes are registered by this runtime slice"),
            }
        }
        Ok(runtime)
    }

    pub(crate) fn scene_curve(&self) -> Option<&CpuNodeExecutor> {
        self.scene_curve.as_ref()
    }

    pub(crate) fn output_curve(&self) -> Option<&CpuNodeExecutor> {
        self.output_curve.as_ref()
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
        assert_eq!(
            runtime.scene_curve().unwrap().kind(),
            EditNodeKind::SceneCurve
        );
        assert_eq!(
            runtime.output_curve().unwrap().kind(),
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
}
