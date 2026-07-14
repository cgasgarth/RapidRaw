//! Backend-neutral Film execution plan and CPU reference executor.

#![allow(dead_code)]

use super::film_emulation::{FilmEmulationParams, apply_pixel_at};
use glam::Vec3;
use image::Rgb32FImage;
use serde::{Deserialize, Serialize};

pub const PLAN_CONTRACT: &str = "rapidraw.film_execution_plan.v1";
pub const STAGE_ORDER: [&str; 9] = [
    "capture_optical_scatter",
    "characteristic_response",
    "color_coupler",
    "residual_response",
    "density_grain",
    "print_scan",
    "positive_normalization",
    "scene_linear_mix",
    "post_film_tap",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmExecutionPlanV1 {
    pub contract: String,
    pub input_domain: String,
    pub output_domain: String,
    pub profile_content_sha256: String,
    pub compiled_profile_sha256: String,
    pub stage_order: Vec<String>,
    pub halo_overlap_px: u32,
    pub border_policy_version: String,
    pub scale_filter_version: String,
    pub model_abi_version: String,
    pub backend_abi_version: String,
    pub plan_sha256: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilmExecutionBackendV1 {
    Cpu,
    Gpu,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmFrameContextV1 {
    pub source_identity: String,
    pub source_dimensions: [u32; 2],
    pub full_resolution_origin: [u32; 2],
    pub render_scale_milli: u32,
    pub quality: String,
    pub deterministic_seed_inputs: String,
    pub revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmExecutionReceiptV1 {
    pub contract: String,
    pub backend: FilmExecutionBackendV1,
    pub stage_order: Vec<String>,
    pub quality: String,
    pub tiled: bool,
    pub fallback: bool,
    pub error_code: Option<String>,
    pub post_film_hash: String,
}

impl FilmExecutionPlanV1 {
    pub fn reference(profile_content_sha256: &str, compiled_profile_sha256: &str) -> Self {
        Self {
            contract: PLAN_CONTRACT.to_string(),
            input_domain: "acescg_linear_v1".to_string(),
            output_domain: "acescg_linear_v1".to_string(),
            profile_content_sha256: profile_content_sha256.to_string(),
            compiled_profile_sha256: compiled_profile_sha256.to_string(),
            stage_order: STAGE_ORDER
                .iter()
                .map(|stage| (*stage).to_string())
                .collect(),
            halo_overlap_px: 32,
            border_policy_version: "reflect101_v1".to_string(),
            scale_filter_version: "variance_preserving_mip_v1".to_string(),
            model_abi_version: "film_model_abi_v1".to_string(),
            backend_abi_version: "film_backend_abi_v1".to_string(),
            plan_sha256: format!(
                "sha256:plan:{}:{}",
                profile_content_sha256, compiled_profile_sha256
            ),
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.contract != PLAN_CONTRACT
            || self.input_domain != "acescg_linear_v1"
            || self.output_domain != "acescg_linear_v1"
            || self.stage_order.iter().map(String::as_str).ne(STAGE_ORDER)
            || self.halo_overlap_px > 512
            || self.border_policy_version != "reflect101_v1"
            || self.scale_filter_version != "variance_preserving_mip_v1"
        {
            return Err("film_execution_invalid_plan");
        }
        Ok(())
    }
}

pub fn execute_cpu(
    image: &Rgb32FImage,
    params: FilmEmulationParams,
    plan: &FilmExecutionPlanV1,
    context: &FilmFrameContextV1,
) -> Result<(Rgb32FImage, FilmExecutionReceiptV1), &'static str> {
    plan.validate()?;
    if context.source_dimensions != [image.width(), image.height()]
        || context.quality == "interactive_drag_v1"
    {
        return Err("film_execution_quality_or_dimensions_unsupported");
    }
    let mut output = image.clone();
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let source_x = context.full_resolution_origin[0].saturating_add(x);
        let source_y = context.full_resolution_origin[1].saturating_add(y);
        pixel.0 = apply_pixel_at(Vec3::from_array(pixel.0), params, source_x, source_y).to_array();
    }
    let hash = hash_image(&output);
    let tiled = context.full_resolution_origin != [0, 0]
        || context.source_dimensions != [output.width(), output.height()];
    Ok((
        output,
        FilmExecutionReceiptV1 {
            contract: PLAN_CONTRACT.to_string(),
            backend: FilmExecutionBackendV1::Cpu,
            stage_order: STAGE_ORDER
                .iter()
                .map(|stage| (*stage).to_string())
                .collect(),
            quality: context.quality.clone(),
            tiled,
            fallback: false,
            error_code: None,
            post_film_hash: hash,
        },
    ))
}

fn hash_image(image: &Rgb32FImage) -> String {
    let mut hash = 0x811c9dc5_u32;
    for pixel in image.pixels() {
        for channel in pixel.0 {
            for byte in channel.to_le_bytes() {
                hash = hash.wrapping_mul(0x01000193) ^ u32::from(byte);
            }
        }
    }
    format!("fnv1a32:{hash:08x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageBuffer;

    fn context(width: u32, height: u32) -> FilmFrameContextV1 {
        FilmFrameContextV1 {
            source_identity: "source-a".into(),
            source_dimensions: [width, height],
            full_resolution_origin: [0, 0],
            render_scale_milli: 1000,
            quality: "settled_full_quality_v1".into(),
            deterministic_seed_inputs: "source-a:profile-a:1".into(),
            revision: "rev-1".into(),
        }
    }

    #[test]
    fn plan_order_and_cpu_execution_are_deterministic() {
        let plan = FilmExecutionPlanV1::reference("sha256:profile", "sha256:compiled");
        let image = ImageBuffer::from_pixel(2, 2, image::Rgb([0.35, 0.35, 0.35]));
        let params = FilmEmulationParams {
            enabled: true,
            mix: 1.0,
            shaper_p: 0.35,
            grain_amount: 0.0,
        };
        let first = execute_cpu(&image, params, &plan, &context(2, 2)).unwrap();
        let second = execute_cpu(&image, params, &plan, &context(2, 2)).unwrap();
        assert_eq!(first.1.post_film_hash, second.1.post_film_hash);
        assert_eq!(first.1.stage_order.len(), 9);
    }

    #[test]
    fn interactive_quality_and_reordered_plan_fail_closed() {
        let mut plan = FilmExecutionPlanV1::reference("sha256:profile", "sha256:compiled");
        plan.stage_order.swap(0, 1);
        assert!(plan.validate().is_err());
        let image = ImageBuffer::from_pixel(1, 1, image::Rgb([0.3, 0.3, 0.3]));
        let mut plan = FilmExecutionPlanV1::reference("sha256:profile", "sha256:compiled");
        let mut frame = context(1, 1);
        frame.quality = "interactive_drag_v1".into();
        assert!(
            execute_cpu(
                &image,
                FilmEmulationParams {
                    enabled: true,
                    mix: 1.0,
                    shaper_p: 0.35,
                    grain_amount: 0.0,
                },
                &plan,
                &frame
            )
            .is_err()
        );
        plan.halo_overlap_px = 513;
        assert!(plan.validate().is_err());
    }
}
