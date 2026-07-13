use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DenoiseControlRequest {
    pub chroma_strength: f32,
    #[serde(default = "default_half")]
    pub contrast_protection: f32,
    #[serde(default = "default_half")]
    pub detail: f32,
    pub luma_strength: f32,
    #[serde(default)]
    pub natural_grain: f32,
    #[serde(default)]
    pub shadow_bias: f32,
}

const fn default_half() -> f32 {
    0.5
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DenoiseDryRunResult {
    pub apply_status: &'static str,
    pub dry_run: bool,
    pub mutates: bool,
    pub ordered_after: &'static str,
    pub ordered_before: &'static str,
    pub runtime_status: &'static str,
    pub skip_reason: Option<&'static str>,
    pub stage: &'static str,
    pub warnings: Vec<&'static str>,
}

pub fn validate_denoise_controls(
    controls: DenoiseControlRequest,
) -> Result<DenoiseDryRunResult, String> {
    if !controls.luma_strength.is_finite() || !(0.0..=1.0).contains(&controls.luma_strength) {
        return Err("Denoise luma strength must be between 0 and 1.".to_string());
    }
    if !controls.chroma_strength.is_finite() || !(0.0..=1.0).contains(&controls.chroma_strength) {
        return Err("Denoise chroma strength must be between 0 and 1.".to_string());
    }
    for (name, value) in [
        ("detail", controls.detail),
        ("natural grain", controls.natural_grain),
        ("contrast protection", controls.contrast_protection),
    ] {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(format!("Denoise {name} must be between 0 and 1."));
        }
    }
    if !controls.shadow_bias.is_finite() || !(-1.0..=1.0).contains(&controls.shadow_bias) {
        return Err("Denoise shadow bias must be between -1 and 1.".to_string());
    }

    let enabled = controls.luma_strength > f32::EPSILON || controls.chroma_strength > f32::EPSILON;

    Ok(DenoiseDryRunResult {
        apply_status: if enabled {
            "not_executed"
        } else {
            "not_requested"
        },
        dry_run: true,
        mutates: false,
        ordered_after: "demosaic",
        ordered_before: "scene_linear_deblur",
        runtime_status: "preview_export_parity",
        skip_reason: if enabled {
            Some("dry_run")
        } else {
            Some("disabled")
        },
        stage: "scene_linear_denoise",
        warnings: vec![
            "Dry run validates controls without executing pixels; real-RAW quality and E2E remain separate proofs.",
        ],
    })
}

#[tauri::command]
pub fn dry_run_denoise_controls(
    controls: DenoiseControlRequest,
) -> Result<DenoiseDryRunResult, String> {
    validate_denoise_controls(controls)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_disabled_controls_without_runtime_apply() {
        let result = validate_denoise_controls(DenoiseControlRequest {
            chroma_strength: 0.0,
            contrast_protection: 0.5,
            detail: 0.5,
            luma_strength: 0.0,
            natural_grain: 0.0,
            shadow_bias: 0.0,
        })
        .expect("disabled denoise controls should validate");

        assert_eq!(result.apply_status, "not_requested");
        assert_eq!(result.runtime_status, "preview_export_parity");
        assert_eq!(result.skip_reason, Some("disabled"));
        assert!(!result.mutates);
    }

    #[test]
    fn rejects_out_of_range_luma_strength() {
        let result = validate_denoise_controls(DenoiseControlRequest {
            chroma_strength: 0.25,
            contrast_protection: 0.5,
            detail: 0.5,
            luma_strength: 1.25,
            natural_grain: 0.0,
            shadow_bias: 0.0,
        });

        assert!(result.is_err());
    }
}
