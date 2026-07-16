#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod deblur_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod denoise_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod focus_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod hdr_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod layer_mask_real_raw_proof;
#[cfg(feature = "validation-harness")]
pub(crate) mod linear_gradient_mask_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod mask_refinement_full_image_output_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod panorama_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod retouch_clone_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod sr_real_raw_proof;

#[cfg(all(test, feature = "tauri-test"))]
pub(crate) fn current_document_from_mask_proof_fixture(
    fixture: &serde_json::Value,
) -> Result<crate::adjustments::edit_document_v2::CompiledCurrentEditDocument, String> {
    use serde_json::{Value, json};

    let mut document = crate::exif_processing::neutral_current_edit_document();
    let scene = &document["nodes"]["scene_global_color_tone"]["params"];
    let presence = &document["nodes"]["color_presence"]["params"];
    let curves = &document["nodes"]["scene_curve"]["params"];
    let detail = &document["nodes"]["detail_denoise_dehaze"]["params"];
    let creative = &document["nodes"]["display_creative"]["params"];
    let selective = &document["nodes"]["selective_color_mixer"]["params"];
    let grading = &document["nodes"]["perceptual_grading"]["params"];
    let tone_equalizer = &document["nodes"]["tone_equalizer"]["params"];
    let neutral_layer_adjustments = json!({
        "blacks": scene["blacks"],
        "brightness": scene["brightness"],
        "clarity": detail["clarity"],
        "colorGrading": grading["colorGrading"],
        "perceptualGradingV1": grading["perceptualGradingV1"],
        "colorNoiseReduction": detail["colorNoiseReduction"],
        "contrast": scene["contrast"],
        "curves": curves["curves"],
        "pointCurves": curves["pointCurves"],
        "parametricCurve": curves["parametricCurve"],
        "curveMode": curves["curveMode"],
        "dehaze": detail["dehaze"],
        "effectsEnabled": true,
        "exposure": scene["exposure"],
        "flareAmount": creative["flareAmount"],
        "glowAmount": creative["glowAmount"],
        "halationAmount": creative["halationAmount"],
        "highlights": scene["highlights"],
        "hue": presence["hue"],
        "hsl": selective["hsl"],
        "selectiveColorRangeControls": selective["selectiveColorRangeControls"],
        "lumaNoiseReduction": detail["lumaNoiseReduction"],
        "saturation": presence["saturation"],
        "shadows": scene["shadows"],
        "sharpness": detail["sharpness"],
        "sharpnessThreshold": detail["sharpnessThreshold"],
        "structure": detail["structure"],
        "temperature": 0,
        "tint": 0,
        "toneEqualizer": tone_equalizer["toneEqualizer"],
        "vibrance": presence["vibrance"],
        "whites": scene["whites"]
    });
    let layers = fixture
        .get("masks")
        .and_then(Value::as_array)
        .map(|layers| {
            layers
                .iter()
                .map(|layer| {
                    let mut adjustments = neutral_layer_adjustments.clone();
                    if let (Some(target), Some(source)) = (
                        adjustments.as_object_mut(),
                        layer.get("adjustments").and_then(Value::as_object),
                    ) {
                        for (key, value) in source {
                            if target.contains_key(key) {
                                target.insert(key.clone(), value.clone());
                            }
                        }
                    }
                    json!({
                        "adjustments": adjustments,
                        "blendMode": layer.get("blendMode").cloned().unwrap_or(Value::Null),
                        "editNodes": layer.get("editNodes").cloned().unwrap_or_else(|| json!({
                            "basic": {"enabled": true},
                            "color": {"enabled": true},
                            "curves": {"enabled": true},
                            "details": {"enabled": true}
                        })),
                        "editNodeSchemaVersion": 1,
                        "id": layer["id"],
                        "invert": layer.get("invert").cloned().unwrap_or_else(|| json!(false)),
                        "layerGroupId": Value::Null,
                        "layerGroupName": Value::Null,
                        "name": layer["name"],
                        "opacity": layer.get("opacity").cloned().unwrap_or_else(|| json!(100)),
                        "referenceMatchApplicationReceipt": Value::Null,
                        "retouchCloneSource": layer.get("retouchCloneSource").cloned().unwrap_or(Value::Null),
                        "retouchRemoveSource": layer.get("retouchRemoveSource").cloned().unwrap_or(Value::Null),
                        "subMasks": layer.get("subMasks").cloned().unwrap_or_else(|| json!([])),
                        "visible": layer.get("visible").cloned().unwrap_or_else(|| json!(true))
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    document["layers"] = json!({"masks": layers});
    document["nodes"]["layers"]["params"] = document["layers"].clone();
    serde_json::from_value::<crate::adjustments::edit_document_v2::EditDocumentV2>(document)
        .map_err(|error| format!("mask proof current document is invalid: {error}"))?
        .compile()
}
