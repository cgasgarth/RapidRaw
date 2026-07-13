use image::{DynamicImage, GenericImageView, Rgb32FImage, Rgba};
use imageproc::geometric_transformations::{Border, Interpolation, rotate_about_center};
use nalgebra::{Matrix3 as NaMatrix3, Vector3 as NaVector3};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::borrow::Cow;
use std::f32::consts::PI;

pub mod perspective;

pub trait IntoCowImage<'a> {
    fn into_cow(self) -> Cow<'a, DynamicImage>;
}

impl<'a> IntoCowImage<'a> for DynamicImage {
    fn into_cow(self) -> Cow<'a, DynamicImage> {
        Cow::Owned(self)
    }
}

impl<'a> IntoCowImage<'a> for &'a DynamicImage {
    fn into_cow(self) -> Cow<'a, DynamicImage> {
        Cow::Borrowed(self)
    }
}

impl<'a> IntoCowImage<'a> for Cow<'a, DynamicImage> {
    fn into_cow(self) -> Cow<'a, DynamicImage> {
        self
    }
}

impl<'a> IntoCowImage<'a> for &'a std::sync::Arc<DynamicImage> {
    fn into_cow(self) -> Cow<'a, DynamicImage> {
        Cow::Borrowed(self.as_ref())
    }
}
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct GeometryParams {
    pub distortion: f32,
    pub vertical: f32,
    pub horizontal: f32,
    pub rotate: f32,
    pub aspect: f32,
    pub scale: f32,
    pub x_offset: f32,
    pub y_offset: f32,
    pub lens_distortion_amount: f32,
    pub lens_vignette_amount: f32,
    pub lens_tca_amount: f32,
    pub lens_distortion_enabled: bool,
    pub lens_tca_enabled: bool,
    pub lens_vignette_enabled: bool,
    pub lens_dist_k1: f32,
    pub lens_dist_k2: f32,
    pub lens_dist_k3: f32,
    pub lens_model: u32,
    pub tca_vr: f32,
    pub tca_vb: f32,
    pub vig_k1: f32,
    pub vig_k2: f32,
    pub vig_k3: f32,
    pub perspective_source_to_corrected: [f32; 9],
}

impl Default for GeometryParams {
    fn default() -> Self {
        Self {
            distortion: 0.0,
            vertical: 0.0,
            horizontal: 0.0,
            rotate: 0.0,
            aspect: 0.0,
            scale: 100.0,
            x_offset: 0.0,
            y_offset: 0.0,
            lens_distortion_amount: 1.0,
            lens_vignette_amount: 1.0,
            lens_tca_amount: 1.0,
            lens_distortion_enabled: true,
            lens_tca_enabled: true,
            lens_vignette_enabled: true,
            lens_dist_k1: 0.0,
            lens_dist_k2: 0.0,
            lens_dist_k3: 0.0,
            lens_model: 0,
            tca_vr: 1.0,
            tca_vb: 1.0,
            vig_k1: 0.0,
            vig_k2: 0.0,
            vig_k3: 0.0,
            perspective_source_to_corrected: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        }
    }
}

fn default_transform_scale() -> f32 {
    100.0
}

fn default_lens_amount() -> f32 {
    100.0
}

fn default_lens_enabled() -> bool {
    true
}

fn default_tca_scale() -> f32 {
    1.0
}

#[derive(Debug, Deserialize)]
struct RawLensDistortionParams {
    #[serde(default)]
    k1: f32,
    #[serde(default)]
    k2: f32,
    #[serde(default)]
    k3: f32,
    #[serde(default)]
    model: u32,
    #[serde(rename = "tca_vr")]
    #[serde(default = "default_tca_scale")]
    tca_vr: f32,
    #[serde(rename = "tca_vb")]
    #[serde(default = "default_tca_scale")]
    tca_vb: f32,
    #[serde(rename = "vig_k1")]
    #[serde(default)]
    vig_k1: f32,
    #[serde(rename = "vig_k2")]
    #[serde(default)]
    vig_k2: f32,
    #[serde(rename = "vig_k3")]
    #[serde(default)]
    vig_k3: f32,
}

