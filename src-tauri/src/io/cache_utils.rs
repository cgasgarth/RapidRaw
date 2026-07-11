use crate::AppState;
use crate::raw_processing::RawDevelopmentReport;
use crate::render_caches::RenderCaches;
use crate::source_revision::{DecodedImageKey, SourceRevision};
use image::DynamicImage;
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use crate::adjustment_fields;

type DecodedImageCacheEntry = (
    DecodedImageKey,
    Arc<DynamicImage>,
    HashMap<String, String>,
    Option<RawDevelopmentReport>,
);
type DecodedImageCacheValue = (
    Arc<DynamicImage>,
    HashMap<String, String>,
    Option<RawDevelopmentReport>,
);

pub fn calculate_geometry_hash(adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();

    if let Some(patches) = adjustments.get(adjustment_fields::AI_PATCHES) {
        patches.to_string().hash(&mut hasher);
    }

    adjustments[adjustment_fields::ORIENTATION_STEPS]
        .as_u64()
        .hash(&mut hasher);

    for key in adjustment_fields::GEOMETRY_KEYS {
        if let Some(val) = adjustments.get(key) {
            key.hash(&mut hasher);
            val.to_string().hash(&mut hasher);
        }
    }

    hasher.finish()
}

pub fn calculate_visual_hash(path: &str, adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);

    if let Some(obj) = adjustments.as_object() {
        for (key, value) in obj {
            if adjustment_fields::GEOMETRY_KEYS.contains(&key.as_str()) {
                continue;
            }

            match key.as_str() {
                key if adjustment_fields::TRANSFORM_HASH_KEYS.contains(&key) => (),
                _ => {
                    key.hash(&mut hasher);
                    value.to_string().hash(&mut hasher);
                }
            }
        }
    }

    hasher.finish()
}

