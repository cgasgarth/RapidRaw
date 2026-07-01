use crate::app_settings::{AppSettings, load_settings_or_default};
use crate::app_state::AppState;
use crate::derived_output_provenance::{
    DerivedOutputProvenanceInput, DerivedOutputProvenanceSource,
    build_derived_output_provenance_sidecar, stable_hash,
};
use crate::file_management::parse_virtual_path;
use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use image::ImageFormat;
use image::{DynamicImage, GenericImageView, GrayImage, Rgb32FImage};
use nalgebra::Matrix3;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Runtime};
use uuid::Uuid;

use crate::formats::{is_raw_file, png_data_url};
use crate::image_processing::apply_cpu_default_raw_processing;
use crate::image_processing::{ImageMetadata, RawEngineArtifacts};
use crate::panorama_utils::{processing, stitching};

pub const BRIEF_DESCRIPTOR_SIZE: usize = 256;
pub type Descriptor = [u8; BRIEF_DESCRIPTOR_SIZE / 8];
const MIN_RENDER_ALIGNMENT_INLIER_RATIO: f64 = 0.55;
const MAX_RENDER_MEAN_REPROJECTION_ERROR_PX: f64 = 5.0;

#[derive(Debug, Clone, Copy)]
pub struct KeyPoint {
    pub x: u32,
    pub y: u32,
}

pub struct Feature {
    pub keypoint: KeyPoint,
    pub descriptor: Descriptor,
}

#[derive(Debug, Clone, Copy)]
pub struct Match {
    pub index1: usize,
    pub index2: usize,
}

pub struct ImageInfo {
    pub id: usize,
    pub filename: String,
    pub image: Rgb32FImage,
    pub low_detail_mask: GrayImage,
    pub scale_factor: f64,
    pub features: Vec<Feature>,
}

#[derive(Clone)]
pub struct MatchInfo {
    pub brief_match_diagnostics: processing::BriefMatchDiagnostics,
    pub homography: Matrix3<f64>,
    pub inliers: usize,
    pub match_count: usize,
    pub mean_reprojection_error_px: f64,
    pub mean_reverse_reprojection_error_px: f64,
    pub mean_symmetric_transfer_error_px: f64,
    pub p95_symmetric_transfer_error_px: f64,
    pub spatial_support_cell_count: usize,
}

impl MatchInfo {
    fn inlier_ratio(&self) -> f64 {
        if self.match_count == 0 {
            0.0
        } else {
            self.inliers as f64 / self.match_count as f64
        }
    }