impl Default for RawLensDistortionParams {
    fn default() -> Self {
        Self {
            k1: 0.0,
            k2: 0.0,
            k3: 0.0,
            model: 0,
            tca_vr: default_tca_scale(),
            tca_vb: default_tca_scale(),
            vig_k1: 0.0,
            vig_k2: 0.0,
            vig_k3: 0.0,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGeometryAdjustments {
    #[serde(default)]
    transform_distortion: f32,
    #[serde(default)]
    transform_vertical: f32,
    #[serde(default)]
    transform_horizontal: f32,
    #[serde(default)]
    transform_rotate: f32,
    #[serde(default)]
    transform_aspect: f32,
    #[serde(default = "default_transform_scale")]
    transform_scale: f32,
    #[serde(default)]
    transform_x_offset: f32,
    #[serde(default)]
    transform_y_offset: f32,
    #[serde(default = "default_lens_amount")]
    lens_distortion_amount: f32,
    #[serde(default = "default_lens_amount")]
    lens_vignette_amount: f32,
    #[serde(default = "default_lens_amount")]
    lens_tca_amount: f32,
    #[serde(default = "default_lens_enabled")]
    lens_distortion_enabled: bool,
    #[serde(default = "default_lens_enabled")]
    lens_tca_enabled: bool,
    #[serde(default = "default_lens_enabled")]
    lens_vignette_enabled: bool,
    #[serde(default)]
    lens_distortion_params: RawLensDistortionParams,
    #[serde(default)]
    perspective_correction: perspective::PerspectiveCorrectionSettingsV1,
}

impl Default for RawGeometryAdjustments {
    fn default() -> Self {
        Self {
            transform_distortion: 0.0,
            transform_vertical: 0.0,
            transform_horizontal: 0.0,
            transform_rotate: 0.0,
            transform_aspect: 0.0,
            transform_scale: default_transform_scale(),
            transform_x_offset: 0.0,
            transform_y_offset: 0.0,
            lens_distortion_amount: default_lens_amount(),
            lens_vignette_amount: default_lens_amount(),
            lens_tca_amount: default_lens_amount(),
            lens_distortion_enabled: default_lens_enabled(),
            lens_tca_enabled: default_lens_enabled(),
            lens_vignette_enabled: default_lens_enabled(),
            lens_distortion_params: RawLensDistortionParams::default(),
            perspective_correction: perspective::PerspectiveCorrectionSettingsV1::default(),
        }
    }
}

pub fn get_geometry_params_from_json(adjustments: &serde_json::Value) -> GeometryParams {
    let raw = serde_json::from_value::<RawGeometryAdjustments>(adjustments.clone())
        .unwrap_or_else(|_| RawGeometryAdjustments::default());

    let perspective_source_to_corrected =
        perspective::compile_perspective_plan(&raw.perspective_correction)
            .map(|receipt| {
                std::array::from_fn(|index| {
                    receipt.plan.source_to_corrected[index / 3][index % 3] as f32
                })
            })
            .unwrap_or([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);

    GeometryParams {
        distortion: raw.transform_distortion,
        vertical: raw.transform_vertical,
        horizontal: raw.transform_horizontal,
        rotate: raw.transform_rotate,
        aspect: raw.transform_aspect,
        scale: raw.transform_scale,
        x_offset: raw.transform_x_offset,
        y_offset: raw.transform_y_offset,
        lens_distortion_amount: raw.lens_distortion_amount / 100.0,
        lens_vignette_amount: raw.lens_vignette_amount / 100.0,
        lens_tca_amount: raw.lens_tca_amount / 100.0,
        lens_distortion_enabled: raw.lens_distortion_enabled,
        lens_tca_enabled: raw.lens_tca_enabled,
        lens_vignette_enabled: raw.lens_vignette_enabled,
        lens_dist_k1: raw.lens_distortion_params.k1,
        lens_dist_k2: raw.lens_distortion_params.k2,
        lens_dist_k3: raw.lens_distortion_params.k3,
        lens_model: raw.lens_distortion_params.model,
        tca_vr: raw.lens_distortion_params.tca_vr,
        tca_vb: raw.lens_distortion_params.tca_vb,
        vig_k1: raw.lens_distortion_params.vig_k1,
        vig_k2: raw.lens_distortion_params.vig_k2,
        vig_k3: raw.lens_distortion_params.vig_k3,
        perspective_source_to_corrected,
    }
}

#[inline(always)]
fn interpolate_pixel(
    src_raw: &[f32],
    src_width: usize,
    src_height: usize,
    x: f32,
    y: f32,
    pixel_out: &mut [f32],
) {
    if x.is_nan()
        || y.is_nan()
        || x < 0.0
        || y < 0.0
        || x >= (src_width as f32 - 1.0)
        || y >= (src_height as f32 - 1.0)
    {
        return;
    }

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;

    let wx = x - x0 as f32;
    let wy = y - y0 as f32;
    let one_minus_wx = 1.0 - wx;
    let one_minus_wy = 1.0 - wy;

    let stride = src_width * 3;
    let idx_row0 = y0 * stride;
    let idx_row1 = idx_row0 + stride;
    let idx_p00 = idx_row0 + x0 * 3;

    unsafe {
        let p00 = src_raw.get_unchecked(idx_p00..idx_p00 + 3);
        let p10 = src_raw.get_unchecked(idx_p00 + 3..idx_p00 + 6);
        let p01 = src_raw.get_unchecked(idx_row1 + x0 * 3..idx_row1 + x0 * 3 + 3);
        let p11 = src_raw.get_unchecked(idx_row1 + x0 * 3 + 3..idx_row1 + x0 * 3 + 6);

        let top_r = p00[0] * one_minus_wx + p10[0] * wx;
        let top_g = p00[1] * one_minus_wx + p10[1] * wx;
        let top_b = p00[2] * one_minus_wx + p10[2] * wx;

        let bot_r = p01[0] * one_minus_wx + p11[0] * wx;
        let bot_g = p01[1] * one_minus_wx + p11[1] * wx;
        let bot_b = p01[2] * one_minus_wx + p11[2] * wx;

        pixel_out[0] = top_r * one_minus_wy + bot_r * wy;
        pixel_out[1] = top_g * one_minus_wy + bot_g * wy;
        pixel_out[2] = top_b * one_minus_wy + bot_b * wy;
    }
}

fn build_transform_matrices(
    params: &GeometryParams,
    width: f32,
    height: f32,
) -> (NaMatrix3<f32>, f32, f32, f64) {
    let cx = width / 2.0;
    let cy = height / 2.0;
    let ref_dim = 2000.0;

    let p_vert = (params.vertical / 100000.0) * (ref_dim / height);
    let p_horiz = (-params.horizontal / 100000.0) * (ref_dim / width);
    let theta = params.rotate.to_radians();

    let aspect_factor = if params.aspect >= 0.0 {
        1.0 + params.aspect / 100.0
    } else {
        1.0 / (1.0 + params.aspect.abs() / 100.0)
    };

    let scale_factor = params.scale / 100.0;
    let off_x = (params.x_offset / 100.0) * width;
    let off_y = (params.y_offset / 100.0) * height;

    let t_center = NaMatrix3::new(1.0, 0.0, cx, 0.0, 1.0, cy, 0.0, 0.0, 1.0);
    let t_uncenter = NaMatrix3::new(1.0, 0.0, -cx, 0.0, 1.0, -cy, 0.0, 0.0, 1.0);
    let m_perspective = NaMatrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, p_horiz, p_vert, 1.0);

    let (sin_t, cos_t) = theta.sin_cos();
    let m_rotate = NaMatrix3::new(cos_t, -sin_t, 0.0, sin_t, cos_t, 0.0, 0.0, 0.0, 1.0);
    let m_scale = NaMatrix3::new(
        scale_factor * aspect_factor,
        0.0,
        0.0,
        0.0,
        scale_factor,
        0.0,
        0.0,
        0.0,
        1.0,
    );
    let m_offset = NaMatrix3::new(1.0, 0.0, off_x, 0.0, 1.0, off_y, 0.0, 0.0, 1.0);

    let normalized_to_pixels = NaMatrix3::new(width, 0.0, 0.0, 0.0, height, 0.0, 0.0, 0.0, 1.0);
    let pixels_to_normalized =
        NaMatrix3::new(1.0 / width, 0.0, 0.0, 0.0, 1.0 / height, 0.0, 0.0, 0.0, 1.0);
    let perspective = NaMatrix3::from_row_slice(&params.perspective_source_to_corrected);
    let perspective_pixels = normalized_to_pixels * perspective * pixels_to_normalized;
    let forward =
        t_center * m_offset * m_perspective * m_rotate * m_scale * t_uncenter * perspective_pixels;
    let half_diagonal =
        ((width as f64 * width as f64 + height as f64 * height as f64).sqrt()) / 2.0;

    (forward, cx, cy, half_diagonal)
}

struct TcaContext<'a> {
    src_raw: &'a [f32],
    src_width: usize,
    src_height: usize,
    cx: f32,
    cy: f32,
}

#[inline(always)]
fn interpolate_pixel_with_tca(
    tca: &TcaContext,
    base_x: f32,
    base_y: f32,
    vr: f32,
    vb: f32,
    pixel_out: &mut [f32],
) {
    let src_raw = tca.src_raw;
    let src_width = tca.src_width;
    let src_height = tca.src_height;
    let cx = tca.cx;
    let cy = tca.cy;
    let gx = base_x;
    let gy = base_y;

    let rx = cx + (base_x - cx) * vr;
    let ry = cy + (base_y - cy) * vr;

    let bx = cx + (base_x - cx) * vb;
    let by = cy + (base_y - cy) * vb;

    let sample_channel = |target_x: f32, target_y: f32, channel_idx: usize| -> f32 {
        if target_x.is_nan() || target_y.is_nan() {
            return 0.0;
        }

        let x_clamped = target_x.clamp(0.0, src_width as f32 - 1.0);
        let y_clamped = target_y.clamp(0.0, src_height as f32 - 1.0);

        let mut x0 = x_clamped.floor() as usize;
        let mut y0 = y_clamped.floor() as usize;

        if x0 >= src_width - 1 {
            x0 = src_width.saturating_sub(2);
        }
        if y0 >= src_height - 1 {
            y0 = src_height.saturating_sub(2);
        }

        let wx = x_clamped - x0 as f32;
        let wy = y_clamped - y0 as f32;
        let one_minus_wx = 1.0 - wx;
        let one_minus_wy = 1.0 - wy;

        let stride = src_width * 3;
        let idx_row0 = y0 * stride;
        let idx_row1 = idx_row0 + stride;

        let idx_p00 = idx_row0 + x0 * 3 + channel_idx;

        unsafe {
            let p00 = *src_raw.get_unchecked(idx_p00);
            let p10 = *src_raw.get_unchecked(idx_p00 + 3);
            let p01 = *src_raw.get_unchecked(idx_row1 + x0 * 3 + channel_idx);
            let p11 = *src_raw.get_unchecked(idx_row1 + x0 * 3 + 3 + channel_idx);

            let top = p00 * one_minus_wx + p10 * wx;
            let bot = p01 * one_minus_wx + p11 * wx;
            top * one_minus_wy + bot * wy
        }
    };

    pixel_out[0] = sample_channel(rx, ry, 0);
    pixel_out[1] = sample_channel(gx, gy, 1);
    pixel_out[2] = sample_channel(bx, by, 2);
}

fn solve_generic_distortion_inv(r_target: f64, k_scaled: f64) -> f64 {
    if k_scaled.abs() < 1e-9 {
        return r_target;
    }

    let mut r = r_target;
    for _ in 0..10 {
        let r2 = r * r;
        let val = k_scaled * r2 * r + r - r_target;
        let slope = 3.0 * k_scaled * r2 + 1.0;

        if slope.abs() < 1e-9 {
            break;
        }
        let delta = val / slope;
        r -= delta;
        if delta.abs() < 1e-6 {
            break;
        }
    }
    r
}

fn compute_lens_auto_crop_scale(params: &GeometryParams, width: f32, height: f32) -> f64 {
    let cx = (width / 2.0) as f64;
    let cy = (height / 2.0) as f64;
    let half_diagonal = (cx * cx + cy * cy).sqrt();
    let max_radius_sq_inv = 1.0 / (cx * cx + cy * cy);

    let lk1 = params.lens_dist_k1 as f64;
    let lk2 = params.lens_dist_k2 as f64;
    let lk3 = params.lens_dist_k3 as f64;
    let lens_dist_amt = (params.lens_distortion_amount as f64) * 2.5;

    let k_distortion = (params.distortion as f64 / 100.0) * 2.5;

    let has_lens_correction = params.lens_distortion_enabled
        && (lk1.abs() > 1e-6 || lk2.abs() > 1e-6 || lk3.abs() > 1e-6);
    let is_ptlens = params.lens_model == 1;

    let sample_points: [(f64, f64); 8] = [
        (cx, 0.0),
        (cx, height as f64),
        (0.0, cy),
        (width as f64, cy),
        (0.0, 0.0),
        (width as f64, 0.0),
        (0.0, height as f64),
        (width as f64, height as f64),
    ];

    let mut max_scale: f64 = 1.0;

    for &(px, py) in &sample_points {
        let dx = px - cx;
        let dy = py - cy;
        let ru = (dx * dx + dy * dy).sqrt();
        if ru < 1e-6 {
            continue;
        }

        let mut mapped_dx = dx;
        let mut mapped_dy = dy;

        if has_lens_correction {
            let ru_norm = ru / half_diagonal;
            let ru_norm2 = ru_norm * ru_norm;

            let rd_norm = if is_ptlens {
                let a = lk1;
                let b = lk2;
                let c = lk3;
                let d = 1.0 - a - b - c;
                ru_norm * (a * ru_norm2 * ru_norm + b * ru_norm2 + c * ru_norm + d)
            } else {
                ru_norm
                    * (1.0
                        + lk1 * ru_norm2
                        + lk2 * (ru_norm2 * ru_norm2)
                        + lk3 * (ru_norm2 * ru_norm2 * ru_norm2))
            };

            let effective_r_norm = ru_norm + (rd_norm - ru_norm) * lens_dist_amt;
            let scale = effective_r_norm / ru_norm;

            mapped_dx *= scale;
            mapped_dy *= scale;
        }

        if k_distortion.abs() > 1e-5 {
            let r2_norm = (mapped_dx * mapped_dx + mapped_dy * mapped_dy) * max_radius_sq_inv;
            let f = 1.0 + k_distortion * r2_norm;
            mapped_dx *= f;
            mapped_dy *= f;
        }

        let mapped_ru = (mapped_dx * mapped_dx + mapped_dy * mapped_dy).sqrt();
        let scale = mapped_ru / ru;

        if scale > max_scale {
            max_scale = scale;
        }
    }

    if max_scale > 1.0 {
        max_scale * 1.002
    } else {
        max_scale
    }
}

pub fn warp_image_geometry(image: &DynamicImage, params: GeometryParams) -> DynamicImage {
    let src_img = image.to_rgb32f();
    let (width, height) = src_img.dimensions();
    let mut out_buffer = vec![0.0f32; (width * height * 3) as usize];

    let (forward_transform, cx, cy, half_diagonal) =
        build_transform_matrices(&params, width as f32, height as f32);
    let inv = forward_transform
        .try_inverse()
        .unwrap_or(NaMatrix3::identity());

    let step_vec_x = NaVector3::new(inv[(0, 0)], inv[(1, 0)], inv[(2, 0)]);
    let step_vec_y = NaVector3::new(inv[(0, 1)], inv[(1, 1)], inv[(2, 1)]);
    let origin_vec = NaVector3::new(inv[(0, 2)], inv[(1, 2)], inv[(2, 2)]);

    let max_radius_sq_inv = 1.0 / ((cx * cx + cy * cy) as f64);
    let hd = half_diagonal;

    let k_distortion = (params.distortion as f64 / 100.0) * 2.5;
    let lk1 = params.lens_dist_k1 as f64;
    let lk2 = params.lens_dist_k2 as f64;
    let lk3 = params.lens_dist_k3 as f64;
    let lens_dist_amt = (params.lens_distortion_amount as f64) * 2.5;

    let has_lens_correction = params.lens_distortion_enabled
        && (lk1.abs() > 1e-6 || lk2.abs() > 1e-6 || lk3.abs() > 1e-6);
    let is_ptlens = params.lens_model == 1;

    let auto_crop_scale = if has_lens_correction || k_distortion.abs() > 1e-5 {
        compute_lens_auto_crop_scale(&params, width as f32, height as f32) as f32
    } else {
        1.0
    };

    let vr = if (params.tca_vr - 1.0).abs() > 1e-5 {
        params.tca_vr + (1.0 - params.tca_vr) * (1.0 - params.lens_tca_amount)
    } else {
        1.0
    };
    let vb = if (params.tca_vb - 1.0).abs() > 1e-5 {
        params.tca_vb + (1.0 - params.tca_vb) * (1.0 - params.lens_tca_amount)
    } else {
        1.0
    };
    let has_tca = params.lens_tca_enabled && ((vr - 1.0).abs() > 1e-5 || (vb - 1.0).abs() > 1e-5);

    let vk1 = params.vig_k1 as f64;
    let vk2 = params.vig_k2 as f64;
    let vk3 = params.vig_k3 as f64;
    let lens_vig_amt = (params.lens_vignette_amount as f64) * 0.8;
    let has_vignetting = params.lens_vignette_enabled
        && (vk1.abs() > 1e-6 || vk2.abs() > 1e-6 || vk3.abs() > 1e-6)
        && lens_vig_amt > 0.01;

    let src_raw = src_img.as_raw();
    let width_usize = width as usize;
    let height_usize = height as usize;
    let tca_ctx = TcaContext {
        src_raw,
        src_width: width_usize,
        src_height: height_usize,
        cx,
        cy,
    };

    out_buffer
        .par_chunks_exact_mut(width_usize * 3)
        .enumerate()
        .for_each(|(y, row_pixel_data)| {
            let y_f = y as f32;
            let mut current_vec = origin_vec + (step_vec_y * y_f);

            for pixel in row_pixel_data.chunks_exact_mut(3) {
                if current_vec.z.abs() > 1e-6 {
                    let inv_z = 1.0 / current_vec.z;
                    let mut src_x = current_vec.x * inv_z;
                    let mut src_y = current_vec.y * inv_z;

                    if auto_crop_scale > 1.0 {
                        src_x = cx + (src_x - cx) / auto_crop_scale;
                        src_y = cy + (src_y - cy) / auto_crop_scale;
                    }

                    if has_lens_correction {
                        let dx = (src_x - cx) as f64;
                        let dy = (src_y - cy) as f64;
                        let ru = (dx * dx + dy * dy).sqrt();

                        if ru > 1e-6 {
                            let ru_norm = ru / hd;
                            let ru_norm2 = ru_norm * ru_norm;

                            let rd_norm = if is_ptlens {
                                let a = lk1;
                                let b = lk2;
                                let c = lk3;
                                let d = 1.0 - a - b - c;
                                ru_norm * (a * ru_norm2 * ru_norm + b * ru_norm2 + c * ru_norm + d)
                            } else {
                                ru_norm
                                    * (1.0
                                        + lk1 * ru_norm2
                                        + lk2 * (ru_norm2 * ru_norm2)
                                        + lk3 * (ru_norm2 * ru_norm2 * ru_norm2))
                            };

                            let effective_r_norm = ru_norm + (rd_norm - ru_norm) * lens_dist_amt;
                            let scale = effective_r_norm / ru_norm;

                            src_x = cx + (dx * scale) as f32;
                            src_y = cy + (dy * scale) as f32;
                        }
                    }

                    if k_distortion.abs() > 1e-5 {
                        let dx = (src_x - cx) as f64;
                        let dy = (src_y - cy) as f64;
                        let r2_norm = (dx * dx + dy * dy) * max_radius_sq_inv;
                        let f = 1.0 + k_distortion * r2_norm;

                        src_x = cx + (dx * f) as f32;
                        src_y = cy + (dy * f) as f32;
                    }

                    if has_tca {
                        interpolate_pixel_with_tca(&tca_ctx, src_x, src_y, vr, vb, pixel);
                    } else {
                        interpolate_pixel(src_raw, width_usize, height_usize, src_x, src_y, pixel);
                    }

                    if has_vignetting {
                        let dx = (src_x - cx) as f64;
                        let dy = (src_y - cy) as f64;
                        let ru = (dx * dx + dy * dy).sqrt();
                        let ru_norm = ru / hd;
                        let ru_norm2 = ru_norm * ru_norm;

                        let v_factor = 1.0
                            + vk1 * ru_norm2
                            + vk2 * (ru_norm2 * ru_norm2)
                            + vk3 * (ru_norm2 * ru_norm2 * ru_norm2);

                        if v_factor > 1e-6 {
                            let correction_gain = 1.0 / v_factor;
                            let final_gain = 1.0 + (correction_gain - 1.0) * lens_vig_amt;

                            pixel[0] *= final_gain as f32;
                            pixel[1] *= final_gain as f32;
                            pixel[2] *= final_gain as f32;
                        }
                    }
                }
                current_vec += step_vec_x;
            }
        });

    let out_img = Rgb32FImage::from_vec(width, height, out_buffer).unwrap();
    DynamicImage::ImageRgb32F(out_img)
}

/// Samples arbitrary geometry-output coordinates directly into a bounded output image.
/// This is the preview path counterpart to [`warp_image_geometry`]: callers map each preview
/// pixel back into the full geometry canvas, while this function applies the authoritative
/// perspective/lens/TCA/vignette mapping and samples the decoded source without allocating a
/// full-size warped intermediate.
pub const PREVIEW_GEOMETRY_BAND_ROWS: u32 = 32;
pub type SourceSampleDecorator<'a> = dyn Fn(f32, f32, &mut [f32]) + Sync + 'a;

pub fn warp_image_geometry_mapped<F>(
    image: &DynamicImage,
    params: GeometryParams,
    output_width: u32,
    output_height: u32,
    output_to_geometry: F,
    source_decorator: Option<&SourceSampleDecorator<'_>>,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<DynamicImage, String>
where
    F: Fn(f32, f32) -> (f32, f32) + Send + Sync,
{
    warp_image_geometry_mapped_with_band_rows(
        image,
        params,
        (output_width, output_height),
        output_to_geometry,
        source_decorator,
        cancellation,
        PREVIEW_GEOMETRY_BAND_ROWS,
    )
}

fn warp_image_geometry_mapped_with_band_rows<F>(
    image: &DynamicImage,
    params: GeometryParams,
    output_size: (u32, u32),
    output_to_geometry: F,
    source_decorator: Option<&SourceSampleDecorator<'_>>,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
    band_rows: u32,
) -> Result<DynamicImage, String>
where
    F: Fn(f32, f32) -> (f32, f32) + Send + Sync,
{
    let (output_width, output_height) = output_size;
    let converted;
    let src_img = if let DynamicImage::ImageRgb32F(source) = image {
        source
    } else {
        converted = image.to_rgb32f();
        &converted
    };
    let (width, height) = src_img.dimensions();
    let mut out_buffer = vec![0.0f32; (output_width * output_height * 3) as usize];
    let (forward_transform, cx, cy, half_diagonal) =
        build_transform_matrices(&params, width as f32, height as f32);
    let inv = forward_transform
        .try_inverse()
        .unwrap_or(NaMatrix3::identity());
    let max_radius_sq_inv = 1.0 / ((cx * cx + cy * cy) as f64);
    let hd = half_diagonal;
    let k_distortion = (params.distortion as f64 / 100.0) * 2.5;
    let lk1 = params.lens_dist_k1 as f64;
    let lk2 = params.lens_dist_k2 as f64;
    let lk3 = params.lens_dist_k3 as f64;
    let lens_dist_amt = (params.lens_distortion_amount as f64) * 2.5;
    let has_lens_correction = params.lens_distortion_enabled
        && (lk1.abs() > 1e-6 || lk2.abs() > 1e-6 || lk3.abs() > 1e-6);
    let is_ptlens = params.lens_model == 1;
    let auto_crop_scale = if has_lens_correction || k_distortion.abs() > 1e-5 {
        compute_lens_auto_crop_scale(&params, width as f32, height as f32) as f32
    } else {
        1.0
    };
    let vr = if (params.tca_vr - 1.0).abs() > 1e-5 {
        params.tca_vr + (1.0 - params.tca_vr) * (1.0 - params.lens_tca_amount)
    } else {
        1.0
    };
    let vb = if (params.tca_vb - 1.0).abs() > 1e-5 {
        params.tca_vb + (1.0 - params.tca_vb) * (1.0 - params.lens_tca_amount)
    } else {
        1.0
    };
    let has_tca = params.lens_tca_enabled && ((vr - 1.0).abs() > 1e-5 || (vb - 1.0).abs() > 1e-5);
    let vk1 = params.vig_k1 as f64;
    let vk2 = params.vig_k2 as f64;
    let vk3 = params.vig_k3 as f64;
    let lens_vig_amt = (params.lens_vignette_amount as f64) * 0.8;
    let has_vignetting = params.lens_vignette_enabled
        && (vk1.abs() > 1e-6 || vk2.abs() > 1e-6 || vk3.abs() > 1e-6)
        && lens_vig_amt > 0.01;
    let src_raw = src_img.as_raw();
    let width_usize = width as usize;
    let height_usize = height as usize;
    let tca_ctx = TcaContext {
        src_raw,
        src_width: width_usize,
        src_height: height_usize,
        cx,
        cy,
    };

    let band_rows = band_rows.max(1) as usize;
    let row_stride = output_width as usize * 3;
    for (band_index, band) in out_buffer.chunks_mut(row_stride * band_rows).enumerate() {
        if let Some(check) = cancellation {
            check()?;
        }
        let first_y = band_index * band_rows;
        band.par_chunks_exact_mut(row_stride)
            .enumerate()
            .for_each(|(local_y, row)| {
                let y = first_y + local_y;
                for (x, pixel) in row.chunks_exact_mut(3).enumerate() {
                    let (geometry_x, geometry_y) = output_to_geometry(x as f32, y as f32);
                    let current_vec = inv * NaVector3::new(geometry_x, geometry_y, 1.0);
                    if current_vec.z.abs() <= 1e-6 {
                        continue;
                    }
                    let inv_z = 1.0 / current_vec.z;
                    let mut src_x = current_vec.x * inv_z;
                    let mut src_y = current_vec.y * inv_z;
                    if auto_crop_scale > 1.0 {
                        src_x = cx + (src_x - cx) / auto_crop_scale;
                        src_y = cy + (src_y - cy) / auto_crop_scale;
                    }
                    if has_lens_correction {
                        let dx = (src_x - cx) as f64;
                        let dy = (src_y - cy) as f64;
                        let ru = (dx * dx + dy * dy).sqrt();
                        if ru > 1e-6 {
                            let ru_norm = ru / hd;
                            let ru_norm2 = ru_norm * ru_norm;
                            let rd_norm = if is_ptlens {
                                let d = 1.0 - lk1 - lk2 - lk3;
                                ru_norm
                                    * (lk1 * ru_norm2 * ru_norm
                                        + lk2 * ru_norm2
                                        + lk3 * ru_norm
                                        + d)
                            } else {
                                ru_norm
                                    * (1.0
                                        + lk1 * ru_norm2
                                        + lk2 * ru_norm2.powi(2)
                                        + lk3 * ru_norm2.powi(3))
                            };
                            let effective_r_norm = ru_norm + (rd_norm - ru_norm) * lens_dist_amt;
                            let scale = effective_r_norm / ru_norm;
                            src_x = cx + (dx * scale) as f32;
                            src_y = cy + (dy * scale) as f32;
                        }
                    }
                    if k_distortion.abs() > 1e-5 {
                        let dx = (src_x - cx) as f64;
                        let dy = (src_y - cy) as f64;
                        let r2_norm = (dx * dx + dy * dy) * max_radius_sq_inv;
                        let factor = 1.0 + k_distortion * r2_norm;
                        src_x = cx + (dx * factor) as f32;
                        src_y = cy + (dy * factor) as f32;
                    }
                    if has_tca {
                        interpolate_pixel_with_tca(&tca_ctx, src_x, src_y, vr, vb, pixel);
                    } else {
                        interpolate_pixel(src_raw, width_usize, height_usize, src_x, src_y, pixel);
                    }
                    if let Some(decorate) = source_decorator {
                        decorate(src_x, src_y, pixel);
                    }
                    if has_vignetting {
                        let dx = (src_x - cx) as f64;
                        let dy = (src_y - cy) as f64;
                        let ru_norm = (dx * dx + dy * dy).sqrt() / hd;
                        let ru_norm2 = ru_norm * ru_norm;
                        let v_factor =
                            1.0 + vk1 * ru_norm2 + vk2 * ru_norm2.powi(2) + vk3 * ru_norm2.powi(3);
                        if v_factor > 1e-6 {
                            let correction_gain = 1.0 / v_factor;
                            let final_gain = 1.0 + (correction_gain - 1.0) * lens_vig_amt;
                            pixel[0] *= final_gain as f32;
                            pixel[1] *= final_gain as f32;
                            pixel[2] *= final_gain as f32;
                        }
                    }
                }
            });
    }

    Ok(DynamicImage::ImageRgb32F(
        Rgb32FImage::from_vec(output_width, output_height, out_buffer).unwrap(),
    ))
}

pub fn unwarp_image_geometry(warped_image: &DynamicImage, params: GeometryParams) -> DynamicImage {
    let src_img = warped_image.to_rgb32f();
    let (width, height) = src_img.dimensions();
    let mut out_buffer = vec![0.0f32; (width * height * 3) as usize];

    let (forward_transform, cx, cy, half_diagonal) =
        build_transform_matrices(&params, width as f32, height as f32);
    let max_radius_sq_inv = 1.0 / ((cx * cx + cy * cy) as f64);
    let hd = half_diagonal;

    let k_distortion = (params.distortion as f64 / 100.0) * 2.5;
    let lk1 = params.lens_dist_k1 as f64;
    let lk2 = params.lens_dist_k2 as f64;
    let lk3 = params.lens_dist_k3 as f64;
    let lens_dist_amt = (params.lens_distortion_amount as f64) * 2.5;

    let has_lens_correction = params.lens_distortion_enabled
        && (lk1.abs() > 1e-6 || lk2.abs() > 1e-6 || lk3.abs() > 1e-6);
    let is_ptlens = params.lens_model == 1;

    let auto_crop_scale = if has_lens_correction || k_distortion.abs() > 1e-5 {
        compute_lens_auto_crop_scale(&params, width as f32, height as f32) as f32
    } else {
        1.0
    };

    let src_raw = src_img.as_raw();
    let width_usize = width as usize;
    let height_usize = height as usize;

    out_buffer
        .par_chunks_exact_mut(width_usize * 3)
        .enumerate()
        .for_each(|(y, row_pixel_data)| {
            let y_f = y as f32;

            for (x, pixel) in row_pixel_data.chunks_exact_mut(3).enumerate() {
                let x_f = x as f32;
                let mut current_x = x_f;
                let mut current_y = y_f;

                if k_distortion.abs() > 1e-5 {
                    let dx = (current_x - cx) as f64;
                    let dy = (current_y - cy) as f64;
                    let r_distorted = (dx * dx + dy * dy).sqrt();

                    if r_distorted > 1e-6 {
                        let k_effective = k_distortion * max_radius_sq_inv;
                        let r_straight = solve_generic_distortion_inv(r_distorted, k_effective);

                        let scale = r_straight / r_distorted;
                        current_x = cx + (dx * scale) as f32;
                        current_y = cy + (dy * scale) as f32;
                    }
                }

                if has_lens_correction {
                    let dx = (current_x - cx) as f64;
                    let dy = (current_y - cy) as f64;
                    let rd = (dx * dx + dy * dy).sqrt();

                    if rd > 1e-6 {
                        let mut ru = rd;

                        for _ in 0..8 {
                            let ru_norm = ru / hd;
                            let ru_norm2 = ru_norm * ru_norm;

                            let (f_val, f_prime) = if is_ptlens {
                                let a = lk1;
                                let b = lk2;
                                let c = lk3;
                                let d = 1.0 - a - b - c;
                                let poly = a * ru_norm2 * ru_norm + b * ru_norm2 + c * ru_norm + d;

                                let val = ru * poly;
                                let prime = 4.0 * a * ru_norm2 * ru_norm
                                    + 3.0 * b * ru_norm2
                                    + 2.0 * c * ru_norm
                                    + d;
                                (val, prime)
                            } else {
                                let poly = 1.0
                                    + lk1 * ru_norm2
                                    + lk2 * (ru_norm2 * ru_norm2)
                                    + lk3 * (ru_norm2 * ru_norm2 * ru_norm2);
                                let val = ru * poly;
                                let poly_prime = 2.0 * lk1 * ru_norm
                                    + 4.0 * lk2 * ru_norm2 * ru_norm
                                    + 6.0 * lk3 * (ru_norm2 * ru_norm2) * ru_norm;
                                let prime = poly + ru_norm * poly_prime;
                                (val, prime)
                            };

                            let g_val = ru + (f_val - ru) * lens_dist_amt - rd;
                            let g_prime = 1.0 + (f_prime - 1.0) * lens_dist_amt;

                            if g_prime.abs() < 1e-7 {
                                break;
                            }
                            let delta = g_val / g_prime;
                            ru -= delta;
                            if delta.abs() < 1e-4 {
                                break;
                            }
                        }

                        let scale = ru / rd;
                        current_x = cx + (dx * scale) as f32;
                        current_y = cy + (dy * scale) as f32;
                    }
                }

                if auto_crop_scale > 1.0 {
                    current_x = cx + (current_x - cx) * auto_crop_scale;
                    current_y = cy + (current_y - cy) * auto_crop_scale;
                }

                let target_vec = forward_transform * NaVector3::new(current_x, current_y, 1.0);

                if target_vec.z.abs() > 1e-6 {
                    let inv_z = 1.0 / target_vec.z;

                    let src_x = target_vec.x * inv_z;
                    let src_y = target_vec.y * inv_z;

                    interpolate_pixel(src_raw, width_usize, height_usize, src_x, src_y, pixel);
                }
            }
        });

    let out_img = Rgb32FImage::from_vec(width, height, out_buffer).unwrap();
    DynamicImage::ImageRgb32F(out_img)
}
pub fn apply_geometry_warp<'a>(
    image: impl IntoCowImage<'a>,
    adjustments: &serde_json::Value,
) -> Cow<'a, DynamicImage> {
    let image = image.into_cow();
    let params = get_geometry_params_from_json(adjustments);
    if !is_geometry_identity(&params) {
        Cow::Owned(warp_image_geometry(image.as_ref(), params))
    } else {
        image
    }
}

pub fn apply_unwarp_geometry<'a>(
    image: impl IntoCowImage<'a>,
    adjustments: &serde_json::Value,
) -> Cow<'a, DynamicImage> {
    let image = image.into_cow();
    let params = get_geometry_params_from_json(adjustments);
    if !is_geometry_identity(&params) {
        Cow::Owned(unwarp_image_geometry(image.as_ref(), params))
    } else {
        image
    }
}

