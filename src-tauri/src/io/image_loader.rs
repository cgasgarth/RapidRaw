use crate::Cursor;
use crate::app_settings::{AppSettings, load_settings_or_default};
use crate::app_state::{AppState, LoadedImage};
use crate::color::white_balance::{
    WhiteBalancePlanInputV1, WhiteBalancePlanV1, compile_white_balance_plan,
};
use crate::exif_processing;
use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::formats::is_raw_file;
use crate::image_processing::{ImageMetadata, apply_orientation};
use crate::mask_generation::SubMask;
use crate::patch_assets::{CompositeResult, composite_patches};
use crate::raw_processing::{
    RawDemosaicPath, RawDevelopmentReport, RawProcessingProfile, RawRuntimeReport,
    develop_raw_image_with_report, develop_raw_image_with_report_and_white_balance,
    develop_raw_source_with_report_and_white_balance,
};
use crate::render_caches::RenderCaches;
use crate::source_revision::{DecodedImageKey, RawProcessingProfileKey, SourceRevision};
use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose};
use exif::{Reader as ExifReader, Tag};
use image::{DynamicImage, GenericImageView, ImageFormat, ImageReader, imageops};
use rawler::Orientation;
use rawler::rawsource::RawSource;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::panic;
use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Instant;
use tauri::Manager;

#[derive(serde::Serialize)]
pub struct LoadImageResult {
    pub width: u32,
    pub height: u32,
    pub metadata: ImageMetadata,
    pub exif: HashMap<String, String>,
    pub is_raw: bool,
    pub is_offline_smart_preview: bool,
    pub raw_development_report: Option<RawDevelopmentReport>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawReconstructionComparisonResult {
    pub crop_size: u32,
    pub image_path: String,
    pub modes: Vec<RawReconstructionComparisonModeResult>,
    pub proof_boundary: &'static str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawReconstructionComparisonModeResult {
    pub camera_profile_status: Option<String>,
    pub crop_data_url: String,
    pub crop_hash: String,
    pub decode_elapsed_ms: u128,
    pub demosaic_algorithm_id: Option<String>,
    pub demosaic_path: Option<String>,
    pub estimated_memory_bytes: u64,
    pub mode: &'static str,
    pub output_height: u32,
    pub output_width: u32,
    pub provenance: &'static str,
    pub warning_codes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmartPreviewManifest {
    width: u32,
    height: u32,
    source_available: bool,
    stale: bool,
}

struct RawProcessingModeRecipe {
    force_fast_demosaic: bool,
    provenance: &'static str,
    raw_highlight_compression: f32,
    raw_preprocessing_color_nr: f32,
    raw_preprocessing_sharpening: f32,
    raw_preprocessing_sharpening_detail: f32,
    raw_preprocessing_sharpening_edge_masking: f32,
    raw_preprocessing_sharpening_radius: f32,
}

type LoadedBaseImageWithExif = (
    DynamicImage,
    HashMap<String, String>,
    Option<RawDevelopmentReport>,
);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DemosaicSharpeningPath {
    Fast,
    Standard,
    BayerHq,
    XTransHq,
}

const RAW_CACHE_CAMERA_PROFILE_RESOLVER_VERSION: &str = "dual_illuminant_mired_v2";
const RAW_CACHE_RECONSTRUCTION_VERSION: &str = "raw_reconstruction_v4";

fn normalize_raw_processing_mode(mode: Option<&str>) -> &'static str {
    match mode {
        Some("fast") => "fast",
        Some("maximum") => "maximum",
        _ => "balanced",
    }
}

pub(crate) fn raw_processing_mode_override_from_adjustments(
    adjustments: &Value,
) -> Option<&'static str> {
    adjustments
        .get("rawProcessingModeOverride")
        .and_then(Value::as_str)
        .and_then(|mode| match mode {
            "fast" => Some("fast"),
            "balanced" => Some("balanced"),
            "maximum" => Some("maximum"),
            _ => None,
        })
}

fn raw_processing_mode_recipe(mode: Option<&str>) -> RawProcessingModeRecipe {
    match normalize_raw_processing_mode(mode) {
        "fast" => RawProcessingModeRecipe {
            force_fast_demosaic: true,
            provenance: "speed_demosaic_no_capture_preprocessing_v1",
            raw_highlight_compression: 1.5,
            raw_preprocessing_color_nr: 0.0,
            raw_preprocessing_sharpening: 0.0,
            raw_preprocessing_sharpening_detail: 0.0,
            raw_preprocessing_sharpening_edge_masking: 0.0,
            raw_preprocessing_sharpening_radius: 1.0,
        },
        "maximum" => RawProcessingModeRecipe {
            force_fast_demosaic: false,
            provenance: "maximum_detail_capture_preprocessing_v1",
            raw_highlight_compression: 4.0,
            raw_preprocessing_color_nr: 0.65,
            raw_preprocessing_sharpening: 0.42,
            raw_preprocessing_sharpening_detail: 0.55,
            raw_preprocessing_sharpening_edge_masking: 0.45,
            raw_preprocessing_sharpening_radius: 2.2,
        },
        _ => RawProcessingModeRecipe {
            force_fast_demosaic: false,
            provenance: "default_quality_capture_preprocessing_v1",
            raw_highlight_compression: 2.5,
            raw_preprocessing_color_nr: 0.5,
            raw_preprocessing_sharpening: 0.35,
            raw_preprocessing_sharpening_detail: 0.45,
            raw_preprocessing_sharpening_edge_masking: 0.3,
            raw_preprocessing_sharpening_radius: 2.0,
        },
    }
}

fn is_recipe_value(value: Option<f32>, recipe_value: f32) -> bool {
    value.is_none_or(|value| (value - recipe_value).abs() <= 0.000_1)
}

fn uses_recipe_capture_sharpening(
    settings: &AppSettings,
    recipe: &RawProcessingModeRecipe,
) -> bool {
    is_recipe_value(
        settings.raw_preprocessing_sharpening,
        recipe.raw_preprocessing_sharpening,
    ) && is_recipe_value(
        settings.raw_preprocessing_sharpening_detail,
        recipe.raw_preprocessing_sharpening_detail,
    ) && is_recipe_value(
        settings.raw_preprocessing_sharpening_edge_masking,
        recipe.raw_preprocessing_sharpening_edge_masking,
    ) && is_recipe_value(
        settings.raw_preprocessing_sharpening_radius,
        recipe.raw_preprocessing_sharpening_radius,
    )
}

fn demosaic_sharpening_path(demosaic_path: RawDemosaicPath) -> DemosaicSharpeningPath {
    match demosaic_path {
        RawDemosaicPath::BayerHq => DemosaicSharpeningPath::BayerHq,
        RawDemosaicPath::Fast | RawDemosaicPath::LinearBypass => DemosaicSharpeningPath::Fast,
        RawDemosaicPath::Standard => DemosaicSharpeningPath::Standard,
        RawDemosaicPath::XTransHq => DemosaicSharpeningPath::XTransHq,
    }
}

fn raw_demosaic_path_label(demosaic_path: RawDemosaicPath) -> &'static str {
    match demosaic_path {
        RawDemosaicPath::BayerHq => "bayer_hq",
        RawDemosaicPath::Fast => "fast",
        RawDemosaicPath::LinearBypass => "linear_bypass",
        RawDemosaicPath::Standard => "standard",
        RawDemosaicPath::XTransHq => "x_trans_hq",
    }
}

fn resolve_capture_pre_sharpening_settings(
    settings: &AppSettings,
    recipe: &RawProcessingModeRecipe,
    path: DemosaicSharpeningPath,
    dimensions: (u32, u32),
) -> crate::image_processing::CapturePreSharpeningSettings {
    let base = crate::image_processing::CapturePreSharpeningSettings {
        amount: settings
            .raw_preprocessing_sharpening
            .unwrap_or(recipe.raw_preprocessing_sharpening),
        detail: settings
            .raw_preprocessing_sharpening_detail
            .unwrap_or(recipe.raw_preprocessing_sharpening_detail),
        edge_masking: settings
            .raw_preprocessing_sharpening_edge_masking
            .unwrap_or(recipe.raw_preprocessing_sharpening_edge_masking),
        radius_px: settings
            .raw_preprocessing_sharpening_radius
            .unwrap_or(recipe.raw_preprocessing_sharpening_radius),
    };

    if !base.is_enabled() || !uses_recipe_capture_sharpening(settings, recipe) {
        return base.normalized();
    }

    let long_edge = dimensions.0.max(dimensions.1);
    let high_resolution_radius_offset = if long_edge >= 7000 { 0.15 } else { 0.0 };

    match path {
        DemosaicSharpeningPath::Fast => crate::image_processing::CapturePreSharpeningSettings {
            amount: 0.0,
            detail: 0.0,
            edge_masking: 0.0,
            radius_px: 1.0,
        },
        DemosaicSharpeningPath::Standard => crate::image_processing::CapturePreSharpeningSettings {
            amount: (base.amount * 0.95).min(0.38),
            detail: (base.detail * 0.9).min(0.45),
            edge_masking: base.edge_masking.max(0.36),
            radius_px: (base.radius_px + high_resolution_radius_offset).min(2.2),
        },
        DemosaicSharpeningPath::BayerHq => crate::image_processing::CapturePreSharpeningSettings {
            amount: (base.amount * 1.05).min(0.48),
            detail: (base.detail * 1.08).min(0.62),
            edge_masking: base.edge_masking.max(0.46),
            radius_px: (base.radius_px + 0.15 + high_resolution_radius_offset).min(2.5),
        },
        DemosaicSharpeningPath::XTransHq => crate::image_processing::CapturePreSharpeningSettings {
            amount: (base.amount * 0.9).min(0.36),
            detail: (base.detail * 0.82).min(0.42),
            edge_masking: base.edge_masking.max(0.42),
            radius_px: (base.radius_px + high_resolution_radius_offset).min(2.15),
        },
    }
    .normalized()
}

