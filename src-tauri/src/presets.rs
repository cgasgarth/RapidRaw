use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::adjustments::edit_document_v2::validate_edit_document_v2_copy_payload;
use crate::preset_converter::{self, ExternalPresetImportDiagnostic};

const RAPIDRAW_PRESET_FORMAT: &str = "rapidraw.preset";
const RAPIDRAW_PRESET_SCHEMA_VERSION: u8 = 1;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub format: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u8,
    pub id: String,
    pub name: String,
    #[serde(rename = "editDocumentV2")]
    pub edit_document_v2: Value,
    #[serde(rename = "includeMasks")]
    pub include_masks: bool,
    #[serde(rename = "includeCropTransform")]
    pub include_crop_transform: bool,
    #[serde(rename = "presetType")]
    pub preset_type: PresetType,
    #[serde(
        rename = "colorStyleProvenance",
        skip_serializing_if = "Option::is_none"
    )]
    pub color_style_provenance: Option<ColorStyleProvenance>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorStyleProvenance {
    pub created_at: String,
    pub legal_naming_status: UserColorStyleLegalNamingStatus,
    pub legal_warning: String,
    pub source: UserColorStyleSource,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UserColorStyleLegalNamingStatus {
    UserNamed,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UserColorStyleSource {
    UserCreated,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PresetType {
    Style,
    Tool,
}

#[derive(Serialize)]
struct ExportPresetFile<'a> {
    creator: &'a str,
    presets: &'a [PresetItem],
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct PresetFolder {
    pub id: String,
    pub name: String,
    pub children: Vec<Preset>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum PresetItem {
    Preset(Preset),
    Folder(PresetFolder),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct PresetFile {
    pub presets: Vec<PresetItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPresetImportResult {
    diagnostics: Vec<ExternalPresetImportDiagnostic>,
    presets: Vec<PresetItem>,
}

fn get_presets_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    let presets_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("presets");

    if !presets_dir.exists() {
        fs::create_dir_all(&presets_dir).map_err(|e| e.to_string())?;
    }

    Ok(presets_dir.join("presets.json"))
}

fn collect_preset_names(items: &[PresetItem]) -> HashSet<String> {
    items
        .iter()
        .flat_map(|item| match item {
            PresetItem::Preset(preset) => vec![preset.name.clone()],
            PresetItem::Folder(folder) => {
                let mut names = vec![folder.name.clone()];
                names.extend(folder.children.iter().map(|child| child.name.clone()));
                names
            }
        })
        .collect()
}

fn unique_preset_name(base_name: &str, existing_names: &HashSet<String>) -> String {
    let mut new_name = base_name.to_string();
    let mut counter = 1;
    while existing_names.contains(&new_name) {
        new_name = format!("{} ({})", base_name, counter);
        counter += 1;
    }
    new_name
}

fn assign_new_ids(item: &mut PresetItem) {
    match item {
        PresetItem::Preset(preset) => preset.id = Uuid::new_v4().to_string(),
        PresetItem::Folder(folder) => {
            folder.id = Uuid::new_v4().to_string();
            for child in &mut folder.children {
                child.id = Uuid::new_v4().to_string();
            }
        }
    }
}

fn rename_preset_item(item: &mut PresetItem, name: String) {
    match item {
        PresetItem::Preset(preset) => preset.name = name,
        PresetItem::Folder(folder) => folder.name = name,
    }
}

fn preset_item_name(item: &PresetItem) -> &str {
    match item {
        PresetItem::Preset(preset) => &preset.name,
        PresetItem::Folder(folder) => &folder.name,
    }
}

fn find_or_create_community_folder(items: &mut Vec<PresetItem>) -> String {
    let community_folder_name = "Community";
    if let Some(PresetItem::Folder(folder)) = items.iter().find(|item| {
        if let PresetItem::Folder(folder) = item {
            folder.name == community_folder_name
        } else {
            false
        }
    }) {
        return folder.id.clone();
    }

    let new_folder_id = Uuid::new_v4().to_string();
    items.insert(
        0,
        PresetItem::Folder(PresetFolder {
            children: Vec::new(),
            id: new_folder_id.clone(),
            name: community_folder_name.to_string(),
        }),
    );
    new_folder_id
}

fn validate_preset(preset: &Preset) -> Result<(), String> {
    if preset.format != RAPIDRAW_PRESET_FORMAT {
        return Err(format!(
            "Unsupported RapidRaw preset format: {}",
            preset.format
        ));
    }
    if preset.schema_version != RAPIDRAW_PRESET_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported RapidRaw preset schemaVersion: {}",
            preset.schema_version
        ));
    }
    if preset.id.trim().is_empty() || preset.name.trim().is_empty() {
        return Err("RapidRaw preset id and name must be non-empty".to_string());
    }
    if preset.include_masks {
        return Err("RapidRaw presets cannot persist masks".to_string());
    }
    validate_edit_document_v2_copy_payload(&preset.edit_document_v2)?;
    let nodes = preset
        .edit_document_v2
        .get("nodes")
        .and_then(Value::as_object)
        .ok_or_else(|| "RapidRaw preset editDocumentV2.nodes must be an object".to_string())?;
    if !preset.include_crop_transform
        && (nodes.contains_key("geometry") || nodes.contains_key("lens_correction"))
    {
        return Err(
            "RapidRaw preset excludes crop/transform but contains geometry authority".to_string(),
        );
    }
    if preset.color_style_provenance.is_some() && preset.preset_type != PresetType::Style {
        return Err("Only style presets can contain color-style provenance".to_string());
    }
    if preset
        .color_style_provenance
        .as_ref()
        .is_some_and(|provenance| {
            provenance.created_at.trim().is_empty()
                || provenance.updated_at.trim().is_empty()
                || provenance.legal_warning.trim().is_empty()
        })
    {
        return Err("RapidRaw color-style provenance fields must be non-empty".to_string());
    }
    Ok(())
}

fn validate_preset_items(presets: &[PresetItem]) -> Result<(), String> {
    for item in presets {
        match item {
            PresetItem::Preset(preset) => validate_preset(preset)?,
            PresetItem::Folder(folder) => {
                if folder.id.trim().is_empty() || folder.name.trim().is_empty() {
                    return Err("RapidRaw preset folder id and name must be non-empty".to_string());
                }
                for preset in &folder.children {
                    validate_preset(preset)?;
                }
            }
        }
    }
    Ok(())
}

fn decode_presets(content: &str) -> Result<Vec<PresetItem>, String> {
    let presets: Vec<PresetItem> =
        serde_json::from_str(content).map_err(|error| error.to_string())?;
    validate_preset_items(&presets)?;
    Ok(presets)
}

fn encode_presets(presets: &[PresetItem]) -> Result<String, String> {
    validate_preset_items(presets)?;
    serde_json::to_string_pretty(presets).map_err(|error| error.to_string())
}

fn read_presets_from_path(path: &Path) -> Result<Vec<PresetItem>, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    decode_presets(&content)
}

fn write_content_atomically(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "RapidRaw preset path has no parent directory".to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(content)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

fn write_presets_to_path(path: &Path, presets: &[PresetItem]) -> Result<(), String> {
    write_content_atomically(path, encode_presets(presets)?.as_bytes())
}

#[tauri::command]
pub fn load_presets(app_handle: AppHandle) -> Result<Vec<PresetItem>, String> {
    let path = get_presets_path(&app_handle)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_presets_from_path(&path)
}

#[tauri::command]
pub fn save_presets(presets: Vec<PresetItem>, app_handle: AppHandle) -> Result<(), String> {
    let path = get_presets_path(&app_handle)?;
    write_presets_to_path(&path, &presets)
}

#[tauri::command]
pub fn handle_import_presets_from_file(
    file_path: String,
    app_handle: AppHandle,
) -> Result<Vec<PresetItem>, String> {
    let content =
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read preset file: {}", e))?;
    let imported_preset_file: PresetFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse preset file: {}", e))?;

    let mut current_presets = load_presets(app_handle.clone())?;
    let mut current_names = collect_preset_names(&current_presets);

    for mut imported_item in imported_preset_file.presets {
        assign_new_ids(&mut imported_item);
        let new_name = unique_preset_name(preset_item_name(&imported_item), &current_names);
        rename_preset_item(&mut imported_item, new_name.clone());
        current_names.insert(new_name);
        current_presets.push(imported_item);
    }

    save_presets(current_presets.clone(), app_handle)?;
    Ok(current_presets)
}

#[tauri::command]
pub fn handle_import_external_presets_from_file(
    file_path: String,
    app_handle: AppHandle,
) -> Result<ExternalPresetImportResult, String> {
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read external preset file: {}", e))?;

    let xmp_content = extract_external_xmp(&file_path, content)?;

    let converted = preset_converter::convert_xmp_to_preset(&xmp_content)?;

    let mut current_presets = load_presets(app_handle.clone())?;
    let current_names = collect_preset_names(&current_presets);
    let mut final_preset = converted.preset;
    final_preset.name = unique_preset_name(&final_preset.name, &current_names);

    current_presets.push(PresetItem::Preset(final_preset));

    save_presets(current_presets.clone(), app_handle)?;
    Ok(ExternalPresetImportResult {
        diagnostics: converted.diagnostics,
        presets: current_presets,
    })
}

fn extract_external_xmp(file_path: &str, content: String) -> Result<String, String> {
    if file_path.to_lowercase().ends_with(".lrtemplate") {
        let re = Regex::new(r#"(?s)s\.xmp = "(.*)""#).expect("static lrtemplate regex");
        if let Some(caps) = re.captures(&content) {
            Ok(caps
                .get(1)
                .map(|m| m.as_str().replace(r#"\""#, r#"""#))
                .unwrap_or(content))
        } else {
            Err("Lightroom template does not contain an embedded XMP preset".to_string())
        }
    } else {
        Ok(content)
    }
}

#[tauri::command]
pub fn handle_export_presets_to_file(
    presets_to_export: Vec<PresetItem>,
    file_path: String,
) -> Result<(), String> {
    validate_preset_items(&presets_to_export)?;
    let preset_file = ExportPresetFile {
        creator: "Anonymous",
        presets: &presets_to_export,
    };

    let json_string = serde_json::to_string_pretty(&preset_file)
        .map_err(|e| format!("Failed to serialize presets: {}", e))?;
    write_content_atomically(Path::new(&file_path), json_string.as_bytes())
        .map_err(|error| format!("Failed to write preset file: {error}"))
}

#[tauri::command]
pub fn save_community_preset(mut preset: Preset, app_handle: AppHandle) -> Result<(), String> {
    validate_preset(&preset)?;
    let mut current_presets = load_presets(app_handle.clone())?;
    let community_folder_id = find_or_create_community_folder(&mut current_presets);
    preset.id = Uuid::new_v4().to_string();
    preset.color_style_provenance = None;

    if let Some(PresetItem::Folder(folder)) = current_presets.iter_mut().find(|item| {
        if let PresetItem::Folder(folder) = item {
            folder.id == community_folder_id
        } else {
            false
        }
    }) {
        folder.children.retain(|saved| saved.name != preset.name);
        folder.children.push(preset);
    }

    save_presets(current_presets, app_handle)
}

#[cfg(test)]
mod tests {
    use super::{PresetItem, extract_external_xmp, read_presets_from_path, write_presets_to_path};
    use serde_json::json;
    use std::fs;

    #[test]
    fn preset_edit_document_v2_survives_native_save_and_reload() {
        let mut preset = crate::preset_converter::convert_xmp_to_preset(
            r#"<rdf:Description crs:Name="V2 roundtrip" crs:Exposure2012="1.25" />"#,
        )
        .expect("current external compiler")
        .preset;
        preset.id = "preset-v2".to_string();
        let edit_document_v2 = preset.edit_document_v2.clone();
        let directory = tempfile::tempdir().expect("temporary preset directory");
        let path = directory.path().join("presets.json");
        write_presets_to_path(&path, &[PresetItem::Preset(preset)])
            .expect("production preset writer must persist V2 authority");
        let persisted_bytes = fs::read(&path).expect("persisted preset bytes");
        assert!(String::from_utf8_lossy(&persisted_bytes).contains("editDocumentV2"));
        let decoded = read_presets_from_path(&path)
            .expect("production preset reader must reopen saved authority");
        let PresetItem::Preset(reopened) = &decoded[0] else {
            panic!("expected preset item");
        };
        assert_eq!(reopened.edit_document_v2, edit_document_v2);
        assert_eq!(reopened.format, "rapidraw.preset");
        assert_eq!(reopened.schema_version, 1);

        fs::write(
            &path,
            r#"[{"preset":{"id":"legacy","name":"Legacy","adjustments":{"exposure":0.5}}}]"#,
        )
        .expect("flat-only fixture must write");
        assert!(read_presets_from_path(&path).is_err());

        let mut provenance_leak =
            serde_json::to_value(reopened).expect("serialized current preset");
        provenance_leak
            .as_object_mut()
            .expect("preset object")
            .insert(
                "colorStyleProvenance".to_string(),
                json!({ "source": "imported_external" }),
            );
        fs::write(&path, json!([{ "preset": provenance_leak }]).to_string())
            .expect("provenance leak fixture must write");
        assert!(read_presets_from_path(&path).is_err());

        let mut future = reopened.clone();
        future.schema_version = 2;
        assert!(write_presets_to_path(&path, &[PresetItem::Preset(future)]).is_err());

        let mut disallowed = reopened.clone();
        disallowed.edit_document_v2 = json!({
            "nodes": {
                "source_artifacts": {
                    "enabled": true,
                    "implementationVersion": 1,
                    "params": { "aiPatches": [] },
                    "process": "scene_referred_v2",
                    "type": "source_artifacts"
                }
            },
            "schemaVersion": 2
        });
        assert!(write_presets_to_path(&path, &[PresetItem::Preset(disallowed)]).is_err());
    }

    #[test]
    fn lrtemplate_embedded_xmp_reaches_current_monochrome_converter() {
        let embedded = extract_external_xmp(
            "/tmp/current-bw.lrtemplate",
            include_str!("../../fixtures/import/lightroom-current-nodes.lrtemplate").to_string(),
        )
        .expect("embedded XMP extraction");
        let converted = crate::preset_converter::convert_xmp_to_preset(&embedded)
            .expect("embedded lrtemplate XMP converts");
        let preset = converted.preset;
        let current = preset.edit_document_v2;

        assert_eq!(
            current["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]["process"],
            "continuous_sensitivity_v1"
        );
        assert_eq!(
            current["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]["weights"]["blues"],
            -24.0
        );
    }
}
