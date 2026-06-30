use image::DynamicImage;
use lcms2::{
    Flags as LcmsFlags, Intent as LcmsIntent, PixelFormat as LcmsPixelFormat,
    Profile as LcmsProfile, Transform as LcmsTransform,
};
use moxcms::{ColorProfile, Layout, RenderingIntent as MoxRenderingIntent, TransformOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::gamut_mapping::{
    ACTIVE_SRGB_OKLAB_CHROMA_REDUCE, map_srgb_oklab_chroma_reduce_rgb16_pixels,
};

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportColorProfile {
    #[default]
    Srgb,
    DisplayP3,
    AdobeRgb1998,
    ProPhotoRgb,
    SourceEmbedded,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportRenderingIntent {
    AbsoluteColorimetric,
    Perceptual,
    #[default]
    RelativeColorimetric,
    Saturation,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportColorEngineId {
    Lcms2,
    Moxcms,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportBlackPointCompensationStatus {
    Supported,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RequestedColorPolicy {
    pub(crate) black_point_compensation_requested: bool,
    pub(crate) color_profile: ExportColorProfile,
    pub(crate) output_format: String,
    pub(crate) rendering_intent: ExportRenderingIntent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedColorTransformPlan {
    pub(crate) black_point_compensation: ExportBlackPointCompensationStatus,
    pub(crate) disabled_reason: Option<String>,
    pub(crate) effective_color_profile: ExportColorProfile,
    pub(crate) effective_rendering_intent: ExportRenderingIntent,
    pub(crate) engine: ExportColorEngineId,
    pub(crate) icc_embedded: bool,
    pub(crate) requested: RequestedColorPolicy,
    pub(crate) status: String,
    pub(crate) transform_applied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppliedColorPolicy {
    pub(crate) bit_depth: u8,
    pub(crate) color_managed_transform: String,
    pub(crate) plan: ResolvedColorTransformPlan,
    pub(crate) policy_version: String,
    pub(crate) source_precision_path: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportColorCapability {
    pub black_point_compensation: ExportBlackPointCompensationStatus,
    pub color_profile: ExportColorProfile,
    pub engine: ExportColorEngineId,
    pub rendering_intents: Vec<ExportRenderingIntent>,
    pub runtime_support_notes: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportColorCapabilityCatalog {
    pub capabilities: Vec<ExportColorCapability>,
    pub engine: ExportColorEngineId,
    pub schema_version: u8,
}

pub(crate) fn export_rgb16_pixels_and_profile(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u16>, u32, u32, ColorProfile), String> {
    export_rgb16_pixels_with_shared_conversion_core(
        image,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )
}

pub(crate) fn export_rgb16_pixels_with_shared_conversion_core(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u16>, u32, u32, ColorProfile), String> {
    let (pixels, width, height) =
        export_source_rgb16_pixels(image, color_profile, rendering_intent);
    let output_profile = output_color_profile(color_profile)?;

    if export_color_profile_requires_transform(color_profile) {
        if black_point_compensation
            && is_lcms_relative_bpc_supported("tiff", color_profile, rendering_intent)
        {
            let transformed = transform_rgb16_with_lcms(
                &pixels,
                &output_profile,
                color_profile,
                rendering_intent,
                true,
            )?;
            return Ok((transformed, width, height, output_profile));
        }

        let src_profile = ColorProfile::new_srgb();
        let profile_label = export_color_profile_receipt_label(color_profile);
        let transform = src_profile
            .create_transform_16bit(
                Layout::Rgb,
                &output_profile,
                Layout::Rgb,
                export_transform_options(rendering_intent),
            )
            .map_err(|e| format!("Failed to build {profile_label} export transform: {e}"))?;
        let row_len = (width as usize)
            .checked_mul(3)
            .ok_or_else(|| "Export row is too wide".to_string())?;
        let mut transformed = vec![0u16; pixels.len()];

        for (src_row, dst_row) in pixels
            .chunks_exact(row_len)
            .zip(transformed.chunks_exact_mut(row_len))
        {
            transform
                .transform(src_row, dst_row)
                .map_err(|e| format!("Failed to convert export to {profile_label}: {e}"))?;
        }

        Ok((transformed, width, height, output_profile))
    } else {
        Ok((pixels, width, height, output_profile))
    }
}

pub(crate) fn export_source_rgb16_pixels(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> (Vec<u16>, u32, u32) {
    if should_apply_srgb_perceptual_gamut_mapping(color_profile, rendering_intent) {
        if let Some(rgb32f) = image.as_rgb32f() {
            return (
                map_srgb_oklab_chroma_reduce_rgb16_pixels(rgb32f.as_raw()),
                rgb32f.width(),
                rgb32f.height(),
            );
        }

        if let Some(rgba32f) = image.as_rgba32f() {
            let rgb: Vec<f32> = rgba32f
                .as_raw()
                .chunks_exact(4)
                .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
                .collect();

            return (
                map_srgb_oklab_chroma_reduce_rgb16_pixels(&rgb),
                rgba32f.width(),
                rgba32f.height(),
            );
        }
    }

    let rgb_image = image.to_rgb16();
    let (width, height) = rgb_image.dimensions();
    (rgb_image.into_raw(), width, height)
}

pub(crate) fn should_apply_srgb_perceptual_gamut_mapping(
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> bool {
    matches!(color_profile, ExportColorProfile::Srgb)
        && matches!(rendering_intent, ExportRenderingIntent::Perceptual)
}

pub(crate) fn export_jpeg_rgb_pixels_and_profile(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u8>, u32, u32, ColorProfile), String> {
    export_rgb_pixels_and_profile(
        image,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )
}

pub(crate) fn export_soft_proof_rgb_pixels_and_profile_with_policy(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u8>, u32, u32, ColorProfile), String> {
    export_rgb_pixels_and_profile(
        image,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )
}

pub(crate) fn export_soft_proof_transform_metadata(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<ExportReceiptMetadata, String> {
    export_receipt_metadata(
        "jpg",
        color_profile,
        rendering_intent,
        black_point_compensation,
        &export_source_precision_receipt_label(image),
        None,
    )
    .ok_or_else(|| "Failed to resolve export soft-proof transform metadata.".to_string())
}

pub(crate) fn export_rgb_pixels_and_profile(
    image: &DynamicImage,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<(Vec<u8>, u32, u32, ColorProfile), String> {
    let (pixels, width, height, output_profile) = export_rgb16_pixels_with_shared_conversion_core(
        image,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )?;
    Ok((
        quantize_rgb16_to_rgb8(&pixels),
        width,
        height,
        output_profile,
    ))
}

pub(crate) fn quantize_rgb16_to_rgb8(pixels: &[u16]) -> Vec<u8> {
    pixels
        .iter()
        .map(|value| (((*value as u32) + 128) / 257) as u8)
        .collect()
}

fn transform_rgb16_with_lcms(
    pixels: &[u16],
    output_profile: &ColorProfile,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<Vec<u16>, String> {
    if !pixels.len().is_multiple_of(3) {
        return Err("RGB16 export pixel buffer is not divisible by three channels.".to_string());
    }

    let src_profile = LcmsProfile::new_srgb();
    let output_icc = encode_icc_profile(output_profile)?;
    let dst_profile = LcmsProfile::new_icc(&output_icc).map_err(|error| {
        format!(
            "Failed to open {} output ICC for LittleCMS: {error}",
            export_color_profile_receipt_label(color_profile)
        )
    })?;
    let flags = if black_point_compensation {
        LcmsFlags::BLACKPOINT_COMPENSATION | LcmsFlags::NO_CACHE
    } else {
        LcmsFlags::NO_CACHE
    };
    let transform = LcmsTransform::<[u16; 3], [u16; 3], _, _>::new_flags(
        &src_profile,
        LcmsPixelFormat::RGB_16,
        &dst_profile,
        LcmsPixelFormat::RGB_16,
        lcms_rendering_intent(rendering_intent),
        flags,
    )
    .map_err(|error| {
        format!(
            "Failed to build LittleCMS {} export transform: {error}",
            export_color_profile_receipt_label(color_profile)
        )
    })?;
    let source_pixels: Vec<[u16; 3]> = pixels
        .chunks_exact(3)
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    let mut transformed = vec![[0u16; 3]; source_pixels.len()];
    transform.transform_pixels(&source_pixels, &mut transformed);

    Ok(transformed.into_iter().flatten().collect())
}

pub(crate) fn output_color_profile(
    color_profile: &ExportColorProfile,
) -> Result<ColorProfile, String> {
    match color_profile {
        ExportColorProfile::AdobeRgb1998 => Ok(ColorProfile::new_adobe_rgb()),
        ExportColorProfile::DisplayP3 => Ok(ColorProfile::new_display_p3()),
        ExportColorProfile::ProPhotoRgb => Ok(ColorProfile::new_pro_photo_rgb()),
        ExportColorProfile::SourceEmbedded => {
            Err("Source embedded export profile is not implemented yet.".to_string())
        }
        ExportColorProfile::Srgb => Ok(ColorProfile::new_srgb()),
    }
}

pub(crate) fn validate_export_color_policy(
    output_format: &str,
    color_profile: &ExportColorProfile,
) -> Result<(), String> {
    resolve_export_color_transform_plan(
        output_format,
        color_profile,
        &ExportRenderingIntent::RelativeColorimetric,
        false,
    )
    .map(|_| ())
}

fn export_color_profile_requires_transform(color_profile: &ExportColorProfile) -> bool {
    matches!(
        color_profile,
        ExportColorProfile::AdobeRgb1998
            | ExportColorProfile::DisplayP3
            | ExportColorProfile::ProPhotoRgb
    )
}

fn proven_export_rendering_intents(
    color_profile: &ExportColorProfile,
) -> Vec<ExportRenderingIntent> {
    match color_profile {
        ExportColorProfile::Srgb => vec![
            ExportRenderingIntent::RelativeColorimetric,
            ExportRenderingIntent::Perceptual,
        ],
        ExportColorProfile::AdobeRgb1998
        | ExportColorProfile::DisplayP3
        | ExportColorProfile::ProPhotoRgb
        | ExportColorProfile::SourceEmbedded => vec![ExportRenderingIntent::RelativeColorimetric],
    }
}

pub(crate) fn resolve_export_color_transform_plan(
    output_format: &str,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
) -> Result<ResolvedColorTransformPlan, String> {
    let requested = RequestedColorPolicy {
        black_point_compensation_requested: black_point_compensation,
        color_profile: color_profile.clone(),
        output_format: output_format.to_lowercase(),
        rendering_intent: rendering_intent.clone(),
    };
    let supports_color_managed_profile =
        supports_color_managed_receipt_metadata(&requested.output_format);
    let supported_intents = proven_export_rendering_intents(color_profile);

    if !supported_intents.contains(rendering_intent) {
        return Err(format!(
            "{} export does not have proven {} rendering-intent support yet.",
            export_color_profile_receipt_label(color_profile),
            export_rendering_intent_receipt_label(rendering_intent)
        ));
    }

    if matches!(color_profile, ExportColorProfile::SourceEmbedded)
        && !supports_color_managed_profile
    {
        return Err(format!(
            "Source embedded export profile is only supported for JPEG and TIFF, not {}.",
            output_format
        ));
    }

    if export_color_profile_requires_transform(color_profile) && !supports_color_managed_profile {
        return Err(format!(
            "{} export is only supported for JPEG and TIFF, not {}.",
            export_color_profile_receipt_label(color_profile),
            output_format
        ));
    }

    let transform_applied = export_color_profile_requires_transform(color_profile)
        || should_apply_srgb_perceptual_gamut_mapping(color_profile, rendering_intent);
    let supports_black_point_compensation =
        is_lcms_relative_bpc_supported(&requested.output_format, color_profile, rendering_intent);
    let black_point_compensation_status = if supports_black_point_compensation {
        ExportBlackPointCompensationStatus::Supported
    } else {
        ExportBlackPointCompensationStatus::Unsupported
    };
    let disabled_reason = if black_point_compensation && !supports_black_point_compensation {
        Some(
            "Black-point compensation is only available for JPEG/TIFF wide-gamut relative colorimetric LittleCMS exports."
                .to_string(),
        )
    } else {
        None
    };
    let engine = if black_point_compensation && supports_black_point_compensation {
        ExportColorEngineId::Lcms2
    } else {
        ExportColorEngineId::Moxcms
    };
    let status = if supports_color_managed_profile {
        "applied"
    } else {
        "not_applicable_unmanaged_srgb"
    };

    Ok(ResolvedColorTransformPlan {
        black_point_compensation: black_point_compensation_status,
        disabled_reason,
        effective_color_profile: color_profile.clone(),
        effective_rendering_intent: rendering_intent.clone(),
        engine,
        icc_embedded: supports_color_managed_profile,
        requested,
        status: status.to_string(),
        transform_applied,
    })
}

pub(crate) fn applied_export_color_policy(
    plan: ResolvedColorTransformPlan,
    source_precision_path: &str,
) -> AppliedColorPolicy {
    let bit_depth = if matches!(plan.requested.output_format.as_str(), "tif" | "tiff") {
        16
    } else {
        8
    };
    let color_managed_transform = export_color_transform_receipt_label(
        &plan.effective_color_profile,
        &plan.effective_rendering_intent,
    );

    AppliedColorPolicy {
        bit_depth,
        color_managed_transform,
        plan,
        policy_version: "rawengine-export-color-policy-v2".to_string(),
        source_precision_path: source_precision_path.to_string(),
    }
}

pub(crate) fn resolve_export_color_capabilities() -> ExportColorCapabilityCatalog {
    let runtime_support_notes = vec![
        "Rendering intent is passed to moxcms transform options.".to_string(),
        "LittleCMS enables black-point compensation for JPEG/TIFF relative colorimetric wide-gamut exports."
            .to_string(),
    ];
    let capabilities = vec![
        ExportColorProfile::Srgb,
        ExportColorProfile::DisplayP3,
        ExportColorProfile::AdobeRgb1998,
        ExportColorProfile::ProPhotoRgb,
        ExportColorProfile::SourceEmbedded,
    ]
    .into_iter()
    .map(|color_profile| ExportColorCapability {
        black_point_compensation: if export_color_profile_requires_transform(&color_profile) {
            ExportBlackPointCompensationStatus::Supported
        } else {
            ExportBlackPointCompensationStatus::Unsupported
        },
        rendering_intents: proven_export_rendering_intents(&color_profile),
        color_profile,
        engine: ExportColorEngineId::Moxcms,
        runtime_support_notes: runtime_support_notes.clone(),
    })
    .collect();

    ExportColorCapabilityCatalog {
        capabilities,
        engine: ExportColorEngineId::Moxcms,
        schema_version: 1,
    }
}

pub(crate) fn export_transform_options(
    rendering_intent: &ExportRenderingIntent,
) -> TransformOptions {
    TransformOptions {
        rendering_intent: mox_rendering_intent(rendering_intent),
        ..TransformOptions::default()
    }
}

pub(crate) fn mox_rendering_intent(rendering_intent: &ExportRenderingIntent) -> MoxRenderingIntent {
    match rendering_intent {
        ExportRenderingIntent::AbsoluteColorimetric => MoxRenderingIntent::AbsoluteColorimetric,
        ExportRenderingIntent::Perceptual => MoxRenderingIntent::Perceptual,
        ExportRenderingIntent::RelativeColorimetric => MoxRenderingIntent::RelativeColorimetric,
        ExportRenderingIntent::Saturation => MoxRenderingIntent::Saturation,
    }
}

fn lcms_rendering_intent(rendering_intent: &ExportRenderingIntent) -> LcmsIntent {
    match rendering_intent {
        ExportRenderingIntent::AbsoluteColorimetric => LcmsIntent::AbsoluteColorimetric,
        ExportRenderingIntent::Perceptual => LcmsIntent::Perceptual,
        ExportRenderingIntent::RelativeColorimetric => LcmsIntent::RelativeColorimetric,
        ExportRenderingIntent::Saturation => LcmsIntent::Saturation,
    }
}

fn is_lcms_relative_bpc_supported(
    output_format: &str,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> bool {
    matches!(output_format, "jpg" | "jpeg" | "tif" | "tiff")
        && export_color_profile_requires_transform(color_profile)
        && matches!(
            rendering_intent,
            ExportRenderingIntent::RelativeColorimetric
        )
}

pub(crate) fn encode_icc_profile(profile: &ColorProfile) -> Result<Vec<u8>, String> {
    profile
        .encode()
        .map_err(|e| format!("Failed to encode export ICC profile: {}", e))
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportReceiptMetadata {
    pub bit_depth: u8,
    pub black_point_compensation: String,
    pub cmm: String,
    pub color_managed_transform: String,
    pub color_profile: String,
    pub effective_color_profile: String,
    pub icc_embedded: bool,
    pub policy_version: String,
    pub policy_status: String,
    pub rendering_intent: String,
    pub requested_color_profile: String,
    pub requested_rendering_intent: String,
    pub resolved_disabled_reason: Option<String>,
    pub effective_rendering_intent: String,
    pub source_icc_profile_hash: Option<String>,
    pub source_precision_path: String,
    pub transform_policy_fingerprint: String,
    pub transform_applied: bool,
}

pub(crate) fn export_receipt_metadata(
    format: &str,
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
    black_point_compensation: bool,
    source_precision_path: &str,
    source_icc_profile_hash: Option<String>,
) -> Option<ExportReceiptMetadata> {
    if !supports_color_managed_receipt_metadata(format) {
        return None;
    }

    let plan = resolve_export_color_transform_plan(
        format,
        color_profile,
        rendering_intent,
        black_point_compensation,
    )
    .ok()?;
    let applied = applied_export_color_policy(plan, source_precision_path);
    let color_profile_label =
        export_color_profile_receipt_label(&applied.plan.effective_color_profile);
    let rendering_intent_label =
        export_rendering_intent_receipt_label(&applied.plan.effective_rendering_intent);
    let transform_policy_fingerprint =
        export_color_transform_fingerprint(&applied, source_icc_profile_hash.as_deref());

    Some(ExportReceiptMetadata {
        bit_depth: applied.bit_depth,
        black_point_compensation: export_black_point_compensation_receipt_label(&applied.plan),
        cmm: export_color_engine_receipt_label(&applied.plan.engine),
        color_managed_transform: applied.color_managed_transform,
        color_profile: color_profile_label.clone(),
        effective_color_profile: color_profile_label,
        icc_embedded: applied.plan.icc_embedded,
        policy_version: applied.policy_version,
        policy_status: applied.plan.status,
        rendering_intent: rendering_intent_label.clone(),
        requested_color_profile: export_color_profile_receipt_label(
            &applied.plan.requested.color_profile,
        ),
        requested_rendering_intent: export_rendering_intent_receipt_label(
            &applied.plan.requested.rendering_intent,
        ),
        resolved_disabled_reason: applied.plan.disabled_reason,
        effective_rendering_intent: rendering_intent_label,
        source_icc_profile_hash,
        source_precision_path: applied.source_precision_path,
        transform_policy_fingerprint,
        transform_applied: applied.plan.transform_applied,
    })
}

fn export_color_transform_fingerprint(
    applied: &AppliedColorPolicy,
    source_icc_profile_hash: Option<&str>,
) -> String {
    let plan = &applied.plan;
    let mut hasher = Sha256::new();

    let parts = vec![
        applied.policy_version.clone(),
        applied.source_precision_path.clone(),
        plan.requested.output_format.clone(),
        export_color_profile_receipt_label(&plan.requested.color_profile),
        export_rendering_intent_receipt_label(&plan.requested.rendering_intent),
        export_color_profile_receipt_label(&plan.effective_color_profile),
        export_rendering_intent_receipt_label(&plan.effective_rendering_intent),
        export_color_engine_receipt_label(&plan.engine),
        export_black_point_compensation_receipt_label(plan),
        plan.status.clone(),
        if plan.icc_embedded {
            "icc_embedded".to_string()
        } else {
            "icc_not_embedded".to_string()
        },
        if plan.transform_applied {
            "transform_applied".to_string()
        } else {
            "transform_not_applied".to_string()
        },
        source_icc_profile_hash
            .unwrap_or("source_icc:none")
            .to_string(),
    ];

    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }

    format!("sha256:{}", hex::encode(hasher.finalize()))
}

pub(crate) fn export_source_precision_receipt_label(image: &DynamicImage) -> String {
    match image {
        DynamicImage::ImageRgb32F(_) => {
            "rgb32f source; quantized only at color-managed encoder boundary".to_string()
        }
        DynamicImage::ImageRgba32F(_) => {
            "rgba32f source; alpha dropped and quantized only at color-managed encoder boundary"
                .to_string()
        }
        DynamicImage::ImageRgb16(_) => "rgb16 source; shared RGB16 export/proof core".to_string(),
        DynamicImage::ImageRgba16(_) => {
            "rgba16 source; high-precision shared RGB16 export/proof core; alpha dropped for RGB output"
                .to_string()
        }
        DynamicImage::ImageRgb8(_) | DynamicImage::ImageRgba8(_) => {
            "rgba8/rgb8 source; GPU readback-limited before color-managed export/proof".to_string()
        }
        _ => {
            "image crate RGB16 conversion source; high-precision color path not proven".to_string()
        }
    }
}

fn supports_color_managed_receipt_metadata(format: &str) -> bool {
    matches!(format, "jpg" | "jpeg" | "tif" | "tiff")
}

pub(crate) fn export_color_transform_receipt_label(
    color_profile: &ExportColorProfile,
    rendering_intent: &ExportRenderingIntent,
) -> String {
    if should_apply_srgb_perceptual_gamut_mapping(color_profile, rendering_intent) {
        return format!("{ACTIVE_SRGB_OKLAB_CHROMA_REDUCE}; ICC embedded");
    }

    if !export_color_profile_requires_transform(color_profile) {
        if matches!(color_profile, ExportColorProfile::SourceEmbedded) {
            return "Source embedded profile passthrough; ICC embedded".to_string();
        }
        return "sRGB identity output; ICC embedded".to_string();
    }

    format!(
        "sRGB to {} conversion applied",
        export_color_profile_receipt_label(color_profile)
    )
}

pub(crate) fn export_black_point_compensation_receipt_label(
    plan: &ResolvedColorTransformPlan,
) -> String {
    if plan.requested.black_point_compensation_requested
        && plan.black_point_compensation == ExportBlackPointCompensationStatus::Supported
    {
        return "Enabled via LittleCMS relative colorimetric transform".to_string();
    }

    if plan.requested.black_point_compensation_requested {
        return "Requested but disabled for this export path".to_string();
    }

    match plan.black_point_compensation {
        ExportBlackPointCompensationStatus::Supported => "Available but disabled".to_string(),
        ExportBlackPointCompensationStatus::Unsupported => {
            "Unavailable for this export path".to_string()
        }
    }
}

pub(crate) fn export_rendering_intent_receipt_label(
    rendering_intent: &ExportRenderingIntent,
) -> String {
    match rendering_intent {
        ExportRenderingIntent::AbsoluteColorimetric => "Absolute colorimetric".to_string(),
        ExportRenderingIntent::Perceptual => "Perceptual".to_string(),
        ExportRenderingIntent::RelativeColorimetric => "Relative colorimetric".to_string(),
        ExportRenderingIntent::Saturation => "Saturation".to_string(),
    }
}

pub(crate) fn export_color_engine_receipt_label(engine: &ExportColorEngineId) -> String {
    match engine {
        ExportColorEngineId::Lcms2 => "lcms2".to_string(),
        ExportColorEngineId::Moxcms => "moxcms".to_string(),
    }
}

pub(crate) fn export_color_profile_receipt_label(color_profile: &ExportColorProfile) -> String {
    match color_profile {
        ExportColorProfile::DisplayP3 => "Display P3".to_string(),
        ExportColorProfile::Srgb => "sRGB".to_string(),
        ExportColorProfile::AdobeRgb1998 => "Adobe RGB (1998)".to_string(),
        ExportColorProfile::ProPhotoRgb => "ProPhoto RGB".to_string(),
        ExportColorProfile::SourceEmbedded => "Source embedded".to_string(),
    }
}
