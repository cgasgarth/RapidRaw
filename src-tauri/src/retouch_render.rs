use std::borrow::Cow;

use image::{DynamicImage, GenericImageView, GrayImage, ImageBuffer, Rgba};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetouchLayer {
    #[serde(default = "default_layer_opacity")]
    opacity: f32,
    #[serde(default)]
    retouch_clone_source: Option<RetouchCloneSource>,
    #[serde(default)]
    retouch_remove_source: Option<RetouchRemoveSource>,
    #[serde(default = "default_visible")]
    visible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetouchCloneSource {
    #[serde(default)]
    feather_radius_px: Option<f32>,
    #[serde(default)]
    radius_px: Option<f32>,
    #[serde(default)]
    retouch_mode: Option<String>,
    rotation_degrees: f32,
    scale: f32,
    source_point: RetouchPoint,
    target_point: RetouchPoint,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetouchRemoveSource {
    #[serde(default)]
    feather_radius_px: Option<f32>,
    #[serde(default)]
    radius_px: Option<f32>,
    #[serde(default)]
    resolved_source_point: Option<RetouchPoint>,
}

#[derive(Debug, Deserialize)]
struct RetouchPoint {
    x: f32,
    y: f32,
}

fn default_layer_opacity() -> f32 {
    100.0
}

fn default_visible() -> bool {
    true
}

enum RetouchOperation<'a> {
    CloneOrHeal(&'a RetouchCloneSource),
    Remove(&'a RetouchRemoveSource),
}

pub(crate) fn apply_clone_retouch_layers<'a>(
    image: &'a DynamicImage,
    adjustments: &Value,
    mask_bitmaps: &[GrayImage],
) -> Cow<'a, DynamicImage> {
    let layers: Vec<RetouchLayer> = adjustments
        .get("masks")
        .and_then(|masks| serde_json::from_value(masks.clone()).ok())
        .unwrap_or_default();

    let retouch_layers: Vec<(usize, &RetouchLayer, RetouchOperation<'_>)> = layers
        .iter()
        .enumerate()
        .filter_map(|(index, layer)| {
            if !layer.visible || normalized_opacity(layer.opacity) <= 0.0 {
                return None;
            }
            if let Some(clone_source) = layer.retouch_clone_source.as_ref() {
                if !matches!(
                    clone_source.retouch_mode.as_deref().unwrap_or("clone"),
                    "clone" | "heal"
                ) {
                    return None;
                }
                return Some((index, layer, RetouchOperation::CloneOrHeal(clone_source)));
            }
            let remove_source = layer.retouch_remove_source.as_ref()?;
            remove_source.resolved_source_point.as_ref()?;
            Some((index, layer, RetouchOperation::Remove(remove_source)))
        })
        .collect();

    if retouch_layers.is_empty() {
        return Cow::Borrowed(image);
    }

    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Cow::Borrowed(image);
    }

    let mut output = image.to_rgba32f();
    for (mask_index, layer, operation) in retouch_layers {
        let snapshot = output.clone();
        let layer_opacity = normalized_opacity(layer.opacity);
        let mask = mask_bitmaps.get(mask_index);
        let remove_plan = match operation {
            RetouchOperation::CloneOrHeal(clone_source) => RetouchPlan::from_clone_source(
                &snapshot,
                width,
                height,
                clone_source,
                clone_source.retouch_mode.as_deref() == Some("heal"),
            ),
            RetouchOperation::Remove(remove_source) => {
                RetouchPlan::from_remove_source(&snapshot, width, height, mask, remove_source)
            }
        };
        let Some(retouch_plan) = remove_plan else {
            continue;
        };

        for y in 0..height {
            for x in 0..width {
                let index = (y * width + x) as usize;
                let alpha = layer_opacity
                    * mask_alpha(mask, x, y)
                    * retouch_alpha(
                        index,
                        width,
                        retouch_plan.target_point,
                        retouch_plan.radius_px,
                        retouch_plan.feather_radius_px,
                    );
                if alpha <= 0.0 {
                    continue;
                }

                let Some(source_point) = sample_point_for_plan(index, width, height, &retouch_plan)
                else {
                    continue;
                };
                let Some(source) = sample_bilinear(&snapshot, source_point.0, source_point.1)
                else {
                    continue;
                };
                let source =
                    retouch_plan
                        .heal_anchors
                        .map_or(source, |(source_anchor, target_anchor)| {
                            heal_rgba(source, source_anchor, target_anchor)
                        });
                let base = output.get_pixel(x, y);
                output.put_pixel(x, y, blend_rgba(base, source, alpha));
            }
        }
    }

    Cow::Owned(DynamicImage::ImageRgba32F(output))
}

struct RetouchPlan {
    feather_radius_px: Option<f32>,
    heal_anchors: Option<(Rgba<f32>, Rgba<f32>)>,
    radius_px: Option<f32>,
    rotation_degrees: f32,
    scale: f32,
    source_point: (f32, f32),
    target_point: (f32, f32),
}

impl RetouchPlan {
    fn from_clone_source(
        pixels: &ImageBuffer<Rgba<f32>, Vec<f32>>,
        width: u32,
        height: u32,
        clone_source: &RetouchCloneSource,
        should_heal: bool,
    ) -> Option<Self> {
        let source_point = normalized_point_to_pixel(&clone_source.source_point, width, height);
        let target_point = normalized_point_to_pixel(&clone_source.target_point, width, height);
        let heal_anchors = if should_heal {
            let source_anchor = sample_bilinear(pixels, source_point.0, source_point.1)?;
            let target_anchor = sample_bilinear(pixels, target_point.0, target_point.1)?;
            Some((source_anchor, target_anchor))
        } else {
            None
        };

        Some(Self {
            feather_radius_px: clone_source.feather_radius_px,
            heal_anchors,
            radius_px: clone_source.radius_px,
            rotation_degrees: clone_source.rotation_degrees,
            scale: clone_source.scale,
            source_point,
            target_point,
        })
    }

    fn from_remove_source(
        pixels: &ImageBuffer<Rgba<f32>, Vec<f32>>,
        width: u32,
        height: u32,
        mask: Option<&GrayImage>,
        remove_source: &RetouchRemoveSource,
    ) -> Option<Self> {
        let source_point =
            normalized_point_to_pixel(remove_source.resolved_source_point.as_ref()?, width, height);
        let target_point = target_center_from_mask(mask?, width, height)?;
        let source_anchor = sample_bilinear(pixels, source_point.0, source_point.1)?;
        let target_anchor = sample_bilinear(pixels, target_point.0, target_point.1)?;

        Some(Self {
            feather_radius_px: remove_source.feather_radius_px,
            heal_anchors: Some((source_anchor, target_anchor)),
            radius_px: remove_source.radius_px,
            rotation_degrees: 0.0,
            scale: 1.0,
            source_point,
            target_point,
        })
    }
}

fn normalized_opacity(opacity: f32) -> f32 {
    if opacity > 1.0 {
        (opacity / 100.0).clamp(0.0, 1.0)
    } else {
        opacity.clamp(0.0, 1.0)
    }
}

fn mask_alpha(mask: Option<&GrayImage>, x: u32, y: u32) -> f32 {
    mask.and_then(|bitmap| bitmap.get_pixel_checked(x, y))
        .map_or(1.0, |pixel| f32::from(pixel[0]) / 255.0)
}

fn normalized_point_to_pixel(point: &RetouchPoint, width: u32, height: u32) -> (f32, f32) {
    (
        (point.x.clamp(0.0, 1.0) * (width.saturating_sub(1)) as f32).round(),
        (point.y.clamp(0.0, 1.0) * (height.saturating_sub(1)) as f32).round(),
    )
}

fn target_center_from_mask(mask: &GrayImage, width: u32, height: u32) -> Option<(f32, f32)> {
    let mut weight = 0.0_f32;
    let mut sum_x = 0.0_f32;
    let mut sum_y = 0.0_f32;
    for y in 0..height.min(mask.height()) {
        for x in 0..width.min(mask.width()) {
            let alpha = f32::from(mask.get_pixel(x, y)[0]) / 255.0;
            if alpha <= 0.01 {
                continue;
            }
            weight += alpha;
            sum_x += x as f32 * alpha;
            sum_y += y as f32 * alpha;
        }
    }

    (weight > 0.0).then_some((sum_x / weight, sum_y / weight))
}

fn sample_point_for_plan(
    target_index: usize,
    width: u32,
    height: u32,
    plan: &RetouchPlan,
) -> Option<(f32, f32)> {
    let (source_x, source_y) = plan.source_point;
    let (target_x, target_y) = plan.target_point;
    let x = (target_index as u32 % width) as f32;
    let y = (target_index as u32 / width) as f32;
    let scale = plan.scale.max(0.1);
    let radians = (-plan.rotation_degrees).to_radians();
    let cos = radians.cos();
    let sin = radians.sin();
    let target_offset_x = (x - target_x) / scale;
    let target_offset_y = (y - target_y) / scale;
    let sample_x = source_x + target_offset_x * cos - target_offset_y * sin;
    let sample_y = source_y + target_offset_x * sin + target_offset_y * cos;

    if sample_x < 0.0 || sample_x >= width as f32 || sample_y < 0.0 || sample_y >= height as f32 {
        None
    } else {
        Some((sample_x, sample_y))
    }
}

fn retouch_alpha(
    target_index: usize,
    width: u32,
    target_point: (f32, f32),
    radius_px: Option<f32>,
    feather_radius_px: Option<f32>,
) -> f32 {
    let Some(radius_px) = radius_px else {
        return 1.0;
    };
    let radius_px = radius_px.max(0.0);
    if radius_px == 0.0 {
        return 0.0;
    }

    let (target_x, target_y) = target_point;
    let x = (target_index as u32 % width) as f32;
    let y = (target_index as u32 / width) as f32;
    let distance = (x - target_x).hypot(y - target_y);
    let feather_px = feather_radius_px.unwrap_or(0.0).max(0.0).min(radius_px);
    let solid_radius = radius_px - feather_px;

    if distance <= solid_radius {
        1.0
    } else if distance >= radius_px {
        0.0
    } else {
        ((radius_px - distance) / feather_px.max(1.0)).clamp(0.0, 1.0)
    }
}

fn sample_bilinear(pixels: &ImageBuffer<Rgba<f32>, Vec<f32>>, x: f32, y: f32) -> Option<Rgba<f32>> {
    let width = pixels.width();
    let height = pixels.height();
    if x < 0.0
        || x > width.saturating_sub(1) as f32
        || y < 0.0
        || y > height.saturating_sub(1) as f32
    {
        return None;
    }

    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let top_left = pixels.get_pixel(x0, y0);
    let top_right = pixels.get_pixel(x1, y0);
    let bottom_left = pixels.get_pixel(x0, y1);
    let bottom_right = pixels.get_pixel(x1, y1);
    let mut channels = [0.0_f32; 4];

    for channel in 0..4 {
        channels[channel] = top_left[channel] * (1.0 - tx) * (1.0 - ty)
            + top_right[channel] * tx * (1.0 - ty)
            + bottom_left[channel] * (1.0 - tx) * ty
            + bottom_right[channel] * tx * ty;
    }

    Some(Rgba(channels))
}

fn heal_rgba(source: Rgba<f32>, source_anchor: Rgba<f32>, target_anchor: Rgba<f32>) -> Rgba<f32> {
    Rgba([
        (source[0] + target_anchor[0] - source_anchor[0]).clamp(0.0, 1.0),
        (source[1] + target_anchor[1] - source_anchor[1]).clamp(0.0, 1.0),
        (source[2] + target_anchor[2] - source_anchor[2]).clamp(0.0, 1.0),
        source[3],
    ])
}

fn blend_rgba(base: &Rgba<f32>, source: Rgba<f32>, alpha: f32) -> Rgba<f32> {
    let alpha = alpha.clamp(0.0, 1.0);
    Rgba([
        base[0] * (1.0 - alpha) + source[0] * alpha,
        base[1] * (1.0 - alpha) + source[1] * alpha,
        base[2] * (1.0 - alpha) + source[2] * alpha,
        base[3],
    ])
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, GrayImage, ImageBuffer, Luma, Rgba};
    use serde_json::json;

    use super::apply_clone_retouch_layers;

    #[test]
    fn clone_retouch_samples_source_into_target_region() {
        let image = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(5, 3, |x, y| {
            Rgba([x as f32 / 10.0, y as f32 / 10.0, 0.0, 1.0])
        }));
        let adjustments = json!({
            "masks": [{
                "id": "clone-layer",
                "name": "Clone",
                "visible": true,
                "opacity": 100,
                "invert": false,
                "adjustments": {},
                "retouchCloneSource": {
                    "retouchMode": "clone",
                    "sourcePoint": { "x": 0.0, "y": 0.5 },
                    "targetPoint": { "x": 1.0, "y": 0.5 },
                    "radiusPx": 1.5,
                    "featherRadiusPx": 0,
                    "scale": 1,
                    "rotationDegrees": 0
                },
                "subMasks": []
            }]
        });

        let rendered = apply_clone_retouch_layers(&image, &adjustments, &[])
            .as_ref()
            .to_rgba32f();

        assert_eq!(rendered.get_pixel(4, 1)[0], 0.0);
        assert_eq!(rendered.get_pixel(4, 1)[1], 0.1);
        assert_eq!(rendered.get_pixel(0, 1)[0], 0.0);
    }

    #[test]
    fn heal_retouch_transfers_target_anchor_color() {
        let image = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(5, 3, |x, y| {
            if x == 0 && y == 1 {
                Rgba([0.2, 0.2, 0.2, 1.0])
            } else if x == 4 && y == 1 {
                Rgba([0.7, 0.6, 0.5, 1.0])
            } else {
                Rgba([0.1, 0.1, 0.1, 1.0])
            }
        }));
        let adjustments = json!({
            "masks": [{
                "id": "heal-layer",
                "name": "Heal",
                "visible": true,
                "opacity": 100,
                "invert": false,
                "adjustments": {},
                "retouchCloneSource": {
                    "retouchMode": "heal",
                    "sourcePoint": { "x": 0.0, "y": 0.5 },
                    "targetPoint": { "x": 1.0, "y": 0.5 },
                    "radiusPx": 1.5,
                    "featherRadiusPx": 0,
                    "scale": 1,
                    "rotationDegrees": 0
                },
                "subMasks": []
            }]
        });

        let rendered = apply_clone_retouch_layers(&image, &adjustments, &[])
            .as_ref()
            .to_rgba32f();
        let healed = rendered.get_pixel(4, 1);

        assert_eq!(healed[0], 0.7);
        assert_eq!(healed[1], 0.6);
        assert_eq!(healed[2], 0.5);
    }

    #[test]
    fn remove_retouch_uses_resolved_source_and_target_mask_center() {
        let image = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(5, 3, |x, y| {
            if x == 0 && y == 1 {
                Rgba([0.2, 0.2, 0.2, 1.0])
            } else if x == 4 && y == 1 {
                Rgba([0.7, 0.6, 0.5, 1.0])
            } else {
                Rgba([0.1, 0.1, 0.1, 1.0])
            }
        }));
        let mut mask = GrayImage::from_pixel(5, 3, Luma([0]));
        mask.put_pixel(4, 1, Luma([255]));
        let adjustments = json!({
            "masks": [{
                "id": "remove-layer",
                "name": "Remove",
                "visible": true,
                "opacity": 100,
                "invert": false,
                "adjustments": {},
                "retouchRemoveSource": {
                    "generator": "local_patch_fill_v1",
                    "generatorVersion": 1,
                    "resolvedSourcePoint": { "x": 0.0, "y": 0.5 },
                    "targetMaskId": "remove-target",
                    "radiusPx": 1.5,
                    "featherRadiusPx": 0,
                    "searchRadiusMultiplier": 2,
                    "seed": 7,
                    "status": "ready"
                },
                "subMasks": []
            }]
        });

        let rendered = apply_clone_retouch_layers(&image, &adjustments, &[mask])
            .as_ref()
            .to_rgba32f();
        let removed = rendered.get_pixel(4, 1);

        assert_eq!(removed[0], 0.7);
        assert_eq!(removed[1], 0.6);
        assert_eq!(removed[2], 0.5);
    }
}