pub(crate) fn raw_processing_settings_for_adjustments(
    settings: &AppSettings,
    adjustments: &Value,
) -> AppSettings {
    let Some(mode) = raw_processing_mode_override_from_adjustments(adjustments) else {
        return settings.clone();
    };
    let recipe = raw_processing_mode_recipe(Some(mode));
    AppSettings {
        raw_processing_mode: Some(mode.to_string()),
        raw_highlight_compression: Some(recipe.raw_highlight_compression),
        raw_preprocessing_color_nr: Some(recipe.raw_preprocessing_color_nr),
        raw_preprocessing_sharpening: Some(recipe.raw_preprocessing_sharpening),
        raw_preprocessing_sharpening_detail: Some(recipe.raw_preprocessing_sharpening_detail),
        raw_preprocessing_sharpening_edge_masking: Some(
            recipe.raw_preprocessing_sharpening_edge_masking,
        ),
        raw_preprocessing_sharpening_radius: Some(recipe.raw_preprocessing_sharpening_radius),
        apply_preprocessing_to_non_raws: Some(false),
        ..settings.clone()
    }
}

pub(crate) fn raw_processing_profile_key(settings: &AppSettings) -> RawProcessingProfileKey {
    let mode = normalize_raw_processing_mode(settings.raw_processing_mode.as_deref());
    let recipe = raw_processing_mode_recipe(Some(mode));
    let highlight_compression = settings
        .raw_highlight_compression
        .unwrap_or(recipe.raw_highlight_compression);
    let color_nr = settings
        .raw_preprocessing_color_nr
        .unwrap_or(recipe.raw_preprocessing_color_nr);
    let sharpening = resolve_capture_pre_sharpening_settings(
        settings,
        &recipe,
        match mode {
            "fast" => DemosaicSharpeningPath::Fast,
            "maximum" => DemosaicSharpeningPath::BayerHq,
            _ => DemosaicSharpeningPath::Standard,
        },
        (0, 0),
    );
    RawProcessingProfileKey {
        mode,
        linear_raw_mode: settings.linear_raw_mode.clone(),
        highlight_compression_bits: highlight_compression.to_bits(),
        color_nr_bits: color_nr.to_bits(),
        sharpening_bits: [
            sharpening.amount.to_bits(),
            sharpening.detail.to_bits(),
            sharpening.edge_masking.to_bits(),
            sharpening.radius_px.to_bits(),
        ],
        camera_profile_resolver_version: RAW_CACHE_CAMERA_PROFILE_RESOLVER_VERSION,
        reconstruction_version: RAW_CACHE_RECONSTRUCTION_VERSION,
        demosaic_plan_version: recipe.provenance,
        decoder_version: "rawler-0.7.1",
        input_transform_version: crate::color::camera_input_transform::RAW_INPUT_TRANSFORM_CONTRACT,
        xyz_to_ap1_version: crate::color::camera_input_transform::XYZ_TO_AP1_MATRIX_VERSION,
        numeric_policy_version: crate::color::camera_input_transform::NUMERIC_POLICY_VERSION,
    }
}

