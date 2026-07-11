use std::path::Path;

use serde::Serialize;

pub const MODEL_ID: &str = "swinir-classical-df2k-x2-medium-opset17-v1";
pub const MODEL_SHA256: &str = "UNPUBLISHED_UNTIL_WEIGHT_REDISTRIBUTION_IS_VERIFIED";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwinIrCapability {
    pub schema_version: u32,
    pub available: bool,
    pub model_id: &'static str,
    pub model_size_bytes: u64,
    pub source_url: &'static str,
    pub code_license: &'static str,
    pub weight_license_status: &'static str,
    pub reason: Option<&'static str>,
}

pub fn capability(provisioned_path: Option<&Path>) -> SwinIrCapability {
    let available = provisioned_path.is_some_and(|path| verify_provisioned_model(path).is_ok());
    SwinIrCapability {
        schema_version: 1,
        available,
        model_id: MODEL_ID,
        model_size_bytes: provisioned_path
            .and_then(|path| path.metadata().ok())
            .map_or(0, |metadata| metadata.len()),
        source_url: "https://github.com/JingyunLiang/SwinIR/releases/tag/v0.0",
        code_license: "Apache-2.0",
        weight_license_status: "redistribution_unverified",
        reason: (!available).then_some("weight_redistribution_unverified_no_distributed_onnx"),
    }
}

pub fn verify_provisioned_model(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("swinir_x2_provisioned_model_missing".to_string());
    }
    if MODEL_SHA256.starts_with("UNPUBLISHED_") {
        return Err("swinir_x2_disabled_no_approved_model_hash".to_string());
    }
    if !crate::ai::ai_processing::verify_sha256(path, MODEL_SHA256)
        .map_err(|error| format!("swinir_x2_model_hash_failed:{error}"))?
    {
        return Err("swinir_x2_model_hash_mismatch".to_string());
    }
    Ok(())
}
