use serde::{Deserialize, Serialize};

use crate::app_state::AppState;

use super::apply::{SingleImageX2ApplyReceipt, SingleImageX2ApplyRequest, apply_request};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SingleImageX2BatchRequest {
    pub items: Vec<SingleImageX2ApplyRequest>,
    pub stop_on_error: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleImageX2BatchItemReceipt {
    pub source_path: String,
    pub status: &'static str,
    pub output: Option<SingleImageX2ApplyReceipt>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleImageX2BatchReceipt {
    pub schema_version: u32,
    pub execution_policy: &'static str,
    pub items: Vec<SingleImageX2BatchItemReceipt>,
}

#[tauri::command]
pub async fn queue_single_image_x2_batch(
    request: SingleImageX2BatchRequest,
    state: tauri::State<'_, AppState>,
) -> Result<SingleImageX2BatchReceipt, String> {
    if request.items.is_empty() {
        return Err("single_image_x2_batch_empty".to_string());
    }
    let mut receipts = Vec::with_capacity(request.items.len());
    for item in request.items {
        let source_path = item.source_path.clone();
        match apply_request(item, &state).await {
            Ok(output) => receipts.push(SingleImageX2BatchItemReceipt {
                source_path,
                status: "complete",
                output: Some(output),
                error: None,
            }),
            Err(error) => {
                receipts.push(SingleImageX2BatchItemReceipt {
                    source_path,
                    status: if error.contains("cancel") {
                        "cancelled"
                    } else {
                        "failed"
                    },
                    output: None,
                    error: Some(sanitize_error(&error)),
                });
                if request.stop_on_error {
                    break;
                }
            }
        }
    }
    Ok(SingleImageX2BatchReceipt {
        schema_version: 1,
        execution_policy: "sequential_one_active_item",
        items: receipts,
    })
}

fn sanitize_error(error: &str) -> String {
    error
        .split(':')
        .next()
        .unwrap_or("single_image_x2_failed")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::sanitize_error;

    #[test]
    fn batch_receipts_do_not_leak_error_details() {
        assert_eq!(
            sanitize_error("single_image_x2_encode_failed:/private/output"),
            "single_image_x2_encode_failed"
        );
    }
}