pub fn apply_coarse_rotation<'a>(
    image: impl IntoCowImage<'a>,
    orientation_steps: u8,
) -> Cow<'a, DynamicImage> {
    let image = image.into_cow();
    match orientation_steps {
        1 => Cow::Owned(image.rotate90()),
        2 => Cow::Owned(image.rotate180()),
        3 => Cow::Owned(image.rotate270()),
        _ => image,
    }
}

pub fn apply_rotation<'a>(
    image: impl IntoCowImage<'a>,
    rotation_degrees: f32,
) -> Cow<'a, DynamicImage> {
    let image = image.into_cow();
    if rotation_degrees % 360.0 == 0.0 {
        return image;
    }

    let rgba_image = image.to_rgba32f();
    let rotated = rotate_about_center(
        &rgba_image,
        rotation_degrees * PI / 180.0,
        Interpolation::Bilinear,
        Border::Constant(Rgba([0.0f32, 0.0, 0.0, 0.0])),
    );

    Cow::Owned(DynamicImage::ImageRgba32F(rotated))
}

pub fn apply_crop<'a>(image: impl IntoCowImage<'a>, crop_value: &Value) -> Cow<'a, DynamicImage> {
    let image = image.into_cow();
    if crop_value.is_null() {
        return image;
    }

    if let Ok(crop) = serde_json::from_value::<Crop>(crop_value.clone()) {
        let x = crop.x.round() as u32;
        let y = crop.y.round() as u32;
        let width = crop.width.round() as u32;
        let height = crop.height.round() as u32;

        if width > 0 && height > 0 {
            let (img_w, img_h) = image.dimensions();
            if x < img_w && y < img_h {
                let new_width = (img_w - x).min(width);
                let new_height = (img_h - y).min(height);

                if new_width > 0 && new_height > 0 {
                    if x == 0 && y == 0 && new_width == img_w && new_height == img_h {
                        return image;
                    }
                    return Cow::Owned(image.crop_imm(x, y, new_width, new_height));
                }
            }
        }
    }
    image
}