pub fn calculate_transform_hash(adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();

    let orientation_steps = adjustments[adjustment_fields::ORIENTATION_STEPS]
        .as_u64()
        .unwrap_or(0);
    orientation_steps.hash(&mut hasher);

    let rotation = adjustments[adjustment_fields::ROTATION]
        .as_f64()
        .unwrap_or(0.0);
    (rotation.to_bits()).hash(&mut hasher);

    let flip_h = adjustments[adjustment_fields::FLIP_HORIZONTAL]
        .as_bool()
        .unwrap_or(false);
    flip_h.hash(&mut hasher);

    let flip_v = adjustments[adjustment_fields::FLIP_VERTICAL]
        .as_bool()
        .unwrap_or(false);
    flip_v.hash(&mut hasher);

    if let Some(crop_val) = adjustments.get(adjustment_fields::CROP)
        && !crop_val.is_null()
    {
        crop_val.to_string().hash(&mut hasher);
    }

    for key in adjustment_fields::CPU_COLOR_RENDER_HASH_KEYS {
        if let Some(value) = adjustments.get(key) {
            key.hash(&mut hasher);
            value.to_string().hash(&mut hasher);
        }
    }
    adjustments
        .get("sectionVisibility")
        .and_then(|visibility| visibility.get("color"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true)
        .hash(&mut hasher);

    for key in adjustment_fields::GEOMETRY_KEYS {
        if let Some(val) = adjustments.get(key) {
            key.hash(&mut hasher);
            val.to_string().hash(&mut hasher);
        }
    }

    if let Some(patches_val) = adjustments.get(adjustment_fields::AI_PATCHES)
        && let Some(patches_arr) = patches_val.as_array()
    {
        patches_arr.len().hash(&mut hasher);

        for patch in patches_arr {
            if let Some(id) = patch.get(adjustment_fields::ID).and_then(|v| v.as_str()) {
                id.hash(&mut hasher);
            }

            let is_visible = patch
                .get(adjustment_fields::VISIBLE)
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            is_visible.hash(&mut hasher);

            if let Some(patch_data) = patch.get(adjustment_fields::PATCH_DATA) {
                let color_len = patch_data
                    .get(adjustment_fields::PATCH_DATA_COLOR)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .len();
                color_len.hash(&mut hasher);

                let mask_len = patch_data
                    .get(adjustment_fields::PATCH_DATA_MASK)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .len();
                mask_len.hash(&mut hasher);
            } else {
                let data_len = patch
                    .get(adjustment_fields::PATCH_DATA_BASE64)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .len();
                data_len.hash(&mut hasher);
            }

            if let Some(sub_masks_val) = patch.get(adjustment_fields::SUB_MASKS) {
                sub_masks_val.to_string().hash(&mut hasher);
            }

            let invert = patch
                .get(adjustment_fields::INVERT)
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            invert.hash(&mut hasher);
        }
    }

    hasher.finish()
}

pub fn calculate_full_job_hash(path: &str, adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    adjustments.to_string().hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::calculate_transform_hash;

    #[test]
    fn color_mixer_changes_invalidate_the_transformed_preview_cache() {
        let base = json!({
            "colorBalanceRgb": {
                "enabled": true,
                "preserveLuminance": true,
                "shadows": { "red": 0, "green": 0, "blue": 0 },
                "midtones": { "red": 0, "green": 0, "blue": 0 },
                "highlights": { "red": 0, "green": 0, "blue": 0 }
            },
            "channelMixer": { "enabled": false },
            "blackWhiteMixer": { "enabled": false },
            "sectionVisibility": { "color": true }
        });
        let mut updated = base.clone();
        updated["colorBalanceRgb"]["midtones"]["red"] = json!(80);

        assert_ne!(
            calculate_transform_hash(&base),
            calculate_transform_hash(&updated),
            "a native color edit must rebuild the preview and zoom source image"
        );

        let mut hidden = base.clone();
        hidden["sectionVisibility"]["color"] = json!(false);
        assert_ne!(
            calculate_transform_hash(&base),
            calculate_transform_hash(&hidden),
            "hiding the color section must invalidate baked mixer pixels"
        );
    }
}

pub struct DecodedImageCache {
    capacity: usize,
    items: Vec<DecodedImageCacheEntry>,
}

impl DecodedImageCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            items: Vec::with_capacity(capacity),
        }
    }

    pub fn set_capacity(&mut self, capacity: usize) {
        self.capacity = capacity;
        while self.items.len() > self.capacity {
            self.items.remove(0);
        }
    }

    pub(crate) fn get(&mut self, key: &DecodedImageKey) -> Option<DecodedImageCacheValue> {
        if let Some(pos) = self
            .items
            .iter()
            .position(|(candidate, _, _, _)| candidate == key)
        {
            let item = self.items.remove(pos);
            let result = (item.1.clone(), item.2.clone(), item.3.clone());
            self.items.push(item);
            Some(result)
        } else {
            None
        }
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub(crate) fn insert(
        &mut self,
        key: DecodedImageKey,
        image: Arc<DynamicImage>,
        exif: HashMap<String, String>,
        raw_development_report: Option<RawDevelopmentReport>,
    ) {
        if let Some(pos) = self
            .items
            .iter()
            .position(|(candidate, _, _, _)| *candidate == key)
        {
            self.items.remove(pos);
        } else if self.items.len() >= self.capacity {
            self.items.remove(0);
        }
        self.items.push((key, image, exif, raw_development_report));
    }

    pub(crate) fn contains_revision(&self, revision: &SourceRevision) -> bool {
        self.items
            .iter()
            .any(|(key, _, _, _)| &key.source_revision == revision)
    }
}

#[tauri::command]
pub fn clear_image_caches(state: tauri::State<AppState>) {
    RenderCaches::new(state.inner()).clear_image_caches();
}

#[tauri::command]
pub fn clear_session_caches(state: tauri::State<AppState>) {
    RenderCaches::new(state.inner()).clear_session_caches();
}
