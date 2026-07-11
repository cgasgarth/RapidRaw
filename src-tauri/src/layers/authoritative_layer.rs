use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const ARTIFACTS_KEY: &str = "rawEngineArtifacts";
const SIDECARS_KEY: &str = "layerStackSidecars";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuthoritativeLayerPlan {
    pub graph_revision: String,
    pub layer_id: Option<String>,
    pub plan_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayerStackSidecar {
    graph_revision: String,
    #[serde(default)]
    last_command_id: Option<String>,
    layers: Vec<Layer>,
    schema_version: u32,
    source_image_path: String,
    storage: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Layer {
    adjustment_preset: String,
    #[serde(default)]
    adjustments: LayerAdjustments,
    blend_mode: String,
    id: String,
    mask_ids: Vec<String>,
    name: String,
    opacity: f32,
    #[serde(default)]
    retouch_clone_source: Option<Value>,
    #[serde(default)]
    retouch_remove_source: Option<Value>,
    #[serde(default)]
    sub_masks: Option<Vec<BrushMaskV1>>,
    visible: bool,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrushMaskV1 {
    coordinate_space: String,
    id: String,
    mode: String,
    opacity: f32,
    radius_unit: String,
    strokes: Vec<BrushStrokeV1>,
    #[serde(rename = "type")]
    mask_type: String,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrushStrokeV1 {
    flow: f32,
    hardness: f32,
    id: String,
    points: Vec<BrushPointV1>,
    radius: f32,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct BrushPointV1 {
    #[serde(default)]
    pressure: Option<f32>,
    x: f32,
    y: f32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayerAdjustments {
    #[serde(default)]
    tone_color: Option<ToneColor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToneColor {
    black_point: f32,
    clarity: f32,
    contrast: f32,
    exposure_ev: f32,
    highlights: f32,
    saturation: f32,
    shadows: f32,
    white_point: f32,
}

pub(crate) fn apply_authoritative_layer_stack(
    adjustments: &mut Value,
    image_path: &str,
) -> Result<Option<AuthoritativeLayerPlan>, String> {
    let Some(sidecars) = adjustments
        .get(ARTIFACTS_KEY)
        .and_then(|artifacts| artifacts.get(SIDECARS_KEY))
        .and_then(Value::as_array)
    else {
        return Ok(None);
    };

    if sidecars.is_empty() {
        return Ok(None);
    }

    let matching: Vec<&Value> = sidecars
        .iter()
        .filter(|sidecar| {
            sidecar
                .get("sourceImagePath")
                .and_then(Value::as_str)
                .is_some_and(|sidecar_path| source_paths_match(sidecar_path, image_path))
        })
        .collect();
    if matching.len() != 1 {
        return Err(
            "layer_authority_source_mismatch: expected exactly one sidecar for the current image"
                .into(),
        );
    }

    let sidecar: LayerStackSidecar = serde_json::from_value(matching[0].clone())
        .map_err(|error| format!("layer_authority_invalid_sidecar: {error}"))?;
    validate_sidecar(&sidecar, image_path)?;

    let plan_hash = hash_plan(matching[0]);
    let layer_id = sidecar.layers.first().map(|layer| layer.id.clone());
    let masks = sidecar
        .layers
        .first()
        .map(materialize_native_mask)
        .transpose()?;
    adjustments["masks"] = Value::Array(masks.into_iter().collect());
    adjustments["nativeLayerAuthority"] = json!({
        "graphRevision": sidecar.graph_revision,
        "layerId": layer_id,
        "planHash": plan_hash,
        "rendererVersion": 1,
    });

    Ok(Some(AuthoritativeLayerPlan {
        graph_revision: sidecar.graph_revision,
        layer_id,
        plan_hash,
    }))
}

fn validate_sidecar(sidecar: &LayerStackSidecar, image_path: &str) -> Result<(), String> {
    if sidecar.schema_version != 1 || sidecar.storage != "sidecar_artifact" {
        return Err(
            "layer_authority_unsupported_schema: expected schema v1 sidecar artifact".into(),
        );
    }
    if !source_paths_match(&sidecar.source_image_path, image_path) {
        return Err(
            "layer_authority_source_mismatch: sidecar source does not match render source".into(),
        );
    }
    if sidecar.graph_revision.trim().is_empty() {
        return Err("layer_authority_invalid_revision: graph revision is empty".into());
    }
    if sidecar.layers.len() > 1 {
        return Err(
            "layer_authority_unsupported_layer_count: at most one layer is supported".into(),
        );
    }
    if let Some(layer) = sidecar.layers.first() {
        if layer.id.trim().is_empty() || layer.name.trim().is_empty() {
            return Err("layer_authority_invalid_layer: layer id and name are required".into());
        }
        if layer.adjustment_preset != "empty_adjustment_layer_v1" {
            return Err("layer_authority_unsupported_preset: unsupported adjustment preset".into());
        }
        if layer.blend_mode != "normal" {
            return Err("layer_authority_unsupported_blend: only normal blend is supported".into());
        }
        if !layer.opacity.is_finite() || !(0.0..=1.0).contains(&layer.opacity) {
            return Err(
                "layer_authority_invalid_opacity: opacity must be finite and within 0..1".into(),
            );
        }
        validate_brush_mask(layer)?;
        if layer.retouch_clone_source.is_some() || layer.retouch_remove_source.is_some() {
            return Err(
                "layer_authority_unsupported_retouch: retouch state is not supported".into(),
            );
        }
        if let Some(tone) = &layer.adjustments.tone_color {
            let values = [
                tone.black_point,
                tone.clarity,
                tone.contrast,
                tone.exposure_ev,
                tone.highlights,
                tone.saturation,
                tone.shadows,
                tone.white_point,
            ];
            if values.iter().any(|value| !value.is_finite()) {
                return Err(
                    "layer_authority_non_finite_adjustment: tone values must be finite".into(),
                );
            }
            if tone.black_point != 0.0
                || tone.clarity != 0.0
                || tone.contrast != 0.0
                || tone.highlights != 0.0
                || tone.saturation != 0.0
                || tone.shadows != 0.0
                || tone.white_point != 0.0
            {
                return Err(
                    "layer_authority_unsupported_adjustment: only exposure is supported".into(),
                );
            }
            if !(-5.0..=5.0).contains(&tone.exposure_ev) {
                return Err(
                    "layer_authority_invalid_exposure: exposure must be within -5..5 EV".into(),
                );
            }
        }
    }
    let _ = &sidecar.last_command_id;
    Ok(())
}

fn validate_brush_mask(layer: &Layer) -> Result<(), String> {
    if layer.mask_ids.is_empty() && layer.sub_masks.as_ref().is_none_or(Vec::is_empty) {
        return Ok(());
    }
    let masks = layer.sub_masks.as_ref().ok_or_else(|| {
        "layer_authority_invalid_brush_mask: mask ids require persisted brush data".to_string()
    })?;
    if masks.len() != 1 || layer.mask_ids != [masks[0].id.as_str()] {
        return Err(
            "layer_authority_unsupported_mask_count: exactly one brush mask is supported".into(),
        );
    }
    let mask = &masks[0];
    if mask.mask_type != "brush_v1"
        || mask.coordinate_space != "oriented_active_image_normalized_v1"
        || mask.radius_unit != "normalized_max_dimension"
        || mask.mode != "add"
    {
        return Err("layer_authority_unsupported_mask: unsupported brush contract".into());
    }
    if !mask.opacity.is_finite() || !(0.0..=1.0).contains(&mask.opacity) || mask.strokes.is_empty()
    {
        return Err("layer_authority_invalid_brush_mask: invalid opacity or empty strokes".into());
    }
    for stroke in &mask.strokes {
        if stroke.points.is_empty()
            || !stroke.radius.is_finite()
            || !(0.0..=1.0).contains(&stroke.radius)
            || !stroke.flow.is_finite()
            || !(0.0..=1.0).contains(&stroke.flow)
            || !stroke.hardness.is_finite()
            || !(0.0..=1.0).contains(&stroke.hardness)
            || stroke.points.iter().any(|point| {
                !point.x.is_finite()
                    || !(0.0..=1.0).contains(&point.x)
                    || !point.y.is_finite()
                    || !(0.0..=1.0).contains(&point.y)
                    || point
                        .pressure
                        .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
            })
        {
            return Err("layer_authority_invalid_brush_mask: malformed stroke geometry".into());
        }
    }
    Ok(())
}

fn source_paths_match(sidecar_path: &str, render_path: &str) -> bool {
    if sidecar_path == render_path {
        return true;
    }
    let (sidecar_source, _) = crate::file_management::parse_virtual_path(sidecar_path);
    let (render_source, _) = crate::file_management::parse_virtual_path(render_path);
    sidecar_source == render_source
}

fn materialize_native_mask(layer: &Layer) -> Result<Value, String> {
    let tone = layer.adjustments.tone_color.as_ref();
    let exposure = tone.map_or(0.0, |tone| tone.exposure_ev);
    let sub_masks = if let Some(brush) = layer.sub_masks.as_ref().and_then(|masks| masks.first()) {
        vec![json!({
            "id": brush.id,
            "name": "Brush",
            "type": "brush_v1",
            "visible": true,
            "invert": false,
            "opacity": brush.opacity * 100.0,
            "mode": "additive",
            "parameters": { "strokes": brush.strokes }
        })]
    } else {
        vec![json!({
            "id": format!("{}_full_image", layer.id), "name": "Full image", "type": "all",
            "visible": true, "invert": false, "opacity": 100.0, "mode": "additive", "parameters": {}
        })]
    };
    Ok(json!({
        "id": layer.id,
        "name": layer.name,
        "visible": layer.visible,
        "invert": false,
        "blendMode": "normal",
        "opacity": layer.opacity * 100.0,
        "adjustments": {
            "exposure": exposure,
            "sectionVisibility": { "basic": true }
        },
        "subMasks": sub_masks
    }))
}

fn hash_plan(value: &Value) -> String {
    let digest = Sha256::digest(value.to_string().as_bytes());
    format!("native-layer-v1:{}", hex::encode(digest))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adjustments(layer: Value) -> Value {
        json!({
            "masks": [{"id": "transient-store-state"}],
            "rawEngineArtifacts": {
                "schemaVersion": 1,
                "layerStackSidecars": [{
                    "graphRevision": "graph_2",
                    "lastCommandId": "command_2",
                    "layers": [layer],
                    "schemaVersion": 1,
                    "sourceImagePath": "/fixture.CR3",
                    "storage": "sidecar_artifact"
                }]
            }
        })
    }

    fn layer(exposure: f64, opacity: f64) -> Value {
        json!({
            "adjustmentPreset": "empty_adjustment_layer_v1",
            "adjustments": {"toneColor": {
                "blackPoint": 0.0, "clarity": 0.0, "contrast": 0.0,
                "exposureEv": exposure, "highlights": 0.0, "saturation": 0.0,
                "shadows": 0.0, "whitePoint": 0.0
            }},
            "blendMode": "normal", "id": "layer_1", "maskIds": [],
            "name": "Exposure", "opacity": opacity, "visible": true
        })
    }

    #[test]
    fn layer_graph_persisted_sidecar_builds_layer_render_plan() {
        let mut value = adjustments(layer(1.25, 0.5));
        let plan = apply_authoritative_layer_stack(&mut value, "/fixture.CR3")
            .expect("supported plan")
            .expect("authoritative plan");
        assert_eq!(plan.graph_revision, "graph_2");
        assert_eq!(value["masks"][0]["id"], "layer_1");
        assert_eq!(value["masks"][0]["opacity"], 50.0);
        assert_eq!(value["masks"][0]["adjustments"]["exposure"], 1.25);
        assert_eq!(value["masks"][0]["subMasks"][0]["type"], "all");
        assert_eq!(value["nativeLayerAuthority"]["planHash"], plan.plan_hash);

        let parsed = crate::image_processing::get_all_adjustments_from_json(&value, true, None);
        assert_eq!(parsed.mask_count, 1);
        assert_eq!(parsed.mask_adjustments[0].exposure, 1.5625);
        let definition: crate::mask_generation::MaskDefinition =
            serde_json::from_value(value["masks"][0].clone()).expect("native mask definition");
        let bitmap =
            crate::mask_generation::generate_mask_bitmap(&definition, 4, 3, 1.0, (0.0, 0.0), None)
                .expect("full-image bitmap");
        assert!(
            bitmap
                .pixels()
                .all(|pixel| pixel[0] == 128 || pixel[0] == 127)
        );
    }

    #[test]
    fn layer_graph_rejects_unsupported_state_with_stable_codes() {
        let mut unsupported = adjustments({
            let mut value = layer(1.0, 1.0);
            value["blendMode"] = json!("multiply");
            value
        });
        let error = apply_authoritative_layer_stack(&mut unsupported, "/fixture.CR3")
            .expect_err("unsupported blend must block rendering");
        assert!(error.starts_with("layer_authority_unsupported_blend:"));

        let mut stale = adjustments(layer(1.0, 1.0));
        assert!(
            apply_authoritative_layer_stack(&mut stale, "/other.CR3")
                .expect_err("source mismatch must block rendering")
                .starts_with("layer_authority_source_mismatch:")
        );
    }

    #[test]
    fn layer_graph_absent_sidecar_preserves_legacy_rendering() {
        let mut value = json!({"masks": [{"id": "legacy"}]});
        assert_eq!(
            apply_authoritative_layer_stack(&mut value, "/fixture.CR3").unwrap(),
            None
        );
        assert_eq!(value["masks"][0]["id"], "legacy");
    }

    #[test]
    fn brush_mask_persisted_sidecar_materializes_native_raster_for_shared_render_path() {
        let mut brush_layer = layer(-1.0, 0.75);
        brush_layer["maskIds"] = json!(["brush_1"]);
        brush_layer["subMasks"] = json!([{
            "coordinateSpace": "oriented_active_image_normalized_v1",
            "id": "brush_1", "mode": "add", "opacity": 0.6,
            "radiusUnit": "normalized_max_dimension", "type": "brush_v1",
            "strokes": [{
                "flow": 1.0, "hardness": 0.5, "id": "stroke_1", "radius": 0.2,
                "points": [{"x": 0.2, "y": 0.5}, {"x": 0.8, "y": 0.5}]
            }]
        }]);
        let mut value = adjustments(brush_layer);

        let first = apply_authoritative_layer_stack(&mut value, "/fixture.CR3")
            .expect("supported brush plan")
            .expect("authoritative plan");
        assert_eq!(value["masks"][0]["subMasks"][0]["type"], "brush_v1");
        assert!(
            (value["masks"][0]["subMasks"][0]["opacity"]
                .as_f64()
                .unwrap()
                - 60.0)
                .abs()
                < 0.001
        );
        let definition: crate::mask_generation::MaskDefinition =
            serde_json::from_value(value["masks"][0].clone()).unwrap();
        let bitmap = crate::mask_generation::generate_mask_bitmap(
            &definition,
            32,
            16,
            1.0,
            (0.0, 0.0),
            None,
        )
        .unwrap();
        assert_eq!(bitmap.get_pixel(0, 0)[0], 0);
        assert!(bitmap.get_pixel(16, 8)[0] > 100);

        let mut reopened =
            adjustments(value["rawEngineArtifacts"]["layerStackSidecars"][0]["layers"][0].clone());
        let reopened_plan = apply_authoritative_layer_stack(&mut reopened, "/fixture.CR3")
            .unwrap()
            .unwrap();
        assert_eq!(first.plan_hash, reopened_plan.plan_hash);
        assert_eq!(value["masks"], reopened["masks"]);
    }
}
