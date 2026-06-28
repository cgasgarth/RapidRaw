use std::collections::HashSet;
use std::fs;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::preset_converter;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub adjustments: Value,
    #[serde(rename = "includeMasks", skip_serializing_if = "Option::is_none")]
    pub include_masks: Option<bool>,
    #[serde(
        rename = "includeCropTransform",
        skip_serializing_if = "Option::is_none"
    )]
    pub include_crop_transform: Option<bool>,
    #[serde(rename = "presetType", skip_serializing_if = "Option::is_none")]
    pub preset_type: Option<String>,
    #[serde(
        rename = "colorStyleProvenance",
        skip_serializing_if = "Option::is_none"
    )]
    pub color_style_provenance: Option<Value>,
}

#[derive(Serialize)]
struct ExportPresetFile<'a> {
    creator: &'a str,
    presets: &'a [PresetItem],
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PresetFolder {
    pub id: String,
    pub name: String,
    pub children: Vec<Preset>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum PresetItem {
    Preset(Preset),
    Folder(PresetFolder),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PresetFile {
    pub presets: Vec<PresetItem>,
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

#[tauri::command]
pub fn load_presets(app_handle: AppHandle) -> Result<Vec<PresetItem>, String> {
    let path = get_presets_path(&app_handle)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_presets(presets: Vec<PresetItem>, app_handle: AppHandle) -> Result<(), String> {
    let path = get_presets_path(&app_handle)?;
    let json_string = serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?;
    fs::write(path, json_string).map_err(|e| e.to_string())
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
pub fn handle_import_legacy_presets_from_file(
    file_path: String,
    app_handle: AppHandle,
) -> Result<Vec<PresetItem>, String> {
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read legacy preset file: {}", e))?;

    let xmp_content = if file_path.to_lowercase().ends_with(".lrtemplate") {
        let re = Regex::new(r#"(?s)s.xmp = "(.*)""#).unwrap();
        if let Some(caps) = re.captures(&content) {
            caps.get(1)
                .map(|m| m.as_str().replace(r#"\""#, r#"""#))
                .unwrap_or(content)
        } else {
            content
        }
    } else {
        content
    };

    let converted_preset = preset_converter::convert_xmp_to_preset(&xmp_content)?;

    let mut current_presets = load_presets(app_handle.clone())?;
    let current_names = collect_preset_names(&current_presets);
    let mut final_preset = converted_preset;
    final_preset.name = unique_preset_name(&final_preset.name, &current_names);

    current_presets.push(PresetItem::Preset(final_preset));

    save_presets(current_presets.clone(), app_handle)?;
    Ok(current_presets)
}

#[tauri::command]
pub fn handle_export_presets_to_file(
    presets_to_export: Vec<PresetItem>,
    file_path: String,
) -> Result<(), String> {
    let preset_file = ExportPresetFile {
        creator: "Anonymous",
        presets: &presets_to_export,
    };

    let json_string = serde_json::to_string_pretty(&preset_file)
        .map_err(|e| format!("Failed to serialize presets: {}", e))?;
    fs::write(file_path, json_string).map_err(|e| format!("Failed to write preset file: {}", e))
}

#[tauri::command]
pub fn save_community_preset(
    name: String,
    adjustments: Value,
    app_handle: AppHandle,
    include_masks: Option<bool>,
    include_crop_transform: Option<bool>,
    preset_type: Option<String>,
) -> Result<(), String> {
    let mut current_presets = load_presets(app_handle.clone())?;
    let community_folder_id = find_or_create_community_folder(&mut current_presets);

    let new_preset = Preset {
        adjustments,
        id: Uuid::new_v4().to_string(),
        include_crop_transform,
        include_masks,
        name,
        color_style_provenance: None,
        preset_type: preset_type.or(Some("style".to_string())),
    };

    if let Some(PresetItem::Folder(folder)) = current_presets.iter_mut().find(|item| {
        if let PresetItem::Folder(folder) = item {
            folder.id == community_folder_id
        } else {
            false
        }
    }) {
        folder
            .children
            .retain(|preset| preset.name != new_preset.name);
        folder.children.push(new_preset);
    }

    save_presets(current_presets, app_handle)
}
