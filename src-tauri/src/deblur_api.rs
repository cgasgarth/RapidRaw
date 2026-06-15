use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeblurControlRequest {
    pub enabled: bool,
    pub sigma_px: f32,
    pub strength: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeblurDryRunResult {
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

pub fn validate_deblur_controls(
    controls: DeblurControlRequest,
) -> Result<DeblurDryRunResult, String> {
    if !controls.strength.is_finite() || !(0.0..=1.0).contains(&controls.strength) {
        return Err("Deblur strength must be between 0 and 1.".to_string());
    }
    if !controls.sigma_px.is_finite() || !(0.45..=1.35).contains(&controls.sigma_px) {
        return Err("Deblur sigmaPx must be between 0.45 and 1.35.".to_string());
    }

    Ok(DeblurDryRunResult {
        apply_status: if controls.enabled {
            "not_executed"
        } else {
            "not_requested"
        },
        dry_run: true,
        mutates: false,
        ordered_after: "scene_linear_denoise",
        ordered_before: "capture_sharpen",
        runtime_status: "ui_api_wired",
        skip_reason: if controls.enabled {
            Some("preview_not_wired")
        } else {
            Some("disabled")
        },
        stage: "scene_linear_post_denoise",
        warnings: vec![
            "Deblur controls are validated and saved, but preview/export application is not wired in this PR.",
        ],
    })
}

#[tauri::command]
pub fn dry_run_deblur_controls(
    controls: DeblurControlRequest,
) -> Result<DeblurDryRunResult, String> {
    validate_deblur_controls(controls)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_disabled_controls_without_runtime_apply() {
        let result = validate_deblur_controls(DeblurControlRequest {
            enabled: false,
            sigma_px: 0.8,
            strength: 0.0,
        })
        .expect("disabled deblur controls should validate");

        assert_eq!(result.apply_status, "not_requested");
        assert_eq!(result.runtime_status, "ui_api_wired");
        assert_eq!(result.skip_reason, Some("disabled"));
        assert!(!result.mutates);
    }

    #[test]
    fn rejects_out_of_range_sigma() {
        let result = validate_deblur_controls(DeblurControlRequest {
            enabled: true,
            sigma_px: 2.0,
            strength: 0.25,
        });

        assert!(result.is_err());
    }
}
