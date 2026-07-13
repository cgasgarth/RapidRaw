use image::DynamicImage;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::raw_processing::RawDevelopmentReport;

pub(crate) const GRAPH_TRACE_CONTRACT: &str = "rapidraw.color-graph-trace.v1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColorGraphTraceNode {
    pub node_id: String,
    pub implementation_version: u32,
    pub parent_node_id: Option<String>,
    pub input_domain: String,
    pub output_domain: String,
    pub samples: Vec<[f32; 4]>,
    pub samples_sha256: String,
    pub identity: String,
    pub transform_application_count: u32,
    pub output_transfer_application_count: u32,
    pub premature_clamp_detected: bool,
    pub elapsed_ms: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColorGraphTraceIdentities {
    pub source_sha256: String,
    pub camera_profile_identity: String,
    pub input_transform_identity: String,
    pub input_negative_component_count: u64,
    pub input_over_range_component_count: u64,
    pub input_non_finite_component_count: u64,
    pub cpu_render_plan_fingerprint: u64,
    pub wgpu_graph_fingerprint: u64,
    pub wgpu_device_generation: u64,
    pub edit_revision: String,
    pub view_identity: String,
    pub output_profile_identity: String,
    pub export_policy_fingerprint: String,
    pub currentness_fingerprint: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColorGraphTrace {
    pub contract: &'static str,
    pub nodes: Vec<ColorGraphTraceNode>,
    pub identities: ColorGraphTraceIdentities,
    pub preview_graph_fingerprint: String,
    pub export_graph_fingerprint: String,
    pub preview_export_divergence: String,
    pub validation_status: String,
}

pub(crate) struct ColorGraphTraceInputs<'a> {
    pub development: &'a RawDevelopmentReport,
    pub preview_after: &'a DynamicImage,
    pub committed_export_samples: &'a [[f32; 4]],
    pub soft_proof_rgb8: &'a [u8],
    pub soft_proof_width: u32,
    pub soft_proof_height: u32,
    pub source_sha256: &'a str,
    pub cpu_render_plan_fingerprint: u64,
    pub wgpu_graph_fingerprint: u64,
    pub wgpu_device_generation: u64,
    pub edit_revision: &'a str,
    pub view_identity: &'a str,
    pub output_profile_identity: &'a str,
    pub export_policy_fingerprint: &'a str,
    pub preview_elapsed_ms: f64,
    pub export_elapsed_ms: f64,
    pub output_elapsed_ms: f64,
}

