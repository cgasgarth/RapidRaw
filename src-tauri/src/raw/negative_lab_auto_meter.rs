use serde::{Deserialize, Serialize};

use super::negative_conversion::NegativeLabRenderIntent;

const DEFAULT_CONFIDENCE_THRESHOLD: f32 = 0.58;
const REFERENCE_TEXTURAL_RANGE: f32 = 0.34;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct NegativeLabAutoMeterControls {
    #[serde(default)]
    pub auto_density_enabled: bool,
    #[serde(default = "default_strength")]
    pub auto_density_strength: f32,
    #[serde(default = "default_anchor_density")]
    pub auto_density_anchor: f32,
    #[serde(default)]
    pub auto_grade_enabled: bool,
    #[serde(default = "default_strength")]
    pub auto_grade_strength: f32,
    #[serde(default = "default_confidence_threshold")]
    pub confidence_threshold: f32,
}

const fn default_strength() -> f32 {
    1.0
}

const fn default_anchor_density() -> f32 {
    0.5
}

const fn default_confidence_threshold() -> f32 {
    DEFAULT_CONFIDENCE_THRESHOLD
}

impl Default for NegativeLabAutoMeterControls {
    fn default() -> Self {
        Self {
            auto_density_enabled: false,
            auto_density_strength: default_strength(),
            auto_density_anchor: default_anchor_density(),
            auto_grade_enabled: false,
            auto_grade_strength: default_strength(),
            confidence_threshold: default_confidence_threshold(),
        }
    }
}

