use image::{DynamicImage, ImageBuffer, Rgb, Rgba};
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
pub const SDR_RENDITION_IMPLEMENTATION_VERSION: u32 = 1;

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
pub struct HdrExportCapabilityCatalogV1 {
    pub implementation_version: u32,
    pub targets: Vec<HdrExportPreflightV1>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrExportReceiptV1 {
    pub bit_depth: u8,
    pub byte_size: usize,
    pub color_primaries: String,
    pub color_policy_fingerprint: String,
    pub file_format: String,
    pub implementation_version: u32,
    pub plan_fingerprint: String,
    pub rendition: String,
    pub scene_edit_fingerprint: String,
    pub target: HdrExportTargetV1,
    pub transfer: String,
    pub view_fingerprint: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HdrExportWorkflowSettingsV1 {
    pub sdr_rendition: SdrRenditionSettingsV1,
    pub target: HdrExportTargetV1,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdrRenditionPlanV1 {
    pub implementation_version: u32,
    pub plan_fingerprint: u64,
    pub scene_edit_fingerprint: u64,
    pub settings: SdrRenditionSettingsV1,
    pub view: ViewTransformPlanV1,
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

impl SdrRenditionPlanV1 {
    pub fn compile(
        settings: SdrRenditionSettingsV1,
        scene_edit_fingerprint: u64,
    ) -> Result<Self, String> {
        validate_sdr_settings(settings)?;
        let default_view = ViewTransformSettingsV1::default();
        let view = ViewTransformPlanV1::compile(ViewTransformSettingsV1 {
            contrast: f64::from(settings.contrast),
            target_black_linear: f64::from(settings.shadow_lift) * 0.04,
            source_white_ev: default_view.source_white_ev
                - f64::from(settings.highlight_compression) * 2.5,
            chroma_compression: (1.0 - f64::from(settings.saturation)).clamp(0.0, 1.0),
            ..default_view
        })?;
        let canonical = serde_json::to_vec(&(
            settings,
            scene_edit_fingerprint,
            view.fingerprint,
            SDR_RENDITION_IMPLEMENTATION_VERSION,
        ))
        .map_err(|error| format!("sdr_rendition_plan_encode:{error}"))?;
        let digest = Sha256::digest(canonical);
        Ok(Self {
            implementation_version: SDR_RENDITION_IMPLEMENTATION_VERSION,
            plan_fingerprint: u64::from_le_bytes(
                digest[..8].try_into().expect("sha256 prefix length"),
            ),
            scene_edit_fingerprint,
            settings,
            view,
        })
    }

    pub fn apply_rgb(&self, scene_ap1: [f32; 3]) -> [f32; 3] {
        self.view.apply_rgb(scene_ap1)
    }

    pub fn apply_image(&self, scene_ap1: &DynamicImage) -> DynamicImage {
        let source = scene_ap1.to_rgba32f();
        DynamicImage::ImageRgba32F(ImageBuffer::from_fn(
            source.width(),
            source.height(),
            |x, y| {
                let pixel = source.get_pixel(x, y).0;
                let rendered = self.apply_rgb([pixel[0], pixel[1], pixel[2]]);
                Rgba([rendered[0], rendered[1], rendered[2], pixel[3]])
            },
        ))
    }

    pub fn preflight(
        &self,
        target: HdrExportTargetV1,
        output_format: &str,
        color_profile: &ExportColorProfile,
        scene_linear_source: bool,
    ) -> HdrExportPreflightV1 {
        preflight_hdr_export(target, output_format, color_profile, scene_linear_source)
    }

    pub fn receipt(
        &self,
        target: HdrExportTargetV1,
        byte_size: usize,
        color_policy_fingerprint: String,
    ) -> HdrExportReceiptV1 {
        HdrExportReceiptV1 {
            bit_depth: 16,
            byte_size,
            color_primaries: "srgb_bt709".to_string(),
            color_policy_fingerprint,
            file_format: "tiff".to_string(),
            implementation_version: self.implementation_version,
            plan_fingerprint: format!("{:016x}", self.plan_fingerprint),
            rendition: "sdr_companion".to_string(),
            scene_edit_fingerprint: format!("{:016x}", self.scene_edit_fingerprint),
            target,
            transfer: "srgb".to_string(),
            view_fingerprint: format!("{:016x}", self.view.fingerprint),
        }
    }
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

        let sdr_plan = SdrRenditionPlanV1::compile(settings.sdr_rendition, scene_edit_fingerprint)?;
        let sdr_view = sdr_plan.view;

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
        preflight_hdr_export(target, "tiff", &ExportColorProfile::Srgb, true)
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
        let sdr_plan =
            SdrRenditionPlanV1::compile(self.sdr_rendition, self.scene_edit_fingerprint)?;
        let receipt = sdr_plan.receipt(
            HdrExportTargetV1::SdrCompanionTiff16,
            encoded.bytes.len(),
            encoded.color_policy.as_ref().map_or_else(
                || "unavailable".to_string(),
                |policy| policy.transform_policy_fingerprint.clone(),
            ),
        );
        Ok(HdrExportArtifactV1 {
            bytes: encoded.bytes,
            receipt,
        })
    }
}

pub fn hdr_export_capabilities() -> HdrExportCapabilityCatalogV1 {
    HdrExportCapabilityCatalogV1 {
        implementation_version: HDR_EDITING_IMPLEMENTATION_VERSION,
        targets: [
            HdrExportTargetV1::SdrCompanionTiff16,
            HdrExportTargetV1::HdrPq10,
            HdrExportTargetV1::HdrHlg10,
        ]
        .map(|target| preflight_hdr_export(target, "tiff", &ExportColorProfile::Srgb, true))
        .into(),
    }
}

pub fn preflight_hdr_export(
    target: HdrExportTargetV1,
    output_format: &str,
    color_profile: &ExportColorProfile,
    scene_linear_source: bool,
) -> HdrExportPreflightV1 {
    if target != HdrExportTargetV1::SdrCompanionTiff16 {
        return HdrExportPreflightV1 {
            bit_depth: None,
            block_code: Some("hdr_export_metadata_encoder_unavailable".to_string()),
            color_primaries: None,
            rendition: "hdr_view".to_string(),
            supported: false,
            target,
            transfer: None,
        };
    }
    let block_code = if !scene_linear_source {
        Some("hdr_export_scene_linear_source_required")
    } else if !matches!(output_format.to_ascii_lowercase().as_str(), "tif" | "tiff") {
        Some("hdr_sdr_companion_requires_tiff")
    } else if color_profile != &ExportColorProfile::Srgb {
        Some("hdr_sdr_companion_requires_srgb")
    } else {
        None
    };
    HdrExportPreflightV1 {
        bit_depth: block_code.is_none().then_some(16),
        block_code: block_code.map(str::to_string),
        color_primaries: block_code.is_none().then(|| "srgb_bt709".to_string()),
        rendition: "sdr_companion".to_string(),
        supported: block_code.is_none(),
        target,
        transfer: block_code.is_none().then(|| "srgb".to_string()),
    }
}

fn validate_settings(settings: HdrEditingSettingsV1) -> Result<(), String> {
    let sdr = settings.sdr_rendition;
    let values = [settings.hdr_limit_stops];
    if values.into_iter().any(|value| !value.is_finite()) {
        return Err("hdr_editing_non_finite_setting".to_string());
    }
    if !(1.0..=6.0).contains(&settings.hdr_limit_stops) {
        return Err("hdr_editing_setting_out_of_range".to_string());
    }
    validate_sdr_settings(sdr)
}

fn validate_sdr_settings(sdr: SdrRenditionSettingsV1) -> Result<(), String> {
    let values = [
        sdr.highlight_compression,
        sdr.contrast,
        sdr.shadow_lift,
        sdr.saturation,
        sdr.target_white_nits,
    ];
    if values.into_iter().any(|value| !value.is_finite()) {
        return Err("hdr_editing_non_finite_setting".to_string());
    }
    if !(0.0..=1.0).contains(&sdr.highlight_compression)
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

    #[test]
    fn sdr_export_preflight_is_format_profile_and_scene_domain_capability_gated() {
        let plan = SdrRenditionPlanV1::compile(SdrRenditionSettingsV1::default(), 42).unwrap();
        assert!(
            plan.preflight(
                HdrExportTargetV1::SdrCompanionTiff16,
                "tiff",
                &ExportColorProfile::Srgb,
                true,
            )
            .supported
        );
        for (format, profile, scene_linear, block) in [
            (
                "jpeg",
                ExportColorProfile::Srgb,
                true,
                "hdr_sdr_companion_requires_tiff",
            ),
            (
                "tiff",
                ExportColorProfile::DisplayP3,
                true,
                "hdr_sdr_companion_requires_srgb",
            ),
            (
                "tiff",
                ExportColorProfile::Srgb,
                false,
                "hdr_export_scene_linear_source_required",
            ),
        ] {
            let preflight = plan.preflight(
                HdrExportTargetV1::SdrCompanionTiff16,
                format,
                &profile,
                scene_linear,
            );
            assert!(!preflight.supported);
            assert_eq!(preflight.block_code.as_deref(), Some(block));
        }
        let catalog = hdr_export_capabilities();
        assert_eq!(
            catalog
                .targets
                .iter()
                .filter(|target| target.supported)
                .count(),
            1
        );
    }

    #[test]
    fn sdr_rendition_image_preserves_alpha_and_has_display_independent_identity() {
        let settings = SdrRenditionSettingsV1::default();
        let plan = SdrRenditionPlanV1::compile(settings, 77).unwrap();
        let repeat = SdrRenditionPlanV1::compile(settings, 77).unwrap();
        let changed_scene = SdrRenditionPlanV1::compile(settings, 78).unwrap();
        assert_eq!(plan.plan_fingerprint, repeat.plan_fingerprint);
        assert_ne!(plan.plan_fingerprint, changed_scene.plan_fingerprint);

        let source =
            DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(1, 1, Rgba([4.0, 2.0, 1.0, 0.35])));
        let output = plan.apply_image(&source).to_rgba32f();
        let pixel = output.get_pixel(0, 0).0;
        assert_eq!(pixel[3], 0.35);
        assert!(pixel[..3].iter().all(|channel| channel.is_finite()));
        assert!(pixel[0] > 0.0 && pixel[0] < 4.0);
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn sdr_rendition_cpu_wgpu_and_tiff_output_are_conformant() {
        use tauri::Manager;

        use crate::AppState;
        use crate::adjustments::abi::AllAdjustments;
        use crate::gpu_processing::{
            EditGraphExecutionAuthority, PreGpuImageIdentity, RenderRequest, acquire_gpu_test_lock,
            get_or_init_compute_gpu_context_for_tests, process_and_get_unclamped_dynamic_image,
        };

        let _gpu_guard = acquire_gpu_test_lock();
        let source = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(4, 1, |x, _| {
            let value = [0.18, 1.0, 2.0, 4.0][x as usize];
            Rgba([value, value * 0.8, value * 0.5, 1.0])
        }));
        let plan = SdrRenditionPlanV1::compile(SdrRenditionSettingsV1::default(), 0x5412)
            .expect("SDR rendition compiles");
        let cpu_linear = plan.apply_image(&source);
        let cpu_linear_rgba = cpu_linear.to_rgba32f();
        let cpu = DynamicImage::ImageRgba32F(ImageBuffer::from_fn(4, 1, |x, y| {
            let pixel = cpu_linear_rgba.get_pixel(x, y).0;
            let encode = |value: f32| {
                let magnitude = value.abs();
                let encoded = if magnitude <= 0.003_130_8 {
                    magnitude * 12.92
                } else {
                    1.055 * magnitude.powf(1.0 / 2.4) - 0.055
                };
                value.signum() * encoded
            };
            Rgba([
                encode(pixel[0]),
                encode(pixel[1]),
                encode(pixel[2]),
                pixel[3],
            ])
        }))
        .to_rgba32f();
        let parameters = plan.view.gpu_parameters();
        let mut adjustments = AllAdjustments::default();
        adjustments.global.is_raw_image = 1;
        adjustments.global.tonemapper_mode = 2;
        adjustments.global.rapid_view_parameters0 = parameters[0];
        adjustments.global.rapid_view_parameters1 = parameters[1];
        adjustments.global.rapid_view_parameters2 = parameters[2];

        let app = tauri::test::mock_builder()
            .manage(AppState::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app builds");
        let state = app.state::<AppState>();
        let context = get_or_init_compute_gpu_context_for_tests(&state)
            .expect("compute-only GPU context initializes");
        let wgpu = process_and_get_unclamped_dynamic_image(
            &context,
            &state,
            &source,
            PreGpuImageIdentity::for_test_source(&source, "hdr_sdr_rendition"),
            RenderRequest {
                adjustments,
                mask_bitmaps: &[],
                lut: None,
                roi: None,
                edit_graph: EditGraphExecutionAuthority::TestOnlyLegacy,
            },
            "hdr_sdr_rendition",
        )
        .expect("SDR rendition WGPU render succeeds")
        .to_rgba32f();
        let max_delta = cpu
            .pixels()
            .zip(wgpu.pixels())
            .flat_map(|(cpu, wgpu)| (0..3).map(move |channel| (cpu[channel] - wgpu[channel]).abs()))
            .fold(0.0_f32, f32::max);
        assert!(max_delta <= 0.008, "CPU/WGPU delta {max_delta}");

        let encoded = encode_image_with_working_color_state(
            &cpu_linear,
            WorkingColorState::AcesCgLinearV1,
            "tiff",
            100,
            &ExportColorProfile::Srgb,
            &ExportRenderingIntent::RelativeColorimetric,
            false,
            None,
        )
        .expect("SDR companion encodes through production TIFF path");
        let decoded = image::load_from_memory_with_format(&encoded.bytes, ImageFormat::Tiff)
            .expect("production TIFF reads back")
            .to_rgb16();
        assert_eq!(decoded.dimensions(), (4, 1));
        assert!(
            decoded
                .pixels()
                .all(|pixel| pixel.0.iter().any(|value| *value > 0))
        );
    }
}
