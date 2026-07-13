//! Versioned execution contract for the production edit pipeline.
//!
//! The current GPU shader remains a fused compatibility executor. This graph is
//! authoritative for ordering, domains, cache identity, and whether that fused
//! executor is legal for a compiled render plan.

use std::sync::Arc;

use bytemuck::bytes_of;

use crate::adjustments::abi::AllAdjustments;

pub const EDIT_GRAPH_SCHEMA_VERSION: u32 = 1;
pub const LEGACY_PIPELINE_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ColorDomain {
    AcesCgSceneLinearExtended,
    ViewEncoded,
    RenderTransportEncoded,
}

impl ColorDomain {
    pub fn contract_id(self) -> &'static str {
        match self {
            Self::AcesCgSceneLinearExtended => "acescg_scene_linear_extended_v1",
            Self::ViewEncoded => "display_encoded_srgb_v1",
            Self::RenderTransportEncoded => "render_transport_encoded_v1",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum EditStageClass {
    InputTransform,
    SceneTechnical,
    SpatialDetail,
    LegacyFusedSceneView,
    DisplayAdjustment,
    OutputTransform,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ValueRangePolicy {
    PreserveFiniteExtended,
    LegacyImplementationDefined,
    BoundForOutputEncoding,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum AlphaPolicy {
    PreserveStraight,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PrecisionPolicy {
    Float16OrBetter,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SpatialSupport {
    Pointwise,
    BoundedHalo { pixels: u16 },
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LocalAdjustmentPolicy {
    GlobalOnly,
    GlobalAndLocalSameDomain,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum EditNodeKind {
    CameraInputBoundary,
    GeometryRetouch,
    PreGpuSpatialDetail,
    LegacyGpuSceneViewPass,
    ClippingOverlay,
    RenderTransport,
}

impl EditNodeKind {
    pub fn stable_id(self) -> &'static str {
        match self {
            Self::CameraInputBoundary => "camera_input_boundary",
            Self::GeometryRetouch => "geometry_retouch",
            Self::PreGpuSpatialDetail => "pre_gpu_spatial_detail",
            Self::LegacyGpuSceneViewPass => "legacy_gpu_scene_view_pass",
            Self::ClippingOverlay => "clipping_overlay",
            Self::RenderTransport => "render_transport",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub struct NodeDependencies {
    pub source: bool,
    pub adjustments: bool,
    pub geometry: bool,
    pub masks: bool,
    pub view: bool,
    pub output: bool,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct CompiledEditNode {
    pub kind: EditNodeKind,
    pub schema_version: u32,
    pub implementation_version: u32,
    pub input_domain: ColorDomain,
    pub output_domain: ColorDomain,
    pub stage_class: EditStageClass,
    pub range_policy: ValueRangePolicy,
    pub alpha_policy: AlphaPolicy,
    pub precision: PrecisionPolicy,
    pub dependencies: NodeDependencies,
    pub spatial_support: SpatialSupport,
    pub local_adjustment_policy: LocalAdjustmentPolicy,
    pub cpu_implementation: Option<&'static str>,
    pub wgpu_implementation: Option<&'static str>,
    pub payload_fingerprint: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EditGraphReceipt {
    pub schema_version: u32,
    pub pipeline_version: u32,
    pub migration: EditGraphMigration,
    pub ordered_node_ids: Arc<[&'static str]>,
    pub omitted_no_op_node_ids: Arc<[&'static str]>,
    pub fused_gpu_groups: Arc<[Arc<[&'static str]>]>,
    pub input_domain: ColorDomain,
    pub output_domain: ColorDomain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EditGraphMigration {
    LegacyV1Defaulted,
    LegacyV1Explicit,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompiledEditGraph {
    pub schema_version: u32,
    pub pipeline_version: u32,
    pub nodes: Arc<[CompiledEditNode]>,
    pub fingerprint: u64,
    pub execution_abi_fingerprint: u64,
    pub receipt: EditGraphReceipt,
}

#[derive(Clone, Copy)]
pub struct EditGraphCompileInputs<'a> {
    pub pipeline_version: u32,
    pub version_was_explicit: bool,
    pub source_fingerprint: u64,
    pub geometry_fingerprint: u64,
    pub retouch_fingerprint: u64,
    pub detail_fingerprint: u64,
    pub color_fingerprint: u64,
    pub output_fingerprint: u64,
    pub adjustments: &'a AllAdjustments,
    pub neutral_adjustments: &'a AllAdjustments,
    pub has_geometry_or_retouch: bool,
    pub has_detail: bool,
    pub has_masks: bool,
    pub has_lut: bool,
    pub show_clipping: bool,
}

impl CompiledEditGraph {
    pub fn compile(inputs: EditGraphCompileInputs<'_>) -> Self {
        let mut nodes = Vec::with_capacity(7);
        let mut omitted = Vec::new();
        nodes.push(node(
            EditNodeKind::CameraInputBoundary,
            ColorDomain::AcesCgSceneLinearExtended,
            ColorDomain::AcesCgSceneLinearExtended,
            EditStageClass::InputTransform,
            ValueRangePolicy::PreserveFiniteExtended,
            SpatialSupport::Pointwise,
            LocalAdjustmentPolicy::GlobalOnly,
            NodeDependencies {
                source: true,
                ..NodeDependencies::default()
            },
            Some("camera_input_transform_v1"),
            None,
            inputs.source_fingerprint,
        ));
        if inputs.has_geometry_or_retouch {
            nodes.push(node(
                EditNodeKind::GeometryRetouch,
                ColorDomain::AcesCgSceneLinearExtended,
                ColorDomain::AcesCgSceneLinearExtended,
                EditStageClass::SceneTechnical,
                ValueRangePolicy::PreserveFiniteExtended,
                SpatialSupport::BoundedHalo { pixels: 32 },
                LocalAdjustmentPolicy::GlobalOnly,
                NodeDependencies {
                    source: true,
                    geometry: true,
                    adjustments: true,
                    ..NodeDependencies::default()
                },
                Some("geometry_retouch_cpu_v2"),
                None,
                combine(&[inputs.geometry_fingerprint, inputs.retouch_fingerprint]),
            ));
        } else {
            omitted.push(EditNodeKind::GeometryRetouch.stable_id());
        }
        if inputs.has_detail {
            nodes.push(node(
                EditNodeKind::PreGpuSpatialDetail,
                ColorDomain::AcesCgSceneLinearExtended,
                ColorDomain::AcesCgSceneLinearExtended,
                EditStageClass::SpatialDetail,
                ValueRangePolicy::PreserveFiniteExtended,
                SpatialSupport::BoundedHalo { pixels: 64 },
                LocalAdjustmentPolicy::GlobalOnly,
                NodeDependencies {
                    adjustments: true,
                    source: true,
                    ..NodeDependencies::default()
                },
                Some("pre_gpu_detail_cpu_v1"),
                None,
                inputs.detail_fingerprint,
            ));
        } else {
            omitted.push(EditNodeKind::PreGpuSpatialDetail.stable_id());
        }
        let gpu_adjustments_active = bytes_of(inputs.adjustments)
            != bytes_of(inputs.neutral_adjustments)
            || inputs.has_masks
            || inputs.has_lut;
        nodes.push(node(
            EditNodeKind::LegacyGpuSceneViewPass,
            ColorDomain::AcesCgSceneLinearExtended,
            ColorDomain::ViewEncoded,
            EditStageClass::LegacyFusedSceneView,
            ValueRangePolicy::LegacyImplementationDefined,
            SpatialSupport::BoundedHalo { pixels: 64 },
            LocalAdjustmentPolicy::GlobalAndLocalSameDomain,
            NodeDependencies {
                source: true,
                masks: inputs.has_masks,
                view: true,
                adjustments: true,
                ..NodeDependencies::default()
            },
            Some("native_color_mixer_post_wgpu_v1"),
            Some("shader_wgsl_legacy_scene_view_v1"),
            combine(&[
                inputs.color_fingerprint,
                inputs.output_fingerprint,
                u64::from(gpu_adjustments_active),
            ]),
        ));
        if inputs.show_clipping {
            nodes.push(node(
                EditNodeKind::ClippingOverlay,
                ColorDomain::ViewEncoded,
                ColorDomain::ViewEncoded,
                EditStageClass::DisplayAdjustment,
                ValueRangePolicy::LegacyImplementationDefined,
                SpatialSupport::Pointwise,
                LocalAdjustmentPolicy::GlobalOnly,
                NodeDependencies {
                    view: true,
                    output: true,
                    ..NodeDependencies::default()
                },
                None,
                Some("clipping_overlay_wgsl_v1"),
                inputs.output_fingerprint,
            ));
        } else {
            omitted.push(EditNodeKind::ClippingOverlay.stable_id());
        }
        nodes.push(node(
            EditNodeKind::RenderTransport,
            ColorDomain::ViewEncoded,
            ColorDomain::RenderTransportEncoded,
            EditStageClass::OutputTransform,
            ValueRangePolicy::BoundForOutputEncoding,
            SpatialSupport::Pointwise,
            LocalAdjustmentPolicy::GlobalOnly,
            NodeDependencies {
                output: true,
                view: true,
                ..NodeDependencies::default()
            },
            None,
            Some("shader_transport_dither_v1"),
            inputs.output_fingerprint,
        ));
        debug_assert!(
            nodes
                .windows(2)
                .all(|pair| pair[0].stage_class <= pair[1].stage_class)
        );
        let fingerprint = graph_fingerprint(inputs.pipeline_version, &nodes);
        let ordered_node_ids: Arc<[_]> = nodes.iter().map(|node| node.kind.stable_id()).collect();
        let fused_gpu_groups: Arc<[Arc<[&'static str]>]> = vec![Arc::from([
            "legacy_gpu_scene_view_pass",
            "clipping_overlay",
            "render_transport",
        ])]
        .into();
        Self {
            schema_version: EDIT_GRAPH_SCHEMA_VERSION,
            pipeline_version: inputs.pipeline_version,
            nodes: nodes.into(),
            fingerprint,
            execution_abi_fingerprint: gpu_execution_fingerprint(
                inputs.adjustments,
                inputs.has_lut,
            ),
            receipt: EditGraphReceipt {
                schema_version: EDIT_GRAPH_SCHEMA_VERSION,
                pipeline_version: inputs.pipeline_version,
                migration: if inputs.version_was_explicit {
                    EditGraphMigration::LegacyV1Explicit
                } else {
                    EditGraphMigration::LegacyV1Defaulted
                },
                ordered_node_ids,
                omitted_no_op_node_ids: omitted.into(),
                fused_gpu_groups,
                input_domain: ColorDomain::AcesCgSceneLinearExtended,
                output_domain: ColorDomain::RenderTransportEncoded,
            },
        }
    }

    pub fn validate_gpu_execution(
        &self,
        adjustments: &AllAdjustments,
        has_lut: bool,
        mask_count: usize,
    ) -> Result<(), &'static str> {
        let has_fused = self
            .nodes
            .iter()
            .any(|node| node.kind == EditNodeKind::LegacyGpuSceneViewPass);
        if (has_lut || mask_count > 0) && !has_fused {
            return Err("edit_graph.missing_legacy_gpu_scene_view_pass");
        }
        if self.execution_abi_fingerprint != gpu_execution_fingerprint(adjustments, has_lut) {
            return Err("edit_graph.stale_gpu_execution_abi");
        }
        if self.nodes.first().map(|node| node.input_domain)
            != Some(ColorDomain::AcesCgSceneLinearExtended)
        {
            return Err("edit_graph.invalid_input_domain");
        }
        if self.nodes.last().map(|node| node.output_domain)
            != Some(ColorDomain::RenderTransportEncoded)
        {
            return Err("edit_graph.invalid_output_domain");
        }
        Ok(())
    }
}

pub fn gpu_execution_fingerprint(adjustments: &AllAdjustments, has_lut: bool) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"rapidraw.edit-graph.gpu-execution-abi.v1");
    hasher.update(bytes_of(adjustments));
    hasher.update(&[u8::from(has_lut)]);
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

#[allow(clippy::too_many_arguments)]
fn node(
    kind: EditNodeKind,
    input_domain: ColorDomain,
    output_domain: ColorDomain,
    stage_class: EditStageClass,
    range_policy: ValueRangePolicy,
    spatial_support: SpatialSupport,
    local_adjustment_policy: LocalAdjustmentPolicy,
    dependencies: NodeDependencies,
    cpu_implementation: Option<&'static str>,
    wgpu_implementation: Option<&'static str>,
    payload_fingerprint: u64,
) -> CompiledEditNode {
    CompiledEditNode {
        kind,
        schema_version: 1,
        implementation_version: 1,
        input_domain,
        output_domain,
        stage_class,
        range_policy,
        alpha_policy: AlphaPolicy::PreserveStraight,
        precision: PrecisionPolicy::Float16OrBetter,
        dependencies,
        spatial_support,
        local_adjustment_policy,
        cpu_implementation,
        wgpu_implementation,
        payload_fingerprint,
    }
}

fn combine(values: &[u64]) -> u64 {
    let mut hasher = blake3::Hasher::new();
    for value in values {
        hasher.update(&value.to_le_bytes());
    }
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

fn graph_fingerprint(pipeline_version: u32, nodes: &[CompiledEditNode]) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"rapidraw.compiled-edit-graph.v1");
    hasher.update(&EDIT_GRAPH_SCHEMA_VERSION.to_le_bytes());
    hasher.update(&pipeline_version.to_le_bytes());
    for node in nodes {
        hasher.update(node.kind.stable_id().as_bytes());
        hasher.update(&node.schema_version.to_le_bytes());
        hasher.update(&node.implementation_version.to_le_bytes());
        hasher.update(&node.payload_fingerprint.to_le_bytes());
        hasher.update(node.input_domain.contract_id().as_bytes());
        hasher.update(node.output_domain.contract_id().as_bytes());
        hasher.update(format!("{:?}", node.stage_class).as_bytes());
    }
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}
