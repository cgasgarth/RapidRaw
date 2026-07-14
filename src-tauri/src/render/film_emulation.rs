//! Scene-referred Film Emulation node.
//!
//! The first profile is intentionally small and project-owned: a monotone
//! luminance shaper that preserves AP1 hue and extended-range values.

use glam::Vec3;
use image::Rgb32FImage;
use serde::{Deserialize, Serialize};

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
    pub mix: f32,
    pub working_space: String,
    pub seed_policy: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FilmEmulationParams {
    pub enabled: bool,
    pub mix: f32,
    pub shaper_p: f32,
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
        Ok(FilmEmulationParams {
            enabled: self.enabled && self.mix > 0.0,
            mix: self.mix,
            shaper_p: REFERENCE_SHAPER_P,
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
    if !params.enabled || params.mix <= 0.0 {
        return rgb;
    }
    let luminance = AP1_LUMINANCE.dot(rgb);
    if !luminance.is_finite() || luminance <= 1.0e-8 {
        return rgb;
    }
    let shaped = luminance * (1.0 + params.shaper_p) / (luminance + params.shaper_p);
    let scale = shaped / luminance;
    rgb + params.mix * (rgb * scale - rgb)
}

#[allow(dead_code)]
pub fn apply_image(image: &mut Rgb32FImage, params: FilmEmulationParams) {
    if !params.enabled || params.mix <= 0.0 {
        return;
    }
    for pixel in image.pixels_mut() {
        pixel.0 = apply_pixel(Vec3::from_array(pixel.0), params).to_array();
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
}