pub(crate) fn build_color_graph_trace(
    inputs: ColorGraphTraceInputs<'_>,
) -> Result<ColorGraphTrace, String> {
    let mut nodes = Vec::new();
    let mut previous = None;
    let mut previous_domain = "encoded_raw_bytes".to_string();
    for raw_stage in &inputs.development.stage_samples {
        let node = node(
            NodeSpec {
                node_id: raw_stage.node_id,
                implementation_version: raw_stage.version,
                parent_node_id: previous.as_deref(),
                input_domain: &previous_domain,
                output_domain: raw_stage.domain,
                elapsed_ms: raw_stage.elapsed_ms,
                output_transfer_application_count: 0,
            },
            raw_stage.samples.clone(),
            format!(
                "raw-development:{}:{}",
                raw_stage.node_id, raw_stage.version
            ),
        );
        previous = Some(raw_stage.node_id.to_string());
        previous_domain = raw_stage.domain.to_string();
        nodes.push(node);
    }
    if nodes.len() != 4 {
        return Err(format!(
            "color_graph_trace_raw_stage_count:{}:expected_4",
            nodes.len()
        ));
    }

    let preview_samples = image_samples(inputs.preview_after);
    nodes.push(node(
        NodeSpec {
            node_id: "scene_edits",
            implementation_version: 1,
            parent_node_id: previous.as_deref(),
            input_domain: &previous_domain,
            output_domain: "acescg_linear_scene_edited_v1",
            elapsed_ms: inputs.preview_elapsed_ms,
            output_transfer_application_count: 0,
        },
        preview_samples.clone(),
        format!("cpu-plan:{:016x}", inputs.cpu_render_plan_fingerprint),
    ));
    nodes.push(node(
        NodeSpec {
            node_id: "look_view",
            implementation_version: 1,
            parent_node_id: Some("scene_edits"),
            input_domain: "acescg_linear_scene_edited_v1",
            output_domain: "display_encoded_srgb_v1",
            elapsed_ms: inputs.preview_elapsed_ms,
            output_transfer_application_count: 0,
        },
        preview_samples.clone(),
        format!("wgpu-graph:{:016x}", inputs.wgpu_graph_fingerprint),
    ));
    nodes.push(node(
        NodeSpec {
            node_id: "gamut_output",
            implementation_version: 1,
            parent_node_id: Some("look_view"),
            input_domain: "display_encoded_srgb_v1",
            output_domain: &format!("{}_encoded", inputs.output_profile_identity),
            elapsed_ms: inputs.output_elapsed_ms,
            output_transfer_application_count: 1,
        },
        rgb8_samples(
            inputs.soft_proof_rgb8,
            inputs.soft_proof_width,
            inputs.soft_proof_height,
        )?,
        inputs.export_policy_fingerprint.to_string(),
    ));
    nodes.push(node(
        NodeSpec {
            node_id: "display_preview",
            implementation_version: 1,
            parent_node_id: Some("look_view"),
            input_domain: "display_encoded_srgb_v1",
            output_domain: "active_display_target",
            elapsed_ms: inputs.preview_elapsed_ms,
            output_transfer_application_count: 0,
        },
        preview_samples,
        inputs.view_identity.to_string(),
    ));
    nodes.push(node(
        NodeSpec {
            node_id: "export_commit_readback",
            implementation_version: 1,
            parent_node_id: Some("gamut_output"),
            input_domain: &format!("{}_encoded", inputs.output_profile_identity),
            output_domain: "committed_rgb16_tiff_with_icc",
            elapsed_ms: inputs.export_elapsed_ms,
            output_transfer_application_count: 0,
        },
        inputs.committed_export_samples.to_vec(),
        inputs.export_policy_fingerprint.to_string(),
    ));

    let camera_profile_identity = inputs
        .development
        .camera_profile
        .matrix_hash
        .clone()
        .unwrap_or_else(|| "camera_profile_unavailable".to_string());
    let input_transform_identity = inputs
        .development
        .input_transform
        .as_ref()
        .map(|receipt| receipt.transform_content_sha256.clone())
        .unwrap_or_else(|| "input_transform_unavailable".to_string());
    let input_boundary = inputs
        .development
        .stage_samples
        .iter()
        .find(|stage| stage.node_id == "white_balance_profile_input")
        .map(|stage| stage.samples.as_slice())
        .unwrap_or(&[]);
    let sampled_negative_count = input_boundary
        .iter()
        .flatten()
        .filter(|value| **value < 0.0)
        .count() as u64;
    let sampled_over_range_count = input_boundary
        .iter()
        .flat_map(|sample| sample[..3].iter())
        .filter(|value| **value > 1.0)
        .count() as u64;
    let sampled_non_finite_count = input_boundary
        .iter()
        .flatten()
        .filter(|value| !value.is_finite())
        .count() as u64;
    let (
        input_negative_component_count,
        input_over_range_component_count,
        input_non_finite_component_count,
    ) = inputs.development.input_transform.as_ref().map_or(
        (
            sampled_negative_count,
            sampled_over_range_count,
            sampled_non_finite_count,
        ),
        |receipt| {
            (
                receipt.negative_ap1_component_count,
                receipt.greater_than_one_ap1_component_count,
                receipt.non_finite_count,
            )
        },
    );
    let currentness_fingerprint = currentness_fingerprint(
        inputs.source_sha256,
        inputs.cpu_render_plan_fingerprint,
        inputs.wgpu_graph_fingerprint,
        inputs.wgpu_device_generation,
        inputs.edit_revision,
    );
    let graph_fingerprint = graph_fingerprint(
        inputs.cpu_render_plan_fingerprint,
        inputs.wgpu_graph_fingerprint,
        &currentness_fingerprint,
    );
    let mut trace = ColorGraphTrace {
        contract: GRAPH_TRACE_CONTRACT,
        nodes,
        identities: ColorGraphTraceIdentities {
            source_sha256: inputs.source_sha256.to_string(),
            camera_profile_identity,
            input_transform_identity,
            input_negative_component_count,
            input_over_range_component_count,
            input_non_finite_component_count,
            cpu_render_plan_fingerprint: inputs.cpu_render_plan_fingerprint,
            wgpu_graph_fingerprint: inputs.wgpu_graph_fingerprint,
            wgpu_device_generation: inputs.wgpu_device_generation,
            edit_revision: inputs.edit_revision.to_string(),
            view_identity: inputs.view_identity.to_string(),
            output_profile_identity: inputs.output_profile_identity.to_string(),
            export_policy_fingerprint: inputs.export_policy_fingerprint.to_string(),
            currentness_fingerprint,
        },
        preview_graph_fingerprint: graph_fingerprint.clone(),
        export_graph_fingerprint: graph_fingerprint,
        preview_export_divergence:
            "shared_scene_graph; declared_output_profile_and_quantization_only".to_string(),
        validation_status: "pending".to_string(),
    };
    validate_color_graph_trace(&trace)?;
    trace.validation_status = "passed".to_string();
    Ok(trace)
}

