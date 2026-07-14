use serde::{Deserialize, Serialize};

use super::negative_conversion::negative_lab_hd_paper_curve::NegativeLabHdPaperCurveParams;
use super::negative_conversion::{NegativeLabProcessFamily, NegativeLabRenderIntent};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) struct NegativeLabPaperProfileSnapshot {
    pub profile_id: String,
    pub profile_version: u8,
    pub process_family: String,
    pub claim_class: String,
    pub d_min: f32,
    pub d_max: f32,
    pub toe_knee: f32,
    pub shoulder_knee: f32,
    pub midtone_gamma: f32,
    pub channel_cmy: [f32; 3],
    pub base_tint: [f32; 3],
    pub source_references: Vec<String>,
    pub content_hash: String,
}

impl NegativeLabPaperProfileSnapshot {
    pub(crate) fn neutral() -> Self {
        Self {
            profile_id: "negative_lab.paper.c41.neutral.v1".into(),
            profile_version: 1,
            process_family: "c41_color_negative".into(),
            claim_class: "generic_starting_point".into(),
            d_min: 0.04,
            d_max: 1.65,
            toe_knee: 0.25,
            shoulder_knee: 0.25,
            midtone_gamma: 1.0,
            channel_cmy: [0.0; 3],
            base_tint: [0.0; 3],
            source_references: vec!["rawengine_default_negative_lab_v1".into()],
            content_hash: "fnv1a32:neutral_v1".into(),
        }
    }

    pub(crate) fn sanitized(self) -> Self {
        let neutral = Self::neutral();
        let finite = |value: f32, fallback: f32| if value.is_finite() { value } else { fallback };
        Self {
            profile_id: if self.profile_id.trim().is_empty() {
                neutral.profile_id
            } else {
                self.profile_id
            },
            profile_version: 1,
            process_family: if self.process_family.trim().is_empty() {
                neutral.process_family
            } else {
                self.process_family
            },
            claim_class: if self.claim_class.trim().is_empty() {
                neutral.claim_class
            } else {
                self.claim_class
            },
            d_min: finite(self.d_min, neutral.d_min).clamp(0.0, 1.0),
            d_max: finite(self.d_max, neutral.d_max).clamp(0.8, 3.0),
            toe_knee: finite(self.toe_knee, neutral.toe_knee).clamp(0.01, 1.0),
            shoulder_knee: finite(self.shoulder_knee, neutral.shoulder_knee).clamp(0.01, 1.0),
            midtone_gamma: finite(self.midtone_gamma, neutral.midtone_gamma).clamp(0.5, 2.0),
            channel_cmy: self
                .channel_cmy
                .map(|value| finite(value, 0.0).clamp(-0.25, 0.25)),
            base_tint: self
                .base_tint
                .map(|value| finite(value, 0.0).clamp(-0.25, 0.25)),
            source_references: if self.source_references.is_empty() {
                neutral.source_references
            } else {
                self.source_references
            },
            content_hash: if self.content_hash.trim().is_empty() {
                neutral.content_hash
            } else {
                self.content_hash
            },
        }
    }

    pub(crate) fn compatible_with(
        &self,
        process_family: NegativeLabProcessFamily,
        intent: NegativeLabRenderIntent,
    ) -> bool {
        let process_ok = match process_family {
            NegativeLabProcessFamily::C41ColorNegative => {
                self.process_family == "c41_color_negative"
            }
            NegativeLabProcessFamily::BlackAndWhiteSilverNegative => {
                self.process_family == "black_and_white_silver_negative"
            }
        };
        process_ok && intent == NegativeLabRenderIntent::Print
    }

    pub(crate) fn to_hd_curve(&self) -> NegativeLabHdPaperCurveParams {
        let profile = self.clone().sanitized();
        NegativeLabHdPaperCurveParams {
            iso_r_grade: 1.0,
            anchor_density: 0.5,
            density_offset: profile.base_tint.iter().sum::<f32>() / 3.0,
            d_min: profile.d_min,
            d_max: profile.d_max,
            toe_width: 0.25,
            shoulder_width: 0.25,
            toe_strength: profile.toe_knee,
            shoulder_strength: profile.shoulder_knee,
            midtone_shape: profile.midtone_gamma - 1.0,
            algorithm_version: 1,
            schema_version: 2,
            output_domain: "scene_linear_print".into(),
        }
        .sanitized()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_is_exact_default_curve() {
        let neutral = NegativeLabPaperProfileSnapshot::neutral().to_hd_curve();
        assert_eq!(neutral, NegativeLabHdPaperCurveParams::default());
    }

    #[test]
    fn incompatible_profile_fails_closed() {
        let mut profile = NegativeLabPaperProfileSnapshot::neutral();
        profile.process_family = "black_and_white_silver_negative".into();
        assert!(!profile.compatible_with(
            NegativeLabProcessFamily::C41ColorNegative,
            NegativeLabRenderIntent::Print
        ));
        assert!(!profile.compatible_with(
            NegativeLabProcessFamily::BlackAndWhiteSilverNegative,
            NegativeLabRenderIntent::FlatLogMaster
        ));
    }

    #[test]
    fn generic_snapshot_changes_curve_terms() {
        let mut profile = NegativeLabPaperProfileSnapshot::neutral();
        profile.d_max = 1.9;
        profile.toe_knee = 0.45;
        let curve = profile.to_hd_curve();
        assert!(curve.d_max > NegativeLabHdPaperCurveParams::default().d_max);
        assert!(curve.toe_strength > NegativeLabHdPaperCurveParams::default().toe_strength);
    }
}
