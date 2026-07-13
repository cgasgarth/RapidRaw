use rapidraw_types::{CapabilityUnavailable, NativeCapability};

fn ai_unavailable<T>() -> Result<T, CapabilityUnavailable> {
    Err(CapabilityUnavailable::new(NativeCapability::Ai))
}

#[tauri::command]
pub fn generate_ai_subject_mask() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn generate_ai_object_mask_proposal() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn precompute_ai_subject_mask() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn generate_ai_foreground_mask() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn generate_ai_sky_mask() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn generate_ai_depth_mask() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn generate_ai_whole_person_mask() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn generate_ai_person_part_mask() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn get_ai_model_registry_report() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn cancel_ai_model_load() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn evict_ai_model_session() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn check_ai_connector_status() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn test_ai_connector_connection() -> Result<serde_json::Value, CapabilityUnavailable> {
    ai_unavailable()
}

#[tauri::command]
pub fn invoke_generative_replace_with_mask_def() -> Result<serde_json::Value, CapabilityUnavailable>
{
    ai_unavailable()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_disabled_ai_command_returns_the_stable_typed_contract() {
        let errors = [
            generate_ai_subject_mask().unwrap_err(),
            generate_ai_object_mask_proposal().unwrap_err(),
            precompute_ai_subject_mask().unwrap_err(),
            generate_ai_foreground_mask().unwrap_err(),
            generate_ai_sky_mask().unwrap_err(),
            generate_ai_depth_mask().unwrap_err(),
            generate_ai_whole_person_mask().unwrap_err(),
            generate_ai_person_part_mask().unwrap_err(),
            get_ai_model_registry_report().unwrap_err(),
            cancel_ai_model_load().unwrap_err(),
            evict_ai_model_session().unwrap_err(),
            check_ai_connector_status().unwrap_err(),
            test_ai_connector_connection().unwrap_err(),
            invoke_generative_replace_with_mask_def().unwrap_err(),
        ];
        for error in errors {
            assert_eq!(
                serde_json::to_value(error).unwrap(),
                serde_json::json!({"code":"capability_unavailable","capability":"ai"})
            );
        }
    }
}
