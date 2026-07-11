use crate::ai::ai_processing::{
    AiDepthMaskParameters, AiForegroundMaskParameters, AiSkyMaskParameters, AiSubjectMaskParameters,
};
use base64::{Engine as _, engine::general_purpose};
use image::{DynamicImage, GenericImageView, GrayImage, ImageFormat, Luma, Rgba, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::f32::consts::PI;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::sync::Arc; // Required for parallel rasterization

use crate::app_state::AppState;
use crate::formats::png_data_url;
use crate::get_cached_full_warped_image;

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub enum SubMaskMode {
    Additive,
    Subtractive,
    Intersect,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct SubMask {
    pub id: String,
    #[serde(rename = "type")]
    pub mask_type: String,
    pub visible: bool,
    #[serde(default)]
    pub invert: bool,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    pub mode: SubMaskMode,
    pub parameters: Value,
}

fn default_opacity() -> f32 {
    100.0
}

fn default_blend_mode() -> String {
    "normal".to_string()
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct MaskDefinition {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub invert: bool,
    #[serde(default = "default_blend_mode")]
    pub blend_mode: String,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    pub adjustments: Value,
    pub sub_masks: Vec<SubMask>,
}

fn default_refinement_density() -> f32 {
    1.0
}

fn default_refinement_zero() -> f32 {
    0.0
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Copy)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct MaskRefinementParameters {
    #[serde(default = "default_refinement_density")]
    pub density: f32,
    #[serde(default = "default_refinement_zero")]
    pub edge_contrast: f32,
    #[serde(default = "default_refinement_zero")]
    pub edge_shift_px: f32,
    #[serde(default = "default_refinement_zero")]
    pub feather_px: f32,
    #[serde(default = "default_refinement_zero")]
    pub hair_detail: f32,
    #[serde(default = "default_refinement_zero")]
    pub smoothness: f32,
}

impl Default for MaskRefinementParameters {
    fn default() -> Self {
        Self {
            density: default_refinement_density(),
            edge_contrast: default_refinement_zero(),
            edge_shift_px: default_refinement_zero(),
            feather_px: default_refinement_zero(),
            hair_detail: default_refinement_zero(),
            smoothness: default_refinement_zero(),
        }
    }
}

fn has_refinement_parameters(params_value: &Value) -> bool {
    params_value.as_object().is_some_and(|params| {
        [
            "density",
            "edgeContrast",
            "edgeShiftPx",
            "featherPx",
            "hairDetail",
            "smoothness",
        ]
        .iter()
        .any(|key| params.contains_key(*key))
    })
}

fn smoothstep(value: f32) -> f32 {
    let t = value.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn apply_mask_refinement(
    mask: &mut GrayImage,
    params_value: &Value,
    scale: f32,
    warped_image: Option<&DynamicImage>,
) {
    if !has_refinement_parameters(params_value) {
        return;
    }

    let params: MaskRefinementParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let density = params.density.clamp(0.0, 1.0);
    let edge_contrast = params.edge_contrast.clamp(0.0, 1.0);
    let hair_detail = params.hair_detail.clamp(0.0, 1.0);
    let smoothness = params.smoothness.clamp(0.0, 1.0);
    let edge_shift_px = params.edge_shift_px.clamp(-512.0, 512.0) * scale.max(0.0);
    let feather_px = params.feather_px.clamp(0.0, 4096.0) * scale.max(0.0);

    let shift_amount = edge_shift_px.abs().round() as u8;
    if shift_amount > 0 {
        if edge_shift_px > 0.0 {
            *mask = grayscale_dilate(mask, shift_amount);
        } else {
            *mask = grayscale_erode(mask, shift_amount);
        }
    }

    if feather_px > 0.01 {
        *mask = imageproc::filter::gaussian_blur_f32(mask, feather_px.max(0.01));
    }

    for pixel in mask.pixels_mut() {
        let base = pixel[0] as f32 / 255.0;
        let smoothed = if smoothness == 0.0 {
            base
        } else {
            base * (1.0 - smoothness) + smoothstep(base) * smoothness
        };
        let contrasted = if edge_contrast == 0.0 {
            smoothed
        } else {
            ((smoothed - 0.5) * (1.0 + edge_contrast * 3.0) + 0.5).clamp(0.0, 1.0)
        };
        pixel[0] = (contrasted * density * 255.0).clamp(0.0, 255.0).round() as u8;
    }

    if let Some(image) = warped_image {
        apply_local_edge_guided_refinement(mask, image, (edge_contrast + smoothness) * 0.5);
        apply_hair_aware_edge_refinement(mask, image, hair_detail);
    }
}

fn apply_local_edge_guided_refinement(mask: &mut GrayImage, image: &DynamicImage, strength: f32) {
    let strength = strength.clamp(0.0, 1.0);
    if strength <= 0.001 || mask.width() == 0 || mask.height() == 0 {
        return;
    }

    let source = mask.clone();
    let image_width = image.width().max(1);
    let image_height = image.height().max(1);
    let x_scale = image_width as f32 / mask.width().max(1) as f32;
    let y_scale = image_height as f32 / mask.height().max(1) as f32;

    for y in 0..mask.height() {
        for x in 0..mask.width() {
            let alpha = source.get_pixel(x, y)[0] as f32 / 255.0;
            if !(0.02..=0.98).contains(&alpha) {
                continue;
            }

            let image_x = ((x as f32 + 0.5) * x_scale)
                .floor()
                .clamp(0.0, (image_width - 1) as f32) as u32;
            let image_y = ((y as f32 + 0.5) * y_scale)
                .floor()
                .clamp(0.0, (image_height - 1) as f32) as u32;
            let gradient = local_luma_gradient(image, image_x, image_y);
            let edge_weight = smoothstep((gradient - 0.08) / 0.22) * strength;
            if edge_weight <= 0.001 {
                continue;
            }

            let tightened = if alpha >= 0.5 {
                alpha + (1.0 - alpha) * edge_weight
            } else {
                alpha * (1.0 - edge_weight)
            };
            mask.put_pixel(
                x,
                y,
                Luma([(tightened * 255.0).clamp(0.0, 255.0).round() as u8]),
            );
        }
    }
}

fn apply_hair_aware_edge_refinement(mask: &mut GrayImage, image: &DynamicImage, strength: f32) {
    let strength = strength.clamp(0.0, 1.0);
    if strength <= 0.001 || mask.width() == 0 || mask.height() == 0 {
        return;
    }

    let source = mask.clone();
    let image_width = image.width().max(1);
    let image_height = image.height().max(1);
    let x_scale = image_width as f32 / mask.width().max(1) as f32;
    let y_scale = image_height as f32 / mask.height().max(1) as f32;

    for y in 0..mask.height() {
        for x in 0..mask.width() {
            let alpha = source.get_pixel(x, y)[0] as f32 / 255.0;
            if !(0.01..=0.99).contains(&alpha) {
                continue;
            }

            let image_x = ((x as f32 + 0.5) * x_scale)
                .floor()
                .clamp(0.0, (image_width - 1) as f32) as u32;
            let image_y = ((y as f32 + 0.5) * y_scale)
                .floor()
                .clamp(0.0, (image_height - 1) as f32) as u32;
            let edge = local_rgb_edge_gradient(image, image_x, image_y);
            let texture = local_luma_texture(image, image_x, image_y);
            let detail_weight = smoothstep(edge.max(texture) / 0.08) * strength;
            if detail_weight <= 0.001 {
                continue;
            }

            let tightened = if alpha >= 0.5 {
                alpha + (1.0 - alpha) * detail_weight
            } else {
                alpha * (1.0 - detail_weight)
            };
            mask.put_pixel(
                x,
                y,
                Luma([(tightened * 255.0).clamp(0.0, 255.0).round() as u8]),
            );
        }
    }
}

fn local_luma_gradient(image: &DynamicImage, x: u32, y: u32) -> f32 {
    let left = x.saturating_sub(1);
    let right = (x + 1).min(image.width().saturating_sub(1));
    let top = y.saturating_sub(1);
    let bottom = (y + 1).min(image.height().saturating_sub(1));
    let dx = (pixel_luma(image, right, y) - pixel_luma(image, left, y)).abs();
    let dy = (pixel_luma(image, x, bottom) - pixel_luma(image, x, top)).abs();
    dx.max(dy) / 255.0
}

fn local_rgb_edge_gradient(image: &DynamicImage, x: u32, y: u32) -> f32 {
    let left = x.saturating_sub(1);
    let right = (x + 1).min(image.width().saturating_sub(1));
    let top = y.saturating_sub(1);
    let bottom = (y + 1).min(image.height().saturating_sub(1));
    let horizontal = rgb_distance(image, left, y, right, y);
    let vertical = rgb_distance(image, x, top, x, bottom);
    horizontal.max(vertical)
}

fn local_luma_texture(image: &DynamicImage, x: u32, y: u32) -> f32 {
    let center = pixel_luma(image, x, y);
    let left = pixel_luma(image, x.saturating_sub(1), y);
    let right = pixel_luma(image, (x + 1).min(image.width().saturating_sub(1)), y);
    let top = pixel_luma(image, x, y.saturating_sub(1));
    let bottom = pixel_luma(image, x, (y + 1).min(image.height().saturating_sub(1)));
    ((center * 4.0 - left - right - top - bottom).abs() / 255.0).clamp(0.0, 1.0)
}

fn rgb_distance(image: &DynamicImage, x1: u32, y1: u32, x2: u32, y2: u32) -> f32 {
    let left = image.get_pixel(x1, y1);
    let right = image.get_pixel(x2, y2);
    let r = (left[0] as f32 - right[0] as f32) / 255.0;
    let g = (left[1] as f32 - right[1] as f32) / 255.0;
    let b = (left[2] as f32 - right[2] as f32) / 255.0;
    ((r * r + g * g + b * b) / 3.0).sqrt()
}

fn pixel_luma(image: &DynamicImage, x: u32, y: u32) -> f32 {
    let pixel = image.get_pixel(x, y);
    0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub enum MaskOverlayMode {
    Hidden,
    Rubylith,
    Green,
    Blue,
    White,
    Black,
    Grayscale,
    Inverse,
    Edges,
}

fn default_overlay_mode() -> MaskOverlayMode {
    MaskOverlayMode::Rubylith
}

fn default_overlay_opacity() -> f32 {
    0.5
}

fn default_overlay_edge_threshold() -> f32 {
    0.5
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Copy)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct MaskOverlaySettings {
    #[serde(default = "default_overlay_edge_threshold")]
    pub edge_threshold: f32,
    #[serde(default = "default_overlay_mode")]
    pub mode: MaskOverlayMode,
    #[serde(default = "default_overlay_opacity")]
    pub opacity: f32,
}

impl Default for MaskOverlaySettings {
    fn default() -> Self {
        Self {
            edge_threshold: default_overlay_edge_threshold(),
            mode: default_overlay_mode(),
            opacity: default_overlay_opacity(),
        }
    }
}

fn mask_overlay_pixel(intensity: u8, settings: MaskOverlaySettings) -> Rgba<u8> {
    let weight = (intensity as f32 / 255.0).clamp(0.0, 1.0);
    let opacity = settings.opacity.clamp(0.0, 1.0);
    let alpha_from_weight = (255.0 * opacity * weight) as u8;

    match settings.mode {
        MaskOverlayMode::Hidden => Rgba([0, 0, 0, 0]),
        MaskOverlayMode::Rubylith => Rgba([255, 24, 48, alpha_from_weight]),
        MaskOverlayMode::Green => Rgba([32, 224, 72, alpha_from_weight]),
        MaskOverlayMode::Blue => Rgba([32, 112, 255, alpha_from_weight]),
        MaskOverlayMode::White => Rgba([255, 255, 255, alpha_from_weight]),
        MaskOverlayMode::Black => Rgba([0, 0, 0, alpha_from_weight]),
        MaskOverlayMode::Grayscale => {
            let channel = (255.0 * weight).round() as u8;
            Rgba([channel, channel, channel, (255.0 * opacity) as u8])
        }
        MaskOverlayMode::Inverse => {
            let channel = (255.0 * (1.0 - weight)).round() as u8;
            Rgba([channel, channel, channel, (255.0 * opacity) as u8])
        }
        MaskOverlayMode::Edges => {
            let edge_threshold = settings.edge_threshold.clamp(0.0, 1.0);
            let edge_alpha = if (weight - edge_threshold).abs() <= 0.05 {
                (255.0 * opacity) as u8
            } else {
                0
            };
            Rgba([255, 255, 255, edge_alpha])
        }
    }
}

impl MaskDefinition {
    pub fn requires_warped_image(&self) -> bool {
        self.sub_masks.iter().any(|sm| {
            sm.mask_type == "color"
                || sm.mask_type == "luminance"
                || sm.mask_type == "color_range"
                || sm.mask_type == "luminance_range"
                || has_refinement_parameters(&sm.parameters)
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct PatchData {
    pub color: String,
    pub mask: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct AiPatchDefinition {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub invert: bool,
    pub prompt: String,
    #[serde(default)]
    pub patch_data: Option<PatchData>,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    pub sub_masks: Vec<SubMask>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct GrowFeatherParameters {
    #[serde(default)]
    grow: f32,
    #[serde(default)]
    feather: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RadialMaskParameters {
    center_x: f64,
    center_y: f64,
    radius_x: f64,
    radius_y: f64,
    rotation: f32,
    feather: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct LinearMaskParameters {
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    #[serde(default = "default_range")]
    range: f32,
}

fn default_range() -> f32 {
    50.0
}

impl Default for LinearMaskParameters {
    fn default() -> Self {
        Self {
            start_x: 0.0,
            start_y: 0.0,
            end_x: 0.0,
            end_y: 0.0,
            range: default_range(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct BrushLine {
    tool: String,
    brush_size: f32,
    points: Vec<Point>,
    #[serde(default = "default_brush_feather")]
    feather: f32,
}

fn default_brush_feather() -> f32 {
    0.5
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BrushMaskParameters {
    #[serde(default)]
    lines: Vec<BrushLine>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeBrushParameters {
    strokes: Vec<NativeBrushStroke>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeBrushStroke {
    flow: f32,
    hardness: f32,
    id: String,
    points: Vec<NativeBrushPoint>,
    radius: f32,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeBrushPoint {
    #[serde(default)]
    pressure: Option<f32>,
    x: f32,
    y: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct FlowLine {
    tool: String,
    brush_size: f32,
    points: Vec<Point>,
    #[serde(default = "default_brush_feather")]
    feather: f32,
    #[serde(default = "default_line_flow")]
    flow: f32,
}

fn default_line_flow() -> f32 {
    10.0
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FlowMaskParameters {
    #[serde(default)]
    lines: Vec<FlowLine>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct ParametricMaskParameters {
    target_x: f64,
    target_y: f64,
    #[serde(default = "default_tolerance")]
    tolerance: f32,
    #[serde(default)]
    grow: f32,
    #[serde(default)]
    feather: f32,
    #[serde(default)]
    rotation: f32,
    #[serde(default)]
    flip_horizontal: bool,
    #[serde(default)]
    flip_vertical: bool,
    #[serde(default)]
    orientation_steps: u8,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct LuminanceRangeMaskParameters {
    min_luma: f32,
    max_luma: f32,
    feather: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct ColorRangeMaskParameters {
    center_hue_degrees: f32,
    hue_tolerance_degrees: f32,
    feather: f32,
    min_luma: f32,
    max_luma: f32,
    min_saturation: f32,
    max_saturation: f32,
}

fn default_tolerance() -> f32 {
    20.0
}

impl Default for ParametricMaskParameters {
    fn default() -> Self {
        Self {
            target_x: 0.0,
            target_y: 0.0,
            tolerance: default_tolerance(),
            grow: 0.0,
            feather: 35.0,
            rotation: 0.0,
            flip_horizontal: false,
            flip_vertical: false,
            orientation_steps: 0,
        }
    }
}

#[derive(Clone, Copy)]
enum GrayscaleMorphology {
    Dilate,
    Erode,
}

impl GrayscaleMorphology {
    fn seed(self) -> u8 {
        match self {
            Self::Dilate => 0,
            Self::Erode => 255,
        }
    }

    fn fold(self, left: u8, right: u8) -> u8 {
        match self {
            Self::Dilate => left.max(right),
            Self::Erode => left.min(right),
        }
    }
}

fn morphology_bounds(index: usize, radius: usize, limit: usize) -> (usize, usize) {
    (
        index.saturating_sub(radius),
        index.saturating_add(radius).min(limit.saturating_sub(1)),
    )
}

fn grayscale_morphology(image: &GrayImage, k: u8, operation: GrayscaleMorphology) -> GrayImage {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return image.clone();
    }
    let w = width as usize;
    let h = height as usize;
    let Some(pixel_count) = w.checked_mul(h) else {
        return image.clone();
    };
    let r = k as usize;
    let src = image.as_raw();

    let mut temp = vec![0u8; pixel_count];
    let mut out = vec![0u8; pixel_count];

    for y in 0..h {
        let row_offset = y * w;
        for x in 0..w {
            let mut value = operation.seed();
            let (start, end) = morphology_bounds(x, r, w);
            for xi in start..=end {
                value = operation.fold(value, src[row_offset + xi]);
            }
            temp[row_offset + x] = value;
        }
    }

    for x in 0..w {
        for y in 0..h {
            let mut value = operation.seed();
            let (start, end) = morphology_bounds(y, r, h);
            for yi in start..=end {
                value = operation.fold(value, temp[yi * w + x]);
            }
            out[y * w + x] = value;
        }
    }

    GrayImage::from_raw(width, height, out).unwrap_or_else(|| image.clone())
}

fn grayscale_dilate(image: &GrayImage, k: u8) -> GrayImage {
    grayscale_morphology(image, k, GrayscaleMorphology::Dilate)
}

fn grayscale_erode(image: &GrayImage, k: u8) -> GrayImage {
    grayscale_morphology(image, k, GrayscaleMorphology::Erode)
}

fn apply_grow_and_feather(mask: &mut GrayImage, grow: f32, feather: f32, width: u32, height: u32) {
    let base_dimension = width.min(height) as f32;

    if grow.abs() > 0.01 {
        const MAX_GROW_PERCENTAGE: f32 = 0.01;
        let grow_pixels = (grow / 100.0) * base_dimension * MAX_GROW_PERCENTAGE;

        let amount = grow_pixels.abs().round() as u8;

        if amount > 0 {
            if grow_pixels > 0.0 {
                *mask = grayscale_dilate(mask, amount);
            } else {
                *mask = grayscale_erode(mask, amount);
            }
        }
    }

    if feather > 0.0 {
        const MAX_FEATHER_SIGMA_PERCENTAGE: f32 = 0.005;
        let sigma = (feather / 100.0) * base_dimension * MAX_FEATHER_SIGMA_PERCENTAGE;

        if sigma > 0.01 {
            *mask = imageproc::filter::gaussian_blur_f32(mask, sigma);
        }
    }
}

fn stroke_bounds(
    points: &[Point],
    width: u32,
    height: u32,
    radius: f32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<(u32, u32, u32, u32)> {
    if width == 0 || height == 0 || points.is_empty() {
        return None;
    }

    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    let r_pad = radius.ceil() + 2.0;

    for p in points {
        let px = p.x as f32 * scale - crop_offset.0;
        let py = p.y as f32 * scale - crop_offset.1;

        min_x = min_x.min(px - r_pad);
        min_y = min_y.min(py - r_pad);
        max_x = max_x.max(px + r_pad);
        max_y = max_y.max(py + r_pad);
    }

    if max_x < 0.0 || max_y < 0.0 || min_x > (width - 1) as f32 || min_y > (height - 1) as f32 {
        return None;
    }

    let min_x = min_x.floor().max(0.0).min((width - 1) as f32) as u32;
    let min_y = min_y.floor().max(0.0).min((height - 1) as f32) as u32;
    let max_x = max_x.ceil().max(0.0).min((width - 1) as f32) as u32;
    let max_y = max_y.ceil().max(0.0).min((height - 1) as f32) as u32;

    if min_x > max_x || min_y > max_y {
        None
    } else {
        Some((min_x, min_y, max_x, max_y))
    }
}

#[allow(clippy::too_many_arguments)]
fn render_stroke_layer_parallel(
    points: &[Point],
    radius: f32,
    feather: f32,
    scale: f32,
    crop_offset: (f32, f32),
    layer_offset: (f32, f32),
    bb_w: u32,
    bb_h: u32,
) -> GrayImage {
    let mut out_pixels = vec![0u8; (bb_w * bb_h) as usize];
    if points.is_empty() || radius <= 0.0 {
        return GrayImage::from_raw(bb_w, bb_h, out_pixels).unwrap();
    }

    struct Segment {
        x1: f32,
        y1: f32,
        dx: f32,
        dy: f32,
        len_sq: f32,
        bounds_left: i32,
        bounds_right: i32,
        bounds_top: i32,
        bounds_bottom: i32,
    }

    let mut segments = Vec::with_capacity(points.len().saturating_sub(1));
    for pair in points.windows(2) {
        let x1 = pair[0].x as f32 * scale - crop_offset.0 - layer_offset.0;
        let y1 = pair[0].y as f32 * scale - crop_offset.1 - layer_offset.1;
        let x2 = pair[1].x as f32 * scale - crop_offset.0 - layer_offset.0;
        let y2 = pair[1].y as f32 * scale - crop_offset.1 - layer_offset.1;

        let left = ((x1.min(x2) - radius).floor() as i32).max(0);
        let right = ((x1.max(x2) + radius).ceil() as i32).min(bb_w as i32 - 1);
        let top = ((y1.min(y2) - radius).floor() as i32).max(0);
        let bottom = ((y1.max(y2) + radius).ceil() as i32).min(bb_h as i32 - 1);

        if left > right || top > bottom {
            continue;
        }

        let dx = x2 - x1;
        let dy = y2 - y1;
        let len_sq = dx * dx + dy * dy;

        segments.push(Segment {
            x1,
            y1,
            dx,
            dy,
            len_sq,
            bounds_left: left,
            bounds_right: right,
            bounds_top: top,
            bounds_bottom: bottom,
        });
    }

    let mut single_point = None;
    if segments.is_empty() && !points.is_empty() {
        let x1 = points[0].x as f32 * scale - crop_offset.0 - layer_offset.0;
        let y1 = points[0].y as f32 * scale - crop_offset.1 - layer_offset.1;
        let left = ((x1 - radius).floor() as i32).max(0);
        let right = ((x1 + radius).ceil() as i32).min(bb_w as i32 - 1);
        let top = ((y1 - radius).floor() as i32).max(0);
        let bottom = ((y1 + radius).ceil() as i32).min(bb_h as i32 - 1);
        if left <= right && top <= bottom {
            single_point = Some((x1, y1, left, right, top, bottom));
        }
    }

    let feather_amount = feather.clamp(0.0, 1.0);
    let inner_radius = radius * (1.0 - feather_amount);
    let feather_range = (radius - inner_radius).max(0.01);
    let radius_sq = radius * radius;
    let inner_radius_sq = inner_radius * inner_radius;

    out_pixels
        .par_chunks_mut(bb_w as usize)
        .enumerate()
        .for_each(|(y, row)| {
            let py = y as f32;
            let y_i32 = y as i32;

            let mut active_segments = Vec::new();
            for seg in &segments {
                if y_i32 >= seg.bounds_top && y_i32 <= seg.bounds_bottom {
                    active_segments.push(seg);
                }
            }

            let is_point_active = if let Some(pt) = &single_point {
                y_i32 >= pt.4 && y_i32 <= pt.5
            } else {
                false
            };

            if active_segments.is_empty() && !is_point_active {
                return;
            }

            for (x, pixel) in row.iter_mut().enumerate() {
                let px = x as f32;
                let x_i32 = x as i32;

                let mut min_dist_sq = radius_sq + 1.0;

                for seg in &active_segments {
                    if x_i32 >= seg.bounds_left && x_i32 <= seg.bounds_right {
                        let dist_sq = if seg.len_sq < 0.0001 {
                            (px - seg.x1) * (px - seg.x1) + (py - seg.y1) * (py - seg.y1)
                        } else {
                            let t = (((px - seg.x1) * seg.dx + (py - seg.y1) * seg.dy)
                                / seg.len_sq)
                                .clamp(0.0, 1.0);
                            let proj_x = seg.x1 + t * seg.dx;
                            let proj_y = seg.y1 + t * seg.dy;
                            (px - proj_x) * (px - proj_x) + (py - proj_y) * (py - proj_y)
                        };
                        if dist_sq < min_dist_sq {
                            min_dist_sq = dist_sq;
                        }
                    }
                }

                if is_point_active {
                    let pt = single_point.as_ref().unwrap();
                    if x_i32 >= pt.2 && x_i32 <= pt.3 {
                        let dist_sq = (px - pt.0) * (px - pt.0) + (py - pt.1) * (py - pt.1);
                        if dist_sq < min_dist_sq {
                            min_dist_sq = dist_sq;
                        }
                    }
                }

                if min_dist_sq <= radius_sq {
                    let intensity = if min_dist_sq <= inner_radius_sq {
                        1.0
                    } else {
                        let dist = min_dist_sq.sqrt();
                        let t = ((dist - inner_radius) / feather_range).clamp(0.0, 1.0);
                        1.0 - (t * t * (3.0 - 2.0 * t))
                    };
                    *pixel = (intensity * 255.0).round() as u8;
                }
            }
        });

    GrayImage::from_raw(bb_w, bb_h, out_pixels).unwrap()
}

fn generate_radial_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> GrayImage {
    let params: RadialMaskParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let mut mask = GrayImage::new(width, height);

    let center_x = (params.center_x as f32 * scale - crop_offset.0) as i32;
    let center_y = (params.center_y as f32 * scale - crop_offset.1) as i32;
    let radius_x = params.radius_x as f32 * scale;
    let radius_y = params.radius_y as f32 * scale;
    let rotation_rad = params.rotation * PI / 180.0;

    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - center_x as f32;
            let dy = y as f32 - center_y as f32;

            let cos_rot = rotation_rad.cos();
            let sin_rot = rotation_rad.sin();

            let rot_dx = dx * cos_rot + dy * sin_rot;
            let rot_dy = -dx * sin_rot + dy * cos_rot;

            let norm_x = rot_dx / radius_x.max(0.01);
            let norm_y = rot_dy / radius_y.max(0.01);

            let dist = (norm_x.powi(2) + norm_y.powi(2)).sqrt();

            let inner_bound = 1.0 - params.feather.clamp(0.0, 1.0);
            let intensity = 1.0 - (dist - inner_bound) / (1.0 - inner_bound).max(0.01);
            let clamped_intensity = intensity.clamp(0.0, 1.0);

            mask.put_pixel(x, y, Luma([(clamped_intensity * 255.0) as u8]));
        }
    }

    mask
}

fn generate_linear_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> GrayImage {
    let params: LinearMaskParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let mut mask = GrayImage::new(width, height);

    let start_x = params.start_x as f32 * scale - crop_offset.0;
    let start_y = params.start_y as f32 * scale - crop_offset.1;
    let end_x = params.end_x as f32 * scale - crop_offset.0;
    let end_y = params.end_y as f32 * scale - crop_offset.1;
    let range = params.range * scale;

    let line_vec_x = end_x - start_x;
    let line_vec_y = end_y - start_y;

    let len_sq = line_vec_x.powi(2) + line_vec_y.powi(2);

    if len_sq < 0.01 {
        return mask;
    }

    let perp_vec_x = -line_vec_y / len_sq.sqrt();
    let perp_vec_y = line_vec_x / len_sq.sqrt();

    let half_width = range.max(0.01);

    for y_u in 0..height {
        for x_u in 0..width {
            let x = x_u as f32;
            let y = y_u as f32;

            let pixel_vec_x = x - start_x;
            let pixel_vec_y = y - start_y;

            let dist_perp = pixel_vec_x * perp_vec_x + pixel_vec_y * perp_vec_y;

            let t = dist_perp / half_width;

            let intensity = 0.5 - t * 0.5;

            let clamped_intensity = intensity.clamp(0.0, 1.0);

            mask.put_pixel(x_u, y_u, Luma([(clamped_intensity * 255.0) as u8]));
        }
    }

    mask
}

fn generate_brush_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> GrayImage {
    let params: BrushMaskParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let mut final_mask = GrayImage::new(width, height);

    for line in &params.lines {
        if line.points.is_empty() {
            continue;
        }

        let is_eraser = line.tool == "eraser";
        let radius = (line.brush_size * scale / 2.0).max(0.0);
        let feather = line.feather.clamp(0.0, 1.0);

        let Some((min_x, min_y, max_x, max_y)) =
            stroke_bounds(&line.points, width, height, radius, scale, crop_offset)
        else {
            continue;
        };

        let bb_w = max_x - min_x + 1;
        let bb_h = max_y - min_y + 1;
        let layer_offset = (min_x as f32, min_y as f32);

        let line_mask = render_stroke_layer_parallel(
            &line.points,
            radius,
            feather,
            scale,
            crop_offset,
            layer_offset,
            bb_w,
            bb_h,
        );

        for y in 0..bb_h {
            for x in 0..bb_w {
                let src_val = line_mask.get_pixel(x, y)[0] as f32 / 255.0;
                if src_val <= 0.0 {
                    continue;
                }

                let abs_x = min_x + x;
                let abs_y = min_y + y;
                let dst_pixel = final_mask.get_pixel_mut(abs_x, abs_y);
                let dst_val = dst_pixel[0] as f32 / 255.0;

                let blended = if is_eraser {
                    dst_val * (1.0 - src_val)
                } else {
                    dst_val + src_val - dst_val * src_val
                };

                dst_pixel[0] = (blended.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
    }

    final_mask
}

fn generate_native_brush_bitmap(params_value: &Value, width: u32, height: u32) -> GrayImage {
    let Ok(params) = serde_json::from_value::<NativeBrushParameters>(params_value.clone()) else {
        return GrayImage::new(width, height);
    };
    let mut alpha = vec![0.0_f32; width as usize * height as usize];
    let max_dimension = width.max(height).max(1) as f32;
    for stroke in params.strokes {
        let _ = &stroke.id;
        let points = if stroke.points.len() == 1 {
            vec![stroke.points[0].clone(), stroke.points[0].clone()]
        } else {
            stroke.points
        };
        let radius = stroke.radius * max_dimension;
        let inner = radius * stroke.hardness;
        for y in 0..height {
            for x in 0..width {
                let mut coverage = 0.0_f32;
                for pair in points.windows(2) {
                    let start = &pair[0];
                    let end = &pair[1];
                    let sx = start.x * width as f32;
                    let sy = start.y * height as f32;
                    let dx = end.x * width as f32 - sx;
                    let dy = end.y * height as f32 - sy;
                    let length2 = dx * dx + dy * dy;
                    let t = if length2 > f32::EPSILON {
                        (((x as f32 + 0.5 - sx) * dx + (y as f32 + 0.5 - sy) * dy) / length2)
                            .clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let distance = ((x as f32 + 0.5 - (sx + dx * t)).powi(2)
                        + (y as f32 + 0.5 - (sy + dy * t)).powi(2))
                    .sqrt();
                    if distance <= radius {
                        let edge = (radius - inner).max(f32::EPSILON);
                        let falloff = if distance <= inner {
                            1.0
                        } else {
                            1.0 - (distance - inner) / edge
                        };
                        let pressure = start.pressure.unwrap_or(1.0)
                            + (end.pressure.unwrap_or(1.0) - start.pressure.unwrap_or(1.0)) * t;
                        coverage = coverage.max(falloff * stroke.flow * pressure);
                    }
                }
                let index = y as usize * width as usize + x as usize;
                alpha[index] = 1.0 - (1.0 - alpha[index]) * (1.0 - coverage.clamp(0.0, 1.0));
            }
        }
    }
    GrayImage::from_fn(width, height, |x, y| {
        Luma([(alpha[y as usize * width as usize + x as usize] * 255.0).round() as u8])
    })
}

fn generate_flow_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> GrayImage {
    let params: FlowMaskParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let mut final_mask = GrayImage::new(width, height);

    for line in &params.lines {
        if line.points.is_empty() {
            continue;
        }

        let is_eraser = line.tool == "eraser";
        let flow_per_stroke = (line.flow.clamp(0.0, 100.0) / 100.0) * 255.0;
        let radius = (line.brush_size * scale / 2.0).max(0.0);
        let feather = line.feather.clamp(0.0, 1.0);

        let Some((min_x, min_y, max_x, max_y)) =
            stroke_bounds(&line.points, width, height, radius, scale, crop_offset)
        else {
            continue;
        };

        let bb_w = max_x - min_x + 1;
        let bb_h = max_y - min_y + 1;
        let layer_offset = (min_x as f32, min_y as f32);

        let line_mask = render_stroke_layer_parallel(
            &line.points,
            radius,
            feather,
            scale,
            crop_offset,
            layer_offset,
            bb_w,
            bb_h,
        );

        for y in 0..bb_h {
            for x in 0..bb_w {
                let stroke_pixel = line_mask.get_pixel(x, y)[0] as f32;
                if stroke_pixel <= 0.0 {
                    continue;
                }

                let abs_x = min_x + x;
                let abs_y = min_y + y;
                let pixel = final_mask.get_pixel_mut(abs_x, abs_y);

                let c_norm = pixel[0] as f32 / 255.0;
                let delta = ((stroke_pixel / 255.0) * flow_per_stroke).round();
                let d_norm = (delta / 255.0).clamp(0.0, 1.0);

                let next = if is_eraser {
                    c_norm * (1.0 - d_norm)
                } else {
                    c_norm + d_norm - c_norm * d_norm
                };

                pixel[0] = (next.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
    }

    final_mask
}

struct TransformParams {
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
}

fn generate_ai_bitmap_from_full_mask(
    full_mask_image: &GrayImage,
    tf: &TransformParams,
) -> GrayImage {
    let (full_mask_w, full_mask_h) = full_mask_image.dimensions();
    let mut final_mask = GrayImage::new(tf.width, tf.height);

    let angle_rad = tf.rotation.to_radians();
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let (coarse_rotated_w, coarse_rotated_h) = if tf.orientation_steps % 2 == 1 {
        (full_mask_h, full_mask_w)
    } else {
        (full_mask_w, full_mask_h)
    };

    let scaled_coarse_rotated_w = coarse_rotated_w as f32 * tf.scale;
    let scaled_coarse_rotated_h = coarse_rotated_h as f32 * tf.scale;
    let center_x = scaled_coarse_rotated_w / 2.0;
    let center_y = scaled_coarse_rotated_h / 2.0;

    for y_out in 0..tf.height {
        for x_out in 0..tf.width {
            let x_uncrop = x_out as f32 + tf.crop_offset.0;
            let y_uncrop = y_out as f32 + tf.crop_offset.1;

            let x_centered = x_uncrop - center_x;
            let y_centered = y_uncrop - center_y;

            let x_unrotated = x_centered * cos_a + y_centered * sin_a + center_x;
            let y_unrotated = -x_centered * sin_a + y_centered * cos_a + center_y;

            let x_unflipped = if tf.flip_horizontal {
                scaled_coarse_rotated_w - x_unrotated
            } else {
                x_unrotated
            };
            let y_unflipped = if tf.flip_vertical {
                scaled_coarse_rotated_h - y_unrotated
            } else {
                y_unrotated
            };

            let (x_unrotated_coarse, y_unrotated_coarse) = match tf.orientation_steps {
                0 => (x_unflipped, y_unflipped),
                1 => (y_unflipped, scaled_coarse_rotated_w - x_unflipped),
                2 => (
                    scaled_coarse_rotated_w - x_unflipped,
                    scaled_coarse_rotated_h - y_unflipped,
                ),
                3 => (scaled_coarse_rotated_h - y_unflipped, x_unflipped),
                _ => (x_unflipped, y_unflipped),
            };

            let x_src = x_unrotated_coarse / tf.scale;
            let y_src = y_unrotated_coarse / tf.scale;

            if x_src >= 0.0
                && x_src < full_mask_w as f32
                && y_src >= 0.0
                && y_src < full_mask_h as f32
            {
                let pixel = full_mask_image.get_pixel(x_src as u32, y_src as u32);
                final_mask.put_pixel(x_out, y_out, *pixel);
            }
        }
    }

    final_mask
}

fn generate_ai_bitmap_from_base64(data_url: &str, tf: &TransformParams) -> Option<GrayImage> {
    let b64_data = if let Some(idx) = data_url.find(',') {
        &data_url[idx + 1..]
    } else {
        data_url
    };

    let decoded_bytes = general_purpose::STANDARD.decode(b64_data).ok()?;
    let full_mask_image = image::load_from_memory(&decoded_bytes).ok()?.to_luma8();

    Some(generate_ai_bitmap_from_full_mask(&full_mask_image, tf))
}

fn generate_ai_sky_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: AiSkyMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    let grow_feather: GrowFeatherParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let data_url = params.mask_data_base64?;

    let tf = TransformParams {
        rotation: params.rotation.unwrap_or(0.0),
        flip_horizontal: params.flip_horizontal.unwrap_or(false),
        flip_vertical: params.flip_vertical.unwrap_or(false),
        orientation_steps: params.orientation_steps.unwrap_or(0),
        width,
        height,
        scale,
        crop_offset,
    };
    let mut mask = generate_ai_bitmap_from_base64(&data_url, &tf)?;

    apply_grow_and_feather(
        &mut mask,
        grow_feather.grow,
        grow_feather.feather,
        width,
        height,
    );

    Some(mask)
}

fn generate_ai_depth_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: AiDepthMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    let grow_feather: GrowFeatherParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let data_url = params.mask_data_base64?;

    let tf = TransformParams {
        rotation: params.rotation.unwrap_or(0.0),
        flip_horizontal: params.flip_horizontal.unwrap_or(false),
        flip_vertical: params.flip_vertical.unwrap_or(false),
        orientation_steps: params.orientation_steps.unwrap_or(0),
        width,
        height,
        scale,
        crop_offset,
    };

    let depth_map = generate_ai_bitmap_from_base64(&data_url, &tf)?;

    let (w, h) = depth_map.dimensions();
    let mut mask = GrayImage::new(w, h);

    fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
        let t = ((x - edge0) / (edge1 - edge0).max(0.0001)).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }

    let min_fade = params.min_fade;
    let max_fade = params.max_fade;

    for (x, y, p) in depth_map.enumerate_pixels() {
        let val_pct = (p[0] as f32 / 255.0) * 100.0;

        let lower_bound = smoothstep(params.min_depth - min_fade, params.min_depth, val_pct);
        let upper_bound = 1.0 - smoothstep(params.max_depth, params.max_depth + max_fade, val_pct);
        let bandpass_weight = lower_bound * upper_bound;

        let depth_intensity = val_pct / 100.0;
        let final_intensity = bandpass_weight * depth_intensity;

        mask.put_pixel(x, y, Luma([(final_intensity * 255.0) as u8]));
    }

    if params.feather > 0.0 {
        mask = image::imageops::blur(&mask, params.feather * 0.1);
    }

    apply_grow_and_feather(
        &mut mask,
        grow_feather.grow,
        grow_feather.feather,
        width,
        height,
    );

    Some(mask)
}

fn generate_ai_foreground_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: AiForegroundMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    let grow_feather: GrowFeatherParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let data_url = params.mask_data_base64?;

    let tf = TransformParams {
        rotation: params.rotation.unwrap_or(0.0),
        flip_horizontal: params.flip_horizontal.unwrap_or(false),
        flip_vertical: params.flip_vertical.unwrap_or(false),
        orientation_steps: params.orientation_steps.unwrap_or(0),
        width,
        height,
        scale,
        crop_offset,
    };
    let mut mask = generate_ai_bitmap_from_base64(&data_url, &tf)?;

    apply_grow_and_feather(
        &mut mask,
        grow_feather.grow,
        grow_feather.feather,
        width,
        height,
    );

    Some(mask)
}

fn generate_ai_subject_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: AiSubjectMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    let grow_feather: GrowFeatherParameters =
        serde_json::from_value(params_value.clone()).unwrap_or_default();
    let data_url = params.mask_data_base64?;

    let tf = TransformParams {
        rotation: params.rotation.unwrap_or(0.0),
        flip_horizontal: params.flip_horizontal.unwrap_or(false),
        flip_vertical: params.flip_vertical.unwrap_or(false),
        orientation_steps: params.orientation_steps.unwrap_or(0),
        width,
        height,
        scale,
        crop_offset,
    };
    let mut mask = generate_ai_bitmap_from_base64(&data_url, &tf)?;

    apply_grow_and_feather(
        &mut mask,
        grow_feather.grow,
        grow_feather.feather,
        width,
        height,
    );

    Some(mask)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectPromptMaskParameters {
    #[serde(default)]
    box_prompt: Option<ObjectPromptBox>,
    #[serde(default)]
    flip_horizontal: Option<bool>,
    #[serde(default)]
    flip_vertical: Option<bool>,
    #[serde(default)]
    mask_data_base64: Option<String>,
    #[serde(default)]
    orientation_steps: Option<u8>,
    #[serde(default)]
    point_prompts: Vec<ObjectPromptPoint>,
    #[serde(default)]
    rotation: Option<f32>,
}

#[derive(Deserialize)]
struct ObjectPromptBox {
    height: f32,
    width: f32,
    x: f32,
    y: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectPromptPoint {
    #[serde(default = "default_object_prompt_label")]
    label: String,
    x: f32,
    y: f32,
}

fn default_object_prompt_label() -> String {
    "foreground".to_string()
}

fn generate_ai_object_prompt_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: ObjectPromptMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    if let Some(data_url) = params.mask_data_base64 {
        let tf = TransformParams {
            rotation: params.rotation.unwrap_or(0.0),
            flip_horizontal: params.flip_horizontal.unwrap_or(false),
            flip_vertical: params.flip_vertical.unwrap_or(false),
            orientation_steps: params.orientation_steps.unwrap_or(0),
            width,
            height,
            scale,
            crop_offset,
        };
        return generate_ai_bitmap_from_base64(&data_url, &tf);
    }

    if params.box_prompt.is_none() && params.point_prompts.is_empty() {
        return None;
    }

    let mut mask = GrayImage::from_pixel(width, height, Luma([0]));
    if let Some(box_prompt) = params.box_prompt {
        let left = (box_prompt.x.clamp(0.0, 1.0) * width as f32)
            .floor()
            .max(0.0) as u32;
        let top = (box_prompt.y.clamp(0.0, 1.0) * height as f32)
            .floor()
            .max(0.0) as u32;
        let right = ((box_prompt.x + box_prompt.width).clamp(0.0, 1.0) * width as f32)
            .ceil()
            .min(width as f32) as u32;
        let bottom = ((box_prompt.y + box_prompt.height).clamp(0.0, 1.0) * height as f32)
            .ceil()
            .min(height as f32) as u32;
        for y in top..bottom {
            for x in left..right {
                mask.put_pixel(x, y, Luma([220]));
            }
        }
    }

    let radius = ((width.min(height) as f32) * 0.035).max(4.0);
    let radius_squared = radius * radius;
    for point in params
        .point_prompts
        .iter()
        .filter(|point| point.label == "foreground")
    {
        let center_x = point.x.clamp(0.0, 1.0) * width.saturating_sub(1) as f32;
        let center_y = point.y.clamp(0.0, 1.0) * height.saturating_sub(1) as f32;
        let left = (center_x - radius).floor().max(0.0) as u32;
        let right = (center_x + radius)
            .ceil()
            .min(width.saturating_sub(1) as f32) as u32;
        let top = (center_y - radius).floor().max(0.0) as u32;
        let bottom = (center_y + radius)
            .ceil()
            .min(height.saturating_sub(1) as f32) as u32;
        for y in top..=bottom {
            for x in left..=right {
                let dx = x as f32 - center_x;
                let dy = y as f32 - center_y;
                if dx * dx + dy * dy <= radius_squared {
                    mask.put_pixel(x, y, Luma([255]));
                }
            }
        }
    }

    Some(mask)
}

fn generate_color_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&image::DynamicImage>,
) -> Option<GrayImage> {
    let params: ParametricMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    let warped = warped_image?;
    let (full_w, full_h) = warped.dimensions();

    let target_x = params.target_x.round() as i32;
    let target_y = params.target_y.round() as i32;
    if target_x < 0 || target_y < 0 || target_x >= full_w as i32 || target_y >= full_h as i32 {
        return None;
    }

    let ref_pixel = warped.get_pixel(target_x as u32, target_y as u32);
    let ref_r = ref_pixel[0] as f32;
    let ref_g = ref_pixel[1] as f32;
    let ref_b = ref_pixel[2] as f32;

    let mut mask = GrayImage::new(width, height);

    let angle_rad = params.rotation * PI / 180.0;
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let (coarse_rotated_w, coarse_rotated_h) = if params.orientation_steps % 2 == 1 {
        (full_h, full_w)
    } else {
        (full_w, full_h)
    };

    let scaled_coarse_rotated_w = coarse_rotated_w as f32 * scale;
    let scaled_coarse_rotated_h = coarse_rotated_h as f32 * scale;
    let center_x = scaled_coarse_rotated_w / 2.0;
    let center_y = scaled_coarse_rotated_h / 2.0;

    let tolerance_sq = (params.tolerance * 2.55).max(1.0).powi(2) * 3.0;
    let inv_scale = 1.0 / scale;

    for y_out in 0..height {
        let y_uncrop = y_out as f32 + crop_offset.1;
        let y_centered = y_uncrop - center_y;
        let y_sin = y_centered * sin_a;
        let y_cos = y_centered * cos_a;

        for x_out in 0..width {
            let x_uncrop = x_out as f32 + crop_offset.0;
            let x_centered = x_uncrop - center_x;

            let x_unrotated = x_centered * cos_a + y_sin + center_x;
            let y_unrotated = -x_centered * sin_a + y_cos + center_y;

            let x_unflipped = if params.flip_horizontal {
                scaled_coarse_rotated_w - x_unrotated
            } else {
                x_unrotated
            };
            let y_unflipped = if params.flip_vertical {
                scaled_coarse_rotated_h - y_unrotated
            } else {
                y_unrotated
            };

            let (x_unrotated_coarse, y_unrotated_coarse) = match params.orientation_steps {
                0 => (x_unflipped, y_unflipped),
                1 => (y_unflipped, scaled_coarse_rotated_w - x_unflipped),
                2 => (
                    scaled_coarse_rotated_w - x_unflipped,
                    scaled_coarse_rotated_h - y_unflipped,
                ),
                3 => (scaled_coarse_rotated_h - y_unflipped, x_unflipped),
                _ => (x_unflipped, y_unflipped),
            };

            if x_unrotated_coarse >= 0.0 && y_unrotated_coarse >= 0.0 {
                let x_src = (x_unrotated_coarse * inv_scale) as u32;
                let y_src = (y_unrotated_coarse * inv_scale) as u32;

                if x_src < full_w && y_src < full_h {
                    let pixel = warped.get_pixel(x_src, y_src);
                    let dist_sq = (pixel[0] as f32 - ref_r).powi(2)
                        + (pixel[1] as f32 - ref_g).powi(2)
                        + (pixel[2] as f32 - ref_b).powi(2);

                    if dist_sq <= tolerance_sq {
                        let intensity = 1.0 - (dist_sq.sqrt() / tolerance_sq.sqrt());
                        mask.put_pixel(x_out, y_out, Luma([(intensity * 255.0) as u8]));
                    }
                }
            }
        }
    }

    apply_grow_and_feather(&mut mask, params.grow, params.feather, width, height);
    Some(mask)
}

fn rec709_luma(red: f32, green: f32, blue: f32) -> f32 {
    (0.2126 * red + 0.7152 * green + 0.0722 * blue).clamp(0.0, 1.0)
}

fn hue_distance_degrees(left: f32, right: f32) -> f32 {
    let delta = (left - right).rem_euclid(360.0).abs();
    delta.min(360.0 - delta)
}

fn rgb_to_hsv_sample(pixel: Rgba<u8>) -> (f32, f32, f32) {
    let red = pixel[0] as f32 / 255.0;
    let green = pixel[1] as f32 / 255.0;
    let blue = pixel[2] as f32 / 255.0;
    let max = red.max(green).max(blue);
    let min = red.min(green).min(blue);
    let delta = max - min;
    let mut hue_degrees = 0.0;

    if delta > 0.000001 {
        hue_degrees = if (max - red).abs() <= f32::EPSILON {
            60.0 * ((green - blue) / delta).rem_euclid(6.0)
        } else if (max - green).abs() <= f32::EPSILON {
            60.0 * ((blue - red) / delta + 2.0)
        } else {
            60.0 * ((red - green) / delta + 4.0)
        };
    }

    let saturation = if max <= 0.000001 { 0.0 } else { delta / max };
    (
        hue_degrees.rem_euclid(360.0),
        saturation,
        rec709_luma(red, green, blue),
    )
}

fn evaluate_luminance_range_weight(luma: f32, params: &LuminanceRangeMaskParameters) -> f32 {
    if luma < params.min_luma || luma > params.max_luma {
        return 0.0;
    }

    let fade = ((params.max_luma - params.min_luma) * params.feather).max(0.0001);
    let lower_weight = ((luma - params.min_luma) / fade).min(1.0);
    let upper_weight = ((params.max_luma - luma) / fade).min(1.0);
    lower_weight.min(upper_weight).clamp(0.0, 1.0)
}

fn evaluate_color_range_weight(
    hue_degrees: f32,
    saturation: f32,
    luma: f32,
    params: &ColorRangeMaskParameters,
) -> f32 {
    if luma < params.min_luma
        || luma > params.max_luma
        || saturation < params.min_saturation
        || saturation > params.max_saturation
    {
        return 0.0;
    }

    let hue_distance = hue_distance_degrees(hue_degrees, params.center_hue_degrees);
    let feather = params.feather.clamp(0.0, 1.0);
    let inner_radius = params.hue_tolerance_degrees * (1.0 - feather);
    if hue_distance <= inner_radius {
        return 1.0;
    }
    if hue_distance >= params.hue_tolerance_degrees {
        return 0.0;
    }

    let fade = (params.hue_tolerance_degrees - inner_radius).max(0.0001);
    (1.0 - (hue_distance - inner_radius) / fade).clamp(0.0, 1.0)
}

fn generate_warped_range_bitmap(
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&image::DynamicImage>,
    evaluate: impl Fn(Rgba<u8>) -> f32,
) -> Option<GrayImage> {
    let warped = warped_image?;
    let (full_w, full_h) = warped.dimensions();
    let mut mask = GrayImage::new(width, height);
    let inv_scale = 1.0 / scale.max(0.0001);

    for y_out in 0..height {
        let y_src = ((y_out as f32 + crop_offset.1) * inv_scale) as u32;
        if y_src >= full_h {
            continue;
        }

        for x_out in 0..width {
            let x_src = ((x_out as f32 + crop_offset.0) * inv_scale) as u32;
            if x_src >= full_w {
                continue;
            }

            let alpha = evaluate(warped.get_pixel(x_src, y_src));
            mask.put_pixel(
                x_out,
                y_out,
                Luma([(alpha.clamp(0.0, 1.0) * 255.0).round() as u8]),
            );
        }
    }

    Some(mask)
}

fn generate_luminance_range_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&image::DynamicImage>,
) -> Option<GrayImage> {
    let params: LuminanceRangeMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    generate_warped_range_bitmap(width, height, scale, crop_offset, warped_image, |pixel| {
        let (_, _, luma) = rgb_to_hsv_sample(pixel);
        evaluate_luminance_range_weight(luma, &params)
    })
}

fn generate_color_range_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&image::DynamicImage>,
) -> Option<GrayImage> {
    let params: ColorRangeMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    generate_warped_range_bitmap(width, height, scale, crop_offset, warped_image, |pixel| {
        let (hue_degrees, saturation, luma) = rgb_to_hsv_sample(pixel);
        evaluate_color_range_weight(hue_degrees, saturation, luma, &params)
    })
}

fn generate_luminance_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&image::DynamicImage>,
) -> Option<GrayImage> {
    let params: ParametricMaskParameters = serde_json::from_value(params_value.clone()).ok()?;
    let warped = warped_image?;
    let (full_w, full_h) = warped.dimensions();

    let target_x = params.target_x.round() as i32;
    let target_y = params.target_y.round() as i32;
    if target_x < 0 || target_y < 0 || target_x >= full_w as i32 || target_y >= full_h as i32 {
        return None;
    }

    let ref_pixel = warped.get_pixel(target_x as u32, target_y as u32);
    let ref_luma =
        0.299 * ref_pixel[0] as f32 + 0.587 * ref_pixel[1] as f32 + 0.114 * ref_pixel[2] as f32;

    let mut mask = GrayImage::new(width, height);

    let angle_rad = params.rotation * PI / 180.0;
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let (coarse_rotated_w, coarse_rotated_h) = if params.orientation_steps % 2 == 1 {
        (full_h, full_w)
    } else {
        (full_w, full_h)
    };

    let scaled_coarse_rotated_w = coarse_rotated_w as f32 * scale;
    let scaled_coarse_rotated_h = coarse_rotated_h as f32 * scale;
    let center_x = scaled_coarse_rotated_w / 2.0;
    let center_y = scaled_coarse_rotated_h / 2.0;

    let tolerance_val = (params.tolerance * 2.55).max(1.0);
    let inv_scale = 1.0 / scale;

    for y_out in 0..height {
        let y_uncrop = y_out as f32 + crop_offset.1;
        let y_centered = y_uncrop - center_y;
        let y_sin = y_centered * sin_a;
        let y_cos = y_centered * cos_a;

        for x_out in 0..width {
            let x_uncrop = x_out as f32 + crop_offset.0;
            let x_centered = x_uncrop - center_x;

            let x_unrotated = x_centered * cos_a + y_sin + center_x;
            let y_unrotated = -x_centered * sin_a + y_cos + center_y;

            let x_unflipped = if params.flip_horizontal {
                scaled_coarse_rotated_w - x_unrotated
            } else {
                x_unrotated
            };
            let y_unflipped = if params.flip_vertical {
                scaled_coarse_rotated_h - y_unrotated
            } else {
                y_unrotated
            };

            let (x_unrotated_coarse, y_unrotated_coarse) = match params.orientation_steps {
                0 => (x_unflipped, y_unflipped),
                1 => (y_unflipped, scaled_coarse_rotated_w - x_unflipped),
                2 => (
                    scaled_coarse_rotated_w - x_unflipped,
                    scaled_coarse_rotated_h - y_unflipped,
                ),
                3 => (scaled_coarse_rotated_h - y_unflipped, x_unflipped),
                _ => (x_unflipped, y_unflipped),
            };

            if x_unrotated_coarse >= 0.0 && y_unrotated_coarse >= 0.0 {
                let x_src = (x_unrotated_coarse * inv_scale) as u32;
                let y_src = (y_unrotated_coarse * inv_scale) as u32;

                if x_src < full_w && y_src < full_h {
                    let pixel = warped.get_pixel(x_src, y_src);
                    let luma =
                        0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32;
                    let dist = (luma - ref_luma).abs();

                    if dist <= tolerance_val {
                        let intensity = 1.0 - (dist / tolerance_val);
                        mask.put_pixel(x_out, y_out, Luma([(intensity * 255.0) as u8]));
                    }
                }
            }
        }
    }

    apply_grow_and_feather(&mut mask, params.grow, params.feather, width, height);
    Some(mask)
}

fn generate_all_bitmap(width: u32, height: u32) -> GrayImage {
    GrayImage::from_pixel(width, height, Luma([255]))
}

fn generate_sub_mask_bitmap(
    sub_mask: &SubMask,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&DynamicImage>,
) -> Option<GrayImage> {
    if !sub_mask.visible {
        return None;
    }

    let mut bitmap = match sub_mask.mask_type.as_str() {
        "radial" => Some(generate_radial_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        )),
        "linear" => Some(generate_linear_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        )),
        "brush" => Some(generate_brush_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        )),
        "brush_v1" => Some(generate_native_brush_bitmap(
            &sub_mask.parameters,
            width,
            height,
        )),
        "flow" => Some(generate_flow_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        )),
        "color" => generate_color_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
            warped_image,
        ),
        "luminance" => generate_luminance_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
            warped_image,
        ),
        "color_range" => generate_color_range_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
            warped_image,
        ),
        "luminance_range" => generate_luminance_range_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
            warped_image,
        ),
        "ai-subject" => {
            generate_ai_subject_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "ai-object" => generate_ai_object_prompt_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        ),
        "ai-foreground" => {
            generate_ai_foreground_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "ai-person" => {
            generate_ai_foreground_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "ai-sky" => generate_ai_sky_bitmap(&sub_mask.parameters, width, height, scale, crop_offset),
        "ai-depth" => {
            generate_ai_depth_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "quick-eraser" => {
            generate_ai_subject_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "all" => Some(generate_all_bitmap(width, height)),
        _ => None,
    };

    if let Some(mask) = bitmap.as_mut() {
        apply_mask_refinement(mask, &sub_mask.parameters, scale, warped_image);
    }

    bitmap
}

pub fn generate_mask_bitmap(
    mask_def: &MaskDefinition,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&DynamicImage>,
) -> Option<GrayImage> {
    if !mask_def.visible || mask_def.sub_masks.is_empty() {
        return None;
    }

    let mut final_mask = GrayImage::new(width, height);

    for sub_mask in &mask_def.sub_masks {
        if let Some(mut sub_bitmap) =
            generate_sub_mask_bitmap(sub_mask, width, height, scale, crop_offset, warped_image)
        {
            if sub_mask.invert {
                for p in sub_bitmap.pixels_mut() {
                    p[0] = 255 - p[0];
                }
            }

            let opacity_multiplier = (sub_mask.opacity / 100.0).clamp(0.0, 1.0);
            if opacity_multiplier < 1.0 {
                for pixel in sub_bitmap.pixels_mut() {
                    pixel[0] = (pixel[0] as f32 * opacity_multiplier) as u8;
                }
            }

            match sub_mask.mode {
                SubMaskMode::Additive => {
                    for (x, y, pixel) in final_mask.enumerate_pixels_mut() {
                        let sub_pixel = sub_bitmap.get_pixel(x, y);
                        pixel[0] = pixel[0].max(sub_pixel[0]);
                    }
                }
                SubMaskMode::Subtractive => {
                    for (x, y, pixel) in final_mask.enumerate_pixels_mut() {
                        let sub_pixel = sub_bitmap.get_pixel(x, y);
                        pixel[0] = pixel[0].saturating_sub(sub_pixel[0]);
                    }
                }
                SubMaskMode::Intersect => {
                    for (x, y, pixel) in final_mask.enumerate_pixels_mut() {
                        let sub_pixel = sub_bitmap.get_pixel(x, y);
                        pixel[0] = pixel[0].min(sub_pixel[0]);
                    }
                }
            }
        }
    }

    if mask_def.invert {
        for pixel in final_mask.pixels_mut() {
            pixel[0] = 255 - pixel[0];
        }
    }

    let opacity_multiplier = (mask_def.opacity / 100.0).clamp(0.0, 1.0);
    if opacity_multiplier < 1.0 {
        for pixel in final_mask.pixels_mut() {
            pixel[0] = (pixel[0] as f32 * opacity_multiplier) as u8;
        }
    }

    Some(final_mask)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn generate_mask_overlay(
    mut mask_def: serde_json::Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    overlay_settings: Option<MaskOverlaySettings>,
    mut js_adjustments: Option<serde_json::Value>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    if let Some(ref mut adj) = js_adjustments {
        crate::adjustment_utils::hydrate_adjustments(&state, adj);
    }

    if let Some(sub_masks) = mask_def.get_mut("subMasks").and_then(|v| v.as_array_mut()) {
        let mut cache = state.patch_cache.lock().unwrap();
        crate::adjustment_utils::hydrate_sub_masks(sub_masks, &mut cache);
    }

    let parsed_mask_def: MaskDefinition = serde_json::from_value(mask_def)
        .map_err(|e| format!("Failed to parse hydrated mask_def: {}", e))?;

    let scaled_crop_offset = (crop_offset.0 * scale, crop_offset.1 * scale);

    let warped_image = js_adjustments.as_ref().and_then(|adj| {
        resolve_warped_image_for_masks(&state, adj, std::slice::from_ref(&parsed_mask_def))
    });

    if let Some(gray_mask) = generate_mask_bitmap(
        &parsed_mask_def,
        width,
        height,
        scale,
        scaled_crop_offset,
        warped_image.as_deref(),
    ) {
        let settings = overlay_settings.unwrap_or_default();
        let mut rgba_mask = RgbaImage::new(width, height);
        for (x, y, pixel) in gray_mask.enumerate_pixels() {
            rgba_mask.put_pixel(x, y, mask_overlay_pixel(pixel[0], settings));
        }

        let mut buf = Cursor::new(Vec::new());
        rgba_mask
            .write_to(&mut buf, ImageFormat::Png)
            .map_err(|e| e.to_string())?;

        let base64_str = general_purpose::STANDARD.encode(buf.get_ref());
        let data_url = png_data_url(base64_str);

        Ok(data_url)
    } else {
        Ok("".to_string())
    }
}

pub fn resolve_warped_image_for_masks(
    state: &tauri::State<AppState>,
    adjustments: &serde_json::Value,
    masks: &[MaskDefinition],
) -> Option<Arc<DynamicImage>> {
    if masks.iter().any(|m| m.requires_warped_image()) {
        get_cached_full_warped_image(state, adjustments).ok()
    } else {
        None
    }
}

pub fn get_cached_or_generate_mask(
    state: &tauri::State<AppState>,
    def: &MaskDefinition,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    adjustments: &serde_json::Value,
) -> Option<GrayImage> {
    let mut hasher = DefaultHasher::new();

    let mut def_for_hash = def.clone();
    def_for_hash.adjustments = serde_json::Value::Null;
    let def_json = serde_json::to_string(&def_for_hash).unwrap_or_default();
    def_json.hash(&mut hasher);

    width.hash(&mut hasher);
    height.hash(&mut hasher);
    scale.to_bits().hash(&mut hasher);
    crop_offset.0.to_bits().hash(&mut hasher);
    crop_offset.1.to_bits().hash(&mut hasher);
    if def.requires_warped_image() {
        serde_json::to_string(adjustments)
            .unwrap_or_default()
            .hash(&mut hasher);
    }

    let key = hasher.finish();

    {
        let cache = state.mask_cache.lock().unwrap();
        if let Some(img) = cache.get(&key) {
            return Some(img.clone());
        }
    }

    let warped_image =
        resolve_warped_image_for_masks(state, adjustments, std::slice::from_ref(def));

    let generated = generate_mask_bitmap(
        def,
        width,
        height,
        scale,
        crop_offset,
        warped_image.as_deref(),
    );

    if let Some(img) = &generated {
        let mut cache = state.mask_cache.lock().unwrap();
        if cache.len() > 50 {
            cache.clear();
        }
        cache.insert(key, img.clone());
    }

    generated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_overlay_pixel_preserves_default_rubylith_contract() {
        assert_eq!(
            mask_overlay_pixel(128, MaskOverlaySettings::default()),
            Rgba([255, 24, 48, 64])
        );
    }

    #[test]
    fn mask_overlay_pixel_supports_hidden_grayscale_inverse_and_edges() {
        assert_eq!(
            mask_overlay_pixel(
                255,
                MaskOverlaySettings {
                    mode: MaskOverlayMode::Hidden,
                    ..MaskOverlaySettings::default()
                },
            ),
            Rgba([0, 0, 0, 0])
        );

        assert_eq!(
            mask_overlay_pixel(
                128,
                MaskOverlaySettings {
                    mode: MaskOverlayMode::Grayscale,
                    opacity: 0.75,
                    ..MaskOverlaySettings::default()
                },
            ),
            Rgba([128, 128, 128, 191])
        );

        assert_eq!(
            mask_overlay_pixel(
                64,
                MaskOverlaySettings {
                    mode: MaskOverlayMode::Inverse,
                    opacity: 0.4,
                    ..MaskOverlaySettings::default()
                },
            ),
            Rgba([191, 191, 191, 102])
        );

        assert_eq!(
            mask_overlay_pixel(
                153,
                MaskOverlaySettings {
                    edge_threshold: 0.6,
                    mode: MaskOverlayMode::Edges,
                    opacity: 1.0,
                },
            ),
            Rgba([255, 255, 255, 255])
        );
    }

    #[test]
    fn apply_mask_refinement_applies_density() {
        let mut mask = GrayImage::from_pixel(1, 1, Luma([255]));
        let params = serde_json::json!({
            "density": 0.25,
            "edgeContrast": 0,
            "edgeShiftPx": 0,
            "featherPx": 0,
            "smoothness": 0
        });

        apply_mask_refinement(&mut mask, &params, 1.0, None);

        assert_eq!(mask.get_pixel(0, 0)[0], 64);
    }

    #[test]
    fn apply_mask_refinement_applies_positive_edge_shift() {
        let mut mask = GrayImage::new(3, 1);
        mask.put_pixel(1, 0, Luma([255]));
        let params = serde_json::json!({
            "density": 1,
            "edgeContrast": 0,
            "edgeShiftPx": 1,
            "featherPx": 0,
            "smoothness": 0
        });

        apply_mask_refinement(&mut mask, &params, 1.0, None);

        assert_eq!(mask.get_pixel(0, 0)[0], 255);
        assert_eq!(mask.get_pixel(1, 0)[0], 255);
        assert_eq!(mask.get_pixel(2, 0)[0], 255);
    }

    #[test]
    fn apply_mask_refinement_uses_local_image_edges_for_transition_pixels() {
        let mut mask = GrayImage::from_pixel(5, 1, Luma([128]));
        let mut edge_image = RgbaImage::new(5, 1);
        for x in 0..5 {
            let value = if x < 2 { 24 } else { 232 };
            edge_image.put_pixel(x, 0, Rgba([value, value, value, 255]));
        }
        let image = DynamicImage::ImageRgba8(edge_image);
        let params = serde_json::json!({
            "density": 1,
            "edgeContrast": 0.8,
            "edgeShiftPx": 0,
            "featherPx": 0,
            "smoothness": 0.8
        });

        apply_mask_refinement(&mut mask, &params, 1.0, Some(&image));

        assert!(
            mask.get_pixel(2, 0)[0] > mask.get_pixel(0, 0)[0],
            "image-edge evidence should tighten the transition at the high-contrast boundary"
        );
    }

    #[test]
    fn apply_mask_refinement_uses_hair_detail_for_chroma_edges() {
        let mut baseline = GrayImage::from_pixel(5, 1, Luma([128]));
        let mut refined = baseline.clone();
        let mut edge_image = RgbaImage::new(5, 1);
        for x in 0..5 {
            let pixel = if x < 2 {
                Rgba([200, 20, 20, 255])
            } else {
                Rgba([20, 112, 20, 255])
            };
            edge_image.put_pixel(x, 0, pixel);
        }
        let image = DynamicImage::ImageRgba8(edge_image);
        let baseline_params = serde_json::json!({
            "density": 1,
            "edgeContrast": 0,
            "edgeShiftPx": 0,
            "featherPx": 0,
            "hairDetail": 0,
            "smoothness": 0
        });
        let hair_params = serde_json::json!({
            "density": 1,
            "edgeContrast": 0,
            "edgeShiftPx": 0,
            "featherPx": 0,
            "hairDetail": 1,
            "smoothness": 0
        });

        apply_mask_refinement(&mut baseline, &baseline_params, 1.0, Some(&image));
        apply_mask_refinement(&mut refined, &hair_params, 1.0, Some(&image));

        assert!(
            refined.get_pixel(2, 0)[0] > baseline.get_pixel(2, 0)[0],
            "hair detail should tighten chroma-only transition edges"
        );
    }

    #[test]
    fn range_masks_require_warped_image_data() {
        let definition = MaskDefinition {
            id: "mask_range".to_string(),
            name: "Range".to_string(),
            visible: true,
            invert: false,
            blend_mode: "normal".to_string(),
            opacity: 100.0,
            adjustments: serde_json::json!({}),
            sub_masks: vec![SubMask {
                id: "mask_range_luma".to_string(),
                mask_type: "luminance_range".to_string(),
                visible: true,
                invert: false,
                opacity: 100.0,
                mode: SubMaskMode::Additive,
                parameters: serde_json::json!({
                    "minLuma": 0.2,
                    "maxLuma": 0.8,
                    "feather": 0.25
                }),
            }],
        };

        assert!(definition.requires_warped_image());
    }

    #[test]
    fn luminance_range_bitmap_uses_rec709_luma() {
        let mut image = RgbaImage::new(3, 1);
        image.put_pixel(0, 0, Rgba([8, 8, 8, 255]));
        image.put_pixel(1, 0, Rgba([128, 128, 128, 255]));
        image.put_pixel(2, 0, Rgba([245, 245, 245, 255]));
        let warped = DynamicImage::ImageRgba8(image);
        let params = serde_json::json!({
            "minLuma": 0.2,
            "maxLuma": 0.8,
            "feather": 0.1
        });

        let mask = generate_luminance_range_bitmap(&params, 3, 1, 1.0, (0.0, 0.0), Some(&warped))
            .expect("range mask should render from warped image");

        assert_eq!(mask.get_pixel(0, 0)[0], 0);
        assert_eq!(mask.get_pixel(1, 0)[0], 255);
        assert_eq!(mask.get_pixel(2, 0)[0], 0);
    }

    #[test]
    fn color_range_bitmap_uses_hsv_hue_and_luma_gates() {
        let mut image = RgbaImage::new(4, 1);
        image.put_pixel(0, 0, Rgba([240, 16, 16, 255]));
        image.put_pixel(1, 0, Rgba([240, 154, 16, 255]));
        image.put_pixel(2, 0, Rgba([16, 48, 240, 255]));
        image.put_pixel(3, 0, Rgba([28, 28, 28, 255]));
        let warped = DynamicImage::ImageRgba8(image);
        let params = serde_json::json!({
            "centerHueDegrees": 0,
            "hueToleranceDegrees": 35,
            "feather": 0.35,
            "minLuma": 0.05,
            "maxLuma": 0.95,
            "minSaturation": 0.2,
            "maxSaturation": 1.0
        });

        let mask = generate_color_range_bitmap(&params, 4, 1, 1.0, (0.0, 0.0), Some(&warped))
            .expect("range mask should render from warped image");

        assert_eq!(mask.get_pixel(0, 0)[0], 255);
        assert_eq!(mask.get_pixel(1, 0)[0], 0);
        assert_eq!(mask.get_pixel(2, 0)[0], 0);
        assert_eq!(mask.get_pixel(3, 0)[0], 0);
    }

    #[test]
    fn grayscale_morphology_handles_edge_dimensions() {
        let mut mask = GrayImage::new(1, 3);
        mask.put_pixel(0, 1, Luma([255]));

        let dilated = grayscale_dilate(&mask, 1);
        assert_eq!(dilated.get_pixel(0, 0)[0], 255);
        assert_eq!(dilated.get_pixel(0, 1)[0], 255);
        assert_eq!(dilated.get_pixel(0, 2)[0], 255);

        let eroded = grayscale_erode(&dilated, 1);
        assert_eq!(eroded.get_pixel(0, 0)[0], 255);
        assert_eq!(eroded.get_pixel(0, 1)[0], 255);
        assert_eq!(eroded.get_pixel(0, 2)[0], 255);

        let empty = GrayImage::new(0, 0);
        assert_eq!(grayscale_dilate(&empty, 1).dimensions(), (0, 0));
    }

    #[test]
    fn mask_raster_brush_v1_is_deterministic_and_preserves_feather_flow_and_opacity() {
        let definition = MaskDefinition {
            id: "layer".into(),
            name: "Exposure".into(),
            visible: true,
            invert: false,
            blend_mode: "normal".into(),
            opacity: 100.0,
            adjustments: serde_json::json!({"exposure": 1.0}),
            sub_masks: vec![SubMask {
                id: "brush".into(),
                mask_type: "brush_v1".into(),
                visible: true,
                invert: false,
                opacity: 50.0,
                mode: SubMaskMode::Additive,
                parameters: serde_json::json!({"strokes": [{
                    "id": "stroke", "flow": 0.8, "hardness": 0.5, "radius": 0.2,
                    "points": [{"x": 0.25, "y": 0.5, "pressure": 0.5}, {"x": 0.75, "y": 0.5, "pressure": 1.0}]
                }]}),
            }],
        };

        let first = generate_mask_bitmap(&definition, 20, 10, 1.0, (0.0, 0.0), None).unwrap();
        let second = generate_mask_bitmap(&definition, 20, 10, 0.25, (99.0, 77.0), None).unwrap();
        assert_eq!(
            first.as_raw(),
            second.as_raw(),
            "normalized active-image coordinates must be scale/crop invariant"
        );
        assert_eq!(
            first.get_pixel(0, 0)[0],
            0,
            "outside pixels remain unchanged"
        );
        assert!(
            (45..=60).contains(&first.get_pixel(5, 5)[0]),
            "pressure, flow, and mask opacity multiply coverage"
        );
        assert!(
            (95..=105).contains(&first.get_pixel(14, 5)[0]),
            "full-pressure core preserves flow and opacity"
        );
        assert!(
            (1..100).contains(&first.get_pixel(14, 7)[0]),
            "hardness produces a feathered edge"
        );
    }
}
