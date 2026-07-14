//! Editor preview geometry service.
//!
//! This module owns the source-space sizing contract used by interactive
//! previews.  It deliberately has no application-state access: callers pass
//! immutable adjustment snapshots and receive a new snapshot, so geometry
//! work cannot hold an AppState lock while doing image/GPU work.

use super::Crop;
use crate::color::adjustment_fields;
use serde_json::Value;

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct PreviewGeometryService;

impl PreviewGeometryService {
    pub(crate) fn source_scale(
        source_width: u32,
        source_height: u32,
        adjustments: &Value,
        preview_dim: u32,
    ) -> f32 {
        let orientation_steps = adjustments[adjustment_fields::ORIENTATION_STEPS]
            .as_u64()
            .unwrap_or(0) as u8;
        let (oriented_width, oriented_height) = if orientation_steps % 2 == 1 {
            (source_height, source_width)
        } else {
            (source_width, source_height)
        };
        let target_long_edge =
            serde_json::from_value::<Crop>(adjustments[adjustment_fields::CROP].clone())
                .ok()
                .map(|crop| crop.width.max(crop.height) as f32)
                .filter(|dimension| dimension.is_finite() && *dimension > 0.0)
                .unwrap_or_else(|| oriented_width.max(oriented_height) as f32);

        if target_long_edge <= preview_dim.max(1) as f32 {
            1.0
        } else {
            preview_dim.max(1) as f32 / target_long_edge
        }
    }

    pub(crate) fn scale_adjustments(adjustments: &Value, source_scale: f32) -> Value {
        if source_scale >= 1.0 {
            return adjustments.clone();
        }
        let mut scaled = adjustments.clone();
        if let Some(crop_value) = scaled.get_mut(adjustment_fields::CROP)
            && let Ok(mut crop) = serde_json::from_value::<Crop>(crop_value.clone())
        {
            let scale = f64::from(source_scale);
            crop.x *= scale;
            crop.y *= scale;
            crop.width *= scale;
            crop.height *= scale;
            *crop_value = serde_json::to_value(crop).unwrap_or(Value::Null);
        }
        scaled
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn crop_aware_source_scale_is_orientation_and_preview_invariant() {
        let landscape = json!({
            "crop": {"x": 400.0, "y": 300.0, "width": 200.0, "height": 100.0},
            "orientationSteps": 0,
        });
        let portrait = json!({
            "crop": {"x": 300.0, "y": 400.0, "width": 100.0, "height": 200.0},
            "orientationSteps": 1,
        });
        assert_eq!(
            PreviewGeometryService::source_scale(1000, 800, &landscape, 100),
            PreviewGeometryService::source_scale(800, 1000, &portrait, 100)
        );
    }

    #[test]
    fn scaling_adjustments_preserves_input_and_only_scales_crop() {
        let input = json!({
            "crop": {"x": 400.0, "y": 200.0, "width": 800.0, "height": 600.0},
            "exposure": 1.25,
        });
        let scaled = PreviewGeometryService::scale_adjustments(&input, 0.5);
        assert_eq!(input["exposure"], 1.25);
        assert_eq!(scaled["exposure"], 1.25);
        assert_eq!(scaled["crop"]["x"], 200.0);
        assert_eq!(scaled["crop"]["width"], 400.0);
    }
}