pub fn apply_flip<'a>(
    image: impl IntoCowImage<'a>,
    horizontal: bool,
    vertical: bool,
) -> Cow<'a, DynamicImage> {
    let image = image.into_cow();
    if !horizontal && !vertical {
        return image;
    }

    let mut img = image.into_owned();
    if horizontal {
        img = img.fliph();
    }
    if vertical {
        img = img.flipv();
    }
    Cow::Owned(img)
}

pub fn is_geometry_identity(params: &GeometryParams) -> bool {
    let dist_identity = !params.lens_distortion_enabled
        || ((params.lens_distortion_amount - 1.0).abs() < 1e-4
            && params.lens_dist_k1.abs() < 1e-6
            && params.lens_dist_k2.abs() < 1e-6
            && params.lens_dist_k3.abs() < 1e-6);

    let tca_identity = !params.lens_tca_enabled
        || ((params.lens_tca_amount - 1.0).abs() < 1e-4
            && (params.tca_vr - 1.0).abs() < 1e-6
            && (params.tca_vb - 1.0).abs() < 1e-6);

    let vig_identity = !params.lens_vignette_enabled
        || ((params.lens_vignette_amount - 1.0).abs() < 1e-4
            && params.vig_k1.abs() < 1e-6
            && params.vig_k2.abs() < 1e-6
            && params.vig_k3.abs() < 1e-6);

    params.distortion == 0.0
        && params.vertical == 0.0
        && params.horizontal == 0.0
        && params.perspective_source_to_corrected == [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        && params.rotate == 0.0
        && params.aspect == 0.0
        && params.scale == 100.0
        && params.x_offset == 0.0
        && params.y_offset == 0.0
        && dist_identity
        && tca_identity
        && vig_identity
}

#[cfg(test)]
mod preview_geometry_tests {
    use super::*;

    #[test]
    fn mapped_geometry_is_bitwise_independent_of_band_partition() {
        let source = DynamicImage::ImageRgb32F(Rgb32FImage::from_fn(64, 48, |x, y| {
            image::Rgb([x as f32 / 63.0, y as f32 / 47.0, 0.4])
        }));
        let params = GeometryParams {
            distortion: 4.0,
            vertical: 9.0,
            horizontal: -5.0,
            rotate: 1.5,
            ..GeometryParams::default()
        };
        let render = |band_rows| {
            warp_image_geometry_mapped_with_band_rows(
                &source,
                params,
                (29, 17),
                |x, y| (x * 1.5 + 7.0, y * 1.5 + 5.0),
                None,
                None,
                band_rows,
            )
            .unwrap()
            .to_rgb32f()
        };

        let one_row = render(1);
        let seven_rows = render(7);
        let production = render(PREVIEW_GEOMETRY_BAND_ROWS);
        assert_eq!(one_row.as_raw(), seven_rows.as_raw());
        assert_eq!(one_row.as_raw(), production.as_raw());
    }
}