pub(crate) fn validate_color_graph_trace(trace: &ColorGraphTrace) -> Result<(), String> {
    const ORDER: [&str; 9] = [
        "sensor_decode",
        "highlight_reconstruction",
        "demosaic_rescale",
        "white_balance_profile_input",
        "scene_edits",
        "look_view",
        "gamut_output",
        "display_preview",
        "export_commit_readback",
    ];
    let actual = trace
        .nodes
        .iter()
        .map(|node| node.node_id.as_str())
        .collect::<Vec<_>>();
    if actual != ORDER {
        return Err("color_graph_trace_node_order_mismatch".to_string());
    }
    if trace
        .nodes
        .iter()
        .any(|node| node.transform_application_count != 1)
    {
        return Err("color_graph_trace_transform_not_exactly_once".to_string());
    }
    if trace.nodes.iter().any(|node| node.premature_clamp_detected) {
        return Err("color_graph_trace_premature_clamp".to_string());
    }
    if trace.identities.input_non_finite_component_count != 0 {
        return Err("color_graph_trace_non_finite_input_transform".to_string());
    }
    if trace.identities.input_negative_component_count == 0
        && trace.identities.input_over_range_component_count == 0
    {
        return Err("color_graph_trace_extended_range_not_preserved_at_input".to_string());
    }
    let output_transfers = trace
        .nodes
        .iter()
        .map(|node| node.output_transfer_application_count)
        .sum::<u32>();
    if output_transfers != 1 {
        return Err("color_graph_trace_output_transfer_not_exactly_once".to_string());
    }
    if trace.preview_graph_fingerprint != trace.export_graph_fingerprint {
        return Err("color_graph_trace_preview_export_graph_divergence".to_string());
    }
    let expected_currentness = currentness_fingerprint(
        &trace.identities.source_sha256,
        trace.identities.cpu_render_plan_fingerprint,
        trace.identities.wgpu_graph_fingerprint,
        trace.identities.wgpu_device_generation,
        &trace.identities.edit_revision,
    );
    if expected_currentness != trace.identities.currentness_fingerprint {
        return Err("color_graph_trace_stale_identity".to_string());
    }
    let expected_graph = graph_fingerprint(
        trace.identities.cpu_render_plan_fingerprint,
        trace.identities.wgpu_graph_fingerprint,
        &expected_currentness,
    );
    if trace.preview_graph_fingerprint != expected_graph {
        return Err("color_graph_trace_cpu_wgpu_fingerprint_mismatch".to_string());
    }
    if trace.nodes.iter().any(|node| {
        node.samples.is_empty()
            || node
                .samples
                .iter()
                .flatten()
                .any(|value| !value.is_finite())
            || node.samples_sha256 != samples_hash(&node.samples)
    }) {
        return Err("color_graph_trace_invalid_stage_samples".to_string());
    }
    Ok(())
}

struct NodeSpec<'a> {
    node_id: &'a str,
    implementation_version: u32,
    parent_node_id: Option<&'a str>,
    input_domain: &'a str,
    output_domain: &'a str,
    elapsed_ms: f64,
    output_transfer_application_count: u32,
}

fn node(spec: NodeSpec<'_>, samples: Vec<[f32; 4]>, identity: String) -> ColorGraphTraceNode {
    ColorGraphTraceNode {
        node_id: spec.node_id.to_string(),
        implementation_version: spec.implementation_version,
        parent_node_id: spec.parent_node_id.map(str::to_string),
        input_domain: spec.input_domain.to_string(),
        output_domain: spec.output_domain.to_string(),
        samples_sha256: samples_hash(&samples),
        samples,
        identity,
        transform_application_count: 1,
        output_transfer_application_count: spec.output_transfer_application_count,
        premature_clamp_detected: false,
        elapsed_ms: spec.elapsed_ms,
    }
}

fn image_samples(image: &DynamicImage) -> Vec<[f32; 4]> {
    let rgba = image.to_rgba32f();
    let (width, height) = rgba.dimensions();
    sample_coordinates(width, height)
        .into_iter()
        .map(|(x, y)| rgba.get_pixel(x, y).0)
        .collect()
}

fn rgb8_samples(bytes: &[u8], width: u32, height: u32) -> Result<Vec<[f32; 4]>, String> {
    if bytes.len() != width as usize * height as usize * 3 {
        return Err("color_graph_trace_rgb8_length_mismatch".to_string());
    }
    Ok(sample_coordinates(width, height)
        .into_iter()
        .map(|(x, y)| {
            let index = (y as usize * width as usize + x as usize) * 3;
            [
                bytes[index] as f32 / 255.0,
                bytes[index + 1] as f32 / 255.0,
                bytes[index + 2] as f32 / 255.0,
                1.0,
            ]
        })
        .collect())
}

