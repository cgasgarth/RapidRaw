use serde_json::Value;

const AI_UNAVAILABLE: &str = "ai_capability_unavailable:build_without_ai_feature";

macro_rules! unavailable_command {
    ($name:ident) => {
        #[tauri::command]
        pub async fn $name() -> Result<Value, String> {
            Err(AI_UNAVAILABLE.to_string())
        }
    };
}

unavailable_command!(generate_ai_subject_mask);
unavailable_command!(generate_ai_object_mask_proposal);
unavailable_command!(precompute_ai_subject_mask);
unavailable_command!(generate_ai_foreground_mask);
unavailable_command!(generate_ai_sky_mask);
unavailable_command!(generate_ai_depth_mask);
unavailable_command!(generate_ai_whole_person_mask);
unavailable_command!(generate_ai_person_part_mask);
unavailable_command!(invoke_generative_replace_with_mask_def);

#[tauri::command]
pub fn get_ai_model_registry_report() -> Value {
    serde_json::json!({
        "available": false,
        "reason": AI_UNAVAILABLE,
        "models": [],
        "residentBytes": 0,
    })
}

#[tauri::command]
pub fn cancel_ai_model_load() -> bool {
    false
}

#[tauri::command]
pub fn evict_ai_model_session() -> bool {
    false
}

#[tauri::command]
pub async fn check_ai_connector_status(app_handle: tauri::AppHandle) {
    let settings = crate::app_settings::load_settings_or_default(&app_handle);
    let connected = if let Some(address) = settings.ai_connector_address {
        super::ai_connector::check_status(&address)
            .await
            .unwrap_or(false)
    } else {
        false
    };
    use tauri::Emitter;
    let _ = app_handle.emit(crate::events::AI_CONNECTOR_STATUS_UPDATE, connected);
}

#[tauri::command]
pub async fn test_ai_connector_connection(address: String) -> Result<(), String> {
    super::ai_connector::check_status(&address)
        .await
        .map_err(|error| error.to_string())?
        .then_some(())
        .ok_or_else(|| "ai_connector_unavailable".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_ai_commands_fail_with_typed_capability_error() {
        assert_eq!(generate_ai_sky_mask().await.unwrap_err(), AI_UNAVAILABLE);
        assert!(!cancel_ai_model_load());
        assert_eq!(get_ai_model_registry_report()["available"], false);
    }
}
