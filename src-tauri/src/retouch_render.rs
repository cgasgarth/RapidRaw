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

pub(crate) fn apply_clone_retouch_layers<'a>(
    image: &'a DynamicImage,
    adjustments: &Value,
    mask_bitmaps: &[GrayImage],
) -> Cow<'a, DynamicImage> {
    let layers: Vec<RetouchLayer> = adjustments
        .get("masks")
        .and_then(|masks| serde_json::from_value(masks.clone()).ok())
        .unwrap_or_default();

    let retouch_layers: Vec<(usize, &RetouchLayer, &RetouchCloneSource)> = layers
        .iter()
        .enumerate()
        .filter_map(|(index, layer)| {
            let clone_source = layer.retouch_clone_source.as_ref()?;
            if !matches!(
                clone_source.retouch_mode.as_deref().unwrap_or("clone"),
                "clone" | "heal"
            ) {
                return None;
            }
            if !layer.visible || normalized_opacity(layer.opacity) <= 0.0 {
                return None;
            }
            Some((index, layer, clone_source))
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
    for (mask_index, layer, clone_source) in retouch_layers {
        let snapshot = output.clone();
        let layer_opacity = normalized_opacity(layer.opacity);
        let mask = mask_bitmaps.get(mask_index);
        let heal_anchors = if clone_source.retouch_mode.as_deref() == Some("heal") {
            heal_anchor_colors(&snapshot, width, height, clone_source)
        } else {
            None
        };

        for y in 0..height {
            for x in 0..width {
                let index = (y * width + x) as usize;
                let alpha = layer_opacity
                    * mask_alpha(mask, x, y)
                    * retouch_alpha(index, width, height, clone_source);
                if alpha <= 0.0 {
                    continue;
                }

                let Some(source_point) = clone_sample_point(index, width, height, clone_source)
                else {
                    continue;
                };
                let Some(source) = sample_bilinear(&snapshot, source_point.0, source_point.1)
                else {
                    continue;
                };
                let source = heal_anchors.map_or(source, |(source_anchor, target_anchor)| {
                    heal_rgba(source, source_anchor, target_anchor)
                });
                let base = output.get_pixel(x, y);
                output.put_pixel(x, y, blend_rgba(base, source, alpha));
            }
        }
    }

    Cow::Owned(DynamicImage::ImageRgba32F(output))
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

fn clone_sample_point(
    target_index: usize,
    width: u32,
    height: u32,
    clone_source: &RetouchCloneSource,
) -> Option<(f32, f32)> {
    let (source_x, source_y) = normalized_point_to_pixel(&clone_source.source_point, width, height);
    let (target_x, target_y) = normalized_point_to_pixel(&clone_source.target_point, width, height);
    let x = (target_index as u32 % width) as f32;
    let y = (target_index as u32 / width) as f32;
    let scale = clone_source.scale.max(0.1);
    let radians = (-clone_source.rotation_degrees).to_radians();
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
    height: u32,
    clone_source: &RetouchCloneSource,
) -> f32 {
    let Some(radius_px) = clone_source.radius_px else {
        return 1.0;
    };
    let radius_px = radius_px.max(0.0);
    if radius_px == 0.0 {
        return 0.0;
    }

    let (target_x, target_y) = normalized_point_to_pixel(&clone_source.target_point, width, height);
    let x = (target_index as u32 % width) as f32;
    let y = (target_index as u32 / width) as f32;
    let distance = (x - target_x).hypot(y - target_y);
    let feather_px = clone_source
        .feather_radius_px
        .unwrap_or(0.0)
        .max(0.0)
        .min(radius_px);
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

fn heal_anchor_colors(
    pixels: &ImageBuffer<Rgba<f32>, Vec<f32>>,
    width: u32,
    height: u32,
    clone_source: &RetouchCloneSource,
) -> Option<(Rgba<f32>, Rgba<f32>)> {
    let (target_x, target_y) = normalized_point_to_pixel(&clone_source.target_point, width, height);
    let target_index = (target_y as u32)
        .checked_mul(width)?
        .checked_add(target_x as u32)? as usize;
    let source_point = clone_sample_point(target_index, width, height, clone_source)?;
    let source_anchor = sample_bilinear(pixels, source_point.0, source_point.1)?;
    let target_anchor = sample_bilinear(pixels, target_x, target_y)?;

    Some((source_anchor, target_anchor))
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
    use image::{DynamicImage, ImageBuffer, Rgba};
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
}
