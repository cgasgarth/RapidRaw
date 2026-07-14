//! Scene-referred Film Emulation node.
//!
//! The first profile is intentionally small and project-owned: a monotone
//! luminance shaper that preserves AP1 hue and extended-range values.

#![allow(dead_code)]

use glam::Vec3;
use image::Rgb32FImage;
use serde::{Deserialize, Serialize};

use super::film_characteristic_curve::{
    FilmCharacteristicCurveV1, apply_direct_positive, reference_curve,
};
use super::film_color_coupler::{
    apply as apply_color_coupler, reference as reference_color_coupler,
};
use super::film_density_grain::{
    FilmDensityGrainV1, apply as apply_density_grain, reference as reference_density_grain,
};
use super::film_print_scan::{apply as apply_print_scan, reference as reference_print_scan};

pub const FILM_NODE_TYPE: &str = "film_emulation";
pub const FILM_CONTRACT_VERSION: u32 = 1;
pub const REFERENCE_PROFILE_ID: &str = "rapidraw.reference_film.v1";
pub const REFERENCE_PROFILE_VERSION: &str = "1";
pub const REFERENCE_PROFILE_CONTENT_SHA256: &str =
    "sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef";
pub const REFERENCE_SHAPER_P: f32 = 0.35;
#[allow(clippy::excessive_precision)]
pub const AP1_LUMINANCE: Vec3 = Vec3::new(0.272_228_716_8, 0.674_081_765_8, 0.053_689_517_4);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmEmulationProfileRef {
    pub id: String,
    pub version: String,
    pub content_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmEmulationNodeV1 {
    pub node_type: String,
    pub contract_version: u32,
    pub enabled: bool,
    pub profile_ref: FilmEmulationProfileRef,
    #[serde(default)]
    pub stage_params: Option<FilmEmulationStageParamsV1>,
    #[serde(default)]
    pub characteristic_curve: Option<FilmCharacteristicCurveV1>,
    pub mix: f32,
    pub working_space: String,
    pub seed_policy: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmEmulationStageParamsV1 {
    pub reference_luminance_shaper_p: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FilmEmulationParams {
    pub enabled: bool,
    pub mix: f32,
    pub shaper_p: f32,
    /// Grain is opt-in; the governed reference profile is grain-off by default.
    pub grain_amount: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmEmulationRuntimeReceiptV1 {
    pub contract_version: u32,
    pub input_domain: String,
    pub output_domain: String,
    pub node_type: String,
    pub profile_id: String,
    pub profile_version: String,
    pub profile_content_sha256: String,
    pub mix: f32,
    pub enabled: bool,
    pub post_film_pre_view_hash: String,
    pub fallback: bool,
    pub error_code: Option<String>,
}

pub fn runtime_receipt(
    params: FilmEmulationParams,
    post_hash: impl Into<String>,
) -> FilmEmulationRuntimeReceiptV1 {
    FilmEmulationRuntimeReceiptV1 {
        contract_version: FILM_CONTRACT_VERSION,
        input_domain: "acescg_linear_v1".to_string(),
        output_domain: "acescg_linear_v1".to_string(),
        node_type: FILM_NODE_TYPE.to_string(),
        profile_id: REFERENCE_PROFILE_ID.to_string(),
        profile_version: REFERENCE_PROFILE_VERSION.to_string(),
        profile_content_sha256: REFERENCE_PROFILE_CONTENT_SHA256.to_string(),
        mix: params.mix,
        enabled: params.enabled,
        post_film_pre_view_hash: post_hash.into(),
        fallback: false,
        error_code: None,
    }
}

impl FilmEmulationNodeV1 {
    pub fn validate(&self) -> Result<FilmEmulationParams, &'static str> {
        if self.node_type != FILM_NODE_TYPE || self.contract_version != FILM_CONTRACT_VERSION {
            return Err("film_emulation_invalid_contract");
        }
        if self.working_space != "acescg_linear_v1" || self.seed_policy != "source_stable_v1" {
            return Err("film_emulation_invalid_scene_contract");
        }
        if self.profile_ref.id != REFERENCE_PROFILE_ID
            || self.profile_ref.version != REFERENCE_PROFILE_VERSION
            || self.profile_ref.content_sha256 != REFERENCE_PROFILE_CONTENT_SHA256
        {
            return Err("film_emulation_profile_hash_mismatch");
        }
        if !self.mix.is_finite() || !(0.0..=1.0).contains(&self.mix) {
            return Err("film_emulation_invalid_mix");
        }
        let shaper_p = self
            .stage_params
            .as_ref()
            .map_or(REFERENCE_SHAPER_P, |stage| {
                stage.reference_luminance_shaper_p
            });
        if !shaper_p.is_finite() || !(0.0001..=4.0).contains(&shaper_p) {
            return Err("film_emulation_invalid_stage_params");
        }
        if let Some(curve) = &self.characteristic_curve {
            curve.validate()?;
        }
        Ok(FilmEmulationParams {
            enabled: self.enabled && self.mix > 0.0,
            mix: self.mix,
            shaper_p,
            grain_amount: 0.0,
        })
    }
}

pub fn parse_node(value: &serde_json::Value) -> Result<Option<FilmEmulationParams>, &'static str> {
    let Some(node) = value.get("filmEmulation") else {
        return Ok(None);
    };
    let parsed = serde_json::from_value::<FilmEmulationNodeV1>(node.clone())
        .map_err(|_| "film_emulation_invalid_node")?;
    Ok(Some(parsed.validate()?))
}

pub fn apply_pixel(rgb: Vec3, params: FilmEmulationParams) -> Vec3 {
    apply_pixel_at(rgb, params, 0, 0)
}

pub fn apply_pixel_at(rgb: Vec3, params: FilmEmulationParams, x: u32, y: u32) -> Vec3 {
    if !params.enabled || params.mix <= 0.0 {
        return rgb;
    }
    let mut curve = reference_curve();
    let response_scale = REFERENCE_SHAPER_P / params.shaper_p;
    curve
        .response_knots
        .iter_mut()
        .for_each(|response| *response *= response_scale);
    let shaped = apply_direct_positive(rgb, &curve);
    let luminance = AP1_LUMINANCE.dot(shaped);
    let exposure_ev = if luminance.is_finite() && luminance.abs() > 1.0e-8 {
        (luminance.abs() / 0.18).log2()
    } else {
        0.0
    };
    // Optional color/print stages are defined for normalized positive scene values.
    // Preserve signed and extended-range components through the shared film curve;
    // this keeps out-of-domain values finite and avoids hidden clipping or abs().
    let extended_scene = rgb.min_element() < 0.0 || rgb.max_element() > 1.0;
    let coupled = if extended_scene {
        shaped
    } else {
        apply_color_coupler(shaped, exposure_ev, &reference_color_coupler())
    };
    let grained = if !extended_scene && params.grain_amount > 0.0 {
        apply_density_grain(
            coupled,
            x,
            y,
            &FilmDensityGrainV1 {
                amount_default: params.grain_amount,
                ..reference_density_grain()
            },
        )
    } else {
        coupled
    };
    let printed = apply_print_scan(grained, &reference_print_scan());
    rgb + params.mix * (printed - rgb)
}

#[allow(dead_code)]
pub fn apply_image(image: &mut Rgb32FImage, params: FilmEmulationParams) {
    if !params.enabled || params.mix <= 0.0 {
        return;
    }
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        pixel.0 = apply_pixel_at(Vec3::from_array(pixel.0), params, x, y).to_array();
    }
}

/// Rust trust-boundary representation of the canonical single-target Film operation.
/// This is deliberately independent of UI adjustment patches: callers must provide the
/// version-pinned profile and a revision before this boundary will plan a mutation.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmOperationActorV1 {
    pub id: String,
    pub kind: String,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmOperationApprovalV1 {
    pub approval_class: String,
    pub reason: String,
    pub record_id: Option<String>,
    pub state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind", deny_unknown_fields)]
pub enum FilmEmulationOperationV1 {
    SetProfile {
        #[serde(rename = "profileRef")]
        profile_ref: FilmEmulationProfileRef,
    },
    SetMix {
        mix: f32,
    },
    SetEnabled {
        enabled: bool,
    },
    SetStageParams {
        stage: String,
        patch: FilmStagePatchV1,
    },
    SetStackPosition {
        position: String,
        #[serde(rename = "afterNodeId")]
        after_node_id: Option<String>,
    },
    ResetToProfile,
    RemoveNode,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmStagePatchV1 {
    pub p: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmEmulationTransferV1 {
    pub contract: String,
    pub profile_ref: FilmEmulationProfileRef,
    pub enabled: bool,
    pub mix: f32,
    pub stage_overrides: Option<FilmStagePatchV1>,
    pub stack_position: String,
    pub after_node_semantic_id: Option<String>,
    pub seed_transfer_policy: String,
}

impl FilmEmulationTransferV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.contract != "rapidraw.film_transfer.v1"
            || self.profile_ref.id != REFERENCE_PROFILE_ID
            || self.profile_ref.version != REFERENCE_PROFILE_VERSION
            || self.profile_ref.content_sha256 != REFERENCE_PROFILE_CONTENT_SHA256
            || !self.mix.is_finite()
            || !(0.0..=1.0).contains(&self.mix)
            || !matches!(
                self.stack_position.as_str(),
                "scene_creative_end" | "scene_creative_custom"
            )
            || (self.stack_position == "scene_creative_custom"
                && self.after_node_semantic_id.is_none())
            || (self.stack_position == "scene_creative_end"
                && self.after_node_semantic_id.is_some())
            || !matches!(
                self.seed_transfer_policy.as_str(),
                "preserve_for_same_source_v1" | "rederive_for_target_source_v1"
            )
        {
            return Err("film_transfer_invalid");
        }
        if let Some(patch) = &self.stage_overrides
            && (!patch.p.is_finite() || !(0.0001..=4.0).contains(&patch.p))
        {
            return Err("film_transfer_invalid_stage_override");
        }
        Ok(())
    }

    pub fn operations(&self) -> Result<Vec<FilmEmulationOperationV1>, &'static str> {
        self.validate()?;
        let mut operations = vec![
            FilmEmulationOperationV1::SetProfile {
                profile_ref: self.profile_ref.clone(),
            },
            FilmEmulationOperationV1::SetEnabled {
                enabled: self.enabled,
            },
            FilmEmulationOperationV1::SetMix { mix: self.mix },
        ];
        if let Some(patch) = &self.stage_overrides {
            operations.push(FilmEmulationOperationV1::SetStageParams {
                stage: "reference_luminance_shaper_v1".to_string(),
                patch: patch.clone(),
            });
        }
        operations.push(FilmEmulationOperationV1::SetStackPosition {
            position: self.stack_position.clone(),
            after_node_id: self.after_node_semantic_id.clone(),
        });
        Ok(operations)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyFilmEmulationOperationV1 {
    pub actor: FilmOperationActorV1,
    pub approval: FilmOperationApprovalV1,
    pub command_id: String,
    pub command_type: String,
    pub contract_version: u32,
    pub correlation_id: String,
    pub dry_run: bool,
    pub expected_graph_revision: String,
    pub idempotency_key: Option<String>,
    pub operation: FilmEmulationOperationV1,
    pub schema_version: u32,
    pub target: FilmOperationTargetV1,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmOperationTargetV1 {
    pub kind: String,
    pub variant_id: String,
}

impl ApplyFilmEmulationOperationV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.command_type != "edit.apply_film_emulation_operation"
            || self.contract_version != 1
            || self.schema_version != 1
        {
            return Err("film_operation_invalid_contract");
        }
        if self.command_id.is_empty()
            || self.correlation_id.is_empty()
            || self.expected_graph_revision.is_empty()
        {
            return Err("film_operation_missing_identity");
        }
        if self.target.variant_id.is_empty()
            || !matches!(self.target.kind.as_str(), "image" | "virtual_copy")
        {
            return Err("film_operation_invalid_target");
        }
        let expected_class = if self.dry_run {
            "preview_only"
        } else {
            "edit_apply"
        };
        if self.approval.approval_class != expected_class
            || (!self.dry_run && self.approval.state != "approved")
        {
            return Err("film_operation_invalid_approval");
        }
        match &self.operation {
            FilmEmulationOperationV1::SetProfile { profile_ref } => {
                if profile_ref.id != REFERENCE_PROFILE_ID
                    || profile_ref.version != REFERENCE_PROFILE_VERSION
                    || profile_ref.content_sha256 != REFERENCE_PROFILE_CONTENT_SHA256
                {
                    return Err("film_operation_profile_hash_mismatch");
                }
            }
            FilmEmulationOperationV1::SetMix { mix } => {
                if !mix.is_finite() || !(0.0..=1.0).contains(mix) {
                    return Err("film_operation_invalid_mix");
                }
            }
            FilmEmulationOperationV1::SetStageParams { stage, patch } => {
                if stage != "reference_luminance_shaper_v1" {
                    return Err("film_operation_unsupported_stage");
                }
                if !patch.p.is_finite() || !(0.0001..=4.0).contains(&patch.p) {
                    return Err("film_operation_invalid_stage_params");
                }
            }
            FilmEmulationOperationV1::SetStackPosition {
                position,
                after_node_id,
            } => {
                if position == "scene_creative_custom"
                    && after_node_id.as_deref().is_none_or(str::is_empty)
                {
                    return Err("film_operation_custom_placement_requires_node");
                }
                if position != "scene_creative_end" && position != "scene_creative_custom" {
                    return Err("film_operation_illegal_placement");
                }
                if position == "scene_creative_end" && after_node_id.is_some() {
                    return Err("film_operation_illegal_placement");
                }
            }
            FilmEmulationOperationV1::SetEnabled { .. }
            | FilmEmulationOperationV1::ResetToProfile
            | FilmEmulationOperationV1::RemoveNode => {}
        }
        Ok(())
    }
}

fn reference_node() -> FilmEmulationNodeV1 {
    FilmEmulationNodeV1 {
        node_type: FILM_NODE_TYPE.to_string(),
        contract_version: FILM_CONTRACT_VERSION,
        enabled: true,
        profile_ref: FilmEmulationProfileRef {
            id: REFERENCE_PROFILE_ID.to_string(),
            version: REFERENCE_PROFILE_VERSION.to_string(),
            content_sha256: REFERENCE_PROFILE_CONTENT_SHA256.to_string(),
        },
        stage_params: None,
        characteristic_curve: None,
        mix: 1.0,
        working_space: "acescg_linear_v1".to_string(),
        seed_policy: "source_stable_v1".to_string(),
    }
}

pub fn apply_operation_to_node(
    current: Option<FilmEmulationNodeV1>,
    operation: &FilmEmulationOperationV1,
) -> Result<Option<FilmEmulationNodeV1>, &'static str> {
    let mut node = current.unwrap_or_else(reference_node);
    match operation {
        FilmEmulationOperationV1::SetProfile { profile_ref } => {
            node.profile_ref = profile_ref.clone()
        }
        FilmEmulationOperationV1::SetMix { mix } => node.mix = *mix,
        FilmEmulationOperationV1::SetEnabled { enabled } => node.enabled = *enabled,
        FilmEmulationOperationV1::SetStageParams { patch, .. } => {
            node.stage_params = Some(FilmEmulationStageParamsV1 {
                reference_luminance_shaper_p: patch.p,
            });
        }
        FilmEmulationOperationV1::SetStackPosition { .. } => {}
        FilmEmulationOperationV1::ResetToProfile => node = reference_node(),
        FilmEmulationOperationV1::RemoveNode => return Ok(None),
    }
    node.validate().map(|_| Some(node))
}

#[cfg(test)]
mod operation_contract {
    use super::*;
    use serde_json::json;

    fn command(operation: FilmEmulationOperationV1) -> ApplyFilmEmulationOperationV1 {
        ApplyFilmEmulationOperationV1 {
            actor: FilmOperationActorV1 {
                id: "test".into(),
                kind: "test".into(),
                session_id: None,
            },
            approval: FilmOperationApprovalV1 {
                approval_class: "edit_apply".into(),
                reason: "test".into(),
                record_id: None,
                state: "approved".into(),
            },
            command_id: "cmd-1".into(),
            command_type: "edit.apply_film_emulation_operation".into(),
            contract_version: 1,
            correlation_id: "corr-1".into(),
            dry_run: false,
            expected_graph_revision: "film.graph.v1:0".into(),
            idempotency_key: None,
            operation,
            schema_version: 1,
            target: FilmOperationTargetV1 {
                kind: "image".into(),
                variant_id: "variant-1".into(),
            },
        }
    }

    #[test]
    fn operation_contract_rejects_unknown_and_bad_profile() {
        let value = json!({"kind":"SetMix","mix":0.5,"unexpected":true});
        assert!(serde_json::from_value::<FilmEmulationOperationV1>(value).is_err());
        let mut invalid = command(FilmEmulationOperationV1::SetProfile {
            profile_ref: FilmEmulationProfileRef {
                id: REFERENCE_PROFILE_ID.into(),
                version: "1".into(),
                content_sha256: "sha256:bad".into(),
            },
        });
        assert_eq!(
            invalid.validate(),
            Err("film_operation_profile_hash_mismatch")
        );
        invalid.operation = FilmEmulationOperationV1::SetStageParams {
            stage: "post_view".into(),
            patch: FilmStagePatchV1 { p: 0.35 },
        };
        assert_eq!(invalid.validate(), Err("film_operation_unsupported_stage"));
    }

    #[test]
    fn every_operation_member_validates() {
        for operation in [
            FilmEmulationOperationV1::SetProfile {
                profile_ref: FilmEmulationProfileRef {
                    id: REFERENCE_PROFILE_ID.into(),
                    version: "1".into(),
                    content_sha256: REFERENCE_PROFILE_CONTENT_SHA256.into(),
                },
            },
            FilmEmulationOperationV1::SetMix { mix: 0.5 },
            FilmEmulationOperationV1::SetEnabled { enabled: false },
            FilmEmulationOperationV1::SetStageParams {
                stage: "reference_luminance_shaper_v1".into(),
                patch: FilmStagePatchV1 { p: 0.5 },
            },
            FilmEmulationOperationV1::SetStackPosition {
                position: "scene_creative_end".into(),
                after_node_id: None,
            },
            FilmEmulationOperationV1::ResetToProfile,
            FilmEmulationOperationV1::RemoveNode,
        ] {
            assert!(command(operation).validate().is_ok());
        }
    }
}

#[cfg(test)]
mod operation_history {
    use super::*;

    #[test]
    fn operation_sequence_preserves_exact_node_and_supports_remove_reset() {
        let profile = FilmEmulationProfileRef {
            id: REFERENCE_PROFILE_ID.into(),
            version: REFERENCE_PROFILE_VERSION.into(),
            content_sha256: REFERENCE_PROFILE_CONTENT_SHA256.into(),
        };
        let initial = apply_operation_to_node(
            None,
            &FilmEmulationOperationV1::SetProfile {
                profile_ref: profile,
            },
        )
        .unwrap();
        let mixed =
            apply_operation_to_node(initial, &FilmEmulationOperationV1::SetMix { mix: 0.42 })
                .unwrap();
        let staged = apply_operation_to_node(
            mixed,
            &FilmEmulationOperationV1::SetStageParams {
                stage: "reference_luminance_shaper_v1".into(),
                patch: FilmStagePatchV1 { p: 0.8 },
            },
        )
        .unwrap();
        assert_eq!(
            staged
                .as_ref()
                .and_then(|node| node.stage_params.as_ref())
                .map(|params| params.reference_luminance_shaper_p),
            Some(0.8)
        );
        assert_eq!(staged.as_ref().map(|node| node.mix), Some(0.42));
        let reset =
            apply_operation_to_node(staged, &FilmEmulationOperationV1::ResetToProfile).unwrap();
        assert_eq!(reset.as_ref().map(|node| node.mix), Some(1.0));
        assert!(
            reset
                .as_ref()
                .is_some_and(|node| node.stage_params.is_none())
        );
        assert!(
            apply_operation_to_node(reset, &FilmEmulationOperationV1::RemoveNode)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn invalid_operation_cannot_mutate_node() {
        let node = reference_node();
        let invalid = FilmEmulationOperationV1::SetMix { mix: f32::NAN };
        assert_eq!(
            apply_operation_to_node(Some(node.clone()), &invalid),
            Err("film_emulation_invalid_mix")
        );
        assert_eq!(node.validate().unwrap().mix, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageBuffer;
    use serde_json::json;

    fn params(mix: f32) -> FilmEmulationParams {
        FilmEmulationParams {
            enabled: true,
            mix,
            shaper_p: REFERENCE_SHAPER_P,
            grain_amount: 0.0,
        }
    }

    #[test]
    fn reference_shaper_is_monotone_and_preserves_neutrals() {
        let mut previous = 0.0;
        for step in 0..=100 {
            let value = step as f32 / 100.0;
            let output = apply_pixel(Vec3::splat(value), params(1.0));
            assert!((output.x - output.y).abs() < 1.0e-6);
            assert!(output.x >= previous);
            previous = output.x;
        }
    }

    #[test]
    fn extended_range_and_negative_components_remain_finite_and_unclamped() {
        let output = apply_pixel(Vec3::new(-0.25, 2.5, 0.5), params(1.0));
        assert!(output.to_array().iter().all(|value| value.is_finite()));
        assert!(output.x < 0.0);
        assert!(output.y > 1.0);
    }

    #[test]
    fn disabled_and_zero_mix_are_exact_identity() {
        let input = Vec3::new(-2.0, 0.4, 4.0);
        assert_eq!(
            apply_pixel(
                input,
                FilmEmulationParams {
                    enabled: false,
                    ..params(1.0)
                }
            ),
            input
        );
        assert_eq!(apply_pixel(input, params(0.0)), input);
        let mut image = ImageBuffer::from_pixel(1, 1, image::Rgb(input.to_array()));
        apply_image(&mut image, params(0.0));
        assert_eq!(image.get_pixel(0, 0).0, input.to_array());
    }

    #[test]
    fn parser_rejects_profile_mismatch_and_accepts_reference_node() {
        let node = json!({
            "nodeType": FILM_NODE_TYPE,
            "contractVersion": 1,
            "enabled": true,
            "profileRef": {"id": REFERENCE_PROFILE_ID, "version": "1", "contentSha256": REFERENCE_PROFILE_CONTENT_SHA256},
            "mix": 1,
            "workingSpace": "acescg_linear_v1",
            "seedPolicy": "source_stable_v1"
        });
        assert!(
            parse_node(&json!({"filmEmulation": node}))
                .unwrap()
                .is_some()
        );
        assert!(parse_node(&json!({"filmEmulation": {"mix": 1}})).is_err());
        assert_eq!(
            runtime_receipt(params(1.0), "sha256:post").input_domain,
            "acescg_linear_v1"
        );
    }

    #[test]
    fn transfer_round_trip_preserves_pinned_state_and_operation_order() {
        let transfer = FilmEmulationTransferV1 {
            contract: "rapidraw.film_transfer.v1".to_string(),
            profile_ref: FilmEmulationProfileRef {
                id: REFERENCE_PROFILE_ID.to_string(),
                version: REFERENCE_PROFILE_VERSION.to_string(),
                content_sha256: REFERENCE_PROFILE_CONTENT_SHA256.to_string(),
            },
            enabled: true,
            mix: 0.65,
            stage_overrides: Some(FilmStagePatchV1 { p: 1.1 }),
            stack_position: "scene_creative_end".to_string(),
            after_node_semantic_id: None,
            seed_transfer_policy: "preserve_for_same_source_v1".to_string(),
        };
        let encoded = serde_json::to_vec(&transfer).unwrap();
        let decoded: FilmEmulationTransferV1 = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(decoded, transfer);
        let operations = decoded.operations().unwrap();
        assert!(matches!(
            operations[0],
            FilmEmulationOperationV1::SetProfile { .. }
        ));
        assert!(
            matches!(operations[2], FilmEmulationOperationV1::SetMix { mix } if (mix - 0.65).abs() < 1e-6)
        );
        assert!(matches!(
            operations[3],
            FilmEmulationOperationV1::SetStageParams { .. }
        ));
    }

    #[test]
    fn transfer_rejects_hash_mismatch_and_illegal_placement() {
        let mut transfer = FilmEmulationTransferV1 {
            contract: "rapidraw.film_transfer.v1".to_string(),
            profile_ref: FilmEmulationProfileRef {
                id: REFERENCE_PROFILE_ID.to_string(),
                version: REFERENCE_PROFILE_VERSION.to_string(),
                content_sha256: "sha256:stale".to_string(),
            },
            enabled: true,
            mix: 0.5,
            stage_overrides: None,
            stack_position: "scene_creative_end".to_string(),
            after_node_semantic_id: None,
            seed_transfer_policy: "rederive_for_target_source_v1".to_string(),
        };
        assert!(transfer.validate().is_err());
        transfer.profile_ref.content_sha256 = REFERENCE_PROFILE_CONTENT_SHA256.to_string();
        transfer.stack_position = "scene_creative_custom".to_string();
        assert!(transfer.validate().is_err());
    }
}