impl NegativeLabAutoMeterControls {
    pub(crate) fn sanitized(self) -> Self {
        let finite = |value: f32, fallback: f32| {
            if value.is_finite() { value } else { fallback }
        };
        Self {
            auto_density_enabled: self.auto_density_enabled,
            auto_density_strength: finite(self.auto_density_strength, 1.0).clamp(0.0, 1.0),
            auto_density_anchor: finite(self.auto_density_anchor, 0.5).clamp(0.2, 0.8),
            auto_grade_enabled: self.auto_grade_enabled,
            auto_grade_strength: finite(self.auto_grade_strength, 1.0).clamp(0.0, 1.0),
            confidence_threshold: finite(self.confidence_threshold, DEFAULT_CONFIDENCE_THRESHOLD)
                .clamp(0.3, 0.95),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegativeLabAutoMeterReceipt {
    pub algorithm_id: String,
    pub algorithm_version: u8,
    pub sample_count: u32,
    pub luma_density_p10: f32,
    pub luma_density_p50: f32,
    pub luma_density_p90: f32,
    pub textural_density_range_p10_p90: f32,
    pub bounded_density_range: f32,
    pub confidence: f32,
    pub confidence_threshold: f32,
    pub requested_auto_density_enabled: bool,
    pub requested_auto_density_strength: f32,
    pub requested_auto_grade_enabled: bool,
    pub requested_auto_grade_strength: f32,
    pub applied_density_offset: f32,
    pub effective_iso_r_grade: f32,
    pub density_applied: bool,
    pub grade_applied: bool,
    pub warning_codes: Vec<String>,
}

fn percentile(sorted: &[f32], fraction: f32) -> f32 {
    if sorted.is_empty() {
        return 0.0;
    }
    let position = fraction.clamp(0.0, 1.0) * (sorted.len().saturating_sub(1) as f32);
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let blend = position - lower as f32;
    sorted[lower] + (sorted[upper] - sorted[lower]) * blend
}

pub(crate) fn measure_auto_meter(
    model_density: &[f32],
    controls: &NegativeLabAutoMeterControls,
    clipped_pixel_count: u32,
    render_intent: NegativeLabRenderIntent,
) -> NegativeLabAutoMeterReceipt {
    let controls = controls.sanitized();
    let mut luma_values: Vec<f32> = model_density
        .chunks_exact(3)
        .filter_map(|pixel| {
            if pixel.iter().all(|value| value.is_finite()) {
                Some((0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]).clamp(0.0, 1.0))
            } else {
                None
            }
        })
        .collect();
    luma_values.sort_by(f32::total_cmp);
    let sample_count = luma_values.len() as u32;
    let p10 = percentile(&luma_values, 0.1);
    let p50 = percentile(&luma_values, 0.5);
    let p90 = percentile(&luma_values, 0.9);
    let textural_range = (p90 - p10).max(0.0);
    let bounded_range =
        luma_values.last().copied().unwrap_or(0.0) - luma_values.first().copied().unwrap_or(0.0);
    let clip_fraction = clipped_pixel_count as f32 / sample_count.max(1) as f32;
    let mut confidence = 0.94;
    if sample_count < 64 {
        confidence -= 0.32;
    }
    if textural_range < 0.05 {
        confidence -= 0.25;
    }
    if clip_fraction > 0.0 {
        confidence -= (clip_fraction * 0.8).min(0.35);
    }
    confidence = confidence.clamp(0.05, 0.98);
    let eligible = render_intent == NegativeLabRenderIntent::Print
        && sample_count >= 16
        && confidence >= controls.confidence_threshold;
    let mut warning_codes = Vec::new();
    if sample_count < 16 {
        warning_codes.push("insufficient_density_samples".to_string());
    }
    if textural_range < 0.05 {
        warning_codes.push("flat_density_field".to_string());
    }
    if clipped_pixel_count > 0 {
        warning_codes.push("clipped_transmittance_samples".to_string());
    }
    if render_intent != NegativeLabRenderIntent::Print {
        warning_codes.push("flat_log_master_intent".to_string());
    }
    if confidence < controls.confidence_threshold {
        warning_codes.push("confidence_below_apply_threshold".to_string());
    }

    let density_applied = controls.auto_density_enabled && eligible;
    let grade_applied = controls.auto_grade_enabled && eligible;
    let applied_density_offset = if density_applied {
        ((controls.auto_density_anchor - p50) * controls.auto_density_strength * 0.6)
            .clamp(-0.25, 0.25)
    } else {
        0.0
    };
    let effective_iso_r_grade = if grade_applied {
        (1.0 + ((textural_range - REFERENCE_TEXTURAL_RANGE) / REFERENCE_TEXTURAL_RANGE)
            * controls.auto_grade_strength
            * 0.4)
            .clamp(0.75, 1.4)
    } else {
        1.0
    };

    NegativeLabAutoMeterReceipt {
        algorithm_id: "native_negative_lab_auto_meter_v1".to_string(),
        algorithm_version: 1,
        sample_count,
        luma_density_p10: p10,
        luma_density_p50: p50,
        luma_density_p90: p90,
        textural_density_range_p10_p90: textural_range,
        bounded_density_range: bounded_range,
        confidence,
        confidence_threshold: controls.confidence_threshold,
        requested_auto_density_enabled: controls.auto_density_enabled,
        requested_auto_density_strength: controls.auto_density_strength,
        requested_auto_grade_enabled: controls.auto_grade_enabled,
        requested_auto_grade_strength: controls.auto_grade_strength,
        applied_density_offset,
        effective_iso_r_grade,
        density_applied,
        grade_applied,
        warning_codes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(start: f32, end: f32) -> Vec<f32> {
        (0..100)
            .flat_map(|index| {
                let value = start + (end - start) * index as f32 / 99.0;
                [value, value, value]
            })
            .collect()
    }

    #[test]
    fn disabled_controls_are_exact_identity() {
        let receipt = measure_auto_meter(
            &ramp(0.1, 0.9),
            &NegativeLabAutoMeterControls::default(),
            0,
            NegativeLabRenderIntent::Print,
        );
        assert_eq!(receipt.applied_density_offset, 0.0);
        assert_eq!(receipt.effective_iso_r_grade, 1.0);
        assert!(!receipt.density_applied);
        assert!(!receipt.grade_applied);
    }

    #[test]
    fn enabled_controls_apply_bounded_density_and_grade() {
        let controls = NegativeLabAutoMeterControls {
            auto_density_enabled: true,
            auto_grade_enabled: true,
            ..Default::default()
        };
        let receipt = measure_auto_meter(
            &ramp(0.1, 0.9),
            &controls,
            0,
            NegativeLabRenderIntent::Print,
        );
        assert!(receipt.density_applied);
        assert!(receipt.grade_applied);
        assert!(receipt.applied_density_offset.abs() <= 0.25);
        assert!((0.75..=1.4).contains(&receipt.effective_iso_r_grade));
    }

    #[test]
    fn low_confidence_declines_without_stacking() {
        let controls = NegativeLabAutoMeterControls {
            auto_density_enabled: true,
            auto_grade_enabled: true,
            ..Default::default()
        };
        let values = ramp(0.45, 0.46);
        let first = measure_auto_meter(&values, &controls, 100, NegativeLabRenderIntent::Print);
        let second = measure_auto_meter(&values, &controls, 100, NegativeLabRenderIntent::Print);
        assert_eq!(first.applied_density_offset, 0.0);
        assert_eq!(first.effective_iso_r_grade, 1.0);
        assert_eq!(first, second);
    }
}
