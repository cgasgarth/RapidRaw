use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
enum GeometryCropUnitV2 {
    #[serde(rename = "%")]
    Percent,
    #[serde(rename = "normalized")]
    Normalized,
    #[serde(rename = "px")]
    Pixels,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeometryCropV2 {
    height: f64,
    unit: GeometryCropUnitV2,
    width: f64,
    x: f64,
    y: f64,
}

impl GeometryCropV2 {
    fn validate(&self) -> Result<(), String> {
        if !self.height.is_finite()
            || !self.width.is_finite()
            || !self.x.is_finite()
            || !self.y.is_finite()
            || self.height <= 0.0
            || self.width <= 0.0
            || self.x < 0.0
            || self.y < 0.0
        {
            return Err(
                "EditDocumentV2 geometry crop coordinates must be finite and positive within the source"
                    .to_string(),
            );
        }
        let maximum = match self.unit {
            GeometryCropUnitV2::Percent => Some(100.0),
            GeometryCropUnitV2::Normalized => Some(1.0),
            GeometryCropUnitV2::Pixels => None,
        };
        if maximum.is_some_and(|limit| self.x + self.width > limit || self.y + self.height > limit)
        {
            return Err("EditDocumentV2 geometry crop exceeds its unit bounds".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeometryV2 {
    aspect_ratio: Option<f64>,
    crop: Option<GeometryCropV2>,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    rotation: f64,
}

impl GeometryV2 {
    fn validate(&self) -> Result<(), String> {
        if self
            .aspect_ratio
            .is_some_and(|ratio| !ratio.is_finite() || ratio <= 0.0)
        {
            return Err(
                "EditDocumentV2 geometry aspectRatio must be finite and positive".to_string(),
            );
        }
        if self.orientation_steps > 3 {
            return Err(
                "EditDocumentV2 geometry orientationSteps must be within 0..=3".to_string(),
            );
        }
        if !self.rotation.is_finite() || !(-45.0..=45.0).contains(&self.rotation) {
            return Err("EditDocumentV2 geometry rotation must be within -45..=45".to_string());
        }
        if let Some(crop) = &self.crop {
            crop.validate()?;
        }
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

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceModeV2 {
    AsShot,
    Auto,
    KelvinTint,
    Chromaticity,
    Preset,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSourceV2 {
    AsShot,
    Auto,
    Picker,
    Preset,
    User,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalancePresetV2 {
    Tungsten,
    Daylight,
    Flash,
    Cloudy,
    Shade,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceMigrationV2 {
    NativeV1,
    LegacyCreativeTemperatureTintV1,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSemanticsV2 {
    RawSceneLinear,
    RenderedSceneLinearApproximation,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CameraInputWhiteBalanceSynchronizationModeV2 {
    PerImage,
    LockedReference,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CameraInputWhiteBalanceSynchronizationV2 {
    mode: CameraInputWhiteBalanceSynchronizationModeV2,
    reference_source_identity: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CameraInputTechnicalWhiteBalanceV2 {
    adaptation: String,
    confidence: Option<f64>,
    contract: String,
    duv: f64,
    input_semantics: CameraInputWhiteBalanceSemanticsV2,
    kelvin: f64,
    mode: CameraInputWhiteBalanceModeV2,
    preset_id: Option<CameraInputWhiteBalancePresetV2>,
    sample_count: Option<u64>,
    source: CameraInputWhiteBalanceSourceV2,
    synchronization: CameraInputWhiteBalanceSynchronizationV2,
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CameraInputV2 {
    camera_profile: String,
    camera_profile_amount: f64,
    creative_temperature: f64,
    creative_tint: f64,
    temperature: f64,
    tint: f64,
    white_balance: Option<Value>,
    white_balance_migration: CameraInputWhiteBalanceMigrationV2,
    white_balance_technical: CameraInputTechnicalWhiteBalanceV2,
}

impl CameraInputV2 {
    fn validate(&self) -> Result<(), String> {
        let built_in_profile = matches!(
            self.camera_profile.as_str(),
            "camera_standard"
                | "camera_neutral"
                | "camera_portrait"
                | "camera_landscape"
                | "linear_raw"
        );
        let valid_dcp_profile = self
            .camera_profile
            .strip_prefix("dcp:")
            .is_some_and(|digest| {
                digest.len() == 64
                    && digest
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            });
        if !built_in_profile && !valid_dcp_profile {
            return Err("EditDocumentV2 camera_input cameraProfile is invalid".to_string());
        }
        validate_camera_input_parameter(
            "cameraProfileAmount",
            self.camera_profile_amount,
            0.0,
            100.0,
        )?;
        validate_camera_input_parameter(
            "creativeTemperature",
            self.creative_temperature,
            -100.0,
            100.0,
        )?;
        validate_camera_input_parameter("creativeTint", self.creative_tint, -100.0, 100.0)?;
        validate_camera_input_parameter("temperature", self.temperature, -100.0, 100.0)?;
        validate_camera_input_parameter("tint", self.tint, -100.0, 100.0)?;
        let white_balance = &self.white_balance_technical;
        validate_camera_input_parameter(
            "whiteBalanceTechnical.kelvin",
            white_balance.kelvin,
            1667.0,
            25000.0,
        )?;
        validate_camera_input_parameter(
            "whiteBalanceTechnical.duv",
            white_balance.duv,
            -0.05,
            0.05,
        )?;
        if !white_balance.x.is_finite()
            || !white_balance.y.is_finite()
            || white_balance.x <= 0.0
            || white_balance.x >= 1.0
            || white_balance.y <= 0.0
            || white_balance.y >= 1.0
            || white_balance.x + white_balance.y >= 1.0
        {
            return Err(
                "EditDocumentV2 camera_input whiteBalanceTechnical chromaticity is invalid"
                    .to_string(),
            );
        }
        if white_balance.contract != "rapidraw.white_balance.v1"
            || white_balance.adaptation != "cat16_v1"
        {
            return Err(
                "EditDocumentV2 camera_input whiteBalanceTechnical contract is invalid".to_string(),
            );
        }
        if white_balance
            .confidence
            .is_some_and(|confidence| !confidence.is_finite() || !(0.0..=1.0).contains(&confidence))
        {
            return Err(
                "EditDocumentV2 camera_input whiteBalanceTechnical confidence is invalid"
                    .to_string(),
            );
        }
        if white_balance
            .synchronization
            .reference_source_identity
            .as_ref()
            .is_some_and(|identity| identity.trim().is_empty())
        {
            return Err(
                "EditDocumentV2 camera_input synchronization identity is invalid".to_string(),
            );
        }
        let _ = (
            &self.white_balance,
            &self.white_balance_migration,
            &white_balance.input_semantics,
            &white_balance.mode,
            &white_balance.preset_id,
            white_balance.sample_count,
            &white_balance.source,
            &white_balance.synchronization.mode,
        );
        Ok(())
    }
}

fn validate_camera_input_parameter(
    field: &str,
    value: f64,
    minimum: f64,
    maximum: f64,
) -> Result<(), String> {
    if value.is_finite() && value >= minimum && value <= maximum {
        return Ok(());
    }
    Err(format!(
        "EditDocumentV2 camera_input field '{field}' must be finite and within [{minimum}, {maximum}]"
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

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum SourceArtifactMaskTypeV2 {
    AiDepth,
    AiForeground,
    AiObject,
    AiPerson,
    AiSky,
    AiSubject,
    All,
    Brush,
    Color,
    Flow,
    Linear,
    Luminance,
    QuickEraser,
    Radial,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum SourceArtifactSubMaskModeV2 {
    Additive,
    Intersect,
    Subtractive,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum LayerBlendModeV2 {
    Normal,
    Multiply,
    Screen,
    Overlay,
    SoftLight,
    Hue,
    Saturation,
    Luminosity,
    Color,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayerV2 {
    adjustments: BTreeMap<String, Value>,
    blend_mode: Option<LayerBlendModeV2>,
    id: String,
    invert: bool,
    layer_group_id: Option<String>,
    layer_group_name: Option<String>,
    name: String,
    opacity: f64,
    reference_match_application_receipt: Option<Map<String, Value>>,
    retouch_clone_source: Option<Map<String, Value>>,
    retouch_remove_source: Option<Map<String, Value>>,
    sub_masks: Vec<SourceArtifactSubMaskV2>,
    visible: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayersV2 {
    masks: Vec<LayerV2>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifactSubMaskV2 {
    id: String,
    invert: bool,
    mode: SourceArtifactSubMaskModeV2,
    name: Option<String>,
    opacity: f64,
    parameters: Option<BTreeMap<String, Value>>,
    #[serde(rename = "type")]
    mask_type: SourceArtifactMaskTypeV2,
    visible: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifactAiPatchV2 {
    id: String,
    invert: bool,
    is_loading: bool,
    name: String,
    patch_data: Value,
    prompt: String,
    sub_masks: Vec<SourceArtifactSubMaskV2>,
    visible: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifactsV2 {
    ai_patches: Vec<SourceArtifactAiPatchV2>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditDocumentProvenanceV2 {
    #[serde(default)]
    reference_match_application_receipt: Option<Map<String, Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EditDocumentV2 {
    extensions: Map<String, Value>,
    geometry: GeometryV2,
    graph_process: String,
    layers: Map<String, Value>,
    migration: Option<EditDocumentMigrationReceiptV2>,
    nodes: BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    provenance: EditDocumentProvenanceV2,
    schema_version: u8,
    source_artifacts: SourceArtifactsV2,
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
        if adjustments.contains_key("referenceMatchApplicationReceipt") {
            return Err(
                "EditDocumentV2 referenceMatchApplicationReceipt must be owned by provenance"
                    .to_string(),
            );
        }
        adjustments.remove("generatedProfile");

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
        validate_geometry_domain(&self.nodes, &self.geometry)?;
        validate_layers_domain(&self.nodes, &self.layers)?;
        validate_source_artifact_domain(&self.nodes, &self.source_artifacts)?;
        if self
            .provenance
            .reference_match_application_receipt
            .as_ref()
            .is_some_and(|receipt| receipt.get("schemaVersion") != Some(&Value::from(1)))
        {
            return Err(
                "EditDocumentV2 reference-match provenance requires schemaVersion 1".to_string(),
            );
        }
        Ok(())
    }
}

fn compile_node_params(
    node_key: EditNodeTypeV2,
    node: &EditNodeEnvelopeV2,
) -> Result<Map<String, Value>, String> {
    match node_key {
        EditNodeTypeV2::CameraInput => {
            parse_camera_input(&node.params)?;
            Ok(node.params.clone())
        }
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
        EditNodeTypeV2::Geometry => {
            parse_geometry(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::SourceArtifacts => {
            parse_source_artifacts(&node.params)?;
            Ok(node.params.clone())
        }
        EditNodeTypeV2::Layers => {
            parse_layers(&node.params)?;
            Ok(node.params.clone())
        }
        _ => Ok(node.params.clone()),
    }
}

fn parse_camera_input(params: &Map<String, Value>) -> Result<CameraInputV2, String> {
    let camera_input: CameraInputV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 camera_input is invalid: {error}"))?;
    camera_input.validate()?;
    Ok(camera_input)
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

fn parse_source_artifacts(params: &Map<String, Value>) -> Result<SourceArtifactsV2, String> {
    let artifacts: SourceArtifactsV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 source artifacts are invalid: {error}"))?;
    let mut patch_ids = std::collections::BTreeSet::new();
    for patch in &artifacts.ai_patches {
        if patch.id.trim().is_empty() || !patch_ids.insert(&patch.id) {
            return Err("EditDocumentV2 AI patch IDs must be non-empty and unique".to_string());
        }
        let mut sub_mask_ids = std::collections::BTreeSet::new();
        for sub_mask in &patch.sub_masks {
            if sub_mask.id.trim().is_empty() || !sub_mask_ids.insert(&sub_mask.id) {
                return Err(
                    "EditDocumentV2 AI patch sub-mask IDs must be non-empty and unique".to_string(),
                );
            }
            if !(0.0..=100.0).contains(&sub_mask.opacity) {
                return Err(
                    "EditDocumentV2 AI patch sub-mask opacity must be within 0..=100".to_string(),
                );
            }
        }
    }
    Ok(artifacts)
}

fn parse_geometry(params: &Map<String, Value>) -> Result<GeometryV2, String> {
    let geometry: GeometryV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 geometry is invalid: {error}"))?;
    geometry.validate()?;
    Ok(geometry)
}

fn validate_source_artifact_domain(
    nodes: &BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    domain: &SourceArtifactsV2,
) -> Result<(), String> {
    let Some(node) = nodes.get(&EditNodeTypeV2::SourceArtifacts) else {
        return Ok(());
    };
    if &parse_source_artifacts(&node.params)? == domain {
        return Ok(());
    }
    Err("EditDocumentV2 source_artifacts domain disagrees with its node params".to_string())
}

fn validate_geometry_domain(
    nodes: &BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    domain: &GeometryV2,
) -> Result<(), String> {
    let Some(node) = nodes.get(&EditNodeTypeV2::Geometry) else {
        return Ok(());
    };
    if &parse_geometry(&node.params)? == domain {
        return Ok(());
    }
    Err("EditDocumentV2 geometry domain disagrees with its node params".to_string())
}

fn parse_layers(params: &Map<String, Value>) -> Result<LayersV2, String> {
    let layers: LayersV2 = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|error| format!("EditDocumentV2 layers are invalid: {error}"))?;
    let mut layer_ids = std::collections::BTreeSet::new();
    for layer in &layers.masks {
        if layer.id.trim().is_empty() || !layer_ids.insert(&layer.id) {
            return Err("EditDocumentV2 layer IDs must be non-empty and unique".to_string());
        }
        if !(0.0..=100.0).contains(&layer.opacity) {
            return Err("EditDocumentV2 layer opacity must be within 0..=100".to_string());
        }
        if layer
            .layer_group_id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty())
            || layer
                .layer_group_name
                .as_ref()
                .is_some_and(|value| value.trim().is_empty())
        {
            return Err("EditDocumentV2 layer group identity must be non-empty".to_string());
        }
        if layer
            .reference_match_application_receipt
            .as_ref()
            .is_some_and(|receipt| receipt.get("schemaVersion") != Some(&Value::from(1)))
        {
            return Err(
                "EditDocumentV2 layer reference-match provenance requires schemaVersion 1"
                    .to_string(),
            );
        }
        let mut sub_mask_ids = std::collections::BTreeSet::new();
        for sub_mask in &layer.sub_masks {
            if sub_mask.id.trim().is_empty() || !sub_mask_ids.insert(&sub_mask.id) {
                return Err(
                    "EditDocumentV2 layer sub-mask IDs must be non-empty and unique".to_string(),
                );
            }
            if !(0.0..=100.0).contains(&sub_mask.opacity) {
                return Err(
                    "EditDocumentV2 layer sub-mask opacity must be within 0..=100".to_string(),
                );
            }
        }
        let _ = (
            &layer.adjustments,
            &layer.blend_mode,
            layer.invert,
            &layer.name,
            &layer.retouch_clone_source,
            &layer.retouch_remove_source,
            layer.visible,
        );
    }
    Ok(layers)
}

fn validate_layers_domain(
    nodes: &BTreeMap<EditNodeTypeV2, EditNodeEnvelopeV2>,
    domain: &Map<String, Value>,
) -> Result<(), String> {
    let domain = parse_layers(domain)?;
    let Some(node) = nodes.get(&EditNodeTypeV2::Layers) else {
        return Ok(());
    };
    if parse_layers(&node.params)? == domain {
        return Ok(());
    }
    Err("EditDocumentV2 layers domain disagrees with its node params".to_string())
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
                    "params": {
                        "cameraProfile": "camera_standard",
                        "cameraProfileAmount": 100,
                        "creativeTemperature": 0,
                        "creativeTint": 0,
                        "temperature": 12,
                        "tint": -3,
                        "whiteBalanceMigration": "native_v1",
                        "whiteBalanceTechnical": {
                            "adaptation": "cat16_v1",
                            "confidence": null,
                            "contract": "rapidraw.white_balance.v1",
                            "duv": 0,
                            "inputSemantics": "raw_scene_linear",
                            "kelvin": 6504,
                            "mode": "as_shot",
                            "presetId": null,
                            "sampleCount": null,
                            "source": "as_shot",
                            "synchronization": { "mode": "per_image", "referenceSourceIdentity": null },
                            "x": 0.32168,
                            "y": 0.33767
                        }
                    },
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

    fn source_patch() -> Value {
        json!({
            "id": "patch-1",
            "invert": false,
            "isLoading": false,
            "name": "Repair",
            "patchData": { "pixels": "resident-payload" },
            "prompt": "remove distraction",
            "subMasks": [{
                "id": "mask-1",
                "invert": false,
                "mode": "additive",
                "opacity": 80,
                "parameters": { "mask_data_base64": "encoded-mask" },
                "type": "brush",
                "visible": true
            }],
            "visible": true
        })
    }

    fn layer() -> Value {
        json!({
            "adjustments": { "exposure": 0.4 },
            "blendMode": "overlay",
            "id": "layer-1",
            "invert": false,
            "name": "Local sky",
            "opacity": 72,
            "subMasks": [{
                "id": "sub-mask-1",
                "invert": false,
                "mode": "additive",
                "opacity": 100,
                "parameters": { "feather": 0.5 },
                "type": "brush",
                "visible": true
            }],
            "visible": true
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

        let mut expected = json!({
            "aiPatches": [],
            "aspectRatio": null,
            "blacks": -4,
            "brightness": 0.1,
            "cameraProfile": "camera_standard",
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
        expected["cameraProfileAmount"] = json!(100);
        expected["creativeTemperature"] = json!(0);
        expected["creativeTint"] = json!(0);
        expected["whiteBalanceMigration"] = json!("native_v1");
        expected["whiteBalanceTechnical"] = json!({
            "adaptation": "cat16_v1",
            "confidence": null,
            "contract": "rapidraw.white_balance.v1",
            "duv": 0,
            "inputSemantics": "raw_scene_linear",
            "kelvin": 6504,
            "mode": "as_shot",
            "presetId": null,
            "sampleCount": null,
            "source": "as_shot",
            "synchronization": { "mode": "per_image", "referenceSourceIdentity": null },
            "x": 0.32168,
            "y": 0.33767
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

    #[test]
    fn camera_input_compiler_rejects_unowned_and_malformed_render_authority() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["camera_input"]["params"]["futureInput"] = json!(1);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned camera-input field must fail");
        assert!(error.contains("unknown field `futureInput`"));

        let mut invalid_profile = document_with_legacy(json!({}));
        invalid_profile["nodes"]["camera_input"]["params"]["cameraProfile"] =
            json!("unknown_profile");
        let error = serde_json::from_value::<EditDocumentV2>(invalid_profile)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unknown camera profile must fail");
        assert!(error.contains("cameraProfile is invalid"));

        let mut invalid_amount = document_with_legacy(json!({}));
        invalid_amount["nodes"]["camera_input"]["params"]["cameraProfileAmount"] = json!(101);
        let error = serde_json::from_value::<EditDocumentV2>(invalid_amount)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range camera profile amount must fail");
        assert!(error.contains("cameraProfileAmount"));
        assert!(error.contains("[0, 100]"));

        let mut invalid_chromaticity = document_with_legacy(json!({}));
        invalid_chromaticity["nodes"]["camera_input"]["params"]["whiteBalanceTechnical"]["x"] =
            json!(0.8);
        let error = serde_json::from_value::<EditDocumentV2>(invalid_chromaticity)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("invalid white-balance chromaticity must fail");
        assert!(error.contains("chromaticity is invalid"));
    }

    #[test]
    fn geometry_compiler_rejects_unowned_out_of_range_and_out_of_bounds_params() {
        let mut unowned = document_with_legacy(json!({}));
        unowned["nodes"]["geometry"]["params"]["futureWarp"] = json!(1);
        let error = serde_json::from_value::<EditDocumentV2>(unowned)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("unowned geometry field must fail");
        assert!(error.contains("unknown field `futureWarp`"));

        let mut rotation = document_with_legacy(json!({}));
        rotation["nodes"]["geometry"]["params"]["rotation"] = json!(46);
        rotation["geometry"]["rotation"] = json!(46);
        let error = serde_json::from_value::<EditDocumentV2>(rotation)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-range rotation must fail");
        assert!(error.contains("rotation must be within -45..=45"));

        let invalid_crop =
            json!({ "height": 0.8, "unit": "normalized", "width": 0.8, "x": 0.3, "y": 0.3 });
        let mut crop = document_with_legacy(json!({}));
        crop["nodes"]["geometry"]["params"]["crop"] = invalid_crop.clone();
        crop["geometry"]["crop"] = invalid_crop;
        let error = serde_json::from_value::<EditDocumentV2>(crop)
            .expect("document envelope remains parseable")
            .into_render_adjustments()
            .expect_err("out-of-bounds crop must fail");
        assert!(error.contains("crop exceeds its unit bounds"));

        let mut unknown_domain = document_with_legacy(json!({}));
        unknown_domain["geometry"]["futureWarp"] = json!(1);
        assert!(serde_json::from_value::<EditDocumentV2>(unknown_domain).is_err());
    }

    #[test]
    fn compiles_strict_source_artifacts_and_excludes_quarantined_profile_state() {
        let patch = source_patch();
        let mut value = document_with_legacy(json!({
            "generatedProfile": { "obsolete": true },
            "vibrance": 12
        }));
        value["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch] });
        value["sourceArtifacts"] = json!({ "aiPatches": [patch] });
        let compiled = serde_json::from_value::<EditDocumentV2>(value)
            .expect("valid source document")
            .into_render_adjustments()
            .expect("compiled source document");

        assert_eq!(compiled["aiPatches"][0]["id"], json!("patch-1"));
        assert_eq!(compiled["vibrance"], json!(12));
        assert!(compiled.get("generatedProfile").is_none());
        assert!(compiled.get("referenceMatchApplicationReceipt").is_none());
    }

    #[test]
    fn rejects_malformed_duplicate_ambiguous_and_legacy_owned_source_state() {
        let patch = source_patch();
        let mut malformed = document_with_legacy(json!({}));
        malformed["nodes"]["source_artifacts"]["params"] =
            json!({ "aiPatches": [{ "id": "patch-1", "unsupported": true }] });
        let error = serde_json::from_value::<EditDocumentV2>(malformed)
            .expect("top-level source domain remains valid")
            .into_render_adjustments()
            .expect_err("malformed source node must fail");
        assert!(error.contains("source artifacts are invalid"));

        let mut duplicate = document_with_legacy(json!({}));
        duplicate["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch, patch] });
        duplicate["sourceArtifacts"] = json!({ "aiPatches": [patch, patch] });
        let error = serde_json::from_value::<EditDocumentV2>(duplicate)
            .expect("duplicate IDs deserialize before semantic validation")
            .into_render_adjustments()
            .expect_err("duplicate source IDs must fail");
        assert!(error.contains("non-empty and unique"));

        let mut ambiguous = document_with_legacy(json!({}));
        ambiguous["nodes"]["source_artifacts"]["params"] = json!({ "aiPatches": [patch] });
        let error = serde_json::from_value::<EditDocumentV2>(ambiguous)
            .expect("mismatched domains deserialize before semantic validation")
            .into_render_adjustments()
            .expect_err("ambiguous source domains must fail");
        assert!(error.contains("domain disagrees"));

        let legacy_owned = document_with_legacy(json!({
            "referenceMatchApplicationReceipt": { "schemaVersion": 1 }
        }));
        let error = serde_json::from_value::<EditDocumentV2>(legacy_owned)
            .expect("legacy-owned provenance deserializes before semantic validation")
            .into_render_adjustments()
            .expect_err("legacy-owned provenance must fail");
        assert!(error.contains("must be owned by provenance"));
    }

    #[test]
    fn compiles_strict_layers_and_rejects_duplicate_or_ambiguous_layer_state() {
        let layer = layer();
        let mut value = document_with_legacy(json!({}));
        value["nodes"]["layers"]["params"] = json!({ "masks": [layer] });
        value["layers"] = json!({ "masks": [layer] });
        let compiled = serde_json::from_value::<EditDocumentV2>(value)
            .expect("valid layers document")
            .into_render_adjustments()
            .expect("compiled layers document");
        assert_eq!(compiled["masks"][0]["id"], json!("layer-1"));

        let mut duplicate = document_with_legacy(json!({}));
        duplicate["nodes"]["layers"]["params"] = json!({ "masks": [layer, layer] });
        duplicate["layers"] = json!({ "masks": [layer, layer] });
        let error = serde_json::from_value::<EditDocumentV2>(duplicate)
            .expect("duplicate layers deserialize before semantic validation")
            .into_render_adjustments()
            .expect_err("duplicate layer IDs must fail");
        assert!(error.contains("non-empty and unique"));

        let mut ambiguous = document_with_legacy(json!({}));
        ambiguous["nodes"]["layers"]["params"] = json!({ "masks": [layer] });
        let error = serde_json::from_value::<EditDocumentV2>(ambiguous)
            .expect("ambiguous layers deserialize before semantic validation")
            .into_render_adjustments()
            .expect_err("ambiguous layers must fail");
        assert!(error.contains("layers domain disagrees"));
    }
}
