//! Commands for loading LUT assets into the editor-owned cache.

use crate::{AppState, LutParseResult, get_or_load_lut};

#[tauri::command]
pub(crate) async fn load_and_parse_lut(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<LutParseResult, String> {
    let lut = get_or_load_lut(&state, &path)?;
    Ok(LutParseResult { size: lut.size })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::thread;

    #[test]
    fn lut_parse_response_keeps_the_frontend_size_schema() {
        let response = LutParseResult { size: 33 };
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            json!({ "size": 33 })
        );
    }

    #[test]
    fn lut_parse_response_construction_is_safe_for_concurrent_requests() {
        let workers = (0..8)
            .map(|size| {
                thread::spawn(move || serde_json::to_value(LutParseResult { size }).unwrap())
            })
            .collect::<Vec<_>>();
        for (size, worker) in workers.into_iter().enumerate() {
            assert_eq!(
                worker.join().expect("LUT response worker"),
                json!({ "size": size })
            );
        }
    }
}
