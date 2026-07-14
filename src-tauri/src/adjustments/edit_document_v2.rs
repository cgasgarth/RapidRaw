use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Map, Value};

const EDIT_DOCUMENT_V2_SCHEMA_VERSION: u8 = 2;
const LEGACY_SOURCE_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
enum EditNodeTypeV2 {
    SceneGlobalColorTone,
    SceneCurve,
    DisplayCreative,
    DetailDenoiseDehaze,
    CameraInput,
    Geometry,
    Layers,
    SourceArtifacts,
}

impl EditNodeTypeV2 {
    fn contract(self) -> (&'static str, &'static str, u32) {
        match self {
            Self::Geometry => ("geometry", "legacy_pipeline_v1", 1),
            Self::SceneGlobalColorTone => ("scene_global_color_tone", "scene_referred_v2", 1),
            Self::SceneCurve => ("scene_curve", "scene_referred_v2", 1),
            Self::DisplayCreative => ("display_creative", "scene_referred_v2", 1),
            Self::DetailDenoiseDehaze => ("detail_denoise_dehaze", "scene_referred_v2", 1),
            Self::CameraInput => ("camera_input", "scene_referred_v2", 1),
            Self::Layers => ("layers", "scene_referred_v2", 1),
            Self::SourceArtifacts => ("source_artifacts", "scene_referred_v2", 1),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditNodeEnvelopeV2 {
    enabled: bool,
    implementation_version: u32,
    params: Map<String, Value>,
    process: String,
    #[serde(rename = "type")]
    node_type: EditNodeTypeV2,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneGlobalColorToneParamsV2 {
    blacks: f64,
    brightness: f64,
    contrast: f64,
    exposure: f64,
    highlights: f64,
    saturation: f64,
    shadows: f64,
    whites: f64,
}

impl SceneGlobalColorToneParamsV2 {
    fn compile(&self) -> Result<(), String> {
        validate_scene_tone_parameter("blacks", self.blacks, -100.0, 100.0)?;
        validate_scene_tone_parameter("brightness", self.brightness, -5.0, 5.0)?;
        validate_scene_tone_parameter("contrast", self.contrast, -100.0, 100.0)?;
        validate_scene_tone_parameter("exposure", self.exposure, -5.0, 5.0)?;
        validate_scene_tone_parameter("highlights", self.highlights, -100.0, 100.0)?;
        validate_scene_tone_parameter("saturation", self.saturation, -100.0, 100.0)?;
        validate_scene_tone_parameter("shadows", self.shadows, -100.0, 100.0)?;
        validate_scene_tone_parameter("whites", self.whites, -100.0, 100.0)?;
        Ok(())
    }
}

fn validate_scene_tone_parameter(
    field: &str,
    value: f64,
    minimum: f64,
    maximum: f64,
) -> Result<(), String> {
    if value.is_finite() && value >= minimum && value <= maximum {
        return Ok(());
    }
    Err(format!(
        "EditDocumentV2 node 'scene_global_color_tone' field '{field}' must be finite and within [{minimum}, {maximum}]"
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditDocumentMigrationReceiptV2 {
    defaulted: Vec<String>,
    disabled: Vec<String>,
    mapped: Vec<String>,
    quarantined: Vec<String>,
    source_schema_version: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EditDocumentV2 {
    extensions: Map<String, Value>,
    geometry: Map<String, Value>,
    graph_process: String,
    layers: Map<String, Value>,
    migration: Option<EditDocumentMigrationReceiptV2>,
    nodes: BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    provenance: Map<String, Value>,
    schema_version: u8,
    source_artifacts: Map<String, Value>,
}

impl EditDocumentV2 {
    pub(crate) fn into_render_adjustments(self) -> Result<Value, String> {
        self.validate_document_contract()?;
        let mut adjustments = match self.extensions.get("legacyAdjustments") {
            Some(Value::Object(legacy)) => legacy.clone(),
            Some(_) => {
                return Err(
                    "EditDocumentV2 extensions.legacyAdjustments must be an object".to_string(),
                );
            }
            None => Map::new(),
        };

        for (node_key, node) in &self.nodes {
            if let Some(conflicting_key) = node
                .params
                .keys()
                .find(|parameter| adjustments.contains_key(*parameter))
            {
                return Err(format!(
                    "EditDocumentV2 node '{}' conflicts with quarantined legacy field '{conflicting_key}'",
                    node_key.contract().0
                ));
            }
        }

        for (node_key, node) in self.nodes {
            validate_node_contract(node_key, &node)?;
            let compiled_params = compile_node_params(node_key, &node)?;
            if node.enabled {
                adjustments.extend(compiled_params);
            }
        }
        Ok(Value::Object(adjustments))
    }

    fn validate_document_contract(&self) -> Result<(), String> {
        if self.schema_version != EDIT_DOCUMENT_V2_SCHEMA_VERSION {
            return Err(format!(
                "Unsupported EditDocumentV2 schemaVersion: {}",
                self.schema_version
            ));
        }
        if self.graph_process != "scene_referred_v2" {
            return Err(format!(
                "Unsupported EditDocumentV2 graphProcess: {}",
                self.graph_process
            ));
        }
        if let Some(migration) = &self.migration {
            if migration.source_schema_version != LEGACY_SOURCE_SCHEMA_VERSION {
                return Err(format!(
                    "Unsupported EditDocumentV2 migration sourceSchemaVersion: {}",
                    migration.source_schema_version
                ));
            }
            let _ = (
                &migration.defaulted,
                &migration.disabled,
                &migration.mapped,
                &migration.quarantined,
            );
        }
        validate_explicit_domain(&self.nodes, EditNodeTypeV2::Geometry, &self.geometry)?;
        validate_explicit_domain(&self.nodes, EditNodeTypeV2::Layers, &self.layers)?;
        validate_explicit_domain(
            &self.nodes,
            EditNodeTypeV2::SourceArtifacts,
            &self.source_artifacts,
        )?;
        let _ = &self.provenance;
        Ok(())
    }
}

fn compile_node_params(
    node_key: EditNodeTypeV2,
    node: &EditNodeEnvelopeV2,
) -> Result<Map<String, Value>, String> {
    match node_key {
        EditNodeTypeV2::SceneGlobalColorTone => {
            let params = serde_json::from_value::<SceneGlobalColorToneParamsV2>(Value::Object(
                node.params.clone(),
            ))
            .map_err(|error| {
                format!("EditDocumentV2 node 'scene_global_color_tone' has invalid params: {error}")
            })?;
            params.compile()?;
            Ok(node.params.clone())
        }
        _ => Ok(node.params.clone()),
    }
}

fn validate_node_contract(
    node_key: EditNodeTypeV2,
    node: &EditNodeEnvelopeV2,
) -> Result<(), String> {
    let (node_name, process, implementation_version) = node_key.contract();
    if node.node_type != node_key {
        return Err(format!(
            "EditDocumentV2 node envelope type must match '{node_name}'"
        ));
    }
    if node.process != process {
        return Err(format!(
            "EditDocumentV2 node '{node_name}' has incompatible process '{}'",
            node.process
        ));
    }
    if node.implementation_version != implementation_version {
        return Err(format!(
            "EditDocumentV2 node '{node_name}' has unsupported implementationVersion {}",
            node.implementation_version
        ));
    }
    Ok(())
}

fn validate_explicit_domain(
    nodes: &BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    node_type: EditNodeTypeV2,
    domain: &Map<String, Value>,
) -> Result<(), String> {
    let Some(node) = nodes.get(&node_type) else {
        return Ok(());
    };
    if &node.params == domain {
        return Ok(());
    }
    Err(format!(
        "EditDocumentV2 {} domain disagrees with its node params",
        node_type.contract().0
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::super::parse::get_all_adjustments_from_json;
    use super::EditDocumentV2;

    fn document_with_legacy(legacy: Value) -> Value {
        json!({
            "extensions": { "legacyAdjustments": legacy },
            "geometry": {
                "aspectRatio": null,
                "crop": { "height": 80, "unit": "%", "width": 90, "x": 4, "y": 6 },
                "flipHorizontal": false,
                "flipVertical": true,
                "orientationSteps": 1,
                "rotation": 0.5
            },
            "graphProcess": "scene_referred_v2",
            "layers": { "masks": [] },
            "migration": {
                "defaulted": [],
                "disabled": [],
                "mapped": ["geometry.crop", "geometry.rotation", "layers.masks", "scene_global_color_tone.exposure"],
                "quarantined": ["vibrance"],
                "sourceSchemaVersion": 1
            },
            "nodes": {
                "scene_global_color_tone": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": {
                        "blacks": -4,
                        "brightness": 0.1,
                        "contrast": 18,
                        "exposure": 0.75,
                        "highlights": -22,
                        "saturation": 7,
                        "shadows": 14,
                        "whites": 9
                    },
                    "process": "scene_referred_v2",
                    "type": "scene_global_color_tone"
                },
                "scene_curve": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "toneCurve": [{ "x": 0, "y": 0 }, { "x": 255, "y": 250 }] },
                    "process": "scene_referred_v2",
                    "type": "scene_curve"
                },
                "display_creative": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "grainAmount": 12, "halationAmount": 3, "lutIntensity": 80 },
                    "process": "scene_referred_v2",
                    "type": "display_creative"
                },
                "detail_denoise_dehaze": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "clarity": 16, "dehaze": 8, "lumaNoiseReduction": 5, "sharpness": 24 },
                    "process": "scene_referred_v2",
                    "type": "detail_denoise_dehaze"
                },
                "camera_input": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "cameraProfile": "camera-standard", "temperature": 12, "tint": -3 },
                    "process": "scene_referred_v2",
                    "type": "camera_input"
                },
                "geometry": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": {
                        "aspectRatio": null,
                        "crop": { "height": 80, "unit": "%", "width": 90, "x": 4, "y": 6 },
                        "flipHorizontal": false,
                        "flipVertical": true,
                        "orientationSteps": 1,
                        "rotation": 0.5
                    },
                    "process": "legacy_pipeline_v1",
                    "type": "geometry"
                },
                "layers": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "masks": [] },
                    "process": "scene_referred_v2",
                    "type": "layers"
                },
                "source_artifacts": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "aiPatches": [] },
                    "process": "scene_referred_v2",
                    "type": "source_artifacts"
                }
            },
            "provenance": {},
            "schemaVersion": 2,
            "sourceArtifacts": { "aiPatches": [] }
        })
    }

    #[test]
    fn compiles_node_keyed_document_to_render_parity_adjustments() {
        let legacy = json!({
            "curves": {},
            "futureField": { "enabled": true },
            "rawEngineEditGraphVersion": 2,
            "sectionVisibility": { "basic": true, "color": true, "details": true, "effects": true },
            "toneMapper": "basic",
            "vibrance": 11
        });
        let document: EditDocumentV2 =
            serde_json::from_value(document_with_legacy(legacy)).expect("valid document");
        let compiled = document
            .into_render_adjustments()
            .expect("compiled document");

        let expected = json!({
            "aiPatches": [],
            "aspectRatio": null,
            "blacks": -4,
            "brightness": 0.1,
            "cameraProfile": "camera-standard",
            "clarity": 16,
            "contrast": 18,
            "crop": { "height": 80, "unit": "%", "width": 90, "x": 4, "y": 6 },
            "curves": {},
            "dehaze": 8,
            "exposure": 0.75,
            "flipHorizontal": false,
            "flipVertical": true,
            "futureField": { "enabled": true },
            "grainAmount": 12,
            "halationAmount": 3,
            "highlights": -22,
            "lumaNoiseReduction": 5,
            "lutIntensity": 80,
            "masks": [],
            "orientationSteps": 1,
            "rawEngineEditGraphVersion": 2,
            "rotation": 0.5,
            "saturation": 7,
            "sectionVisibility": { "basic": true, "color": true, "details": true, "effects": true },
            "shadows": 14,
            "sharpness": 24,
            "temperature": 12,
            "tint": -3,
            "toneCurve": [{ "x": 0, "y": 0 }, { "x": 255, "y": 250 }],
            "toneMapper": "basic",
            "vibrance": 11,
            "whites": 9
        });
        assert_eq!(compiled, expected);

        let expected_render = get_all_adjustments_from_json(&expected, true, None);
        let compiled_render = get_all_adjustments_from_json(&compiled, true, None);
        assert_eq!(
            compiled_render.global.exposure,
            expected_render.global.exposure
        );
        assert_eq!(
            compiled_render.global.contrast,
            expected_render.global.contrast
        );
        assert_eq!(
            compiled_render.global.highlights,
            expected_render.global.highlights
        );
        assert_eq!(
            compiled_render.global.vibrance,
            expected_render.global.vibrance
        );
        assert_eq!(
            compiled_render.global.clarity,
            expected_render.global.clarity
        );
        assert_eq!(compiled_render.global.dehaze, expected_render.global.dehaze);
        assert_eq!(
            compiled_render.global.temperature,
            expected_render.global.temperature
        );
        assert_eq!(compiled_render.global.tint, expected_render.global.tint);
        assert_eq!(
            compiled_render.global.grain_amount,
            expected_render.global.grain_amount
        );
        assert_eq!(compiled_render.mask_count, expected_render.mask_count);
    }

    #[test]
    fn rejects_unknown_nodes_and_mismatched_envelopes() {
        let mut unknown = document_with_legacy(json!({}));
        unknown["nodes"]["future_node"] = json!({
            "enabled": true,
            "implementationVersion": 1,
            "params": {},
            "process": "scene_referred_v2",
            "type": "future_node"
        });
        assert!(serde_json::from_value::<EditDocumentV2>(unknown).is_err());

        let mut mismatch = document_with_legacy(json!({}));
        mismatch["nodes"]["geometry"]["type"] = json!("layers");
        let error = serde_json::from_value::<EditDocumentV2>(mismatch)
            .expect("deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("mismatched node must fail");
        assert!(error.contains("must match 'geometry'"));
    }

    #[test]
    fn rejects_unsupported_versions_processes_and_ambiguous_domains() {
        let mut unsupported = document_with_legacy(json!({}));
        unsupported["nodes"]["geometry"]["implementationVersion"] = json!(2);
        let error = serde_json::from_value::<EditDocumentV2>(unsupported)
            .expect("deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("unsupported node version must fail");
        assert!(error.contains("unsupported implementationVersion 2"));

        let mut incompatible = document_with_legacy(json!({}));
        incompatible["nodes"]["geometry"]["process"] = json!("scene_referred_v2");
        let error = serde_json::from_value::<EditDocumentV2>(incompatible)
            .expect("deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("incompatible node process must fail");
        assert!(error.contains("incompatible process"));

        let mut ambiguous = document_with_legacy(json!({}));
        ambiguous["geometry"]["rotation"] = json!(90);
        let error = serde_json::from_value::<EditDocumentV2>(ambiguous)
            .expect("deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("ambiguous geometry must fail");
        assert!(error.contains("geometry domain disagrees"));
    }

    #[test]
    fn disabled_nodes_do_not_reenter_the_render_bag() {
        let mut value = document_with_legacy(json!({ "vibrance": 12 }));
        value["nodes"]["scene_global_color_tone"]["enabled"] = json!(false);
        let document: EditDocumentV2 = serde_json::from_value(value).expect("valid document");
        let compiled = document
            .into_render_adjustments()
            .expect("compiled document");
        assert!(compiled.get("exposure").is_none());
        assert_eq!(compiled["vibrance"], json!(12));
    }

    #[test]
    fn scene_global_color_tone_compiler_rejects_unowned_and_out_of_range_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["scene_global_color_tone"]["params"]["futureTone"] = json!(1);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned scene-tone field must fail");
        assert!(error.contains("unknown field `futureTone`"));

        let mut out_of_range = document_with_legacy(json!({}));
        out_of_range["nodes"]["scene_global_color_tone"]["params"]["exposure"] = json!(6);
        let error = serde_json::from_value::<EditDocumentV2>(out_of_range)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range exposure must fail");
        assert!(error.contains("field 'exposure'"));
        assert!(error.contains("[-5, 5]"));
    }
}
