use image::DynamicImage;
use std::borrow::Cow;
use std::collections::HashMap;

use crate::adjustment_fields;
use crate::app_state::AppState;
use crate::image_processing::{
    Crop, IntoCowImage, apply_coarse_rotation, apply_crop, apply_flip, apply_geometry_warp,
    apply_rotation,
};

pub fn hydrate_sub_masks(
    sub_masks: &mut Vec<serde_json::Value>,
    cache: &mut HashMap<String, serde_json::Value>,
) {
    for sub_mask in sub_masks {
        let id = sub_mask
            .get(adjustment_fields::ID)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        if id.is_empty() {
            continue;
        }

        if let Some(params) = sub_mask
            .get_mut("parameters")
            .and_then(|p| p.as_object_mut())
        {
            let keys_to_check = [
                adjustment_fields::MASK_DATA_BASE64_SNAKE,
                adjustment_fields::MASK_DATA_BASE64_CAMEL,
            ];
            for key in keys_to_check {
                if params.contains_key(key) {
                    let val = params.get(key).unwrap();
                    if !val.is_null() {
                        cache.insert(id.clone(), val.clone());
                    } else {
                        if let Some(cached_data) = cache.get(&id) {
                            params.insert(key.to_string(), cached_data.clone());
                        }
                    }
                }
            }
        }
    }
}

pub fn hydrate_adjustments(state: &tauri::State<AppState>, adjustments: &mut serde_json::Value) {
    let mut cache = state.patch_cache.lock().unwrap();

    if let Some(patches) = adjustments
        .get_mut(adjustment_fields::AI_PATCHES)
        .and_then(|v| v.as_array_mut())
    {
        for patch in patches {
            let id = patch
                .get(adjustment_fields::ID)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            if !id.is_empty() {
                let has_data = patch
                    .get(adjustment_fields::PATCH_DATA)
                    .is_some_and(|v| !v.is_null());

                if has_data {
                    if let Some(data) = patch.get(adjustment_fields::PATCH_DATA) {
                        cache.insert(id.clone(), data.clone());
                    }
                } else {
                    if let Some(cached_data) = cache.get(&id) {
                        patch[adjustment_fields::PATCH_DATA] = cached_data.clone();
                    }
                }
            }

            if let Some(sub_masks) = patch
                .get_mut(adjustment_fields::SUB_MASKS)
                .and_then(|v| v.as_array_mut())
            {
                hydrate_sub_masks(sub_masks, &mut cache);
            }
        }
    }

    if let Some(masks) = adjustments
        .get_mut(adjustment_fields::MASKS)
        .and_then(|v| v.as_array_mut())
    {
        for mask_container in masks {
            if let Some(sub_masks) = mask_container
                .get_mut(adjustment_fields::SUB_MASKS)
                .and_then(|v| v.as_array_mut())
            {
                hydrate_sub_masks(sub_masks, &mut cache);
            }
        }
    }
}

pub fn apply_all_transformations<'a, I: IntoCowImage<'a>>(
    image: I,
    adjustments: &serde_json::Value,
) -> (Cow<'a, DynamicImage>, (f32, f32)) {
    let start_time = std::time::Instant::now();
    let image = image.into_cow();
    let warped_image = apply_geometry_warp(image, adjustments);

    let orientation_steps = adjustments[adjustment_fields::ORIENTATION_STEPS]
        .as_u64()
        .unwrap_or(0) as u8;
    let rotation_degrees = adjustments[adjustment_fields::ROTATION]
        .as_f64()
        .unwrap_or(0.0) as f32;
    let flip_horizontal = adjustments[adjustment_fields::FLIP_HORIZONTAL]
        .as_bool()
        .unwrap_or(false);
    let flip_vertical = adjustments[adjustment_fields::FLIP_VERTICAL]
        .as_bool()
        .unwrap_or(false);

    let coarse_rotated_image = apply_coarse_rotation(warped_image, orientation_steps);
    let flipped_image = apply_flip(coarse_rotated_image, flip_horizontal, flip_vertical);
    let rotated_image = apply_rotation(flipped_image, rotation_degrees);

    let crop_data: Option<Crop> =
        serde_json::from_value(adjustments[adjustment_fields::CROP].clone()).ok();
    let crop_json = serde_json::to_value(crop_data).unwrap_or(serde_json::Value::Null);
    let cropped_image = apply_crop(rotated_image, &crop_json);

    let unscaled_crop_offset = crop_data.map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32));

    let total_duration = start_time.elapsed();
    log::info!("apply_all_transformations took {:.2?}", total_duration);

    (cropped_image, unscaled_crop_offset)
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, ImageBuffer, Rgba};
    use serde_json::json;

    use super::apply_all_transformations;

    #[test]
    fn shared_transform_path_keeps_color_mixers_for_the_render_stage() {
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            1,
            1,
            Rgba([0.68, 0.48, 0.34, 1.0]),
        ));
        let enabled = json!({
            "colorBalanceRgb": {
                "enabled": true,
                "preserveLuminance": false,
                "shadows": { "red": 0, "green": 0, "blue": 0 },
                "midtones": { "red": 100, "green": 0, "blue": 0 },
                "highlights": { "red": 0, "green": 0, "blue": 0 }
            },
            "channelMixer": {
                "enabled": true,
                "preserveLuminance": false,
                "red": { "red": 0, "green": 100, "blue": 0, "constant": 0 },
                "green": { "red": 0, "green": 0, "blue": 100, "constant": 0 },
                "blue": { "red": 100, "green": 0, "blue": 0, "constant": 0 }
            },
            "blackWhiteMixer": {
                "enabled": true,
                "weights": {
                    "reds": 100,
                    "oranges": 0,
                    "yellows": 0,
                    "greens": 0,
                    "aquas": 0,
                    "blues": 0,
                    "purples": 0,
                    "magentas": 0
                }
            }
        });

        let (enabled_output, _) = apply_all_transformations(&source, &enabled);

        assert_eq!(
            enabled_output.as_ref().to_rgba32f().into_raw(),
            source.to_rgba32f().into_raw(),
            "geometry transforms must not bake mixer edits into compare-original input"
        );
    }
}