pub(crate) fn raw_processing_mode_cache_key(
    source_path: &Path,
    settings: &AppSettings,
) -> Result<DecodedImageKey, crate::source_revision::SourceRevisionError> {
    Ok(DecodedImageKey {
        source_revision: SourceRevision::from_path(source_path)?,
        processing_profile: raw_processing_profile_key(settings),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatchMaskInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) invert: bool,
    #[serde(default)]
    pub(crate) sub_masks: Vec<SubMask>,
}

pub fn load_and_composite(
    base_image: &[u8],
    path: &str,
    adjustments: &Value,
    use_fast_raw_dev: bool,
    settings: &AppSettings,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<DynamicImage> {
    load_and_composite_with_report(
        base_image,
        path,
        adjustments,
        use_fast_raw_dev,
        settings,
        cancel_token,
    )
    .map(|(image, _)| image)
}

pub(crate) fn load_and_composite_with_report(
    base_image: &[u8],
    path: &str,
    adjustments: &Value,
    use_fast_raw_dev: bool,
    settings: &AppSettings,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<(DynamicImage, Option<RawDevelopmentReport>)> {
    let white_balance_plan = technical_white_balance_plan_from_adjustments(adjustments);
    let (base_image, raw_development_report) = load_base_image_from_bytes_with_report_and_plan(
        base_image,
        path,
        use_fast_raw_dev,
        settings,
        cancel_token,
        white_balance_plan,
    )?;
    Ok((
        composite_patches_on_image(&base_image, adjustments)?.into_owned(),
        raw_development_report,
    ))
}

fn technical_white_balance_plan_from_adjustments(
    adjustments: &Value,
) -> Option<WhiteBalancePlanV1> {
    let settings = adjustments.get("whiteBalanceTechnical")?.clone();
    let input = serde_json::from_value::<WhiteBalancePlanInputV1>(settings).ok()?;
    compile_white_balance_plan(input).ok()
}

pub fn load_base_image_from_bytes(
    bytes: &[u8],
    path_for_ext_check: &str,
    use_fast_raw_dev: bool,
    settings: &AppSettings,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<DynamicImage> {
    load_base_image_from_bytes_with_report(
        bytes,
        path_for_ext_check,
        use_fast_raw_dev,
        settings,
        cancel_token,
    )
    .map(|(image, _)| image)
}

pub(crate) fn load_base_image_from_bytes_with_report(
    bytes: &[u8],
    path_for_ext_check: &str,
    use_fast_raw_dev: bool,
    settings: &AppSettings,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<(DynamicImage, Option<RawDevelopmentReport>)> {
    load_base_image_from_source_with_report(
        bytes,
        path_for_ext_check,
        use_fast_raw_dev,
        settings,
        cancel_token,
        None,
        None,
    )
}

fn load_base_image_from_bytes_with_report_and_plan(
    bytes: &[u8],
    path_for_ext_check: &str,
    use_fast_raw_dev: bool,
    settings: &AppSettings,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
    white_balance_plan: Option<WhiteBalancePlanV1>,
) -> Result<(DynamicImage, Option<RawDevelopmentReport>)> {
    load_base_image_from_source_with_report(
        bytes,
        path_for_ext_check,
        use_fast_raw_dev,
        settings,
        cancel_token,
        None,
        white_balance_plan,
    )
}

fn load_base_image_from_prepared_raw_source_with_report(
    source: &RawSource,
    path_for_ext_check: &str,
    use_fast_raw_dev: bool,
    settings: &AppSettings,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<(DynamicImage, Option<RawDevelopmentReport>)> {
    load_base_image_from_source_with_report(
        source.buf(),
        path_for_ext_check,
        use_fast_raw_dev,
        settings,
        cancel_token,
        Some(source),
        None,
    )
}

fn load_base_image_from_source_with_report(
    bytes: &[u8],
    path_for_ext_check: &str,
    use_fast_raw_dev: bool,
    settings: &AppSettings,
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
    prepared_raw_source: Option<&RawSource>,
    white_balance_plan: Option<WhiteBalancePlanV1>,
) -> Result<(DynamicImage, Option<RawDevelopmentReport>)> {
    let raw_processing_mode = settings.raw_processing_mode.as_deref();
    let recipe = raw_processing_mode_recipe(raw_processing_mode);
    let use_fast_raw_dev = use_fast_raw_dev || recipe.force_fast_demosaic;
    let highlight_compression = settings
        .raw_highlight_compression
        .unwrap_or(recipe.raw_highlight_compression);
    let linear_mode = settings.linear_raw_mode.clone();
    let color_nr_setting = settings
        .raw_preprocessing_color_nr
        .unwrap_or(recipe.raw_preprocessing_color_nr);
    let color_nr_amount = if color_nr_setting <= 0.0 {
        0.0
    } else {
        let x = color_nr_setting.clamp(0.01, 1.0);
        (12.0 / x - 10.0).max(0.1)
    };
    let base_sharpening_settings = crate::image_processing::CapturePreSharpeningSettings {
        amount: settings
            .raw_preprocessing_sharpening
            .unwrap_or(recipe.raw_preprocessing_sharpening),
        detail: settings
            .raw_preprocessing_sharpening_detail
            .unwrap_or(recipe.raw_preprocessing_sharpening_detail),
        edge_masking: settings
            .raw_preprocessing_sharpening_edge_masking
            .unwrap_or(recipe.raw_preprocessing_sharpening_edge_masking),
        radius_px: settings
            .raw_preprocessing_sharpening_radius
            .unwrap_or(recipe.raw_preprocessing_sharpening_radius),
    };
    let apply_to_non_raws = settings.apply_preprocessing_to_non_raws.unwrap_or(false);

    crate::exif_processing::persist_exif_if_missing(
        Path::new(path_for_ext_check),
        path_for_ext_check,
        bytes,
    );

    if is_raw_file(path_for_ext_check) {
        let profile = RawProcessingProfile::from_mode(raw_processing_mode.unwrap_or("balanced"));
        match panic::catch_unwind(move || {
            if let Some(source) = prepared_raw_source {
                match white_balance_plan {
                    Some(plan) => develop_raw_source_with_report_and_white_balance(
                        source,
                        use_fast_raw_dev,
                        profile,
                        highlight_compression,
                        linear_mode,
                        cancel_token,
                        plan,
                    ),
                    None => crate::raw_processing::develop_raw_source_with_report(
                        source,
                        use_fast_raw_dev,
                        profile,
                        highlight_compression,
                        linear_mode,
                        cancel_token,
                    ),
                }
            } else {
                match white_balance_plan {
                    Some(plan) => develop_raw_image_with_report_and_white_balance(
                        bytes,
                        use_fast_raw_dev,
                        profile,
                        highlight_compression,
                        linear_mode,
                        cancel_token,
                        plan,
                    ),
                    None => develop_raw_image_with_report(
                        bytes,
                        use_fast_raw_dev,
                        profile,
                        highlight_compression,
                        linear_mode,
                        cancel_token,
                    ),
                }
            }
        }) {
            Ok(Ok((mut image, report))) => {
                let sharpening_settings = resolve_capture_pre_sharpening_settings(
                    settings,
                    &recipe,
                    demosaic_sharpening_path(report.demosaic_path),
                    image.dimensions(),
                );
                if !use_fast_raw_dev && (color_nr_amount > 0.0 || sharpening_settings.is_enabled())
                {
                    let start = Instant::now();
                    crate::image_processing::remove_raw_artifacts_and_enhance_with_settings(
                        &mut image,
                        color_nr_amount,
                        sharpening_settings,
                    );
                    let duration = start.elapsed();
                    log::info!(
                        "Raw enhancing for '{}' took {:?}",
                        path_for_ext_check,
                        duration
                    );
                }
                Ok((image, Some(report)))
            }
            Ok(Err(e)) => {
                let classified = classify_raw_develop_error(path_for_ext_check, e);
                log::warn!(
                    "Error developing RAW file '{}': {}",
                    path_for_ext_check,
                    classified
                );
                Err(classified)
            }
            Err(_) => {
                log::error!("Panic while processing RAW file: {}", path_for_ext_check);
                Err(anyhow!(
                    "Failed to process RAW file: {}",
                    path_for_ext_check
                ))
            }
        }
    } else {
        let mut image = load_image_with_orientation(bytes, cancel_token)?;

        if apply_to_non_raws
            && !use_fast_raw_dev
            && (color_nr_amount > 0.0 || base_sharpening_settings.is_enabled())
        {
            let start = Instant::now();
            crate::image_processing::remove_raw_artifacts_and_enhance_with_settings(
                &mut image,
                color_nr_amount,
                base_sharpening_settings,
            );
            let duration = start.elapsed();
            log::info!(
                "Enhancing non-RAW '{}' took {:?}",
                path_for_ext_check,
                duration
            );
        }

        Ok((image, None))
    }
}

fn add_raw_development_report_exif(
    exif: &mut HashMap<String, String>,
    report: &RawDevelopmentReport,
) {
    let profile = &report.camera_profile;
    exif.insert(
        "RawEngineCameraProfileAlgorithm".to_string(),
        profile.algorithm_id.to_string(),
    );
    exif.insert(
        "RawEngineCameraProfileCandidateCount".to_string(),
        profile.candidate_count.to_string(),
    );
    exif.insert(
        "RawEngineCameraProfileStatus".to_string(),
        profile.status.to_string(),
    );
    if let Some(value) = profile.estimated_cct_kelvin {
        exif.insert(
            "RawEngineCameraProfileEstimatedCctKelvin".to_string(),
            format!("{value:.0}"),
        );
    }
    if let Some(value) = &profile.matrix_hash {
        exif.insert(
            "RawEngineCameraProfileMatrixHash".to_string(),
            value.clone(),
        );
    }
    if let Some(value) = profile.profile_illuminant_xy {
        exif.insert(
            "RawEngineCameraProfileIlluminantXy".to_string(),
            format!("{:.8},{:.8}", value[0], value[1]),
        );
    }
    if let Some(value) = profile.profile_illuminant_duv {
        exif.insert(
            "RawEngineCameraProfileIlluminantDuv".to_string(),
            format!("{value:.8}"),
        );
    }
    if let Some(value) = &profile.white_balance_plan_fingerprint {
        exif.insert(
            "RawEngineCameraProfileWhiteBalancePlanFingerprint".to_string(),
            value.clone(),
        );
    }
    if let Some(transform) = &report.input_transform {
        exif.insert(
            "RawEngineInputSourceDomain".to_string(),
            transform.source_domain.to_string(),
        );
        exif.insert(
            "RawEngineInputDestinationDomain".to_string(),
            transform.destination_domain.to_string(),
        );
        exif.insert(
            "RawEngineInputTransformHash".to_string(),
            transform.transform_content_sha256.clone(),
        );
        exif.insert(
            "RawEngineInputWorkingPixelsHash".to_string(),
            transform.working_pixels_blake3.clone(),
        );
        exif.insert(
            "RawEngineInputChromaticAdaptation".to_string(),
            transform.chromatic_adaptation.to_string(),
        );
    }
    if let Some(value) = &profile.warm_illuminant {
        exif.insert(
            "RawEngineCameraProfileWarmIlluminant".to_string(),
            value.clone(),
        );
    }
    if let Some(value) = &profile.cool_illuminant {
        exif.insert(
            "RawEngineCameraProfileCoolIlluminant".to_string(),
            value.clone(),
        );
    }
    if let Some(value) = profile.cool_weight {
        exif.insert(
            "RawEngineCameraProfileCoolWeight".to_string(),
            format!("{value:.4}"),
        );
    }
    if let Some(value) = &profile.fallback_reason {
        exif.insert(
            "RawEngineCameraProfileFallbackReason".to_string(),
            value.to_string(),
        );
    }
    if !profile.warning_codes.is_empty() {
        exif.insert(
            "RawEngineCameraProfileWarnings".to_string(),
            profile.warning_codes.join(","),
        );
    }
    if let Some(runtime) = &report.runtime {
        exif.insert(
            "RawEngineRawCacheHit".to_string(),
            runtime.cache_hit.to_string(),
        );
        if let Some(value) = runtime.decode_elapsed_ms {
            exif.insert("RawEngineRawDecodeElapsedMs".to_string(), value.to_string());
        }
        if let Some(value) = runtime.preview_elapsed_ms {
            exif.insert(
                "RawEngineRawPreviewElapsedMs".to_string(),
                value.to_string(),
            );
        }
        if let Some((width, height)) = runtime.output_dimensions {
            exif.insert(
                "RawEngineRawOutputDimensions".to_string(),
                format!("{width}x{height}"),
            );
        }
    }
}

fn classify_raw_develop_error(path: &str, err: anyhow::Error) -> anyhow::Error {
    let error_text = err.to_string();
    let lowered = error_text.to_ascii_lowercase();
    let unsupported_compression =
        lowered.contains("nef compression") && lowered.contains("not supported");

    if unsupported_compression {
        return anyhow!(
            "Unsupported RAW compression format for '{}'. Original error: {}",
            path,
            error_text
        );
    }

    err
}

pub fn load_image_with_orientation(
    bytes: &[u8],
    cancel_token: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<DynamicImage> {
    let check_cancel = || -> Result<()> {
        if let Some((tracker, generation)) = &cancel_token
            && tracker.load(Ordering::SeqCst) != *generation
        {
            return Err(anyhow!("Load cancelled"));
        }
        Ok(())
    };

    let cursor = Cursor::new(bytes);
    let mut reader = ImageReader::new(cursor.clone())
        .with_guessed_format()
        .context("Failed to guess image format")?;

    reader.no_limits();

    check_cancel()?;

    let image = reader.decode().context("Failed to decode image")?;
    check_cancel()?;

    let oriented_image = {
        let exif_reader = ExifReader::new();
        if let Ok(exif) = exif_reader.read_from_container(&mut cursor.clone()) {
            if let Some(orientation) = exif
                .get_field(Tag::Orientation, exif::In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))
            {
                check_cancel()?;
                apply_orientation(image, Orientation::from_u16(orientation as u16))
            } else {
                image
            }
        } else {
            image
        }
    };

    Ok(DynamicImage::ImageRgb32F(oriented_image.to_rgb32f()))
}

pub fn composite_patches_on_image<'a>(
    base_image: &'a DynamicImage,
    current_adjustments: &Value,
) -> Result<CompositeResult<'a>> {
    composite_patches(base_image, current_adjustments)
}

#[tauri::command]
pub fn is_image_cached(path: String, state: tauri::State<'_, AppState>) -> bool {
    let (source_path, _) = parse_virtual_path(&path);
    let Ok(revision) = SourceRevision::from_path(&source_path) else {
        return false;
    };
    state.decoded_image_cache.contains_revision(&revision)
}

#[tauri::command]
pub async fn compare_raw_reconstruction_modes(
    path: String,
    crop_size: Option<u32>,
) -> Result<RawReconstructionComparisonResult, String> {
    let source_path = parse_virtual_path(&path).0;
    let source_path_str = source_path.to_string_lossy().to_string();
    if !is_raw_file(&source_path_str) {
        return Err("RAW reconstruction comparison requires a RAW source image.".to_string());
    }

    let crop_size = crop_size.unwrap_or(256).clamp(128, 512);
    let source_bytes = read_file_mapped(&source_path).map_err(|error| {
        format!("Failed to read RAW source for reconstruction comparison: {error}")
    })?;
    let mut modes = Vec::new();

    for mode in ["fast", "balanced", "maximum"] {
        let recipe = raw_processing_mode_recipe(Some(mode));
        let settings = AppSettings {
            apply_preprocessing_to_non_raws: Some(false),
            raw_highlight_compression: Some(recipe.raw_highlight_compression),
            raw_preprocessing_color_nr: Some(recipe.raw_preprocessing_color_nr),
            raw_preprocessing_sharpening: Some(recipe.raw_preprocessing_sharpening),
            raw_preprocessing_sharpening_detail: Some(recipe.raw_preprocessing_sharpening_detail),
            raw_preprocessing_sharpening_edge_masking: Some(
                recipe.raw_preprocessing_sharpening_edge_masking,
            ),
            raw_preprocessing_sharpening_radius: Some(recipe.raw_preprocessing_sharpening_radius),
            raw_processing_mode: Some(mode.to_string()),
            ..AppSettings::default()
        };
        let started = Instant::now();
        let (image, report) = load_base_image_from_bytes_with_report(
            &source_bytes,
            &source_path_str,
            false,
            &settings,
            None,
        )
        .map_err(|error| {
            format!("Failed to decode {mode} RAW reconstruction comparison: {error}")
        })?;
        let decode_elapsed_ms = started.elapsed().as_millis();
        let rgba = image.to_rgba8();
        let (width, height) = rgba.dimensions();
        let crop_width = crop_size.min(width);
        let crop_height = crop_size.min(height);
        let crop_x = width.saturating_sub(crop_width) / 2;
        let crop_y = height.saturating_sub(crop_height) / 2;
        let crop = imageops::crop_imm(&rgba, crop_x, crop_y, crop_width, crop_height).to_image();
        let crop_hash = format!("blake3:{}", blake3::hash(crop.as_raw()).to_hex());
        let mut png_bytes = Vec::new();
        DynamicImage::ImageRgba8(crop)
            .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
            .map_err(|error| format!("Failed to encode {mode} RAW reconstruction crop: {error}"))?;
        let crop_data_url = format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(png_bytes)
        );
        let estimated_memory_bytes = u64::from(width) * u64::from(height) * 4;
        let (camera_profile_status, demosaic_algorithm_id, demosaic_path, warning_codes) =
            if let Some(report) = report {
                (
                    Some(report.camera_profile.status.to_string()),
                    report.demosaic_algorithm_id.map(str::to_string),
                    Some(raw_demosaic_path_label(report.demosaic_path).to_string()),
                    report
                        .camera_profile
                        .warning_codes
                        .into_iter()
                        .map(str::to_string)
                        .collect(),
                )
            } else {
                (None, None, None, Vec::new())
            };

        modes.push(RawReconstructionComparisonModeResult {
            camera_profile_status,
            crop_data_url,
            crop_hash,
            decode_elapsed_ms,
            demosaic_algorithm_id,
            demosaic_path,
            estimated_memory_bytes,
            mode,
            output_height: height,
            output_width: width,
            provenance: recipe.provenance,
            warning_codes,
        });
    }

    Ok(RawReconstructionComparisonResult {
        crop_size,
        image_path: path,
        modes,
        proof_boundary: "runtime_raw_reconstruction_mode_crop_comparison",
    })
}

fn compute_smart_preview_id(path_str: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(path_str.as_bytes());
    hasher.finalize().to_hex().to_string()
}

fn load_offline_smart_preview(
    app_handle: &tauri::AppHandle,
    source_path_str: &str,
) -> Option<(DynamicImage, SmartPreviewManifest)> {
    let cache_dir = app_handle.path().app_cache_dir().ok()?;
    load_offline_smart_preview_from_cache(&cache_dir, source_path_str)
}

fn load_offline_smart_preview_from_cache(
    cache_dir: &Path,
    source_path_str: &str,
) -> Option<(DynamicImage, SmartPreviewManifest)> {
    let source_path = Path::new(source_path_str);
    if source_path.exists() {
        return None;
    }

    let preview_id = compute_smart_preview_id(source_path_str);
    let preview_path = cache_dir
        .join("smart-previews")
        .join(format!("{}.jpg", preview_id));
    let manifest_path = cache_dir
        .join("smart-previews")
        .join(format!("{}.json", preview_id));

    let manifest = fs::read_to_string(manifest_path)
        .ok()
        .and_then(|content| serde_json::from_str::<SmartPreviewManifest>(&content).ok())?;
    if manifest.source_available || !manifest.stale {
        return None;
    }

    let image = ImageReader::open(preview_path).ok()?.decode().ok()?;
    Some((image, manifest))
}

#[tauri::command]
pub async fn load_image(
    path: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<LoadImageResult, String> {
    let metadata = load_image_open_metadata(&path)?;
    load_image_prepared(path, state.inner(), app_handle, metadata, true, None, None).await
}

pub(crate) fn load_image_open_metadata(path: &str) -> Result<ImageMetadata, String> {
    let (source_path, sidecar_path) = parse_virtual_path(path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let mut metadata: ImageMetadata =
        crate::exif_processing::load_sidecar_recovering(&sidecar_path, Some(path))?.metadata;
    let mut should_save_sidecar = false;
    if is_raw_file(&source_path_str)
        && crate::exif_processing::repair_raw_sidecar_camera_metadata(&source_path, &mut metadata)
    {
        should_save_sidecar = true;
    }
    if crate::panorama_stitching::refresh_panorama_stale_artifacts(&mut metadata) {
        should_save_sidecar = true;
    }
    if crate::negative_conversion::refresh_negative_lab_stale_artifacts(&mut metadata) {
        should_save_sidecar = true;
    }
    if should_save_sidecar {
        crate::exif_processing::save_sidecar_metadata_atomic(&sidecar_path, &metadata)?;
    }
    Ok(metadata)
}

pub(crate) async fn prefetch_image(
    path: String,
    state: &AppState,
    app_handle: tauri::AppHandle,
    cancellation: Option<(Arc<AtomicUsize>, usize)>,
) -> Result<LoadImageResult, String> {
    let metadata = load_image_open_metadata(&path)?;
    load_image_prepared(path, state, app_handle, metadata, false, cancellation, None).await
}

pub(crate) async fn load_image_prepared(
    path: String,
    state: &AppState,
    app_handle: tauri::AppHandle,
    metadata: ImageMetadata,
    install_active: bool,
    cancellation: Option<(Arc<AtomicUsize>, usize)>,
    prepared_raw_source: Option<Arc<RawSource>>,
) -> Result<LoadImageResult, String> {
    let (generation_tracker, my_generation) = if let Some(cancellation) = cancellation {
        cancellation
    } else if install_active {
        let generation = state.load_image_generation.fetch_add(1, Ordering::SeqCst) + 1;
        (Arc::clone(&state.load_image_generation), generation)
    } else {
        let generation = state.load_image_generation.load(Ordering::SeqCst);
        (Arc::clone(&state.load_image_generation), generation)
    };
    let cancel_token = Some((generation_tracker.clone(), my_generation));

    if install_active {
        RenderCaches::new(state).clear_active_image_render_state();

        *state.denoise_result.lock().unwrap() = None;
        *state.hdr_result.lock().unwrap() = None;
        *state.hdr_runtime_plan.lock().unwrap() = None;
        state.hdr_source_refs.lock().unwrap().clear();
        *state.panorama_result.lock().unwrap() = None;
    }

    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();

    let settings = load_settings_or_default(&app_handle);
    let effective_settings =
        raw_processing_settings_for_adjustments(&settings, &metadata.adjustments);
    let raw_processing_cache_key = raw_processing_mode_cache_key(&source_path, &effective_settings)
        .map_err(|error| error.to_string())?;
    let artifact_source =
        crate::render::artifact_identity::SourceArtifactIdentity::from_decoded_key(
            path.clone(),
            &raw_processing_cache_key,
        );

    let path_clone = source_path_str.clone();
    let expected_revision = raw_processing_cache_key.source_revision.clone();
    let fingerprint_cache = state.source_fingerprint_cache.clone();

    let cached_data = state.decoded_image_cache.get(&raw_processing_cache_key);

    let mut is_offline_smart_preview = false;

    let load_started = Instant::now();

    let (pristine_arc, exif_data, raw_development_report) =
        if let Some((cached_img, cached_exif, cached_raw_development_report)) = cached_data {
            let mut cached_exif = (*cached_exif).clone();
            let cached_raw_development_report = cached_raw_development_report.map(|report| {
                let mut report = (*report).clone();
                let (width, height) = cached_img.dimensions();
                report.runtime = Some(RawRuntimeReport {
                    cache_hit: true,
                    decode_elapsed_ms: report
                        .runtime
                        .as_ref()
                        .and_then(|runtime| runtime.decode_elapsed_ms),
                    export_elapsed_ms: None,
                    output_dimensions: Some((width, height)),
                    preview_elapsed_ms: Some(load_started.elapsed().as_millis()),
                });
                add_raw_development_report_exif(&mut cached_exif, &report);
                report
            });
            (cached_img, cached_exif, cached_raw_development_report)
        } else if let Some((smart_preview, manifest)) =
            load_offline_smart_preview(&app_handle, &source_path_str)
        {
            is_offline_smart_preview = true;
            let (preview_width, preview_height) = smart_preview.dimensions();
            let mut exif_data_loaded = metadata.exif.clone().unwrap_or_default();
            exif_data_loaded.insert(
                "RawEngineOfflineSmartPreview".to_string(),
                "true".to_string(),
            );
            exif_data_loaded.insert(
                "RawEngineOfflineSmartPreviewSource".to_string(),
                "missing-original".to_string(),
            );
            exif_data_loaded.insert(
                "RawEngineOfflineSmartPreviewManifestSize".to_string(),
                format!("{}x{}", manifest.width, manifest.height),
            );
            exif_data_loaded.insert(
                "RawEngineOfflineSmartPreviewRenderSize".to_string(),
                format!("{}x{}", preview_width, preview_height),
            );
            (Arc::new(smart_preview), exif_data_loaded, None)
        } else {
            let decode_started = Instant::now();
            let decode_generation_tracker = Arc::clone(&generation_tracker);
            let prepared_raw_source = prepared_raw_source.clone();
            let (pristine_img, exif_data_loaded, raw_development_report) =
            tokio::task::spawn_blocking(move || {
                if decode_generation_tracker.load(Ordering::SeqCst) != my_generation {
                    return Err("Load cancelled".to_string());
                }

                let result: Result<LoadedBaseImageWithExif, String> = (|| {
                    if let Some(source) = prepared_raw_source {
                        let bytes = source.buf();
                        let fingerprint = fingerprint_cache.fingerprint(&expected_revision, bytes);
                        log::trace!("decoded_source_fingerprint={}", fingerprint.blake3.to_hex());
                        let (img, raw_development_report) =
                            load_base_image_from_prepared_raw_source_with_report(
                                &source,
                                &path_clone,
                                false,
                                &effective_settings,
                                cancel_token.clone(),
                            )
                            .map_err(|error| error.to_string())?;
                        let mut exif = exif_processing::read_exif_data(&path_clone, bytes);
                        exif.insert(
                            "RawEngineRawProcessingMode".to_string(),
                            effective_settings
                                .raw_processing_mode
                                .clone()
                                .unwrap_or_else(|| "balanced".to_string()),
                        );
                        exif.insert(
                            "RawEngineRawProcessingProvenance".to_string(),
                            raw_processing_mode_recipe(
                                effective_settings.raw_processing_mode.as_deref(),
                            )
                            .provenance
                            .to_string(),
                        );
                        if let Some(report) = &raw_development_report {
                            add_raw_development_report_exif(&mut exif, report);
                        }
                        if SourceRevision::from_path(Path::new(&path_clone))
                            .map_err(|error| error.to_string())?
                            != expected_revision
                        {
                            return Err("source_changed_during_decode".to_string());
                        }
                        return Ok((img, exif, raw_development_report));
                    }
                    match read_file_mapped(Path::new(&path_clone)) {
                    Ok(mmap) => {
                        if decode_generation_tracker.load(Ordering::SeqCst) != my_generation {
                            return Err("Load cancelled".to_string());
                        }

                        let fingerprint = fingerprint_cache.fingerprint(&expected_revision, &mmap);
                        log::trace!("decoded_source_fingerprint={}", fingerprint.blake3.to_hex());
                        let (img, raw_development_report) = load_base_image_from_bytes_with_report(
                            &mmap,
                            &path_clone,
                            false,
                            &effective_settings,
                            cancel_token.clone(),
                        )
                        .map_err(|e| e.to_string())?;
                        let mut exif = exif_processing::read_exif_data(&path_clone, &mmap);
                        exif.insert(
                            "RawEngineRawProcessingMode".to_string(),
                            effective_settings
                                .raw_processing_mode
                                .clone()
                                .unwrap_or_else(|| "balanced".to_string()),
                        );
                        exif.insert(
                            "RawEngineRawProcessingProvenance".to_string(),
                            raw_processing_mode_recipe(
                                effective_settings.raw_processing_mode.as_deref(),
                            )
                            .provenance
                            .to_string(),
                        );
                        if let Some(report) = &raw_development_report {
                            add_raw_development_report_exif(&mut exif, report);
                        }
                        if SourceRevision::from_path(Path::new(&path_clone))
                            .map_err(|error| error.to_string())?
                            != expected_revision
                        {
                            return Err("source_changed_during_decode".to_string());
                        }
                        Ok((img, exif, raw_development_report))
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to memory-map file '{}': {}. Falling back to standard read.",
                            path_clone,
                            e
                        );
                        let bytes = fs::read(&path_clone).map_err(|io_err| {
                            format!("Fallback read failed for {}: {}", path_clone, io_err)
                        })?;
                        let fingerprint = fingerprint_cache.fingerprint(&expected_revision, &bytes);
                        log::trace!("decoded_source_fingerprint={}", fingerprint.blake3.to_hex());

                        if decode_generation_tracker.load(Ordering::SeqCst) != my_generation {
                            return Err("Load cancelled".to_string());
                        }

                        let (img, raw_development_report) = load_base_image_from_bytes_with_report(
                            &bytes,
                            &path_clone,
                            false,
                            &effective_settings,
                            cancel_token.clone(),
                        )
                        .map_err(|e| e.to_string())?;
                        let mut exif = exif_processing::read_exif_data(&path_clone, &bytes);
                        exif.insert(
                            "RawEngineRawProcessingMode".to_string(),
                            effective_settings
                                .raw_processing_mode
                                .clone()
                                .unwrap_or_else(|| "balanced".to_string()),
                        );
                        exif.insert(
                            "RawEngineRawProcessingProvenance".to_string(),
                            raw_processing_mode_recipe(
                                effective_settings.raw_processing_mode.as_deref(),
                            )
                            .provenance
                            .to_string(),
                        );
                        if let Some(report) = &raw_development_report {
                            add_raw_development_report_exif(&mut exif, report);
                        }
                        if SourceRevision::from_path(Path::new(&path_clone))
                            .map_err(|error| error.to_string())?
                            != expected_revision
                        {
                            return Err("source_changed_during_decode".to_string());
                        }
                        Ok((img, exif, raw_development_report))
                    }
                    }
                })();
                result
            })
            .await
            .map_err(|e| e.to_string())??;

            let decode_elapsed_ms = decode_started.elapsed().as_millis();
            let (loaded_width, loaded_height) = pristine_img.dimensions();
            let raw_development_report = raw_development_report.map(|mut report| {
                report.runtime = Some(RawRuntimeReport {
                    cache_hit: false,
                    decode_elapsed_ms: Some(decode_elapsed_ms),
                    export_elapsed_ms: None,
                    output_dimensions: Some((loaded_width, loaded_height)),
                    preview_elapsed_ms: Some(load_started.elapsed().as_millis()),
                });
                report
            });
            let mut exif_data_loaded = exif_data_loaded;
            if let Some(report) = &raw_development_report {
                add_raw_development_report_exif(&mut exif_data_loaded, report);
            }

            let arc_img = Arc::new(pristine_img);

            state.decoded_image_cache.insert(
                raw_processing_cache_key,
                arc_img.clone(),
                exif_data_loaded.clone(),
                raw_development_report.clone(),
            );

            (arc_img, exif_data_loaded, raw_development_report)
        };

    if generation_tracker.load(Ordering::SeqCst) != my_generation {
        return Err("Load cancelled".to_string());
    }

    let is_raw = is_raw_file(&source_path_str);
    let loaded_is_raw = is_raw && !is_offline_smart_preview;

    if generation_tracker.load(Ordering::SeqCst) != my_generation {
        return Err("Load cancelled".to_string());
    }

    let (orig_width, orig_height) = pristine_arc.dimensions();

    if install_active {
        state.viewer_sample_frames.clear();
        *state.original_image.lock().unwrap() = Some(LoadedImage {
            path,
            image: pristine_arc,
            is_raw: loaded_is_raw,
            artifact_source,
        });
    }

    Ok(LoadImageResult {
        width: orig_width,
        height: orig_height,
        metadata,
        exif: exif_data,
        is_raw: loaded_is_raw,
        is_offline_smart_preview,
        raw_development_report,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_offline_smart_preview_when_original_is_missing() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let smart_preview_dir = temp_dir.path().join("smart-previews");
        fs::create_dir_all(&smart_preview_dir).expect("smart preview dir");

        let missing_original = temp_dir.path().join("missing-original.dng");
        let missing_original_str = missing_original.to_string_lossy().to_string();
        let preview_id = compute_smart_preview_id(&missing_original_str);
        let preview_path = smart_preview_dir.join(format!("{}.jpg", preview_id));
        let manifest_path = smart_preview_dir.join(format!("{}.json", preview_id));

        let preview = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            24,
            16,
            image::Rgb([32, 64, 96]),
        ));
        preview.save(&preview_path).expect("save smart preview");
        fs::write(
            manifest_path,
            serde_json::json!({
                "width": 24,
                "height": 16,
                "sourceAvailable": false,
                "stale": true,
            })
            .to_string(),
        )
        .expect("write manifest");

        let (loaded, manifest) =
            load_offline_smart_preview_from_cache(temp_dir.path(), &missing_original_str)
                .expect("offline smart preview");

        assert_eq!(loaded.dimensions(), (24, 16));
        assert_eq!(manifest.width, 24);
        assert_eq!(manifest.height, 16);
        assert!(!manifest.source_available);
        assert!(manifest.stale);
    }

    #[test]
    fn ignores_smart_preview_when_original_exists() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let original = temp_dir.path().join("connected.dng");
        fs::write(&original, b"connected").expect("original");

        let loaded =
            load_offline_smart_preview_from_cache(temp_dir.path(), &original.to_string_lossy());

        assert!(loaded.is_none());
    }

    #[test]
    fn raw_processing_mode_recipes_are_distinct() {
        let fast = raw_processing_mode_recipe(Some("fast"));
        let balanced = raw_processing_mode_recipe(Some("balanced"));
        let maximum = raw_processing_mode_recipe(Some("maximum"));

        assert!(fast.force_fast_demosaic);
        assert!(!balanced.force_fast_demosaic);
        assert!(!maximum.force_fast_demosaic);
        assert_eq!(fast.raw_preprocessing_sharpening, 0.0);
        assert!(maximum.raw_highlight_compression > balanced.raw_highlight_compression);
        assert!(maximum.raw_preprocessing_sharpening > balanced.raw_preprocessing_sharpening);
        assert_eq!(
            balanced.provenance,
            "default_quality_capture_preprocessing_v1"
        );
    }

    #[test]
    fn demosaic_aware_capture_sharpening_preserves_manual_overrides() {
        let recipe = raw_processing_mode_recipe(Some("balanced"));
        let manual = AppSettings {
            raw_preprocessing_sharpening: Some(0.62),
            raw_preprocessing_sharpening_detail: Some(0.7),
            raw_preprocessing_sharpening_edge_masking: Some(0.2),
            raw_preprocessing_sharpening_radius: Some(1.4),
            ..AppSettings::default()
        };

        let resolved = resolve_capture_pre_sharpening_settings(
            &manual,
            &recipe,
            DemosaicSharpeningPath::BayerHq,
            (8000, 6000),
        );

        assert_eq!(resolved.amount, 0.62);
        assert_eq!(resolved.detail, 0.7);
        assert_eq!(resolved.edge_masking, 0.2);
        assert_eq!(resolved.radius_px, 1.4);
    }

    #[test]
    fn demosaic_aware_capture_sharpening_tunes_recipe_defaults() {
        let balanced_recipe = raw_processing_mode_recipe(Some("balanced"));
        let maximum_recipe = raw_processing_mode_recipe(Some("maximum"));
        let balanced_settings = AppSettings::default();
        let maximum_settings = AppSettings {
            raw_processing_mode: Some("maximum".to_string()),
            raw_preprocessing_color_nr: Some(maximum_recipe.raw_preprocessing_color_nr),
            raw_preprocessing_sharpening: Some(maximum_recipe.raw_preprocessing_sharpening),
            raw_preprocessing_sharpening_detail: Some(
                maximum_recipe.raw_preprocessing_sharpening_detail,
            ),
            raw_preprocessing_sharpening_edge_masking: Some(
                maximum_recipe.raw_preprocessing_sharpening_edge_masking,
            ),
            raw_preprocessing_sharpening_radius: Some(
                maximum_recipe.raw_preprocessing_sharpening_radius,
            ),
            ..AppSettings::default()
        };

        let balanced = resolve_capture_pre_sharpening_settings(
            &balanced_settings,
            &balanced_recipe,
            DemosaicSharpeningPath::Standard,
            (6000, 4000),
        );
        let maximum = resolve_capture_pre_sharpening_settings(
            &maximum_settings,
            &maximum_recipe,
            DemosaicSharpeningPath::BayerHq,
            (8000, 6000),
        );

        assert!(maximum.amount > balanced.amount);
        assert!(maximum.detail > balanced.detail);
        assert!(maximum.edge_masking > balanced.edge_masking);
        assert!(maximum.radius_px > balanced.radius_px);
    }

    #[test]
    fn xtrans_hq_capture_sharpening_stays_conservative() {
        let maximum_recipe = raw_processing_mode_recipe(Some("maximum"));
        let maximum_settings = AppSettings {
            raw_processing_mode: Some("maximum".to_string()),
            raw_preprocessing_color_nr: Some(maximum_recipe.raw_preprocessing_color_nr),
            raw_preprocessing_sharpening: Some(maximum_recipe.raw_preprocessing_sharpening),
            raw_preprocessing_sharpening_detail: Some(
                maximum_recipe.raw_preprocessing_sharpening_detail,
            ),
            raw_preprocessing_sharpening_edge_masking: Some(
                maximum_recipe.raw_preprocessing_sharpening_edge_masking,
            ),
            raw_preprocessing_sharpening_radius: Some(
                maximum_recipe.raw_preprocessing_sharpening_radius,
            ),
            ..AppSettings::default()
        };

        let bayer_hq = resolve_capture_pre_sharpening_settings(
            &maximum_settings,
            &maximum_recipe,
            DemosaicSharpeningPath::BayerHq,
            (8000, 6000),
        );
        let xtrans_hq = resolve_capture_pre_sharpening_settings(
            &maximum_settings,
            &maximum_recipe,
            DemosaicSharpeningPath::XTransHq,
            (8000, 6000),
        );

        assert!(xtrans_hq.amount < bayer_hq.amount);
        assert!(xtrans_hq.detail < bayer_hq.detail);
        assert!(xtrans_hq.radius_px < bayer_hq.radius_px);
        assert!(xtrans_hq.edge_masking >= 0.42);
    }

    #[test]
    fn unknown_raw_processing_mode_uses_balanced_recipe() {
        let unknown = raw_processing_mode_recipe(Some("experimental"));
        let balanced = raw_processing_mode_recipe(Some("balanced"));

        assert_eq!(unknown.provenance, balanced.provenance);
        assert_eq!(
            unknown.raw_preprocessing_color_nr,
            balanced.raw_preprocessing_color_nr
        );
    }

    #[test]
    fn raw_processing_mode_override_updates_settings_and_cache_key() {
        let base_settings = AppSettings {
            raw_processing_mode: Some("fast".to_string()),
            raw_preprocessing_sharpening: Some(0.0),
            ..AppSettings::default()
        };
        let adjustments = serde_json::json!({
            "rawProcessingModeOverride": "maximum",
        });

        let resolved = raw_processing_settings_for_adjustments(&base_settings, &adjustments);
        assert_eq!(resolved.raw_processing_mode.as_deref(), Some("maximum"));
        assert_eq!(resolved.raw_preprocessing_color_nr, Some(0.65));
        assert_eq!(resolved.raw_preprocessing_sharpening, Some(0.42));
        let resolved_cache_key = raw_processing_profile_key(&resolved);
        assert_eq!(resolved_cache_key.mode, "maximum");
        assert_eq!(
            resolved_cache_key.camera_profile_resolver_version,
            "dual_illuminant_mired_v2"
        );
        assert_eq!(
            resolved_cache_key.reconstruction_version,
            "raw_reconstruction_v4"
        );
        assert_eq!(
            resolved_cache_key.highlight_compression_bits,
            4.0_f32.to_bits()
        );
        assert!(
            (f32::from_bits(resolved_cache_key.sharpening_bits[0]) - 0.441).abs() < f32::EPSILON
        );

        let inherited =
            raw_processing_settings_for_adjustments(&base_settings, &serde_json::json!({}));
        assert_eq!(inherited.raw_processing_mode.as_deref(), Some("fast"));
        let inherited_cache_key = raw_processing_profile_key(&inherited);
        assert_eq!(inherited_cache_key.mode, "fast");
        assert_ne!(resolved_cache_key, inherited_cache_key);
    }

    #[test]
    fn raw_cache_key_changes_with_decode_affecting_settings() {
        let base = AppSettings {
            raw_processing_mode: Some("balanced".to_string()),
            ..AppSettings::default()
        };
        let highlight_changed = AppSettings {
            raw_highlight_compression: Some(3.5),
            ..base.clone()
        };
        let linear_mode_changed = AppSettings {
            linear_raw_mode: "gamma_skip_calib".to_string(),
            ..base.clone()
        };
        let sharpening_changed = AppSettings {
            raw_preprocessing_sharpening: Some(0.71),
            raw_preprocessing_sharpening_detail: Some(0.23),
            raw_preprocessing_sharpening_edge_masking: Some(0.19),
            raw_preprocessing_sharpening_radius: Some(1.3),
            ..base.clone()
        };

        let base_key = raw_processing_profile_key(&base);
        assert_ne!(base_key, raw_processing_profile_key(&highlight_changed));
        assert_ne!(base_key, raw_processing_profile_key(&linear_mode_changed));
        assert_ne!(base_key, raw_processing_profile_key(&sharpening_changed));
    }

    #[test]
    fn private_raw_processing_modes_generate_distinct_exports_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_RAW_PROCESSING_MODE_PROOF").ok()
            != Some("1".to_string())
        {
            return;
        }

        let bayer_source = std::env::var("RAWENGINE_RAW_PROCESSING_MODE_BAYER_SOURCE")
            .or_else(|_| std::env::var("RAWENGINE_RAW_PROCESSING_MODE_SOURCE"))
            .expect("RAWENGINE_RAW_PROCESSING_MODE_BAYER_SOURCE must point to a private Bayer RAW");
        let xtrans_source = std::env::var("RAWENGINE_RAW_PROCESSING_MODE_XTRANS_SOURCE").expect(
            "RAWENGINE_RAW_PROCESSING_MODE_XTRANS_SOURCE must point to a private X-Trans RAW",
        );
        let report_dir = std::env::var("RAWENGINE_RAW_PROCESSING_MODE_REPORT_DIR")
            .unwrap_or_else(|_| "target/raw-processing-mode-proof".to_string());
        let report_dir = Path::new(&report_dir);
        fs::create_dir_all(report_dir).expect("create report dir");

        let mut source_reports = Vec::new();

        for (source_class, source_path) in [("bayer", bayer_source), ("xtrans", xtrans_source)] {
            let source_bytes = fs::read(&source_path).expect("read private RAW");
            let mut mode_reports = Vec::new();
            let mut image_hashes = Vec::new();
            let mut export_hashes = Vec::new();

            for mode in ["fast", "balanced", "maximum"] {
                let recipe = raw_processing_mode_recipe(Some(mode));
                let settings = AppSettings {
                    raw_processing_mode: Some(mode.to_string()),
                    raw_highlight_compression: Some(recipe.raw_highlight_compression),
                    raw_preprocessing_color_nr: Some(recipe.raw_preprocessing_color_nr),
                    raw_preprocessing_sharpening: Some(recipe.raw_preprocessing_sharpening),
                    raw_preprocessing_sharpening_detail: Some(
                        recipe.raw_preprocessing_sharpening_detail,
                    ),
                    raw_preprocessing_sharpening_edge_masking: Some(
                        recipe.raw_preprocessing_sharpening_edge_masking,
                    ),
                    raw_preprocessing_sharpening_radius: Some(
                        recipe.raw_preprocessing_sharpening_radius,
                    ),
                    apply_preprocessing_to_non_raws: Some(false),
                    ..AppSettings::default()
                };

                let started = Instant::now();
                let image =
                    load_base_image_from_bytes(&source_bytes, &source_path, false, &settings, None)
                        .expect("decode private RAW with processing mode");
                let decode_elapsed_ms = started.elapsed().as_millis();
                let profile = RawProcessingProfile::from_mode(mode);
                let (_, development_report) = develop_raw_image_with_report(
                    &source_bytes,
                    recipe.force_fast_demosaic,
                    profile,
                    recipe.raw_highlight_compression,
                    "default".to_string(),
                    None,
                )
                .expect("develop private RAW report for processing mode");
                let effective_sharpening = resolve_capture_pre_sharpening_settings(
                    &settings,
                    &recipe,
                    demosaic_sharpening_path(development_report.demosaic_path),
                    image.dimensions(),
                );
                let rgba = image.to_rgba8();
                let image_hash = blake3::hash(rgba.as_raw()).to_hex().to_string();
                let export_path = report_dir.join(format!("{}-{}.tiff", source_class, mode));
                image
                    .save_with_format(&export_path, image::ImageFormat::Tiff)
                    .expect("write processing mode TIFF export");
                let export_bytes = fs::read(&export_path).expect("read TIFF export");
                let export_hash = blake3::hash(&export_bytes).to_hex().to_string();
                let export_size_bytes = export_bytes.len();

                println!(
                    "raw_processing_mode_export source={} mode={} dimensions={}x{} elapsed_ms={} image_hash={} export_hash={} export_bytes={}",
                    source_class,
                    mode,
                    image.width(),
                    image.height(),
                    decode_elapsed_ms,
                    image_hash,
                    export_hash,
                    export_size_bytes
                );

                image_hashes.push(image_hash.clone());
                export_hashes.push(export_hash.clone());
                mode_reports.push(serde_json::json!({
                    "decodeElapsedMs": decode_elapsed_ms,
                    "dimensions": {
                        "height": image.height(),
                        "width": image.width(),
                    },
                    "exportHash": export_hash,
                    "exportPath": export_path.to_string_lossy(),
                    "exportSizeBytes": export_size_bytes,
                    "imageHash": image_hash,
                    "mode": mode,
                    "provenance": recipe.provenance,
                    "effectiveCaptureSharpening": {
                        "amount": effective_sharpening.amount,
                        "detail": effective_sharpening.detail,
                        "edgeMasking": effective_sharpening.edge_masking,
                        "radiusPx": effective_sharpening.radius_px,
                    },
                }));
            }

            assert_eq!(image_hashes.len(), 3);
            assert_eq!(export_hashes.len(), 3);
            assert_ne!(image_hashes[0], image_hashes[1]);
            assert_ne!(image_hashes[1], image_hashes[2]);
            assert_ne!(export_hashes[0], export_hashes[1]);
            assert_ne!(export_hashes[1], export_hashes[2]);

            source_reports.push(serde_json::json!({
                "sourceClass": source_class,
                "sourcePath": source_path,
                "modes": mode_reports,
            }));
        }

        let report = serde_json::json!({
            "issue": 3293,
            "proofBoundary": "private_raw_processing_mode_export_runtime",
            "sources": source_reports,
        });
        fs::write(
            report_dir.join("raw-processing-mode-export-proof.json"),
            serde_json::to_vec_pretty(&report).expect("serialize report"),
        )
        .expect("write processing mode proof report");
    }

    #[test]
    fn private_raw_processing_mode_override_roundtrips_sidecar_and_output_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_RAW_PROCESSING_MODE_OVERRIDE_PROOF").ok()
            != Some("1".to_string())
        {
            return;
        }

        let source_path = std::env::var("RAWENGINE_RAW_PROCESSING_MODE_SOURCE")
            .expect("RAWENGINE_RAW_PROCESSING_MODE_SOURCE must point to a private RAW");
        let report_dir = std::env::var("RAWENGINE_RAW_PROCESSING_MODE_REPORT_DIR")
            .unwrap_or_else(|_| "target/raw-processing-mode-override-proof".to_string());
        let report_dir = Path::new(&report_dir);
        fs::create_dir_all(report_dir).expect("create report dir");
        let source_bytes = fs::read(&source_path).expect("read private RAW");
        let base_settings = AppSettings {
            raw_processing_mode: Some("balanced".to_string()),
            ..AppSettings::default()
        };
        let mut reports = Vec::new();
        let mut image_hashes = Vec::new();
        let mut export_hashes = Vec::new();

        for mode in ["fast", "maximum"] {
            let adjustments = serde_json::json!({
                "rawProcessingModeOverride": mode,
            });
            let sidecar_path = report_dir.join(format!("override-{}.rrdata", mode));
            let sidecar = ImageMetadata {
                adjustments: adjustments.clone(),
                ..ImageMetadata::default()
            };
            crate::exif_processing::save_sidecar_metadata_atomic(&sidecar_path, &sidecar)
                .expect("write override sidecar");
            let reloaded = crate::exif_processing::load_sidecar(&sidecar_path);
            assert_eq!(
                raw_processing_mode_override_from_adjustments(&reloaded.adjustments),
                Some(mode)
            );

            let settings =
                raw_processing_settings_for_adjustments(&base_settings, &reloaded.adjustments);
            let image =
                load_base_image_from_bytes(&source_bytes, &source_path, false, &settings, None)
                    .expect("decode private RAW with sidecar override");
            let rgba = image.to_rgba8();
            let image_hash = blake3::hash(rgba.as_raw()).to_hex().to_string();
            let export_path = report_dir.join(format!("override-{}.tiff", mode));
            image
                .save_with_format(&export_path, image::ImageFormat::Tiff)
                .expect("write override TIFF export");
            let export_bytes = fs::read(&export_path).expect("read override TIFF export");
            let export_hash = blake3::hash(&export_bytes).to_hex().to_string();

            println!(
                "raw_processing_mode_override_proof mode={} dimensions={}x{} image_hash={} export_hash={} sidecar={}",
                mode,
                image.width(),
                image.height(),
                image_hash,
                export_hash,
                sidecar_path.display()
            );

            image_hashes.push(image_hash.clone());
            export_hashes.push(export_hash.clone());
            reports.push(serde_json::json!({
                "dimensions": {
                    "height": image.height(),
                    "width": image.width(),
                },
                "exportHash": export_hash,
                "exportPath": export_path.to_string_lossy(),
                "imageHash": image_hash,
                "mode": mode,
                "sidecarPath": sidecar_path.to_string_lossy(),
            }));
        }

        assert_eq!(image_hashes.len(), 2);
        assert_eq!(export_hashes.len(), 2);
        assert_ne!(image_hashes[0], image_hashes[1]);
        assert_ne!(export_hashes[0], export_hashes[1]);

        let report = serde_json::json!({
            "issue": 3294,
            "proofBoundary": "private_raw_sidecar_override_export_runtime",
            "outputs": reports,
        });
        fs::write(
            report_dir.join("raw-processing-mode-override-proof.json"),
            serde_json::to_vec_pretty(&report).expect("serialize override report"),
        )
        .expect("write override proof report");
    }

    #[test]
    fn private_demosaic_aware_capture_sharpening_generates_output_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_CAPTURE_SHARPENING_PROOF").ok()
            != Some("1".to_string())
        {
            return;
        }

        let source_path = std::env::var("RAWENGINE_CAPTURE_SHARPENING_SOURCE")
            .expect("RAWENGINE_CAPTURE_SHARPENING_SOURCE must point to a private Bayer RAW");
        let report_dir = std::env::var("RAWENGINE_CAPTURE_SHARPENING_REPORT_DIR")
            .unwrap_or_else(|_| "target/capture-sharpening-proof".to_string());
        let report_dir = Path::new(&report_dir);
        fs::create_dir_all(report_dir).expect("create report dir");
        let source_bytes = fs::read(&source_path).expect("read private RAW");
        let recipe = raw_processing_mode_recipe(Some("maximum"));

        let enabled_settings = AppSettings {
            raw_processing_mode: Some("maximum".to_string()),
            raw_preprocessing_color_nr: Some(recipe.raw_preprocessing_color_nr),
            raw_preprocessing_sharpening: Some(recipe.raw_preprocessing_sharpening),
            raw_preprocessing_sharpening_detail: Some(recipe.raw_preprocessing_sharpening_detail),
            raw_preprocessing_sharpening_edge_masking: Some(
                recipe.raw_preprocessing_sharpening_edge_masking,
            ),
            raw_preprocessing_sharpening_radius: Some(recipe.raw_preprocessing_sharpening_radius),
            apply_preprocessing_to_non_raws: Some(false),
            ..AppSettings::default()
        };
        let disabled_settings = AppSettings {
            raw_preprocessing_sharpening: Some(0.0),
            raw_preprocessing_sharpening_detail: Some(0.0),
            raw_preprocessing_sharpening_edge_masking: Some(0.0),
            raw_preprocessing_sharpening_radius: Some(1.0),
            ..enabled_settings.clone()
        };
        let (_, development_report) = develop_raw_image_with_report(
            &source_bytes,
            recipe.force_fast_demosaic,
            RawProcessingProfile::Maximum,
            recipe.raw_highlight_compression,
            "default".to_string(),
            None,
        )
        .expect("develop private RAW report for capture sharpening proof");
        assert_eq!(development_report.demosaic_path, RawDemosaicPath::BayerHq);
        let sharpening_path = demosaic_sharpening_path(development_report.demosaic_path);

        let mut reports = Vec::new();
        let mut hashes = Vec::new();
        for (case, settings) in [
            ("demosaic-aware", enabled_settings),
            ("disabled", disabled_settings),
        ] {
            let started = Instant::now();
            let image =
                load_base_image_from_bytes(&source_bytes, &source_path, false, &settings, None)
                    .expect("decode private RAW for capture sharpening proof");
            let elapsed_ms = started.elapsed().as_millis();
            let effective_sharpening = resolve_capture_pre_sharpening_settings(
                &settings,
                &recipe,
                sharpening_path,
                image.dimensions(),
            );
            let rgba = image.to_rgba8();
            let hash = blake3::hash(rgba.as_raw()).to_hex().to_string();
            let export_path = report_dir.join(format!("{}.tiff", case));
            image
                .save_with_format(&export_path, image::ImageFormat::Tiff)
                .expect("write capture sharpening TIFF export");

            println!(
                "capture_sharpening_proof case={} dimensions={}x{} elapsed_ms={} image_hash={}",
                case,
                image.width(),
                image.height(),
                elapsed_ms,
                hash
            );

            hashes.push(hash.clone());
            reports.push(serde_json::json!({
                "case": case,
                "dimensions": {
                    "height": image.height(),
                    "width": image.width(),
                },
                "elapsedMs": elapsed_ms,
                "exportPath": export_path.to_string_lossy(),
                "imageHash": hash,
                "rawDemosaicPath": format!("{:?}", development_report.demosaic_path),
                "effectiveCaptureSharpening": {
                    "amount": effective_sharpening.amount,
                    "detail": effective_sharpening.detail,
                    "edgeMasking": effective_sharpening.edge_masking,
                    "radiusPx": effective_sharpening.radius_px,
                },
            }));
        }

        assert_eq!(hashes.len(), 2);
        assert_ne!(hashes[0], hashes[1]);

        let report = serde_json::json!({
            "issue": 3245,
            "proofBoundary": "private_bayer_raw_capture_sharpening_runtime",
            "sourcePath": source_path,
            "cases": reports,
        });
        fs::write(
            report_dir.join("capture-sharpening-proof.json"),
            serde_json::to_vec_pretty(&report).expect("serialize report"),
        )
        .expect("write capture sharpening proof report");
    }
}
