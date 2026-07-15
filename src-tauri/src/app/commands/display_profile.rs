//! Commands exposing the display-profile runtime service.

#[tauri::command]
pub(crate) fn get_active_display_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<crate::display_profile::ActiveDisplayProfile, String> {
    state.services.display_profile.active_profile_for_app(&app)
}

#[tauri::command]
pub(crate) fn get_display_preview_lut_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<crate::display_profile::DisplayPreviewLutStatus, String> {
    state
        .services
        .display_profile
        .preview_lut_status_for_app(&app)
}
