//! Commands for loading LUT assets into the editor-owned cache.

use crate::AppState;

#[derive(serde::Serialize)]
pub(crate) struct LutParseResult {
    size: u32,
}

#[tauri::command]
pub(crate) async fn load_and_parse_lut(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<LutParseResult, String> {
    let lut = state.render().native_caches().get_or_load_lut(&path)?;
    Ok(LutParseResult { size: lut.size })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lut_parse_response_keeps_the_frontend_size_schema() {
        let response = LutParseResult { size: 33 };
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            json!({ "size": 33 })
        );
    }
}