    fn is_graph_eligible(&self) -> bool {
        self.homography.iter().all(|value| value.is_finite())
            && self.homography.is_invertible()
            && self.inliers >= processing::MIN_INLIERS_FOR_CONNECTION
            && self.inlier_ratio() >= MIN_RENDER_ALIGNMENT_INLIER_RATIO
            && self.mean_symmetric_transfer_error_px <= MAX_RENDER_MEAN_REPROJECTION_ERROR_PX
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanoramaRenderRequest {
    pub options: PanoramaStitchOptions,
    pub image_paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PanoramaProjectionOption {
    Cylindrical,
    #[default]
    Rectilinear,
    Spherical,
}

impl PanoramaProjectionOption {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cylindrical => "cylindrical",
            Self::Rectilinear => "rectilinear",
            Self::Spherical => "spherical",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PanoramaBoundaryModeOption {
    #[default]
    AutoCrop,
    ManualCrop,
    Transparent,
}

impl PanoramaBoundaryModeOption {
    fn as_str(self) -> &'static str {
        match self {
            Self::AutoCrop => "auto_crop",
            Self::ManualCrop => "manual_crop",
            Self::Transparent => "transparent",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PanoramaQualityPreferenceOption {
    Balanced,
    #[default]
    Best,
    Preview,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaStitchOptions {
    #[serde(default)]
    pub boundary_mode: PanoramaBoundaryModeOption,
    #[serde(default)]
    pub max_preview_dimension_px: Option<u32>,
    #[serde(default)]
    pub projection: PanoramaProjectionOption,
    #[serde(default)]
    pub quality_preference: PanoramaQualityPreferenceOption,
}

impl Default for PanoramaStitchOptions {
    fn default() -> Self {
        Self {
            boundary_mode: PanoramaBoundaryModeOption::AutoCrop,
            max_preview_dimension_px: Some(DEFAULT_PANORAMA_MAX_PREVIEW_DIMENSION_PX),
            projection: PanoramaProjectionOption::Rectilinear,
            quality_preference: PanoramaQualityPreferenceOption::Best,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PanoramaSourceMetadata {
    pub global_transform_3x3: Option<[f64; 9]>,
    pub height: u32,
    pub index: usize,
    pub path: String,
    pub width: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PanoramaPairwiseMatchMetadata {
    pub brief_match_diagnostics: processing::BriefMatchDiagnostics,
    pub homography3x3: [f64; 9],
    pub homography_condition_number: Option<f64>,
    pub inlier_ratio: f64,
    pub inliers: usize,
    pub match_count: usize,
    pub mean_reprojection_error_px: f64,
    pub mean_reverse_reprojection_error_px: f64,
    pub mean_symmetric_transfer_error_px: f64,
    pub p95_symmetric_transfer_error_px: f64,
    pub source_index: usize,
    pub spatial_support_cell_count: usize,
    pub target_index: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PanoramaSelectedMatchEdgeMetadata {
    pub child_source_index: usize,
    pub edge_rank: usize,
    pub parent_source_index: usize,
    pub source_index: usize,
    pub target_index: usize,
    pub tree_depth: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PanoramaRenderMetadata {
    pub blend_diagnostics: stitching::StitchBlendDiagnostics,
    pub connected_source_indices: Vec<usize>,
    pub crop: PanoramaCropMetadata,
    pub effective_boundary_mode: PanoramaBoundaryModeOption,
    pub effective_projection: PanoramaProjectionOption,
    pub estimated_peak_memory_bytes: u64,
    pub excluded_source_indices: Vec<usize>,
    pub output_height: u32,
    pub output_width: u32,
    pub pairwise_matches: Vec<PanoramaPairwiseMatchMetadata>,
    pub reference_source_index: Option<usize>,
    pub requested_boundary_mode: PanoramaBoundaryModeOption,
    pub requested_projection: PanoramaProjectionOption,
    pub selected_match_edges: Vec<PanoramaSelectedMatchEdgeMetadata>,
    pub max_transform_chain_length: usize,
    pub sources: Vec<PanoramaSourceMetadata>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanoramaCropMetadata {
    pub height: u32,
    pub mode: String,
    pub pre_crop_height: u32,
    pub pre_crop_width: u32,
    pub width: u32,
    pub x: u32,
    pub y: u32,
}

pub struct PanoramaRenderResult {
    pub image: DynamicImage,
    pub metadata: PanoramaRenderMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingPanoramaSourceRef {
    pub image_path: String,
    pub raw_defaults_applied: bool,
    pub source_index: usize,
    pub virtual_copy_id: Option<String>,
}

#[derive(Clone)]
pub struct PendingPanoramaResult {
    pub image: DynamicImage,
    pub metadata: PanoramaRenderMetadata,
    pub source_refs: Vec<PendingPanoramaSourceRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaPlanSourceRef {
    pub height: u32,
    pub image_path: String,
    pub raw_defaults_applied: bool,
    pub role: String,
    pub source_index: usize,
    pub width: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaPlanDimensions {
    pub height: u32,
    pub width: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaProjectedBounds {
    pub height: u32,
    pub width: u32,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaGeometryEstimate {
    pub output_pixel_count: u64,
    pub projected_bounds: PanoramaProjectedBounds,
    pub source_count: usize,
    pub source_pixel_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaMemoryComponents {
    pub low_detail_mask_bytes: u64,
    pub output_canvas_bytes: u64,
    pub output_mask_bytes: u64,
    pub overhead_bytes: u64,
    pub preview_bytes: u64,
    pub seam_workspace_bytes: u64,
    pub source_decode_bytes: u64,
    pub total_estimated_peak_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaPreflightEstimate {
    pub blocked_reasons: Vec<String>,
    pub engine_capabilities: PanoramaPlanEngineCapabilities,
    pub execution_mode: String,
    pub geometry_estimate: PanoramaGeometryEstimate,
    pub memory_budget_bytes: u64,
    pub memory_budget_ratio: f64,
    pub memory_components: PanoramaMemoryComponents,
    pub status: String,
    pub tile_count: u32,
    pub warning_codes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaPlanEngineCapabilities {
    pub full_frame_legacy: bool,
    pub max_preview_dimension_px: u32,
    pub plan_only: bool,
    pub tile_backed_render: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanoramaPlanResult {
    pub dry_run: bool,
    pub family: String,
    pub mutates: bool,
    pub output_dimensions: PanoramaPlanDimensions,
    pub preflight: PanoramaPreflightEstimate,
    pub source_image_refs: Vec<PanoramaPlanSourceRef>,
    pub warnings: Vec<String>,
}

pub trait PanoramaRenderEngine {
    fn render(
        &self,
        request: PanoramaRenderRequest,
        app_handle: AppHandle,
    ) -> Result<PanoramaRenderResult, String>;
}

pub struct LegacyRapidRawHomographyEngine;

impl PanoramaRenderEngine for LegacyRapidRawHomographyEngine {
    fn render(
        &self,
        request: PanoramaRenderRequest,
        app_handle: AppHandle,
    ) -> Result<PanoramaRenderResult, String> {
        render_with_legacy_homography_engine(request, app_handle)
    }
}

const DEFAULT_PANORAMA_MEMORY_BUDGET_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const DEFAULT_PANORAMA_MAX_PREVIEW_DIMENSION_PX: u32 = 800;
const HIGH_MEMORY_BUDGET_RATIO: f64 = 0.8;

fn validate_panorama_stitch_options(options: &PanoramaStitchOptions) -> Result<(), String> {
    if options.projection != PanoramaProjectionOption::Rectilinear {
        return Err(
            "Panorama engine currently supports rectilinear projection only; cylindrical and spherical projection are blocked until runtime support lands."
                .to_string(),
        );
    }
    if options.boundary_mode != PanoramaBoundaryModeOption::AutoCrop {
        return Err(
            "Panorama engine currently supports auto-crop boundary handling only; transparent and manual crop are blocked until runtime support lands."
                .to_string(),
        );
    }
    if let Some(max_preview_dimension_px) = options.max_preview_dimension_px
        && max_preview_dimension_px == 0
    {
        return Err("Panorama preview dimension must be greater than zero.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn plan_panorama(
    paths: Vec<String>,
    memory_budget_bytes: Option<u64>,
    max_preview_dimension_px: Option<u32>,
    app_handle: tauri::AppHandle,
) -> Result<PanoramaPlanResult, String> {
    if paths.len() < 2 {
        return Err("Please select at least two images to plan a panorama.".to_string());
    }

    let source_paths: Vec<String> = paths
        .iter()
        .map(|p| parse_virtual_path(p).0.to_string_lossy().into_owned())
        .collect();
    let memory_budget = memory_budget_bytes.unwrap_or(DEFAULT_PANORAMA_MEMORY_BUDGET_BYTES);
    if memory_budget == 0 {
        return Err("Panorama memory budget must be greater than zero.".to_string());
    }

    let preview_dimension =
        max_preview_dimension_px.unwrap_or(DEFAULT_PANORAMA_MAX_PREVIEW_DIMENSION_PX);
    if preview_dimension == 0 {
        return Err("Panorama preview dimension must be greater than zero.".to_string());
    }

    let task = tokio::task::spawn_blocking(move || {
        let sources = load_panorama_source_metadata_for_plan(&source_paths, &app_handle)?;
        Ok(estimate_panorama_plan_from_sources(
            sources,
            memory_budget,
            preview_dimension,
        ))
    });

    match task.await {
        Ok(result) => result,
        Err(join_err) => Err(format!("Panorama plan task failed: {}", join_err)),
    }
}

#[tauri::command]
pub async fn stitch_panorama(
    options: Option<PanoramaStitchOptions>,
    paths: Vec<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if paths.len() < 2 {
        return Err("Please select at least two images to stitch.".to_string());
    }

    let source_refs = build_pending_panorama_source_refs(&paths);
    let source_paths: Vec<String> = paths
        .iter()
        .map(|p| parse_virtual_path(p).0.to_string_lossy().into_owned())
        .collect();
    let stitch_options = options.unwrap_or_default();
    validate_panorama_stitch_options(&stitch_options)?;

    let panorama_result_handle = state.panorama_result.clone();

    let task = tokio::task::spawn_blocking(move || {
        let engine = LegacyRapidRawHomographyEngine;
        let panorama_result = engine.render(
            PanoramaRenderRequest {
                image_paths: source_paths,
                options: stitch_options,
            },
            app_handle.clone(),
        );

        match panorama_result {
            Ok(render_result) => {
                let _ = app_handle.emit(crate::events::PANORAMA_PROGRESS, "Creating preview...");
                println!(
                    "Panorama metadata: {} connected source(s), {} excluded source(s), {} pairwise match(es), estimated peak memory {} bytes",
                    render_result.metadata.connected_source_indices.len(),
                    render_result.metadata.excluded_source_indices.len(),
                    render_result.metadata.pairwise_matches.len(),
                    render_result.metadata.estimated_peak_memory_bytes
                );

                let (w, h) = render_result.image.dimensions();
                let (new_w, new_h) = if w > h {
                    (800, (800.0 * h as f32 / w as f32).round() as u32)
                } else {
                    ((800.0 * w as f32 / h as f32).round() as u32, 800)
                };

                let preview_f32 = crate::image_processing::downscale_f32_image(
                    &render_result.image,
                    new_w,
                    new_h,
                );

                let preview_u8 = preview_f32.to_rgb8();

                let mut buf = Cursor::new(Vec::new());

                if let Err(e) = preview_u8.write_to(&mut buf, ImageFormat::Png) {
                    return Err(format!("Failed to encode panorama preview: {}", e));
                }

                let base64_str = general_purpose::STANDARD.encode(buf.get_ref());
                let final_base64 = png_data_url(base64_str);
                let render_review = build_panorama_render_review(&render_result.metadata);

                *panorama_result_handle.lock().unwrap() = Some(PendingPanoramaResult {
                    image: render_result.image,
                    metadata: render_result.metadata,
                    source_refs,
                });

                let _ = app_handle.emit(
                    "panorama-complete",
                    serde_json::json!({
                        "base64": final_base64,
                        "review": render_review,
                    }),
                );
                Ok(())
            }
            Err(e) => {
                let _ = app_handle.emit(crate::events::PANORAMA_ERROR, e.clone());
                Err(e)
            }
        }
    });

    match task.await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(join_err) => Err(format!("Panorama task failed: {}", join_err)),
    }
}

fn build_panorama_render_review(metadata: &PanoramaRenderMetadata) -> serde_json::Value {
    json!({
        "boundary": {
            "crop": {
                "height": metadata.crop.height,
                "mode": metadata.crop.mode,
                "preCropHeight": metadata.crop.pre_crop_height,
                "preCropWidth": metadata.crop.pre_crop_width,
                "width": metadata.crop.width,
                "x": metadata.crop.x,
                "y": metadata.crop.y,
            },
            "effective": metadata.effective_boundary_mode.as_str(),
            "requested": metadata.requested_boundary_mode.as_str(),
        },
        "capabilityLevel": "runtime_apply_capable",
        "outputDimensions": {
            "height": metadata.output_height,
            "width": metadata.output_width,
        },
        "projection": {
            "effective": metadata.effective_projection.as_str(),
            "requested": metadata.requested_projection.as_str(),
        },
        "seamReview": panorama_seam_review_metadata(metadata),
        "sources": {
            "excludedSourceIndices": &metadata.excluded_source_indices,
            "stitchedSourceIndices": &metadata.connected_source_indices,
            "totalCount": metadata.sources.len(),
        },
        "sourceContribution": panorama_source_contribution_metadata(metadata),
        "exposureNormalizationSummary": panorama_exposure_normalization_summary(metadata),
        "warningCodes": &metadata.warnings,
    })
}

fn load_panorama_source_metadata_for_plan(
    image_paths: &[String],
    app_handle: &AppHandle,
) -> Result<Vec<PanoramaSourceMetadata>, String> {
    let settings = load_settings_or_default(app_handle);

    image_paths
        .iter()
        .enumerate()
        .map(|(index, filename)| {
            let (width, height) = match image::image_dimensions(filename) {
                Ok(dimensions) => dimensions,
                Err(_) => {
                    let file_bytes = fs::read(filename)
                        .map_err(|e| format!("Failed to read image {}: {}", filename, e))?;
                    let dynamic_image = crate::image_loader::load_base_image_from_bytes(
                        &file_bytes,
                        filename,
                        false,
                        &settings,
                        None,
                    )
                    .map_err(|e| format!("Failed to load image {}: {}", filename, e))?;

                    dynamic_image.dimensions()
                }
            };

            Ok(PanoramaSourceMetadata {
                global_transform_3x3: None,
                height,
                index,
                path: filename.clone(),
                width,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn save_panorama(
    first_path_str: String,
    source_paths: Option<Vec<String>>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let pending_panorama = state
        .panorama_result
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| {
            "No panorama image found in memory to save. It might have already been saved."
                .to_string()
        })?;

    let (first_path, _) = parse_virtual_path(&first_path_str);
    let parent_dir = first_path
        .parent()
        .ok_or_else(|| "Could not determine parent directory of the first image.".to_string())?;
    let stem = first_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("panorama");

    let source_refs = if pending_panorama.source_refs.is_empty() {
        build_pending_panorama_source_refs(
            source_paths
                .as_deref()
                .unwrap_or_else(|| std::slice::from_ref(&first_path_str)),
        )
    } else {
        pending_panorama.source_refs.clone()
    };

    let (output_filename, image_to_save): (String, DynamicImage) =
        if pending_panorama.image.color().has_alpha() {
            (
                format!("{}_Pano.png", stem),
                DynamicImage::ImageRgba8(pending_panorama.image.to_rgba8()),
            )
        } else if pending_panorama.image.as_rgb32f().is_some() {
            (
                format!("{}_Pano.tiff", stem),
                pending_panorama.image.clone(),
            )
        } else {
            (
                format!("{}_Pano.png", stem),
                DynamicImage::ImageRgb8(pending_panorama.image.to_rgb8()),
            )
        };

    let output_path = next_available_panorama_output_path(parent_dir, &output_filename);

    let temp_output_path = temporary_panorama_output_path(&output_path);
    image_to_save
        .save(&temp_output_path)
        .map_err(|e| format!("Failed to save panorama image: {}", e))?;
    if let Err(e) = fs::rename(&temp_output_path, &output_path) {
        let _ = fs::remove_file(&temp_output_path);
        return Err(format!(
            "Failed to atomically publish panorama image {}: {}",
            output_path.display(),
            e
        ));
    }

    let (real_path, _) = crate::file_management::parse_virtual_path(&first_path_str);
    crate::exif_processing::write_rrexif_sidecar(&real_path.to_string_lossy(), &output_path)?;
    write_panorama_output_sidecar(&output_path, &pending_panorama.metadata, &source_refs)?;

    *state.panorama_result.lock().unwrap() = None;

    Ok(output_path.to_string_lossy().to_string())
}

fn render_with_legacy_homography_engine(
    request: PanoramaRenderRequest,
    app_handle: AppHandle,
) -> Result<PanoramaRenderResult, String> {
    let settings = load_settings_or_default(&app_handle);
    render_with_legacy_homography_engine_with_settings(request, app_handle, settings)
}

pub(crate) fn render_with_legacy_homography_engine_with_settings<R: Runtime>(
    request: PanoramaRenderRequest,
    app_handle: AppHandle<R>,
    settings: AppSettings,
) -> Result<PanoramaRenderResult, String> {
    let image_paths = request.image_paths;
    let options = request.options;
    if image_paths.len() < 2 {
        return Err("At least two images are required for a panorama.".to_string());
    }

    let _ = app_handle.emit(
        crate::events::PANORAMA_PROGRESS,
        "Starting panorama process...",
    );
    println!(
        "Starting panorama stitching process for {} images...",
        image_paths.len()
    );

    let start_time = Instant::now();
    let _ = app_handle.emit(
        crate::events::PANORAMA_PROGRESS,
        "Loading and preparing images...",
    );
    println!("Loading and preparing images (in parallel)...");
    let brief_pairs = processing::generate_brief_pairs();

    let image_data_results: Vec<Result<ImageInfo, String>> = image_paths
        .par_iter()
        .enumerate()
        .map(|(i, filename)| {
            let _ = app_handle.emit(
                crate::events::PANORAMA_PROGRESS,
                format!(
                    "Processing '{}'",
                    Path::new(filename)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                ),
            );
            println!("  - Processing '{}'", filename);

            let file_bytes = fs::read(filename)
                .map_err(|e| format!("Failed to read image {}: {}", filename, e))?;

            let mut dynamic_image = crate::image_loader::load_base_image_from_bytes(
                &file_bytes,
                filename,
                false,
                &settings,
                None,
            )
            .map_err(|e| format!("Failed to load image {}: {}", filename, e))?;

            if is_raw_file(filename) {
                apply_cpu_default_raw_processing(&mut dynamic_image);
            }

            let image_f32 = dynamic_image.to_rgb32f();

            let color_full_u8 = dynamic_image.to_rgb8();
            let gray_full = image::imageops::colorops::grayscale(&color_full_u8);

            let (w, h) = gray_full.dimensions();
            let (new_w, new_h, scale_factor) = processing::calculate_downscale_dimensions(w, h);

            let gray_small = image::imageops::resize(
                &gray_full,
                new_w,
                new_h,
                image::imageops::FilterType::Triangle,
            );

            let low_detail_mask = processing::generate_low_detail_mask(&gray_full);

            let features = processing::find_features(&gray_small, &brief_pairs);
            println!("    Found {} features in '{}'", features.len(), filename);

            Ok(ImageInfo {
                id: i,
                filename: filename.to_string(),
                image: image_f32,
                low_detail_mask,
                scale_factor,
                features,
            })
        })
        .collect();

    let mut image_data = Vec::new();
    for result in image_data_results {
        match result {
            Ok(info) => image_data.push(info),
            Err(e) => return Err(e),
        }
    }

    let mut source_metadata: Vec<PanoramaSourceMetadata> = image_data
        .iter()
        .map(|info| {
            let (width, height) = info.image.dimensions();
            PanoramaSourceMetadata {
                global_transform_3x3: None,
                height,
                index: info.id,
                path: info.filename.clone(),
                width,
            }
        })
        .collect();

    println!(
        "Image loading and feature detection completed in {:.2?}\n",
        start_time.elapsed()
    );

    let start_time = Instant::now();
    let _ = app_handle.emit(crate::events::PANORAMA_PROGRESS, "Finding image matches...");
    println!("Finding all pairwise matches (in parallel)...");
    let mut pairwise_matches: HashMap<(usize, usize), MatchInfo> = HashMap::new();

    let pairs_to_check: Vec<(usize, usize)> = (0..image_data.len())
        .flat_map(|i| (i + 1..image_data.len()).map(move |j| (i, j)))
        .collect();

    let match_results: Vec<Option<((usize, usize), MatchInfo)>> = pairs_to_check
        .par_iter()
        .map(|&(i, j)| {
            let features1 = &image_data[i].features;
            let features2 = &image_data[j].features;

            let feature_match_result =
                processing::match_features_with_diagnostics(features1, features2);
            let initial_matches = feature_match_result.matches;
            if initial_matches.len() < processing::MIN_INLIERS_FOR_CONNECTION {
                return None;
            }

            let keypoints1: Vec<KeyPoint> = features1.iter().map(|f| f.keypoint).collect();
            let keypoints2: Vec<KeyPoint> = features2.iter().map(|f| f.keypoint).collect();

            if let Some((_h_small, inliers)) =
                processing::find_homography_ransac(&initial_matches, &keypoints1, &keypoints2)
                && inliers.len() >= processing::MIN_INLIERS_FOR_CONNECTION
            {
                println!(
                    "  - Good match found: '{}' <-> '{}' ({} inliers)",
                    Path::new(&image_data[i].filename)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    Path::new(&image_data[j].filename)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    inliers.len()
                );

                let inlier_points: Vec<(nalgebra::Point2<f64>, nalgebra::Point2<f64>)> = inliers
                    .iter()
                    .map(|m| {
                        let p1 = keypoints1[m.index1];
                        let p2 = keypoints2[m.index2];
                        (
                            nalgebra::Point2::new(p1.x as f64, p1.y as f64),
                            nalgebra::Point2::new(p2.x as f64, p2.y as f64),
                        )
                    })
                    .collect();

                if let Some(h_refined) = processing::compute_homography(&inlier_points) {
                    let transfer_error_metrics = processing::mean_transfer_error_metrics(
                        &h_refined,
                        &inliers,
                        &keypoints1,
                        &keypoints2,
                    );
                    let s1 = image_data[i].scale_factor;
                    let s2 = image_data[j].scale_factor;
                    let scale_mat_i_inv =
                        Matrix3::new(1.0 / s1, 0.0, 0.0, 0.0, 1.0 / s1, 0.0, 0.0, 0.0, 1.0);
                    let scale_mat_j = Matrix3::new(s2, 0.0, 0.0, 0.0, s2, 0.0, 0.0, 0.0, 1.0);
                    let h_full = scale_mat_j * h_refined * scale_mat_i_inv;

                    let match_info = MatchInfo {
                        brief_match_diagnostics: feature_match_result.diagnostics,
                        homography: h_full,
                        inliers: inliers.len(),
                        match_count: initial_matches.len(),
                        mean_reprojection_error_px: transfer_error_metrics.forward_error_px,
                        mean_reverse_reprojection_error_px: transfer_error_metrics.reverse_error_px,
                        mean_symmetric_transfer_error_px: transfer_error_metrics.symmetric_error_px,
                        p95_symmetric_transfer_error_px: transfer_error_metrics
                            .p95_symmetric_error_px,
                        spatial_support_cell_count: processing::inlier_spatial_support_cell_count(
                            &inliers,
                            &keypoints1,
                            &keypoints2,
                        ),
                    };
                    return Some(((i, j), match_info));
                }
            }
            None
        })
        .collect();

    for result in match_results.into_iter().flatten() {
        pairwise_matches.insert(result.0, result.1);
    }
    let pairwise_match_metadata = collect_pairwise_match_metadata(&pairwise_matches);
    println!(
        "Pairwise matching completed in {:.2?}\n",
        start_time.elapsed()
    );

    if pairwise_matches.is_empty() {
        return Err(
            "No suitable matches found between any pair of images. Cannot create a panorama."
                .to_string(),
        );
    }

    let start_time = Instant::now();
    let _ = app_handle.emit(
        crate::events::PANORAMA_PROGRESS,
        "Determining stitching order...",
    );
    println!("Determining stitching order...");
    let stitching_order = build_stitching_order(&image_data, &pairwise_matches);
    for source in &mut source_metadata {
        source.global_transform_3x3 = stitching_order
            .global_homographies
            .get(&source.index)
            .map(matrix_to_row_major_array);
    }

    if stitching_order.ordered_indices.len() < 2 {
        return Err("Could not find a connected sequence of at least two images.".to_string());
    }

    let ordered_filenames: Vec<_> = stitching_order
        .ordered_indices
        .iter()
        .map(|&i| {
            Path::new(&image_data[i].filename)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        })
        .collect();
    println!("Stitching order determined: {:?}", ordered_filenames);
    let _ = app_handle.emit(
        crate::events::PANORAMA_PROGRESS,
        format!("Stitching order: {}", ordered_filenames.join(" -> ")),
    );

    let stitched_images_info: Vec<&ImageInfo> = stitching_order
        .ordered_indices
        .iter()
        .map(|&i| &image_data[i])
        .collect();
    let unstitched_count = image_data.len() - stitched_images_info.len();
    let mut warnings = Vec::new();
    if unstitched_count > 0 {
        let warning_msg = format!(
            "Warning: {} image(s) could not be matched and will be excluded.",
            unstitched_count
        );
        println!("{}", warning_msg);
        let _ = app_handle.emit(crate::events::PANORAMA_WARNING, warning_msg);
        warnings.push(format!(
            "{} image(s) could not be matched and will be excluded.",
            unstitched_count
        ));
    }
    println!(
        "Global homography calculation completed in {:.2?}\n",
        start_time.elapsed()
    );

    let start_time = Instant::now();
    let _ = app_handle.emit(
        crate::events::PANORAMA_PROGRESS,
        "Warping and blending images...",
    );
    println!("Warping and blending full-resolution images with progressive optimal seams...");

    let stitch_result = stitching::progressive_seam_stitcher(
        &stitched_images_info,
        &stitching_order.global_homographies,
        app_handle.clone(),
    )?;
    let (panorama, crop) =
        apply_panorama_boundary_mode(stitch_result.image, &stitch_result.mask, &options)?;

    println!("Stitching completed in {:.2?}\n", start_time.elapsed());

    let _ = app_handle.emit(crate::events::PANORAMA_PROGRESS, "Finalizing panorama...");
    let (output_width, output_height) = panorama.dimensions();
    let connected_source_indices = stitching_order.ordered_indices.clone();
    let connected_source_set: HashSet<_> = connected_source_indices.iter().copied().collect();
    let excluded_source_indices: Vec<_> = image_data
        .iter()
        .map(|info| info.id)
        .filter(|index| !connected_source_set.contains(index))
        .collect();
    let estimated_peak_memory_bytes =
        estimate_legacy_panorama_peak_memory_bytes(&source_metadata, output_width, output_height);
    let metadata = PanoramaRenderMetadata {
        blend_diagnostics: stitch_result.blend_diagnostics,
        connected_source_indices,
        crop,
        effective_boundary_mode: PanoramaBoundaryModeOption::AutoCrop,
        effective_projection: PanoramaProjectionOption::Rectilinear,
        estimated_peak_memory_bytes,
        excluded_source_indices,
        output_height,
        output_width,
        pairwise_matches: pairwise_match_metadata,
        reference_source_index: stitching_order.reference_source_index,
        requested_boundary_mode: options.boundary_mode,
        requested_projection: options.projection,
        selected_match_edges: stitching_order.selected_match_edges,
        max_transform_chain_length: stitching_order.max_transform_chain_length,
        sources: source_metadata,
        warnings,
    };

    Ok(PanoramaRenderResult {
        image: DynamicImage::ImageRgb32F(panorama),
        metadata,
    })
}

fn collect_pairwise_match_metadata(
    pairwise_matches: &HashMap<(usize, usize), MatchInfo>,
) -> Vec<PanoramaPairwiseMatchMetadata> {
    let mut metadata: Vec<_> = pairwise_matches
        .iter()
        .map(
            |(&(source_index, target_index), match_info)| PanoramaPairwiseMatchMetadata {
                brief_match_diagnostics: match_info.brief_match_diagnostics.clone(),
                homography3x3: matrix_to_row_major_array(&match_info.homography),
                homography_condition_number: homography_condition_number(&match_info.homography),
                inlier_ratio: match_info.inlier_ratio(),
                inliers: match_info.inliers,
                match_count: match_info.match_count,
                mean_reprojection_error_px: match_info.mean_reprojection_error_px,
                mean_reverse_reprojection_error_px: match_info.mean_reverse_reprojection_error_px,
                mean_symmetric_transfer_error_px: match_info.mean_symmetric_transfer_error_px,
                p95_symmetric_transfer_error_px: match_info.p95_symmetric_transfer_error_px,
                source_index,
                spatial_support_cell_count: match_info.spatial_support_cell_count,
                target_index,
            },
        )
        .collect();

    metadata.sort_by_key(|match_info| (match_info.source_index, match_info.target_index));
    metadata
}

fn apply_panorama_boundary_mode(
    image: Rgb32FImage,
    mask: &GrayImage,
    options: &PanoramaStitchOptions,
) -> Result<(Rgb32FImage, PanoramaCropMetadata), String> {
    validate_panorama_stitch_options(options)?;
    let pre_crop_width = image.width();
    let pre_crop_height = image.height();
    let Some((x, y, width, height)) = valid_pixel_bounds(mask) else {
        return Ok((
            image,
            PanoramaCropMetadata {
                height: pre_crop_height,
                mode: "auto".to_string(),
                pre_crop_height,
                pre_crop_width,
                width: pre_crop_width,
                x: 0,
                y: 0,
            },
        ));
    };

    if x == 0 && y == 0 && width == pre_crop_width && height == pre_crop_height {
        return Ok((
            image,
            PanoramaCropMetadata {
                height,
                mode: "auto".to_string(),
                pre_crop_height,
                pre_crop_width,
                width,
                x,
                y,
            },
        ));
    }

    let mut cropped = Rgb32FImage::new(width, height);
    for crop_y in 0..height {
        for crop_x in 0..width {
            let pixel = *image.get_pixel(x + crop_x, y + crop_y);
            cropped.put_pixel(crop_x, crop_y, pixel);
        }
    }

    Ok((
        cropped,
        PanoramaCropMetadata {
            height,
            mode: "auto".to_string(),
            pre_crop_height,
            pre_crop_width,
            width,
            x,
            y,
        },
    ))
}

fn valid_pixel_bounds(mask: &GrayImage) -> Option<(u32, u32, u32, u32)> {
    let mut min_x = u32::MAX;
    let mut min_y = u32::MAX;
    let mut max_x = 0_u32;
    let mut max_y = 0_u32;
    let mut found = false;

    for (x, y, pixel) in mask.enumerate_pixels() {
        if pixel[0] == 0 {
            continue;
        }
        found = true;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }

    found.then_some((min_x, min_y, max_x - min_x + 1, max_y - min_y + 1))
}

fn homography_condition_number(homography: &Matrix3<f64>) -> Option<f64> {
    if !homography.iter().all(|value| value.is_finite()) {
        return None;
    }
    let singular_values = homography.svd(false, false).singular_values;
    let max_singular = singular_values.max();
    let min_singular = singular_values.min();
    if max_singular.is_finite() && min_singular.is_finite() && min_singular > f64::EPSILON {
        Some(max_singular / min_singular)
    } else {
        None
    }
}

fn build_pending_panorama_source_refs(paths: &[String]) -> Vec<PendingPanoramaSourceRef> {
    paths
        .iter()
        .enumerate()
        .map(|(source_index, path)| {
            let (source_path, _) = parse_virtual_path(path);
            let image_path = source_path.to_string_lossy().into_owned();
            PendingPanoramaSourceRef {
                raw_defaults_applied: is_raw_file(&image_path),
                image_path,
                source_index,
                virtual_copy_id: extract_virtual_copy_id(path),
            }
        })
        .collect()
}

fn extract_virtual_copy_id(path: &str) -> Option<String> {
    let (_, copy_id) = path.rsplit_once("?vc=")?;
    if copy_id.trim().is_empty() {
        None
    } else {
        Some(copy_id.to_string())
    }
}

fn matrix_to_row_major_array(matrix: &Matrix3<f64>) -> [f64; 9] {
    [
        matrix[(0, 0)],
        matrix[(0, 1)],
        matrix[(0, 2)],
        matrix[(1, 0)],
        matrix[(1, 1)],
        matrix[(1, 2)],
        matrix[(2, 0)],
        matrix[(2, 1)],
        matrix[(2, 2)],
    ]
}

fn next_available_panorama_output_path(parent_dir: &Path, output_filename: &str) -> PathBuf {
    let candidate = parent_dir.join(output_filename);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(output_filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("panorama");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 2.. {
        let filename = match extension {
            Some(ext) => format!("{}_{}.{}", stem, index, ext),
            None => format!("{}_{}", stem, index),
        };
        let candidate = parent_dir.join(filename);
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("unbounded panorama output filename search should always return")
}

fn temporary_panorama_output_path(output_path: &Path) -> PathBuf {
    let stem = output_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let extension = output_path
        .extension()
        .unwrap_or_default()
        .to_string_lossy();
    if extension.is_empty() {
        return output_path.with_file_name(format!(".{}.{}.tmp", stem, Uuid::new_v4().simple()));
    }
    output_path.with_file_name(format!(
        ".{}.{}.{}",
        stem,
        Uuid::new_v4().simple(),
        extension
    ))
}

fn panorama_sidecar_path(output_path: &Path) -> PathBuf {
    output_path.with_file_name(format!(
        "{}.rrdata",
        output_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ))
}

fn write_panorama_output_sidecar(
    output_path: &Path,
    metadata: &PanoramaRenderMetadata,
    source_refs: &[PendingPanoramaSourceRef],
) -> Result<(), String> {
    let sidecar_path = panorama_sidecar_path(output_path);
    let mut sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
    upsert_panorama_artifact_metadata(&mut sidecar, output_path, metadata, source_refs)?;
    let json = serde_json::to_string_pretty(&sidecar)
        .map_err(|e| format!("Failed to serialize panorama sidecar: {}", e))?;
    fs::write(&sidecar_path, json).map_err(|e| {
        format!(
            "Failed to write panorama sidecar {}: {}",
            sidecar_path.display(),
            e
        )
    })
}

fn upsert_panorama_artifact_metadata(
    sidecar: &mut ImageMetadata,
    output_path: &Path,
    metadata: &PanoramaRenderMetadata,
    source_refs: &[PendingPanoramaSourceRef],
) -> Result<(), String> {
    let artifact_id = format!("artifact_panorama_{}", Uuid::new_v4().simple());
    let output_artifact_id = format!("{}_output", artifact_id);
    let preview_artifact_id = format!("{}_preview", artifact_id);
    let crop = json!({
        "height": metadata.crop.height,
        "mode": metadata.crop.mode,
        "preCropHeight": metadata.crop.pre_crop_height,
        "preCropWidth": metadata.crop.pre_crop_width,
        "width": metadata.crop.width,
        "x": metadata.crop.x,
        "y": metadata.crop.y,
    });
    let warnings = panorama_warning_codes(metadata);
    let excluded_sources: Vec<_> = metadata
        .excluded_source_indices
        .iter()
        .map(|source_index| {
            json!({
                "reason": "source_excluded",
                "sourceIndex": source_index,
            })
        })
        .collect();
    let output_hash = hash_file_for_artifact(output_path)?;
    let source_state = source_refs
        .iter()
        .map(|source| {
            let content_hash = hash_panorama_source_ref(source)?;
            Ok(json!({
                "contentHash": content_hash,
                "graphRevision": panorama_source_graph_revision(source),
                "sourceIndex": source.source_index,
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let exposure_normalization = panorama_exposure_normalization_metadata(metadata);
    let exposure_normalization_applied = !metadata
        .blend_diagnostics
        .overlap_gain_applications
        .is_empty();
    let settings_hash = stable_hash(&json!({
        "boundaryMode": metadata.effective_boundary_mode.as_str(),
        "crop": crop,
        "exposureNormalizationApplied": exposure_normalization_applied,
        "projection": metadata.effective_projection.as_str(),
        "seamPolicy": "adaptive_dp_feather_v1",
    }));
    let provenance_sources = source_refs
        .iter()
        .zip(source_state.iter())
        .map(|(source, state)| DerivedOutputProvenanceSource {
            content_hash: state["contentHash"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            graph_revision: state["graphRevision"]
                .as_str()
                .unwrap_or("panorama_runtime_v1"),
            path: &source.image_path,
        })
        .collect::<Vec<_>>();
    let warning_refs = warnings.iter().map(String::as_str).collect::<Vec<_>>();
    let derived_output_provenance =
        build_derived_output_provenance_sidecar(DerivedOutputProvenanceInput {
            accepted_apply_id: Some("command_panorama_create"),
            accepted_dry_run_id: Some("panorama_runtime_plan"),
            family: "panorama",
            output_artifact_id: &output_artifact_id,
            output_content_hash: &output_hash,
            output_path,
            settings_hash,
            sources: provenance_sources,
            warnings: warning_refs,
        });

    let artifact = json!({
        "alignment": {
            "algorithmId": "rapidraw_fast9_brief_ransac_v1",
            "downscaleMaxDimensionPx": processing::MAX_PROCESSING_DIMENSION,
            "globalHomographyCount": metadata.connected_source_indices.len().saturating_sub(1),
            "minimumInliersForConnection": processing::MIN_INLIERS_FOR_CONNECTION,
            "maxTransformChainLength": metadata.max_transform_chain_length,
            "pairwiseMatches": metadata.pairwise_matches.iter().map(|pair| json!({
                "fromSourceIndex": pair.source_index,
                "homography3x3": pair.homography3x3,
                "homographyConditionNumber": pair.homography_condition_number,
                "inlierRatio": pair.inlier_ratio,
                "inliers": pair.inliers,
                "briefMatcher": pair.brief_match_diagnostics,
                "matchCount": pair.match_count,
                "matchQuality": "accepted",
                "meanReprojectionErrorPx": pair.mean_reprojection_error_px,
                "meanReverseReprojectionErrorPx": pair.mean_reverse_reprojection_error_px,
                "meanSymmetricTransferErrorPx": pair.mean_symmetric_transfer_error_px,
                "p95SymmetricTransferErrorPx": pair.p95_symmetric_transfer_error_px,
                "spatialSupportCellCount": pair.spatial_support_cell_count,
                "toSourceIndex": pair.target_index,
            })).collect::<Vec<_>>(),
            "referenceSourceIndex": metadata.reference_source_index,
            "selectedMatchEdges": metadata.selected_match_edges.iter().map(|edge| json!({
                "edgeRank": edge.edge_rank,
                "childSourceIndex": edge.child_source_index,
                "fromSourceIndex": edge.source_index,
                "parentSourceIndex": edge.parent_source_index,
                "treeDepth": edge.tree_depth,
                "toSourceIndex": edge.target_index,
            })).collect::<Vec<_>>(),
            "ransacSeed": 12345,
            "ransacInlierThresholdPx": processing::RANSAC_INLIER_THRESHOLD,
            "ransacIterations": processing::RANSAC_ITERATIONS,
        },
        "artifactId": artifact_id,
        "boundaryMode": metadata.effective_boundary_mode.as_str(),
        "boundarySettings": {
            "crop": crop,
            "effectiveMode": metadata.effective_boundary_mode.as_str(),
            "requestedMode": metadata.requested_boundary_mode.as_str(),
            "support": "implemented_current_engine",
        },
        "createdAt": Utc::now().to_rfc3339(),
        "crop": crop,
        "excludedSources": excluded_sources,
        "engine": {
            "capabilities": {
                "adaptiveSeamFeather": true,
                "autoCrop": true,
                "bundleAdjustment": false,
                "cylindricalProjection": false,
                "exposureNormalization": exposure_normalization_applied,
                "planarHomography": true,
                "tiledRender": false,
            },
            "engineId": "rapidraw_homography_seam_v0",
            "qualityTier": "legacy_local_preview",
        },
        "exposureNormalization": exposure_normalization,
        "lensCorrectionPolicy": "required_before_stitch",
        "operationId": "merge.panorama.create",
        "operationVersion": 1,
        "outputArtifacts": [{
            "artifactId": output_artifact_id,
            "contentHash": output_hash,
            "dimensions": {
                "height": metadata.output_height,
                "width": metadata.output_width,
            },
            "kind": "merge_output",
            "storage": "sidecar_artifact",
        }],
        "outputColorSpace": "linear_rec2020_d65_v1",
        "previewArtifacts": [{
            "artifactId": preview_artifact_id,
            "dimensions": {
                "height": metadata.output_height.min(DEFAULT_PANORAMA_MAX_PREVIEW_DIMENSION_PX),
                "width": metadata.output_width.min(DEFAULT_PANORAMA_MAX_PREVIEW_DIMENSION_PX),
            },
            "kind": "preview",
            "storage": "temp_cache",
        }],
        "projection": metadata.effective_projection.as_str(),
        "projectionSettings": {
            "effectiveProjection": metadata.effective_projection.as_str(),
            "requestedProjection": metadata.requested_projection.as_str(),
            "support": "implemented_current_engine",
        },
        "provenance": {
            "commandId": "command_panorama_create",
            "runtimeStatus": "rendered",
        },
        "schemaVersion": 1,
        "seamPolicy": {
            "featherWidthPx": 100,
            "lowDetailFeatherMultiplier": 5,
            "mode": "adaptive_dp_feather_v1",
        },
        "seamReview": panorama_seam_review_metadata(metadata),
        "sourceImageRefs": source_refs.iter().map(|source| json!({
            "imagePath": source.image_path.clone(),
            "lensCorrectionState": "required_before_stitch",
            "rawDefaultsApplied": source.raw_defaults_applied,
            "sourceIndex": source.source_index,
            "virtualCopyId": source.virtual_copy_id.clone(),
        })).collect::<Vec<_>>(),
        "sourceState": source_state,
        "sourceContribution": panorama_source_contribution_metadata(metadata),
        "staleState": {
            "checkedAt": Utc::now().to_rfc3339(),
            "invalidationReasons": [],
            "state": "current",
        },
        "validationMetrics": {
            "estimatedPeakMemoryBytes": metadata.estimated_peak_memory_bytes,
            "excludedSourceCount": metadata.excluded_source_indices.len(),
            "outputHeight": metadata.output_height,
            "outputWidth": metadata.output_width,
            "sourceCount": source_refs.len(),
            "stitchedSourceCount": metadata.connected_source_indices.len(),
        },
        "warnings": warnings,
    });

    let artifacts = sidecar
        .raw_engine_artifacts
        .get_or_insert_with(RawEngineArtifacts::new_v1);
    artifacts.schema_version = 1;
    artifacts.panorama_artifacts.push(artifact);
    artifacts
        .derived_output_provenance_sidecars
        .push(derived_output_provenance);
    artifacts.stale_artifact_ids.retain(|id| !id.is_empty());
    Ok(())
}

fn panorama_seam_review_metadata(metadata: &PanoramaRenderMetadata) -> serde_json::Value {
    let seams = metadata
        .selected_match_edges
        .iter()
        .map(|edge| {
            let p95_error_px = metadata
                .pairwise_matches
                .iter()
                .find(|pair| {
                    pair.source_index == edge.source_index && pair.target_index == edge.target_index
                })
                .map(|pair| pair.p95_symmetric_transfer_error_px)
                .unwrap_or(0.0);
            let confidence = if p95_error_px <= 2.0 {
                "high"
            } else if p95_error_px <= 5.0 {
                "medium"
            } else {
                "low"
            };
            json!({
                "confidence": confidence,
                "featherWidthPx": 100,
                "fromSourceIndex": edge.source_index,
                "p95ErrorPx": p95_error_px,
                "toSourceIndex": edge.target_index,
            })
        })
        .collect::<Vec<_>>();

    json!({
        "policy": "adaptive_dp_feather_v1",
        "reviewStatus": if seams.is_empty() { "ready" } else { "requires_review" },
        "seamCount": seams.len(),
        "seams": seams,
    })
}

fn panorama_source_contribution_metadata(metadata: &PanoramaRenderMetadata) -> serde_json::Value {
    let stitched_count = metadata.connected_source_indices.len().max(1);
    let mut regions = metadata
        .connected_source_indices
        .iter()
        .map(|source_index| {
            json!({
                "coverageRatio": 1.0 / stitched_count as f64,
                "role": "stitched",
                "sourceIndex": source_index,
            })
        })
        .collect::<Vec<_>>();
    regions.extend(metadata.excluded_source_indices.iter().map(|source_index| {
        json!({
            "coverageRatio": 0.0,
            "role": "excluded",
            "sourceIndex": source_index,
        })
    }));

    json!({
        "excludedSourceCount": metadata.excluded_source_indices.len(),
        "regions": regions,
        "stitchedSourceCount": metadata.connected_source_indices.len(),
    })
}

fn panorama_exposure_normalization_summary(metadata: &PanoramaRenderMetadata) -> serde_json::Value {
    let applied_gain_count = metadata.blend_diagnostics.overlap_gain_applications.len();
    json!({
        "appliedGainCount": applied_gain_count,
        "mode": if applied_gain_count > 0 { "scalar_overlap_luminance_gain_v1" } else { "none" },
    })
}

fn panorama_exposure_normalization_metadata(
    metadata: &PanoramaRenderMetadata,
) -> serde_json::Value {
    let applied_gains: Vec<_> = metadata
        .blend_diagnostics
        .overlap_gain_applications
        .iter()
        .map(|application| {
            json!({
                "gain": application.gain,
                "sourceIndex": application.source_index,
            })
        })
        .collect();

    if applied_gains.is_empty() {
        return json!({
            "appliedGainCount": 0,
            "appliedLuminanceGains": [],
            "deferredReason": "Scalar overlap luminance gain was skipped because no overlap gain applications were produced.",
            "mode": "none",
            "skippedReason": "insufficient_overlap",
            "support": "schema_only_deferred",
        });
    }

    json!({
        "appliedGainCount": applied_gains.len(),
        "appliedLuminanceGains": applied_gains,
        "mode": "scalar_overlap_luminance_gain_v1",
        "support": "implemented_current_engine",
    })
}

fn panorama_warning_codes(metadata: &PanoramaRenderMetadata) -> Vec<String> {
    let mut warnings = Vec::new();
    if !metadata.excluded_source_indices.is_empty() {
        warnings.push("source_excluded".to_string());
    }
    if metadata.estimated_peak_memory_bytes >= DEFAULT_PANORAMA_MEMORY_BUDGET_BYTES {
        warnings.push("high_memory_estimate".to_string());
    }
    warnings
}

fn hash_file_for_artifact(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|e| format!("Failed to read panorama output for artifact hash: {}", e))?;
    Ok(format!("blake3:{}", blake3::hash(&bytes).to_hex()))
}

fn hash_panorama_source_ref(source: &PendingPanoramaSourceRef) -> Result<String, String> {
    let bytes = fs::read(&source.image_path).map_err(|e| {
        format!(
            "Failed to read panorama source {} for derived artifact hash: {}",
            source.image_path, e
        )
    })?;
    Ok(format!("blake3:{}", blake3::hash(&bytes).to_hex()))
}

fn panorama_source_graph_revision(source: &PendingPanoramaSourceRef) -> String {
    match source.virtual_copy_id.as_deref() {
        Some(virtual_copy_id) => format!(
            "panorama_source_{}_vc_{}_runtime_v1",
            source.source_index, virtual_copy_id
        ),
        None => format!("panorama_source_{}_runtime_v1", source.source_index),
    }
}

pub fn refresh_panorama_stale_artifacts(metadata: &mut ImageMetadata) -> bool {
    let Some(artifacts) = metadata.raw_engine_artifacts.as_mut() else {
        return false;
    };

    let stale_artifact_ids: Vec<String> = artifacts
        .panorama_artifacts
        .iter()
        .filter_map(|artifact| {
            let artifact_id = artifact.get("artifactId")?.as_str()?.to_string();
            let created_at = artifact
                .get("createdAt")
                .and_then(|value| value.as_str())
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.with_timezone(&Utc));

            let is_stale = match created_at {
                Some(created_at) => panorama_artifact_sources_are_stale(artifact, created_at),
                None => true,
            };

            is_stale.then_some(artifact_id)
        })
        .collect();

    if artifacts.stale_artifact_ids == stale_artifact_ids {
        return false;
    }

    artifacts.stale_artifact_ids = stale_artifact_ids;
    true
}

fn panorama_artifact_sources_are_stale(
    artifact: &serde_json::Value,
    created_at: DateTime<Utc>,
) -> bool {
    let Some(source_refs) = artifact
        .get("sourceImageRefs")
        .and_then(|value| value.as_array())
    else {
        return true;
    };

    source_refs.iter().any(|source| {
        let Some(image_path) = source.get("imagePath").and_then(|value| value.as_str()) else {
            return true;
        };
        let image_path = Path::new(image_path);
        if path_modified_after(image_path, created_at).unwrap_or(true) {
            return true;
        }

        let sidecar_path = source_sidecar_path_for_stale_check(
            image_path,
            source.get("virtualCopyId").and_then(|value| value.as_str()),
        );
        path_modified_after(&sidecar_path, created_at).unwrap_or(false)
    })
}

fn source_sidecar_path_for_stale_check(
    image_path: &Path,
    virtual_copy_id: Option<&str>,
) -> PathBuf {
    let sidecar_filename = match virtual_copy_id {
        Some(copy_id) if !copy_id.is_empty() => format!(
            "{}.{}.rrdata",
            image_path.file_name().unwrap_or_default().to_string_lossy(),
            copy_id
        ),
        _ => format!(
            "{}.rrdata",
            image_path.file_name().unwrap_or_default().to_string_lossy()
        ),
    };

    image_path.with_file_name(sidecar_filename)
}

fn path_modified_after(path: &Path, created_at: DateTime<Utc>) -> Option<bool> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let modified_at = DateTime::<Utc>::from(modified);
    Some(modified_at > created_at)
}

fn estimate_legacy_panorama_peak_memory_bytes(
    sources: &[PanoramaSourceMetadata],
    output_width: u32,
    output_height: u32,
) -> u64 {
    const RGB32F_BYTES_PER_PIXEL: u64 = 12;
    const MASK_BYTES_PER_PIXEL: u64 = 1;

    let source_decode_bytes: u64 = sources
        .iter()
        .map(|source| source.width as u64 * source.height as u64 * RGB32F_BYTES_PER_PIXEL)
        .sum();
    let source_mask_bytes: u64 = sources
        .iter()
        .map(|source| source.width as u64 * source.height as u64 * MASK_BYTES_PER_PIXEL)
        .sum();
    let output_pixels = output_width as u64 * output_height as u64;
    let output_canvas_bytes = output_pixels * RGB32F_BYTES_PER_PIXEL;
    let output_mask_bytes = output_pixels * MASK_BYTES_PER_PIXEL;
    let seam_workspace_bytes = output_pixels * 4;
    let overhead_bytes = (source_decode_bytes + output_canvas_bytes) / 10;

    source_decode_bytes
        + source_mask_bytes
        + output_canvas_bytes
        + output_mask_bytes
        + seam_workspace_bytes
        + overhead_bytes
}

fn estimate_panorama_plan_from_sources(
    sources: Vec<PanoramaSourceMetadata>,
    memory_budget_bytes: u64,
    max_preview_dimension_px: u32,
) -> PanoramaPlanResult {
    let output_width = sources
        .iter()
        .fold(0_u32, |total, source| total.saturating_add(source.width));
    let output_height = sources
        .iter()
        .map(|source| source.height)
        .max()
        .unwrap_or(1);
    let source_pixel_count = sources
        .iter()
        .map(|source| source.width as u64 * source.height as u64)
        .sum();
    let output_pixel_count = output_width as u64 * output_height as u64;
    let memory_components = estimate_panorama_memory_components(
        &sources,
        output_width,
        output_height,
        max_preview_dimension_px,
    );
    let memory_budget_ratio =
        memory_components.total_estimated_peak_bytes as f64 / memory_budget_bytes as f64;

    let mut warning_codes = vec![
        "geometry_estimate_low_confidence".to_string(),
        "legacy_full_frame_render".to_string(),
    ];
    let mut warnings = vec![
        "Panorama dry-run uses conservative source-dimension bounds before feature matching."
            .to_string(),
        "Current panorama render path uses the legacy full-frame homography engine.".to_string(),
    ];
    let mut blocked_reasons = Vec::new();

    let (status, execution_mode) = if memory_components.total_estimated_peak_bytes
        > memory_budget_bytes
    {
        warning_codes.push("memory_budget_exceeded".to_string());
        warning_codes.push("tiled_render_required".to_string());
        blocked_reasons.push(format!(
            "Estimated peak memory {} bytes exceeds budget {} bytes.",
            memory_components.total_estimated_peak_bytes, memory_budget_bytes
        ));
        warnings.push(
            "Estimated memory exceeds the supplied budget; render must stay plan-only.".to_string(),
        );
        ("blocked_plan_only".to_string(), "plan_only".to_string())
    } else if memory_budget_ratio >= HIGH_MEMORY_BUDGET_RATIO {
        warning_codes.push("high_memory_estimate".to_string());
        warnings.push(
            "Estimated memory is close to the supplied budget; render should require confirmation."
                .to_string(),
        );
        ("warning".to_string(), "full_frame_legacy".to_string())
    } else {
        ("accepted".to_string(), "full_frame_legacy".to_string())
    };

    PanoramaPlanResult {
        dry_run: true,
        family: "panorama".to_string(),
        mutates: false,
        output_dimensions: PanoramaPlanDimensions {
            height: output_height,
            width: output_width,
        },
        preflight: PanoramaPreflightEstimate {
            blocked_reasons,
            engine_capabilities: PanoramaPlanEngineCapabilities {
                full_frame_legacy: true,
                max_preview_dimension_px,
                plan_only: true,
                tile_backed_render: false,
            },
            execution_mode,
            geometry_estimate: PanoramaGeometryEstimate {
                output_pixel_count,
                projected_bounds: PanoramaProjectedBounds {
                    height: output_height,
                    width: output_width,
                    x: 0,
                    y: 0,
                },
                source_count: sources.len(),
                source_pixel_count,
            },
            memory_budget_bytes,
            memory_budget_ratio,
            memory_components,
            status,
            tile_count: 1,
            warning_codes,
        },
        source_image_refs: sources
            .iter()
            .map(|source| PanoramaPlanSourceRef {
                height: source.height,
                image_path: source.path.clone(),
                raw_defaults_applied: is_raw_file(&source.path),
                role: "panorama_tile".to_string(),
                source_index: source.index,
                width: source.width,
            })
            .collect(),
        warnings,
    }
}

fn estimate_panorama_memory_components(
    sources: &[PanoramaSourceMetadata],
    output_width: u32,
    output_height: u32,
    max_preview_dimension_px: u32,
) -> PanoramaMemoryComponents {
    const RGB32F_BYTES_PER_PIXEL: u64 = 12;
    const MASK_BYTES_PER_PIXEL: u64 = 1;
    const RGB8_BYTES_PER_PIXEL: u64 = 3;

    let source_decode_bytes: u64 = sources
        .iter()
        .map(|source| source.width as u64 * source.height as u64 * RGB32F_BYTES_PER_PIXEL)
        .sum();
    let low_detail_mask_bytes: u64 = sources
        .iter()
        .map(|source| source.width as u64 * source.height as u64 * MASK_BYTES_PER_PIXEL)
        .sum();
    let output_pixels = output_width as u64 * output_height as u64;
    let output_canvas_bytes = output_pixels * RGB32F_BYTES_PER_PIXEL;
    let output_mask_bytes = output_pixels * MASK_BYTES_PER_PIXEL;
    let seam_workspace_bytes = output_pixels * 4;
    let preview_pixels =
        estimate_preview_pixel_count(output_width, output_height, max_preview_dimension_px);
    let preview_bytes = preview_pixels * RGB8_BYTES_PER_PIXEL;
    let overhead_bytes = (source_decode_bytes + output_canvas_bytes) / 10;
    let total_estimated_peak_bytes = source_decode_bytes
        + low_detail_mask_bytes
        + output_canvas_bytes
        + output_mask_bytes
        + overhead_bytes
        + preview_bytes
        + seam_workspace_bytes;

    PanoramaMemoryComponents {
        low_detail_mask_bytes,
        output_canvas_bytes,
        output_mask_bytes,
        overhead_bytes,
        preview_bytes,
        seam_workspace_bytes,
        source_decode_bytes,
        total_estimated_peak_bytes,
    }
}

fn estimate_preview_pixel_count(
    output_width: u32,
    output_height: u32,
    max_preview_dimension_px: u32,
) -> u64 {
    let largest_dimension = output_width.max(output_height);
    if largest_dimension <= max_preview_dimension_px {
        return output_width as u64 * output_height as u64;
    }

    let scale = max_preview_dimension_px as f64 / largest_dimension as f64;
    let preview_width = (output_width as f64 * scale).round().max(1.0) as u64;
    let preview_height = (output_height as f64 * scale).round().max(1.0) as u64;
    preview_width * preview_height
}

struct Dsu {
    parent: Vec<usize>,
}

impl Dsu {
    fn new(n: usize) -> Self {
        Dsu {
            parent: (0..n).collect(),
        }
    }

    fn find(&mut self, i: usize) -> usize {
        if self.parent[i] == i {
            i
        } else {
            self.parent[i] = self.find(self.parent[i]);
            self.parent[i]
        }
    }

    fn union(&mut self, i: usize, j: usize) {
        let root_i = self.find(i);
        let root_j = self.find(j);
        if root_i != root_j {
            self.parent[root_i] = root_j;
        }
    }
}

struct StitchingOrder {
    global_homographies: HashMap<usize, Matrix3<f64>>,
    max_transform_chain_length: usize,
    ordered_indices: Vec<usize>,
    reference_source_index: Option<usize>,
    selected_match_edges: Vec<PanoramaSelectedMatchEdgeMetadata>,
}

#[derive(Clone, Copy)]
struct RankedGraphEdge {
    cost: f64,
    rank: usize,
    source_index: usize,
    target_index: usize,
}

#[derive(Clone, Copy)]
struct TreeEdge {
    cost: f64,
    neighbor: usize,
    rank: usize,
    source_index: usize,
    target_index: usize,
}

fn build_stitching_order(
    images: &[ImageInfo],
    matches: &HashMap<(usize, usize), MatchInfo>,
) -> StitchingOrder {
    if images.is_empty() {
        return StitchingOrder {
            global_homographies: HashMap::new(),
            max_transform_chain_length: 0,
            ordered_indices: vec![],
            reference_source_index: None,
            selected_match_edges: vec![],
        };
    }
    let n = images.len();
    if n < 2 {
        let mut homographies = HashMap::new();
        if n == 1 {
            homographies.insert(0, Matrix3::identity());
        }
        return StitchingOrder {
            global_homographies: homographies,
            max_transform_chain_length: 0,
            ordered_indices: (0..n).collect(),
            reference_source_index: Some(0),
            selected_match_edges: vec![],
        };
    }

    let mut edges = Vec::new();
    for (&(i, j), m) in matches {
        if m.is_graph_eligible() {
            edges.push((i, j, m));
        }
    }
    edges.sort_by(compare_graph_edges);
    let ranked_edges: Vec<_> = edges
        .into_iter()
        .enumerate()
        .map(
            |(index, (source_index, target_index, match_info))| RankedGraphEdge {
                cost: graph_edge_cost(match_info),
                rank: index + 1,
                source_index,
                target_index,
            },
        )
        .collect();

    let mut mst_adj: HashMap<usize, Vec<TreeEdge>> = HashMap::new();
    let mut dsu = Dsu::new(n);
    let mut num_edges = 0;

    for edge in &ranked_edges {
        if dsu.find(edge.source_index) != dsu.find(edge.target_index) {
            dsu.union(edge.source_index, edge.target_index);
            mst_adj
                .entry(edge.source_index)
                .or_default()
                .push(TreeEdge {
                    cost: edge.cost,
                    neighbor: edge.target_index,
                    rank: edge.rank,
                    source_index: edge.source_index,
                    target_index: edge.target_index,
                });
            mst_adj
                .entry(edge.target_index)
                .or_default()
                .push(TreeEdge {
                    cost: edge.cost,
                    neighbor: edge.source_index,
                    rank: edge.rank,
                    source_index: edge.source_index,
                    target_index: edge.target_index,
                });
            num_edges += 1;
            if num_edges == n - 1 {
                break;
            }
        }
    }

    let Some(start_node) = choose_central_reference_source(&mst_adj) else {
        return StitchingOrder {
            global_homographies: HashMap::new(),
            max_transform_chain_length: 0,
            ordered_indices: vec![],
            reference_source_index: None,
            selected_match_edges: vec![],
        };
    };

    let mut ordered_indices = Vec::new();
    let mut global_homographies = HashMap::new();
    let mut selected_match_edges = Vec::new();
    let mut max_transform_chain_length = 0;
    let mut q = VecDeque::new();
    let mut visited = HashSet::new();

    q.push_back((start_node, Matrix3::identity(), 0_usize));
    visited.insert(start_node);

    while let Some((u, h_u_global, depth)) = q.pop_front() {
        ordered_indices.push(u);
        global_homographies.insert(u, h_u_global);
        max_transform_chain_length = max_transform_chain_length.max(depth);

        if let Some(neighbors) = mst_adj.get(&u) {
            let mut sorted_neighbors = neighbors.clone();
            sorted_neighbors.sort_by_key(|edge| (edge.rank, edge.neighbor));
            for edge in sorted_neighbors {
                let v = edge.neighbor;
                if !visited.contains(&v) {
                    visited.insert(v);

                    let h_vu = if let Some(m) = matches.get(&(v, u)) {
                        m.homography
                    } else if let Some(m) = matches.get(&(u, v)) {
                        m.homography
                            .try_inverse()
                            .expect("Failed to invert homography for MST edge")
                    } else {
                        panic!("Match not found for MST edge between {} and {}", u, v);
                    };

                    let h_v_global = h_u_global * h_vu;
                    selected_match_edges.push(PanoramaSelectedMatchEdgeMetadata {
                        child_source_index: v,
                        edge_rank: edge.rank,
                        parent_source_index: u,
                        source_index: edge.source_index.min(edge.target_index),
                        target_index: edge.source_index.max(edge.target_index),
                        tree_depth: depth + 1,
                    });
                    q.push_back((v, h_v_global, depth + 1));
                }
            }
        }
    }

    selected_match_edges.sort_by_key(|edge| edge.edge_rank);
    StitchingOrder {
        global_homographies,
        max_transform_chain_length,
        ordered_indices,
        reference_source_index: Some(start_node),
        selected_match_edges,
    }
}

fn compare_graph_edges(
    left: &(usize, usize, &MatchInfo),
    right: &(usize, usize, &MatchInfo),
) -> std::cmp::Ordering {
    let left_match = left.2;
    let right_match = right.2;
    right_match
        .spatial_support_cell_count
        .cmp(&left_match.spatial_support_cell_count)
        .then_with(|| {
            left_match
                .p95_symmetric_transfer_error_px
                .total_cmp(&right_match.p95_symmetric_transfer_error_px)
        })
        .then_with(|| {
            right_match
                .inlier_ratio()
                .total_cmp(&left_match.inlier_ratio())
        })
        .then_with(|| right_match.inliers.cmp(&left_match.inliers))
        .then_with(|| left.0.cmp(&right.0))
        .then_with(|| left.1.cmp(&right.1))
}

fn graph_edge_cost(match_info: &MatchInfo) -> f64 {
    let ratio_penalty = (1.0 - match_info.inlier_ratio()).max(0.0) * 2.0;
    match_info.p95_symmetric_transfer_error_px + ratio_penalty
}

fn choose_central_reference_source(mst_adj: &HashMap<usize, Vec<TreeEdge>>) -> Option<usize> {
    let component = largest_tree_component(mst_adj)?;
    component.into_iter().min_by(|left, right| {
        let left_score = tree_reference_score(*left, mst_adj);
        let right_score = tree_reference_score(*right, mst_adj);
        left_score
            .0
            .total_cmp(&right_score.0)
            .then_with(|| left_score.1.total_cmp(&right_score.1))
            .then_with(|| left_score.2.cmp(&right_score.2))
            .then_with(|| left.cmp(right))
    })
}

fn largest_tree_component(mst_adj: &HashMap<usize, Vec<TreeEdge>>) -> Option<Vec<usize>> {
    let mut visited = HashSet::new();
    let mut best_component = Vec::new();
    let mut nodes: Vec<_> = mst_adj.keys().copied().collect();
    nodes.sort_unstable();
    for node in nodes {
        if visited.contains(&node) {
            continue;
        }
        let mut component = Vec::new();
        let mut q = VecDeque::from([node]);
        visited.insert(node);
        while let Some(current) = q.pop_front() {
            component.push(current);
            if let Some(edges) = mst_adj.get(&current) {
                for edge in edges {
                    if visited.insert(edge.neighbor) {
                        q.push_back(edge.neighbor);
                    }
                }
            }
        }
        component.sort_unstable();
        if component.len() > best_component.len()
            || (component.len() == best_component.len() && component < best_component)
        {
            best_component = component;
        }
    }
    (!best_component.is_empty()).then_some(best_component)
}

fn tree_reference_score(
    source_index: usize,
    mst_adj: &HashMap<usize, Vec<TreeEdge>>,
) -> (f64, f64, usize) {
    let mut max_path_cost = 0.0_f64;
    let mut total_path_cost = 0.0_f64;
    let mut max_depth = 0_usize;
    let mut visited = HashSet::from([source_index]);
    let mut q = VecDeque::from([(source_index, 0.0_f64, 0_usize)]);

    while let Some((node, path_cost, depth)) = q.pop_front() {
        max_path_cost = max_path_cost.max(path_cost);
        total_path_cost += path_cost;
        max_depth = max_depth.max(depth);
        if let Some(edges) = mst_adj.get(&node) {
            for edge in edges {
                if visited.insert(edge.neighbor) {
                    q.push_back((edge.neighbor, path_cost + edge.cost, depth + 1));
                }
            }
        }
    }

    (max_path_cost, total_path_cost, max_depth)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Luma, Rgb};

    #[test]
    fn collect_pairwise_match_metadata_sorts_by_source_pair() {
        let mut matches = HashMap::new();
        matches.insert(
            (2, 3),
            MatchInfo {
                brief_match_diagnostics: brief_match_diagnostics_fixture(),
                homography: Matrix3::identity(),
                inliers: 21,
                match_count: 30,
                mean_reprojection_error_px: 2.1,
                mean_reverse_reprojection_error_px: 2.2,
                mean_symmetric_transfer_error_px: 2.15,
                p95_symmetric_transfer_error_px: 2.4,
                spatial_support_cell_count: 6,
            },
        );
        matches.insert(
            (0, 1),
            MatchInfo {
                brief_match_diagnostics: brief_match_diagnostics_fixture(),
                homography: Matrix3::identity(),
                inliers: 42,
                match_count: 60,
                mean_reprojection_error_px: 1.4,
                mean_reverse_reprojection_error_px: 1.6,
                mean_symmetric_transfer_error_px: 1.5,
                p95_symmetric_transfer_error_px: 1.8,
                spatial_support_cell_count: 8,
            },
        );

        let metadata = collect_pairwise_match_metadata(&matches);

        assert_eq!(
            metadata,
            vec![
                PanoramaPairwiseMatchMetadata {
                    brief_match_diagnostics: brief_match_diagnostics_fixture(),
                    homography3x3: matrix_to_row_major_array(&Matrix3::identity()),
                    homography_condition_number: Some(1.0),
                    inlier_ratio: 0.7,
                    inliers: 42,
                    match_count: 60,
                    mean_reprojection_error_px: 1.4,
                    mean_reverse_reprojection_error_px: 1.6,
                    mean_symmetric_transfer_error_px: 1.5,
                    p95_symmetric_transfer_error_px: 1.8,
                    source_index: 0,
                    spatial_support_cell_count: 8,
                    target_index: 1,
                },
                PanoramaPairwiseMatchMetadata {
                    brief_match_diagnostics: brief_match_diagnostics_fixture(),
                    homography3x3: matrix_to_row_major_array(&Matrix3::identity()),
                    homography_condition_number: Some(1.0),
                    inlier_ratio: 0.7,
                    inliers: 21,
                    match_count: 30,
                    mean_reprojection_error_px: 2.1,
                    mean_reverse_reprojection_error_px: 2.2,
                    mean_symmetric_transfer_error_px: 2.15,
                    p95_symmetric_transfer_error_px: 2.4,
                    source_index: 2,
                    spatial_support_cell_count: 6,
                    target_index: 3,
                },
            ]
        );
    }

    #[test]
    fn panorama_boundary_auto_crop_reduces_canvas_to_valid_pixels() {
        let mut image = Rgb32FImage::new(5, 4);
        let mut mask = GrayImage::new(5, 4);
        for y in 1..3 {
            for x in 2..5 {
                image.put_pixel(x, y, Rgb([x as f32, y as f32, 1.0]));
                mask.put_pixel(x, y, Luma([255]));
            }
        }

        let (cropped, crop) =
            apply_panorama_boundary_mode(image, &mask, &PanoramaStitchOptions::default())
                .expect("auto-crop should succeed");

        assert_eq!(cropped.dimensions(), (3, 2));
        assert_eq!(
            crop,
            PanoramaCropMetadata {
                height: 2,
                mode: "auto".to_string(),
                pre_crop_height: 4,
                pre_crop_width: 5,
                width: 3,
                x: 2,
                y: 1,
            }
        );
    }

    #[test]
    fn panorama_boundary_blocks_unsupported_projection_and_boundary_modes() {
        let unsupported_projection = PanoramaStitchOptions {
            projection: PanoramaProjectionOption::Cylindrical,
            ..PanoramaStitchOptions::default()
        };
        assert!(validate_panorama_stitch_options(&unsupported_projection).is_err());

        let unsupported_boundary = PanoramaStitchOptions {
            boundary_mode: PanoramaBoundaryModeOption::Transparent,
            ..PanoramaStitchOptions::default()
        };
        assert!(validate_panorama_stitch_options(&unsupported_boundary).is_err());
    }

    #[test]
    fn build_stitching_order_prefers_lower_p95_error_over_raw_inlier_count() {
        let images = sample_image_infos(3);
        let mut matches = HashMap::new();
        matches.insert((0, 1), graph_match_info(80, 100, 4.0, 8));
        matches.insert((0, 2), graph_match_info(35, 40, 0.8, 8));
        matches.insert((1, 2), graph_match_info(30, 40, 0.7, 8));

        let order = build_stitching_order(&images, &matches);

        assert_eq!(order.selected_match_edges.len(), 2);
        assert_eq!(
            order
                .selected_match_edges
                .iter()
                .map(|edge| (edge.edge_rank, edge.source_index, edge.target_index))
                .collect::<Vec<_>>(),
            vec![(1, 1, 2), (2, 0, 2)]
        );
    }

    #[test]
    fn build_stitching_order_prefers_spatial_support_before_p95_error() {
        let images = sample_image_infos(3);
        let mut matches = HashMap::new();
        matches.insert((0, 1), graph_match_info(35, 40, 2.0, 8));
        matches.insert((1, 2), graph_match_info(35, 40, 2.1, 8));
        matches.insert((0, 2), graph_match_info(200, 220, 0.4, 1));

        let order = build_stitching_order(&images, &matches);

        assert_eq!(
            order
                .selected_match_edges
                .iter()
                .map(|edge| (edge.edge_rank, edge.source_index, edge.target_index))
                .collect::<Vec<_>>(),
            vec![(1, 0, 1), (2, 1, 2)]
        );
    }

    #[test]
    fn build_stitching_order_chooses_central_reference_source() {
        let images = sample_image_infos(5);
        let mut matches = HashMap::new();
        matches.insert((0, 1), graph_match_info(40, 50, 1.0, 8));
        matches.insert((1, 2), graph_match_info(40, 50, 1.0, 8));
        matches.insert((2, 3), graph_match_info(40, 50, 1.0, 8));
        matches.insert((3, 4), graph_match_info(40, 50, 1.0, 8));

        let order = build_stitching_order(&images, &matches);

        assert_eq!(order.reference_source_index, Some(2));
        assert_eq!(order.ordered_indices[0], 2);
        assert_eq!(order.max_transform_chain_length, 2);
        assert_eq!(
            order
                .selected_match_edges
                .iter()
                .map(|edge| (edge.source_index, edge.target_index, edge.tree_depth))
                .collect::<Vec<_>>(),
            vec![(0, 1, 2), (1, 2, 1), (2, 3, 1), (3, 4, 2)]
        );
    }

    #[test]
    fn build_pending_panorama_source_refs_preserves_virtual_copy_identity() {
        let refs = build_pending_panorama_source_refs(&[
            "/photos/IMG_0001.CR3?vc=abc123".to_string(),
            "/photos/IMG_0002.jpg".to_string(),
        ]);

        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].image_path, "/photos/IMG_0001.CR3");
        assert_eq!(refs[0].virtual_copy_id.as_deref(), Some("abc123"));
        assert!(refs[0].raw_defaults_applied);
        assert_eq!(refs[1].image_path, "/photos/IMG_0002.jpg");
        assert_eq!(refs[1].virtual_copy_id, None);
        assert!(!refs[1].raw_defaults_applied);
    }

    #[test]
    fn next_available_panorama_output_path_avoids_overwriting_existing_outputs() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let first_path = temp_dir.path().join("IMG_0001_Pano.tiff");
        let second_path = temp_dir.path().join("IMG_0001_Pano_2.tiff");
        fs::write(&first_path, b"first").expect("first output should be written");
        fs::write(&second_path, b"second").expect("second output should be written");

        let next_path = next_available_panorama_output_path(temp_dir.path(), "IMG_0001_Pano.tiff");

        assert_eq!(next_path, temp_dir.path().join("IMG_0001_Pano_3.tiff"));
    }

    #[test]
    fn temporary_panorama_output_path_preserves_encoder_extension() {
        let output_path = Path::new("/tmp/IMG_0001_Pano.tiff");
        let temporary_path = temporary_panorama_output_path(output_path);

        assert_eq!(
            temporary_path
                .extension()
                .and_then(|extension| extension.to_str()),
            Some("tiff")
        );
        assert_ne!(temporary_path, output_path);
        assert!(
            temporary_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with(".IMG_0001_Pano.")
        );
    }

    #[test]
    fn write_panorama_output_sidecar_records_editable_artifact_provenance() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let output_path = temp_dir.path().join("IMG_0001_Pano.tiff");
        fs::write(&output_path, b"panorama-output").expect("output should be written");
        let metadata = sample_render_metadata();
        let source_refs = vec![
            PendingPanoramaSourceRef {
                image_path: temp_dir
                    .path()
                    .join("IMG_0001.CR3")
                    .to_string_lossy()
                    .into_owned(),
                raw_defaults_applied: true,
                source_index: 0,
                virtual_copy_id: Some("abc123".to_string()),
            },
            PendingPanoramaSourceRef {
                image_path: temp_dir
                    .path()
                    .join("IMG_0002.CR3")
                    .to_string_lossy()
                    .into_owned(),
                raw_defaults_applied: true,
                source_index: 1,
                virtual_copy_id: None,
            },
        ];
        for source in &source_refs {
            fs::write(
                &source.image_path,
                format!("source-{}", source.source_index),
            )
            .expect("source file should be written");
        }

        write_panorama_output_sidecar(&output_path, &metadata, &source_refs)
            .expect("sidecar should be written");

        let sidecar_path = output_path.with_file_name("IMG_0001_Pano.tiff.rrdata");
        let sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        let artifacts = sidecar
            .raw_engine_artifacts
            .expect("raw engine artifacts should be present");
        assert_eq!(artifacts.schema_version, 1);
        assert_eq!(artifacts.panorama_artifacts.len(), 1);

        let artifact = &artifacts.panorama_artifacts[0];
        assert_eq!(artifact["provenance"]["runtimeStatus"], "rendered");
        assert_eq!(artifact["outputArtifacts"][0]["kind"], "merge_output");
        assert_eq!(
            artifact["outputArtifacts"][0]["storage"],
            "sidecar_artifact"
        );
        assert_eq!(artifact["projection"], "rectilinear");
        assert_eq!(
            artifact["projectionSettings"]["requestedProjection"],
            "rectilinear"
        );
        assert_eq!(
            artifact["projectionSettings"]["effectiveProjection"],
            "rectilinear"
        );
        assert_eq!(artifact["boundaryMode"], "auto_crop");
        assert_eq!(artifact["boundarySettings"]["requestedMode"], "auto_crop");
        assert_eq!(artifact["boundarySettings"]["effectiveMode"], "auto_crop");
        assert_eq!(artifact["sourceImageRefs"][0]["virtualCopyId"], "abc123");
        assert_eq!(artifact["sourceImageRefs"][0]["sourceIndex"], 0);
        assert_eq!(artifact["sourceImageRefs"][1]["sourceIndex"], 1);
        assert_eq!(artifact["sourceState"].as_array().unwrap().len(), 2);
        assert!(
            artifact["sourceState"][0]["contentHash"]
                .as_str()
                .unwrap()
                .starts_with("blake3:")
        );
        assert_eq!(
            artifact["sourceState"][0]["graphRevision"],
            "panorama_source_0_vc_abc123_runtime_v1"
        );
        assert_eq!(
            artifacts.derived_output_provenance_sidecars[0]["sourceState"][0]["contentHash"],
            artifact["sourceState"][0]["contentHash"]
        );
        assert_eq!(artifact["validationMetrics"]["sourceCount"], 2);
        assert_eq!(artifact["validationMetrics"]["stitchedSourceCount"], 2);
        assert_eq!(
            artifact["alignment"]["pairwiseMatches"][0]["homography3x3"][2],
            12.0
        );
        assert_eq!(
            artifact["engine"]["capabilities"]["exposureNormalization"],
            true
        );
        assert_eq!(
            artifact["exposureNormalization"]["mode"],
            "scalar_overlap_luminance_gain_v1"
        );
        assert_eq!(artifact["exposureNormalization"]["appliedGainCount"], 1);
        assert_eq!(
            artifact["exposureNormalization"]["appliedLuminanceGains"][0]["sourceIndex"],
            1
        );
        assert_eq!(
            artifact["exposureNormalization"]["appliedLuminanceGains"][0]["gain"],
            1.125
        );
        assert_eq!(artifact["seamReview"]["seamCount"], 1);
        assert_eq!(artifact["seamReview"]["seams"][0]["confidence"], "high");
        assert_eq!(artifact["sourceContribution"]["stitchedSourceCount"], 2);
        assert_eq!(
            artifact["sourceContribution"]["regions"][0]["coverageRatio"],
            0.5
        );
    }

    #[test]
    fn write_panorama_output_sidecar_records_skipped_exposure_gain() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let output_path = temp_dir.path().join("IMG_0001_Pano.tiff");
        fs::write(&output_path, b"panorama-output").expect("output should be written");
        let mut metadata = sample_render_metadata();
        metadata.blend_diagnostics.overlap_gain_applications.clear();
        let source_refs = vec![
            PendingPanoramaSourceRef {
                image_path: temp_dir
                    .path()
                    .join("IMG_0001.CR3")
                    .to_string_lossy()
                    .into_owned(),
                raw_defaults_applied: true,
                source_index: 0,
                virtual_copy_id: None,
            },
            PendingPanoramaSourceRef {
                image_path: temp_dir
                    .path()
                    .join("IMG_0002.CR3")
                    .to_string_lossy()
                    .into_owned(),
                raw_defaults_applied: true,
                source_index: 1,
                virtual_copy_id: None,
            },
        ];
        for source in &source_refs {
            fs::write(
                &source.image_path,
                format!("source-{}", source.source_index),
            )
            .expect("source file should be written");
        }

        write_panorama_output_sidecar(&output_path, &metadata, &source_refs)
            .expect("sidecar should be written");

        let sidecar_path = output_path.with_file_name("IMG_0001_Pano.tiff.rrdata");
        let sidecar = crate::exif_processing::load_sidecar(&sidecar_path);
        let artifacts = sidecar
            .raw_engine_artifacts
            .expect("raw engine artifacts should be present");
        let artifact = &artifacts.panorama_artifacts[0];

        assert_eq!(
            artifact["engine"]["capabilities"]["exposureNormalization"],
            false
        );
        assert_eq!(artifact["exposureNormalization"]["mode"], "none");
        assert_eq!(
            artifact["exposureNormalization"]["support"],
            "schema_only_deferred"
        );
        assert_eq!(
            artifact["exposureNormalization"]["skippedReason"],
            "insufficient_overlap"
        );
        assert_eq!(artifact["exposureNormalization"]["appliedGainCount"], 0);
        assert_eq!(
            artifact["exposureNormalization"]["appliedLuminanceGains"]
                .as_array()
                .expect("applied gains should be an array")
                .len(),
            0
        );
    }

    #[test]
    fn refresh_panorama_stale_artifacts_marks_newer_source_file_stale() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let source_path = temp_dir.path().join("IMG_0001.CR3");
        fs::write(&source_path, b"raw-source").expect("source should be written");
        set_mtime(&source_path, 1_700_000_000);
        let mut metadata = metadata_with_artifact_sources(vec![json!({
            "imagePath": source_path.to_string_lossy(),
            "lensCorrectionState": "required_before_stitch",
            "rawDefaultsApplied": true,
            "sourceIndex": 0,
            "virtualCopyId": null,
        })]);

        assert!(!refresh_panorama_stale_artifacts(&mut metadata));
        assert!(
            metadata
                .raw_engine_artifacts
                .as_ref()
                .expect("artifacts should exist")
                .stale_artifact_ids
                .is_empty()
        );

        set_mtime(&source_path, 1_700_000_200);

        assert!(refresh_panorama_stale_artifacts(&mut metadata));
        assert_eq!(
            metadata
                .raw_engine_artifacts
                .as_ref()
                .expect("artifacts should exist")
                .stale_artifact_ids,
            vec!["artifact_panorama_test".to_string()]
        );
    }

    #[test]
    fn refresh_panorama_stale_artifacts_marks_newer_virtual_copy_sidecar_stale() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let source_path = temp_dir.path().join("IMG_0001.CR3");
        let virtual_sidecar_path = temp_dir.path().join("IMG_0001.CR3.abc123.rrdata");
        fs::write(&source_path, b"raw-source").expect("source should be written");
        fs::write(&virtual_sidecar_path, b"virtual-copy").expect("sidecar should be written");
        set_mtime(&source_path, 1_700_000_000);
        set_mtime(&virtual_sidecar_path, 1_700_000_000);
        let mut metadata = metadata_with_artifact_sources(vec![json!({
            "imagePath": source_path.to_string_lossy(),
            "lensCorrectionState": "required_before_stitch",
            "rawDefaultsApplied": true,
            "sourceIndex": 0,
            "virtualCopyId": "abc123",
        })]);

        assert!(!refresh_panorama_stale_artifacts(&mut metadata));

        set_mtime(&virtual_sidecar_path, 1_700_000_200);

        assert!(refresh_panorama_stale_artifacts(&mut metadata));
        assert_eq!(
            metadata
                .raw_engine_artifacts
                .as_ref()
                .expect("artifacts should exist")
                .stale_artifact_ids,
            vec!["artifact_panorama_test".to_string()]
        );
    }

    #[test]
    fn estimate_legacy_panorama_peak_memory_bytes_accounts_for_major_buffers() {
        let sources = vec![
            PanoramaSourceMetadata {
                global_transform_3x3: None,
                height: 100,
                index: 0,
                path: "left.dng".to_string(),
                width: 200,
            },
            PanoramaSourceMetadata {
                global_transform_3x3: None,
                height: 100,
                index: 1,
                path: "right.dng".to_string(),
                width: 200,
            },
        ];

        let estimate = estimate_legacy_panorama_peak_memory_bytes(&sources, 300, 100);

        assert_eq!(estimate, 1_114_000);
    }

    #[test]
    fn estimate_panorama_plan_accepts_renderable_memory_budget() {
        let plan = estimate_panorama_plan_from_sources(sample_plan_sources(), 1_000_000, 800);

        assert!(plan.dry_run);
        assert!(!plan.mutates);
        assert_eq!(plan.family, "panorama");
        assert_eq!(
            plan.output_dimensions,
            PanoramaPlanDimensions {
                height: 50,
                width: 200,
            }
        );
        assert_eq!(plan.preflight.status, "accepted");
        assert_eq!(plan.preflight.execution_mode, "full_frame_legacy");
        assert_eq!(plan.preflight.blocked_reasons, Vec::<String>::new());
        assert_eq!(
            plan.preflight.geometry_estimate.projected_bounds,
            PanoramaProjectedBounds {
                height: 50,
                width: 200,
                x: 0,
                y: 0,
            }
        );
        assert_eq!(
            plan.preflight.memory_components.total_estimated_peak_bytes,
            354_000
        );
        assert_eq!(plan.source_image_refs.len(), 2);
        assert_eq!(plan.source_image_refs[0].role, "panorama_tile");
    }

    #[test]
    fn estimate_panorama_plan_warns_near_memory_budget() {
        let plan = estimate_panorama_plan_from_sources(sample_plan_sources(), 400_000, 800);

        assert_eq!(plan.preflight.status, "warning");
        assert_eq!(plan.preflight.execution_mode, "full_frame_legacy");
        assert!(plan.preflight.blocked_reasons.is_empty());
        assert!(
            plan.preflight
                .warning_codes
                .contains(&"high_memory_estimate".to_string())
        );
    }

    #[test]
    fn estimate_panorama_plan_blocks_over_memory_budget_without_rendering() {
        let plan = estimate_panorama_plan_from_sources(sample_plan_sources(), 300_000, 800);

        assert_eq!(plan.preflight.status, "blocked_plan_only");
        assert_eq!(plan.preflight.execution_mode, "plan_only");
        assert_eq!(plan.preflight.tile_count, 1);
        assert_eq!(plan.preflight.memory_budget_bytes, 300_000);
        assert!(!plan.preflight.blocked_reasons.is_empty());
        assert!(
            plan.preflight
                .warning_codes
                .contains(&"memory_budget_exceeded".to_string())
        );
        assert!(
            plan.preflight
                .warning_codes
                .contains(&"tiled_render_required".to_string())
        );
    }

    fn sample_plan_sources() -> Vec<PanoramaSourceMetadata> {
        vec![
            PanoramaSourceMetadata {
                global_transform_3x3: None,
                height: 50,
                index: 0,
                path: "left.dng".to_string(),
                width: 100,
            },
            PanoramaSourceMetadata {
                global_transform_3x3: None,
                height: 50,
                index: 1,
                path: "right.dng".to_string(),
                width: 100,
            },
        ]
    }

    fn sample_render_metadata() -> PanoramaRenderMetadata {
        PanoramaRenderMetadata {
            blend_diagnostics: stitching::StitchBlendDiagnostics {
                overlap_gain_applications: vec![stitching::OverlapGainApplication {
                    gain: 1.125,
                    source_index: 1,
                }],
            },
            connected_source_indices: vec![0, 1],
            crop: PanoramaCropMetadata {
                height: 90,
                mode: "auto".to_string(),
                pre_crop_height: 100,
                pre_crop_width: 220,
                width: 200,
                x: 10,
                y: 5,
            },
            effective_boundary_mode: PanoramaBoundaryModeOption::AutoCrop,
            effective_projection: PanoramaProjectionOption::Rectilinear,
            estimated_peak_memory_bytes: 128_000,
            excluded_source_indices: Vec::new(),
            output_height: 90,
            output_width: 200,
            pairwise_matches: vec![PanoramaPairwiseMatchMetadata {
                brief_match_diagnostics: brief_match_diagnostics_fixture(),
                homography3x3: [1.0, 0.0, 12.0, 0.0, 1.0, 1.5, 0.0, 0.0, 1.0],
                homography_condition_number: Some(146.009_498),
                inlier_ratio: 0.8,
                inliers: 32,
                match_count: 40,
                mean_reprojection_error_px: 1.25,
                mean_reverse_reprojection_error_px: 1.35,
                mean_symmetric_transfer_error_px: 1.3,
                p95_symmetric_transfer_error_px: 1.6,
                source_index: 0,
                spatial_support_cell_count: 8,
                target_index: 1,
            }],
            reference_source_index: Some(0),
            requested_boundary_mode: PanoramaBoundaryModeOption::AutoCrop,
            requested_projection: PanoramaProjectionOption::Rectilinear,
            selected_match_edges: vec![PanoramaSelectedMatchEdgeMetadata {
                child_source_index: 1,
                edge_rank: 1,
                parent_source_index: 0,
                source_index: 0,
                target_index: 1,
                tree_depth: 1,
            }],
            max_transform_chain_length: 1,
            sources: sample_plan_sources(),
            warnings: Vec::new(),
        }
    }

    fn metadata_with_artifact_sources(sources: Vec<serde_json::Value>) -> ImageMetadata {
        ImageMetadata {
            version: 1,
            rating: 0,
            adjustments: serde_json::Value::Null,
            tags: None,
            exif: None,
            raw_engine_artifacts: Some(RawEngineArtifacts {
                panorama_artifacts: vec![json!({
                    "artifactId": "artifact_panorama_test",
                    "createdAt": "2023-11-14T22:13:21Z",
                    "sourceImageRefs": sources,
                })],
                ..RawEngineArtifacts::new_v1()
            }),
        }
    }

    fn set_mtime(path: &Path, unix_seconds: i64) {
        let file_time = filetime::FileTime::from_unix_time(unix_seconds, 0);
        filetime::set_file_mtime(path, file_time).expect("mtime should be set");
    }

    fn brief_match_diagnostics_fixture() -> processing::BriefMatchDiagnostics {
        processing::BriefMatchDiagnostics {
            accepted_match_count: 32,
            best_distance: Some(processing::BriefDistanceStats {
                max: 64,
                median: 28,
                min: 12,
                p95: 54,
            }),
            distance_rejected_count: 1,
            max_accepted_hamming_distance: processing::MAX_BRIEF_MATCH_HAMMING_DISTANCE,
            no_second_best_count: 0,
            query_feature_count: 80,
            ratio: Some(processing::BriefRatioStats {
                max: 0.72,
                median: 0.34,
                min: 0.1,
                p95: 0.68,
            }),
            ratio_rejected_count: 4,
            reciprocal_rejected_count: 3,
            second_best_distance: Some(processing::BriefDistanceStats {
                max: 150,
                median: 96,
                min: 72,
                p95: 132,
            }),
            train_feature_count: 82,
        }
    }

    fn graph_match_info(
        inliers: usize,
        match_count: usize,
        p95_error: f64,
        spatial_support_cell_count: usize,
    ) -> MatchInfo {
        MatchInfo {
            brief_match_diagnostics: brief_match_diagnostics_fixture(),
            homography: Matrix3::identity(),
            inliers,
            match_count,
            mean_reprojection_error_px: p95_error / 2.0,
            mean_reverse_reprojection_error_px: p95_error / 2.0,
            mean_symmetric_transfer_error_px: p95_error / 2.0,
            p95_symmetric_transfer_error_px: p95_error,
            spatial_support_cell_count,
        }
    }

    fn sample_image_infos(count: usize) -> Vec<ImageInfo> {
        (0..count)
            .map(|id| ImageInfo {
                features: Vec::new(),
                filename: format!("frame-{id}.dng"),
                id,
                image: Rgb32FImage::new(1, 1),
                low_detail_mask: GrayImage::new(1, 1),
                scale_factor: 1.0,
            })
            .collect()
    }
}
