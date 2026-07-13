use crate::gpu_display::WgpuPresentationScheduler;
use glam::{Mat3, Vec2, Vec3};
use image::DynamicImage;
use rawler::decoders::Orientation;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use crate::color::view_transform::{ViewTransformPlanV1, ViewTransformSettingsV1};

pub const PERSISTED_RENDER_STATE_SCHEMA_VERSION: u32 = 2;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedStateRecoveryReceipt {
    pub from_version: u32,
    pub to_version: u32,
    pub source_identity: String,
    pub previous_edit_revision: Option<String>,
    pub disabled_fields: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub migrated_fields: Vec<String>,
    pub reason_codes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedRenderState {
    pub schema_version: u32,
    pub implementation_revision: u32,
    pub source_identity: String,
    pub edit_revision: String,
    /// Canonical user-authored pixel state. Product/source defaults are resolved at render time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_edits: Option<serde_json::Map<String, Value>>,
    pub defaults_policy_revision: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_input_transform_receipt: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xmp_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recovery_receipts: Vec<PersistedStateRecoveryReceipt>,
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub quarantined_extensions: serde_json::Map<String, Value>,
}

pub use crate::geometry::IntoCowImage;
pub use crate::gpu_processing::{
    RenderRequest, get_or_init_gpu_context, process_and_get_dynamic_image,
    process_and_get_dynamic_image_with_analytics, process_and_get_unclamped_dynamic_image,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RawEngineArtifacts {
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ai_provenance_entries: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hdr_merge_artifacts: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub negative_lab_artifacts: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layer_stack_sidecars: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub external_editor_artifacts: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub derived_output_provenance_sidecars: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub panorama_artifacts: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tether_capture_artifacts: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stale_artifact_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub xmp_conflict_receipts: Vec<Value>,
}

impl RawEngineArtifacts {
    pub fn new_v1() -> Self {
        Self {
            schema_version: 1,
            ai_provenance_entries: Vec::new(),
            hdr_merge_artifacts: Vec::new(),
            negative_lab_artifacts: Vec::new(),
            layer_stack_sidecars: Vec::new(),
            external_editor_artifacts: Vec::new(),
            derived_output_provenance_sidecars: Vec::new(),
            panorama_artifacts: Vec::new(),
            tether_capture_artifacts: Vec::new(),
            stale_artifact_ids: Vec::new(),
            xmp_conflict_receipts: Vec::new(),
        }
    }
}

impl Default for RawEngineArtifacts {
    fn default() -> Self {
        Self::new_v1()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageMetadata {
    pub version: u32,
    pub rating: u8,
    pub adjustments: Value,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exif: Option<std::collections::HashMap<String, String>>,
    #[serde(
        default,
        rename = "rawEngineArtifacts",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_engine_artifacts: Option<RawEngineArtifacts>,
    #[serde(
        default,
        rename = "persistedRenderState",
        skip_serializing_if = "Option::is_none"
    )]
    pub persisted_render_state: Option<PersistedRenderState>,
}

impl Default for ImageMetadata {
    fn default() -> Self {
        ImageMetadata {
            version: 1,
            rating: 0,
            adjustments: Value::Null,
            tags: None,
            exif: None,
            raw_engine_artifacts: None,
            persisted_render_state: None,
        }
    }
}

#[cfg(test)]
pub use crate::geometry::get_geometry_params_from_json;
pub use crate::geometry::{Crop, GeometryParams};

pub use crate::render::resample::downscale_f32_image_cow;

/// Compatibility entry point for consumers that require an owned image.
pub fn downscale_f32_image(image: &DynamicImage, nwidth: u32, nheight: u32) -> DynamicImage {
    downscale_f32_image_cow(image, nwidth, nheight, None)
        .expect("non-cancellable resampling should succeed")
        .into_owned()
}

pub fn apply_cpu_default_raw_processing(image: &mut DynamicImage) {
    let mut f32_image = image.to_rgb32f();

    const GAMMA: f32 = 2.38;
    const INV_GAMMA: f32 = 1.0 / GAMMA;
    const CONTRAST: f32 = 1.28;

    f32_image.par_chunks_mut(3).for_each(|pixel_chunk| {
        let r_gamma = pixel_chunk[0].powf(INV_GAMMA);
        let g_gamma = pixel_chunk[1].powf(INV_GAMMA);
        let b_gamma = pixel_chunk[2].powf(INV_GAMMA);

        let r_contrast = (r_gamma - 0.5) * CONTRAST + 0.5;
        let g_contrast = (g_gamma - 0.5) * CONTRAST + 0.5;
        let b_contrast = (b_gamma - 0.5) * CONTRAST + 0.5;

        pixel_chunk[0] = r_contrast.clamp(0.0, 1.0);
        pixel_chunk[1] = g_contrast.clamp(0.0, 1.0);
        pixel_chunk[2] = b_contrast.clamp(0.0, 1.0);
    });

    *image = DynamicImage::ImageRgb32F(f32_image);
}

pub fn apply_srgb_to_linear(mut image: DynamicImage) -> DynamicImage {
    let to_linear = |x: f32| -> f32 {
        let x = x.max(0.0);
        if x <= 0.04045 {
            x / 12.92
        } else {
            ((x + 0.055) / 1.055).powf(2.4)
        }
    };

    match &mut image {
        DynamicImage::ImageRgb32F(img) => {
            for p in img.pixels_mut() {
                p[0] = to_linear(p[0]);
                p[1] = to_linear(p[1]);
                p[2] = to_linear(p[2]);
            }
        }
        DynamicImage::ImageRgba32F(img) => {
            for p in img.pixels_mut() {
                p[0] = to_linear(p[0]);
                p[1] = to_linear(p[1]);
                p[2] = to_linear(p[2]);
            }
        }
        _ => {}
    }
    image
}

#[allow(dead_code)]
pub fn apply_linear_to_srgb(mut image: DynamicImage) -> DynamicImage {
    let to_srgb = |x: f32| -> f32 {
        let x = x.max(0.0);
        if x <= 0.0031308 {
            x * 12.92
        } else {
            1.055 * x.powf(1.0 / 2.4) - 0.055
        }
    };

    match &mut image {
        DynamicImage::ImageRgb32F(img) => {
            for p in img.pixels_mut() {
                p[0] = to_srgb(p[0]);
                p[1] = to_srgb(p[1]);
                p[2] = to_srgb(p[2]);
            }
        }
        DynamicImage::ImageRgba32F(img) => {
            for p in img.pixels_mut() {
                p[0] = to_srgb(p[0]);
                p[1] = to_srgb(p[1]);
                p[2] = to_srgb(p[2]);
            }
        }
        _ => {}
    }
    image
}

pub fn apply_orientation(image: DynamicImage, orientation: Orientation) -> DynamicImage {
    match orientation {
        Orientation::Normal | Orientation::Unknown => image,
        Orientation::HorizontalFlip => image.fliph(),
        Orientation::Rotate180 => image.rotate180(),
        Orientation::VerticalFlip => image.flipv(),
        Orientation::Transpose => image.rotate90().flipv(),
        Orientation::Rotate90 => image.rotate90(),
        Orientation::Transverse => image.rotate90().fliph(),
        Orientation::Rotate270 => image.rotate270(),
    }
}

#[cfg(feature = "ai")]
pub use crate::geometry::apply_unwarp_geometry;
pub use crate::geometry::{
    apply_coarse_rotation, apply_crop, apply_flip, apply_geometry_warp, apply_rotation,
    warp_image_geometry,
};

use crate::adjustments::abi::GpuMat3;
pub use crate::adjustments::abi::{AllAdjustments, MAX_MASKS};
#[cfg(test)]
pub use crate::adjustments::parse::get_all_adjustments_from_json;

const WP_D65: Vec2 = Vec2::new(0.3127, 0.3290);
const PRIMARIES_SRGB: [Vec2; 3] = [
    Vec2::new(0.64, 0.33),
    Vec2::new(0.30, 0.60),
    Vec2::new(0.15, 0.06),
];
const PRIMARIES_REC2020: [Vec2; 3] = [
    Vec2::new(0.708, 0.292),
    Vec2::new(0.170, 0.797),
    Vec2::new(0.131, 0.046),
];

fn xy_to_xyz(xy: Vec2) -> Vec3 {
    if xy.y < 1e-6 {
        Vec3::ZERO
    } else {
        Vec3::new(xy.x / xy.y, 1.0, (1.0 - xy.x - xy.y) / xy.y)
    }
}

fn primaries_to_xyz_matrix(primaries: &[Vec2; 3], white_point: Vec2) -> Mat3 {
    let r_xyz = xy_to_xyz(primaries[0]);
    let g_xyz = xy_to_xyz(primaries[1]);
    let b_xyz = xy_to_xyz(primaries[2]);
    let primaries_matrix = Mat3::from_cols(r_xyz, g_xyz, b_xyz);
    let white_point_xyz = xy_to_xyz(white_point);
    let s = primaries_matrix.inverse() * white_point_xyz;
    Mat3::from_cols(r_xyz * s.x, g_xyz * s.y, b_xyz * s.z)
}

fn rotate_and_scale_primary(primary: Vec2, white_point: Vec2, scale: f32, rotation: f32) -> Vec2 {
    let p_rel = primary - white_point;
    let p_scaled = p_rel * scale;
    let (sin_r, cos_r) = rotation.sin_cos();
    let p_rotated = Vec2::new(
        p_scaled.x * cos_r - p_scaled.y * sin_r,
        p_scaled.x * sin_r + p_scaled.y * cos_r,
    );
    white_point + p_rotated
}

fn mat3_to_gpu_mat3(m: Mat3) -> GpuMat3 {
    GpuMat3 {
        col0: [m.x_axis.x, m.x_axis.y, m.x_axis.z, 0.0],
        col1: [m.y_axis.x, m.y_axis.y, m.y_axis.z, 0.0],
        col2: [m.z_axis.x, m.z_axis.y, m.z_axis.z, 0.0],
    }
}

fn calculate_agx_matrices_glam() -> (Mat3, Mat3) {
    let pipe_work_profile_to_xyz = primaries_to_xyz_matrix(&PRIMARIES_SRGB, WP_D65);
    let base_profile_to_xyz = primaries_to_xyz_matrix(&PRIMARIES_REC2020, WP_D65);
    let xyz_to_base_profile = base_profile_to_xyz.inverse();
    let pipe_to_base = xyz_to_base_profile * pipe_work_profile_to_xyz;

    let inset = [0.294_624_5, 0.25861925, 0.14641371];
    let rotation = [0.03540329, -0.02108586, -0.06305724];
    let outset = [0.290_776_4, 0.263_155_4, 0.045_810_72];
    let unrotation = [0.03540329, -0.02108586, -0.06305724];
    let master_outset_ratio = 1.0;
    let master_unrotation_ratio = 0.0;

    let mut inset_and_rotated_primaries = [Vec2::ZERO; 3];
    for i in 0..3 {
        inset_and_rotated_primaries[i] =
            rotate_and_scale_primary(PRIMARIES_REC2020[i], WP_D65, 1.0 - inset[i], rotation[i]);
    }
    let rendering_to_xyz = primaries_to_xyz_matrix(&inset_and_rotated_primaries, WP_D65);
    let base_to_rendering = xyz_to_base_profile * rendering_to_xyz;

    let mut outset_and_unrotated_primaries = [Vec2::ZERO; 3];
    for i in 0..3 {
        outset_and_unrotated_primaries[i] = rotate_and_scale_primary(
            PRIMARIES_REC2020[i],
            WP_D65,
            1.0 - master_outset_ratio * outset[i],
            master_unrotation_ratio * unrotation[i],
        );
    }
    let outset_to_xyz = primaries_to_xyz_matrix(&outset_and_unrotated_primaries, WP_D65);
    let temp_matrix = xyz_to_base_profile * outset_to_xyz;
    let rendering_to_base = temp_matrix.inverse();

    let pipe_to_rendering = base_to_rendering * pipe_to_base;
    let rendering_to_pipe = pipe_to_base.inverse() * rendering_to_base;

    (pipe_to_rendering, rendering_to_pipe)
}

pub(crate) fn calculate_agx_matrices() -> (GpuMat3, GpuMat3) {
    let (pipe_to_rendering, rendering_to_pipe) = calculate_agx_matrices_glam();
    (
        mat3_to_gpu_mat3(pipe_to_rendering),
        mat3_to_gpu_mat3(rendering_to_pipe),
    )
}

pub fn resolve_tonemapper_override(settings: &crate::AppSettings, is_raw: bool) -> Option<u32> {
    if !settings.tonemapper_override_enabled.unwrap_or(false) {
        return None;
    }
    let tm = if is_raw {
        settings
            .default_raw_tonemapper
            .as_deref()
            .unwrap_or("rapidView")
    } else {
        settings
            .default_non_raw_tonemapper
            .as_deref()
            .unwrap_or("basic")
    };
    Some(match tm {
        "agx" => 1,
        "rapidView" => 2,
        _ => 0,
    })
}

pub fn resolve_tonemapper_override_from_handle(
    app_handle: &tauri::AppHandle,
    is_raw: bool,
) -> Option<u32> {
    let settings = crate::app_settings::load_settings_or_default(app_handle);
    resolve_tonemapper_override(&settings, is_raw)
}

pub fn apply_cpu_agx_tonemap(image: &mut DynamicImage) {
    const AGX_EPSILON: f32 = 1.0e-6;
    const AGX_MIN_EV: f32 = -15.2;
    const AGX_MAX_EV: f32 = 5.0;
    const AGX_RANGE_EV: f32 = AGX_MAX_EV - AGX_MIN_EV;
    const AGX_GAMMA: f32 = 2.4;
    const AGX_SLOPE: f32 = 2.3843;
    const AGX_TOE_POWER: f32 = 1.5;
    const AGX_SHOULDER_POWER: f32 = 1.5;
    const AGX_TOE_TRANSITION_X: f32 = 0.6060606;
    const AGX_TOE_TRANSITION_Y: f32 = 0.43446;
    const AGX_SHOULDER_TRANSITION_X: f32 = 0.6060606;
    const AGX_SHOULDER_TRANSITION_Y: f32 = 0.43446;
    const AGX_INTERCEPT: f32 = -1.0112;
    const AGX_TOE_SCALE: f32 = -1.0359;
    const AGX_SHOULDER_SCALE: f32 = 1.3475;

    fn agx_sigmoid(x: f32, power: f32) -> f32 {
        x / (1.0 + x.powf(power)).powf(1.0 / power)
    }

    fn agx_scaled_sigmoid(x: f32, scale: f32, slope: f32, power: f32, tx: f32, ty: f32) -> f32 {
        scale * agx_sigmoid(slope * (x - tx) / scale, power) + ty
    }

    fn agx_curve_channel(x: f32) -> f32 {
        let result = if x < AGX_TOE_TRANSITION_X {
            agx_scaled_sigmoid(
                x,
                AGX_TOE_SCALE,
                AGX_SLOPE,
                AGX_TOE_POWER,
                AGX_TOE_TRANSITION_X,
                AGX_TOE_TRANSITION_Y,
            )
        } else if x <= AGX_SHOULDER_TRANSITION_X {
            AGX_SLOPE * x + AGX_INTERCEPT
        } else {
            agx_scaled_sigmoid(
                x,
                AGX_SHOULDER_SCALE,
                AGX_SLOPE,
                AGX_SHOULDER_POWER,
                AGX_SHOULDER_TRANSITION_X,
                AGX_SHOULDER_TRANSITION_Y,
            )
        };
        result.clamp(0.0, 1.0)
    }

    const LUT_SIZE: usize = 4096;
    let mut curve_lut = [0.0f32; LUT_SIZE];
    for (i, slot) in curve_lut.iter_mut().enumerate() {
        let x = i as f32 / (LUT_SIZE - 1) as f32;
        *slot = agx_curve_channel(x).max(0.0).powf(AGX_GAMMA);
    }

    let (pipe_to_rendering, rendering_to_pipe) = calculate_agx_matrices_glam();

    let mut f32_image = image.to_rgb32f();

    f32_image.par_chunks_mut(3).for_each(|pixel_chunk| {
        let r = pixel_chunk[0];
        let g = pixel_chunk[1];
        let b = pixel_chunk[2];

        let min_c = r.min(g).min(b);
        let (r, g, b) = if min_c < 0.0 {
            (r - min_c, g - min_c, b - min_c)
        } else {
            (r, g, b)
        };

        let in_rendering = pipe_to_rendering * Vec3::new(r, g, b);

        let x = Vec3::new(
            (in_rendering.x / 0.18).max(AGX_EPSILON),
            (in_rendering.y / 0.18).max(AGX_EPSILON),
            (in_rendering.z / 0.18).max(AGX_EPSILON),
        );
        let log_encoded = Vec3::new(
            (x.x.log2() - AGX_MIN_EV) / AGX_RANGE_EV,
            (x.y.log2() - AGX_MIN_EV) / AGX_RANGE_EV,
            (x.z.log2() - AGX_MIN_EV) / AGX_RANGE_EV,
        );
        let mapped = Vec3::new(
            log_encoded.x.clamp(0.0, 1.0),
            log_encoded.y.clamp(0.0, 1.0),
            log_encoded.z.clamp(0.0, 1.0),
        );

        let lut_lookup = |v: f32| -> f32 {
            let idx = (v * (LUT_SIZE - 1) as f32) as usize;
            curve_lut[idx.min(LUT_SIZE - 1)]
        };
        let curved = Vec3::new(
            lut_lookup(mapped.x),
            lut_lookup(mapped.y),
            lut_lookup(mapped.z),
        );

        let final_color = rendering_to_pipe * curved;

        pixel_chunk[0] = final_color.x.clamp(0.0, 1.0);
        pixel_chunk[1] = final_color.y.clamp(0.0, 1.0);
        pixel_chunk[2] = final_color.z.clamp(0.0, 1.0);
    });

    *image = DynamicImage::ImageRgb32F(f32_image);
}

pub fn apply_cpu_rapid_view(image: &mut DynamicImage) {
    let plan = ViewTransformPlanV1::compile(ViewTransformSettingsV1::default())
        .expect("built-in Rapid View settings must compile");
    let mut f32_image = image.to_rgb32f();
    f32_image.par_chunks_mut(3).for_each(|pixel| {
        let mapped = plan.apply_rgb([pixel[0], pixel[1], pixel[2]]);
        for (destination, value) in pixel.iter_mut().zip(mapped) {
            let magnitude = value.abs();
            let encoded = if magnitude <= 0.003_130_8 {
                magnitude * 12.92
            } else {
                1.055 * magnitude.powf(1.0 / 2.4) - 0.055
            };
            *destination = value.signum() * encoded;
        }
    });
    *image = DynamicImage::ImageRgb32F(f32_image);
}

pub fn is_image_edited(
    adj: &serde_json::Value,
    is_raw: bool,
    tonemapper_override: Option<u32>,
) -> bool {
    if adj.is_null() || adj.as_object().is_none() {
        return false;
    }
    let revision = crate::render_plan::content_revision(adj, 0, 0, 0);
    crate::render_plan::compile_render_plan(
        adj,
        crate::render_plan::CompileRenderPlanContext {
            revision,
            is_raw,
            tonemapper_override,
        },
        None,
    )
    .map(|plan| plan.edit_graph.has_user_edits)
    // Invalid persisted edits are not neutral; callers must not silently treat
    // them as unedited and discard/quarantine their sidecar state.
    .unwrap_or(true)
}

#[derive(Clone)]
pub struct GpuContext {
    pub generation: u64,
    pub device: Arc<wgpu::Device>,
    pub queue: Arc<wgpu::Queue>,
    pub limits: wgpu::Limits,
    pub presentation: Arc<WgpuPresentationScheduler>,
}

#[inline(always)]
fn rgb_to_yc_only(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let y = 0.299 * r + 0.587 * g + 0.114 * b;
    let cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
    let cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
    (y, cb, cr)
}

#[inline(always)]
fn yc_to_rgb(y: f32, cb: f32, cr: f32) -> (f32, f32, f32) {
    let r = y + 1.402 * cr;
    let g = y - 0.344136 * cb - 0.714136 * cr;
    let b = y + 1.772 * cb;
    (r, g, b)
}

#[derive(Clone, Copy, Debug)]
pub struct CapturePreSharpeningSettings {
    pub amount: f32,
    pub detail: f32,
    pub edge_masking: f32,
    pub radius_px: f32,
}

impl Default for CapturePreSharpeningSettings {
    fn default() -> Self {
        Self {
            amount: 0.35,
            detail: 0.45,
            edge_masking: 0.3,
            radius_px: 2.0,
        }
    }
}

impl CapturePreSharpeningSettings {
    pub fn normalized(self) -> Self {
        Self {
            amount: self.amount.clamp(0.0, 1.0),
            detail: self.detail.clamp(0.0, 1.0),
            edge_masking: self.edge_masking.clamp(0.0, 1.0),
            radius_px: self.radius_px.clamp(0.5, 3.0),
        }
    }

    pub fn is_enabled(self) -> bool {
        self.amount > 0.0
    }
}

pub fn remove_raw_artifacts_and_enhance_with_settings(
    image: &mut DynamicImage,
    color_nr_inv_sigma: f32,
    sharpening_settings: CapturePreSharpeningSettings,
) {
    let sharpening_settings = sharpening_settings.normalized();
    let mut buffer = image.to_rgb32f();
    let w = buffer.width() as usize;
    let h = buffer.height() as usize;

    let mut ycbcr_buffer = vec![0.0f32; w * h * 3];

    let src = buffer.as_raw();

    ycbcr_buffer
        .par_chunks_mut(3)
        .zip(src.par_chunks(3))
        .for_each(|(dest, pixel)| {
            let (y, cb, cr) = rgb_to_yc_only(pixel[0], pixel[1], pixel[2]);
            dest[0] = y;
            dest[1] = cb;
            dest[2] = cr;
        });

    if color_nr_inv_sigma > 0.0 {
        let base_inv_sigma = color_nr_inv_sigma;
        const OFFSETS: [isize; 3] = [-5, -1, 3];
        const OFFSET_SQUARES: [f32; 3] = [25.0, 1.0, 9.0];

        buffer
            .par_chunks_mut(w * 3)
            .enumerate()
            .for_each(|(y, row)| {
                let row_offset = y * w;
                let h_isize = h as isize;
                let w_isize = w as isize;
                let y_isize = y as isize;

                for x in 0..w {
                    let center_idx = (row_offset + x) * 3;

                    let cy = ycbcr_buffer[center_idx];
                    let ccb = ycbcr_buffer[center_idx + 1];
                    let ccr = ycbcr_buffer[center_idx + 2];

                    let mut cb_sum = 0.0;
                    let mut cr_sum = 0.0;
                    let mut w_sum = 0.0;

                    for (ki, &ky) in OFFSETS.iter().enumerate() {
                        let sy = y_isize + ky;
                        if sy < 0 || sy >= h_isize {
                            continue;
                        }

                        let neighbor_row_idx = (sy as usize) * w;
                        let ky_sq_div_50 = OFFSET_SQUARES[ki] * 0.02;

                        for (kj, &kx) in OFFSETS.iter().enumerate() {
                            let sx = (x as isize) + kx;
                            if sx < 0 || sx >= w_isize {
                                continue;
                            }

                            let neighbor_idx = (neighbor_row_idx + sx as usize) * 3;

                            let neighbor_y = ycbcr_buffer[neighbor_idx];
                            let y_diff = (cy - neighbor_y).abs();

                            let val = y_diff * base_inv_sigma;
                            let spatial_penalty = OFFSET_SQUARES[kj] * 0.02 + ky_sq_div_50;

                            let weight = 1.0 / (1.0 + val * val + spatial_penalty);

                            cb_sum += ycbcr_buffer[neighbor_idx + 1] * weight;
                            cr_sum += ycbcr_buffer[neighbor_idx + 2] * weight;
                            w_sum += weight;
                        }
                    }

                    let (out_cb, out_cr) = if w_sum > 1e-4 {
                        let inv_w_sum = 1.0 / w_sum;
                        let filtered_cb = cb_sum * inv_w_sum;
                        let filtered_cr = cr_sum * inv_w_sum;

                        let orig_mag_sq = ccb * ccb + ccr * ccr;
                        let filt_mag_sq = filtered_cb * filtered_cb + filtered_cr * filtered_cr;

                        if filt_mag_sq > orig_mag_sq && orig_mag_sq > 1e-12 {
                            let scale = (orig_mag_sq / filt_mag_sq).sqrt();
                            (filtered_cb * scale, filtered_cr * scale)
                        } else {
                            (filtered_cb, filtered_cr)
                        }
                    } else {
                        (ccb, ccr)
                    };

                    let (r, g, b) = yc_to_rgb(cy, out_cb, out_cr);

                    let o = x * 3;
                    row[o] = r.clamp(0.0, 1.0);
                    row[o + 1] = g.clamp(0.0, 1.0);
                    row[o + 2] = b.clamp(0.0, 1.0);
                }
            });
    }

    if sharpening_settings.is_enabled() {
        apply_gentle_detail_enhance(&mut buffer, &ycbcr_buffer, sharpening_settings);
    }

    *image = DynamicImage::ImageRgb32F(buffer);
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WaveletDetailSettings {
    pub fine_amount: f32,
    pub medium_amount: f32,
    pub coarse_amount: f32,
    pub edge_threshold: f32,
    pub halo_suppression: f32,
}

impl Default for WaveletDetailSettings {
    fn default() -> Self {
        Self {
            fine_amount: 0.0,
            medium_amount: 0.0,
            coarse_amount: 0.0,
            edge_threshold: 0.18,
            halo_suppression: 0.65,
        }
    }
}

#[allow(dead_code)]
pub fn apply_wavelet_detail_by_scale(image: &mut DynamicImage, settings: WaveletDetailSettings) {
    if settings.fine_amount.abs() <= f32::EPSILON
        && settings.medium_amount.abs() <= f32::EPSILON
        && settings.coarse_amount.abs() <= f32::EPSILON
    {
        return;
    }

    let mut buffer = image.to_rgb32f();
    let width = buffer.width() as usize;
    let height = buffer.height() as usize;
    if width == 0 || height == 0 {
        return;
    }

    let source = buffer.as_raw();
    let luma: Vec<f32> = source
        .par_chunks_exact(3)
        .map(|pixel| rgb_to_yc_only(pixel[0], pixel[1], pixel[2]).0)
        .collect();

    let fine_base = box_blur_luma(&luma, width, height, 1);
    let medium_base = box_blur_luma(&fine_base, width, height, 3);
    let coarse_base = box_blur_luma(&medium_base, width, height, 7);

    let fine_gain = (settings.fine_amount / 100.0).clamp(-1.0, 1.0);
    let medium_gain = (settings.medium_amount / 100.0).clamp(-1.0, 1.0) * 0.75;
    let coarse_gain = (settings.coarse_amount / 100.0).clamp(-1.0, 1.0) * 0.5;
    let edge_threshold = settings.edge_threshold.clamp(0.0, 1.0);
    let halo_suppression = settings.halo_suppression.clamp(0.0, 1.0);

    buffer
        .as_mut()
        .par_chunks_mut(width * 3)
        .enumerate()
        .for_each(|(y, row)| {
            let row_offset = y * width;
            for x in 0..width {
                let idx = row_offset + x;
                let fine = luma[idx] - fine_base[idx];
                let medium = fine_base[idx] - medium_base[idx];
                let coarse = medium_base[idx] - coarse_base[idx];

                let detail_energy = fine.abs() + medium.abs() + coarse.abs();
                let over_edge = (detail_energy - edge_threshold).max(0.0);
                let halo_guard = 1.0 - halo_suppression * (over_edge / (over_edge + 0.2));
                let boost =
                    (fine * fine_gain + medium * medium_gain + coarse * coarse_gain) * halo_guard;

                let r_idx = x * 3;
                let g_idx = r_idx + 1;
                let b_idx = r_idx + 2;
                let r = row[r_idx];
                let g = row[g_idx];
                let b = row[b_idx];

                row[r_idx] = (r + boost).clamp(0.0, 1.0);
                row[g_idx] = (g + boost).clamp(0.0, 1.0);
                row[b_idx] = (b + boost).clamp(0.0, 1.0);
            }
        });

    *image = DynamicImage::ImageRgb32F(buffer);
}

#[allow(dead_code)]
fn box_blur_luma(source: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    if radius == 0 || width == 0 || height == 0 {
        return source.to_vec();
    }

    let diameter = radius * 2 + 1;
    let mut horizontal = vec![0.0; source.len()];

    horizontal
        .par_chunks_mut(width)
        .enumerate()
        .for_each(|(y, row)| {
            let row_offset = y * width;
            for (x, value) in row.iter_mut().enumerate() {
                let x_start = x.saturating_sub(radius);
                let x_end = (x + radius + 1).min(width);
                let mut sum = 0.0;
                for sx in x_start..x_end {
                    sum += source[row_offset + sx];
                }
                *value = sum / diameter.min(x_end - x_start) as f32;
            }
        });

    let mut vertical = vec![0.0; source.len()];
    vertical
        .par_chunks_mut(width)
        .enumerate()
        .for_each(|(y, row)| {
            let y_start = y.saturating_sub(radius);
            let y_end = (y + radius + 1).min(height);
            for (x, value) in row.iter_mut().enumerate() {
                let mut sum = 0.0;
                for sy in y_start..y_end {
                    sum += horizontal[sy * width + x];
                }
                *value = sum / diameter.min(y_end - y_start) as f32;
            }
        });

    vertical
}

fn apply_gentle_detail_enhance(
    buffer: &mut image::ImageBuffer<image::Rgb<f32>, Vec<f32>>,
    ycbcr_source: &[f32],
    settings: CapturePreSharpeningSettings,
) {
    let w = buffer.width() as usize;
    let h = buffer.height() as usize;

    let mut temp_blur = vec![0.0; w * h];
    let radius = settings.radius_px.round().clamp(1.0, 3.0) as i32;
    let amount = settings.amount;
    let detail_gain = 1.0 + (settings.detail - 0.45) * 0.8;
    let edge_mask_threshold = settings.edge_masking * 0.08;

    temp_blur
        .par_chunks_mut(w)
        .enumerate()
        .for_each(|(y, row)| {
            let row_offset = y * w;
            for (x, row_val) in row.iter_mut().enumerate() {
                let mut sum = 0.0;
                let mut count = 0;
                for kx in -radius..=radius {
                    let sx = (x as i32 + kx).clamp(0, (w as i32) - 1) as usize;
                    sum += ycbcr_source[(row_offset + sx) * 3];
                    count += 1;
                }
                *row_val = sum / count as f32;
            }
        });

    let output = buffer.as_mut();

    output
        .par_chunks_mut(w * 3)
        .enumerate()
        .for_each(|(y, rgb_row)| {
            for x in 0..w {
                let mut blur_sum = 0.0;
                let mut count = 0;
                for ky in -radius..=radius {
                    let sy = (y as i32 + ky).clamp(0, (h as i32) - 1) as usize;
                    blur_sum += temp_blur[sy * w + x];
                    count += 1;
                }
                let blurred_val = blur_sum / count as f32;

                let original_luma = ycbcr_source[(y * w + x) * 3];

                let detail = (original_luma - blurred_val) * detail_gain;

                let edge_strength = detail.abs();
                let low_edge_mask = if edge_mask_threshold <= f32::EPSILON {
                    1.0
                } else {
                    (edge_strength / edge_mask_threshold).clamp(0.0, 1.0)
                };
                let adaptive_amount = if edge_strength > 0.1 {
                    amount * 0.3
                } else {
                    amount
                } * low_edge_mask;
                let boost = detail * adaptive_amount;

                let r_idx = x * 3;
                let g_idx = r_idx + 1;
                let b_idx = r_idx + 2;

                let r = rgb_row[r_idx];
                let g = rgb_row[g_idx];
                let b = rgb_row[b_idx];

                let new_r = r + boost;
                let new_g = g + boost;
                let new_b = b + boost;

                let max_val = new_r.max(new_g).max(new_b);
                let min_val = new_r.min(new_g).min(new_b);

                let scale = if max_val > 1.0 || min_val < 0.0 {
                    if max_val > 1.0 && min_val < 0.0 {
                        0.0
                    } else if max_val > 1.0 {
                        (1.0 - r.max(g).max(b)) / boost.max(0.001)
                    } else {
                        r.min(g).min(b) / (-boost).max(0.001)
                    }
                } else {
                    1.0
                };

                let safe_boost = boost * scale.clamp(0.0, 1.0);

                rgb_row[r_idx] = (r + safe_boost).clamp(0.0, 1.0);
                rgb_row[g_idx] = (g + safe_boost).clamp(0.0, 1.0);
                rgb_row[b_idx] = (b + safe_boost).clamp(0.0, 1.0);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        CapturePreSharpeningSettings, GeometryParams, ImageMetadata, RawEngineArtifacts,
        WaveletDetailSettings, apply_wavelet_detail_by_scale, get_geometry_params_from_json,
        is_image_edited, remove_raw_artifacts_and_enhance_with_settings,
    };
    use crate::image_analytics::calculate_gamut_warning_overlay_from_image;
    use image::{DynamicImage, ImageBuffer, Rgb, Rgb32FImage, Rgba, RgbaImage};
    use serde_json::json;

    fn synthetic_edge_image() -> DynamicImage {
        let mut buffer = ImageBuffer::<Rgb<f32>, Vec<f32>>::new(9, 5);
        for y in 0..5 {
            for x in 0..9 {
                let value = if x < 4 { 0.25 } else { 0.75 };
                buffer.put_pixel(x, y, Rgb([value, value, value]));
            }
        }
        DynamicImage::ImageRgb32F(buffer)
    }

    fn red_channel(image: &DynamicImage, x: u32, y: u32) -> f32 {
        image.to_rgb32f().get_pixel(x, y).0[0]
    }

    fn assert_close(left: f32, right: f32) {
        assert!((left - right).abs() < 1e-6, "{left} != {right}");
    }

    #[test]
    fn geometry_params_deserialize_defaults_from_empty_adjustments() {
        let params = get_geometry_params_from_json(&json!({}));

        assert_eq!(params.distortion, 0.0);
        assert_eq!(params.scale, 100.0);
        assert_eq!(params.lens_distortion_amount, 1.0);
        assert_eq!(params.lens_vignette_amount, 1.0);
        assert_eq!(params.lens_tca_amount, 1.0);
        assert!(params.lens_distortion_enabled);
        assert!(params.lens_tca_enabled);
        assert!(params.lens_vignette_enabled);
        assert_eq!(params.lens_dist_k1, 0.0);
        assert_eq!(params.tca_vr, 1.0);
        assert_eq!(params.tca_vb, 1.0);
    }

    #[test]
    fn edited_status_consumes_the_canonical_graph_and_fails_safe() {
        assert!(!is_image_edited(&json!({}), false, None));
        assert!(is_image_edited(&json!({"exposure": 10}), false, None));
        assert!(is_image_edited(
            &json!({"rawEngineEditGraphVersion": 2}),
            false,
            None
        ));
    }

    #[test]
    fn geometry_params_deserialize_transform_and_lens_values() {
        let params = get_geometry_params_from_json(&json!({
            "transformDistortion": 12.5,
            "transformVertical": -3.0,
            "transformHorizontal": 4.0,
            "transformRotate": 1.5,
            "transformAspect": -2.0,
            "transformScale": 88.0,
            "transformXOffset": 9.0,
            "transformYOffset": -7.0,
            "lensDistortionAmount": 55.0,
            "lensVignetteAmount": 70.0,
            "lensTcaAmount": 80.0,
            "lensDistortionEnabled": false,
            "lensTcaEnabled": false,
            "lensVignetteEnabled": false,
            "lensDistortionParams": {
                "k1": 0.12,
                "k2": -0.03,
                "k3": 0.004,
                "model": 2,
                "tca_vr": 0.99,
                "tca_vb": 1.02,
                "vig_k1": -0.2,
                "vig_k2": 0.05,
                "vig_k3": -0.01
            }
        }));

        assert_eq!(params.distortion, 12.5);
        assert_eq!(params.vertical, -3.0);
        assert_eq!(params.horizontal, 4.0);
        assert_eq!(params.rotate, 1.5);
        assert_eq!(params.aspect, -2.0);
        assert_eq!(params.scale, 88.0);
        assert_eq!(params.x_offset, 9.0);
        assert_eq!(params.y_offset, -7.0);
        assert_close(params.lens_distortion_amount, 0.55);
        assert_close(params.lens_vignette_amount, 0.7);
        assert_close(params.lens_tca_amount, 0.8);
        assert!(!params.lens_distortion_enabled);
        assert!(!params.lens_tca_enabled);
        assert!(!params.lens_vignette_enabled);
        assert_close(params.lens_dist_k1, 0.12);
        assert_close(params.lens_dist_k2, -0.03);
        assert_close(params.lens_dist_k3, 0.004);
        assert_eq!(params.lens_model, 2);
        assert_close(params.tca_vr, 0.99);
        assert_close(params.tca_vb, 1.02);
        assert_close(params.vig_k1, -0.2);
        assert_close(params.vig_k2, 0.05);
        assert_close(params.vig_k3, -0.01);
    }

    #[test]
    fn geometry_params_deserialize_malformed_adjustments_as_defaults() {
        let params = get_geometry_params_from_json(&json!("not an adjustment object"));

        assert_eq!(params.scale, GeometryParams::default().scale);
        assert_eq!(
            params.lens_distortion_amount,
            GeometryParams::default().lens_distortion_amount
        );
        assert!(params.lens_distortion_enabled);
    }

    #[test]
    fn gamut_warning_overlay_reports_output_referred_clip_coverage() {
        let mut image = RgbaImage::new(4, 2);
        for y in 0..2 {
            for x in 0..4 {
                image.put_pixel(x, y, Rgba([64, 96, 128, 255]));
            }
        }
        image.put_pixel(0, 0, Rgba([255, 96, 128, 255]));
        image.put_pixel(1, 0, Rgba([64, 0, 128, 255]));

        let overlay = calculate_gamut_warning_overlay_from_image(&DynamicImage::ImageRgba8(image))
            .expect("synthetic overlay should encode");

        assert_eq!(overlay.width, 4);
        assert_eq!(overlay.height, 2);
        assert_eq!(overlay.warning_pixel_count, 2);
        assert_eq!(overlay.pixel_count, 8);
        assert_eq!(overlay.min_channel_value, 0);
        assert_eq!(overlay.max_channel_value, 255);
        assert!((overlay.coverage_ratio - 0.25).abs() < f32::EPSILON);
        assert!(overlay.mask_data_url.starts_with("data:image/png;base64,"));
    }

    fn synthetic_texture_image() -> DynamicImage {
        let width = 64;
        let height = 32;
        let mut data = Vec::with_capacity(width * height * 3);

        for y in 0..height {
            for x in 0..width {
                let gradient = x as f32 / width as f32 * 0.2;
                let fine = if (x + y) % 2 == 0 { 0.04 } else { -0.04 };
                let medium = if (x / 4 + y / 4) % 2 == 0 {
                    0.05
                } else {
                    -0.05
                };
                let value = (0.45 + gradient + fine + medium).clamp(0.0, 1.0);
                data.extend_from_slice(&[value, value, value]);
            }
        }

        DynamicImage::ImageRgb32F(
            Rgb32FImage::from_raw(width as u32, height as u32, data)
                .expect("synthetic buffer dimensions should match"),
        )
    }

    fn luma_variance(image: &DynamicImage) -> f32 {
        let rgb = image.to_rgb32f();
        let raw = rgb.as_raw();
        let luma_values: Vec<f32> = raw
            .chunks_exact(3)
            .map(|pixel| 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2])
            .collect();
        let mean = luma_values.iter().sum::<f32>() / luma_values.len() as f32;
        luma_values
            .iter()
            .map(|value| {
                let delta = value - mean;
                delta * delta
            })
            .sum::<f32>()
            / luma_values.len() as f32
    }

    fn mean_abs_luma_delta(left: &DynamicImage, right: &DynamicImage) -> f32 {
        let left_rgb = left.to_rgb32f();
        let right_rgb = right.to_rgb32f();
        let left_raw = left_rgb.as_raw();
        let right_raw = right_rgb.as_raw();
        left_raw
            .chunks_exact(3)
            .zip(right_raw.chunks_exact(3))
            .map(|(left_pixel, right_pixel)| {
                let left_luma =
                    0.299 * left_pixel[0] + 0.587 * left_pixel[1] + 0.114 * left_pixel[2];
                let right_luma =
                    0.299 * right_pixel[0] + 0.587 * right_pixel[1] + 0.114 * right_pixel[2];
                (left_luma - right_luma).abs()
            })
            .sum::<f32>()
            / (left_raw.len() / 3) as f32
    }

    #[test]
    fn capture_pre_sharpening_enhances_synthetic_edge() {
        let before = synthetic_edge_image();
        let mut after = before.clone();

        remove_raw_artifacts_and_enhance_with_settings(
            &mut after,
            0.0,
            CapturePreSharpeningSettings {
                amount: 0.75,
                ..CapturePreSharpeningSettings::default()
            },
        );

        let before_contrast = red_channel(&before, 4, 2) - red_channel(&before, 3, 2);
        let after_contrast = red_channel(&after, 4, 2) - red_channel(&after, 3, 2);

        assert!(
            after_contrast > before_contrast,
            "capture sharpening should increase edge contrast"
        );
    }

    #[test]
    fn disabled_capture_pre_sharpening_preserves_synthetic_edge() {
        let before = synthetic_edge_image();
        let mut after = before.clone();

        remove_raw_artifacts_and_enhance_with_settings(
            &mut after,
            0.0,
            CapturePreSharpeningSettings {
                amount: 0.0,
                ..CapturePreSharpeningSettings::default()
            },
        );

        for y in 0..5 {
            for x in 0..9 {
                assert_eq!(red_channel(&after, x, y), red_channel(&before, x, y));
            }
        }
    }

    #[test]
    fn capture_pre_sharpening_advanced_settings_change_output() {
        let mut narrow_detail = synthetic_texture_image();
        let mut wide_detail = synthetic_texture_image();

        remove_raw_artifacts_and_enhance_with_settings(
            &mut narrow_detail,
            0.0,
            CapturePreSharpeningSettings {
                amount: 0.7,
                detail: 0.2,
                edge_masking: 0.0,
                radius_px: 1.0,
            },
        );
        remove_raw_artifacts_and_enhance_with_settings(
            &mut wide_detail,
            0.0,
            CapturePreSharpeningSettings {
                amount: 0.7,
                detail: 0.9,
                edge_masking: 0.0,
                radius_px: 3.0,
            },
        );

        assert!(
            mean_abs_luma_delta(&narrow_detail, &wide_detail) > 0.001,
            "radius/detail controls should produce measurably different capture sharpening output"
        );
    }

    #[test]
    fn capture_pre_sharpening_edge_masking_protects_low_contrast_texture() {
        let mut unmasked = synthetic_texture_image();
        let mut masked = synthetic_texture_image();

        remove_raw_artifacts_and_enhance_with_settings(
            &mut unmasked,
            0.0,
            CapturePreSharpeningSettings {
                amount: 0.8,
                detail: 0.8,
                edge_masking: 0.0,
                radius_px: 1.0,
            },
        );
        remove_raw_artifacts_and_enhance_with_settings(
            &mut masked,
            0.0,
            CapturePreSharpeningSettings {
                amount: 0.8,
                detail: 0.8,
                edge_masking: 1.0,
                radius_px: 1.0,
            },
        );

        assert!(
            luma_variance(&masked) < luma_variance(&unmasked),
            "edge masking should reduce sharpening energy in low-contrast texture"
        );
    }

    #[test]
    fn image_metadata_defaults_without_raw_engine_artifacts() {
        let metadata: ImageMetadata = serde_json::from_value(json!({
            "version": 1,
            "rating": 0,
            "adjustments": null,
            "tags": null
        }))
        .expect("legacy sidecar metadata should deserialize");

        assert!(metadata.raw_engine_artifacts.is_none());
    }

    #[test]
    fn image_metadata_preserves_raw_engine_artifacts() {
        let metadata = ImageMetadata {
            version: 1,
            rating: 5,
            adjustments: json!({ "exposure": 0.15 }),
            tags: Some(vec!["color:green".to_string(), "user:panorama".to_string()]),
            exif: None,
            raw_engine_artifacts: Some(RawEngineArtifacts {
                ai_provenance_entries: vec![json!({
                    "provenanceEntryId": "prov_ai_subject_mask_001",
                    "providerId": "rawengine-local-ai",
                    "modelId": "local_sam2_subject_mask",
                    "settingsHash": "sha256:sample-ai-subject-mask-settings"
                })],
                panorama_artifacts: vec![json!({
                    "artifactId": "artifact_panorama_session_0001",
                    "provenance": { "runtimeStatus": "rendered" }
                })],
                ..RawEngineArtifacts::new_v1()
            }),
            persisted_render_state: None,
        };

        let roundtripped: ImageMetadata = serde_json::from_value(
            serde_json::to_value(&metadata).expect("sidecar metadata should serialize"),
        )
        .expect("sidecar metadata should deserialize");

        let artifacts = roundtripped
            .raw_engine_artifacts
            .expect("rawEngineArtifacts should roundtrip");

        assert_eq!(artifacts.schema_version, 1);
        assert_eq!(artifacts.panorama_artifacts.len(), 1);
        assert_eq!(
            artifacts.panorama_artifacts[0]["artifactId"],
            "artifact_panorama_session_0001"
        );
        assert_eq!(
            artifacts.ai_provenance_entries[0]["provenanceEntryId"],
            "prov_ai_subject_mask_001"
        );
        assert!(artifacts.stale_artifact_ids.is_empty());
    }

    #[test]
    fn wavelet_detail_by_scale_increases_texture_variance() {
        let mut image = synthetic_texture_image();
        let before = luma_variance(&image);

        apply_wavelet_detail_by_scale(
            &mut image,
            WaveletDetailSettings {
                fine_amount: 55.0,
                medium_amount: 35.0,
                coarse_amount: 0.0,
                edge_threshold: 0.28,
                halo_suppression: 0.8,
            },
        );

        let after = luma_variance(&image);
        assert!(
            after > before * 1.08,
            "wavelet detail should increase texture variance: before={before} after={after}"
        );
    }

    #[test]
    fn disabled_wavelet_detail_preserves_pixels() {
        let mut image = synthetic_texture_image();
        let before = image.to_rgb32f();

        apply_wavelet_detail_by_scale(&mut image, WaveletDetailSettings::default());

        assert_eq!(before.as_raw(), image.to_rgb32f().as_raw());
    }
}