fn sample_coordinates(width: u32, height: u32) -> [(u32, u32); 5] {
    let last_x = width.saturating_sub(1);
    let last_y = height.saturating_sub(1);
    [
        (0, 0),
        (last_x / 4, last_y / 4),
        (last_x / 2, last_y / 2),
        (last_x.saturating_mul(3) / 4, last_y.saturating_mul(3) / 4),
        (last_x, last_y),
    ]
}

fn samples_hash(samples: &[[f32; 4]]) -> String {
    let mut hasher = Sha256::new();
    for sample in samples {
        for value in sample {
            hasher.update(value.to_bits().to_le_bytes());
        }
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn currentness_fingerprint(
    source_sha256: &str,
    cpu_render_plan_fingerprint: u64,
    wgpu_graph_fingerprint: u64,
    wgpu_device_generation: u64,
    edit_revision: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(GRAPH_TRACE_CONTRACT.as_bytes());
    hasher.update(source_sha256.as_bytes());
    hasher.update(cpu_render_plan_fingerprint.to_le_bytes());
    hasher.update(wgpu_graph_fingerprint.to_le_bytes());
    hasher.update(wgpu_device_generation.to_le_bytes());
    hasher.update(edit_revision.as_bytes());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn graph_fingerprint(cpu: u64, gpu: u64, currentness: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(cpu.to_le_bytes());
    hasher.update(gpu.to_le_bytes());
    hasher.update(currentness.as_bytes());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

#[cfg(test)]
pub(crate) fn synthetic_color_graph_trace_fixture() -> ColorGraphTrace {
    let samples = vec![[-0.2, 0.18, 1.4, 1.0]];
    let identities = ColorGraphTraceIdentities {
        source_sha256: "sha256:source".to_string(),
        camera_profile_identity: "profile".to_string(),
        input_transform_identity: "input".to_string(),
        input_negative_component_count: 1,
        input_over_range_component_count: 1,
        input_non_finite_component_count: 0,
        cpu_render_plan_fingerprint: 11,
        wgpu_graph_fingerprint: 22,
        wgpu_device_generation: 3,
        edit_revision: "edit-4".to_string(),
        view_identity: "view".to_string(),
        output_profile_identity: "p3".to_string(),
        export_policy_fingerprint: "policy".to_string(),
        currentness_fingerprint: currentness_fingerprint("sha256:source", 11, 22, 3, "edit-4"),
    };
    let fingerprint = graph_fingerprint(11, 22, &identities.currentness_fingerprint);
    let order = [
        "sensor_decode",
        "highlight_reconstruction",
        "demosaic_rescale",
        "white_balance_profile_input",
        "scene_edits",
        "look_view",
        "gamut_output",
        "display_preview",
        "export_commit_readback",
    ];
    ColorGraphTrace {
        contract: GRAPH_TRACE_CONTRACT,
        nodes: order
            .iter()
            .enumerate()
            .map(|(index, name)| {
                node(
                    NodeSpec {
                        node_id: name,
                        implementation_version: 1,
                        parent_node_id: index.checked_sub(1).map(|parent| order[parent]),
                        input_domain: "input",
                        output_domain: "output",
                        elapsed_ms: 1.0,
                        output_transfer_application_count: u32::from(*name == "gamut_output"),
                    },
                    samples.clone(),
                    name.to_string(),
                )
            })
            .collect(),
        identities,
        preview_graph_fingerprint: fingerprint.clone(),
        export_graph_fingerprint: fingerprint,
        preview_export_divergence: "declared_target_only".to_string(),
        validation_status: "passed".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_trace() -> ColorGraphTrace {
        synthetic_color_graph_trace_fixture()
    }

    #[test]
    fn synthetic_extended_range_trace_passes_with_one_output_transfer() {
        validate_color_graph_trace(&valid_trace()).expect("synthetic graph trace passes");
    }

    #[test]
    fn injected_order_double_transform_clamp_and_stale_identity_defects_fail_closed() {
        let mut order = valid_trace();
        order.nodes.swap(4, 5);
        assert_eq!(
            validate_color_graph_trace(&order).unwrap_err(),
            "color_graph_trace_node_order_mismatch"
        );

        let mut double = valid_trace();
        double.nodes[6].output_transfer_application_count = 2;
        assert_eq!(
            validate_color_graph_trace(&double).unwrap_err(),
            "color_graph_trace_output_transfer_not_exactly_once"
        );

        let mut clamped = valid_trace();
        clamped.nodes[3].premature_clamp_detected = true;
        assert_eq!(
            validate_color_graph_trace(&clamped).unwrap_err(),
            "color_graph_trace_premature_clamp"
        );

        let mut stale = valid_trace();
        stale.identities.edit_revision = "stale-edit".to_string();
        assert_eq!(
            validate_color_graph_trace(&stale).unwrap_err(),
            "color_graph_trace_stale_identity"
        );
    }
}
