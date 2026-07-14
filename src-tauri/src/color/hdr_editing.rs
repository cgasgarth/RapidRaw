use image::{DynamicImage, ImageBuffer, Rgb};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::app::hdr_display_capability::{
    HdrDisplayCapabilityV1, HdrPresentationAuthority, HdrTransferFunction,
};
use crate::color::view_transform::{ViewTransformPlanV1, ViewTransformSettingsV1};
use crate::color::working_to_output_transform::WorkingColorState;
use crate::export::export_color_policy::{ExportColorProfile, ExportRenderingIntent};
use crate::export::export_encoders::encode_image_with_working_color_state;

pub const HDR_EDITING_IMPLEMENTATION_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EditingDynamicRangeMode {
    Sdr,
    Hdr,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HdrExportTargetV1 {
    SdrCompanionTiff16,
    HdrPq10,
    HdrHlg10,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SdrRenditionSettingsV1 {
    pub highlight_compression: f32,
    pub contrast: f32,
    pub shadow_lift: f32,
    pub saturation: f32,
    pub target_white_nits: f32,
}

impl Default for SdrRenditionSettingsV1 {
    fn default() -> Self {
        Self {
            highlight_compression: 0.55,
            contrast: 1.0,
            shadow_lift: 0.0,
            saturation: 1.0,
            target_white_nits: 203.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HdrEditingSettingsV1 {
    pub hdr_limit_stops: f32,
    pub mode: EditingDynamicRangeMode,
    pub sdr_rendition: SdrRenditionSettingsV1,
}

impl Default for HdrEditingSettingsV1 {
    fn default() -> Self {
        Self {
            hdr_limit_stops: 3.0,
            mode: EditingDynamicRangeMode::Sdr,
            sdr_rendition: SdrRenditionSettingsV1::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrViewTargetV1 {
    pub authoritative_hdr_preview: bool,
    pub black_luminance_nits: Option<f32>,
    pub capability_generation: u64,
    pub color_primaries: String,
    pub display_profile_sha256: String,
    pub fallback_reason: Option<String>,
    pub headroom_stops: f32,
    pub mode: EditingDynamicRangeMode,
    pub peak_luminance_nits: f32,
    pub presentation_authority: HdrPresentationAuthority,
    pub sdr_reference_white_nits: f32,
    pub transfer: HdrTransferFunction,
    pub white_xy: Option<[f32; 2]>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrExportPreflightV1 {
    pub bit_depth: Option<u8>,
    pub block_code: Option<String>,
    pub color_primaries: Option<String>,
    pub rendition: String,
    pub supported: bool,
    pub target: HdrExportTargetV1,
    pub transfer: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrExportReceiptV1 {
    pub bit_depth: u8,
    pub byte_size: usize,
    pub color_primaries: String,
    pub implementation_version: u32,
    pub plan_fingerprint: String,
    pub rendition: String,
    pub transfer: String,
    pub view_fingerprint: String,
}

pub struct HdrExportArtifactV1 {
    pub bytes: Vec<u8>,
    pub receipt: HdrExportReceiptV1,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrEditingPlanV1 {
    pub capability_fingerprint: u64,
    pub hdr_view: ViewTransformPlanV1,
    pub implementation_version: u32,
    pub mode: EditingDynamicRangeMode,
    pub plan_fingerprint: u64,
    pub presentation_target: HdrViewTargetV1,
    pub presentation_view: ViewTransformPlanV1,
    pub scene_edit_fingerprint: u64,
    pub sdr_rendition: SdrRenditionSettingsV1,
    pub sdr_view: ViewTransformPlanV1,
}

impl HdrEditingPlanV1 {
    pub fn compile(
        settings: HdrEditingSettingsV1,
        capability: &HdrDisplayCapabilityV1,
        capability_generation: u64,
        scene_edit_fingerprint: u64,
    ) -> Result<Self, String> {
        validate_settings(settings)?;
        let hdr_ratio = 2.0_f64.powf(f64::from(settings.hdr_limit_stops));
        let default_view = ViewTransformSettingsV1::default();
        let hdr_settings = ViewTransformSettingsV1 {
            source_white_ev: default_view
                .source_white_ev
                .max(f64::from(settings.hdr_limit_stops) + 2.0),
            target_white_linear: hdr_ratio,
            ..default_view
        };
        let hdr_view = ViewTransformPlanV1::compile(hdr_settings)?;

        let sdr_settings = ViewTransformSettingsV1 {
            contrast: f64::from(settings.sdr_rendition.contrast),
            target_black_linear: f64::from(settings.sdr_rendition.shadow_lift) * 0.04,
            source_white_ev: default_view.source_white_ev
                - f64::from(settings.sdr_rendition.highlight_compression) * 2.5,
            chroma_compression: (1.0 - f64::from(settings.sdr_rendition.saturation))
                .clamp(0.0, 1.0),
            ..default_view
        };
        let sdr_view = ViewTransformPlanV1::compile(sdr_settings)?;

        let native_hdr = settings.mode == EditingDynamicRangeMode::Hdr
            && capability.authoritative_hdr_preview
            && capability.presentation_authority == HdrPresentationAuthority::NativeHdr;
        let presentation_headroom = if native_hdr {
            settings
                .hdr_limit_stops
                .min(capability.current_headroom.log2() as f32)
        } else {
            0.0
        };
        let presentation_view = if native_hdr {
            let mut view = hdr_settings;
            view.target_white_linear = 2.0_f64.powf(f64::from(presentation_headroom));
            ViewTransformPlanV1::compile(view)?
        } else {
            sdr_view
        };
        let fallback_reason = if settings.mode == EditingDynamicRangeMode::Hdr && !native_hdr {
            Some(
                capability
                    .fallback_reason
                    .clone()
                    .unwrap_or_else(|| "native_hdr_presentation_unavailable".to_string()),
            )
        } else {
            None
        };
        let presentation_target = HdrViewTargetV1 {
            authoritative_hdr_preview: native_hdr,
            // AppKit exposes EDR headroom, but not trustworthy mastering black,
            // chromaticities, or a normalized primaries identifier. Keep those
            // unknown and bind presentation to the actual display ICC identity.
            black_luminance_nits: None,
            capability_generation,
            color_primaries: "active_display_icc".to_string(),
            display_profile_sha256: capability.display_profile_sha256.clone(),
            fallback_reason,
            headroom_stops: presentation_headroom,
            mode: if native_hdr {
                EditingDynamicRangeMode::Hdr
            } else {
                EditingDynamicRangeMode::Sdr
            },
            peak_luminance_nits: if native_hdr {
                capability.presentation_peak_nits as f32
            } else {
                settings.sdr_rendition.target_white_nits
            },
            presentation_authority: if native_hdr {
                HdrPresentationAuthority::NativeHdr
            } else if settings.mode == EditingDynamicRangeMode::Hdr {
                HdrPresentationAuthority::ToneMappedSdrFallback
            } else {
                HdrPresentationAuthority::SdrNative
            },
            sdr_reference_white_nits: settings.sdr_rendition.target_white_nits,
            transfer: if native_hdr {
                HdrTransferFunction::PlatformExtendedLinear
            } else {
                HdrTransferFunction::DisplayEncodedSrgb
            },
            white_xy: None,
        };
        let canonical = serde_json::to_vec(&(
            settings,
            capability.fingerprint,
            capability_generation,
            scene_edit_fingerprint,
            hdr_view.fingerprint,
            presentation_view.fingerprint,
            sdr_view.fingerprint,
        ))
        .map_err(|error| format!("hdr_editing_plan_encode:{error}"))?;
        let digest = Sha256::digest(canonical);
        let plan_fingerprint =
            u64::from_le_bytes(digest[..8].try_into().expect("sha256 prefix length"));
        Ok(Self {
            capability_fingerprint: capability.fingerprint,
            hdr_view,
            implementation_version: HDR_EDITING_IMPLEMENTATION_VERSION,
            mode: settings.mode,
            plan_fingerprint,
            presentation_target,
            presentation_view,
            scene_edit_fingerprint,
            sdr_rendition: settings.sdr_rendition,
            sdr_view,
        })
    }

    pub fn render_hdr_view(&self, scene_ap1: [f32; 3]) -> [f32; 3] {
        self.hdr_view.apply_rgb(scene_ap1)
    }

    pub fn render_presentation(&self, scene_ap1: [f32; 3]) -> [f32; 3] {
        self.presentation_view.apply_rgb(scene_ap1)
    }

    pub fn render_sdr_rendition(&self, scene_ap1: [f32; 3]) -> [f32; 3] {
        self.sdr_view.apply_rgb(scene_ap1)
    }

    pub fn export_preflight(&self, target: HdrExportTargetV1) -> HdrExportPreflightV1 {
        match target {
            HdrExportTargetV1::SdrCompanionTiff16 => HdrExportPreflightV1 {
                bit_depth: Some(16),
                block_code: None,
                color_primaries: Some("srgb_bt709".to_string()),
                rendition: "sdr_companion".to_string(),
                supported: true,
                target,
                transfer: Some("srgb".to_string()),
            },
            HdrExportTargetV1::HdrPq10 | HdrExportTargetV1::HdrHlg10 => HdrExportPreflightV1 {
                bit_depth: None,
                block_code: Some("hdr_export_metadata_encoder_unavailable".to_string()),
                color_primaries: None,
                rendition: "hdr_view".to_string(),
                supported: false,
                target,
                transfer: None,
            },
        }
    }

    pub fn export_sdr_companion_tiff16(
        &self,
        scene_ap1: &[[f32; 3]],
        width: u32,
        height: u32,
    ) -> Result<HdrExportArtifactV1, String> {
        let expected = usize::try_from(width)
            .ok()
            .and_then(|width| {
                usize::try_from(height)
                    .ok()
                    .and_then(|height| width.checked_mul(height))
            })
            .ok_or_else(|| "hdr_sdr_rendition_dimensions_overflow".to_string())?;
        if expected == 0 || scene_ap1.len() != expected {
            return Err("hdr_sdr_rendition_pixel_count_mismatch".to_string());
        }
        let pixels = scene_ap1
            .iter()
            .copied()
            .map(|pixel| Rgb(self.render_sdr_rendition(pixel)))
            .collect::<Vec<_>>();
        let image = DynamicImage::ImageRgb32F(
            ImageBuffer::from_vec(
                width,
                height,
                pixels.into_iter().flat_map(|pixel| pixel.0).collect(),
            )
            .ok_or_else(|| "hdr_sdr_rendition_image_build_failed".to_string())?,
        );
        let encoded = encode_image_with_working_color_state(
            &image,
            WorkingColorState::AcesCgLinearV1,
            "tiff",
            100,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            None,
        )?;
        let receipt = HdrExportReceiptV1 {
            bit_depth: encoded
                .color_policy
                .as_ref()
                .map_or(16, |policy| policy.bit_depth),
            byte_size: encoded.bytes.len(),
            color_primaries: "srgb_bt709".to_string(),
            implementation_version: self.implementation_version,
            plan_fingerprint: format!("{:016x}", self.plan_fingerprint),
            rendition: "sdr_companion".to_string(),
            transfer: "srgb".to_string(),
            view_fingerprint: format!("{:016x}", self.sdr_view.fingerprint),
        };
        Ok(HdrExportArtifactV1 {
            bytes: encoded.bytes,
            receipt,
        })
    }
}

fn validate_settings(settings: HdrEditingSettingsV1) -> Result<(), String> {
    let sdr = settings.sdr_rendition;
    let values = [
        settings.hdr_limit_stops,
        sdr.highlight_compression,
        sdr.contrast,
        sdr.shadow_lift,
        sdr.saturation,
        sdr.target_white_nits,
    ];
    if values.into_iter().any(|value| !value.is_finite()) {
        return Err("hdr_editing_non_finite_setting".to_string());
    }
    if !(1.0..=6.0).contains(&settings.hdr_limit_stops)
        || !(0.0..=1.0).contains(&sdr.highlight_compression)
        || !(0.5..=1.5).contains(&sdr.contrast)
        || !(0.0..=1.0).contains(&sdr.shadow_lift)
        || !(0.0..=1.5).contains(&sdr.saturation)
        || !(80.0..=300.0).contains(&sdr.target_white_nits)
    {
        return Err("hdr_editing_setting_out_of_range".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use image::ImageFormat;

    use super::*;
    use crate::app::hdr_display_capability::{EdrHeadroomSample, compile_hdr_display_capability};

    fn settings() -> HdrEditingSettingsV1 {
        HdrEditingSettingsV1 {
            hdr_limit_stops: 3.0,
            mode: EditingDynamicRangeMode::Hdr,
            sdr_rendition: SdrRenditionSettingsV1::default(),
        }
    }

    fn native_capability() -> HdrDisplayCapabilityV1 {
        compile_hdr_display_capability(
            "display-p3-profile".to_string(),
            EdrHeadroomSample {
                current: Some(4.0),
                potential: Some(8.0),
                reference: Some(1.0),
            },
            true,
        )
    }

    #[test]
    fn one_scene_edit_compiles_distinct_hdr_presentation_and_sdr_views() {
        let plan = HdrEditingPlanV1::compile(settings(), &native_capability(), 7, 0x1234).unwrap();
        assert_eq!(plan.scene_edit_fingerprint, 0x1234);
        assert_eq!(plan.hdr_view.target_white_linear, 8.0);
        assert_eq!(plan.presentation_view.target_white_linear, 4.0);
        assert_eq!(plan.sdr_view.target_white_linear, 1.0);
        assert!(plan.presentation_target.authoritative_hdr_preview);
        assert_eq!(
            plan.presentation_target.color_primaries,
            "active_display_icc"
        );
        assert_eq!(plan.presentation_target.white_xy, None);
        assert_eq!(plan.presentation_target.black_luminance_nits, None);
        assert_eq!(
            plan.presentation_target.presentation_authority,
            HdrPresentationAuthority::NativeHdr
        );
        let hdr = plan.render_hdr_view([4.0, 4.0, 4.0]);
        let presented = plan.render_presentation([4.0, 4.0, 4.0]);
        let sdr = plan.render_sdr_rendition([4.0, 4.0, 4.0]);
        assert!(
            hdr[0] > 1.0,
            "HDR view must preserve values above SDR white"
        );
        assert!(presented[0] > 1.0 && presented[0] <= 4.0);
        assert!((0.0..=1.0).contains(&sdr[0]));
    }

    #[test]
    fn incapable_display_uses_a_truthful_sdr_fallback_without_mutating_hdr_view() {
        let capability = compile_hdr_display_capability(
            "sdr-surface".to_string(),
            EdrHeadroomSample {
                current: Some(2.0),
                potential: Some(4.0),
                reference: Some(1.0),
            },
            false,
        );
        let plan = HdrEditingPlanV1::compile(settings(), &capability, 9, 77).unwrap();
        assert!(!plan.presentation_target.authoritative_hdr_preview);
        assert_eq!(
            plan.presentation_target.presentation_authority,
            HdrPresentationAuthority::ToneMappedSdrFallback
        );
        assert_eq!(
            plan.presentation_target.fallback_reason.as_deref(),
            Some("hdr_surface_contract_not_accepted")
        );
        assert!(plan.render_hdr_view([4.0; 3])[0] > 1.0);
        assert!(plan.render_presentation([4.0; 3])[0] <= 1.0);
    }

    #[test]
    fn export_preflight_rejects_untruthful_hdr_and_tiff_readback_proves_sdr_companion() {
        let plan = HdrEditingPlanV1::compile(settings(), &native_capability(), 7, 0x1234).unwrap();
        let blocked = plan.export_preflight(HdrExportTargetV1::HdrPq10);
        assert!(!blocked.supported);
        assert_eq!(
            blocked.block_code.as_deref(),
            Some("hdr_export_metadata_encoder_unavailable")
        );
        assert!(
            plan.export_preflight(HdrExportTargetV1::SdrCompanionTiff16)
                .supported
        );
        let artifact = plan
            .export_sdr_companion_tiff16(&[[0.18; 3], [4.0; 3]], 2, 1)
            .unwrap();
        assert_eq!(artifact.receipt.bit_depth, 16);
        assert_eq!(artifact.receipt.rendition, "sdr_companion");
        assert_eq!(artifact.receipt.byte_size, artifact.bytes.len());
        let decoded = image::load_from_memory_with_format(&artifact.bytes, ImageFormat::Tiff)
            .unwrap()
            .to_rgb16();
        assert_eq!(decoded.dimensions(), (2, 1));
        let pixels = decoded.into_raw();
        assert!(
            pixels[3] > pixels[0],
            "highlight rendition must remain brighter than middle grey"
        );
    }

    #[test]
    fn target_and_settings_changes_invalidate_plan_identity() {
        let capability = native_capability();
        let first = HdrEditingPlanV1::compile(settings(), &capability, 7, 42).unwrap();
        let mut changed = settings();
        changed.hdr_limit_stops = 4.0;
        let second = HdrEditingPlanV1::compile(changed, &capability, 7, 42).unwrap();
        let third = HdrEditingPlanV1::compile(settings(), &capability, 8, 42).unwrap();
        assert_ne!(first.plan_fingerprint, second.plan_fingerprint);
        assert_ne!(first.plan_fingerprint, third.plan_fingerprint);
        assert_eq!(first.scene_edit_fingerprint, second.scene_edit_fingerprint);
    }
}
